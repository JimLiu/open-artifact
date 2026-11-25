/**
 * Starting an artifact without an agent: an empty artifact (its type's marker file not written yet) boots `empty`,
 * and the Shell does not open its page; opening its page (`openPage`) is what has the type server write its type's
 * starting files. `artifacts.create { blank: true }` and `artifacts.blank` do that, with the real built-in types.
 */

import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { artifactIdOf, type ArtifactView, type DaemonState, type ShellBoot } from '@open-artifact/protocol';
import { readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';

let daemon: Daemon;
let state: DaemonState;
const home = tempDir('open-artifact-blank-ws-');

before(async () => {
  daemon = await startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
  state = (await readDaemon())!;
});

after(() => daemon.close());

/** A JSON POST from the daemon's own page (same origin), as the home page and the Shell send. */
async function post<T>(name: string, body: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${state.url}/api/open-artifact.${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: state.url },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
}

async function boot(id: string): Promise<ShellBoot> {
  const response = await fetch(`${state.url}/api/open-artifact.artifacts.boot?id=${id}`);
  assert.equal(response.status, 200);
  return (await response.json()) as ShellBoot;
}

const MARKERS: Record<string, string> = {
  docs: 'doc/doc.json',
  sheets: 'sheet/sheet.json',
  whiteboard: 'db/board/meta.json',
  slides: 'project/deck.json',
  'design-system': 'project/design-system.json',
};

test('today: an empty artifact boots empty and the Shell leaves its page closed; opening its page writes the starting files', { timeout: 60000 }, async () => {
  const made = await post<ArtifactView>('artifacts.create', { type: 'docs', title: 'Pinned', folder: join(home, 'pinned') });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const marker = join(made.body.root, MARKERS.docs!);
  assert.equal(existsSync(marker), false, 'artifacts.create writes no content');
  const first = await boot(made.body.id);
  assert.equal(first.empty, true);
  assert.equal(first.page, null, 'shellBoot returns before opening the page');
  assert.equal(existsSync(marker), false, 'booting the Shell writes nothing');
  // artifacts.open (and Artifact open) do not look at `empty`: the type server writes the scaffold.
  const opened = await post<{ page: string }>('artifacts.open', { id: made.body.id, host: false });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(existsSync(marker), true, 'the type server wrote its scaffold');
  const second = await boot(made.body.id);
  assert.equal(second.empty, false);
  assert.ok(second.page, 'the page opens now');
});

test('artifacts.create { blank: true }: each "start blank" type comes back not empty, its starting files written, owned by nobody', { timeout: 120000 }, async () => {
  for (const type of ['docs', 'sheets', 'whiteboard', 'slides', 'design-system']) {
    const made = await post<ArtifactView & { prompt: string | null }>('artifacts.create', { type, title: `Blank ${type}`, folder: join(home, `blank-${type}`), blank: true });
    assert.equal(made.status, 201, `${type}: ${JSON.stringify(made.body)}`);
    assert.equal(made.body.prompt, null, `${type}: no hand-over prompt`);
    assert.equal(made.body.owner, null);
    assert.equal(existsSync(join(made.body.root, MARKERS[type]!)), true, `${type}: the marker file is written`);
    const record = daemon.store.require(made.body.id);
    assert.equal(record.owner, null, type);
    assert.equal(record.createdBy, null, type);
    const booted = await boot(made.body.id);
    assert.equal(booted.empty, false, `${type}: not empty`);
    assert.ok(booted.page, `${type}: its page opens`);
  }
});

test('artifacts.create { blank: true } of a type that writes no starting files is refused and keeps nothing', async () => {
  const before = daemon.store.list().length;
  const folder = join(home, 'blank-refused');
  // A user frame type with marker files its (absent) server would write: nothing writes them.
  const dir = join(process.env.OPEN_ARTIFACT_USER_TYPES!, 'marked');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'artifact-type.json'), JSON.stringify({ name: 'marked', description: 'A page type with a marker file.', detect: ['notes.json'] }));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>marked</title>');
  const refused = await post<{ code: string; message: string }>('artifacts.create', { type: 'marked', title: 'Never', folder, blank: true });
  assert.equal(refused.body.code, 'unsupported', JSON.stringify(refused.body));
  assert.match(refused.body.message, /writes no starting files/);
  assert.equal(daemon.store.list().length, before, 'no record kept');
  assert.equal(existsSync(folder), false, 'no folder kept');
});

