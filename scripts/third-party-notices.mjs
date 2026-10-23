// Build 26.78: generates apps/desktop/THIRD_PARTY_NOTICES.txt, the licence notices for every third-party component
// in the shipped Windows build, plus the small summary the Settings screen shows before the full text is loaded.
//
//   npm run notices         regenerate both files
//   npm run check:notices   regenerate into a temp folder and fail if the checked-in files differ (CI)
//
// Rust crates come from `cargo about` (apps/desktop/src-tauri/about.toml: x86_64-pc-windows-msvc, normal
// dependencies only). npm packages are the production dependency tree of apps/desktop and packages/domain, walked
// from package-lock.json; their licence files are read from node_modules. The bundled fonts are the OFL-1.1 npm
// packages, listed in their own section. Output is sorted and contains no dates, paths or hashes, so it only
// changes when a dependency does.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const TAURI_DIR = join(ROOT, "apps/desktop/src-tauri");
export const NOTICES_PATH = "apps/desktop/THIRD_PARTY_NOTICES.txt";
export const SUMMARY_PATH = "apps/desktop/src/legal/third-party-summary.json";

/**
 * Permissive licences only, in order of preference: for a choice ("MIT OR Apache-2.0") the earliest listed wins.
 * Keep identical to `accepted` in apps/desktop/src-tauri/about.toml. Never extend it to make a copyleft, unknown or
 * unlicensed component pass: that is a decision for the owner and counsel.
 */
export const ALLOWED_LICENSES = [
  "MIT",
  "Apache-2.0",
  "Apache-2.0 WITH LLVM-exception",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Zlib",
  "Unicode-3.0",
  "MPL-2.0",
  "CC0-1.0",
  "0BSD",
  "OFL-1.1",
];

/** The production npm roots: the workspaces whose code Vite bundles into dist. */
export const NPM_ROOTS = ["apps/desktop", "packages/domain"];

/**
 * Packages published without a licence file. Each entry is pinned to one version, so an upgrade has to be looked at
 * again, and records where the copyright line was checked. The text is the canonical licence text.
 */
export const MISSING_TEXT_OVERRIDES = {
  "react-remove-scroll-bar@2.3.8": {
    license: "MIT",
    copyright: ["Copyright (c) 2025 Anton Korzunov <thekashey@gmail.com>"],
    source: "LICENSE in github.com/theKashey/react-remove-scroll-bar (not included in the npm package)",
  },
  "@tauri-apps/plugin-dialog@2.8.3": {
    license: "MIT",
    copyright: ["Copyright (c) 2017 - Present Tauri Apps Contributors"],
    source: "plugins/dialog/LICENSE_MIT in github.com/tauri-apps/plugins-workspace (the npm package ships only LICENSE.spdx)",
  },
};

export class NoticesError extends Error {
  constructor(problems) {
    super(`Third-party notices could not be generated:\n${problems.map(p => `  - ${p}`).join("\n")}`);
    this.problems = problems;
  }
}

/* ---------- SPDX expressions ---------- */

function tokenize(expression) {
  return expression.replace(/[()]/g, " $& ").trim().split(/\s+/).filter(Boolean);
}

function parseExpression(expression) {
  const tokens = tokenize(expression);
  let i = 0;
  const peek = () => tokens[i];
  const primary = () => {
    const token = tokens[i++];
    if (token === undefined) throw new Error(`unexpected end of "${expression}"`);
    if (token === "(") {
      const node = or();
      if (tokens[i++] !== ")") throw new Error(`missing ")" in "${expression}"`);
      return node;
    }
    if (token === ")" || /^(AND|OR|WITH)$/i.test(token)) throw new Error(`unexpected "${token}" in "${expression}"`);
    if (peek()?.toUpperCase() === "WITH") {
      i++;
      const exception = tokens[i++];
      if (!exception) throw new Error(`missing exception in "${expression}"`);
      return { id: `${token} WITH ${exception}` };
    }
    return { id: token };
  };
  const and = () => {
    const items = [primary()];
    while (peek()?.toUpperCase() === "AND") { i++; items.push(primary()); }
    return items.length === 1 ? items[0] : { and: items };
  };
  const or = () => {
    const items = [and()];
    while (peek()?.toUpperCase() === "OR") { i++; items.push(and()); }
    return items.length === 1 ? items[0] : { or: items };
  };
  const node = or();
  if (i !== tokens.length) throw new Error(`unexpected "${tokens[i]}" in "${expression}"`);
  return node;
}

