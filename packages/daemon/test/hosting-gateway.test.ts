import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HostingGateway } from '../src/hosting-gateway.ts';

const host = Object.values(networkInterfaces()).flat().find(value => value?.family === 'IPv4' && !value.internal)?.address;
test('gateway authenticates isolated origins, streams and persists owner links without exposing controls', { skip: !host }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oa-gateway-'));
  const seen: { url?: string; origin?: string; authorization?: string; cookie?: string; host?: string }[] = [];
  const backend = createServer((req, res) => {
    seen.push({ host: req.headers.host, ...(req.url ? { url: req.url } : {}), ...(req.headers.origin ? { origin: req.headers.origin } : {}), ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}), ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}) });
    if (req.url === '/edit/art_one/redirect') { res.writeHead(302, { Location: '/edit/art_one/' }).end(); return; }
    if (req.url === '/edit/art_one/_api/session') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }).end('{"viewer":"owner"}'); return; }
    if (req.url === '/edit/art_one/_api/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: first\n\n'); setTimeout(() => res.end('data: second\n\n'), 10); return; }
    if (req.url === '/edit/art_one/stream') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: first\n\n'); setTimeout(() => res.end('data: second\n\n'), 10); return; }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'daemon-secret=bad' }).end('<html>editor</html>');
  });
  const backendSockets = new Set<import('node:stream').Duplex>();
  backend.on('connection', socket => { backendSockets.add(socket); socket.on('close', () => backendSockets.delete(socket)); });
  backend.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(String(req.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data', data => socket.write(data));
  });
  await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve));
  const upstream = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
  const options = { shellOrigin: 'https://shell.example', frameOrigin: 'https://{id}.frames.example', listenHost: host!, port: 0, stateFile: join(dir, 'key'), shellUpstream: upstream, resolveArtifact: async (id: string) => ({ pageUrl: `${upstream}/edit/${id}/`, contentUrl: `http://${id}.frame.localhost:${new URL(upstream).port}/` }) };
  let gateway = new HostingGateway(options);
  let port = await gateway.start();
  const call = (path: string, hostname = 'shell.example', headers: Record<string, string> = {}, method = 'GET') => new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request({ host: host!, port, path, method, headers: { host: hostname, ...headers } }, res => { let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body })); });
    req.on('error', reject); req.end();
  });
  try {
    assert.equal((await call('/')).status, 403);
    assert.equal((await call('/', 'evil.example')).status, 421);
    const ownerUrl = gateway.ownerUrl('/a/art_one');
    const owner = new URL(ownerUrl);
    const auth = await call(owner.pathname + owner.search);
    assert.equal(auth.status, 303);
    const ownerCookie = auth.headers['set-cookie']![0]!;
    assert.match(ownerCookie, /^__Host-oa_owner=.*; Path=\/; Secure; HttpOnly; SameSite=Strict/);
    assert.doesNotMatch(ownerCookie, /Domain=/);
    const cookie = ownerCookie.split(';')[0]!;
    assert.equal((await call('/a/art_one', 'shell.example', { cookie })).status, 200);
    for (const path of ['/__hub', '/__harness', '/mcp', '/__open-artifact/health', '/api/open-artifact.type.register', '/%5f%5fhub', '/%252e%252e/mcp']) assert.notEqual((await call(path, 'shell.example', { cookie })).status, 200, path);
    for (const origin of ['https://evil.example', 'null']) assert.equal((await call('/api/open-artifact.update', 'shell.example', { cookie, origin }, 'POST')).status, 403);
    const frame = new URL(gateway.frameUrl('art_one', '/edit/art_one/'));
    assert.equal((await call(frame.pathname + frame.search, 'art-one.frames.example', { origin: 'https://shell.example' })).status, 403);
    const frameAuth = await call(frame.pathname + frame.search, 'art-one.frames.example');
    assert.equal(frameAuth.status, 303);
    assert.equal((await call(frame.pathname + frame.search, 'art-one.frames.example')).status, 403, 'bootstrap is single-use');
    assert.equal(frameAuth.headers.location, '/edit/art_one/');
    assert.match(frameAuth.headers['set-cookie']![0]!, /; Secure; HttpOnly; SameSite=None;/);
    const frameCookie = frameAuth.headers['set-cookie']![0]!.split(';')[0]!;
    assert.equal(gateway.contentOrigin('art_one'), 'https://content-art-one.frames.example');
    assert.throws(() => gateway.contentUrl('art_one', '/_api/session'), /destination/);
    assert.throws(() => gateway.contentOrigin('content-art_one'), /id/);
    const content = new URL(gateway.contentUrl('art_one', '/_f/version/index.html'));
    const contentHost = 'content-art-one.frames.example';
    assert.equal((await call(content.pathname + content.search, 'art-one.frames.example')).status, 403, 'content bootstrap cannot mint frame capability');
    assert.equal((await call(content.pathname + content.search, contentHost, { origin: 'https://shell.example' })).status, 403);
    const contentAuth = await call(content.pathname + content.search, contentHost);
    assert.equal(contentAuth.status, 303);
    assert.equal(contentAuth.headers.location, '/_f/version/index.html');
    assert.match(contentAuth.headers['set-cookie']![0]!, /^__Host-oa_content=.*; Path=\/; Secure; HttpOnly; SameSite=None;/);
    assert.doesNotMatch(contentAuth.headers['set-cookie']![0]!, /Domain=/);
    const contentCookie = contentAuth.headers['set-cookie']![0]!.split(';')[0]!;
    assert.equal((await call(content.pathname + content.search, contentHost)).status, 303, 'cached content sessions require reusable read-only artifact bootstrap');
    assert.equal(new URL(gateway.contentBootstrapUrl('art_one')).search, '');
    assert.equal((await call('/_f/version/index.html', contentHost, { cookie: frameCookie })).status, 403);
    assert.equal((await call('/edit/art_one/_api/session', 'art-one.frames.example', { cookie: contentCookie })).status, 403);
    assert.equal((await call('/_f/version/index.html', 'content-art-two.frames.example', { cookie: contentCookie })).status, 403);
    for (const path of ['/', '/_f/version/index.html', '/_runtime/open-artifact-frame.js', '/_blob/' + 'a'.repeat(32)]) {
      const response = await call(path, contentHost, { cookie: contentCookie });
      assert.equal(response.status, 200, path);
      assert.equal(response.headers['access-control-allow-origin'], undefined);
      assert.equal(seen.at(-1)?.host, `art_one.frame.localhost:${new URL(upstream).port}`);
      assert.equal(seen.at(-1)?.cookie, undefined);
    }
    for (const path of ['/_api/session', '/_f/version/_api/session', '/edit/art_one/_api/session', '/__hub', '/api/open-artifact.update', '/_runtime/shell.js', '/_blob/nope']) {
      assert.equal((await call(path, contentHost, { cookie: contentCookie })).status, 403, path);
    }
    assert.equal((await call('/_f/version/', contentHost, { cookie: contentCookie, origin: 'https://art-one.frames.example' }, 'POST')).status, 403);
    assert.equal((await call('/_f/version/', contentHost, { cookie: contentCookie, origin: 'https://shell.example', 'access-control-request-method': 'POST' }, 'OPTIONS')).status, 403);
    assert.equal((await call('/_f/version/', contentHost, { cookie: contentCookie, origin: gateway.contentOrigin('art_one') }, 'POST')).status, 403);
    const shellOrigin = 'https://shell.example';
    const brokerHeaders = { cookie: frameCookie, origin: shellOrigin };
    const preflight = await call('/edit/art_one/_api/publish', 'art-one.frames.example', { origin: shellOrigin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' }, 'OPTIONS');
    assert.equal(preflight.status, 204, 'browser preflights do not carry cookies');
    assert.equal(preflight.headers['access-control-allow-origin'], shellOrigin);
    assert.equal(preflight.headers['access-control-allow-credentials'], 'true');
    assert.equal((await call('/edit/art_one/_api/session', 'art-one.frames.example', { origin: shellOrigin })).status, 403, 'actual broker calls still require frame capability cookie');
    const session = await call('/edit/art_one/_api/session', 'art-one.frames.example', brokerHeaders);
    assert.equal(session.status, 200);
    assert.equal(session.headers['access-control-allow-origin'], shellOrigin);
    assert.equal(session.headers['access-control-allow-credentials'], 'true');
    assert.equal(session.headers['access-control-allow-headers'], undefined, 'upstream CORS policy is not exposed');
    const brokerWrite = await call('/edit/art_one/_api/publish', 'art-one.frames.example', { ...brokerHeaders, 'content-type': 'application/json' }, 'POST');
    assert.equal(brokerWrite.status, 200);
    assert.equal(seen.at(-1)?.origin, upstream);
    assert.equal(seen.at(-1)?.cookie, undefined);
    assert.equal((await call('/edit/art_one/_api/events', 'art-one.frames.example', brokerHeaders)).body, 'data: first\n\ndata: second\n\n');
    for (const path of ['/edit/art_one/', '/edit/art_two/_api/session', '/__hub', '/api/open-artifact.update']) assert.equal((await call(path, 'art-one.frames.example', brokerHeaders)).status, 403, path);
    for (const origin of ['https://evil.example', 'https://art-two.frames.example', 'null']) assert.equal((await call('/edit/art_one/_api/session', 'art-one.frames.example', { cookie: frameCookie, origin })).status, 403);
    assert.equal((await call('/api/open-artifact.update', 'shell.example', { cookie, origin: 'https://art-one.frames.example' }, 'POST')).status, 403, 'frame origin cannot call owner shell API');
    for (const headers of [{ 'access-control-request-method': 'DELETE' }, { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' }] as Record<string, string>[]) assert.equal((await call('/edit/art_one/_api/publish', 'art-one.frames.example', { origin: shellOrigin, ...headers }, 'OPTIONS')).status, 403);
    assert.equal((await call('/edit/art_two/_api/publish', 'art-one.frames.example', { origin: shellOrigin, 'access-control-request-method': 'POST' }, 'OPTIONS')).status, 403);
    assert.equal((await call('/edit/art_one/', 'art-one.frames.example', { cookie: frameCookie })).status, 200);
    assert.equal((await call('/edit/art_one/', 'art-two.frames.example', { cookie: frameCookie })).status, 403);
    assert.equal((await call('/edit/art_two/', 'art-one.frames.example', { cookie: frameCookie })).status, 403);
    const write = await call('/edit/art_one/save', 'art-one.frames.example', { cookie: frameCookie, origin: 'https://art-one.frames.example', authorization: 'Bearer public-secret', 'x-forwarded-host': 'evil.example' }, 'POST');
    assert.equal(write.status, 200);
    assert.equal(seen.at(-1)?.authorization, undefined);
    assert.equal(seen.at(-1)?.cookie, undefined);
    assert.equal(seen.at(-1)?.origin, upstream);
    assert.equal(write.headers['set-cookie'], undefined);
    assert.equal((await call('/edit/art_one/stream', 'art-one.frames.example', { cookie: frameCookie })).body, 'data: first\n\ndata: second\n\n');
    assert.equal((await call('/edit/art_one/redirect', 'art-one.frames.example', { cookie: frameCookie })).headers.location, 'https://art-one.frames.example/edit/art_one/');
    const ws = (origin: string, path = '/edit/art_one/ws', hostname = 'art-one.frames.example', capability = frameCookie) => new Promise<string>((resolve, reject) => {
      const socket = connect(port, host!);
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('Upgrade timed out')); }, 2000);
      socket.on('error', reject);
      socket.on('connect', () => socket.write(`GET ${path} HTTP/1.1\r\nHost: ${hostname}\r\nCookie: ${capability}\r\nOrigin: ${origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`));
      socket.once('data', data => { clearTimeout(timer); socket.destroy(); resolve(data.toString()); });
    });
    assert.match(await ws('https://content-art-one.frames.example', '/_f/version/socket', contentHost, contentCookie), /^HTTP\/1.1 403/, 'content origin cannot open API WebSockets');
    assert.match(await ws('https://art-one.frames.example'), /^HTTP\/1.1 101/);
    assert.match(await ws('https://shell.example', '/edit/art_one/_api/events'), /^HTTP\/1.1 101/);
    assert.match(await ws('https://shell.example'), /^HTTP\/1.1 403/);
    assert.match(await ws('null'), /^HTTP\/1.1 403/);
    assert.match(await ws('https://evil.example'), /^HTTP\/1.1 403/);
    assert.match(await ws('https://art-one.frames.example', '/__hub'), /^HTTP\/1.1 403/);
    await gateway.close();
    gateway = new HostingGateway(options); port = await gateway.start();
    assert.equal(gateway.ownerUrl('/a/art_one'), ownerUrl);
    assert.equal((await call('/a/art_one', 'shell.example', { cookie })).status, 200);
  } finally {
    await gateway.close();
    for (const socket of backendSockets) socket.destroy();
    backend.closeAllConnections(); await new Promise<void>(resolve => backend.close(() => resolve()));
    assert.ok(dir.startsWith(join(tmpdir(), 'oa-gateway-'))); rmSync(dir, { recursive: true, force: true });
  }
});

test('gateway rejects loopback listener and invalid public origins', () => {
  const options = { shellOrigin: 'https://shell.example', frameOrigin: 'https://{id}.frames.example', listenHost: '127.0.0.1', port: 0, stateFile: '/unused', shellUpstream: 'http://127.0.0.1:1234', resolveArtifact: async () => null };
  assert.throws(() => new HostingGateway(options), /non-loopback/);
  assert.throws(() => new HostingGateway({ ...options, shellOrigin: 'http://shell.example' }), /HTTPS/);
  assert.throws(() => new HostingGateway({ ...options, frameOrigin: 'https://frames.example' }), /isolated/);
});
