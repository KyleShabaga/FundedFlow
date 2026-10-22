// Runs a JSON-emitting audit command and tells "audit found a problem" apart from "audit could not run".
//
//   node scripts/audit-guard.mjs --label <name> --expect <json key> [--attempts 3] [--backoff 10] [--timeout 120]
//     [--fail-on-outage] -- <command...>
//
// The command must print JSON on stdout. If that JSON has the --expect key, the audit produced a real result
// and the command's exit code is passed through (a high+ advisory still fails CI). Otherwise (registry 503,
// network error, advisory database fetch failure, an attempt killed after --timeout seconds) the command is
// retried with growing backoff, and if it never produces a result the guard reports "not run" with an annotation.
// That exits 0 on pull_request and push, so an outage cannot hide other checks, and 1 with --fail-on-outage or on
// schedule and workflow_dispatch events (GITHUB_EVENT_NAME), so an audit that never ran there is red.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** Events whose audit must actually run: an outage fails them. */
export const FAIL_ON_OUTAGE_EVENTS = ["schedule", "workflow_dispatch"];

export function parseArgs(argv, eventName = process.env.GITHUB_EVENT_NAME ?? "") {
  const split = argv.indexOf("--");
  if (split < 0) throw new Error("missing `--` before the audit command");
  const opts = {
    label: "audit",
    expect: "",
    attempts: 3,
    backoff: 10,
    timeout: 120,
    failOnOutage: FAIL_ON_OUTAGE_EVENTS.includes(eventName),
    command: argv.slice(split + 1),
  };
  const flags = argv.slice(0, split);
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === "--fail-on-outage") {
      opts.failOnOutage = true;
      continue;
    }
    const value = flags[++i];
    if (flags[i - 1] === "--label") opts.label = value;
    else if (flags[i - 1] === "--expect") opts.expect = value;
    else if (flags[i - 1] === "--attempts") opts.attempts = Number(value);
    else if (flags[i - 1] === "--backoff") opts.backoff = Number(value);
    else if (flags[i - 1] === "--timeout") opts.timeout = Number(value);
    else throw new Error(`unknown option ${flags[i - 1]}`);
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

// npm.cmd needs a shell on Windows, and killing that shell on a timeout leaves npm running. Run npm's own CLI
// script with this Node instead, so a timed-out attempt really ends.
function resolveCommand([cmd, ...args]) {
  if (process.platform !== "win32" || cmd !== "npm") return { cmd, args, shell: false };
  const cli = join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  if (existsSync(cli)) return { cmd: process.execPath, args: [cli, ...args], shell: false };
  return { cmd, args, shell: true };
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
    const { cmd, args, shell } = resolveCommand(opts.command);
    const result = spawnSync(cmd, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      shell,
      timeout: opts.timeout > 0 ? opts.timeout * 1000 : undefined,
    });
    const json = tryParse(result.stdout ?? "");
    if (json && opts.expect in json && !json.error) {
      for (const line of summarize(json)) log(line);
      if (result.status === 0) log(`${opts.label}: no blocking advisories.`);
      else log(`${opts.label}: blocking advisories found (exit ${result.status}).`);
      return result.status ?? 1;
    }
    lastReason = result.error?.code === "ETIMEDOUT"
      ? `timed out after ${opts.timeout} s`
      : (result.stderr || result.stdout || String(result.error ?? "no output")).trim().split("\n").slice(-3).join(" | ");
    log(`${opts.label}: attempt ${attempt}/${opts.attempts} produced no advisory result: ${lastReason}`);
    if (attempt < opts.attempts) sleep(opts.backoff * attempt);
  }
  const consequence = opts.failOnOutage
    ? "Failing: a scheduled or manual audit that did not run is red."
    : "Other checks are unaffected; the daily scheduled audit goes red if this persists.";
  const message = `${opts.label} NOT RUN: no advisory result after ${opts.attempts} attempts (registry or network failure). ${consequence} Last error: ${lastReason}`;
  log(`::warning title=${opts.label} not run::${message}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ⚠️ ${message}\n`);
  return opts.failOnOutage ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run(parseArgs(process.argv.slice(2))));
}
