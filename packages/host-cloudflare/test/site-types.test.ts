/**
 * Types published to the Cloudflare site (`site-types.ts`): the Node site's scenarios (`packages/host/test/
 * site-types.test.ts`) on D1 and an artifact's object.
 *
 * - the services on the D1 fake, made to refuse a row past D1's 2,000,000 bytes as D1 does: a package kept in chunks
 *   and read back whole, a version switch, a failed write that leaves the old version served, the 16 MiB limit (and
 *   the Link's cap, in the same words), removal;
 * - how an archive names a published type (type_missing, type_mismatch, delisted → not_granted);
 * - its SKILL.md: kept at publish (no package read to show it), read from the package once for a version stored before
 *   (then kept), cut at `SITE_TYPE_SKILL_MAX`, the file the manifest names, none; the download streamed from D1 (whole,
 *   its sha256 checked before the last chunk, the core's headers, `HEAD` from the head row with no chunk read);
 * - an artifact of a published type in its object: it opens on the frame engine under its manifest's CSP, its type
 *   files `no-cache` with an ETag, a new version reaches an open page (a `rewired` event, the new CSP), a delisted type
 *   keeps running, a removed one closes the core and opens nothing; import by type and uid, its title from
 *   `titleFrom`, actions, export; a new artifact of it made by its object (`scaffold`: the `.artifact.json` marker
 *   alone).
 *
 * `node:fs` is aliased to this package's file system as in `page-room.test.ts`.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, relative } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installedTypeCsp } from '@open-artifact/protocol';
import { testStorage, type TestStorage } from './sqlite.ts';
import { fakeD1, type FakeD1 } from './d1-fake.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '../../..');
const fsDir = join(repo, 'packages/host-cloudflare/src/fs/');
const pageType = join(repo, 'artifact-types/page');

registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL ? fileURLToPath(context.parentURL) : '';
    const aliased = parent.startsWith(repo) && !parent.startsWith(fsDir) && !parent.includes('/node_modules/') && !parent.includes('/packages/wasm-sheets/') && !parent.includes('/host-cloudflare/test/');
    if (aliased && (specifier === 'node:fs' || specifier === 'fs')) return { url: pathToFileURL(join(fsDir, 'index.ts')).href, shortCircuit: true };
    if (aliased && (specifier === 'node:fs/promises' || specifier === 'fs/promises')) return { url: pathToFileURL(join(fsDir, 'promises.ts')).href, shortCircuit: true };
    return next(specifier, context);
  },
});

type Host = typeof import('@open-artifact/host');
type Rooms = typeof import('../src/room.ts');
type RoomHosts = typeof import('../src/room-host.ts');
type Frames = typeof import('../src/frames.ts');
type D1 = typeof import('../src/d1.ts');
type SiteTypesModule = typeof import('../src/site-types.ts');
type CoreSiteTypes = typeof import('../../host/src/core/catalog/site-types.ts');
type Agents = typeof import('../src/agents.ts');
let core: Host;
let rooms: Rooms;
let roomHosts: RoomHosts;
let frames: Frames;
let d1: D1;
let st: SiteTypesModule;
let coreTypes: CoreSiteTypes;
let agents: Agents;
// The fixtures import server-sdk's zip module: loaded after the hook, so it reads this package's file system.
let packageOf: typeof import('../../host/test/site-type-fixture.ts').packageOf;
let UID: string;
let rawZip: typeof import('../../server-sdk/test/zip-builder.ts').rawZip;

const KEYS = ['s'.repeat(40)];
const CLIENT = ['runtime.js', 'imports.js', 'shell.js', 'comments.js', 'shell.css', 'comments.css', 'shell.html'];
const D1_ROW_BYTES = 2_000_000;

/** The D1 fake, refusing a bound string or BLOB past D1's row limit (the fake itself keeps no such limit). */
function limitedD1(): FakeD1 & { failNext: (fragment: string) => void; statements: string[] } {
  const inner = fakeD1();
  let failing: string | null = null;
  /** Every statement prepared, in order (a test clears it to count what a call reads). */
  const statements: string[] = [];
  const guard = (sql: string, values: unknown[]): void => {
    if (failing && sql.includes(failing)) {
      failing = null;
      throw new Error('D1_ERROR: simulated failure');
    }
    for (const value of values) {
      const size = typeof value === 'string' ? Buffer.byteLength(value) : value instanceof Uint8Array || value instanceof ArrayBuffer ? value.byteLength : 0;
      if (size > D1_ROW_BYTES) throw new Error(`D1_ERROR: string or blob too big (${size} bytes)`);
    }
  };
  const wrap = (statement: import('../src/d1.ts').D1PreparedStatement, sql: string): import('../src/d1.ts').D1PreparedStatement => ({
    ...statement,
    bind: (...values: unknown[]) => {
      guard(sql, values);
      return wrap(statement.bind(...values), sql);
    },
    all: () => statement.all(),
    run: () => statement.run(),
    first: () => statement.first(),
  });
  return Object.assign(Object.create(inner) as FakeD1, {
    statements,
    prepare: (sql: string) => {
      statements.push(sql);
      return wrap(inner.prepare(sql), sql);
    },
    batch: (statements: import('../src/d1.ts').D1PreparedStatement[]) => inner.batch(statements.map((s) => (s as unknown as { inner?: unknown }).inner ?? s) as never),
    failNext: (fragment: string) => {
      failing = fragment;
    },
  });
}

