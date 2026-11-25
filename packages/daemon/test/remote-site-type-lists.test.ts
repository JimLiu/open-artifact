/**
 * `types.sites`, the home page's list of the types on each site this computer is connected to, against the real Node
 * host (`real-host.ts`): how each stands here (`new`, `installed`, `update`, `published-here`, `clash`), delisted
 * types left out, and each site answering on its own: one that is down, one without `link.types.list` (an older
 * site), one too slow, one this computer is not signed in to. Also who may read it: an agent's request is answered
 * with the third-party notice; a page of another origin is refused.
 */

import { tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { LIBRARY_ROUTES, THIRD_PARTY_NOTICE, artifactIdOf, type DaemonState, type TypePackagePreview, type TypesPublishResponse, type TypesSitesResponse, type TypesSite, type ToolCallResult } from '@open-artifact/protocol';
import { api, readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { siteTypeListed } from '../src/link.ts';
import { RemotesFile } from '../src/remote.ts';
import { siteTypeStanding } from '../src/type-packages.ts';
import { startRealHost, type RealHost } from './real-host.ts';

process.env.OPEN_ARTIFACT_LINK_RETRY_MS = '100';
process.env.OPEN_ARTIFACT_LINK_RESCAN_MS = '0';
// Each site's list within 1.5 s here (5 s by default).
process.env.OPEN_ARTIFACT_SITE_TYPES_MS = '1500';

let real: RealHost;
let down: RealHost | undefined;
let daemon: Daemon;
let state: DaemonState;
const fakes: Server[] = [];

const shellDir = tempDir('open-artifact-shell-');
const caller = { harness: 'dsh', session: 'site-lists-1', workspace: tempDir('open-artifact-ws-') };
const AGENT = { 'X-Open-Artifact-Agent': 'dsh session site-lists-1' };
type Refusal = { code?: string; message?: string };

/** Connects a real host as `name` (the device flow, approved by a signed-in person there). */
async function connect(host: RealHost, name: string, person: string): Promise<void> {
  const { cookie } = await host.person(person, `${person.toLowerCase()}@example.com`);
  const start = await api<{ user_code: string }>(state, 'remotes.add', { name, host: host.app });
  assert.equal((await host.decide(cookie, start.user_code)).status, 200);
  const done = await api<{ status: string }>(state, 'remotes.add.wait', { name, ms: 20_000 });
  assert.equal(done.status, 'done', JSON.stringify(done));
}

before(async () => {
  real = await startRealHost({ OA_TYPES_PUBLISH: 'members' });
  daemon = await startDaemon({ port: 0, quiet: true, shellDir, homeDir: join(shellDir, 'no-home') });
  state = (await readDaemon())!;
  await connect(real, 'cloud', 'Ada');
});

after(async () => {
  daemon?.close();
  await real?.stop();
  await down?.stop();
  for (const server of fakes) server.close();
});

const sites = (headers?: Record<string, string>): Promise<TypesSitesResponse & Refusal> => api<TypesSitesResponse & Refusal>(state, LIBRARY_ROUTES.typesSites, undefined, headers ? { headers } : {});
const site = (answer: TypesSitesResponse, remote: string): TypesSite => {
  const found = answer.sites.find((s) => s.remote === remote);
  assert.ok(found, `no entry for ${remote}: ${JSON.stringify(answer.sites.map((s) => s.remote))}`);
  return found;
};
const tool = (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => api<ToolCallResult>(state, 'tools.call', { name, arguments: args, caller });

/** A new user type, published to `cloud` for everyone on the site; its folder. */
async function published(id: string): Promise<string> {
  const made = await api<Refusal & { id?: string; dir?: string }>(state, LIBRARY_ROUTES.typesNew, { id, scope: 'user', name: `Kit ${id}` });
  assert.equal(made.code, undefined, JSON.stringify(made));
  const out = await api<TypesPublishResponse & Refusal>(state, LIBRARY_ROUTES.typesPublish, { id, remote: 'cloud', visibility: 'site' });
  assert.equal(out.code, undefined, JSON.stringify(out));
  return made.dir!;
}

/** Takes a user type's folder away (kept in `keep` when given): this computer no longer has it of its own. */
async function forget(id: string, dir: string, keep?: string): Promise<void> {
  if (keep) cpSync(dir, keep, { recursive: true });
  rmSync(dir, { recursive: true, force: true });
  await until(() => !daemon.types.list(undefined, { includeShadowed: true }).some((t) => t.id === id && t.scope === 'user'), 10_000);
}

/** Installs a site type from its page address, through the preview (as the home page's dialog does). */
async function installFromPage(page: string, as?: string): Promise<{ id: string; sha256: string }> {
  const preview = await api<TypePackagePreview & Refusal>(state, LIBRARY_ROUTES.typesPreview, { url: page, ...(as ? { as } : {}) });
  assert.equal(preview.code, undefined, JSON.stringify(preview));
  const done = await api<Refusal & { id: string; sha256: string }>(state, LIBRARY_ROUTES.typesInstall, { sha256: preview.sha256, ...(as ? { as } : {}) });
  assert.equal(done.code, undefined, JSON.stringify(done));
  return done;
}

test('each type a site lists says how it stands here: new, installed, update, published-here, clash', async () => {
  const keep = tempDir('open-artifact-kept-');
  // published-here: a type of this computer's own, published from here.
  await published('mine-kit');
  // new: published from here, then its folder taken away (another computer's type, as far as this one knows).
  await forget('fresh-kit', await published('fresh-kit'));
  // installed: the same, then installed from the site's page.
  await forget('got-kit', await published('got-kit'));
  // update: installed from the site, then a new version published (its folder brought back for that, then gone again).
  const oldDir = await published('old-kit');
  await forget('old-kit', oldDir, join(keep, 'old-kit'));
  // clash: published, gone, then another type made here under the same id (a new uid).
  await forget('both-kit', await published('both-kit'));

  let answer = await sites();
  assert.equal(answer.code, undefined, JSON.stringify(answer));
  let cloud = site(answer, 'cloud');
  assert.equal(cloud.error, null, cloud.error ?? '');
  assert.equal(cloud.host, real.app);
  const page = (id: string): string => cloud.types.find((t) => t.id === id)!.page;
  assert.equal(page('got-kit'), `${real.app}/t/got-kit`, 'its page on the site, made from the remote address');

  const got = await installFromPage(page('got-kit'));
  const old = await installFromPage(page('old-kit'));
  cpSync(join(keep, 'old-kit'), oldDir, { recursive: true });
  const manifestFile = join(oldDir, 'artifact-type.json');
  writeFileSync(manifestFile, JSON.stringify({ ...JSON.parse(readFileSync(manifestFile, 'utf8')), version: '0.2.0' }, null, 2));
  await until(() => daemon.types.list(undefined, { includeShadowed: true }).find((t) => t.id === 'old-kit' && t.scope === 'user')?.version === '0.2.0', 10_000);
  const again = await api<TypesPublishResponse & Refusal>(state, LIBRARY_ROUTES.typesPublish, { id: 'old-kit', remote: 'cloud' });
  assert.equal(again.change, 'version', JSON.stringify(again));
  await forget('old-kit', oldDir);
  const clash = await api<Refusal & { id?: string }>(state, LIBRARY_ROUTES.typesNew, { id: 'both-kit', scope: 'user', name: 'Mine, same id' });
  assert.equal(clash.code, undefined, JSON.stringify(clash));

  answer = await sites();
  cloud = site(answer, 'cloud');
  const of = (id: string) => {
    const t = cloud.types.find((x) => x.id === id);
    assert.ok(t, `${id} is listed: ${JSON.stringify(cloud.types.map((x) => x.id))}`);
    return t;
  };
  assert.equal(of('mine-kit').standing, 'published-here');
  assert.equal(of('mine-kit').local?.scope, 'user');
  assert.equal(of('fresh-kit').standing, 'new');
  assert.equal(of('fresh-kit').local, null);
  // The site's sha256 is the package installed from it.
  assert.equal(of('got-kit').sha256, got.sha256, 'the site lists the bytes it handed out');
  assert.equal(of('got-kit').standing, 'installed');
  assert.deepEqual(of('got-kit').local, { id: 'got-kit', version: '0.1.0', scope: 'installed', sha256: got.sha256, installedFrom: `${real.app}/t/got-kit` });
  assert.equal(of('old-kit').standing, 'update');
  assert.equal(of('old-kit').version, '0.2.0', 'the site has the new version');
  assert.equal(of('old-kit').local?.version, '0.1.0', 'and this computer the old one');
  assert.equal(of('old-kit').local?.sha256, old.sha256);
  assert.equal(of('both-kit').standing, 'clash');
  assert.equal(of('both-kit').local?.id, 'both-kit');
  assert.equal(of('both-kit').local?.scope, 'user');
  assert.equal(answer.notice, THIRD_PARTY_NOTICE);

  // Installed under another id (`--as`): still found by its uid.
  await installFromPage(page('both-kit'), 'both-kit-site');
  const after = site(await sites(), 'cloud').types.find((t) => t.id === 'both-kit')!;
  assert.equal(after.standing, 'installed');
  assert.equal(after.local?.id, 'both-kit-site');
});

test('a delisted type is not offered', async () => {
  await api(state, LIBRARY_ROUTES.typesNew, { id: 'gone-kit', scope: 'user', name: 'Gone' });
  const art = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/gone-kit', title: 'Uses it' });
  assert.equal(art.error, undefined, JSON.stringify(art.error));
  const pub = await api<Refusal>(state, 'artifacts.publish', { id: artifactIdOf(String(art.url)), remote: 'cloud', withType: true });
  assert.equal(pub.code, undefined, JSON.stringify(pub));
  assert.ok(site(await sites(), 'cloud').types.some((t) => t.id === 'gone-kit'), 'listed while published');
  const off = await api<Refusal & { removed?: boolean }>(state, LIBRARY_ROUTES.typesUnpublish, { id: 'gone-kit', remote: 'cloud' });
  assert.equal(off.removed, false, 'delisted: an artifact uses it');
  assert.equal(site(await sites(), 'cloud').types.some((t) => t.id === 'gone-kit'), false);
});

test("an agent's request is answered, with the third-party notice; a page of another origin is refused; it is a read", async () => {
  const agent = await sites(AGENT);
  assert.equal(agent.code, undefined, JSON.stringify(agent));
  assert.equal(agent.notice, THIRD_PARTY_NOTICE);
  assert.ok(site(agent, 'cloud').types.length > 0);
  const foreign = await api<Refusal>(state, LIBRARY_ROUTES.typesSites, undefined, { headers: { Origin: 'http://evil.example' } });
  assert.equal(foreign.code, 'not_granted');
  const crossSite = await api<Refusal>(state, LIBRARY_ROUTES.typesSites, undefined, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(crossSite.code, 'not_granted');
  const post = await api<Refusal>(state, LIBRARY_ROUTES.typesSites, {});
  assert.equal(post.code, 'invalid_argument');
  // Nothing an agent is given names it: no MCP tool, no CLI command.
  const tools = await api<{ tools?: Array<{ name: string }> } | Array<{ name: string }>>(state, 'tools');
  assert.doesNotMatch(JSON.stringify(tools), /types\.sites|typesSites/);
});

/** A fake site at a free port: `typesList` answers (or never does) its `link.types.list`. */
async function fakeSite(typesList: 'missing' | 'hang'): Promise<string> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/open-artifact.link.types.list') && typesList === 'hang') return; // never answers
    res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 'not_found', message: 'No such route.' }));
  });
  fakes.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

