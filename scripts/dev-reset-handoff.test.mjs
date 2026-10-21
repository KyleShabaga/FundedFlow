import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appIsRunning } from './reset-test-data.mjs';
import { parseArgs, reportPathFor, runHandoff } from './dev-reset-handoff.mjs';
import { commandFor, testJournalDir } from './dev-test-journal.mjs';

const identifier = 'com.fundedflow.desktop';
const quiet = () => {};
const noSleep = async () => {};

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'fundedflow-handoff-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, identifier);
  mkdirSync(path.join(dataDir, 'attachments'), { recursive: true });
  writeFileSync(path.join(dataDir, 'fundedflow.db'), 'synthetic journal');
  writeFileSync(path.join(dataDir, 'attachments', 'chart.png'), 'png');
  const report = reportPathFor(dataDir, identifier);
  writeFileSync(report, JSON.stringify({ status: 'pending', requestedAt: '2026-10-21T10:00:00.000Z' }));
  return { root, dataDir, report };
}

const read = file => JSON.parse(readFileSync(file, 'utf8'));

test('waits for the app to exit, then resets through the existing tool and reports the backup', async t => {
  const { root, dataDir, report } = fixture(t);
  let checks = 0;
  const outcome = await runHandoff({
    dataDir, report, waitPid: 4242, identifier, log: quiet, sleep: noSleep,
    alive: () => ++checks < 3, // still closing for two checks
    isRunning: () => false,
  });
  assert.equal(outcome.status, 'completed');
  assert.equal(read(report).status, 'completed');
  assert.equal(read(report).requestedAt, '2026-10-21T10:00:00.000Z');
  assert.deepEqual(readdirSync(dataDir), [], 'the active journal is fresh');
  assert.ok(outcome.backup.startsWith(`${dataDir}.backup-`));
  assert.equal(readFileSync(path.join(outcome.backup, 'fundedflow.db'), 'utf8'), 'synthetic journal');
  assert.equal(readFileSync(path.join(outcome.backup, 'attachments', 'chart.png'), 'utf8'), 'png');
  assert.ok(existsSync(report) && path.dirname(report) === root, 'the report stays beside, not inside, the data directory');
});

test('an app that never closes means nothing is reset', async t => {
  const { dataDir, report } = fixture(t);
  const outcome = await runHandoff({ dataDir, report, waitPid: 1, identifier, log: quiet, sleep: noSleep, timeoutMs: 0, alive: () => true, isRunning: () => false });
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.message, /did not close/);
  assert.equal(readFileSync(path.join(dataDir, 'fundedflow.db'), 'utf8'), 'synthetic journal');
});

test('another running instance keeps the existing running-app refusal', async t => {
  const { dataDir, report } = fixture(t);
  const outcome = await runHandoff({ dataDir, report, waitPid: 1, identifier, log: quiet, sleep: noSleep, timeoutMs: 0, alive: () => false, isRunning: () => true });
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.message, /still running/);
  assert.equal(readFileSync(path.join(dataDir, 'fundedflow.db'), 'utf8'), 'synthetic journal');
});

test('a process-list failure fails closed', async t => {
  const { dataDir, report } = fixture(t);
  const outcome = await runHandoff({
    dataDir, report, waitPid: 1, identifier, log: quiet, sleep: noSleep, alive: () => false,
    isRunning: () => appIsRunning('linux', () => { throw new Error('blocked'); }),
  });
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.message, /Cannot check running applications/);
  assert.ok(existsSync(path.join(dataDir, 'fundedflow.db')));
});

test('the tool\'s own refusals (a symlinked target) are reported, not bypassed', async t => {
  const { root, dataDir } = fixture(t);
  const linkRoot = path.join(root, 'link');
  mkdirSync(linkRoot);
  const link = path.join(linkRoot, identifier);
  (await import('node:fs')).symlinkSync(dataDir, link, 'junction');
  const report = reportPathFor(link, identifier);
  const outcome = await runHandoff({ dataDir: link, report, waitPid: 1, identifier, log: quiet, sleep: noSleep, alive: () => false, isRunning: () => false });
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.message, /real directory/);
  assert.ok(existsSync(path.join(dataDir, 'fundedflow.db')));
});