function frameBuild(): import('../src/frames.ts').FrameBuild {
  const files: Record<string, string> = {};
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(pageType, path)] = readFileSync(path).toString('base64');
    }
  };
  walk(join(pageType, 'artifact-type'));
  return {
    types: [{ id: 'page', label: 'artifact-types/page', fingerprint: 'test0000test0000', manifest: JSON.parse(readFileSync(join(pageType, 'artifact-type.json'), 'utf8')), skill: 'Write index.html.', indexHtml: null, files, page: true }],
    client: { base: '/_open-artifact/frame/test0000test0000/', files: CLIENT },
  };
}

const assets = {
  async fetch(request: Request): Promise<Response> {
    const path = decodeURIComponent(new URL(request.url).pathname);
    const client = /^\/_open-artifact\/frame\/test0000test0000\/(.+)$/.exec(path);
    if (client && CLIENT.includes(client[1]!)) return new Response(client[1] === 'shell.html' ? '<!doctype html><title>inner shell</title>' : `/* ${client[1]} */`);
    return new Response(null, { status: 404 });
  },
};

function sockets() {
  const made: Array<{ sent: string[]; closed: number | null }> = [];
  const pair = () => {
    const record = { sent: [] as string[], closed: null as number | null };
    made.push(record);
    const server = {
      accept() {},
      send(message: string) {
        record.sent.push(String(message));
      },
      close(code?: number) {
        record.closed = code ?? 1000;
      },
      addEventListener() {},
    };
    return [{ client: true }, server] as unknown as [unknown, import('../src/bridge/ws.ts').WorkersWebSocket];
  };
  return { made, pair };
}

async function until(check: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((done) => setTimeout(done, 20));
  }
}

/** An archive of an artifact of the published type (its `.artifact.json` names the type and its uid). */
function artifactArchive(o: { type?: string; typeUid?: string | null; title?: string } = {}): Uint8Array {
  const marker: Record<string, unknown> = { type: o.type ?? 'poll-kit', id: 'art_whatever', title: 'From the marker' };
  if (o.typeUid !== null) marker.typeUid = o.typeUid ?? UID;
  return new Uint8Array(
    rawZip([
      { name: 'lunch/.artifact.json', data: JSON.stringify(marker) },
      { name: 'lunch/poll.json', data: JSON.stringify({ title: o.title ?? 'Lunch poll' }) },
    ]),
  );
}

let db: ReturnType<typeof limitedD1>;
let driver: import('../src/d1.ts').D1Driver;
let catalog: import('@open-artifact/host').Catalog;
let types: InstanceType<CoreSiteTypes['SiteTypes']>;
let services: import('@open-artifact/host').SiteTypeServices;
let admin: { id: string; siteRole: 'admin' };
const told: string[] = [];
/** What the hub would do: each room told of a changed type (`type-changed`). */
let tellRooms: (type: string) => Promise<void> = async () => undefined;
/** The hub forgot the rooms (evicted): nobody is told, the rooms find out by themselves. */
let hubForgot = false;
/** How far the objects' clocks are ahead (their row memo). */
let skew = 0;

/** The Link route's order (`types.import`): read, plan, store, save, activated, old version's files removed. */
async function publish(bytes: Uint8Array): Promise<{ row: import('../src/site-types.ts').SiteTypeRow; change: string }> {
  const candidate = await services.read(bytes);
  const plan = await types.plan(candidate, admin);
  if (plan.change !== 'unchanged') await services.store(candidate, bytes);
  const row = await types.save(candidate, admin, plan);
  if (plan.change !== 'unchanged') await services.activated(row);
  if (plan.change === 'version') await services.removeFiles(row.uid, plan.previous.version);
  return { row, change: plan.change };
}

const versions = (): Array<{ version: string; complete: number; chunks: number }> => (db.sqlite.prepare('SELECT version, complete, chunks FROM type_packages ORDER BY version').all() as Array<{ version: string; complete: number; chunks: number }>).map((r) => ({ version: r.version, complete: r.complete, chunks: r.chunks }));

before(async () => {
  core = await import('@open-artifact/host');
  rooms = await import('../src/room.ts');
  roomHosts = await import('../src/room-host.ts');
  frames = await import('../src/frames.ts');
  d1 = await import('../src/d1.ts');
  st = await import('../src/site-types.ts');
  coreTypes = await import('../../host/src/core/catalog/site-types.ts');
  agents = await import('../src/agents.ts');
  ({ packageOf, UID } = await import('../../host/test/site-type-fixture.ts'));
  ({ rawZip } = await import('../../server-sdk/test/zip-builder.ts'));
  db = limitedD1();
  driver = d1.d1Driver(db);
  await d1.ensureMigrated(driver, {});
  catalog = new core.Catalog(driver, { signingKeys: KEYS });
  const root = await catalog.createUser({ name: 'Root', siteRole: 'admin' } as never);
  admin = { id: root.id, siteRole: 'admin' };
  types = new coreTypes.SiteTypes(driver);
  services = st.cloudflareSiteTypeServices({
    driver,
    changed: async (type) => {
      told.push(type);
      if (!hubForgot) await tellRooms(type);
    },
  });
});

