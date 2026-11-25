/**
 * The site's own type routes and the type page (`core/app/site-types.ts`), over the fake platform with a fake
 * {@link SiteTypeServices}: who lists, sees and downloads a type by its visibility, the answer for one you may not see
 * (the same as for an unknown id), management by its publisher or a site admin only, delisted types, audit entries, and
 * the publisher's text kept as text (a name and SKILL.md holding `</script>` and Markdown).
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { HomeBoot, SiteTypeDetail, SiteTypesResult } from '@open-artifact/protocol';
import { SiteTypes, type SiteTypeCandidate, type SiteTypeRow } from '../src/core/catalog/site-types.ts';
import type { SiteTypeServices } from '../src/core/link/services.ts';
import type { UserRecord } from '../src/core/types.ts';
import { appRouter, siteTypeRoutes } from '../src/core/app/index.ts';
import { makeApp, type TestApp } from './app-fixture.ts';

/** The app's routes with the published types' ones, as the Node host mounts them. */
function withSiteTypes() {
  const router = appRouter();
  siteTypeRoutes(router);
  return router;
}

const EVIL = '</script><script>alert(1)</script> **bold** [x](javascript:alert(1))';
const SKILL = `# Poll kit\n\n${EVIL}\n<img src=x onerror=alert(2)>`;
const PACKAGE = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]);

type FakeSiteTypes = SiteTypeServices & { activatedRows: SiteTypeRow[]; removedRows: SiteTypeRow[]; removedFiles: string[] };

function fakeSiteTypes(): FakeSiteTypes {
  const fake: FakeSiteTypes = {
    activatedRows: [],
    removedRows: [],
    removedFiles: [],
    read: async () => {
      throw new Error('not here');
    },
    store: async () => undefined,
    package: async () => PACKAGE,
    removeFiles: async (uid) => void fake.removedFiles.push(uid),
    activated: async (row) => void fake.activatedRows.push(row),
    removed: async (row) => void fake.removedRows.push(row),
    skill: async () => SKILL,
  };
  return fake;
}

const candidate = (o: Partial<SiteTypeCandidate> = {}): SiteTypeCandidate => ({
  id: 'poll-kit',
  uid: 'uid-poll',
  name: `Poll ${EVIL}`,
  version: '1.0.0',
  description: `Polls ${EVIL}`,
  sha256: 'a'.repeat(64),
  bytes: PACKAGE.byteLength,
  capabilities: ['db', 'comments'],
  network: ['https://api.example.com'],
  ...o,
});

async function publish(app: TestApp, by: UserRecord, o: Partial<SiteTypeCandidate> = {}, visibility: 'private' | 'site' | 'link' = 'private'): Promise<SiteTypeRow> {
  const types = new SiteTypes(app.catalog.driver);
  const c = candidate(o);
  return types.save(c, { id: by.id, siteRole: by.siteRole }, await types.plan(c, { id: by.id, siteRole: by.siteRole }), visibility);
}

const body = async (response: Response): Promise<Record<string, unknown>> => (await response.json()) as Record<string, unknown>;

