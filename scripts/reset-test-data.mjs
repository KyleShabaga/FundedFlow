#!/usr/bin/env node
// Developer CLI only. The application continues to own database creation/migrations.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function defaultDataDir(platform, env, home, identifier) {
  if (platform === 'win32') return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), identifier);
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', identifier);
  const dataHome = env.XDG_DATA_HOME && path.posix.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.posix.join(home, '.local', 'share');
  return path.posix.join(dataHome, identifier);
}

export function appIsRunning(platform = process.platform, execute = execFileSync) {
  try {
    if (platform === 'win32') {
      const output = execute('tasklist', ['/FI', 'IMAGENAME eq fundedflow.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
      return /^"fundedflow\.exe",/im.test(output);
    }
    const output = execute('ps', ['-A', '-o', 'comm='], { encoding: 'utf8' });
    return output.split('\n').some(name => path.basename(name.trim()).toLowerCase() === 'fundedflow');
  } catch {
    throw new Error('Cannot check running applications. Close FundedFlow and make process listing available before resetting.');
  }
}

export function resetTestData({ dataDir, identifier, apply = false, isRunning = appIsRunning }) {
  const target = path.resolve(dataDir);
  if (path.basename(target) !== identifier || path.dirname(target) === target) {
    throw new Error(`Data directory must be the app-specific '${identifier}' directory.`);
  }
  if (!existsSync(target)) return { target, changed: false, reason: 'No data directory exists.' };
  const stat = lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Data directory must be a real directory, not a file or symlink.');
  if (!apply) return { target, changed: false, reason: 'Preview only. Close FundedFlow, then add --yes to reset.' };
  if (isRunning()) throw new Error('FundedFlow is running. Close every instance before resetting its data.');
  if (readdirSync(target).length === 0) return { target, changed: false, reason: 'Data directory is already empty.' };

  // Keep the database, WAL/SHM, attachments and migration backups together.
  // A sibling backup stays on the same filesystem, so this is one directory rename.
  const backup = `${target}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  renameSync(target, backup);
  try {
    mkdirSync(target);
  } catch (error) {
    if (!existsSync(target)) renameSync(backup, target);
    throw error;
  }
  return { target, backup, changed: true, reason: 'Reset complete. Restart FundedFlow to create and seed a fresh journal.' };
}

export function main(args = process.argv.slice(2)) {
  let apply = false;
  let override;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--yes') apply = true;
    else if (args[i] === '--data-dir' && args[i + 1] && !args[i + 1].startsWith('--')) override = args[++i];
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: node scripts/reset-test-data.mjs [--yes] [--data-dir <app-data-directory>]\nPreview by default. Close FundedFlow before --yes. Existing data is moved to a sibling backup.');
      return;
    } else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  const config = JSON.parse(readFileSync(new URL('../apps/desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const result = resetTestData({ dataDir: override || defaultDataDir(process.platform, process.env, homedir(), config.identifier), identifier: config.identifier, apply });
  console.log(`Data directory: ${result.target}`);
  if (result.backup) console.log(`Backup: ${result.backup}`);
  console.log(result.reason);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(`Reset refused: ${error.message}`); process.exitCode = 1; }
}
