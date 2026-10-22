import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chooseLicenses, collectNpm, collectRust, NoticesError, productionPackages, renderNotices, splitCopyright } from "./third-party-notices.mjs";

const MIT = name => `MIT License\n\nCopyright (c) 2024 ${name}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software.\n`;

// A workspace app with one production dependency tree, a dev tool, an optional peer (type package) and a nested copy.
const lock = {
  packages: {
    "": { name: "root", workspaces: ["apps/app"] },
    "apps/app": { dependencies: { alpha: "^1", "@scope/beta": "^2" }, devDependencies: { devtool: "^1" } },
    "node_modules/app": { link: true, resolved: "apps/app" },
    "node_modules/alpha": { version: "1.0.0", license: "MIT", dependencies: { gamma: "^2" }, peerDependencies: { "@types/x": "*" }, peerDependenciesMeta: { "@types/x": { optional: true } } },
    "node_modules/alpha/node_modules/gamma": { version: "2.0.0", license: "(MIT OR Apache-2.0)" },
    "node_modules/gamma": { version: "1.0.0", license: "MIT", dev: true },
    "node_modules/@scope/beta": { version: "2.1.0", license: "ISC" },
    "node_modules/devtool": { version: "9.0.0", license: "MIT", dev: true, dependencies: { gamma: "^1" } },
    "node_modules/@types/x": { version: "1.0.0", license: "MIT", devOptional: true },
  },
};

