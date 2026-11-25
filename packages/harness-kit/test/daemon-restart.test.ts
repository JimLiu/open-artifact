/**
 * `restartDaemon` and `Harness.daemon.restart()`: the running daemon is stopped, its process waited for, and another
 * started; the harness then says hello to the new one (its new port and token read again). With none running, a restart is a start. A daemon in this very process (the in-process fake) is refused. The
 * "daemon" here is the kit's fake daemon run as a process of its own, so it speaks the Harness API.
 */
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'node:test';
import { createHarness, readDaemon, restartDaemon } from '../src/index.ts';
import { startFakeDaemon } from '../src/testing.ts';

const TESTING = resolve(fileURLToPath(new URL('../src/testing.ts', import.meta.url)));

const dirs: string[] = [];
const homes: string[] = [];
afterEach(() => {
  for (const at of homes.splice(0)) {
    try {
      const { pid } = JSON.parse(readFileSync(join(at, 'daemon.json'), 'utf8')) as { pid: number };
      if (pid !== process.pid) process.kill(pid, 'SIGKILL');
    } catch {
      /* none left */
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A home, and an `open-artifact` entry that runs the fake daemon there as a process of its own (`daemon run`). */
function setup(): { home: string; bin: string; env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(join(tmpdir(), 'oa-kit-restart-'));
  dirs.push(dir);
  const home = join(dir, 'home');
  homes.push(home);
  const bin = join(dir, 'open-artifact.mjs');
  writeFileSync(bin, `import { startFakeDaemon } from ${JSON.stringify(TESTING)};\nawait startFakeDaemon({ home: process.env.OPEN_ARTIFACT_HOME });\n`);
  const env: NodeJS.ProcessEnv = { ...process.env, OPEN_ARTIFACT_HOME: home };
  delete env.OPEN_ARTIFACT_DAEMON_BIN;
  return { home, bin, env };
}

describe('restarting the daemon', () => {
  it('restartDaemon: a start when none runs; then the old process exits and a new one answers', async () => {
    const { home, bin, env } = setup();
    const first = await restartDaemon({ home, bin, env, timeoutMs: 15_000 });
    assert.equal(first.stopped, null, 'nothing ran: only a start');
    const second = await restartDaemon({ home, bin, env, timeoutMs: 15_000 });
    assert.equal(second.stopped?.pid, first.daemon.pid);
    assert.notEqual(second.daemon.pid, first.daemon.pid);
    assert.throws(() => process.kill(first.daemon.pid, 0), 'the old process has exited');
    assert.equal((await readDaemon(home))?.pid, second.daemon.pid);
  });

  it('Harness.daemon.restart(): a new pid, and the harness connected to it with its new token', async () => {
    const { home, bin, env } = setup();
    const harness = await createHarness({ harness: 'restart-app', home, daemon: { bin, env, timeoutMs: 15_000 }, reconnect: { minMs: 50, maxMs: 200 } });
    try {
      await harness.ready();
      const before = harness.client.state!;
      await harness.attach({ session: 's1', workspace: '/w' });
      const [after, again] = await Promise.all([harness.daemon.restart(), harness.daemon.restart()]);
      assert.equal(again.pid, after.pid, 'a second call waits for the same restart');
      assert.notEqual(after.pid, before.pid);
      assert.equal('token' in after, false, 'the token stays with the harness');
      assert.equal(harness.connected, true);
      assert.equal(harness.client.state?.pid, after.pid);
      assert.notEqual(harness.client.state?.token, before.token, "the new daemon's token was read");
      // Calls go to the new daemon: it answers as any.
      assert.ok((await harness.tools()).length > 0);
      assert.ok(harness.features.includes('view.open'));
    } finally {
      harness.close();
    }
  });

  it('refuses a daemon that runs in this process (the in-process fake)', async () => {
    const fake = await startFakeDaemon();
    const harness = await createHarness({ harness: 'restart-fake', home: fake.home, autoStart: false });
    try {
      await harness.ready();
      await assert.rejects(harness.daemon.restart(), (error: Error & { code?: string }) => error.code === 'invalid_argument');
      // Not left without a connection.
      await harness.ready();
      assert.equal(harness.connected, true);
    } finally {
      harness.close();
      await fake.close();
    }
  });
});