test('an empty journal is reported unchanged', async t => {
  const { dataDir, report } = fixture(t);
  rmSync(dataDir, { recursive: true });
  mkdirSync(dataDir);
  const outcome = await runHandoff({ dataDir, report, waitPid: 1, identifier, log: quiet, sleep: noSleep, alive: () => false, isRunning: () => false });
  assert.equal(outcome.status, 'unchanged');
});

test('refuses a report path other than the one beside the data directory', async t => {
  const { root, dataDir } = fixture(t);
  await assert.rejects(runHandoff({ dataDir, report: path.join(dataDir, 'report.json'), waitPid: 1, identifier, log: quiet }), /beside the data directory/);
  await assert.rejects(runHandoff({ dataDir, report: path.join(root, 'elsewhere.json'), waitPid: 1, identifier, log: quiet }), /beside the data directory/);
});

test('parses arguments strictly', () => {
  assert.deepEqual(parseArgs(['--data-dir', 'd', '--report', 'r', '--wait-pid', '12']), { dataDir: 'd', report: 'r', waitPid: 12 });
  assert.throws(() => parseArgs(['--data-dir', 'd', '--report', 'r']), /Usage/);
  assert.throws(() => parseArgs(['--data-dir', 'd', '--report', 'r', '--wait-pid', 'x']), /Usage/);
  assert.throws(() => parseArgs(['--data-dir']), /incomplete/);
  assert.throws(() => parseArgs(['--yes', 'x']), /Unknown/);
});

test('the CLI runs the whole handoff against a temporary journal', t => {
  if (appIsRunning()) return t.skip('a FundedFlow process is running on this machine');
  const { dataDir, report } = fixture(t);
  const script = fileURLToPath(new URL('./dev-reset-handoff.mjs', import.meta.url));
  // A pid that has already exited.
  const exited = Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }));
  const output = execFileSync(process.execPath, [script, '--data-dir', dataDir, '--report', report, '--wait-pid', String(exited)], { encoding: 'utf8' });
  assert.match(output, /completed/);
  assert.match(output, /npm run dev:test-journal/);
  assert.equal(read(report).status, 'completed');
  assert.deepEqual(readdirSync(dataDir), []);
});

test('the test-journal launcher always passes an isolated, explicit directory', () => {
  const dir = testJournalDir({});
  assert.equal(path.basename(dir), identifier);
  assert.equal(path.basename(path.dirname(dir)), '.dev-journal');
  assert.equal(testJournalDir({ FUNDEDFLOW_DEV_DATA_DIR: '/tmp/x/com.fundedflow.desktop' }), path.resolve('/tmp/x/com.fundedflow.desktop'));
  const start = commandFor([], '/t/com.fundedflow.desktop', 'linux');
  assert.deepEqual([start.command, start.args, start.env], ['npm', ['run', 'tauri', '--', 'dev'], { FUNDEDFLOW_DEV_DATA_DIR: '/t/com.fundedflow.desktop' }]);
  assert.equal(commandFor([], '/t/x', 'win32').command, 'npm.cmd');
  const seed = commandFor(['seed', '--preset', 'stress'], '/t/com.fundedflow.desktop');
  assert.deepEqual(seed.args.slice(-4), ['--data-dir', '/t/com.fundedflow.desktop', '--preset', 'stress']);
  const reset = commandFor(['reset'], '/t/com.fundedflow.desktop');
  assert.deepEqual(reset.args.slice(1), ['--all', '--data-dir', '/t/com.fundedflow.desktop'], 'preview unless --yes is added');
  assert.throws(() => commandFor(['wipe']), /Unknown subcommand/);
});