describe('a Cloudflare site\'s type packages in D1', () => {
  it('keeps a package in chunks within D1\'s row limit, and hands it back whole', async () => {
    // Incompressible extra files: about 3 MiB of zip, so 4+ chunks.
    const noise = (n: number): Buffer => Buffer.from(Array.from({ length: n }, (_, i) => (i * 2654435761) >>> 24));
    const big = packageOf({ id: 'big-kit', uid: 'uid-big', extra: [{ name: 'big-kit-1.0.0/artifact-type/a.bin', data: noise(1_600_000), method: 0 } as never, { name: 'big-kit-1.0.0/artifact-type/b.bin', data: noise(1_500_000), method: 0 } as never] });
    const { row, change } = await publish(big);
    assert.equal(change, 'new');
    const kept = db.sqlite.prepare('SELECT n, length(data) AS size FROM type_package_chunks WHERE uid = ? ORDER BY n').all('uid-big') as Array<{ n: number; size: number }>;
    assert.equal(kept.length, Math.ceil(big.byteLength / st.CHUNK_BYTES));
    for (const chunk of kept) assert.ok(chunk.size <= 1024 * 1024 && chunk.size < D1_ROW_BYTES * 0.6, `chunk ${chunk.n} is ${chunk.size} bytes`);
    assert.deepEqual(await services.package(row.uid, row.version), big);
    assert.deepEqual(told, ['big-kit']);
    await services.removeFiles('uid-big');
    assert.equal(await services.package('uid-big', '1.0.0'), null);
    await types.remove('uid-big');
  });

  it('refuses a package past 16 MiB naming the limit and the Node site, before reading it, and on the Link the same', async () => {
    const tooBig = new Uint8Array(st.CLOUDFLARE_TYPE_MAX_BYTES + 1);
    await assert.rejects(services.read(tooBig), (error: { code?: string; message: string }) => error.code === 'too_large' && /16 MiB/.test(error.message) && /Node site/.test(error.message));
    // The Link's cap on the body: a declared length past it at once, a streamed one as it passes.
    const declared = () => agents.cappedRequest(new Request('http://x/', { method: 'POST', headers: { 'content-length': String(17 * 1024 * 1024) }, body: 'x' }), st.CLOUDFLARE_TYPE_MAX_BYTES, 'The package', () => st.tooLargePackage());
    assert.throws(declared, (error: { code?: string; message: string }) => error.code === 'too_large' && /16 MiB/.test(error.message) && /Node site/.test(error.message));
    const streamed = agents.cappedRequest(new Request('http://x/', { method: 'POST', body: new Blob([new Uint8Array(17 * 1024 * 1024)]).stream(), duplex: 'half' } as RequestInit), st.CLOUDFLARE_TYPE_MAX_BYTES, 'The package', () => st.tooLargePackage());
    await assert.rejects(core.readBody(streamed, 100 * 1024 * 1024), (error: { code?: string; message: string }) => error.code === 'too_large' && /Node site/.test(error.message));
  });

  it('takes only page-kind types, as the Node site does', async () => {
    await assert.rejects(services.read(packageOf({ html: null })), (e: { code?: string; message: string }) => e.code === 'unsupported' && /no index.html/.test(e.message));
    await assert.rejects(services.read(packageOf({ manifest: { entry: 'server.js' } })), (e: { code?: string }) => e.code !== undefined);
    await assert.rejects(services.read(new Uint8Array([1, 2, 3])), (e: { code?: string }) => e.code === 'bad_archive');
  });

  it('switches versions: the new one written whole before the row moves, the old one\'s rows deleted after', async () => {
    const first = await publish(packageOf());
    assert.equal(first.change, 'new');
    assert.deepEqual(versions(), [{ version: '1.0.0', complete: 1, chunks: 1 }]);
    const next = await publish(packageOf({ version: '1.1.0' }));
    assert.equal(next.change, 'version');
    assert.deepEqual(versions(), [{ version: '1.1.0', complete: 1, chunks: 1 }]);
    assert.deepEqual(await services.package(UID, '1.1.0'), packageOf({ version: '1.1.0' }));
    assert.equal(await services.package(UID, '1.0.0'), null);
  });

  it('a write that fails half way leaves the served version as it was; the next try replaces what it left', async () => {
    const candidate = await services.read(packageOf({ version: '1.2.0' }));
    await types.plan(candidate, admin);
    db.failNext('INSERT INTO type_package_chunks');
    await assert.rejects(services.store(candidate, packageOf({ version: '1.2.0' })));
    // The Link route stops there: the row still says 1.1.0, whose package is whole; 1.2.0 is never handed out.
    assert.equal((await types.byId('poll-kit'))!.version, '1.1.0');
    assert.deepEqual(await services.package(UID, '1.1.0'), packageOf({ version: '1.1.0' }));
    assert.equal(await services.package(UID, '1.2.0'), null);
    assert.deepEqual(versions(), [{ version: '1.1.0', complete: 1, chunks: 1 }, { version: '1.2.0', complete: 0, chunks: 1 }]);
    await services.store(candidate, packageOf({ version: '1.2.0' }));
    assert.deepEqual(await services.package(UID, '1.2.0'), packageOf({ version: '1.2.0' }));
    await services.removeFiles(UID, '1.2.0');
    assert.deepEqual(versions(), [{ version: '1.1.0', complete: 1, chunks: 1 }]);
  });

  it('removes every version of a type', async () => {
    await services.removeFiles(UID);
    assert.deepEqual(versions(), []);
    await types.remove(UID);
    assert.equal(await types.byId('poll-kit'), undefined);
  });

  it('names a published type in an archive as the Node site: type_missing, type_mismatch, delisted is not_granted', () => {
    const row = { id: 'poll-kit', uid: UID, unpublished: false } as import('../src/site-types.ts').SiteTypeRow;
    const rules = st.siteTypeImportRules([row], (type) => type === 'page' || type === 'doc');
    assert.deepEqual(rules.markerTypes, ['poll-kit']);
    rules.inspect({ type: 'poll-kit', typeUid: UID });
    rules.inspect({ type: 'doc' });
    assert.throws(() => rules.inspect({ type: 'quiz-kit', typeUid: 'uid-q' }), (e: { code?: string; message: string; fix?: string }) => e.code === 'type_missing' && /quiz-kit.*uid-q/.test(e.message) && /types publish quiz-kit/.test(e.fix ?? ''));
    assert.throws(() => rules.inspect({ type: 'poll-kit' }), (e: { code?: string }) => e.code === 'type_mismatch');
    assert.throws(() => rules.inspect({ type: 'poll-kit', typeUid: 'other' }), (e: { code?: string }) => e.code === 'type_mismatch');
    const delisted = st.siteTypeImportRules([{ ...row, unpublished: true }], () => false);
    assert.throws(() => delisted.inspect({ type: 'poll-kit', typeUid: UID }), (e: { code?: string; message: string }) => e.code === 'not_granted' && /unpublished/.test(e.message));
  });
});

