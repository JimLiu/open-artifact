import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Why the test cannot run here, or null: it drives the installed Pi and CLI. */
function noPi() {
  for (const command of ['pi', 'open-artifact']) {
    const found = spawnSync(command, ['--version'], { encoding: 'utf8' });
    if (found.error || found.status !== 0) return `${command} is not on the PATH`;
  }
  return null;
}
const skip = noPi();
if (skip) console.log(`# harness-pi: skipped: ${skip}`);

function removeTestHome(dir) {
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(entry.parentPath, entry.name);
    const mode = statSync(path).mode & 0o777;
    if (!(mode & 0o200)) chmodSync(path, mode | 0o200);
  }
  rmSync(dir, { recursive: true });
}

test('an Ask request reaches the Pi session that owns the artifact', { skip: skip ?? false, timeout: 30_000 }, async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'open-artifact-pi-'));
  const home = join(cwd, 'state');
  const env = { ...process.env, OPEN_ARTIFACT_HOME: home, OPEN_ARTIFACT_RUNTIME_UPDATE: 'off', OPEN_ARTIFACT_PORT: '0', OPEN_ARTIFACT_BROWSER: 'none' };
  const cli = (args, vars = {}) => execFileSync('open-artifact', args, { cwd, env: { ...env, ...vars }, encoding: 'utf8', timeout: 10_000 });
  const pi = spawn('pi', ['--mode', 'rpc', '--no-session', '--no-extensions', '-e', join(here, 'extension.ts'), '-e', join(here, 'observe.ts')], { cwd, env, stdio: ['pipe', 'pipe', 'inherit'], signal: t.signal });
  pi.on('error', (error) => { if (error.name !== 'AbortError') t.diagnostic(String(error)); });
  const done = new Promise(resolve => pi.once('close', resolve));
  const output = createInterface({ input: pi.stdout })[Symbol.asyncIterator]();
  async function next(predicate) {
    for (let line = await output.next(); !line.done; line = await output.next()) {
      const event = JSON.parse(line.value);
      if (predicate(event)) return event;
    }
    throw new Error('Pi closed before the expected RPC event');
  }
  async function request(id, command) {
    pi.stdin.write(JSON.stringify({ id, ...command }) + '\n');
    const reply = await next(event => event.id === id);
    assert.equal(reply.success, true, JSON.stringify(reply));
    return reply.data;
  }
  try {
    const { sessionId } = await request('state', { type: 'get_state' });
    const commands = await request('commands', { type: 'get_commands' });
    assert(commands.commands.some(command => command.name === 'open-artifact-connect'));
    const prompt = await request('attach', { type: 'prompt', message: '/open-artifact-connect' });
    assert.equal(prompt.disposition, 'handled');
    const caller = { OPEN_ARTIFACT_HARNESS: 'pi', OPEN_ARTIFACT_SESSION: sessionId };
    const artifact = JSON.parse(cli(['artifact', JSON.stringify({ action: 'publish', title: 'Pi wake test', type_url: 'open-artifact://type/docs', open: 'never' })], caller));
    assert.match(artifact.url, /^open-artifact:\/\/artifact\//);
    const daemon = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8'));
    const text = 'Make the title bigger';
    const response = await fetch(new URL('/api/open-artifact.artifacts.ask', daemon.url), {
      method: 'POST',
      headers: { Authorization: `Bearer ${daemon.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: artifact.url.split('/').at(-1), text }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.ok, true);
    const delivery = await response.json();
    assert.equal(delivery.via, 'live', JSON.stringify(delivery));
    const received = await next(event => event.message?.customType === 'observed-open-artifact-input');
    assert.match(received.message.content, /Make the title bigger/);
  } finally {
    pi.stdin.end();
    await done;
    try { cli(['daemon', 'stop']); }
    finally { removeTestHome(cwd); }
  }
});
