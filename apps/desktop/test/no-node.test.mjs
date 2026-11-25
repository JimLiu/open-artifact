/**
 * The no-Node chain (the exit condition of stage 1): with no `node` on PATH, Electron's own executable run as Node
 * starts the daemon detached, the daemon runs each type server with the same executable, and a blank Docs, Sheets,
 * Slides and Whiteboard each open to their editor. Needs `npm run build` in apps/desktop (the probe and the runtime).
 *
 * Every process here runs in a throwaway profile (HOME, OPEN_ARTIFACT_HOME, TMPDIR) on a free port that is not 4800;
 * the daemon is stopped by the pid its own daemon.json names.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { APP, NO_NODE_PATH, RUNTIME, alive, cleanEnv, daemonState, electronBinary, freePort, leftovers, makeProfile, processes, stopDaemon, treeOf } from './lib/env.mjs';

const TYPES = ['docs', 'sheets', 'slides', 'whiteboard'];
const PROBE = join(APP, 'out', 'test', 'chain-probe.mjs');

describe('no Node on PATH: Electron as Node runs the daemon and the type servers', () => {
  let profile;
  let port;
  let electron;
  let report;
  let tree = [];

  before(async () => {
    assert.ok(existsSync(PROBE), 'out/test/chain-probe.mjs is missing: run npm run build in apps/desktop');
    assert.ok(existsSync(join(RUNTIME, 'scripts', 'open-artifact.mjs')), 'resources/runtime is missing: run npm run build in apps/desktop');
    electron = electronBinary();
    profile = makeProfile('oa-desktop-no-node-');
    port = await freePort();
  });

  after(async () => {
    if (profile) {
      await stopDaemon(profile);
      const left = leftovers(profile);
      if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
      assert.deepEqual(left, [], 'processes of the test profile still run');
    }
  });

  it('the PATH has no node', () => {
    let found = null;
    try {
      found = execFileSync('/usr/bin/which', ['node'], { env: { PATH: NO_NODE_PATH }, encoding: 'utf8' }).trim();
    } catch {
      // `which` exits 1: none
    }
    assert.equal(found, null, `node is on ${NO_NODE_PATH}: ${found}`);
  });

  it('Electron run as Node is Node 22.18 or later', () => {
    const version = execFileSync(electron, ['-e', 'process.stdout.write(process.version)'], { env: cleanEnv(profile, port, { ELECTRON_RUN_AS_NODE: '1' }), encoding: 'utf8' });
    const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
    assert.ok(major > 22 || (major === 22 && minor >= 18), `Node ${version}`);
  });

  it('starts the daemon detached and opens a blank Docs, Sheets, Slides and Whiteboard', { timeout: 180_000 }, async () => {
    const env = cleanEnv(profile, port, { ELECTRON_RUN_AS_NODE: '1' });
    const child = spawn(electron, [PROBE, RUNTIME, profile.artifacts, ...TYPES], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const code = await new Promise((done) => child.on('exit', done));
    try {
      report = JSON.parse(stdout.trim().split('\n').pop());
    } catch {
      assert.fail(`the probe printed no report (exit ${code}):\n${stdout}\n${stderr}`);
    }
    if (process.env.OA_DESKTOP_VERBOSE) console.log(JSON.stringify(report, null, 2));
    assert.equal(report.error, undefined, report.error);
    for (const type of TYPES) assert.equal(report.types[type]?.ok, true, `${type}: ${JSON.stringify(report.types[type])}`);
    assert.equal(code, 0, stderr);
    assert.equal(report.execPath, electron);
    assert.equal(report.processType, null, 'the probe ran as Node, not as an Electron app');
    assert.notEqual(new URL(report.daemon.url).port, '4800');
    assert.equal(new URL(report.daemon.url).port, String(port));
  });

  it('the daemon outlived the probe, and it and every type server run Electron\'s executable', () => {
    const state = daemonState(profile);
    assert.ok(state?.pid && alive(state.pid), 'no daemon runs');
    assert.equal(state.pid, report.daemon.pid);
    tree = treeOf(state.pid, processes());
    const daemon = tree[0];
    // Detached: the probe has exited, so the daemon is no child of it (launchd took it).
    assert.equal(daemon.ppid, 1, `the daemon's parent is ${daemon.ppid}`);
    assert.ok(tree.length >= 2, `no type server runs under the daemon: ${JSON.stringify(tree)}`);
    for (const p of tree) assert.ok(p.command.startsWith(electron), `not Electron: ${p.command}`);
    if (process.env.OA_DESKTOP_VERBOSE) console.log(tree.map((p) => `${p.pid} ${p.ppid} ${p.command.slice(0, 200)}`).join('\n'));
    // The daemon says how it runs Node scripts: as child processes of the same executable.
    assert.equal(report.health?.nodeChildren?.mode, 'process', JSON.stringify(report.health));
    assert.equal(report.health?.nodeChildren?.reason, 'electron', JSON.stringify(report.health));
  });

  it('the files of each blank artifact are in its folder', () => {
    for (const type of TYPES) {
      const folder = join(profile.artifacts, type);
      assert.ok(existsSync(join(folder, '.artifact.json')), `${type}: no .artifact.json in ${folder}`);
    }
  });
});
