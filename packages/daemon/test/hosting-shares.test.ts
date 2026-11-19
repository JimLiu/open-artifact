import assert from 'node:assert/strict';
import test from 'node:test';
import { guestRequestHeaders, guestShareTarget, publicGuestCookie } from '../src/hosting-shares.ts';

const token = 'abcdefghijklmnopqrstuvwx';
const target = guestShareTarget('art_one', '/tmp/deck', 'http://127.0.0.1:4710/slides/mounted/', `http://192.168.1.4:4710/s/${token}`, ['192.168.1.4']);

test('share mapping requires concrete allowlisted non-loopback interface and same server port', () => {
  for (const upstream of [`http://127.0.0.1:4710/s/${token}`, `http://[::1]:4710/s/${token}`, `http://[::ffff:127.0.0.1]:4710/s/${token}`, `http://example.com:4710/s/${token}`, `http://192.168.1.5:4710/s/${token}`, `http://192.168.1.4:4711/s/${token}`]) {
    assert.throws(() => guestShareTarget('art_one', '/tmp/deck', 'http://127.0.0.1:4710/slides/mounted/', upstream, ['192.168.1.4']));
  }
});

test('proxy forwards exactly artifact guest identity and checks browser Origin before rewrite', () => {
  const headers = guestRequestHeaders(target, { host: 'artifacts.example', cookie: `__Host-oa_owner=OWNER; __Host-oa_frame=FRAME; ${target.cookieName}=GUEST; oa_guest_other=OTHER`, authorization: 'Bearer PRIVATE', origin: 'https://artifacts.example', 'x-forwarded-for': '127.0.0.1', forwarded: 'for=127.0.0.1' }, 'https://artifacts.example');
  assert.equal(headers.cookie, `${target.cookieName}=GUEST`);
  assert.equal(headers.host, '192.168.1.4:4710');
  assert.equal(headers.origin, 'http://192.168.1.4:4710');
  assert.equal(headers.authorization, undefined);
  assert.equal(headers.forwarded, undefined);
  assert.equal(headers['x-forwarded-for'], undefined);
  for (const origin of ['null', 'https://evil.example', 'http://artifacts.example']) assert.throws(() => guestRequestHeaders(target, { origin }, 'https://artifacts.example'));
  assert.equal(guestRequestHeaders(target, { cookie: `${target.cookieName}=a; ${target.cookieName}=b` }, 'https://artifacts.example').cookie, undefined);
});

test('only matching guest response cookie is scoped publicly, never owner credentials', () => {
  assert.equal(publicGuestCookie(target, `${target.cookieName}=${token}; Path=/; HttpOnly`), `${target.cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  assert.equal(publicGuestCookie(target, '__Host-oa_owner=secret; Path=/'), null);
  assert.equal(publicGuestCookie(target, `oa_guest_other=${token}; Path=/`), null);
});
