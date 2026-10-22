import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./audit-guard.mjs";

const node = (code) => [process.execPath, "-e", code];
const opts = (code, extra = {}) => ({ label: "x audit", expect: "metadata", attempts: 2, backoff: 0, command: node(code), ...extra });

test("a real advisory result keeps the command's failing exit code", () => {
  const out = [];
  const code = run(opts(`console.log(JSON.stringify({metadata:{},vulnerabilities:{lodash:{severity:"high"}}}));process.exit(1)`), (l) => out.push(l));
  assert.equal(code, 1);
  assert.ok(out.some((l) => l.includes("high: lodash")));
});

test("a clean result passes", () => {
  assert.equal(run(opts(`console.log(JSON.stringify({metadata:{}}))`), () => {}), 0);
});

test("a registry error reports not run and does not fail", () => {
  const out = [];
  const code = run(opts(`console.log(JSON.stringify({error:{code:"E503"}}));process.exit(1)`), (l) => out.push(l));
  assert.equal(code, 0);
  assert.ok(out.some((l) => l.startsWith("::warning title=x audit not run::") && l.includes("NOT RUN")));
  assert.equal(out.filter((l) => l.startsWith("x audit: attempt")).length, 2);
});

test("non-JSON output (network failure) is retried then reported not run", () => {
  const out = [];
  assert.equal(run(opts(`console.error("503 Service Unavailable");process.exit(1)`), (l) => out.push(l)), 0);
  assert.ok(out.some((l) => l.includes("NOT RUN")));
});

test("a transient failure is retried and the later real result wins", () => {
  const flag = `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/audit-guard-${process.pid}`;
  const code = `const f=require("fs");const p=${JSON.stringify(flag)};if(!f.existsSync(p)){f.writeFileSync(p,"1");process.exit(1)}f.unlinkSync(p);console.log(JSON.stringify({metadata:{}}))`;
  assert.equal(run(opts(code), () => {}), 0);
});
