#!/usr/bin/env node
// Developer-only (Build 26.9): the isolated test journal for Add Fake Data and Reset All Data.
// It lives in <repo>/.dev-journal/com.fundedflow.desktop (git-ignored) unless FUNDEDFLOW_DEV_DATA_DIR says
// otherwise, and is never the per-user journal.
//
//   node scripts/dev-test-journal.mjs            start `tauri dev` on the test journal (developer tools enabled)
//   node scripts/dev-test-journal.mjs seed ...   seed it from the command line (FundedFlow closed)
//   node scripts/dev-test-journal.mjs reset ...  preview (or with --yes, run) the existing reset tool on it
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const identifier = JSON.parse(readFileSync(path.join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8')).identifier;

export function testJournalDir(env = process.env) {
  return env.FUNDEDFLOW_DEV_DATA_DIR ? path.resolve(env.FUNDEDFLOW_DEV_DATA_DIR) : path.join(root, '.dev-journal', identifier);
}

/** The command to run for a subcommand, with the test journal passed explicitly. */
export function commandFor(args, dir = testJournalDir(), platform = process.platform) {
  const [sub, ...rest] = args;
  if (sub === 'seed') {
    return { command: 'cargo', args: ['run', '--manifest-path', path.join(root, 'apps/desktop/src-tauri/Cargo.toml'), '--example', 'seed-demo-journal', '--', '--data-dir', dir, ...rest] };
  }
  if (sub === 'reset') {
    return { command: process.execPath, args: [path.join(root, 'scripts/reset-test-data.mjs'), '--all', '--data-dir', dir, ...rest] };
  }
  if (sub === undefined || sub.startsWith('--')) {
    return { command: platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'tauri', '--', 'dev', ...args], env: { FUNDEDFLOW_DEV_DATA_DIR: dir } };
  }
  throw new Error(`Unknown subcommand '${sub}'. Use no subcommand (start the app), seed or reset.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const dir = testJournalDir();
    mkdirSync(path.dirname(dir), { recursive: true });
    const { command, args, env } = commandFor(process.argv.slice(2), dir);
    console.log(`Test journal: ${dir}`);
    // Only npm.cmd needs a shell on Windows; cargo and node get their arguments (paths may contain spaces) unquoted.
    const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, env: { ...process.env, ...env }, shell: command.endsWith('.cmd') });
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
