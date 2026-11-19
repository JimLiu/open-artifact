import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BOOT_PLACEHOLDER, startDaemon } from '../src/daemon.ts';
import { files } from '../src/paths.ts';
import { loadSettings, saveSettings, validateHostingSettings } from '../src/settings.ts';

const host = Object.values(networkInterfaces()).flat().find(value => value?.family === 'IPv4' && !value.internal)?.address;
const disabled = { publicShellOrigin: null, frameOriginTemplate: null, listenHost: null, port: 4801 };

test('hosting configuration validates concrete listener and an optional isolated origin pair', () => {
  assert.deepEqual(validateHostingSettings({ publicShellOrigin: '', frameOriginTemplate: null }), disabled);
  for (const value of [null, [], {}, { ...disabled, port: 0 }, { ...disabled, listenHost: '0.0.0.0' }, { ...disabled, publicShellOrigin: 'https://shell.example' }]) assert.throws(() => validateHostingSettings(value));
});

test('daemon hosts authenticated shell and static frame, restores URLs, applies settings transactionally, and keeps controls private', { skip: !host }, async () => {
  saveSettings({ hosting: disabled, artifactsDir: 'keep-me' });
  const bind = createServer();
  await new Promise<void>(resolve => bind.listen(0, host!, resolve));
  const port = (bind.address() as { port: number }).port;
  await new Promise<void>(resolve => bind.close(() => resolve()));
  const configured = { publicShellOrigin: 'https://shell.example', frameOriginTemplate: 'https://{artifactId}.frames.example', listenHost: host!, port };
  const shellDir = tempDir('oa-hosted-shell-');
  writeFileSync(join(shellDir, 'index.html'), `<html><script>window.__OPEN_ARTIFACT_BOOT__=${BOOT_PLACEHOLDER}</script></html>`);
  const typeDir = join(process.env.OPEN_ARTIFACT_USER_TYPES!, 'plain');
  mkdirSync(typeDir, { recursive: true });
  writeFileSync(join(typeDir, 'index.html'), '<html>static type</html>');
  const root = tempDir('oa-hosted-artifact-');
  writeFileSync(join(root, 'index.html'), '<html>remote static artifact</html>');
  let daemon = await startDaemon({ port: 0, quiet: true, shellDir, idleMs: 1 });
  const artifact = daemon.store.create({ root, type: 'plain', title: 'Hosted fixture' });
  const call = (path: string, hostname = 'shell.example', headers: Record<string, string> = {}) => new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request({ host: host!, port, path, headers: { host: hostname, ...headers } }, res => { let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body })); }); req.on('error', reject); req.end();
  });
  const post = (value: unknown) => fetch(`${daemon.origin}/api/open-artifact.hosting`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: daemon.origin }, body: JSON.stringify(value) });
  try {
    assert.equal(daemon.viewUrl(artifact.id), `${daemon.origin}/a/${artifact.id}`);
    assert.equal((await (await fetch(`${daemon.origin}/api/open-artifact.hosting`)).json()).remote.enabled, false);
    assert.equal((await post(configured)).status, 200);
    assert.deepEqual(loadSettings().hosting, configured);
    (daemon as unknown as { lastActivity: number; tick(): void }).lastActivity = 0;
    (daemon as unknown as { tick(): void }).tick();
    assert.equal((await fetch(`${daemon.origin}/__open-artifact/health`)).status, 200, 'Hosting disables idle shutdown');
    const privateState = JSON.parse(readFileSync(files.daemon(), 'utf8'));
    assert.equal(privateState.url, daemon.origin);
    const ownerUrl = daemon.viewUrl(artifact.id);
    assert.match(ownerUrl, /^https:\/\/shell\.example\/__hosting\/owner\//);
    assert.equal((await call(`/a/${artifact.id}`)).status, 403);
    const owner = new URL(ownerUrl);
    const login = await call(owner.pathname + owner.search);
    assert.equal(login.status, 303);
    const cookie = login.headers['set-cookie']![0]!.split(';')[0]!;
    const page = await call(`/a/${artifact.id}`, 'shell.example', { cookie });
    assert.equal(page.status, 200);
    assert.ok(!page.body.includes('127.0.0.1') && !page.body.includes(daemon.token));
    const boot = await daemon.shellBoot(artifact);
    assert.match(boot.page!, new RegExp(`^https://${artifact.id.replace('art_', 'art-')}\\.frames\\.example/__hosting/frame/`));
    const frame = new URL(boot.page!);
    const destination = new URL(frame.searchParams.get('next')!, 'https://frame.example');
    assert.ok(destination.searchParams.toString().includes('shell.example'), 'Public shell context survives the bootstrap redirect');
    const auth = await call(frame.pathname + frame.search, frame.host);
    assert.equal(auth.status, 303);
    const frameCookie = auth.headers['set-cookie']![0]!.split(';')[0]!;
    const content = await call('/', frame.host, { cookie: frameCookie });
    assert.equal(content.status, 200);
    assert.match(content.body, /static type/);
    for (const path of ['/mcp', '/__harness', '/__open-artifact/health', '/api/open-artifact.type.register']) assert.notEqual((await call(path, 'shell.example', { cookie })).status, 200);
    const library = await call('/api/open-artifact.artifacts', 'shell.example', { cookie });
    assert.equal(library.status, 200);
    assert.ok(!library.body.includes('127.0.0.1') && !library.body.includes(daemon.token));
    const busy = createServer();
    await new Promise<void>(resolve => busy.listen(0, host!, resolve));
    const busyPort = (busy.address() as { port: number }).port;
    try { assert.equal((await post({ ...configured, port: busyPort })).status, 409); assert.deepEqual(loadSettings().hosting, configured); assert.equal((await call(`/a/${artifact.id}`, 'shell.example', { cookie })).status, 200); }
    finally { await new Promise<void>(resolve => busy.close(() => resolve())); }
    daemon.close();
    await new Promise(resolve => setTimeout(resolve, 30));
    daemon = await startDaemon({ port: 0, quiet: true, shellDir, idleMs: 1 });
    assert.equal(daemon.viewUrl(artifact.id), ownerUrl);
    assert.equal((await call(owner.pathname + owner.search)).status, 303);
    assert.equal((await post(disabled)).status, 200);
    assert.equal(daemon.viewUrl(artifact.id), `${daemon.origin}/a/${artifact.id}`);
    assert.equal(JSON.parse(readFileSync(files.settings(), 'utf8')).artifactsDir, 'keep-me');
  } finally { daemon.close(); }
});
