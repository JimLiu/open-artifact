import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createTypeServer } from '../../type-server/src/index.ts';
import { HostingGateway } from '../src/hosting-gateway.ts';
import { guestShareTarget } from '../src/hosting-shares.ts';

const host = Object.values(networkInterfaces()).flat().find(value => value?.family === 'IPv4' && !value.internal)?.address;
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