describe('the site type routes and the type page', () => {
  let app: TestApp;
  let site: ReturnType<typeof fakeSiteTypes>;
  let ada: { user: UserRecord; cookie: string };
  let bob: { user: UserRecord; cookie: string };
  let root: { user: UserRecord; cookie: string };

  before(async () => {
    app = await makeApp({ router: withSiteTypes(), env: { OA_TYPES_PUBLISH: 'members' } });
    site = fakeSiteTypes();
    app.ctx.siteTypes = site;
    ada = await app.person('Ada');
    bob = await app.person('Bob');
    root = await app.person('Root', 'root@example.com', { siteRole: 'admin' });
    await publish(app, ada.user);
  });
  after(() => app.close());

  it('lists what each may list: a private type to its publisher and the admins, nobody signed out', async () => {
    const ids = async (cookie: string): Promise<string[]> => ((await (await app.fetch('/api/open-artifact.types', { cookie })).json()) as SiteTypesResult).types.map((t) => t.id);
    assert.deepEqual(await ids(ada.cookie), ['poll-kit']);
    assert.deepEqual(await ids(root.cookie), ['poll-kit']);
    assert.deepEqual(await ids(bob.cookie), []);
    const listed = (await (await app.fetch('/api/open-artifact.types', { cookie: ada.cookie })).json()) as SiteTypesResult;
    assert.equal(listed.types[0]!.mine, true);
    assert.equal(listed.types[0]!.publisher.name, 'Ada');
    assert.match(listed.notice, /publisher/);
    assert.deepEqual(listed.publish, { allowed: true, refusal: null });
    assert.equal((await app.fetch('/api/open-artifact.types')).status, 401);
  });

  it('gives the detail with its SKILL.md and permissions, the page and install addresses', async () => {
    const detail = (await (await app.fetch('/api/open-artifact.type?id=poll-kit', { cookie: ada.cookie })).json()) as SiteTypeDetail;
    assert.equal(detail.skill, SKILL);
    assert.equal(detail.manages, true);
    assert.deepEqual(detail.capabilities, ['db', 'comments']);
    assert.deepEqual(detail.network, ['https://api.example.com']);
    assert.equal(detail.pageUrl, `${app.config.appOrigin}/t/poll-kit`);
    assert.equal(detail.install, `open-artifact types install ${app.config.appOrigin}/t/poll-kit`);
    assert.equal(detail.packageUrl, `${app.config.appOrigin}/api/open-artifact.types.package?id=poll-kit`);
    assert.match(detail.notice, /publisher/);
    const admin = (await (await app.fetch('/api/open-artifact.type?id=poll-kit', { cookie: root.cookie })).json()) as SiteTypeDetail;
    assert.equal(admin.manages, true, 'a site admin manages it');
    assert.equal(admin.mine, false);
  });

  it('answers a private type exactly as an unknown id: 404 signed in, 401 signed out, the page and the API alike', async () => {
    for (const path of ['/api/open-artifact.type?id=', '/api/open-artifact.types.package?id=']) {
      const hidden = await app.fetch(`${path}poll-kit`, { cookie: bob.cookie });
      const unknown = await app.fetch(`${path}nope-kit`, { cookie: bob.cookie });
      assert.equal(hidden.status, 404);
      assert.equal(unknown.status, 404);
      assert.equal(await hidden.text(), await unknown.text());
      const anonHidden = await app.fetch(`${path}poll-kit`);
      const anonUnknown = await app.fetch(`${path}nope-kit`);
      assert.equal(anonHidden.status, 401);
      assert.equal(await anonHidden.text(), await anonUnknown.text());
    }
    const nav = { accept: 'text/html', 'sec-fetch-mode': 'navigate' };
    const page = await app.fetch('/t/poll-kit', { cookie: bob.cookie, headers: nav });
    const none = await app.fetch('/t/nope-kit', { cookie: bob.cookie, headers: nav });
    assert.equal(page.status, 404);
    assert.equal(none.status, 404);
    assert.equal(await page.text(), await none.text());
    assert.match(String(page.headers.get('content-type')), /text\/html/);
    for (const id of ['poll-kit', 'nope-kit']) {
      const anon = await app.fetch(`/t/${id}`, { headers: nav });
      assert.equal(anon.status, 303);
      assert.equal(anon.headers.get('location'), `/auth/sign-in?return_to=%2Ft%2F${id}`);
    }
    // Writes too: a person who cannot see it is told it is not there.
    const write = await app.fetch('/api/open-artifact.types.update', { cookie: bob.cookie, body: { id: 'poll-kit', visibility: 'site' } });
    const writeUnknown = await app.fetch('/api/open-artifact.types.update', { cookie: bob.cookie, body: { id: 'nope-kit', visibility: 'site' } });
    assert.equal(write.status, 404);
    assert.equal(await write.text(), await writeUnknown.text());
    assert.equal((await app.fetch('/api/open-artifact.types.unpublish', { cookie: bob.cookie, body: { id: 'poll-kit' } })).status, 404);
  });

  it('lets only its publisher or an admin change who sees it, from the app origin, audited', async () => {
    const bad = await app.fetch('/api/open-artifact.types.update', { cookie: ada.cookie, body: { id: 'poll-kit', visibility: 'everyone' } });
    assert.equal(bad.status, 400);
    const foreign = await app.fetch('/api/open-artifact.types.update', { cookie: ada.cookie, body: { id: 'poll-kit', visibility: 'link' }, origin: 'https://evil.example' });
    assert.equal(foreign.status, 403, 'another origin');
    const bearer = await app.fetch('/api/open-artifact.types.update', { cookie: ada.cookie, headers: { authorization: 'Bearer x' }, body: { id: 'poll-kit', visibility: 'link' } });
    assert.equal(bearer.status, 401, 'never an agent token');
    const made = await app.fetch('/api/open-artifact.types.update', { cookie: ada.cookie, body: { id: 'poll-kit', visibility: 'link' } });
    assert.equal(made.status, 200);
    assert.equal(((await made.json()) as SiteTypeDetail).visibility, 'link');
    // link: Bob sees and downloads it by its id, but it is not listed to him.
    assert.equal((await app.fetch('/api/open-artifact.type?id=poll-kit', { cookie: bob.cookie })).status, 200);
    assert.deepEqual(((await (await app.fetch('/api/open-artifact.types', { cookie: bob.cookie })).json()) as SiteTypesResult).types, []);
    const notHis = await app.fetch('/api/open-artifact.types.update', { cookie: bob.cookie, body: { id: 'poll-kit', visibility: 'site' } });
    assert.equal(notHis.status, 403);
    assert.match(String((await body(notHis)).message), /publisher or a site admin/);
    assert.equal((await app.fetch('/api/open-artifact.types.unpublish', { cookie: bob.cookie, body: { id: 'poll-kit' } })).status, 403);
    const byAdmin = await app.fetch('/api/open-artifact.types.update', { cookie: root.cookie, body: { id: 'poll-kit', visibility: 'site' } });
    assert.equal(byAdmin.status, 200);
    assert.deepEqual(((await (await app.fetch('/api/open-artifact.types', { cookie: bob.cookie })).json()) as SiteTypesResult).types.map((t) => t.id), ['poll-kit']);
    const audit = (await app.catalog.listAudit({ actionPrefix: 'type.visibility' }));
    assert.deepEqual(
      audit.map((e) => ((d) => [e.actorKind, e.actorId, d.from, d.to])(e.detail as Record<string, unknown>)).reverse(),
      [
        ['user', ada.user.id, 'private', 'link'],
        ['user', root.user.id, 'link', 'site'],
      ],
    );
    assert.equal(site.activatedRows.length, 0, 'a change of who sees it reloads no page');
  });

  it('hands out the package as a download that never runs: zip, attachment, nosniff, no-store', async () => {
    const pkg = await app.fetch('/api/open-artifact.types.package?id=poll-kit', { cookie: bob.cookie });
    assert.equal(pkg.status, 200);
    assert.equal(pkg.headers.get('content-type'), 'application/zip');
    assert.equal(pkg.headers.get('content-disposition'), 'attachment; filename="poll-kit-1.0.0.oatype"');
    assert.equal(pkg.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(pkg.headers.get('cache-control'), 'no-store');
    assert.equal(pkg.headers.get('x-open-artifact-type-publisher'), 'Ada', 'its publisher, for the consent types install shows');
    assert.deepEqual(new Uint8Array(await pkg.arrayBuffer()), PACKAGE);
  });

  it('shows the type page with the publisher\'s text as data, under the site\'s page headers', async () => {
    const page = await app.fetch('/t/poll-kit', { cookie: bob.cookie });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(!html.includes('</script><script>alert(1)'), 'no markup of the publisher\'s ends the boot script');
    assert.ok(!html.includes('<img src=x'), 'nor writes an element');
    const boot = JSON.parse(/window\.__OPEN_ARTIFACT_HOME__=(.*);<\/script>/.exec(html)![1]!) as HomeBoot;
    assert.equal(boot.typePage!.name, `Poll ${EVIL}`, 'the name, as written, for the page to show as text');
    assert.equal(boot.typePage!.skill, SKILL);
    assert.equal(boot.typePage!.manages, false);
    assert.equal(boot.cloud!.siteTypes, true);
    assert.match(boot.cloud!.signInUrl, /return_to=%2Ft%2Fpoll-kit/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    const csp = String(page.headers.get('content-security-policy'));
    assert.match(csp, /script-src 'self' 'sha256-/);
    assert.match(csp, /frame-ancestors 'none'/);
    const mine = JSON.parse(/window\.__OPEN_ARTIFACT_HOME__=(.*);<\/script>/.exec(await (await app.fetch('/t/poll-kit', { cookie: ada.cookie })).text())![1]!) as HomeBoot;
    assert.equal(mine.typePage!.manages, true);
  });

  it('a link type opens without an account where the site allows public access', async () => {
    await app.fetch('/api/open-artifact.types.update', { cookie: ada.cookie, body: { id: 'poll-kit', visibility: 'link' } });
    const detail = await app.fetch('/api/open-artifact.type?id=poll-kit');
    assert.equal(detail.status, 200);
    assert.equal(((await detail.json()) as SiteTypeDetail).manages, false);
    assert.equal((await app.fetch('/api/open-artifact.types.package?id=poll-kit')).status, 200);
    assert.equal((await app.fetch('/t/poll-kit')).status, 200);
    assert.equal((await app.fetch('/api/open-artifact.types.update', { body: { id: 'poll-kit', visibility: 'site' } })).status, 401, 'never managed signed out');
  });

  it('does not hand a publisher\'s email address to someone signed out (an account with no name of its own)', async () => {
    const eve = await app.person('eve@example.com', 'eve@example.com');
    await publish(app, eve.user, { id: 'mail-kit', uid: 'uid-mail', name: 'Mail' }, 'link');
    const out = await app.fetch('/api/open-artifact.type?id=mail-kit');
    assert.equal(out.status, 200);
    assert.equal(((await out.json()) as SiteTypeDetail).publisher.name, null);
    const page = await app.fetch('/t/mail-kit');
    assert.equal(page.status, 200);
    assert.ok(!(await page.text()).includes('eve@example.com'), 'the page');
    const pkg = await app.fetch('/api/open-artifact.types.package?id=mail-kit');
    assert.equal(pkg.status, 200);
    assert.equal(pkg.headers.get('x-open-artifact-type-publisher'), null);
    // Signed in, the name is there as everywhere else on the site; a publisher with a name is named to anyone.
    assert.equal(((await (await app.fetch('/api/open-artifact.type?id=mail-kit', { cookie: bob.cookie })).json()) as SiteTypeDetail).publisher.name, 'eve@example.com');
    assert.equal(((await (await app.fetch('/api/open-artifact.type?id=poll-kit')).json()) as SiteTypeDetail).publisher.name, 'Ada');
    await new SiteTypes(app.catalog.driver).remove('uid-mail');
  });

  it('unpublishes as the Link does: delisted while artifacts use it (shown so to its managers only), else removed', async () => {
    await app.artifact(bob.user, { type: 'poll-kit', title: 'Lunch' });
    const delisted = await app.fetch('/api/open-artifact.types.unpublish', { cookie: ada.cookie, body: { id: 'poll-kit' } });
    assert.deepEqual(await delisted.json(), { id: 'poll-kit', uid: 'uid-poll', removed: false, artifacts: 1 });
    assert.equal(site.activatedRows.at(-1)?.unpublished, true, 'its artifacts are told');
    const shown = (await (await app.fetch('/api/open-artifact.type?id=poll-kit', { cookie: ada.cookie })).json()) as SiteTypeDetail;
    assert.equal(shown.unpublished, true);
    for (const cookie of [bob.cookie]) {
      const hidden = await app.fetch('/api/open-artifact.type?id=poll-kit', { cookie });
      const unknown = await app.fetch('/api/open-artifact.type?id=nope-kit', { cookie });
      assert.equal(hidden.status, 404);
      assert.equal(await hidden.text(), await unknown.text());
    }
    assert.equal((await app.fetch('/api/open-artifact.type?id=poll-kit')).status, 401, 'nor signed out');
    assert.deepEqual(((await (await app.fetch('/api/open-artifact.types', { cookie: root.cookie })).json()) as SiteTypesResult).types.map((t) => [t.id, t.unpublished]), [['poll-kit', true]]);
    const relist = await app.fetch('/api/open-artifact.types.update', { cookie: ada.cookie, body: { id: 'poll-kit', visibility: 'site' } });
    assert.equal(relist.status, 409, 'a delisted type is listed again by publishing it');

    await publish(app, ada.user, { id: 'quiz-kit', uid: 'uid-quiz', name: 'Quiz' });
    const removed = await app.fetch('/api/open-artifact.types.unpublish', { cookie: root.cookie, body: { id: 'quiz-kit' } });
    assert.deepEqual(await removed.json(), { id: 'quiz-kit', uid: 'uid-quiz', removed: true, artifacts: 0 });
    assert.deepEqual(site.removedFiles, ['uid-quiz']);
    assert.equal(await new SiteTypes(app.catalog.driver).byId('quiz-kit'), undefined);
    const audit = (await app.catalog.listAudit({ actionPrefix: 'type.unpublish' })).map((e) => ((d) => [e.actorKind, e.actorId, d.id, d.removed])(e.detail as Record<string, unknown>)).reverse();
    assert.deepEqual(audit, [
      ['user', ada.user.id, 'poll-kit', false],
      ['user', root.user.id, 'quiz-kit', true],
    ]);
  });
});

describe('site types where they are limited', () => {
  it('signed out, nothing is shown when the site allows no public access, not even a link type', async () => {
    const app = await makeApp({ router: withSiteTypes(), env: { OA_PUBLIC_ACCESS: 'false' } });
    try {
      app.ctx.siteTypes = fakeSiteTypes();
      const ada = await app.person('Ada', 'ada@example.com', { siteRole: 'admin' });
      await publish(app, ada.user, {}, 'link');
      assert.equal((await app.fetch('/api/open-artifact.type?id=poll-kit')).status, 401);
      assert.equal((await app.fetch('/api/open-artifact.types.package?id=poll-kit')).status, 401);
      assert.equal((await app.fetch('/t/poll-kit')).status, 303);
      assert.equal((await app.fetch('/api/open-artifact.type?id=poll-kit', { cookie: ada.cookie })).status, 200);
    } finally {
      await app.close();
    }
  });

  it('a member may not show a type to more people when the site does not let them publish; narrowing is always theirs', async () => {
    const app = await makeApp({ router: withSiteTypes(), env: { OA_TYPES_PUBLISH: 'admins' } });
    try {
      app.ctx.siteTypes = fakeSiteTypes();
      const mia = await app.person('Mia');
      // Published while the site let members publish, say: Mia's own type.
      await publish(app, mia.user, {}, 'link');
      const listed = (await (await app.fetch('/api/open-artifact.types', { cookie: mia.cookie })).json()) as SiteTypesResult;
      assert.equal(listed.publish.allowed, false);
      assert.match(String(listed.publish.refusal), /OA_TYPES_PUBLISH=admins/);
      const wider = await app.fetch('/api/open-artifact.types.update', { cookie: mia.cookie, body: { id: 'poll-kit', visibility: 'site' } });
      assert.equal(wider.status, 403);
      assert.match(String((await body(wider)).message), /Only the site admins/);
      assert.equal((await app.fetch('/api/open-artifact.types.update', { cookie: mia.cookie, body: { id: 'poll-kit', visibility: 'private' } })).status, 200);
    } finally {
      await app.close();
    }
  });

  it('a site that keeps no published types answers every type as unknown and lists none', async () => {
    // The routes mounted without the services (the Node host mounts them only with them).
    const app = await makeApp({ router: withSiteTypes() });
    try {
      const ada = await app.person('Ada', 'ada@example.com', { siteRole: 'admin' });
      await publish(app, ada.user);
      const listed = (await (await app.fetch('/api/open-artifact.types', { cookie: ada.cookie })).json()) as SiteTypesResult;
      assert.deepEqual(listed.types, []);
      assert.equal(listed.publish.allowed, false);
      assert.equal((await app.fetch('/api/open-artifact.type?id=poll-kit', { cookie: ada.cookie })).status, 404);
      assert.equal((await app.fetch('/t/poll-kit', { cookie: ada.cookie })).status, 404);
    } finally {
      await app.close();
    }
  });
});
