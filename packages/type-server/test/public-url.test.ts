/**
 * Serving behind a reverse proxy: pages are addressed at the server's public origin, requests for that host are let in,
 * and `cli serve` resolves the origin with `OPEN_ARTIFACT_PUBLIC_URL_COMMAND` before it prints its ready line.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { after, before, describe, it } from 'node:test';
import { publicOriginOf } from '@open-artifact/protocol';
import { createTypeServer, type TypeServer } from '../src/index.ts';

const PUBLIC = 'https://types.example.test';

/** A GET to the server's listener as a proxy sends it: with the public Host. Resolves with the status. */
function get(base: string, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((done, fail) => {
    const req = request(new URL(path, base), { headers }, (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.on('error', fail);
    req.end();
  });
}

/** A WebSocket upgrade of the page's event stream; resolves with the status of the answer. */
function upgrade(base: string, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((done, fail) => {
    const req = request(new URL(path, base), {
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      done(res.statusCode ?? 0);
    });
    req.on('response', (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.on('error', fail);
    req.end();
  });
}

describe('public origin', () => {
  let dir: string;
  let assets: string;
  let server: TypeServer;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-public-'));
    assets = join(dir, 'assets');
    await mkdir(join(assets, 'editors', 'design'), { recursive: true });
    await writeFile(join(assets, 'editors', 'design', 'index.html'), '<!doctype html><title>Design</title>');
    await mkdir(join(assets, 'shell'), { recursive: true });
    await writeFile(join(assets, 'shell/index.html'), '<script>window.boot = /*__OPEN_ARTIFACT_BOOT__*/null;</script>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    server = createTypeServer({ assetsDir: assets, secret: 'test-secret', idleMs: 0, downloadsDir: join(dir, 'downloads') });
    await server.listen();
    server.setPublicUrl(`${PUBLIC}/`);
  });

  after(async () => {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('addresses pages at the public origin and lets its Host in, and no other', async () => {
    const opened = await server.open({ root: join(dir, 'Board'), type: 'design', title: 'Board', shell: 'https://shell.example.test' });
    const page = new URL(opened.url);
    assert.equal(page.origin, PUBLIC);
    assert.match(page.pathname, /^\/design\/[^/]+\/$/);
    assert.equal(page.searchParams.get('open_artifact_shell'), 'https://shell.example.test');
    assert.equal(new URL(opened.pageUrl).origin, PUBLIC);
    assert.equal(new URL(server.url).hostname, '127.0.0.1', 'the listener itself stays local');

    assert.equal(await get(server.url, page.pathname, { Host: 'types.example.test' }), 200);
    assert.equal(await get(server.url, page.pathname, {}), 200, 'loopback names still work');
    assert.equal(await get(server.url, page.pathname, { Host: 'evil.example.test' }), 403);
    const events = `${page.pathname}_api/events`;
    assert.equal(await upgrade(server.url, events, { Host: 'types.example.test', Origin: PUBLIC }), 101);
    assert.equal(await upgrade(server.url, events, { Host: 'evil.example.test', Origin: 'https://evil.example.test' }), 403);
  });

  it('takes only an origin', () => {
    assert.equal(publicOriginOf(' https://a.example.test:8443/ '), 'https://a.example.test:8443');
    assert.throws(() => publicOriginOf('https://a.example.test/base'), /no path/);
    assert.throws(() => publicOriginOf('ftp://a.example.test'), /http or https/);
    assert.throws(() => publicOriginOf('a.example.test'), /not a URL/);
  });

  it('cli serve resolves the public origin with the command, for the port it listens on', async () => {
    const cli = resolve(import.meta.dirname, '../src/cli.ts');
    const child = spawn(process.execPath, [cli, 'serve', '--type', 'design', '--assets', assets, '--idle', '0'], {
      env: {
        ...process.env,
        OPEN_ARTIFACT_SECRET: 'cli-secret',
        OPEN_ARTIFACT_PUBLIC_URL_COMMAND: 'echo "https://p$OPEN_ARTIFACT_LISTEN_PORT.example.test"',
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      const line = await new Promise<string>((done) => createInterface({ input: child.stdout! }).once('line', done));
      const ready = JSON.parse(line) as { url: string };
      const port = new URL(ready.url).port;
      assert.equal(new URL(ready.url).hostname, '127.0.0.1', 'the daemon calls the local URL');
      const opened = await fetch(new URL('__open-artifact/open', ready.url), {
        method: 'POST',
        headers: { Authorization: 'Bearer cli-secret', 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'art_cli', root: join(dir, 'Cli'), title: 'Cli', lang: 'en', shell: 'https://shell.example.test' }),
      });
      assert.equal(opened.status, 200, await opened.clone().text());
      assert.equal(new URL(((await opened.json()) as { url: string }).url).origin, `https://p${port}.example.test`);
    } finally {
      child.kill();
    }
  });

  it('cli serve exits when the command gives no origin', async () => {
    const cli = resolve(import.meta.dirname, '../src/cli.ts');
    const child = spawn(process.execPath, [cli, 'serve', '--type', 'design', '--assets', assets, '--idle', '0'], {
      env: { ...process.env, OPEN_ARTIFACT_PUBLIC_URL_COMMAND: 'echo /not-an-origin' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stderr!.on('data', (chunk: Buffer) => (err += chunk));
    const code = await new Promise<number | null>((done) => child.once('exit', done));
    assert.equal(code, 1);
    assert.match(err, /OPEN_ARTIFACT_PUBLIC_URL_COMMAND gave no public origin/);
  });
});
