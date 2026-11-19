import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createTypeServer } from '../../type-server/src/index.ts';
import { HostingGateway } from '../src/hosting-gateway.ts';
import { guestShareTarget } from '../src/hosting-shares.ts';

const host = Object.values(networkInterfaces()).flat().find(value => value?.family === 'IPv4' && !value.internal)?.address;

test('guest Shell assets proxy only GET and HEAD, without exposing Shell APIs or other hosts', { skip: !host }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oa-guest-assets-'));
  const forwarded: string[] = [];
  const upstream = createServer((req, res) => {
    forwarded.push(`${req.method} ${req.url}`);
    if (req.url === '/a/guest/') {
      const body = `<script>window.__OPEN_ARTIFACT_BOOT__=${JSON.stringify({ page: `${upstreamUrl}/a/guest/editor/`, external: 'https://untrusted.example/editor/' })}</script>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    if (req.url === '/a/guest/_api/session') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ page: `${upstreamUrl}/a/guest/editor/` }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end('/* guest Shell asset */');
  });
  await new Promise<void>(resolve => upstream.listen(0, host!, resolve));
  const upstreamUrl = `http://${host}:${(upstream.address() as { port: number }).port}`;
  const gateway = new HostingGateway({
    shellOrigin: 'https://shell.example', frameOrigin: 'https://{id}.frames.example',
    listenHost: host!, port: 0, stateFile: join(dir, 'key'), shellUpstream: 'http://127.0.0.1:1',
    resolveArtifact: async () => null,
    resolveGuest: async id => id === 'art_one' ? { id, upstream: upstreamUrl, pagePath: '/a/guest/', cookieName: 'guest', token: 'guest-token-for-test' } : null,
  });
  const port = await gateway.start();
  const call = (method: string, path: string, hostname = 'guest-art-one.frames.example', upgrade = false) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host, port, path, method, headers: { host: hostname, origin: `https://${hostname}`, ...(upgrade ? { connection: 'Upgrade', upgrade: 'websocket' } : {}) } }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.on('error', reject);
    req.end();
  });
  try {
    const asset = '/_open-artifact/shell/assets/index-abc123.js';
    assert.deepEqual(await call('GET', asset), { status: 200, body: '/* guest Shell asset */' });
    assert.deepEqual(await call('HEAD', asset), { status: 200, body: '' });
    for (const method of ['POST', 'OPTIONS']) assert.equal((await call(method, asset)).status, 403);
    assert.equal((await call('GET', asset, undefined, true)).status, 403);
    for (const path of ['/_open-artifact/shell/api/session', '/api/open-artifact.artifacts', '/__open-artifact/share']) assert.equal((await call('GET', path)).status, 403);
    assert.equal((await call('GET', '/_open-artifact/shell/assets/%2e%2e/api/session')).status, 400);
    assert.equal((await call('GET', asset, 'art-one.frames.example')).status, 403);
    assert.equal((await call('GET', asset, 'shell.example')).status, 403);
    const page = await call('GET', '/a/guest/');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('https://guest-art-one.frames.example/a/guest/editor/'), 'Shell boot uses the public guest origin');
    assert.ok(!page.body.includes(upstreamUrl), 'Shell boot does not expose the backend origin');
    assert.ok(page.body.includes('https://untrusted.example/editor/'), 'Unrelated external origins are not rewritten');
    const session = await call('GET', '/a/guest/_api/session');
    assert.equal(session.status, 200);
    assert.equal(JSON.parse(session.body).page, `${upstreamUrl}/a/guest/editor/`, 'Non-HTML response bytes are unchanged');
    assert.equal((await call('HEAD', '/a/guest/')).status, 200);
    assert.deepEqual(forwarded, [`GET ${asset}`, `HEAD ${asset}`, 'GET /a/guest/', 'GET /a/guest/_api/session', 'HEAD /a/guest/']);
  } finally {
    await gateway.close();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
test('public guests join real native server with viewer/commenter/editor roles, never owner', { skip: !host }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oa-public-guests-'));
  const assets = join(dir, 'assets');
  await mkdir(join(assets, 'editors/whiteboard'), { recursive: true });
  await writeFile(join(assets, 'editors/whiteboard/index.html'), '<html><head></head><body>Guest editor</body></html>');
  const root = join(dir, 'board');
  const server = createTypeServer({ assetsDir: assets, secret: 'PRIVATE', idleMs: 0, lanAddresses: () => [host!] });
  await server.listen();
  const opened = await server.open({ root, type: 'whiteboard', title: 'Guest roles' });
  const share = async (change?: object) => {
    const response = await fetch(new URL('/__open-artifact/share' + (change ? '' : `?id=${opened.id}`), opened.url), { method: change ? 'POST' : 'GET', headers: { authorization: 'Bearer PRIVATE', 'content-type': 'application/json' }, ...(change ? { body: JSON.stringify({ id: opened.id, ...change }) } : {}) });
    assert.equal(response.status, 200);
    return await response.json() as { links: Record<string, { url: string }> };
  };
  let view = await share({ lan: true });
  const gateway = new HostingGateway({ shellOrigin: 'https://shell.example', frameOrigin: 'https://{id}.frames.example', listenHost: host!, port: 0, stateFile: join(dir, 'key'), shellUpstream: opened.url, resolveArtifact: async () => null, resolveGuest: async id => id === 'art_one' ? guestShareTarget(id, root, opened.url, view.links.viewer!.url, [host!]) : null });
  const port = await gateway.start();
  const external = 'guest-art-one.frames.example';
  const call = (path: string, cookie = '', body?: object | string, origin = `https://${external}`) => new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request({ host, port, path, method: body === undefined ? 'GET' : 'POST', headers: { host: external, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { origin, 'content-type': typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json' } : {}) } }, res => { let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: text })); });
    req.on('error', reject); req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
  try {
    const page = new URL(opened.url).pathname;
    assert.equal((await call(page)).status, 403);
    for (const role of ['viewer', 'commenter', 'editor']) {
      const token = new URL(view.links[role]!.url).pathname.split('/').at(-1)!;
      assert.equal(gateway.guestUrl('art_one', token), `https://${external}/s/${token}`);
      assert.match((await call(`/s/${token}`)).body, /<form method="post">/);
      const joined = await call(`/s/${token}`, '__Host-oa_owner=OWNER; __Host-oa_frame=FRAME', `name=${role}`);
      assert.equal(joined.status, 303, joined.body);
      assert.equal(joined.headers.location, `https://${external}${page}`);
      assert.match(joined.headers['set-cookie']![0]!, /; Path=\/; Secure; HttpOnly; SameSite=Lax/);
      const cookie = joined.headers['set-cookie']![0]!.split(';')[0]!;
      const session = await call(page + '_api/session', cookie);
      assert.equal(session.status, 200);
      assert.equal(JSON.parse(session.body).viewer.role, role);
      const write = await call(page + '_api/db/write', cookie, { client: role, writes: [{ op: 'set', path: `elements/${role}`, data: { type: 'note', x: 0, y: 0, text: role, color: 'yellow' } }] });
      assert.equal(write.status, role === 'editor' ? 200 : 403, write.body);
      const comment = await call(page + '_api/comments/create', cookie, { input: { anchor: '{}', label: 'Note', text: role } });
      assert.equal(comment.status, role === 'viewer' ? 403 : 200, comment.body);
      assert.equal((await call(page + '_api/agent/send', cookie, { request: { text: 'hi' } })).status, 403);
      assert.equal((await call(page + '_api/db/write', cookie, {}, 'https://evil.example')).status, 403);
      view = await share({ reset: [role] });
      assert.equal((await call(page + '_api/session', cookie)).status, 403);
    }
    for (const path of ['/__open-artifact/share', '/__hub', '/api/open-artifact.list', '/__hosting/frame/forged']) assert.equal((await call(path)).status, 403);
    await share({ lan: false });
    assert.notEqual((await call(`/s/${new URL(view.links.viewer!.url).pathname.split('/').at(-1)}`)).status, 200);
  } finally {
    await gateway.close();
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
