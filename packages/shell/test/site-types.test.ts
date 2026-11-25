/**
 * The cloud home page and the types published to its site: the type page's boot read defensively, the Types tab's
 * switch (`cloud.siteTypes`) and `/#types`, and the host's type routes as the page calls them.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { homeBootOf } from '../src/lib/cloud.ts';
import { createSiteTypesApi, siteTypeDetailOf, typePageHref } from '../src/lib/site-types.ts';

const cloud = { user: { id: 'u1', name: 'Ada' }, appOrigin: 'https://oa.example', signInUrl: '/auth/sign-in', signOutUrl: '/auth/sign-out' };
const detail = {
  id: 'poll-kit',
  uid: 'uid-poll',
  name: '</script><b>Poll</b>',
  version: '1.0.0',
  description: 'Polls',
  visibility: 'link',
  publisher: { id: 'u2', name: 'Bo' },
  mine: false,
  unpublished: false,
  sha256: 'a'.repeat(64),
  bytes: 9,
  capabilities: ['db', 7],
  network: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  skill: '# Poll',
  manages: false,
  pageUrl: 'https://oa.example/t/poll-kit',
  packageUrl: 'https://oa.example/api/open-artifact.types.package?id=poll-kit',
  install: 'open-artifact types install https://oa.example/t/poll-kit',
  notice: 'third party',
};

describe('the type page and the Types tab', () => {
  it('reads the type page from the boot, and the switch for the Types tab', () => {
    const boot = homeBootOf({ cloud: { ...cloud, siteTypes: true }, typePage: detail });
    assert.equal(boot.cloud?.siteTypes, true);
    assert.equal(boot.typePage?.id, 'poll-kit');
    assert.equal(boot.typePage?.name, '</script><b>Poll</b>', 'kept as text');
    assert.deepEqual(boot.typePage?.capabilities, ['db'], 'only strings');
    assert.equal(homeBootOf({ cloud }).cloud?.siteTypes, undefined);
    assert.equal(homeBootOf({ cloud, typePage: { id: 'x' } }).typePage, undefined, 'a malformed type page reads as none');
    assert.equal(homeBootOf({ typePage: detail }).typePage, undefined, 'never without a cloud boot');
    assert.equal(siteTypeDetailOf({ ...detail, visibility: 'everyone' })?.visibility, 'private', 'an unknown visibility reads as the narrowest');
  });

  it('opens on the Types tab for /#types', async () => {
    const { initialCloudTab } = await import('../src/home/store.ts');
    assert.equal(initialCloudTab('#types'), 'types');
    assert.equal(typePageHref('poll-kit'), '/t/poll-kit');
  });

  it('calls the host’s type routes on its own origin, writes as JSON', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createSiteTypesApi(async (url, init) => {
      calls.push({ url, ...(init ? { init } : {}) });
      if (url.endsWith('.types')) return Response.json({ types: [detail, { id: 1 }], notice: 'n', publish: { allowed: false, refusal: 'Only site admins publish types here.' } });
      if (url.endsWith('.types.update')) return Response.json({ ...detail, visibility: 'site' });
      return Response.json({ code: 'not_granted', message: 'not yours' }, { status: 403 });
    });
    const list = await api.list();
    assert.deepEqual(list.types.map((t) => t.id), ['poll-kit'], 'a malformed row is dropped');
    assert.deepEqual(list.publish, { allowed: false, refusal: 'Only site admins publish types here.' });
    assert.equal((await api.setVisibility('poll-kit', 'site')).visibility, 'site');
    assert.deepEqual(JSON.parse(String(calls[1]!.init?.body)), { id: 'poll-kit', visibility: 'site' });
    await assert.rejects(api.unpublish('poll-kit'), /not yours/);
    assert.deepEqual(calls.map((c) => c.url), ['/api/open-artifact.types', '/api/open-artifact.types.update', '/api/open-artifact.types.unpublish']);
  });
});