test('artifacts.blank: an empty artifact made earlier is started blank; its owner stays as it was', { timeout: 60000 }, async () => {
  const made = await post<ArtifactView>('artifacts.create', { type: 'whiteboard', title: 'Later', folder: join(home, 'later') });
  assert.equal(made.status, 201);
  assert.equal((await boot(made.body.id)).empty, true);
  const started = await post<ArtifactView>('artifacts.blank', { id: made.body.id });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.owner, null);
  assert.equal(existsSync(join(made.body.root, MARKERS.whiteboard!)), true);
  assert.equal((await boot(made.body.id)).empty, false);
  // Again: nothing to do, the same answer.
  const again = await post<ArtifactView>('artifacts.blank', { id: made.body.id });
  assert.equal(again.status, 200);
  assert.equal(again.body.id, made.body.id);
  const record = daemon.store.require(made.body.id);
  assert.equal(record.owner, null);
  assert.equal(record.createdBy, null);
});

test('artifacts.blank keeps the owner of an empty artifact an agent made', { timeout: 60000 }, async () => {
  const caller = { harness: 'claude-code', session: 'blank-owner', workspace: home };
  const made = await daemon.tools.call('Artifact', { action: 'publish', type_url: 'open-artifact://type/slides', title: 'Theirs', folder: join(home, 'theirs'), open: 'never' }, caller);
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  const id = artifactIdOf(String(made.url))!;
  assert.equal((await boot(id)).empty, true);
  const started = await post<ArtifactView>('artifacts.blank', { id });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(existsSync(join(String(made.root), MARKERS.slides!)), true);
  assert.equal(daemon.store.require(id).owner?.session, 'blank-owner');
  assert.equal(started.body.owner?.session, 'blank-owner');
});

test('a Page is never empty: blank or not, it opens as a page (nothing to write)', { timeout: 60000 }, async () => {
  for (const blank of [false, true]) {
    const made = await post<ArtifactView>('artifacts.create', { type: 'page', title: `Page ${blank}`, folder: join(home, `page-${blank}`), blank });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const booted = await boot(made.body.id);
    assert.equal(booted.empty, false);
    assert.equal(booted.prompt, null);
  }
});

test('artifacts.add: a folder with .artifact.json, and one known only by its marker files, join the library owned by nobody', { timeout: 60000 }, async () => {
  // One made elsewhere (an agent's session), then forgotten by this library: its folder keeps .artifact.json.
  const caller = { harness: 'claude-code', session: 'add-1', workspace: home };
  const made = await daemon.tools.call('Artifact', { action: 'publish', type_url: 'open-artifact://type/docs', title: 'Elsewhere', folder: join(home, 'elsewhere'), open: 'never' }, caller);
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  const root = String(made.root);
  daemon.store.remove(artifactIdOf(String(made.url))!);
  const added = await post<ArtifactView>('artifacts.add', { folder: root });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.type, 'docs');
  assert.equal(added.body.owner, null);
  const record = daemon.store.require(added.body.id);
  assert.equal(record.owner, null);
  assert.equal(record.createdBy, null);

  // No .artifact.json: the sheet's marker file says which type.
  const bare = join(home, 'bare-sheet');
  mkdirSync(join(bare, 'sheet'), { recursive: true });
  writeFileSync(join(bare, 'sheet', 'sheet.json'), JSON.stringify({ name: 'Bare' }));
  const detected = await post<ArtifactView>('artifacts.add', { folder: bare });
  assert.equal(detected.status, 201, JSON.stringify(detected.body));
  assert.equal(detected.body.type, 'sheets');
  assert.equal(daemon.store.require(detected.body.id).owner, null);
  assert.equal(daemon.store.require(detected.body.id).createdBy, null);

  // A folder the library has already: its artifact as it is, its owner kept.
  const owned = await daemon.tools.call('Artifact', { action: 'publish', type_url: 'open-artifact://type/docs', title: 'Owned', folder: join(home, 'owned'), open: 'never' }, caller);
  const again = await post<ArtifactView>('artifacts.add', { folder: String(owned.root) });
  assert.equal(again.status, 200);
  assert.equal(again.body.id, artifactIdOf(String(owned.url)));
  assert.equal(daemon.store.require(again.body.id).owner?.session, 'add-1', 'adding a known folder takes nobody\'s artifact away');

  // Nothing there, or nothing of a known type.
  assert.equal((await post<{ code: string }>('artifacts.add', { folder: join(home, 'missing') })).body.code, 'not_found');
  const plain = join(home, 'plain');
  mkdirSync(plain, { recursive: true });
  writeFileSync(join(plain, 'notes.txt'), 'hello');
  assert.equal((await post<{ code: string }>('artifacts.add', { folder: plain })).body.code, 'invalid_argument');
  assert.equal((await post<{ code: string }>('artifacts.add', { folder: 'relative/path' })).body.code, 'invalid_argument');
});