describe("a published type's SKILL.md and its download, on D1", () => {
  const SKILL_UID = 'uid-skill';
  /** A package of `id` (its own uid), with `files` as its other entries and `manifest` merged (no SKILL.md unless given). */
  const kit = (o: { version?: string; manifest?: Record<string, unknown>; files?: Record<string, string | Buffer>; stored?: Record<string, Buffer> } = {}): Uint8Array => {
    const version = o.version ?? '1.0.0';
    const top = `skill-kit-${version}`;
    const manifest = { slug: 'skill-kit', uid: SKILL_UID, name: 'Skill kit', version, description: 'A kit.', ...o.manifest };
    const html = '<!doctype html><title>Skill kit</title><script>\n// artifact.json\nvar key = "skill";\nvar capabilities = { db: {} };\nvar monitoring = {};\n// end of artifact.json\n</script><p>kit</p>';
    return new Uint8Array(
      rawZip([
        { name: `${top}/artifact-type.json`, data: JSON.stringify(manifest) },
        { name: `${top}/index.html`, data: html },
        ...Object.entries(o.files ?? {}).map(([name, data]) => ({ name: `${top}/${name}`, data })),
        // Stored, not deflated: they keep their size in the zip.
        ...Object.entries(o.stored ?? {}).map(([name, data]) => ({ name: `${top}/${name}`, data, method: 0 })),
      ]),
    );
  };
  const chunkReads = (): number => db.statements.filter((sql) => sql.includes('FROM type_package_chunks')).length;
  const skillRow = (version = '1.0.0'): { skill: string | null } | undefined => ((r) => (r ? { ...r } : undefined))(db.sqlite.prepare('SELECT skill FROM type_skills WHERE uid = ? AND version = ?').get(SKILL_UID, version) as { skill: string | null } | undefined);
  const drain = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => new Uint8Array(await new Response(stream).arrayBuffer());

  after(async () => {
    await services.removeFiles(SKILL_UID);
    await types.remove(SKILL_UID).catch(() => undefined);
  });

  it('keeps the SKILL.md when the version is stored: shown with no read of the package', async () => {
    await publish(kit({ files: { 'SKILL.md': '# Skill kit\nWrite things.' } }));
    assert.deepEqual(skillRow(), { skill: '# Skill kit\nWrite things.' });
    db.statements.length = 0;
    assert.equal(await services.skill!(SKILL_UID, '1.0.0'), '# Skill kit\nWrite things.');
    assert.equal(chunkReads(), 0, 'no chunk read to show it');
  });

  it('reads it from the package once for a version stored before it was kept, then keeps it', async () => {
    db.sqlite.prepare('DELETE FROM type_skills').run();
    db.statements.length = 0;
    const [one, two] = await Promise.all([services.skill!(SKILL_UID, '1.0.0'), services.skill!(SKILL_UID, '1.0.0')]);
    assert.equal(one, '# Skill kit\nWrite things.');
    assert.equal(two, one);
    assert.equal(chunkReads(), 1, 'one read of the package for both');
    assert.deepEqual(skillRow(), { skill: '# Skill kit\nWrite things.' });
    db.statements.length = 0;
    assert.equal(await services.skill!(SKILL_UID, '1.0.0'), '# Skill kit\nWrite things.');
    assert.equal(chunkReads(), 0, 'kept: not read again');
    // A version that is not there whole keeps nothing (asked again next time); an unknown one is null.
    assert.equal(await services.skill!(SKILL_UID, '9.9.9'), null);
    assert.equal(skillRow('9.9.9'), undefined);
    assert.equal(await services.skill!('../x', '1.0.0'), null);
  });

  it('cuts it at SITE_TYPE_SKILL_MAX, reads the file the manifest names, and keeps none when there is none', async () => {
    const long = `# Long\n${'é'.repeat(core.SITE_TYPE_SKILL_MAX)}`;
    await publish(kit({ version: '1.1.0', files: { 'SKILL.md': long } }));
    const cut = await services.skill!(SKILL_UID, '1.1.0');
    assert.equal(cut?.length, core.SITE_TYPE_SKILL_MAX);
    assert.equal(cut, long.slice(0, core.SITE_TYPE_SKILL_MAX));
    await publish(kit({ version: '1.2.0', manifest: { skill: 'docs/HOW.md' }, files: { 'SKILL.md': 'not this one', 'docs/HOW.md': '# How\nThis one.' } }));
    assert.equal(await services.skill!(SKILL_UID, '1.2.0'), '# How\nThis one.');
    db.sqlite.prepare('DELETE FROM type_skills').run();
    assert.equal(await services.skill!(SKILL_UID, '1.2.0'), '# How\nThis one.', 'the named file, read from the package too');
    await publish(kit({ version: '1.3.0' }));
    assert.deepEqual(skillRow('1.3.0'), { skill: null }, 'kept: it has none');
    db.statements.length = 0;
    assert.equal(await services.skill!(SKILL_UID, '1.3.0'), null);
    assert.equal(chunkReads(), 0);
    // Removing a version's files removes its SKILL.md.
    assert.deepEqual(db.sqlite.prepare('SELECT version FROM type_skills WHERE uid = ? ORDER BY version').all(SKILL_UID).map((r) => (r as { version: string }).version), ['1.3.0'], 'the old versions\' went with their files');
  });

  it('streams the download from D1: whole, a few chunks a query, the core\'s headers; HEAD reads no chunk', async () => {
    const noise = (n: number): Buffer => Buffer.from(Array.from({ length: n }, (_, i) => (i * 2654435761) >>> 24));
    const big = kit({ version: '2.0.0', stored: { 'artifact-type/a.bin': noise(2_000_000), 'artifact-type/b.bin': noise(1_800_000) } });
    const { row } = await publish(big);
    const chunks = Math.ceil(big.byteLength / st.CHUNK_BYTES);
    assert.ok(chunks > st.READ_BATCH, `${chunks} chunks`);
    db.statements.length = 0;
    const head = await st.packageHead(driver, row.uid, row.version, row.sha256);
    assert.deepEqual(head, { sha256: row.sha256, bytes: big.byteLength, chunks });
    const typesRoutes = await import('../../host/src/core/link/types-routes.ts');
    const core0 = typesRoutes.siteTypePackageResponse(row, big, 'HEAD', 'Ada Lovelace');
    let made = 0;
    const headAnswer = st.packageDownload(row, head!, 'HEAD', 'Ada Lovelace', () => {
      made++;
      return st.packageStream(driver, row.uid, row.version, head!);
    });
    assert.equal(made, 0, 'HEAD makes no stream');
    assert.equal(headAnswer.body, null);
    assert.equal(chunkReads(), 0, 'HEAD reads no chunk');
    assert.deepEqual([...headAnswer.headers].sort(), [...core0.headers].sort(), "the core's headers, the length included");
    const answer = st.packageDownload(row, head!, 'GET', 'Ada Lovelace', () => st.packageStream(driver, row.uid, row.version, head!));
    assert.deepEqual([...answer.headers].sort(), [...core0.headers].sort());
    assert.equal(chunkReads(), 0, 'nothing read before the body is');
    assert.deepEqual(await drain(answer.body!), big, 'the body is whole');
    assert.equal(chunkReads(), Math.ceil(chunks / st.READ_BATCH), `${st.READ_BATCH} chunks a query`);
  });

  it('a package that changed in D1 never arrives whole: the stream fails before its last chunk', async () => {
    const row = (await types.byId('skill-kit'))!;
    const head = (await st.packageHead(driver, row.uid, row.version, row.sha256))!;
    const last = head.chunks - 1;
    const kept = db.sqlite.prepare('SELECT data FROM type_package_chunks WHERE uid = ? AND version = ? AND n = ?').get(row.uid, row.version, last) as { data: string };
    const changed = Buffer.from(kept.data, 'base64');
    changed[0] = changed[0]! ^ 0xff;
    db.sqlite.prepare('UPDATE type_package_chunks SET data = ? WHERE uid = ? AND version = ? AND n = ?').run(changed.toString('base64'), row.uid, row.version, last);
    try {
      const reader = st.packageStream(driver, row.uid, row.version, head).getReader();
      let got = 0;
      await assert.rejects(
        (async () => {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            got += value.byteLength;
          }
        })(),
        (e: { message: string }) => /sha256/.test(e.message),
      );
      assert.equal(got, last * st.CHUNK_BYTES, 'every chunk but the last');
      // A chunk gone: the same.
      db.sqlite.prepare('DELETE FROM type_package_chunks WHERE uid = ? AND version = ? AND n = 1').run(row.uid, row.version);
      await assert.rejects(drain(st.packageStream(driver, row.uid, row.version, head)), (e: { message: string }) => /missing/.test(e.message));
    } finally {
      await services.removeFiles(SKILL_UID);
      await types.remove(SKILL_UID);
    }
    assert.equal(await st.packageHead(driver, row.uid, row.version), null, 'removed: no head');
  });
});