function choose(node, allowed) {
  if (node.id) return allowed.includes(node.id) ? [node.id] : null;
  if (node.and) {
    const parts = node.and.map(n => choose(n, allowed));
    return parts.every(Boolean) ? [...new Set(parts.flat())] : null;
  }
  const rank = ids => Math.min(...ids.map(id => allowed.indexOf(id)));
  const options = node.or.map(n => choose(n, allowed)).filter(Boolean);
  return options.length ? options.reduce((best, ids) => (rank(ids) < rank(best) ? ids : best)) : null;
}

/** The licences used from an SPDX expression under the allow-list, or null when no allowed reading exists. */
export function chooseLicenses(expression, allowed = ALLOWED_LICENSES) {
  if (typeof expression !== "string" || !expression.trim()) return null;
  try {
    return choose(parseExpression(expression), allowed);
  } catch {
    return null;
  }
}

/* ---------- Licence text ---------- */

const COPYRIGHT_LINE = /^\s*(copyright\s*(\(c\)|©|\d)|\(c\)\s*\d|©)/i;
const PLACEHOLDER = /\[(yyyy|year|name)|<year>|\{yyyy\}/i;

export function normalizeText(text) {
  return text.replace(/\r\n?/g, "\n").split("\n").map(line => line.replace(/\s+$/, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
}

/** Splits copyright lines from a licence file, so identical licence bodies can be printed once. */
export function splitCopyright(text) {
  const copyright = [];
  const body = [];
  for (const line of normalizeText(text).split("\n")) {
    if (COPYRIGHT_LINE.test(line) && !PLACEHOLDER.test(line)) copyright.push(line.trim());
    else body.push(line);
  }
  return { copyright, body: normalizeText(body.join("\n")) };
}

const LICENSE_FILE = /^(licen[cs]e|copying|unlicense)([-_.].*)?$/i;
const NOTICE_FILE = /^notices?([-_.].*)?$/i;
const NOT_TEXT = /\.(spdx|json|js|ts|html)$/i;

function listFiles(dir, pattern) {
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && pattern.test(entry.name) && !NOT_TEXT.test(entry.name))
    .map(entry => entry.name).sort();
}

/** Licence files for the chosen licences; with several files (LICENSE-MIT, LICENSE-APACHE) only the matching ones. */
function pickLicenseFiles(files, chosen) {
  if (files.length <= 1) return files;
  const tag = id => id.split(" ")[0].toLowerCase().replace(/-.*$/, "");
  const matching = files.filter(file => chosen.some(id => file.toLowerCase().includes(tag(id))));
  return matching.length ? matching : files;
}

/** A phrase every copy of the licence contains, to confirm a file really is that licence. */
const LICENSE_PHRASE = {
  "MIT": /permission is hereby granted, free of charge/i,
  "Apache-2.0": /apache license,?\s+version 2\.0/i,
  "BSD-3-Clause": /redistribution and use in source and binary forms/i,
  "BSD-2-Clause": /redistribution and use in source and binary forms/i,
};

/** The text of a package's own licence file(s) for `license`, or null when none plainly matches. */
export function ownLicenseText(dir, license) {
  const phrase = LICENSE_PHRASE[license];
  if (!phrase || !existsSync(dir)) return null;
  const texts = readPackageText(dir, pickLicenseFiles(listFiles(dir, LICENSE_FILE), [license])).filter(text => phrase.test(text.replace(/\s+/g, " ")));
  return texts.length ? texts.join("\n\n") : null;
}

/* ---------- npm ---------- */

function resolveInLock(packages, from, name) {
  let dir = from;
  for (;;) {
    const key = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[key]) return key;
    if (!dir) return null;
    // Node resolution: the package's own node_modules, then each enclosing one, then the root.
    const parent = dir.lastIndexOf("/node_modules/");
    dir = parent === -1 ? "" : dir.slice(0, parent);
  }
}

/**
 * The lockfile entries reachable from the workspace roots through dependencies, optional dependencies and required
 * peer dependencies. Dev dependencies and optional peers (type packages) are never followed. Workspaces themselves
 * are FundedFlow code and are not returned.
 */
export function productionPackages(lock, roots = NPM_ROOTS) {
  const packages = lock.packages ?? {};
  const problems = [];
  const seen = new Set();
  const found = new Map();
  const visit = (key, via) => {
    let entry = packages[key];
    if (entry?.link) { key = entry.resolved; entry = packages[key]; }
    if (!entry) { problems.push(`${via}: not in package-lock.json`); return; }
    if (seen.has(key)) return;
    seen.add(key);
    const workspace = !key.includes("node_modules/");
    if (!workspace) found.set(key, { key, name: key.slice(key.lastIndexOf("node_modules/") + 13), version: entry.version, license: entry.license });
    const optionalPeers = entry.peerDependenciesMeta ?? {};
    const deps = [
      ...Object.keys(entry.dependencies ?? {}).map(name => [name, false]),
      ...Object.keys(entry.optionalDependencies ?? {}).map(name => [name, true]),
      ...Object.keys(entry.peerDependencies ?? {}).filter(name => !optionalPeers[name]?.optional).map(name => [name, false]),
    ];
    for (const [name, optional] of deps) {
      const target = resolveInLock(packages, key, name);
      if (target) visit(target, `${name} (from ${key})`);
      else if (!optional) problems.push(`${name} (from ${key}): not in package-lock.json`);
    }
  };
  for (const root of roots) visit(root, root);
  if (problems.length) throw new NoticesError(problems);
  return [...found.values()];
}

function readPackageText(dir, files) {
  return files.map(file => readFileSync(join(dir, file), "utf8"));
}

/** npm components with their licence texts, read from node_modules under `root`. */
export function collectNpm({ root = ROOT, lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")), roots = NPM_ROOTS, allowed = ALLOWED_LICENSES, overrides = MISSING_TEXT_OVERRIDES } = {}) {
  const problems = [];
  const components = [];
  for (const pkg of productionPackages(lock, roots)) {
    const id = `${pkg.name}@${pkg.version}`;
    const chosen = chooseLicenses(pkg.license, allowed);
    if (!chosen) {
      problems.push(`${id}: licence "${pkg.license ?? "none declared"}" is not on the allow-list`);
      continue;
    }
    const dir = join(root, pkg.key);
    if (!existsSync(dir)) {
      problems.push(`${id}: not installed at ${pkg.key} (run npm ci)`);
      continue;
    }
    const licenseFiles = pickLicenseFiles(listFiles(dir, LICENSE_FILE), chosen);
    const notices = readPackageText(dir, listFiles(dir, NOTICE_FILE)).map(normalizeText);
    let texts;
    let copyright = [];
    let note;
    if (licenseFiles.length) {
      texts = readPackageText(dir, licenseFiles).map(text => {
        const split = splitCopyright(text);
        copyright.push(...split.copyright);
        return { license: chosen.length === 1 ? chosen[0] : chosen.join(" AND "), body: split.body };
      });
    } else if (overrides[id] && chosen.includes(overrides[id].license)) {
      const override = overrides[id];
      texts = [{ license: override.license, body: normalizeText(readFileSync(join(import.meta.dirname, "third-party-notices/licenses", `${override.license}.txt`), "utf8")) }];
      copyright = override.copyright;
      note = `The package contains no licence file; canonical ${override.license} text. Copyright from ${override.source}.`;
    } else {
      problems.push(`${id}: no licence text in ${pkg.key} (declared "${pkg.license}"); add a pinned entry to MISSING_TEXT_OVERRIDES after checking the upstream licence`);
      continue;
    }
    const json = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const author = typeof json.author === "string" ? json.author : json.author?.name;
    components.push({
      ecosystem: chosen.includes("OFL-1.1") ? "font" : "npm",
      name: pkg.name,
      version: pkg.version,
      declared: pkg.license,
      chosen,
      copyright: [...new Set(copyright)],
      authors: author ? [author] : [],
      texts,
      notices,
      note,
    });
  }
  if (problems.length) throw new NoticesError(problems);
  return components;
}

/* ---------- Rust ---------- */

export function runCargoAbout(tauriDir = TAURI_DIR) {
  const run = (args, label) => {
    try {
      return execFileSync("cargo", args, { cwd: tauriDir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      if (error.code === "ENOENT") throw new NoticesError(["cargo is not installed"]);
      throw new NoticesError([`${label} failed${/no such command/.test(error.stderr) ? ": cargo-about is not installed (cargo install cargo-about --version 0.9.2 --locked --features cli)" : ""}\n${error.stderr ?? error.message}`]);
    }
  };
  // cargo metadata (used by cargo-about) needs every locked crate present, then generation runs offline.
  run(["fetch", "--locked"], "cargo fetch");
  // cargo-about refuses to write to a pipe when started from PowerShell (as on the CI runner), so use a file.
  const temp = mkdtempSync(join(tmpdir(), "fundedflow-about-"));
  try {
    const out = join(temp, "about.json");
    run(["about", "generate", "--format", "json", "--offline", "--locked", "--fail", "-c", "about.toml", "-o", out], "cargo about generate");
    return JSON.parse(readFileSync(out, "utf8"));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** Rust components from `cargo about generate --format json` output. */
export function collectRust(about, allowed = ALLOWED_LICENSES) {
  const problems = [];
  const byCrate = new Map();
  for (const crate of about.crates) {
    const pkg = crate.package;
    byCrate.set(pkg.id, { pkg, texts: [], copyright: [] });
  }
  for (const license of about.licenses) {
    if (!allowed.includes(license.id)) problems.push(`licence ${license.id} (from cargo about) is not on the allow-list`);
    for (const user of license.used_by) {
      const entry = byCrate.get(user.crate.id);
      if (!entry) { problems.push(`${user.crate.name}@${user.crate.version}: licence text for a crate cargo about did not list`); continue; }
      // No source path means cargo-about fell back to the canonical text (it didn't recognise the crate's file with
      // enough confidence). Prefer the crate's own file when it is plainly that licence: it carries the copyright.
      const own = license.source_path ? null : ownLicenseText(dirname(entry.pkg.manifest_path), license.id);
      const split = splitCopyright(own ?? license.text);
      entry.copyright.push(...split.copyright);
      entry.texts.push({ license: license.id, body: split.body });
    }
  }
  const components = [];
  for (const { pkg, texts, copyright } of byCrate.values()) {
    const id = `${pkg.name}@${pkg.version}`;
    if (!texts.length) { problems.push(`${id}: no licence text`); continue; }
    const chosen = [...new Set(texts.map(t => t.license))].sort((a, b) => allowed.indexOf(a) - allowed.indexOf(b));
    const dir = dirname(pkg.manifest_path);
    const notices = chosen.includes("Apache-2.0") && existsSync(dir) ? readPackageText(dir, listFiles(dir, NOTICE_FILE)).map(normalizeText) : [];
    components.push({
      ecosystem: "rust",
      name: pkg.name,
      version: pkg.version,
      declared: pkg.license ?? (pkg.license_file ? "see licence file" : "none declared"),
      chosen,
      copyright: [...new Set(copyright)],
      authors: pkg.authors ?? [],
      texts,
      notices,
    });
  }
  if (problems.length) throw new NoticesError(problems);
  return components;
}

/* ---------- Rendering ---------- */

const SECTIONS = [
  ["rust", "Rust crates"],
  ["npm", "npm packages"],
  ["font", "Fonts"],
];

const heading = (text, char) => `${text}\n${char.repeat(text.length)}`;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byName = (a, b) => compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.name, b.name) || compare(a.version, b.version);

/** The notices text and its summary. Pure: the same components always give the same bytes. */
export function renderNotices(components, { appVersion }) {
  const textIds = new Map();
  const uniqueTexts = [...new Map(components.flatMap(c => c.texts).map(t => [`${t.license}\n${t.body}`, t])).values()]
    .sort((a, b) => compare(a.license, b.license) || compare(a.body, b.body));
  uniqueTexts.forEach((text, index) => textIds.set(`${text.license}\n${text.body}`, `T${index + 1}`));

  const counts = Object.fromEntries(SECTIONS.map(([key]) => [key, components.filter(c => c.ecosystem === key).length]));
  const total = components.length;
  const out = [];
  out.push(heading("FundedFlow third-party notices", "="), "");
  out.push(heading("About this file", "-"), "");
  out.push(`FundedFlow ${appVersion} for Windows x64 (x86_64-pc-windows-msvc) includes the third-party components listed below. Each is licensed by its own authors under the licence named in its entry; the full licence texts follow at the end, each printed once and referenced by its [T] number.`, "");
  out.push(`This build includes ${counts.rust} Rust crates, ${counts.npm} npm packages and ${counts.font} fonts: ${total} components, with ${uniqueTexts.length} distinct licence texts.`, "");
  out.push("FundedFlow itself is open source under the MIT License. Its full license is in the LICENSE file installed next to this one. Third-party components retain their own licenses and notices.", "");
  out.push(heading("What is included", "-"), "");
  out.push("Rust crates: the normal (non-dev, non-build) dependencies of the FundedFlow app for the x86_64-pc-windows-msvc target, as resolved by Cargo.lock and reported by cargo-about. Crates used only on other platforms are not included.", "");
  out.push("npm packages: the production dependency tree of apps/desktop and packages/domain in package-lock.json, whose code Vite bundles into the app. Development tools and type packages are not included.", "");
  out.push("Fonts: Inter, Space Grotesk and JetBrains Mono, bundled from their Fontsource packages under the SIL Open Font License 1.1.", "");
  out.push("Where a component offers a choice of licences, the entry names the one used here and the full choice it was taken from.", "");
  out.push(heading("Not covered", "-"), "");
  out.push("Microsoft Edge WebView2 Runtime: not bundled. The installer downloads Microsoft's bootstrapper only on a computer without the runtime, and Microsoft licenses it under its own terms.", "");
  out.push("NSIS (Nullsoft Scriptable Install System): builds the installer and is not part of the installed app.", "");
  out.push(heading("How to regenerate", "-"), "");
  out.push("From the repository root, run `npm run notices` (needs cargo-about 0.9.2) and commit the result. CI runs `npm run check:notices`, which fails when a dependency changes without this file being regenerated.", "");

  for (const [key, title] of SECTIONS) {
    const list = components.filter(c => c.ecosystem === key).sort(byName);
    if (!list.length) continue;
    out.push(heading(`${title} (${list.length})`, "="), "");
    for (const c of list) {
      out.push(heading(`${c.name} ${c.version}`, "-"), "");
      const chosen = c.chosen.join(" AND ");
      const lines = [/\bOR\b/i.test(c.declared) ? `Licence: ${chosen} (chosen from "${c.declared}")` : `Licence: ${chosen}`];
      if (c.copyright.length) lines.push(...c.copyright.map(line => (/^copyright/i.test(line) ? line : `Copyright: ${line}`)));
      else lines.push(`Copyright: not stated in the package's licence files${c.authors.length ? `; authors: ${c.authors.join(", ")}` : ""}`);
      const refs = [...new Set(c.texts.map(t => `[${textIds.get(`${t.license}\n${t.body}`)}] ${t.license}`))];
      lines.push(`Licence text: ${refs.join(", ")}`);
      out.push(lines.join("\n"), "");
      if (c.note) out.push(c.note, "");
      // Indented, so a NOTICE file's own underlined headings can't be read as entries (apps/desktop/src/legal/third-party.ts).
      for (const notice of c.notices) out.push(`NOTICE:\n${notice.replace(/^(?=.)/gm, "    ")}`, "");
    }
  }

  out.push(heading(`Licence texts (${uniqueTexts.length})`, "="), "");
  for (const text of uniqueTexts) {
    out.push(heading(`[${textIds.get(`${text.license}\n${text.body}`)}] ${text.license}`, "-"), "");
    out.push(text.body, "");
  }
  const notices = `${out.join("\n").replace(/\n+$/, "")}\n`;
  const summary = { appVersion, rust: counts.rust, npm: counts.npm, fonts: counts.font, total, licenseTexts: uniqueTexts.length };
  return { notices, summary: `${JSON.stringify(summary, null, 2)}\n` };
}

/* ---------- CLI ---------- */

export function generate({ root = ROOT } = {}) {
  const appVersion = JSON.parse(readFileSync(join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8")).version;
  const components = [...collectRust(runCargoAbout(join(root, "apps/desktop/src-tauri"))), ...collectNpm({ root })];
  return renderNotices(components, { appVersion });
}

function main(args) {
  const check = args.includes("--check");
  const { notices, summary } = generate();
  if (!check) {
    writeFileSync(join(ROOT, NOTICES_PATH), notices);
    writeFileSync(join(ROOT, SUMMARY_PATH), summary);
    console.log(`Wrote ${NOTICES_PATH} and ${SUMMARY_PATH}.`);
    return;
  }
  const temp = mkdtempSync(join(tmpdir(), "fundedflow-notices-"));
  try {
    writeFileSync(join(temp, "THIRD_PARTY_NOTICES.txt"), notices);
    writeFileSync(join(temp, "third-party-summary.json"), summary);
    const stale = [[NOTICES_PATH, notices], [SUMMARY_PATH, summary]].filter(([path, expected]) => {
      const actual = existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n") : null;
      return actual !== expected;
    });
    if (stale.length) {
      console.error(`Third-party notices are out of date: ${stale.map(([path]) => path).join(", ")}.\nA dependency changed without the notices being regenerated. Run \`npm run notices\` and commit the result.`);
      process.exitCode = 1;
    } else {
      console.log("Third-party notices are up to date.");
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.dirname, "third-party-notices.mjs")) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof NoticesError ? error.message : error);
    process.exitCode = 1;
  }
}