test('artifacts.relocate: the moved folder with the same id is taken; another artifact\'s folder is refused', { timeout: 60000 }, async () => {
  const made = await post<ArtifactView>('artifacts.create', { type: 'docs', title: 'Moving', folder: join(home, 'moving'), blank: true });
  assert.equal(made.status, 201);
  const other = await post<ArtifactView>('artifacts.create', { type: 'docs', title: 'Other', folder: join(home, 'other'), blank: true });
  const moved = join(home, 'moved-here');
  renameSync(made.body.root, moved);

  // Adding the moved folder points at relocate instead.
  const add = await post<{ code: string; fix?: string }>('artifacts.add', { folder: moved });
  assert.equal(add.body.code, 'conflict');
  assert.match(String(add.body.fix), /artifacts\.relocate/);

  const wrong = await post<{ code: string; message: string }>('artifacts.relocate', { id: made.body.id, folder: other.body.root });
  assert.equal(wrong.body.code, 'conflict', JSON.stringify(wrong.body));
  assert.match(wrong.body.message, new RegExp(other.body.id));
  assert.equal(daemon.store.require(made.body.id).root, made.body.root, 'the record is unchanged');
  const empty = join(home, 'not-an-artifact');
  mkdirSync(empty, { recursive: true });
  assert.equal((await post<{ code: string }>('artifacts.relocate', { id: made.body.id, folder: empty })).body.code, 'invalid_argument');
  assert.equal((await post<{ code: string }>('artifacts.relocate', { id: made.body.id, folder: join(home, 'nowhere') })).body.code, 'not_found');

  const ok = await post<ArtifactView>('artifacts.relocate', { id: made.body.id, folder: moved });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.root, moved);
  assert.equal(daemon.store.require(made.body.id).root, moved);
  const booted = await boot(made.body.id);
  assert.equal(booted.empty, false);
  assert.equal(booted.root, moved);
  assert.ok(booted.page);
});

test('the new routes take writes as artifacts.create does: from this origin as JSON, or with the token', async () => {
  for (const name of ['artifacts.create', 'artifacts.blank', 'artifacts.add', 'artifacts.relocate']) {
    const foreign = await fetch(`${state.url}/api/open-artifact.${name}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: '{}' });
    assert.equal(foreign.status, 403, `${name} from another origin`);
    const form = await fetch(`${state.url}/api/open-artifact.${name}`, { method: 'POST', headers: { 'content-type': 'text/plain', origin: state.url }, body: '{}' });
    assert.equal(form.status, 403, `${name} not as JSON`);
    const token = await fetch(`${state.url}/api/open-artifact.${name}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${state.token}` }, body: '{}' });
    assert.notEqual(token.status, 403, `${name} with the token`);
  }
});
