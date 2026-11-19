import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createTypeServer } from '../../type-server/src/index.ts';
import { BOOT_PLACEHOLDER, startDaemon } from '../src/daemon.ts';
import { HostingGateway } from '../src/hosting-gateway.ts';
import { guestShareTarget } from '../src/hosting-shares.ts';
import { loadSettings, saveSettings, validateHostingSettings } from '../src/settings.ts';

const host = Object.values(networkInterfaces()).flat().find(value => value?.family === 'IPv4' && !value.internal)?.address;
test('nested native Motion invite paths stay public and reach only their own guest listener', { skip: !host }, async () => {
  const pagePath = '/motion/native-page/';
  const token = 'motion-viewer-token-1234';
  const joinPath = `${pagePath}s/${token}`;
  const backend = createServer((req, res) => res.end(req.url));
  await new Promise<void>(resolve => backend.listen(0, host!, resolve));
  const upstream = `http://${host}:${(backend.address() as { port: number }).port}`;
  let gateway: HostingGateway | undefined;
  try {
    const guest = guestShareTarget('art_motion', '/motion-root', `${upstream}${pagePath}`, `${upstream}${joinPath}`, [host!]);
    assert.equal(guest.cookieName, `motion_guest_${createHash('sha256').update('/motion-root').digest('hex').slice(0, 12)}`);
    gateway = new HostingGateway({ shellOrigin: 'https://shell.example', frameOrigin: 'https://{id}.frames.example', listenHost: host!, port: 0,
      stateFile: join(tempDir('oa-motion-share-'), 'key'), shellUpstream: 'http://127.0.0.1:4800',
      resolveArtifact: async () => null, resolveGuest: async () => guest });
    const port = await gateway.start();
    const invite = new URL(gateway.guestUrl('art_motion', token));
    const call = (path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ host, port, path, headers: { host: invite.host } }, res => {
        let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode!, body }));
      }); req.on('error', reject); req.end();
    });
    assert.deepEqual(await call(invite.pathname), { status: 200, body: joinPath });
    assert.equal((await call('/motion/another-page/s/' + token)).status, 403);
    assert.equal((await call('/__open-artifact/share')).status, 403);
    for (const path of ['/motion/another-page/s/' + token, pagePath + 'private/s/' + token, pagePath + 'o/' + token]) {
      assert.throws(() => guestShareTarget('art_motion', '/motion-root', `${upstream}${pagePath}`, upstream + path, [host!]));
    }
  } finally { await gateway?.close(); await new Promise<void>(resolve => backend.close(() => resolve())); }
});
test('real hosted owner, isolated frame and native guest roles survive only their intended boundaries', { skip: !host }, async () => {
  const dir = tempDir('oa-hosting-');
  const assets = join(dir, 'assets');
  mkdirSync(join(assets, 'editors/whiteboard'), { recursive: true });
  writeFileSync(join(assets, 'editors/whiteboard/index.html'), '<html>Native editor</html>');
  writeFileSync(join(dir, 'index.html'), `<script>window.__OPEN_ARTIFACT_BOOT__=${BOOT_PLACEHOLDER}</script>`);
  const disabled = { publicShellOrigin: null, frameOriginTemplate: null, listenHost: null, port: 4801 };
  saveSettings({ hosting: disabled, artifactsDir: 'preserved' });
  assert.equal(loadSettings().artifactsDir, 'preserved');
  for (const change of [{ port: 0 }, { listenHost: '0.0.0.0' }, { publicShellOrigin: 'https://shell.example' }]) {
    assert.throws(() => validateHostingSettings({ ...disabled, ...change }));
  }
  const daemon = await startDaemon({ port: 0, quiet: true, shellDir: dir });
  const native = createTypeServer({ assetsDir: assets, secret: 'PRIVATE', idleMs: 0, lanAddresses: () => [host!] });
  await native.listen();
  const root = join(dir, 'board');
  const opened = await native.open({ root, type: 'whiteboard', title: 'Hosted roles' });
  const page = new URL(opened.url).pathname;
  const share = async (change: object) => {
    const response = await fetch(new URL('/__open-artifact/share', opened.url), {
      method: 'POST', headers: { authorization: 'Bearer PRIVATE', 'content-type': 'application/json' }, body: JSON.stringify({ id: opened.id, ...change }),
    });
    assert.equal(response.status, 200);
    return await response.json() as { links: Record<string, { url: string }> };
  };
  let view = await share({ lan: true });
  const options = {
    shellOrigin: 'https://shell.example', frameOrigin: 'https://{id}.frames.example', listenHost: host!, port: 0,
    stateFile: join(dir, 'key'), shellUpstream: daemon.origin,
    resolveArtifact: async () => ({ pageUrl: opened.url }),
    resolveGuest: async (id: string) => guestShareTarget(id, root, opened.url, view.links.viewer!.url, [host!]),
  };
  let gateway = new HostingGateway(options);
  let port = await gateway.start();
  const call = (path: string, hostname = 'shell.example', cookie = '', body?: string, origin?: string) => new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request({ host, port, path, method: body === undefined ? 'GET' : 'POST', headers: {
      host: hostname, cookie, ...(origin ? { origin } : {}), 'content-type': path.startsWith('/s/') ? 'application/x-www-form-urlencoded' : 'application/json',
    } }, res => {
      let text = '';
      res.on('data', chunk => text += chunk);
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: text }));
    });
    req.on('error', reject); req.end(body);
  });
  const cookieOf = (response: { headers: IncomingHttpHeaders }) => response.headers['set-cookie']![0]!.split(';')[0]!;
  try {
    assert.equal((await call('/')).status, 403);
    const ownerUrl = gateway.ownerUrl();
    const owner = new URL(ownerUrl);
    const login = await call(owner.pathname + owner.search);
    assert.equal(login.status, 303);
    assert.match(login.headers['set-cookie']![0]!, /Secure; HttpOnly; SameSite=Strict/);
    const ownerCookie = cookieOf(login);
    assert.equal((await call('/api/open-artifact.artifacts', undefined, ownerCookie)).status, 200);
    for (const path of ['/__hub', '/__harness', '/mcp', '/__open-artifact/health', '/api/open-artifact.type.register']) {
      assert.equal((await call(path, undefined, ownerCookie)).status, 403, path);
    }
    for (const origin of ['https://evil.example', 'https://shell.example.evil', 'null']) {
      assert.equal((await call('/api/open-artifact.update', undefined, ownerCookie, '{}', origin)).status, 403);
    }
    const frame = new URL(gateway.frameUrl('art_one', page));
    const frameCookie = cookieOf(await call(frame.pathname + frame.search, frame.host));
    assert.equal((await call(frame.pathname + frame.search, frame.host)).status, 403, 'frame ticket is single-use');
    assert.equal((await call(page, frame.host, frameCookie)).status, 200);
    assert.equal((await call(page, 'art-two.frames.example', frameCookie)).status, 403);
    assert.equal((await call('/', undefined, frameCookie)).status, 403);
    const guestHost = 'guest-art-one.frames.example';
    for (const role of ['viewer', 'commenter', 'editor']) {
      const tokenPath = new URL(view.links[role]!.url).pathname;
      const joined = await call(tokenPath, guestHost, ownerCookie, `name=${role}`, `https://${guestHost}`);
      assert.equal(joined.status, 303);
      const cookie = cookieOf(joined);
      assert.equal(JSON.parse((await call(page + '_api/session', guestHost, cookie)).body).viewer.role, role);
      const write = JSON.stringify({ client: role, writes: [{ op: 'set', path: `elements/${role}`, data: { type: 'note', x: 0, y: 0, text: role, color: 'yellow' } }] });
      assert.equal((await call(page + '_api/db/write', guestHost, cookie, write, `https://${guestHost}`)).status, role === 'editor' ? 200 : 403);
      const comment = JSON.stringify({ input: { anchor: '{}', label: 'Note', text: role } });
      assert.equal((await call(page + '_api/comments/create', guestHost, cookie, comment, `https://${guestHost}`)).status, role === 'viewer' ? 403 : 200);
      assert.equal((await call(page + '_api/agent/send', guestHost, cookie, '{}', `https://${guestHost}`)).status, 403);
      for (const origin of ['https://evil.example', 'null']) assert.equal((await call(page + '_api/db/write', guestHost, cookie, write, origin)).status, 403);
      view = await share({ reset: [role] });
      assert.equal((await call(page + '_api/session', guestHost, cookie)).status, 403);
    }
    await share({ lan: false });
    assert.notEqual((await call(new URL(view.links.viewer!.url).pathname, guestHost)).status, 200);
    await gateway.close();
    gateway = new HostingGateway(options); port = await gateway.start();
    assert.equal(gateway.ownerUrl(), ownerUrl);
    assert.equal((await call('/api/open-artifact.artifacts', undefined, ownerCookie)).status, 200);
  } finally { await gateway.close(); await native.stop(); daemon.close(); }
});
