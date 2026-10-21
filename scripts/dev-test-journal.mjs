#!/usr/bin/env node
// Developer-only (Build 26.9): the isolated test journal for Add Fake Data and Reset All Data.
// It lives in <repo>/.dev-journal/com.fundedflow.desktop (git-ignored) unless FUNDEDFLOW_DEV_DATA_DIR says
// otherwise, and is never the per-user journal.
//
//   node scripts/dev-test-journal.mjs            start `tauri dev` on the test journal (developer tools enabled)
//   node scripts/dev-test-journal.mjs seed ...   seed it from the command line (FundedFlow closed)
//   node scripts/dev-test-journal.mjs reset ...  preview (or with --yes, run) the existing reset tool on it
//   node scripts/dev-test-journal.mjs window [n] open another window (default 2) on its own test journal, using the
//                                                debug build and dev server of a `tauri dev` that is already running
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const identifier = JSON.parse(readFileSync(path.join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8')).identifier;

export function testJournalDir(env = process.env) {
  return env.FUNDEDFLOW_DEV_DATA_DIR ? path.resolve(env.FUNDEDFLOW_DEV_DATA_DIR) : path.join(root, '.dev-journal', identifier);
}

/** Each extra window's journal: a journal is locked by the process that opens it, so windows cannot share one. */
export function windowJournalDir(n) {
  return path.join(root, '.dev-journal', `window-${n}`, identifier);
}

/** The debug binary `tauri dev` builds. Extra windows run a copy, so `tauri dev` can still rebuild it (Windows locks a running exe). */
export function debugBinary(platform = process.platform) {
  return path.join(root, 'apps/desktop/src-tauri/target/debug', platform === 'win32' ? 'fundedflow.exe' : 'fundedflow');
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
  if (sub === 'window') {
    const n = rest[0] ?? '2';
    if (!/^[1-9]\d*$/.test(n) || n === '1') throw new Error(`Window number must be 2 or more, not '${n}'.`);
    const dir = windowJournalDir(n);
    return { command: path.join(path.dirname(dir), path.basename(debugBinary(platform))), args: [], env: { FUNDEDFLOW_DEV_DATA_DIR: dir }, copyFrom: debugBinary(platform) };
  }
  if (sub === undefined || sub.startsWith('--')) {
    return { command: platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'tauri', '--', 'dev', ...args], env: { FUNDEDFLOW_DEV_DATA_DIR: dir } };
  }
  throw new Error(`Unknown subcommand '${sub}'. Use no subcommand (start the app), seed or reset.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { command, args, env, copyFrom } = commandFor(process.argv.slice(2), testJournalDir());
    const dir = env?.FUNDEDFLOW_DEV_DATA_DIR ?? testJournalDir();
    mkdirSync(path.dirname(dir), { recursive: true });
    if (copyFrom) {
      if (!existsSync(copyFrom)) throw new Error(`No debug build at ${copyFrom}. Start the first window with \`npm run dev:test-journal\` (or \`npm run tauri dev\`) and leave it running.`);
      const devUrl = JSON.parse(readFileSync(path.join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8')).build.devUrl;
      const up = await fetch(devUrl).then(() => true, () => false);
      if (!up) throw new Error(`The dev server at ${devUrl} is not running. Start the first window with \`npm run dev:test-journal\` (or \`npm run tauri dev\`) and leave it running.`);
      copyFileSync(copyFrom, command);
    }
    console.log(`Test journal: ${dir}`);
    // Only npm.cmd needs a shell on Windows; cargo and node get their arguments (paths may contain spaces) unquoted.
    const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, env: { ...process.env, ...env }, shell: command.endsWith('.cmd') });
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
