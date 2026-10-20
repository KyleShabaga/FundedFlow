// Dependency-boundary check for @fundedflow/domain (run in CI).
//
// The domain package must stay portable between the desktop (Tauri) host and
// later hosts, so src/ may import only its own files and the allow-listed
// runtime packages below: no React, Tauri, Node built-ins (fs, net, process…),
// browser globals, clocks or apps/desktop. The desktop app, in turn, must use
// the package's exports rather than reaching into packages/domain directly.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_PACKAGES = new Set(["zod"]);
const FORBIDDEN_GLOBALS = [
  [/\bprocess\s*\./, "process"],
  [/\bglobalThis\b/, "globalThis"],
  [/\b(window|document|navigator|localStorage|sessionStorage)\b/, "browser globals"],
  [/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/, "network access"],
  [/\brequire\s*\(/, "require()"],
  [/\bimport\s*\(/, "dynamic import()"],
  [/\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)|\bperformance\.now\s*\(/, "clock read"],
  [/\bMath\.random\s*\(/, "randomness"],
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "../..");
const problems = [];

function* files(dir, ext) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path, ext);
    else if (ext.test(entry.name)) yield path;
  }
}

function specifiers(source) {
  const found = [];
  const pattern = /\b(?:import|export)\b[^'"`;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
  for (const m of source.matchAll(pattern)) found.push(m[1] ?? m[2]);
  return found;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
const show = (path) => relative(repo, path).split(sep).join("/");

const src = join(root, "src");
for (const file of files(src, /\.[cm]?tsx?$/)) {
  const code = stripComments(readFileSync(file, "utf8"));
  for (const spec of specifiers(code)) {
    if (spec.startsWith(".")) {
      const target = resolve(dirname(file), spec);
      if (target !== src && !target.startsWith(src + sep)) problems.push(`${show(file)}: imports ${spec} from outside src/`);
    } else {
      const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (!ALLOWED_PACKAGES.has(name)) problems.push(`${show(file)}: imports "${spec}" (allowed: ${[...ALLOWED_PACKAGES].join(", ")})`);
    }
  }
  for (const [pattern, what] of FORBIDDEN_GLOBALS) {
    if (pattern.test(code)) problems.push(`${show(file)}: uses ${what}`);
  }
}

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies })) {
  if (!ALLOWED_PACKAGES.has(name)) problems.push(`packages/domain/package.json: runtime dependency "${name}" is not allow-listed`);
}

for (const file of files(join(repo, "apps/desktop/src"), /\.[cm]?[jt]sx?$/)) {
  for (const spec of specifiers(stripComments(readFileSync(file, "utf8")))) {
    if (/packages\/domain|^@fundedflow\/domain\/(?!package\.json$)/.test(spec)) {
      problems.push(`${show(file)}: imports "${spec}"; use the "@fundedflow/domain" entry point`);
    }
  }
}

if (problems.length) {
  console.error(`Domain boundary violations:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("Domain boundaries OK");
