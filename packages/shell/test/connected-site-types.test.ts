/**
 * The local home page's types on the connected sites (`types.sites`): the daemon's answer read defensively, the page
 * link drawn only where it is the type's page on that site, and what each standing offers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { siteTypeOffer, typePageLink, typesSitesOf } from '../src/lib/connected-site-types.ts';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'poll-kit',
  uid: 'uid-poll',
  name: '<img src=x onerror=alert(1)>',
  version: '1.0.0',
  description: 'Polls',
  visibility: 'site',
  publisher: { id: 'u2', name: 'Bo' },
  mine: false,
  unpublished: false,
  sha256: 'a'.repeat(64),
  bytes: 9,
  capabilities: ['db'],
  network: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  page: 'https://oa.example/t/poll-kit',
  standing: 'new',
  local: null,
  ...over,
});

describe('the types on the connected sites', () => {
  it('reads the answer: each site with its types, or its error alone', () => {
    const answer = typesSitesOf({
      notice: 'third party',
      sites: [
        { remote: 'work', host: 'https://oa.example', types: [row(), row({ id: 'gone', uid: 'u-gone', page: 'https://oa.example/t/gone', unpublished: true })], error: null, code: null },
        { remote: 'down', host: 'https://down.example', types: [row()], error: 'down.example cannot be reached now.', code: 'unreachable' },
        { remote: 'odd', host: 'https://odd.example', types: [], error: 'Something', code: 'whatever' },
        { host: 'no name' },
        'nope',
      ],
    });
    assert.equal(answer.notice, 'third party');
    assert.deepEqual(answer.sites.map((s) => s.remote), ['work', 'down', 'odd']);
    const work = answer.sites[0]!;
    assert.deepEqual(work.types.map((t) => t.id), ['poll-kit'], 'a delisted one is not offered');
    assert.equal(work.types[0]!.name, '<img src=x onerror=alert(1)>', 'kept as text (drawn as a text node)');
    assert.equal(work.types[0]!.standing, 'new');
    assert.deepEqual(answer.sites[1]!.types, [], 'a site with an error lists nothing');
    assert.equal(answer.sites[1]!.code, 'unreachable');
    assert.equal(answer.sites[2]!.code, 'error', 'an unknown code is read as error');
    assert.deepEqual(typesSitesOf(null), { sites: [], notice: '' });
    assert.deepEqual(typesSitesOf({ sites: 'x' }).sites, []);
  });

  it('keeps a type only with its page on that very site; an unknown standing is new', () => {
    const answer = typesSitesOf({
      sites: [
        {
          remote: 'work',
          host: 'https://oa.example',
          types: [
            row({ page: 'https://evil.example/t/poll-kit' }),
            row({ id: 'b', uid: 'u-b', page: 'javascript:alert(1)' }),
            row({ id: 'c', uid: 'u-c', page: 'https://oa.example/t/other' }),
            row({ id: 'd', uid: 'u-d', page: 'https://oa.example/t/d', standing: 'hacked', local: { id: 'd', scope: 'nope', version: 3 } }),
          ],
          error: null,
        },
      ],
    });
    const types = answer.sites[0]!.types;
    assert.deepEqual(types.map((t) => t.id), ['d']);
    assert.equal(types[0]!.standing, 'new');
    assert.deepEqual(types[0]!.local, { id: 'd', version: null, scope: 'user' });
    assert.equal(typePageLink('https://oa.example/t/d', 'https://oa.example/', 'd'), 'https://oa.example/t/d');
    assert.equal(typePageLink('https://oa.example/t/d?x=1', 'https://oa.example', 'd'), null);
    assert.equal(typePageLink(7, 'https://oa.example', 'd'), null);
  });

  it('offers what each standing calls for', () => {
    const page = 'https://oa.example/t/poll-kit';
    assert.deepEqual(siteTypeOffer({ page, standing: 'new', local: null }), { action: 'install', open: { url: page, auto: true } });
    assert.deepEqual(siteTypeOffer({ page, standing: 'installed', local: { id: 'poll-kit', version: '1.0.0', scope: 'installed' } }), { action: 'none', label: 'installed' });
    assert.deepEqual(siteTypeOffer({ page, standing: 'published-here', local: { id: 'poll-kit', version: '1.0.0', scope: 'user' } }), { action: 'none', label: 'published-here' });
    // Update: installed from this page, the installed type's own update; else the page read again under its id.
    assert.deepEqual(siteTypeOffer({ page, standing: 'update', local: { id: 'polls', version: '0.9.0', scope: 'installed', installedFrom: page } }), { action: 'update', open: { update: 'polls' } });
    assert.deepEqual(siteTypeOffer({ page, standing: 'update', local: { id: 'polls', version: '0.9.0', scope: 'installed', installedFrom: '/tmp/poll-kit-0.9.0.oatype' } }), { action: 'update', open: { url: page, as: 'polls', auto: true } });
    // A clash: the dialog's form with the page filled in, for the person to give another id.
    assert.deepEqual(siteTypeOffer({ page, standing: 'clash', local: { id: 'poll-kit', version: null, scope: 'user' } }), { action: 'install-as', open: { url: page, auto: false } });
  });
});
