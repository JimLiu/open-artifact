import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { artifactIdOf, type DaemonState, type ToolCallResult } from '@open-artifact/protocol';
import { api, readDaemon } from '../src/client.ts';
import { BOOT_PLACEHOLDER, startDaemon, type Daemon } from '../src/daemon.ts';

const PUBLIC = 'https://artifacts.example.test';
let daemon: Daemon;
let state: DaemonState;
const shellDir = tempDir('open-artifact-shell-');
const workspace = tempDir('open-artifact-ws-');

before(async () => {
  writeFileSync(join(shellDir, 'index.html'), `<!doctype html><title>shell</title><script>window.__OPEN_ARTIFACT_BOOT__ = ${BOOT_PLACEHOLDER};</script>`);
  daemon = await startDaemon({ port: 0, quiet: true, shellDir, homeDir: join(shellDir, 'no-home'), publicUrl: `${PUBLIC}/` });
  state = (await readDaemon())!;
});

after(() => daemon.close());

/** A request to the daemon's listener as a proxy sends it, with `host`. */
function send(path: string, host: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string }> {
  return new Promise((done, fail) => {
    const req = request(new URL(path, state.url), { method: options.method ?? 'GET', headers: { Host: host, ...options.headers } }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk));
      res.on('end', () => done({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', fail);
    req.end(options.body);
  });
}

test('behind a reverse proxy: view URLs are public, the public Host is let in, and clients still call loopback', async () => {
  assert.equal(new URL(state.url).hostname, '127.0.0.1', 'daemon.json keeps the local URL for the CLI and MCP bridge');
  const made = await api<ToolCallResult>(state, 'tools.call', {
    name: 'Artifact',
    arguments: { action: 'publish', type_url: 'open-artifact://type/design', title: 'Proxied' },
    caller: { harness: 'test', session: 'public-1', workspace },
  });
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  const id = artifactIdOf(String(made.url))!;
  assert.equal(made.view_url, `${PUBLIC}/a/${id}`);

  assert.equal((await send(`/a/${id}`, 'artifacts.example.test')).status, 200);
  assert.equal((await send(`/a/${id}`, 'evil.example.test')).status, 421, 'other names are still refused');

  // A write from the Shell at the public origin is same-origin; one from another origin is not.
  const write = (origin: string) =>
    send('/api/open-artifact.artifacts.update', 'artifacts.example.test', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title: 'Renamed' }),
    });
  assert.equal((await write('https://evil.example.test')).status, 403);
  const renamed = await write(PUBLIC);
  assert.equal(renamed.status, 200, renamed.body);
  assert.match(renamed.body, /"title":"Renamed"/);
});
