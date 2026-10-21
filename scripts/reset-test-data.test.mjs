import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appIsRunning, defaultDataDir, resetTestData } from './reset-test-data.mjs';

const identifier = 'com.fundedflow.desktop';
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'fundedflow-reset-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, identifier);
  mkdirSync(dataDir);
  for (const [name, content] of Object.entries({ 'fundedflow.db': 'accounts/imports/settings', 'fundedflow.db-wal': 'pending pages', 'fundedflow.db-shm': 'shared memory', 'fundedflow.db.before-v13.bak': 'old journal' })) writeFileSync(path.join(dataDir, name), content);
  mkdirSync(path.join(dataDir, 'attachments'));
  writeFileSync(path.join(dataDir, 'attachments', 'source.csv'), 'original source');
  return { root, dataDir };
}

test('preview does not modify data or require the app to be closed', t => {
  const { dataDir } = fixture(t);
  const result = resetTestData({ dataDir, identifier, isRunning: () => { throw new Error('must not check'); } });
  assert.equal(result.changed, false);
  assert.equal(readFileSync(path.join(dataDir, 'fundedflow.db'), 'utf8'), 'accounts/imports/settings');
});

test('reset empties all app data and preserves the entire original bundle', t => {
  const { root, dataDir } = fixture(t);
  writeFileSync(path.join(root, 'unrelated.txt'), 'keep');
  const result = resetTestData({ dataDir, identifier, apply: true, isRunning: () => false });
  assert.equal(result.changed, true);
  assert.deepEqual(readdirSync(dataDir), []);
  assert.equal(readFileSync(path.join(result.backup, 'fundedflow.db'), 'utf8'), 'accounts/imports/settings');
  assert.equal(readFileSync(path.join(result.backup, 'fundedflow.db-wal'), 'utf8'), 'pending pages');
  assert.equal(readFileSync(path.join(result.backup, 'fundedflow.db-shm'), 'utf8'), 'shared memory');
  assert.equal(readFileSync(path.join(result.backup, 'fundedflow.db.before-v13.bak'), 'utf8'), 'old journal');
  assert.equal(readFileSync(path.join(result.backup, 'attachments', 'source.csv'), 'utf8'), 'original source');
  assert.equal(readFileSync(path.join(root, 'unrelated.txt'), 'utf8'), 'keep');
  assert.equal(resetTestData({ dataDir, identifier, apply: true, isRunning: () => false }).changed, false);
});

test('a running app blocks reset without changing files', t => {
  const { dataDir } = fixture(t);
  assert.throws(() => resetTestData({ dataDir, identifier, apply: true, isRunning: () => true }), /is running/);
  assert.equal(readFileSync(path.join(dataDir, 'fundedflow.db-wal'), 'utf8'), 'pending pages');
});

test('refuses a broad directory, file, or symlink target', t => {
  const { root, dataDir } = fixture(t);
  assert.throws(() => resetTestData({ dataDir: root, identifier, apply: true }), /app-specific/);
  const fileRoot = path.join(root, 'file'); mkdirSync(fileRoot);
  const file = path.join(fileRoot, identifier); writeFileSync(file, 'keep');
  assert.throws(() => resetTestData({ dataDir: file, identifier, apply: true }), /real directory/);
  const linkRoot = path.join(root, 'link'); mkdirSync(linkRoot);
  const link = path.join(linkRoot, identifier); symlinkSync(dataDir, link, 'junction');
  assert.throws(() => resetTestData({ dataDir: link, identifier, apply: true }), /real directory/);
});

test('missing data is a no-op', t => {
  const { root } = fixture(t);
  const result = resetTestData({ dataDir: path.join(root, 'missing', identifier), identifier, apply: true });
  assert.equal(result.changed, false);
});

test('resolves Tauri data paths across platforms', () => {
  assert.equal(defaultDataDir('win32', { APPDATA: 'C:\\Users\\dev\\AppData\\Roaming' }, 'C:\\Users\\dev', identifier), `C:\\Users\\dev\\AppData\\Roaming\\${identifier}`);
  assert.equal(defaultDataDir('darwin', {}, '/Users/dev', identifier), `/Users/dev/Library/Application Support/${identifier}`);
  assert.equal(defaultDataDir('linux', { XDG_DATA_HOME: '/tmp/test-data' }, '/home/dev', identifier), `/tmp/test-data/${identifier}`);
  assert.equal(defaultDataDir('linux', { XDG_DATA_HOME: 'relative/path' }, '/home/dev', identifier), `/home/dev/.local/share/${identifier}`);
  assert.equal(defaultDataDir('linux', {}, '/home/dev', identifier), `/home/dev/.local/share/${identifier}`);
});

test('detects native processes and fails closed on process-list errors', () => {
  assert.equal(appIsRunning('win32', () => '"fundedflow.exe","123","Console"'), true);
  assert.equal(appIsRunning('win32', () => 'INFO: No tasks are running'), false);
  assert.equal(appIsRunning('linux', () => 'node\n/tmp/target/debug/fundedflow\n'), true);
  assert.equal(appIsRunning('darwin', () => 'node\nFundedFlow\n'), true);
  assert.equal(appIsRunning('linux', () => 'node\nbash\n'), false);
  assert.throws(() => appIsRunning('linux', () => { throw new Error('blocked'); }), /Cannot check/);
});

test('CLI previews by default and rejects incomplete flags', t => {
  const { dataDir } = fixture(t);
  const script = fileURLToPath(new URL('./reset-test-data.mjs', import.meta.url));
  const preview = execFileSync(process.execPath, [script, '--data-dir', dataDir], { encoding: 'utf8' });
  assert.match(preview, /Preview only/);
  assert.equal(readFileSync(path.join(dataDir, 'fundedflow.db'), 'utf8'), 'accounts/imports/settings');
  // Apply behavior is tested directly above; this test never touches a user's default data directory.
  assert.throws(() => execFileSync(process.execPath, [script, '--data-dir'], { stdio: 'pipe' }), /failed/);
});