describe('an artifact of a published type in its object', () => {
  let config: import('@open-artifact/host').HostConfig;
  type ArtifactRow = import('@open-artifact/host').ArtifactRow;
  type Principal = import('@open-artifact/host').Principal;
  type UserRecord = import('@open-artifact/host').UserRecord;
  let ada: UserRecord, bob: UserRecord;
  let art: ArtifactRow;
  interface Live {
    room: InstanceType<Rooms['ArtifactRoom']>;
    ws: ReturnType<typeof sockets>;
    storage: TestStorage;
  }
  const live = new Map<string, Live>();
  const watched: Array<[string, string]> = [];
  const hub = {
    async emit() {},
    async online() {
      return false;
    },
    async watchType(room: string, type: string) {
      watched.push([room, type]);
    },
  };

  const objectOf = async (artifact: ArtifactRow, files?: Record<string, string>): Promise<Live> => {
    const known = live.get(artifact.id);
    if (known) return known;
    const ws = sockets();
    const storage = testStorage();
    let room: InstanceType<Rooms['ArtifactRoom']> | null = null;
    const typesHere = st.withCatalogTypes(frames.bundledFrameTypes(frameBuild(), (request) => assets.fetch(request)), st.catalogFrameTypes({ driver, storage, now: () => Date.now() + skew }));
    const host = roomHosts.createProductRoomHost({ config, catalog, hub, rootOf: (id) => room!.rootOf(id), pages: { types: typesHere, network: 'self' } });
    room = new rooms.ArtifactRoom({ storage, id: { toString: () => artifact.id, name: artifact.id } }, { ASSETS: assets }, {
      host: host.host,
      pair: ws.pair,
      upgraded: (_client, headers) => new Response(null, { status: 204, headers: { 'x-upgraded': '1', ...(headers ?? {}) } }),
      log: () => undefined,
    });
    if (files) await room.seed(artifact.id, files);
    const made = { room, ws, storage };
    live.set(artifact.id, made);
    return made;
  };
  const user = (record: UserRecord): Principal => ({ kind: 'user', id: record.id, name: record.name, siteRole: record.siteRole });
  const contentHost = (id: string): string => new URL(core.contentOriginOf(config, id)).host;
  const at = async (artifact: ArtifactRow, host: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; body: string }> => {
    const { room } = await objectOf(artifact);
    const answer = await room.fetch(new Request(`http://${host}${path}`, { headers: { [rooms.ARTIFACT_HEADER]: artifact.id, ...headers } }));
    return { status: answer.status, headers: answer.headers, body: await answer.text() };
  };
  const shellPath = async (artifact: ArtifactRow, principal: Principal, role: import('@open-artifact/host').ArtifactRole): Promise<string> => {
    const token = await core.signPageToken(core.pageTokenClaims({ artifact: artifact.id, principal, role, grantsVersion: artifact.grantsVersion, epoch: await catalog.siteEpoch(), now: new Date() }), KEYS);
    return `/page/${encodeURIComponent(token)}/`;
  };
  const sessionOf = async (artifact: ArtifactRow, principal: Principal, role: import('@open-artifact/host').ArtifactRole): Promise<Record<string, any>> => {
    const answer = await at(artifact, contentHost(artifact.id), `${await shellPath(artifact, principal, role)}api/frame/session`);
    assert.equal(answer.status, 200, answer.body);
    return JSON.parse(answer.body) as Record<string, any>;
  };
  const pageOf = async (artifact: ArtifactRow, principal: Principal, role: import('@open-artifact/host').ArtifactRole): Promise<{ host: string; ver: string }> => {
    const session = await sessionOf(artifact, principal, role);
    return { host: new URL(session.contentOrigin as string).host, ver: String(session.ver) };
  };

  before(async () => {
    config = {
      appOrigin: 'http://localhost:8787',
      contentOrigin: 'http://{id}.content.localhost:8787',
      signingKeys: KEYS,
      auth: [{ kind: 'owner-key' }],
      owners: [],
      signup: 'invite',
      linkMaxRole: 'editor',
      publicAccess: true,
    };
    ada = await catalog.createUser({ name: 'Ada' });
    bob = await catalog.createUser({ name: 'Bob' });
    tellRooms = async (type) => {
      for (const { room } of live.values()) await room.typeChanged(type);
    };
    await publish(packageOf());
    art = await catalog.createArtifact({ type: 'poll-kit', title: 'Lunch poll', ownerUser: ada.id });
    await catalog.upsertGrant({ artifactId: art.id, subjectKind: 'user', subject: bob.id, role: 'viewer', createdBy: ada.id });
    await objectOf(art, { '.artifact.json': JSON.stringify({ type: 'poll-kit', typeUid: UID, id: art.id, title: 'Lunch poll' }), 'poll.json': JSON.stringify({ title: 'Lunch poll' }) });
  });

  after(async () => {
    for (const { room } of live.values()) await room.destroy().catch(() => undefined);
  });

  it('opens on the frame engine, its CSP from the manifest, its type files no-cache with an ETag; the hub is told', async () => {
    const owner = await sessionOf(art, user(ada), 'owner');
    assert.equal(owner.me.isOwner, true);
    assert.equal((await sessionOf(art, user(bob), 'viewer')).me.canEdit, false, 'a viewer\'s level');
    const { host, ver } = await pageOf(art, user(ada), 'owner');
    const index = await at(art, host, `/_f/${ver}/`);
    assert.equal(index.status, 200, index.body);
    assert.match(index.body, /v1\.0\.0/);
    assert.equal(index.headers.get('content-security-policy'), installedTypeCsp([]));
    const css = await at(art, host, `/_f/${ver}/artifact-type/poll.css`);
    assert.equal(css.body, '/* 1.0.0 */');
    assert.equal(css.headers.get('cache-control'), 'no-cache');
    const etag = css.headers.get('etag');
    assert.ok(etag);
    assert.equal((await at(art, host, `/_f/${ver}/artifact-type/poll.css`, { 'if-none-match': etag! })).status, 304);
    assert.deepEqual(watched, [[art.id, 'poll-kit']]);
    // Copied once into the object's SQLite.
    const { storage } = live.get(art.id)!;
    assert.equal((storage.db.prepare(`SELECT COUNT(*) AS n FROM ${st.ROOM_TYPE_VERSIONS_TABLE}`).get() as { n: number }).n, 1);
  });

  it('runs frame actions and reads its title where titleFrom says', async () => {
    const { room } = live.get(art.id)!;
    assert.ok(await room.action('info', {}));
    assert.equal(await room.contentTitle('poll-kit'), 'Lunch poll');
  });

  it('a new version reaches an open page: it rewires, the new files and the new CSP; the old copy goes', async () => {
    const path = await shellPath(art, user(ada), 'owner');
    const answer = await at(art, contentHost(art.id), `${path}api/frame/events?c=client-5678`, { upgrade: 'websocket', connection: 'Upgrade', origin: core.contentOriginOf(config, art.id) });
    assert.equal(answer.headers.get('x-upgraded'), '1', answer.body);
    const { ws, storage } = live.get(art.id)!;
    const socket = ws.made.at(-1)!;
    await until(() => socket.sent.length > 0);
    const before = socket.sent.length;
    await publish(packageOf({ version: '1.1.0', network: ['https://api.example.com'] }));
    await until(() => socket.sent.slice(before).some((m) => m.includes('"rewired"') && m.includes('"type"')));
    const { host, ver } = await pageOf(art, user(ada), 'owner');
    const index = await at(art, host, `/_f/${ver}/`);
    assert.match(index.body, /v1\.1\.0/);
    assert.equal(index.headers.get('content-security-policy'), installedTypeCsp(['https://api.example.com']));
    assert.equal((await at(art, host, `/_f/${ver}/artifact-type/poll.css`)).body, '/* 1.1.0 */');
    const fps = storage.db.prepare(`SELECT fp FROM ${st.ROOM_TYPE_VERSIONS_TABLE}`).all() as Array<{ fp: string }>;
    assert.deepEqual(fps.map((r) => r.fp), [`${UID}@1.1.0:${(await types.byId('poll-kit'))!.sha256.slice(0, 16)}`]);
    assert.equal(socket.closed, null, 'the page stays connected');
  });

  it('imports an artifact of it by type and uid, its title from titleFrom; another uid or an unknown type is refused', async () => {
    const copy = await catalog.createArtifact({ type: 'poll-kit', title: 'Copy', ownerUser: ada.id });
    const into = await objectOf(copy);
    assert.deepEqual(await into.room.importArtifact(artifactArchive({ title: 'Dinner poll' }), { id: copy.id }), { type: 'poll-kit', title: 'Dinner poll' });
    const other = await catalog.createArtifact({ type: 'poll-kit', title: 'Other', ownerUser: ada.id });
    const refused = await objectOf(other);
    await assert.rejects(refused.room.importArtifact(artifactArchive({ typeUid: 'someone-else' }), { id: other.id }), (e: { code?: string }) => e.code === 'type_mismatch');
    await assert.rejects(refused.room.importArtifact(artifactArchive({ type: 'quiz-kit', typeUid: 'uid-q' }), { id: other.id }), (e: { code?: string }) => e.code === 'type_missing');
    // An export of it imports again (duplicate): its marker carries the uid.
    const zip = new Uint8Array(await new Response(await live.get(art.id)!.room.archive({ folder: 'Lunch' })).arrayBuffer());
    const dup = await catalog.createArtifact({ type: 'poll-kit', title: 'Dup', ownerUser: ada.id });
    assert.equal((await (await objectOf(dup)).room.importArtifact(zip, { id: dup.id })).type, 'poll-kit');
  });

  it('with the hub gone, a request after the row memo finds the new version; a large index.html is kept in rows', async () => {
    const { ws, storage } = live.get(art.id)!;
    const socket = ws.made.at(-1)!;
    const before = socket.sent.length;
    hubForgot = true;
    // 3 MiB of index.html: more than one row of the object's SQLite.
    const filler = `<!-- ${'x'.repeat(3 * 1024 * 1024)} -->`;
    const html = `<!doctype html><title>Poll 1.2.0</title><script>\n// artifact.json\nvar key = "poll";\nvar capabilities = { db: {}, comments: {} };\nvar monitoring = {};\n// end of artifact.json\n</script>${filler}<p>v1.2.0</p>`;
    try {
      await publish(packageOf({ version: '1.2.0', html }));
      // Within the memo the object still serves 1.1.0.
      let page = await pageOf(art, user(ada), 'owner');
      assert.match((await at(art, page.host, `/_f/${page.ver}/`)).body, /v1\.1\.0/);
      skew += st.ROW_MAX_AGE_MS + 100;
      page = await pageOf(art, user(ada), 'owner');
      await until(() => socket.sent.slice(before).some((m) => m.includes('"rewired"')));
      page = await pageOf(art, user(ada), 'owner');
      const index = await at(art, page.host, `/_f/${page.ver}/`);
      assert.match(index.body, /v1\.2\.0/);
      assert.ok(index.body.includes(filler), "the whole index.html is served");
      assert.equal((storage.db.prepare(`SELECT index_html FROM ${st.ROOM_TYPE_VERSIONS_TABLE}`).get() as { index_html: string | null }).index_html, null);
      const biggest = storage.db.prepare(`SELECT MAX(length(data)) AS n FROM ${st.ROOM_TYPE_FILES_TABLE}`).get() as { n: number };
      assert.ok(biggest.n <= st.ROOM_CHUNK_BYTES, `a row of ${biggest.n} bytes`);
    } finally {
      hubForgot = false;
    }
  });

  it('delisted, it keeps running (nothing reloads) and takes no new artifact', async () => {
    const { ws } = live.get(art.id)!;
    const socket = ws.made.at(-1)!;
    const before = socket.sent.length;
    await types.delist(UID);
    await services.activated((await types.byId('poll-kit'))!);
    assert.equal(socket.sent.slice(before).some((m) => m.includes('"rewired"')), false);
    assert.equal(socket.closed, null);
    await sessionOf(art, user(ada), 'owner');
    const fresh = await catalog.createArtifact({ type: 'poll-kit', title: 'New', ownerUser: ada.id });
    await assert.rejects((await objectOf(fresh)).room.importArtifact(artifactArchive(), { id: fresh.id }), (e: { code?: string }) => e.code === 'not_granted');
  });

  it('scaffolded through the room call, its folder is the marker the Node site writes, and it opens', async () => {
    const calls = await import('../src/room-calls.ts');
    const made = await catalog.createArtifact({ type: 'poll-kit', title: 'Made by an agent', ownerUser: ada.id });
    const { room } = await objectOf(made);
    const client = new calls.RoomClient({ fetch: (request) => calls.handleRoomCall(room, { refresh: async () => ({ dropped: 0 }) }, request) }, made.id);
    const source = `${config.appOrigin}/t/poll-kit`;
    await client.create('poll-kit', made.title, { typeUid: UID, typeSource: source });
    const root = room.rootOf(made.id);
    const fs = await import('../src/fs/index.ts');
    assert.deepEqual(fs.readdirSync(root), ['.artifact.json'], 'nothing but the marker');
    const text = String(fs.readFileSync(`${root}/.artifact.json`, 'utf8'));
    assert.equal(text, `${JSON.stringify({ type: 'poll-kit', id: made.id, title: 'Made by an agent', release: null, typeUid: UID, typeSource: source }, null, 2)}\n`);
    // Twice: the folder is there.
    await assert.rejects(client.create('poll-kit', made.title, { typeUid: UID, typeSource: source }), (e: { code?: string; status?: number }) => e.code === 'exists' && e.status === 409);
    // It opens on the frame engine (its type's page, no content yet).
    const session = await sessionOf(made, user(ada), 'owner');
    assert.equal(session.me.isOwner, true);
    const { host, ver } = await pageOf(made, user(ada), 'owner');
    assert.equal((await at(made, host, `/_f/${ver}/`)).status, 200);
    // Without typeSource the marker leaves it out; a built-in or page type is refused as a published type.
    const bare = await catalog.createArtifact({ type: 'poll-kit', title: 'Bare', ownerUser: ada.id });
    const bareRoom = (await objectOf(bare)).room;
    await bareRoom.create({ id: bare.id, type: 'poll-kit', title: 'Bare', typeUid: UID });
    assert.deepEqual(Object.keys(JSON.parse(String(fs.readFileSync(`${bareRoom.rootOf(bare.id)}/.artifact.json`, 'utf8')))), ['type', 'id', 'title', 'release', 'typeUid']);
    for (const type of ['page', 'whiteboard']) {
      const other = await catalog.createArtifact({ type, title: 'No', ownerUser: ada.id });
      await assert.rejects((await objectOf(other)).room.create({ id: other.id, type, title: 'No', typeUid: UID }), (e: { code?: string }) => e.code === 'invalid_argument');
    }
  });

  it('a room with no pages refuses to scaffold a published type', async () => {
    const storage = testStorage();
    const made = await catalog.createArtifact({ type: 'poll-kit', title: 'Nowhere', ownerUser: ada.id });
    let room: InstanceType<Rooms['ArtifactRoom']> | null = null;
    const host = roomHosts.createProductRoomHost({ config, catalog, hub, rootOf: (id) => room!.rootOf(id) });
    room = new rooms.ArtifactRoom({ storage, id: { toString: () => made.id, name: made.id } }, { ASSETS: assets }, { host: host.host, pair: sockets().pair, upgraded: () => new Response(null, { status: 204 }), log: () => undefined });
    await assert.rejects(room.create({ id: made.id, type: 'poll-kit', title: 'Nowhere', typeUid: UID }), (e: { code?: string; message?: string }) => e.code === 'invalid_argument' && /runs no published types/.test(e.message ?? ''));
    await room.destroy().catch(() => undefined);
  });

  it('removed, the open core closes (its pages\' connections end) and nothing of it opens', async () => {
    const { ws, room } = live.get(art.id)!;
    const socket = ws.made.at(-1)!;
    const row = (await types.byId('poll-kit'))!;
    await types.remove(UID);
    await services.removed(row);
    await services.removeFiles(UID);
    assert.notEqual(socket.closed, null);
    assert.equal((await room.stats()).open, 0);
    const answer = await at(art, contentHost(art.id), `${await shellPath(art, user(ada), 'owner')}api/frame/session`);
    assert.notEqual(answer.status, 200);
  });
});
