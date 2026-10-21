#!/usr/bin/env node
// Developer-only (Build 26.9): finishes Reset All Data after the desktop app has quit.
// The app starts this detached, then exits. It waits for FundedFlow to close and calls the existing
// reset tool (reset-test-data.mjs), which keeps its own running-app refusal, path checks and backup.
// No deletion or backup logic lives here: the outcome is written to a report the next start shows.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appIsRunning, resetTestData } from './reset-test-data.mjs';

export function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Unknown or incomplete argument: ${args[i]}`);
    if (args[i] === '--data-dir') out.dataDir = value;
    else if (args[i] === '--report') out.report = value;
    else if (args[i] === '--wait-pid') out.waitPid = Number(value);
    else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
    i++;
  }
  if (!out.dataDir || !out.report || !Number.isInteger(out.waitPid) || out.waitPid <= 0) {
    throw new Error('Usage: node scripts/dev-reset-handoff.mjs --data-dir <dir> --report <file> --wait-pid <pid>');
  }
  return out;
}

/** The report sits beside the data directory, never inside it (the reset moves the directory). */
export function reportPathFor(dataDir, identifier) {
  return path.join(path.dirname(path.resolve(dataDir)), `${identifier}.dev-reset.json`);
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

const sleepFor = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitUntil(done, { timeoutMs, intervalMs, sleep }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await done()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

export async function runHandoff({
  dataDir,
  report,
  waitPid,
  identifier,
  isRunning = appIsRunning,
  alive = pidAlive,
  sleep = sleepFor,
  timeoutMs = 60_000,
  intervalMs = 500,
  now = () => new Date().toISOString(),
  log = console.log,
}) {
  if (path.resolve(report) !== reportPathFor(dataDir, identifier)) {
    throw new Error('The report must be the app-specific file beside the data directory.');
  }
  let pending = {};
  try { pending = JSON.parse(readFileSync(report, 'utf8')); } catch { /* no pending report */ }
  const requestedAt = pending.requestedAt || now();
  const write = (status, message, backup = null) => {
    const outcome = { status, requestedAt, finishedAt: now(), dataDir: path.resolve(dataDir), backup, message, log: pending.log ?? null };
    writeFileSync(report, JSON.stringify(outcome, null, 2));
    log(`[${outcome.finishedAt}] ${status}: ${message}${backup ? `\nBackup: ${backup}` : ''}`);
    return outcome;
  };

  log(`[${now()}] Waiting for FundedFlow (pid ${waitPid}) to close before resetting ${path.resolve(dataDir)}`);
  if (!(await waitUntil(() => !alive(waitPid), { timeoutMs, intervalMs, sleep }))) {
    return write('failed', 'FundedFlow did not close in time, so nothing was reset. Close every FundedFlow window and use the CLI reset.');
  }
  // Other instances (or a slow shutdown) must also be gone; a process-list failure is a refusal.
  let closed;
  try {
    closed = await waitUntil(() => !isRunning(), { timeoutMs, intervalMs, sleep });
  } catch (error) {
    return write('failed', `${error.message} Nothing was reset.`);
  }
  if (!closed) {
    return write('failed', 'Another FundedFlow instance is still running, so nothing was reset. Close it and use the CLI reset.');
  }
  try {
    const result = resetTestData({ dataDir, identifier, apply: true, isRunning });
    return result.changed ? write('completed', result.reason, result.backup) : write('unchanged', result.reason);
  } catch (error) {
    return write('failed', `Reset refused: ${error.message} Nothing was reset.`);
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const config = JSON.parse(readFileSync(new URL('../apps/desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const outcome = await runHandoff({ ...options, identifier: config.identifier });
  console.log('Reopen FundedFlow on the test journal with: npm run dev:test-journal');
  return outcome;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    outcome => { process.exitCode = outcome.status === 'failed' ? 1 : 0; },
    error => { console.error(`Reset handoff refused: ${error.message}`); process.exitCode = 1; },
  );
}
