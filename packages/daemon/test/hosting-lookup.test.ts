import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import test from 'node:test';
import { HostingGateway } from '../src/hosting-gateway.ts';

const host = Object.values(networkInterfaces()).flat().find(value => value?.family === 'IPv4' && !value.internal)?.address;
test('gateway connects virtual localhost HTTP and WebSocket targets over IPv4 preserving Host', { skip: !host }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oa-hosting-lookup-'));
  const sockets = new Set<Duplex>();
  const seen: (string | undefined)[] = [];
  const backend = createServer((req, res) => { seen.push(req.headers.host); res.end('virtual target'); });
  backend.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  backend.on('upgrade', (req, socket) => {
    seen.push(req.headers.host);
    const accept = createHash('sha1').update(String(req.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve));
  const targetHost = `art_lookup.frame.localhost:${(backend.address() as { port: number }).port}`;
  const gateway = new HostingGateway({
    shellOrigin: 'https://shell.example', frameOrigin: 'https://{id}.frames.example', listenHost: host!, port: 0,
    stateFile: join(dir, 'key'), shellUpstream: `http://${targetHost}`,
    resolveArtifact: async () => ({ pageUrl: `http://${targetHost}/edit/art_lookup/` })
  });
  const port = await gateway.start();
  const call = (path: string, publicHost: string, cookie?: string) => new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request({ hostname: host!, port, path, headers: { host: publicHost, ...(cookie ? { cookie } : {}) } }, res => {
      let body = '';
      res.setEncoding('utf8'); res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject); req.end();
  });
  try {
    const owner = new URL(gateway.ownerUrl());
    const ownerAuth = await call(owner.pathname + owner.search, 'shell.example');
    const ownerCookie = ownerAuth.headers['set-cookie']![0]!.split(';')[0]!;
    const shell = await call('/', 'shell.example', ownerCookie);
    assert.equal(shell.status, 200); assert.equal(shell.body, 'virtual target');
    const frame = new URL(gateway.frameUrl('art_lookup', '/edit/art_lookup/'));
    const frameAuth = await call(frame.pathname + frame.search, frame.host);
    const frameCookie = frameAuth.headers['set-cookie']![0]!.split(';')[0]!;
    const response = await call('/edit/art_lookup/', frame.host, frameCookie);
    assert.equal(response.status, 200); assert.equal(response.body, 'virtual target');
    await new Promise<void>((resolve, reject) => {
      const req = request({ hostname: host!, port, path: '/edit/art_lookup/stream', headers: { host: frame.host, cookie: frameCookie, origin: frame.origin, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' } });
      req.setTimeout(3000, () => req.destroy(new Error('WebSocket upgrade timed out')));
      req.on('upgrade', (res, socket) => { assert.equal(res.statusCode, 101); socket.destroy(); resolve(); });
      req.on('response', res => { res.resume(); reject(new Error(`Expected WebSocket upgrade, got ${res.statusCode}`)); });
      req.on('error', reject); req.end();
    });
    assert.deepEqual(seen, [targetHost, targetHost, targetHost]);
  } finally {
    await gateway.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => backend.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
