// `open-artifact watch` ends when the app that started it is gone (issue #32). A harness runs its monitor through a
// shell (Claude Code: `zsh -c` / `bash -c`, then `node … watch`, stdin the null device), and an app that quits does not
// always stop it: on Windows a child outlives its parent, and a shell killed outright leaves its child anywhere. Each
// leftover watch is one more Node.js process.
//
//  (a) While the app and its shell run, watch runs.
//  (b) The shell is killed outright: watch exits.
//  (c) The app is killed and its shell stays (as on Windows): watch exits, and so does the shell after it.
//
// The app here is a small Node script that starts `sh -c "node open-artifact.ts watch"` the way a monitor does. No
// daemon is needed: watch waits for one. POSIX only (it needs /bin/sh); Windows takes the same path through PowerShell.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 60000 };
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const skip = process.platform === 'win32' ? 'needs /bin/sh' : false;

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function gone(pid, ms = 10000) {
  const started = Date.now();
  while (alive(pid) && Date.now() - started < ms) await sleep(100);
  return !alive(pid);
}

// The app: starts the monitor as a harness does and prints `<shell pid> <watch pid>` once watch runs.
const APP = `
const { spawn, execFileSync } = require('node:child_process');
const [node, cli] = process.argv.slice(1);
const shell = spawn('/bin/sh', ['-c', '"' + node + '" "' + cli + '" watch --harness claude-code; echo after'], { stdio: ['ignore', 'pipe', 'ignore'] });
const find = () => {
  try {
    const child = execFileSync('pgrep', ['-P', String(shell.pid)], { encoding: 'utf8' }).trim().split('\\n')[0];
    if (child) return console.log(shell.pid + ' ' + child);
  } catch {}
  setTimeout(find, 100);
};
find();
setInterval(() => {}, 1000);
`;

describe('watch ends with the app that started it', { skip }, () => {
  const started = [];
  const env = { ...process.env, OPEN_ARTIFACT_HOME: tmpDir('watch-exit-home-'), CLAUDE_CODE_SESSION_ID: 'watch-exit' };
  after(() => {
    for (const pid of started) if (alive(pid)) process.kill(pid, 'SIGKILL');
  });

  /** Starts the app; resolves with its, its shell's and watch's pids. */
  const launch = () =>
    new Promise((resolve, reject) => {
      const app = spawn(process.execPath, ['-e', APP, process.execPath, CLI], { env, stdio: ['ignore', 'pipe', 'inherit'] });
      started.push(app.pid);
      let text = '';
      app.stdout.on('data', (chunk) => {
        text += chunk;
        const match = /^(\d+) (\d+)/.exec(text);
        if (!match) return;
        const pids = { app: app.pid, shell: Number(match[1]), watch: Number(match[2]) };
        started.push(pids.shell, pids.watch);
        resolve(pids);
      });
      app.once('error', reject);
      setTimeout(() => reject(new Error('watch did not start')), 15000);
    });

  it('(a) runs while the app and its shell run, (b) exits when the shell is killed outright', T, async () => {
    const pids = await launch();
    await sleep(5000);
    assert.ok(alive(pids.watch), 'watch runs while the app and its shell run');
    process.kill(pids.shell, 'SIGKILL');
    assert.ok(await gone(pids.watch), 'watch exits once its shell is gone');
    process.kill(pids.app, 'SIGKILL');
  });

  it('(c) exits when the app is killed and its shell stays', T, async () => {
    const pids = await launch();
    await sleep(1500);
    process.kill(pids.app, 'SIGKILL');
    await sleep(200);
    assert.ok(alive(pids.shell), 'the shell outlives the app, as a monitor does on Windows');
    assert.ok(await gone(pids.watch), 'watch exits once the app is gone');
    assert.ok(await gone(pids.shell), 'and the shell ends after it');
  });
});
