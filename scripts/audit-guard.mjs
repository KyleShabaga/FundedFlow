// Runs a JSON-emitting audit command and tells "audit found a problem" apart from "audit could not run".
//
//   node scripts/audit-guard.mjs --label <name> --expect <json key> [--attempts 3] [--backoff 10] -- <command...>
//
// The command must print JSON on stdout. If that JSON has the --expect key, the audit produced a real result
// and the command's exit code is passed through (a high+ advisory still fails CI). Otherwise (registry 503,
// network error, advisory database fetch failure) the command is retried with growing backoff, and if it never
// produces a result the guard exits 0 with a "not run" annotation, so an outage cannot hide other checks.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function parseArgs(argv) {
  const split = argv.indexOf("--");
  if (split < 0) throw new Error("missing `--` before the audit command");
  const opts = { label: "audit", expect: "", attempts: 3, backoff: 10, command: argv.slice(split + 1) };
  const flags = argv.slice(0, split);
  for (let i = 0; i < flags.length; i += 2) {
    const value = flags[i + 1];
    if (flags[i] === "--label") opts.label = value;
    else if (flags[i] === "--expect") opts.expect = value;
    else if (flags[i] === "--attempts") opts.attempts = Number(value);
    else if (flags[i] === "--backoff") opts.backoff = Number(value);
    else throw new Error(`unknown option ${flags[i]}`);
  }
  if (!opts.expect || opts.command.length === 0) throw new Error("--expect and a command are required");
  return opts;
}

function tryParse(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function sleep(seconds) {
  if (seconds > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

function summarize(json) {
  const lines = [];
  const vulns = json.vulnerabilities;
  if (vulns && !Array.isArray(vulns) && typeof vulns === "object" && !("list" in vulns)) {
    for (const [name, v] of Object.entries(vulns)) lines.push(`${v.severity ?? "?"}: ${name}`);
  } else if (vulns?.list) {
    for (const v of vulns.list) lines.push(`${v.advisory?.id ?? "?"}: ${v.package?.name ?? "?"} ${v.advisory?.title ?? ""}`);
  }
  for (const [kind, items] of Object.entries(json.warnings ?? {})) {
    for (const w of items) lines.push(`${kind}: ${w.package?.name ?? "?"} ${w.advisory?.id ?? ""}`);
  }
  return lines;
}

export function run(opts, log = console.log) {
  let lastReason = "";
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    const [cmd, ...args] = opts.command;
    const result = spawnSync(cmd, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === "win32" && cmd === "npm",
    });
    const json = tryParse(result.stdout ?? "");
    if (json && opts.expect in json && !json.error) {
      for (const line of summarize(json)) log(line);
      if (result.status === 0) log(`${opts.label}: no blocking advisories.`);
      else log(`${opts.label}: blocking advisories found (exit ${result.status}).`);
      return result.status ?? 1;
    }
    lastReason = (result.stderr || result.stdout || String(result.error ?? "no output")).trim().split("\n").slice(-3).join(" | ");
    log(`${opts.label}: attempt ${attempt}/${opts.attempts} produced no advisory result: ${lastReason}`);
    if (attempt < opts.attempts) sleep(opts.backoff * attempt);
  }
  const message = `${opts.label} NOT RUN: no advisory result after ${opts.attempts} attempts (registry or network failure). Other checks are unaffected. Last error: ${lastReason}`;
  log(`::warning title=${opts.label} not run::${message}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ⚠️ ${message}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run(parseArgs(process.argv.slice(2))));
}