function fixture(t, packages) {
  const root = mkdtempSync(path.join(tmpdir(), "fundedflow-notices-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [key, files] of Object.entries(packages)) {
    mkdirSync(path.join(root, key), { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(path.join(root, key, file), text);
  }
  return root;
}

const npmFixture = (t, overrides = {}) => fixture(t, {
  "node_modules/alpha": { "package.json": '{"author":"Ann"}', LICENSE: MIT("Ann") },
  "node_modules/alpha/node_modules/gamma": { "package.json": "{}", "LICENSE-MIT": MIT("Gus"), "LICENSE-APACHE": "Apache License\nVersion 2.0\n" },
  "node_modules/@scope/beta": { "package.json": "{}", "LICENSE.md": "ISC License\n\nCopyright (c) 2023 Bea\n\nPermission to use, copy, modify.\n" },
  ...overrides,
});

test("only production packages are collected: no dev tools, optional peers or workspaces", () => {
  const found = productionPackages(lock, ["apps/app"]).map(p => `${p.name}@${p.version}`).sort();
  assert.deepEqual(found, ["@scope/beta@2.1.0", "alpha@1.0.0", "gamma@2.0.0"]);
});

test("a dependency missing from the lockfile is an error, not a silent skip", () => {
  const broken = structuredClone(lock);
  delete broken.packages["node_modules/@scope/beta"];
  assert.throws(() => productionPackages(broken, ["apps/app"]), err => err instanceof NoticesError && /@scope\/beta/.test(err.message));
});

test("licence choice follows the allow-list order and rejects copyleft or unknown licences", () => {
  assert.deepEqual(chooseLicenses("Apache-2.0 OR MIT"), ["MIT"]);
  assert.deepEqual(chooseLicenses("(MIT OR Apache-2.0) AND Unicode-3.0"), ["MIT", "Unicode-3.0"]);
  assert.deepEqual(chooseLicenses("Unlicense OR MIT"), ["MIT"]);
  assert.deepEqual(chooseLicenses("Apache-2.0 WITH LLVM-exception"), ["Apache-2.0 WITH LLVM-exception"]);
  for (const expr of ["GPL-3.0", "LGPL-2.1 OR GPL-3.0", "MIT AND GPL-2.0", "UNLICENSED", "SEE LICENSE IN LICENSE", "", undefined, "MIT OR"]) {
    assert.equal(chooseLicenses(expr), null, String(expr));
  }
});

test("a package under a disallowed licence fails generation", t => {
  const gpl = structuredClone(lock);
  gpl.packages["node_modules/@scope/beta"].license = "GPL-3.0-only";
  assert.throws(() => collectNpm({ root: npmFixture(t), lock: gpl, roots: ["apps/app"] }), err => err instanceof NoticesError && /@scope\/beta@2\.1\.0: licence "GPL-3\.0-only" is not on the allow-list/.test(err.message));
});

test("a disallowed licence reported by cargo about fails generation", () => {
  const pkg = { id: "x", name: "x", version: "1.0.0", license: "GPL-3.0", manifest_path: "/nowhere/Cargo.toml", authors: [] };
  const about = { crates: [{ package: pkg }], licenses: [{ id: "GPL-3.0", text: "GPL", source_path: "/nowhere/LICENSE", used_by: [{ crate: pkg }] }] };
  assert.throws(() => collectRust(about), err => err instanceof NoticesError && /GPL-3\.0/.test(err.message));
});

test("a package without licence text is reported, never skipped", t => {
  const root = npmFixture(t, { "node_modules/@scope/beta": { "package.json": "{}", "LICENSE.spdx": "PackageLicenseDeclared: ISC" } });
  assert.throws(() => collectNpm({ root, lock, roots: ["apps/app"], overrides: {} }), err => err instanceof NoticesError && /@scope\/beta@2\.1\.0: no licence text/.test(err.message));
});

test("a pinned override supplies the canonical text and records where the copyright came from", t => {
  const root = npmFixture(t, { "node_modules/alpha": { "package.json": "{}" } });
  const overrides = { "alpha@1.0.0": { license: "MIT", copyright: ["Copyright (c) 2020 Ann"], source: "upstream LICENSE" } };
  const alpha = collectNpm({ root, lock, roots: ["apps/app"], overrides }).find(c => c.name === "alpha");
  assert.deepEqual(alpha.copyright, ["Copyright (c) 2020 Ann"]);
  assert.match(alpha.texts[0].body, /^MIT License\n\nPermission is hereby granted/);
  assert.match(alpha.note, /upstream LICENSE/);
  // The override is pinned: another version still fails.
  const bumped = structuredClone(lock);
  bumped.packages["node_modules/alpha"].version = "1.0.1";
  assert.throws(() => collectNpm({ root, lock: bumped, roots: ["apps/app"], overrides }), NoticesError);
});

test("with several licence files only the chosen licence's file is used", t => {
  const gamma = collectNpm({ root: npmFixture(t), lock, roots: ["apps/app"] }).find(c => c.name === "gamma");
  assert.deepEqual(gamma.chosen, ["MIT"]);
  assert.equal(gamma.texts.length, 1);
  assert.match(gamma.texts[0].body, /^MIT License/);
});

test("copyright lines are split out so identical licence bodies print once", () => {
  assert.deepEqual(splitCopyright(MIT("Ann")).copyright, ["Copyright (c) 2024 Ann"]);
  assert.equal(splitCopyright(MIT("Ann")).body, splitCopyright(MIT("Bob")).body);
  // Licence wording and template lines stay in the body.
  const isc = splitCopyright("provided that the above\ncopyright notice and this permission notice appear\n   Copyright [yyyy] [name of copyright owner]\n");
  assert.deepEqual(isc.copyright, []);
});

test("output is sorted and deterministic whatever order components arrive in", t => {
  const components = collectNpm({ root: npmFixture(t), lock, roots: ["apps/app"] });
  const first = renderNotices(components, { appVersion: "1.2.3" });
  const second = renderNotices([...components].reverse(), { appVersion: "1.2.3" });
  assert.equal(first.notices, second.notices);
  assert.equal(first.summary, second.summary);
  const names = [...first.notices.matchAll(/^(\S+) (\d+\.\d+\.\d+)\n-+$/gm)].map(m => m[1]);
  assert.deepEqual(names, ["alpha", "@scope/beta", "gamma"].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  // alpha and gamma share one MIT body; ISC is separate.
  assert.equal(JSON.parse(first.summary).licenseTexts, 2);
  assert.match(first.notices, /FundedFlow 1\.2\.3 for Windows x64/);
  assert.match(first.notices, /Licence: MIT \(chosen from "\(MIT OR Apache-2\.0\)"\)/);
  assert.doesNotMatch(first.notices, /\r|\d{4}-\d{2}-\d{2}T/);
});
