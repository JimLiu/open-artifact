/**
 * `Harness.daemon.stop()` with a real daemon that two apps share (two `createHarness` on one home): the stopping app
 * learns which other apps were connected (`others`), and stays stopped; another app's kit, which reconnects by
 * itself, starts the daemon again (its own `autoStart`, which the stop does not change). One with `autoStart: false`
 * does not. The daemon runs from source as a process of its own, in a home (and a HOME) of its own on a free port.
 */

import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createHarness, readDaemon, type Harness } from '@open-artifact/harness-kit';

const BIN = fileURLToPath(new URL('../src/bin/open-artifact.ts', import.meta.url));

function setup(): { home: string; env: NodeJS.ProcessEnv } {
  const home = tempDir('open-artifact-stop-home-');
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(home, 'user'), OPEN_ARTIFACT_HOME: home, OPEN_ARTIFACT_PORT: '0' };
  delete env.OPEN_ARTIFACT_DAEMON_BIN;
  return { home, env };
}

function killDaemonOf(home: string): void {
  try {
    const { pid } = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')) as { pid: number };
    process.kill(pid, 'SIGKILL');
  } catch {
    /* none */
  }
}

const connect = (name: string, home: string, env: NodeJS.ProcessEnv, autoStart = true): Promise<Harness> =>
  createHarness({ harness: name, home, autoStart, daemon: { bin: BIN, env, timeoutMs: 30_000 }, reconnect: { minMs: 200, maxMs: 400 } });

async function poll<T>(check: () => Promise<T | null>, ms: number): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((done) => setTimeout(done, 100));
  }
}

test('two apps on one daemon: one stops it, the other (autoStart) starts it again', { timeout: 90_000 }, async (t) => {
  const { home, env } = setup();
  const harnesses: Harness[] = [];
  try {
    const a = await connect('app-a', home, env);
    harnesses.push(a);
    await a.ready();
    const b = await connect('app-b', home, env);
    harnesses.push(b);
    await b.ready();
    await b.attach({ session: 'b1', workspace: home });
    const first = a.client.state!;
    assert.equal(b.client.state?.pid, first.pid, 'one daemon, shared');

    const states: string[] = [];
    a.on('state', (state) => states.push(state));
    const stoppedAt = Date.now();
    const stopped = await a.daemon.stop();
    assert.equal(stopped.stopped?.pid, first.pid);
    assert.deepEqual(stopped.others?.map((o) => [o.harness, o.polling, o.sessions]), [['app-b', false, 1]], 'the other app, its own connection left out');
    assert.equal(a.daemon.stopped, true);
    assert.equal(a.connected, false);

    // B reconnects by itself, and its reconnect starts a daemon (ensureDaemon).
    const again = await poll(async () => {
      const state = await readDaemon(home);
      return state && state.pid !== first.pid && b.connected ? state : null;
    }, 30_000);
    assert.ok(again, "the other app's kit started the daemon again");
    t.diagnostic(`stopped pid ${first.pid}; app-b started pid ${again.pid} ${Date.now() - stoppedAt} ms after the stop was asked for`);
    // A stays stopped although a daemon runs: it does not reconnect until it is asked to.
    await new Promise((done) => setTimeout(done, 1500));
    assert.equal(a.connected, false);
    assert.equal(a.daemon.stopped, true);
    assert.deepEqual(states, ['stopped']);
    // A's start connects it to the running daemon (B's), starting none.
    assert.equal((await a.daemon.start()).pid, again.pid);
    assert.equal(a.connected, true);
  } finally {
    for (const harness of harnesses) harness.close();
    killDaemonOf(home);
  }
});

test('two apps on one daemon: the other with autoStart false leaves it stopped', { timeout: 90_000 }, async () => {
  const { home, env } = setup();
  const harnesses: Harness[] = [];
  try {
    const a = await connect('app-a', home, env);
    harnesses.push(a);
    await a.ready();
    const b = await connect('app-b', home, env, false);
    harnesses.push(b);
    await b.ready();
    const stopped = await a.daemon.stop();
    assert.deepEqual(stopped.others?.map((o) => o.harness), ['app-b']);
    await new Promise((done) => setTimeout(done, 2500));
    assert.equal(await readDaemon(home), null, 'nothing started it');
    assert.equal(b.connected, false);
  } finally {
    for (const harness of harnesses) harness.close();
    killDaemonOf(home);
  }
});