/** A remote in the remotes file as a signed-in one (its access token good for an hour). */
function storedRemote(name: string, host: string, signedIn = true): void {
  new RemotesFile().set(name, {
    host,
    user: { id: 'u-fake', name: 'Fake', email: null } as never,
    accessToken: signedIn ? 'fake-access' : null,
    refreshToken: signedIn ? 'fake-refresh' : null,
    expiresAt: signedIn ? new Date(Date.now() + 3600_000).toISOString() : null,
    lastEventId: null,
    addedAt: new Date().toISOString(),
  });
}

test('each site answers on its own: down, older (no types.list), too slow, signed out; the others still list', async () => {
  down = await startRealHost({ OA_TYPES_PUBLISH: 'members' });
  await connect(down, 'down', 'Cy');
  await down.stop();
  down = undefined;
  storedRemote('older', await fakeSite('missing'));
  storedRemote('slow', await fakeSite('hang'));
  storedRemote('away', 'http://localhost:9', false);
  try {
    const started = Date.now();
    const answer = await sites();
    const took = Date.now() - started;
    assert.ok(took < 5000, `the slow site held the answer ${took} ms (its limit is 1.5 s)`);
    assert.ok(site(answer, 'cloud').types.length > 0, 'the reachable site still lists its types');
    assert.equal(site(answer, 'cloud').error, null);
    const gone = site(answer, 'down');
    assert.equal(gone.code, 'unreachable', JSON.stringify(gone));
    assert.match(gone.error ?? '', /cannot be reached now/);
    assert.deepEqual(gone.types, []);
    const older = site(answer, 'older');
    assert.equal(older.code, 'unsupported', JSON.stringify(older));
    assert.match(older.error ?? '', /keeps no published types/);
    const slow = site(answer, 'slow');
    assert.equal(slow.code, 'timeout', JSON.stringify(slow));
    assert.match(slow.error ?? '', /did not answer within 2 seconds|did not answer within 1 seconds|did not answer within/);
    const away = site(answer, 'away');
    assert.equal(away.code, 'signed_out');
    assert.match(away.error ?? '', /open-artifact remote add away http:\/\/localhost:9/);
  } finally {
    for (const name of ['down', 'older', 'slow', 'away']) await api(state, 'remotes.remove', { name, force: true });
  }
});

