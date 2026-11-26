/**
 * `open-artifact watch` ends once the app that started it is gone: lifeline.ts names the processes it hangs on (the
 * parent, then past shells the first process that is not one) and checks them.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { alive, chainFrom, exitWithHolders, holders, isShell, processTable, programName, startedBy } from '../src/lifeline.ts';

test('a program name drops its folder, a login dash and .exe', () => {
  assert.equal(programName('/bin/zsh'), 'zsh');
  assert.equal(programName('-zsh'), 'zsh');
  assert.equal(programName('C:\\Program Files\\Git\\usr\\bin\\bash.exe'), 'bash');
  assert.equal(programName('/Users/me/Library/Application Support/Claude/claude-code/2.1/claude.app/Contents/MacOS/claude'), 'claude');
  assert.ok(isShell('cmd.exe'));
  assert.ok(isShell('pwsh'));
  assert.ok(!isShell('node'));
  assert.ok(!isShell('claude'));
});

test('the holders are the parent, then each ancestor past a shell, up to the first that is not one', () => {
  const claude = { pid: 30, name: '/Applications/claude' };
  const terminal = { pid: 40, name: 'Terminal' };
  // Claude Code: node ← zsh ← claude ← …
  assert.deepEqual(holders([{ pid: 20, name: '/bin/zsh' }, claude, terminal]), [20, 30]);
  // An app that runs the command itself: only the app.
  assert.deepEqual(holders([claude, terminal]), [30]);
  // Shells inside shells, as on Windows (cmd.exe ← bash.exe ← claude.exe).
  assert.deepEqual(holders([{ pid: 11, name: 'cmd.exe' }, { pid: 12, name: 'bash.exe' }, { pid: 13, name: 'claude.exe' }, terminal]), [11, 12, 13]);
  // Unnamed (no ps): the parent alone. Init is never one.
  assert.deepEqual(holders([{ pid: 20, name: '' }, claude]), [20]);
  assert.deepEqual(holders([{ pid: 1, name: 'launchd' }]), []);
  assert.deepEqual(holders([]), []);
});

test('a ps or PowerShell listing walks up from a pid', () => {
  const table = processTable(' 7440  7436 node\n 7436  6260 /bin/zsh\n 6260  6259 /Users/me/Library/Application Support/claude\r\n6259 1 disclaimer\n');
  assert.deepEqual(chainFrom(table, 7436, 4), [
    { pid: 7436, name: '/bin/zsh' },
    { pid: 6260, name: '/Users/me/Library/Application Support/claude' },
    { pid: 6259, name: 'disclaimer' },
  ]);
  assert.deepEqual(chainFrom(table, 7436, 1), [{ pid: 7436, name: '/bin/zsh' }]);
  // A pid the listing does not have is kept, unnamed, and ends the walk.
  assert.deepEqual(chainFrom(table, 999, 4), [{ pid: 999, name: '' }]);
});

test('startedBy starts at the parent', () => {
  const chain = startedBy();
  assert.equal(chain[0]?.pid, process.ppid);
  assert.ok(alive(process.pid));
  assert.ok(alive(process.ppid));
});

test('the check calls gone once a holder ends, and not before', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  await new Promise((done) => child.once('spawn', done));
  const pid = child.pid as number;
  let calls = 0;
  const stop = exitWithHolders({ pids: [pid], everyMs: 50, gone: () => calls++ });
  try {
    await new Promise((done) => setTimeout(done, 300));
    assert.equal(calls, 0);
    child.kill('SIGKILL');
    await new Promise((done) => child.once('exit', done));
    const started = Date.now();
    while (calls === 0 && Date.now() - started < 3000) await new Promise((done) => setTimeout(done, 25));
    assert.equal(calls, 1);
    assert.equal(alive(pid), false);
    await new Promise((done) => setTimeout(done, 200));
    assert.equal(calls, 1, 'gone is called once');
  } finally {
    stop();
  }
});
