// A reconnect with messages the host does not take: a real daemon (`open-artifact daemon run`, from source) in a
// temporary OPEN_ARTIFACT_HOME, and a host connected through @open-artifact/harness-kit whose `wake` turns requests
// down (as Cindy does for a collaborator's comment, or any host whose agent is not there to take one). When the daemon
// restarts, the kit attaches the session again and the daemon hands it what waited; what `wake` does not take goes back
// to the daemon's inbox (`inbox.return`), so nothing is held only in the host's memory.
//
//  (a) A request from the page while the host turns it down waits in the inbox. The daemon restarts; the kit's
//      re-attach takes it, `wake` turns it down again, and it goes back: the session's next tool call has it in
//      `messages`, once.
//  (b) The same after another restart, answered to `ArtifactComments wait`; a request that comes during the wait
//      is taken by it at once.
//  (c) It is on disk while it waits: a daemon restarted again before any call still has it for the next call.
//
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { api, createHarness, readDaemon } from '@open-artifact/harness-kit';
import { until } from './lib/http.mjs';
import { repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 120000 };
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');

/** A TCP port nobody listens on now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

describe('a reconnect hands back what the host did not take', () => {
  const ctx = {};
  const caller = () => ({ session: 'reattach-1', workspace: ctx.workspace });
  const texts = (result) => (Array.isArray(result?.messages) ? result.messages : []);
  const daemonLog = () => fs.readFileSync(path.join(ctx.home, 'logs', 'daemon.log'), 'utf8');

  /** Starts the daemon on the same port and home; resolves once its daemon.json is there. */
  const start = async () => {
    const json = path.join(ctx.home, 'daemon.json');
    fs.rmSync(json, { force: true });
    ctx.out = '';
    ctx.daemon = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', String(ctx.port)], { env: ctx.env, cwd: ctx.workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.daemon.stdout.on('data', (chunk) => (ctx.out += chunk));
    ctx.daemon.stderr.on('data', (chunk) => (ctx.out += chunk));
    ctx.exited = new Promise((resolve) => ctx.daemon.once('exit', resolve));
    assert.ok(await until(() => fs.existsSync(json), 30000), `the daemon did not start:\n${ctx.out}`);
    ctx.state = await readDaemon(ctx.home);
  };
  const stop = async () => {
    if (ctx.daemon?.exitCode !== null) return;
    ctx.daemon.kill('SIGTERM');
    await Promise.race([ctx.exited, new Promise((resolve) => setTimeout(resolve, 10000))]);
    if (ctx.daemon.exitCode === null) ctx.daemon.kill('SIGKILL');
  };
  /** Restarts the daemon and waits until the kit attached the session again and handled what waited. */
  const restart = async () => {
    const before = ctx.attaches;
    await stop();
    await start();
    assert.ok(await until(() => ctx.host.connected && ctx.attaches > before, 30000), 'the host did not attach again');
  };
  /** Sends a request from the artifact's page (what the Shell's Ask sends). */
  const ask = (text) => api(ctx.state, 'artifacts.ask', { id: ctx.id, text });

  before(async () => {
    const root = tmpDir('reattach-inbox');
    ctx.home = path.join(root, 'home');
    ctx.workspace = path.join(root, 'work');
    const types = path.join(root, 'types');
    for (const dir of [ctx.workspace, types]) fs.mkdirSync(dir, { recursive: true });
    const note = path.join(types, 'note');
    fs.mkdirSync(note);
    fs.writeFileSync(path.join(note, 'artifact-type.json'), JSON.stringify({ name: 'Note', description: 'A one-page note as a local HTML file.', when: 'The person wants a short note.' }));
    fs.writeFileSync(path.join(note, 'index.html'), '<!doctype html><meta charset="utf-8"><title>note</title><h1>A note</h1>\n');
    ctx.env = {
      ...process.env,
      HOME: path.join(root, 'user-home'),
      OPEN_ARTIFACT_HOME: ctx.home,
      OPEN_ARTIFACT_USER_TYPES: types,
      OPEN_ARTIFACT_BUILTIN_TYPES: path.join(root, 'no-builtin'),
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(root, 'type-servers'),
      OPEN_ARTIFACT_BROWSER: 'none',
      OPEN_ARTIFACT_IDLE_MS: '0',
    };
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION', 'OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY', 'OPEN_ARTIFACT_DAEMON_BIN']) delete ctx.env[name];
    fs.mkdirSync(ctx.env.HOME);
    fs.mkdirSync(ctx.env.OPEN_ARTIFACT_BUILTIN_TYPES);
    ctx.port = await freePort();
    ctx.stopAll = () => ctx.daemon?.exitCode === null && ctx.daemon.kill('SIGKILL');
    process.on('exit', ctx.stopAll);
    await start();

    ctx.woken = [];
    ctx.attaches = 0;
    ctx.kitLog = [];
    ctx.host = await createHarness({
      harness: 'reattach-e2e',
      agentName: 'Reattach',
      home: ctx.home,
      autoStart: false,
      reconnect: { minMs: 50, maxMs: 200 },
      caps: { tools: 'native', wake: { resume: true } },
      // Turns every request down, as a host does for one its agent cannot take.
      wake: (params) => {
        ctx.woken.push(params.text);
        return 'failed';
      },
      log: (line) => ctx.kitLog.push(line),
    });
    ctx.host.on('state', (state) => {
      if (state === 'connected') ctx.attaches++;
    });
    await ctx.host.ready();
    await ctx.host.attach({ ...caller(), title: 'Reattach chat', status: 'idle' });
    const made = await ctx.host.call('Artifact', { action: 'publish', type_url: 'open-artifact://type/note', title: 'Note', folder: 'note', open: 'never' }, caller());
    assert.equal(made.error, undefined, JSON.stringify(made.error));
    ctx.id = String(made.url).split('/').at(-1);
  });

  after(async () => {
    ctx.host?.close();
    await stop();
    ctx.stopAll?.();
    if (ctx.stopAll) process.off('exit', ctx.stopAll);
  });

  it('(a) turned down on the re-attach, it goes back to the inbox and comes with the next tool call, once', T, async () => {
    const asked = await ask('Make the title blue');
    assert.equal(asked.via, 'inbox', JSON.stringify(asked));
    const woken = ctx.woken.length;
    await restart();
    assert.ok(await until(() => ctx.woken.length > woken && /put back in its inbox/.test(daemonLog()), 30000), `the re-attach did not put it back:\n${ctx.kitLog.join('\n')}`);
    assert.ok(ctx.kitLog.some((line) => /were not taken; they wait in its inbox again/.test(line)), ctx.kitLog.join('\n'));
    const first = await ctx.host.call('Artifact', { action: 'list' }, caller());
    assert.equal(texts(first).filter((text) => text.includes('Make the title blue')).length, 1, JSON.stringify(first.messages));
    const second = await ctx.host.call('Artifact', { action: 'list' }, caller());
    assert.equal(texts(second).some((text) => text.includes('Make the title blue')), false, 'taken once');
  });

  it('(b) after another restart it answers a wait, and a request during the wait is taken by it', T, async () => {
    await ask('Shorter subtitle, please');
    await restart();
    assert.ok(await until(() => /put back in its inbox/.test(daemonLog()), 30000));
    const waited = await ctx.host.call('ArtifactComments', { action: 'wait', timeout_ms: 5000 }, caller());
    assert.ok(texts(waited).some((text) => text.includes('Shorter subtitle, please')), JSON.stringify(waited));
    assert.equal(waited.timedOut, undefined);
    const waiting = ctx.host.call('ArtifactComments', { action: 'wait', timeout_ms: 20000 }, caller());
    await new Promise((resolve) => setTimeout(resolve, 300));
    const during = await ask('One more thing');
    assert.equal(during.via, 'wait', JSON.stringify(during));
    assert.ok(texts(await waiting).some((text) => text.includes('One more thing')));
  });

  it('(c) put back, it is on disk: a daemon restarted before any call still has it', T, async () => {
    await ask('Keep this one');
    await restart();
    assert.ok(await until(() => (daemonLog().match(/put back in its inbox/g) ?? []).length >= 1 && ctx.woken.some((t) => t.includes('Keep this one')), 30000));
    // The daemon goes away before any call: what it put back stays in the session's inbox file.
    await restart();
    const next = await ctx.host.call('Artifact', { action: 'list' }, caller());
    assert.equal(texts(next).filter((text) => text.includes('Keep this one')).length, 1, JSON.stringify(next.messages));
  });
});