test('with no remotes: no sites', async () => {
  await api(state, 'remotes.remove', { name: 'cloud', force: true });
  const answer = await sites();
  assert.deepEqual(answer.sites, []);
  assert.equal(answer.notice, THIRD_PARTY_NOTICE);
});

test('what a site lists is read defensively; the standing rules, alone', () => {
  const host = 'https://oa.example';
  const row = { id: 'trip-kit', uid: 'u1', name: 'Trip‮kit', version: '1.0.0', description: 'x'.repeat(5000), visibility: 'nope', publisher: { id: 'p', name: 'Bo' }, sha256: 'a'.repeat(64), capabilities: ['db', 7], network: [] };
  const read = siteTypeListed(row, host)!;
  assert.equal(read.page, 'https://oa.example/t/trip-kit');
  assert.equal(read.name, 'Trip kit', 'no direction characters');
  assert.equal(read.description.length, 2000);
  assert.equal(read.visibility, 'private');
  assert.deepEqual(read.capabilities, ['db']);
  assert.equal(siteTypeListed({ ...row, id: '../x' }, host), null, 'not a type id');
  assert.equal(siteTypeListed({ ...row, uid: undefined }, host), null);
  assert.equal(siteTypeListed('nope', host), null);

  const entry = (id: string, uid: string, sha256: string) => ({ id, uid, source: 's', version: '1.0.0', sha256, bytes: 1, installedAt: '' });
  const site = { id: 'trip-kit', uid: 'u1', sha256: 'a'.repeat(64) };
  assert.equal(siteTypeStanding(site, [], {}).standing, 'new');
  assert.equal(siteTypeStanding(site, [{ id: 'trips', uid: 'u1', scope: 'project', version: '1.0.0' }], {}).standing, 'published-here');
  assert.equal(siteTypeStanding(site, [], { x: entry('x', 'u1', 'a'.repeat(64)) }).standing, 'installed');
  assert.equal(siteTypeStanding(site, [], { x: entry('x', 'u1', 'b'.repeat(64)) }).standing, 'update');
  assert.equal(siteTypeStanding(site, [{ id: 'trip-kit', uid: 'other', scope: 'user', version: null }], {}).standing, 'clash');
  assert.equal(siteTypeStanding(site, [{ id: 'trip-kit', uid: null, scope: 'builtin', version: null }], {}).standing, 'clash', 'a built-in of that id too');
  // Published here wins over installed; installed (same uid) over a clash by id.
  assert.equal(siteTypeStanding(site, [{ id: 'trips', uid: 'u1', scope: 'user', version: null }], { x: entry('x', 'u1', 'a'.repeat(64)) }).standing, 'published-here');
  assert.equal(siteTypeStanding(site, [{ id: 'trip-kit', uid: 'other', scope: 'user', version: null }], { x: entry('x', 'u1', 'a'.repeat(64)) }).standing, 'installed');
  // An id like `constructor` is not looked up on the prototype.
  assert.equal(siteTypeStanding({ ...site, id: 'constructor' }, [], {}).standing, 'new');
});
