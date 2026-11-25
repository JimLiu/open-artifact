/**
 * `open-artifact daemon restart`: the person's (every connected app and open page reconnects), so it is refused inside
 * an agent session before anything is stopped or started. In the person's own terminal it starts a daemon when none
 * runs, and otherwise stops the running one, waits for it to exit and starts another (a new pid).
 */

import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const BIN = fileURLToPath(new URL('../src/bin/open-artifact.ts', import.meta.url));

/** Runs the command line in a home of its own (and a HOME of its own, so nothing reaches the person's folders). */
function run(args: string[], home: string, vars: Record<string, string> = {}): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, HOME: join(home, 'user'), OPEN_ARTIFACT_HOME: home, OPEN_ARTIFACT_PORT: '0', ...vars } });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('close', (code) => done({ code, out, err }));
  });
}

function stopDaemonOf(home: string): void {
  try {
    const { pid } = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')) as { pid: number };
    process.kill(pid, 'SIGKILL');
  } catch {
    /* none */
  }
}

test('daemon restart is refused inside an agent session, before anything starts', async () => {
  const home = tempDir('open-artifact-restart-home-');
  const agents: Array<Record<string, string>> = [{ CLAUDECODE: '1' }, { CODEX_THREAD_ID: 't-1' }];
  for (const agent of agents) {
    const refused = await run(['daemon', 'restart'], home, agent);
    assert.notEqual(refused.code, 0);
    assert.match(refused.err, /Restarting the Open Artifact daemon .*is the person's decision/);
    assert.match(refused.err, /`open-artifact daemon restart`/);
  }
  assert.equal(existsSync(join(home, 'daemon.json')), false, 'no daemon was started');
});

test('daemon restart in the person\'s terminal: a start when none runs, then a new process', { timeout: 60_000 }, async () => {
  const home = tempDir('open-artifact-restart-home-');
  try {
    const first = await run(['daemon', 'restart'], home);
    assert.equal(first.code, 0, first.err);
    const started = JSON.parse(first.out) as { pid: number; url: string; stopped?: number; token?: string };
    assert.equal(started.stopped, undefined, 'nothing ran');
    assert.equal(started.token, undefined, 'the token is not printed');
    assert.ok(started.pid > 0);

    const second = await run(['daemon', 'restart'], home);
    assert.equal(second.code, 0, second.err);
    const again = JSON.parse(second.out) as { pid: number; stopped?: number };
    assert.equal(again.stopped, started.pid);
    assert.notEqual(again.pid, started.pid);
    assert.throws(() => process.kill(started.pid, 0), 'the old daemon has exited');
    const now = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')) as { url: string; pid: number };
    assert.equal(now.pid, again.pid);
    assert.equal(((await (await fetch(`${now.url}/__open-artifact/health`)).json()) as { openArtifact?: number }).openArtifact, 1, 'the new daemon answers');
  } finally {
    stopDaemonOf(home);
  }
});
