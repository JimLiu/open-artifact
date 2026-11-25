/**
 * What is sent from an artifact no session owns (made on the home page, a folder opened) waits in the unowned inbox
 * and follows the artifact: the session that becomes its owner by `adopt` (rule 1), by writing it (rule 2) or by the
 * person's `artifacts.assign` (rule 3) gets it, once. The App and the home page never change an owner.
 *
 * Before this change (pinned first): such a message went to the unowned inbox and nothing ever read it, and a session
 * that wrote the artifact without `adopt` left it unowned.
 */

import { tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { WAKE_PER_MINUTE, artifactUrl, type ArtifactView, type AssignArtifactResult, type DaemonState, type InboxMessage, type SessionRef } from '@open-artifact/protocol';
import { readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { Inbox } from '../src/inbox.ts';
import { ArtifactStore, sessionKeyOf } from '../src/store.ts';
import { UNOWNED_KEY, WakeRouter } from '../src/wake.ts';

let daemon: Daemon;
let state: DaemonState;
const home = tempDir('open-artifact-unowned-ws-');
let n = 0;

before(async () => {
  daemon = await startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
  state = (await readDaemon())!;
});

after(() => daemon.close());

/** A JSON POST from the daemon's own page (same origin), as the home page and the Shell send; or with other headers. */
async function post<T>(name: string, body: unknown, headers: Record<string, string> = { origin: state.url }): Promise<{ status: number; body: T }> {
  const response = await fetch(`${state.url}/api/open-artifact.${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
}

/** An artifact made on the home page: owned by nobody. */
async function made(title: string, type = 'design'): Promise<string> {
  const out = await post<ArtifactView>('artifacts.create', { type, title, folder: join(home, `a-${++n}`) });
  assert.equal(out.status, 201, JSON.stringify(out.body));
  assert.equal(daemon.store.require(out.body.id).owner, null);
  return out.body.id;
}

async function ask(id: string, text: string): Promise<string> {
  const sent = await post<{ via: string }>('artifacts.ask', { id, text });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  return sent.body.via;
}

const unownedOf = (id: string): InboxMessage[] => daemon.inbox.peek(UNOWNED_KEY).filter((m) => m.artifactId === id);
const session = (name: string, harness = 'myide'): SessionRef => ({ harness, session: name, workspace: home });
const texts = (messages: unknown): string[] => (Array.isArray(messages) ? (messages as string[]) : []);

test('a message sent while nobody owns the artifact waits in the unowned inbox, with its artifactId and no opening line', async () => {
  const id = await made('Waits');
  assert.equal(await ask(id, 'Make it blue'), 'inbox');
  const waiting = unownedOf(id);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0]!.artifactId, id);
  assert.ok(waiting[0]!.text.startsWith('[Artifact edit request sent to agent]'), waiting[0]!.text);
  assert.doesNotMatch(waiting[0]!.text, /session is gone|picked to handle/);
});

test('rule 1, adopt: the session gets what waited in that call, once; the opening says the person made it', async () => {
  const id = await made('Adopted');
  await ask(id, 'Make it blue');
  await ask(id, 'And bigger');
  const caller = session('adopter');
  const adopted = await daemon.tools.call('Artifact', { action: 'adopt', url: artifactUrl(id) }, caller);
  assert.equal(adopted.error, undefined, JSON.stringify(adopted.error));
  const got = texts(adopted.messages);
  assert.equal(got.length, 2, 'both, in the order they were sent');
  for (const text of got) {
    assert.match(text, /^\[Open Artifact\] The person made .* without an agent, and it is yours now/);
    assert.doesNotMatch(text, /call Artifact \{action: "adopt"/, 'it has just adopted it');
  }
  assert.match(got[0]!, /Make it blue/);
  assert.match(got[1]!, /And bigger/);
  assert.equal(unownedOf(id).length, 0);
  assert.equal(daemon.inbox.count(sessionKeyOf(caller)!), 0);
  const again = await daemon.tools.call('Artifact', { action: 'list' }, caller);
  assert.equal(again.messages, undefined, 'nothing a second time');
  // A later message goes straight to its owner.
  assert.equal(await ask(id, 'Now red'), 'inbox');
  assert.equal(unownedOf(id).length, 0);
  assert.equal(daemon.inbox.count(sessionKeyOf(caller)!), 1);
  daemon.inbox.take(sessionKeyOf(caller)!);
});

test('rule 1: two unowned artifacts keep their messages apart', async () => {
  const a = await made('A');
  const b = await made('B');
  await ask(a, 'For A');
  await ask(b, 'For B');
  const caller = session('picks-a');
  const adopted = await daemon.tools.call('Artifact', { action: 'adopt', url: artifactUrl(a) }, caller);
  const got = texts(adopted.messages);
  assert.equal(got.length, 1);
  assert.match(got[0]!, /For A/);
  assert.doesNotMatch(got[0]!, /For B/);
  assert.equal(unownedOf(b).length, 1, "B's message still waits for B's owner");
  // Another session that takes B gets B's only.
  const other = session('picks-b');
  const second = texts((await daemon.tools.call('Artifact', { action: 'adopt', url: artifactUrl(b) }, other)).messages);
  assert.equal(second.length, 1);
  assert.match(second[0]!, /For B/);
  // A third session adopting A later gets nothing that was already handed over.
  const third = await daemon.tools.call('Artifact', { action: 'adopt', url: artifactUrl(a) }, session('late'));
  assert.equal(third.messages, undefined);
});

test('rule 2: a session that writes an unowned artifact owns it; the write says so and carries what waited, once', async () => {
  const id = await made('Written');
  await ask(id, 'Bigger');
  const caller = session('writer');
  const wrote = await daemon.tools.call('Artifact', { action: 'publish', url: artifactUrl(id), files: { 'index.html': '<h1>Hi</h1>' } }, caller);
  assert.equal(wrote.error, undefined, JSON.stringify(wrote.error));
  assert.deepEqual(daemon.store.require(id).owner, { harness: 'myide', session: 'writer', workspace: home });
  assert.ok(texts(wrote.notes).some((note) => /had no owner session, so it is yours now: comments on it come to this session/.test(note)), JSON.stringify(wrote.notes));
  const got = texts(wrote.messages);
  assert.equal(got.length, 1);
  assert.match(got[0]!, /The person made .* it is yours now/);
  assert.match(got[0]!, /If you have not, call Artifact \{action: "adopt"/);
  assert.match(got[0]!, /Bigger/);
  assert.equal(unownedOf(id).length, 0);
  const again = await daemon.tools.call('Artifact', { action: 'publish', url: artifactUrl(id), files: { 'index.html': '<h1>Hello</h1>' } }, caller);
  assert.equal(again.messages, undefined);
  assert.ok(!texts(again.notes).some((note) => /yours now/.test(note)), 'said once');
});

test('rule 2: writing its data rows (ArtifactData) makes the session its owner too', async () => {
  const id = await made('Rows', 'data');
  await ask(id, 'Add a row');
  const caller = session('rows');
  const wrote = await daemon.tools.call('ArtifactData', { action: 'set', url: artifactUrl(id), path: 'notes/a', data: { t: 1 } }, caller);
  assert.equal(wrote.error, undefined, JSON.stringify(wrote.error));
  assert.equal(sessionKeyOf(daemon.store.require(id).owner!), sessionKeyOf(caller));
  assert.ok(texts(wrote.notes).some((note) => /yours now/.test(note)), JSON.stringify(wrote.notes));
  assert.equal(texts(wrote.messages).length, 1);
  assert.equal(unownedOf(id).length, 0);
  const read = await daemon.tools.call('ArtifactData', { action: 'get', url: artifactUrl(id), path: 'notes/a' }, session('reader'));
  assert.equal(read.error, undefined);
  assert.equal(sessionKeyOf(daemon.store.require(id).owner!), sessionKeyOf(caller), 'a read moves nothing');
});

test('a message sent while the artifact is being adopted reaches the new owner exactly once', async () => {
  const id = await made('Racing');
  await ask(id, 'First');
  const caller = session('racer');
  // Both at once: the ask in its merge window, the adopt taking what waited.
  const [, adopted] = await Promise.all([ask(id, 'Second'), daemon.tools.call('Artifact', { action: 'adopt', url: artifactUrl(id) }, caller)]);
  assert.equal(adopted.error, undefined, JSON.stringify(adopted.error));
  await new Promise((r) => setTimeout(r, 50));
  const later = await daemon.tools.call('Artifact', { action: 'list' }, caller);
  const all = [...texts(adopted.messages), ...texts(later.messages), ...daemon.inbox.peek(sessionKeyOf(caller)!).map((m) => m.text)];
  assert.equal(all.filter((t) => t.includes('First')).length, 1, JSON.stringify(all));
  assert.equal(all.filter((t) => t.includes('Second')).length, 1, JSON.stringify(all));
  assert.equal(unownedOf(id).length, 0);
});

test('rule 2: an adapter seeing the session write it (agent.wrote) hands it over too, into its inbox once', async () => {
  const id = await made('Seen');
  await ask(id, 'Seen it');
  const caller = session('seen');
  const root = daemon.store.require(id).root;
  writeFileSync(join(root, 'index.html'), '<h1>By the agent</h1>');
  daemon.tools.agentWrote(caller, [join(root, 'index.html')]);
  assert.equal(daemon.store.require(id).owner?.session, 'seen');
  const key = sessionKeyOf(caller)!;
  // No adapter takes it live here: back in the inbox, once.
  await new Promise((done) => setTimeout(done, 50));
  const waiting = daemon.inbox.take(key).filter((m) => m.artifactId === id);
  assert.equal(waiting.length, 1);
  assert.match(waiting[0]!.text, /it is yours now/);
  assert.equal(unownedOf(id).length, 0);
});

test('rule 2 does not apply to reads, to callers that are no session, or to an artifact that has an owner', async () => {
  const id = await made('Kept');
  await ask(id, 'Still waiting');
  // A read.
  const read = await daemon.tools.call('Artifact', { action: 'read', url: artifactUrl(id) }, session('reader'));
  assert.equal(read.messages, undefined);
  assert.equal(daemon.store.require(id).owner, null);
  // The home page's own caller, and a command line with no session id (a person in a terminal).
  for (const caller of [
    { harness: 'open-artifact-home', session: null, workspace: home },
    { harness: 'cli', session: null, workspace: home },
  ]) {
    const wrote = await daemon.tools.call('Artifact', { action: 'publish', url: artifactUrl(id), files: { 'a.txt': caller.harness } }, caller);
    assert.equal(wrote.error, undefined, JSON.stringify(wrote.error));
    assert.equal(daemon.store.require(id).owner, null, caller.harness);
    assert.equal(wrote.messages, undefined, caller.harness);
  }
  assert.equal(unownedOf(id).length, 1);
  // Owned by a session that is still around: another session's write leaves it with its owner (ownership.ts).
  const owner = session('owner-here');
  daemon.harnesses.remember(owner);
  await daemon.tools.call('Artifact', { action: 'adopt', url: artifactUrl(id) }, owner);
  const other = await daemon.tools.call('Artifact', { action: 'publish', url: artifactUrl(id), files: { 'b.txt': 'x' } }, session('intruder'));
  assert.equal(daemon.store.require(id).owner?.session, 'owner-here');
  assert.ok(texts(other.notes).some((note) => /belongs to another session/.test(note)));
  assert.equal(other.messages, undefined);
});

test('rule 3, artifacts.assign: the person hands it to a session online now, which gets what waited at once', async () => {
  const id = await made('Assigned');
  await ask(id, 'Please look');
  const ref = session('online');
  const { key } = daemon.harnesses.pollAttach({ harness: ref.harness, session: ref.session!, workspace: ref.workspace! });
  const assigned = await post<AssignArtifactResult>('artifacts.assign', { id, session: key });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal(assigned.body.artifact.owner?.session, 'online');
  assert.deepEqual(assigned.body.delivered, [{ via: 'live', status: 'queued' }]);
  assert.deepEqual(daemon.store.require(id).owner, ref);
  const polled = await daemon.harnesses.pollWait({ harness: ref.harness, session: ref.session!, workspace: ref.workspace!, timeoutMs: 1000 });
  assert.equal(polled.messages.length, 1);
  assert.match(polled.messages[0]!.text, /The person picked this session for .* it is yours now/);
  assert.match(polled.messages[0]!.text, /call Artifact \{action: "adopt"/);
  assert.match(polled.messages[0]!.text, /Please look/);
  assert.equal(unownedOf(id).length, 0);
  assert.equal(daemon.inbox.count(key), 0, 'delivered, not also in the inbox');
  // Its next message goes to it as well; assigning it again is refused (it has an owner now).
  const again = await post<{ code: string }>('artifacts.assign', { id, session: key });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'conflict');
  daemon.harnesses.pollDetach({ harness: ref.harness, session: ref.session!, workspace: ref.workspace! });
});

test('rule 3: artifacts.assign is the person’s; an agent, another origin, or a session not online is refused', async () => {
  const id = await made('Guarded');
  const ref = session('guard-online');
  const { key } = daemon.harnesses.pollAttach({ harness: ref.harness, session: ref.session!, workspace: ref.workspace! });
  const token = { authorization: `Bearer ${state.token}` };
  const fromAgent = await post<{ code: string }>('artifacts.assign', { id, session: key }, { ...token, 'x-open-artifact-agent': 'claude-code:abc' });
  assert.equal(fromAgent.status, 403);
  assert.equal(fromAgent.body.code, 'not_granted');
  const fromPage = await post<{ code: string }>('artifacts.assign', { id, session: key }, { ...token, origin: 'http://art-1.frame.localhost:4800' });
  assert.equal(fromPage.status, 403);
  const crossSite = await post<{ code: string }>('artifacts.assign', { id, session: key }, { ...token, 'sec-fetch-site': 'cross-site' });
  assert.equal(crossSite.status, 403);
  const unknown = await post<{ code: string }>('artifacts.assign', { id, session: 'myide:nobody' });
  assert.equal(unknown.status, 404);
  daemon.harnesses.pollDetach({ harness: ref.harness, session: ref.session!, workspace: ref.workspace! });
  const offline = await post<{ code: string }>('artifacts.assign', { id, session: key });
  assert.equal(offline.status, 404, 'a session that went offline is not offered');
  assert.equal(daemon.store.require(id).owner, null, 'none of these changed it');
  // The command line (the token, no agent header) may: it is the person in a terminal.
  const again = daemon.harnesses.pollAttach({ harness: ref.harness, session: ref.session!, workspace: ref.workspace! });
  const cli = await post<AssignArtifactResult>('artifacts.assign', { id, session: again.key }, { ...token, 'x-open-artifact-client': 'cli' });
  assert.equal(cli.status, 200, JSON.stringify(cli.body));
  daemon.harnesses.pollDetach({ harness: ref.harness, session: ref.session!, workspace: ref.workspace! });
});

test('the opening line says the original session is gone when an agent made the artifact', async () => {
  const maker = session('maker');
  const out = await daemon.tools.call('Artifact', { action: 'publish', type_url: 'open-artifact://type/design', title: 'Orphan', folder: join(home, 'orphan'), open: 'never' }, maker);
  const id = String(out.url).replace('open-artifact://artifact/', '');
  daemon.store.update(id, { owner: null });
  await ask(id, 'Who is there?');
  const got = texts((await daemon.tools.call('Artifact', { action: 'adopt', url: artifactUrl(id) }, session('heir'))).messages);
  assert.equal(got.length, 1);
  assert.match(got[0]!, /The session that made .* is no longer its owner; it is yours now/);
  assert.doesNotMatch(got[0]!, /The person made/);
});

test('the App and the home page do not change an owner: open, edit, comment, and it still goes to the owner session', async () => {
  const owner = session('keeps-it');
  const out = await daemon.tools.call('Artifact', { action: 'publish', type_url: 'open-artifact://type/design', title: 'Theirs', folder: join(home, 'theirs'), open: 'never' }, owner);
  const id = String(out.url).replace('open-artifact://artifact/', '');
  const before = daemon.store.require(id).owner;
  assert.deepEqual(before, owner);
  // Opened from the home page or the App (no host), edited by the person in its folder, commented on and sent.
  assert.equal((await post('artifacts.open', { id, host: false })).status, 200);
  writeFileSync(join(daemon.store.require(id).root, 'index.html'), '<h1>The person wrote this</h1>');
  await post('artifacts.update', { id, title: 'Theirs, renamed' });
  const result = await daemon.wake.queue(id, { thread: { id: 't1', messages: [{ from: 'user', text: 'A comment' }] } });
  assert.equal(result.via, 'inbox');
  assert.deepEqual(daemon.store.require(id).owner, before);
  const waiting = daemon.inbox.take(sessionKeyOf(owner)!).filter((m) => m.artifactId === id);
  assert.equal(waiting.length, 1);
  assert.match(waiting[0]!.text, /A comment/);
  assert.doesNotMatch(waiting[0]!.text, /yours now/);
  assert.equal(unownedOf(id).length, 0);
});

test('handOff: what waited survives a restart (the inbox is on disk), and is handed over once', () => {
  const store = new ArtifactStore();
  const record = store.create({ root: join(tempDir('open-artifact-restart-'), 'r'), type: 'design', owner: null, title: 'Restart' });
  // Before the restart: wakes in the unowned inbox, written by an inbox that is gone now.
  new Inbox().append(UNOWNED_KEY, { kind: 'wake', text: '[Artifact edit request sent to agent]\nhi', artifactId: record.id, artifact: artifactUrl(record.id) });
  new Inbox().append(UNOWNED_KEY, { kind: 'wake', text: 'other', artifactId: 'art_someoneelse0000' });
  // After it: a new router and inbox over the same folder.
  const inbox = new Inbox();
  const router = new WakeRouter({ store, inbox, live: () => null, viewUrl: () => 'v', log: () => {} });
  const owner = session('after-restart');
  const moved = router.handOff(record.id, owner, 'adopt');
  assert.equal(moved.length, 1);
  assert.equal(router.handOff(record.id, owner, 'adopt').length, 0, 'not twice');
  assert.equal(router.handOff(record.id, session('someone-else'), 'wrote').length, 0);
  assert.equal(inbox.take(sessionKeyOf(owner)!).length, 1);
  assert.ok(inbox.peek(UNOWNED_KEY).some((m) => m.text === 'other'), "another artifact's message stays");
});

// ---- many messages waiting ---------------------------------------------------------------------------------------

/** More than the per-minute limit lets the page send at once. */
const MANY = WAKE_PER_MINUTE + 5;

/**
 * `count` messages from the page of an artifact nobody owns, as they pile up over time: rendered and routed one by one
 * as a wake is (`WakeRouter.deliver`), past the per-minute limit and the merge window, which are on `queue`.
 */
async function backlog(id: string, count = MANY, word = 'Note'): Promise<string[]> {
  const words = Array.from({ length: count }, (_, i) => `${word} ${i + 1} of ${count}`);
  for (const [i, text] of words.entries()) {
    const result = await daemon.wake.deliver(id, [], [{ id: `r${i}`, text }]);
    assert.equal(result.via, 'inbox');
  }
  assert.equal(unownedOf(id).length, count);
  return words;
}

/** Each word in exactly one of `texts`, and nothing else for this artifact. */
function eachOnce(words: string[], texts: string[]): void {
  assert.equal(texts.length, words.length, `${texts.length} messages for ${words.length}`);
  for (const word of words) assert.equal(texts.filter((t) => t.includes(`\n${word}\n`)).length, 1, `${word} once`);
}

test('many waiting, adopt: every one comes with the adopt, once, past the per-minute limit', async () => {
  const id = await made('Many adopted');
  const words = await backlog(id);
  const caller = session('many-adopter');
  const adopted = await daemon.tools.call('Artifact', { action: 'adopt', url: artifactUrl(id) }, caller);
  assert.equal(adopted.error, undefined, JSON.stringify(adopted.error));
  eachOnce(words, texts(adopted.messages));
  assert.deepEqual(texts(adopted.messages).map((t) => t.match(/\nNote (\d+) of/)?.[1]), words.map((_, i) => String(i + 1)), 'in the order they were sent');
  assert.equal(unownedOf(id).length, 0);
  assert.equal((await daemon.tools.call('Artifact', { action: 'list' }, caller)).messages, undefined, 'nothing a second time');
  // The page may still send: handing them over counted nothing against its limit.
  assert.equal(await ask(id, 'One more'), 'inbox');
  daemon.inbox.take(sessionKeyOf(caller)!);
});

test('many waiting, a write through the tools: the write carries every one, once', async () => {
  const id = await made('Many written');
  const words = await backlog(id);
  const caller = session('many-writer');
  const wrote = await daemon.tools.call('Artifact', { action: 'publish', url: artifactUrl(id), files: { 'index.html': '<h1>Hi</h1>' } }, caller);
  assert.equal(wrote.error, undefined, JSON.stringify(wrote.error));
  eachOnce(words, texts(wrote.messages));
  for (const text of texts(wrote.messages)) assert.match(text, /^\[Open Artifact\] The person made .* It was sent at \d{4}-\d\d-\d\d \d\d:\d\d UTC\./);
  assert.equal(unownedOf(id).length, 0);
  assert.equal(daemon.inbox.count(sessionKeyOf(caller)!), 0);
});

test('many waiting, artifacts.assign to a session online: all delivered live, each once; none left in an inbox', async () => {
  const id = await made('Many assigned');
  const words = await backlog(id);
  const ref = session('many-online');
  const { key } = daemon.harnesses.pollAttach({ harness: ref.harness, session: ref.session!, workspace: ref.workspace! });
  const assigned = await post<AssignArtifactResult>('artifacts.assign', { id, session: key });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal(assigned.body.delivered.length, MANY);
  assert.ok(assigned.body.delivered.every((d) => d.via === 'live' && d.status === 'queued'), JSON.stringify(assigned.body.delivered));
  assert.equal(daemon.inbox.count(key), 0, 'delivered, not also in the inbox');
  assert.equal(unownedOf(id).length, 0);
  const polled = await daemon.harnesses.pollWait({ harness: ref.harness, session: ref.session!, workspace: ref.workspace!, timeoutMs: 1000 });
  eachOnce(words, polled.messages.map((m) => m.text));
  const more = await daemon.harnesses.pollWait({ harness: ref.harness, session: ref.session!, workspace: ref.workspace!, timeoutMs: 1000 });
  assert.equal(more.messages.length, 0, 'nothing a second time');
  daemon.harnesses.pollDetach({ harness: ref.harness, session: ref.session!, workspace: ref.workspace! });
});

test('many waiting, artifacts.assign while the session has a poll open: the poll takes the first, the next poll the rest', async () => {
  const id = await made('Many polled');
  const words = await backlog(id);
  const ref = session('many-polling');
  const params = { harness: ref.harness, session: ref.session!, workspace: ref.workspace! };
  const { key } = daemon.harnesses.pollAttach(params);
  const open = daemon.harnesses.pollWait({ ...params, timeoutMs: 10_000 });
  const assigned = await post<AssignArtifactResult>('artifacts.assign', { id, session: key });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.deepEqual(
    assigned.body.delivered.map((d) => d.status),
    ['delivered', ...Array(MANY - 1).fill('queued')],
  );
  const first = await open;
  const rest = await daemon.harnesses.pollWait({ ...params, timeoutMs: 1000 });
  eachOnce(words, [...first.messages, ...rest.messages].map((m) => m.text));
  assert.equal(daemon.inbox.count(key), 0);
  daemon.harnesses.pollDetach(params);
});

test('many waiting, the session not online (an adapter saw it write): all wait in its inbox, each once, with their line', async () => {
  const id = await made('Many offline');
  const words = await backlog(id);
  const caller = session('many-offline');
  const root = daemon.store.require(id).root;
  writeFileSync(join(root, 'index.html'), '<h1>By the agent</h1>');
  daemon.tools.agentWrote(caller, [join(root, 'index.html')]);
  assert.equal(daemon.store.require(id).owner?.session, 'many-offline');
  const key = sessionKeyOf(caller)!;
  // No adapter takes them live: deliverWaiting leaves them in the inbox.
  await until(() => daemon.inbox.peek(key).length === MANY);
  await new Promise((done) => setTimeout(done, 300));
  const waiting = daemon.inbox.take(key).filter((m) => m.artifactId === id);
  eachOnce(words, waiting.map((m) => m.text));
  for (const message of waiting) assert.match(message.text, /^\[Open Artifact\] The person made .* it is yours now/);
  assert.equal(unownedOf(id).length, 0);
});

test('deliverWaiting: a live delivery that fails leaves each in the inbox once, nudged once; one taken meanwhile is not sent again', async () => {
  const store = new ArtifactStore();
  const owner = session('router-owner');
  const key = sessionKeyOf(owner)!;
  const record = store.create({ root: join(tempDir('open-artifact-many-'), 'r'), type: 'design', owner: null, title: 'Router' });
  const inbox = new Inbox();
  const sent: string[] = [];
  const nudges: string[] = [];
  let answer: () => 'failed' | 'delivered' = () => 'failed';
  let during: (() => void) | null = null;
  const router = new WakeRouter({
    store,
    inbox,
    live: () => ({
      deliver: async (_ref, payload) => {
        sent.push(payload.text);
        during?.();
        during = null;
        return answer();
      },
    }),
    viewUrl: () => 'v',
    log: () => {},
    nudge: (target) => nudges.push(sessionKeyOf(target)!),
  });
  const words = Array.from({ length: MANY }, (_, i) => `Item ${i + 1} of ${MANY}`);
  for (const [i, text] of words.entries()) await router.deliver(record.id, [], [{ id: `r${i}`, text }]);
  const unowned = (): InboxMessage[] => inbox.peek(UNOWNED_KEY).filter((m) => m.artifactId === record.id);
  assert.equal(unowned().length, MANY);
  assert.equal(sent.length, 0, 'nobody owned it: nothing went live');

  // Offline: every live delivery fails; all stay in the session's inbox, in their order, with the time they were sent.
  store.update(record.id, { owner });
  const sentAt = unowned().map((m) => m.at);
  router.handOff(record.id, owner, 'assign');
  const failed = await router.deliverWaiting(record.id, owner);
  assert.equal(failed.length, MANY);
  assert.ok(failed.every((r) => r.via === 'inbox'));
  assert.equal(sent.length, MANY, 'each was tried live once');
  assert.deepEqual(nudges, [key], 'nudged once, not once per message');
  const kept = inbox.peek(key);
  eachOnce(words, kept.map((m) => m.text));
  assert.deepEqual(kept.map((m) => m.at), sentAt, 'in their order, with the time each was sent');
  assert.equal(unowned().length, 0);

  // Online now, and the session takes its inbox (a tool call) while the first is being delivered.
  sent.length = 0;
  answer = () => 'delivered';
  let tookMeanwhile: string[] = [];
  during = () => (tookMeanwhile = inbox.take(key).map((m) => m.text));
  const delivered = await router.deliverWaiting(record.id, owner);
  assert.equal(delivered.length, 1, 'only the one already on its way');
  assert.equal(tookMeanwhile.length, MANY - 1);
  eachOnce(words, [...sent, ...tookMeanwhile]);
  assert.equal(inbox.count(key), 0);
});

test('handOff: a message with no time says it may be old; a dated one says when it was sent', () => {
  const store = new ArtifactStore();
  const record = store.create({ root: join(tempDir('open-artifact-old-'), 'r'), type: 'design', owner: null, title: 'Old' });
  const inbox = new Inbox();
  const file = inbox.fileOf(UNOWNED_KEY);
  const old = { kind: 'wake', text: '[Artifact edit request sent to agent]\nfrom an older daemon', artifactId: record.id, artifact: artifactUrl(record.id) };
  const dated = { ...old, text: '[Artifact edit request sent to agent]\nlong ago', at: new Date(Date.now() - 40 * 86_400_000).toISOString() };
  writeFileSync(file, `${JSON.stringify(old)}\n${JSON.stringify(dated)}\n`, { flag: 'a' });
  const router = new WakeRouter({ store, inbox, live: () => null, viewUrl: () => 'v', log: () => {} });
  const moved = router.handOff(record.id, session('old-owner'), 'adopt');
  assert.equal(moved.length, 2, 'none dropped, however old');
  assert.match(moved[0]!.text, /^\[Open Artifact\] .*When it was sent is not known: it may be from long ago/);
  assert.match(moved[1]!.text, /^\[Open Artifact\] .*It was sent at .* UTC, 40 days ago: check that it still stands/);
});

// ---- a type action that writes (Artifact call) -------------------------------------------------------------------

test('rule 2: a type action whose effect is write makes the session its owner; a read or a refused write does not', { timeout: 60000 }, async () => {
  const made = await post<ArtifactView>('artifacts.create', { type: 'docs', title: 'Doc by action', folder: join(home, 'doc-action'), blank: true });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const id = made.body.id;
  const url = artifactUrl(id);
  const words = await backlog(id, 3, 'Ask');
  const caller = session('acts');

  const read = await daemon.tools.call('Artifact', { action: 'call', url, name: 'read', args: { call: {} } }, caller);
  assert.equal(read.error, undefined, JSON.stringify(read.error));
  assert.equal(daemon.store.require(id).owner, null, 'a read action moves nothing');
  assert.equal(read.messages, undefined);

  const refused = await daemon.tools.call('Artifact', { action: 'call', url, name: 'delete', args: { call: { ref: { object: 'file', id: 'no-such-tab' } } } }, caller);
  assert.ok(refused.error, 'deleting a tab that is not there is refused');
  assert.equal(daemon.store.require(id).owner, null, 'a write that failed moves nothing');
  assert.equal(refused.messages, undefined);

  const wrote = await daemon.tools.call('Artifact', { action: 'call', url, name: 'batch', args: { call: { batch: [{ verb: 'create', object: 'file', payload: { birthName: 'Notes' } }] } } }, caller);
  assert.equal(wrote.error, undefined, JSON.stringify(wrote.error));
  assert.equal(sessionKeyOf(daemon.store.require(id).owner!), sessionKeyOf(caller));
  assert.ok(texts(wrote.notes).some((note) => note.includes(id) && /had no owner session, so it is yours now/.test(note)), JSON.stringify(wrote.notes));
  eachOnce(words, texts(wrote.messages));
  for (const text of texts(wrote.messages)) assert.match(text, /^\[Open Artifact\] The person made .* If you have not, call Artifact \{action: "adopt"/);
  assert.equal(unownedOf(id).length, 0);
  const again = await daemon.tools.call('Artifact', { action: 'call', url, name: 'read', args: { call: {} } }, caller);
  assert.equal(again.messages, undefined, 'nothing a second time');
  assert.ok(!texts(again.notes).some((note) => /yours now/.test(note)), 'said once');
});

test('Inbox.takeWhere takes the matching messages and keeps the rest in order', () => {
  const inbox = new Inbox();
  const key = 'myide:take-where';
  for (const text of ['a1', 'b1', 'a2', 'b2']) inbox.append(key, { kind: 'wake', text, artifactId: text[0] });
  assert.deepEqual(
    inbox.takeWhere(key, (m) => m.artifactId === 'a').map((m) => m.text),
    ['a1', 'a2'],
  );
  assert.deepEqual(
    inbox.peek(key).map((m) => m.text),
    ['b1', 'b2'],
  );
  assert.deepEqual(inbox.takeWhere(key, (m) => m.artifactId === 'a'), []);
  assert.equal(inbox.takeWhere(key, () => true).length, 2);
  assert.equal(inbox.count(key), 0);
});
