/**
 * A page request that waited in a session's inbox, then taken by that session: the daemon says so on the event stream
 * (`wake/state` with `via: "taken"`), so the Shell's Ask pane can stop showing it as waiting. Before this, nothing was
 * sent when a session took its inbox, and the pane said "waiting for the session" until the tab closed.
 */

import { tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { artifactUrl, taskMessage, type DaemonState, type LibraryEvent, type SessionRef } from '@open-artifact/protocol';
import { readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { Inbox } from '../src/inbox.ts';
import { sessionKeyOf } from '../src/store.ts';

let daemon: Daemon;
let state: DaemonState;
const workspace = tempDir('open-artifact-taken-ws-');
let n = 0;
const events: LibraryEvent[] = [];
const stop = new AbortController();

before(async () => {
  daemon = await startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
  state = (await readDaemon())!;
  const response = await fetch(`${state.url}/api/open-artifact.events`, { headers: { authorization: `Bearer ${state.token}` }, signal: stop.signal });
  assert.equal(response.status, 200);
  void (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
          if (data) events.push(JSON.parse(data) as LibraryEvent);
        }
      }
    } catch {
      /* aborted */
    }
  })();
});

after(async () => {
  stop.abort();
  await daemon.close();
});

/** An artifact owned by a session that is not online, and one request from its page that waits in the inbox. */
async function waiting(name: string): Promise<{ id: string; owner: SessionRef }> {
  const owner: SessionRef = { harness: 'away-app', session: name, workspace };
  const record = daemon.store.create({ root: join(workspace, `t-${++n}`), type: 'design', owner, title: `Taken ${n}` });
  const response = await fetch(`${state.url}/api/open-artifact.artifacts.ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: state.url },
    body: JSON.stringify({ id: record.id, text: 'Make it bigger' }),
  });
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { via: string }).via, 'inbox');
  assert.equal(daemon.inbox.count(sessionKeyOf(owner)!), 1);
  return { id: record.id, owner };
}

const takenOf = (id: string) => events.filter((e) => e.type === 'wake/state' && e.artifactId === id && e.via === 'taken');

test('a tool call that takes the waiting request sends wake/state taken for its artifact', async () => {
  const { id, owner } = await waiting('tool-call');
  await until(() => events.some((e) => e.type === 'wake/state' && e.artifactId === id && e.via === 'inbox'));
  assert.equal(takenOf(id).length, 0, 'not before the session takes it');
  const result = await daemon.tools.call('Artifact', { action: 'list' }, owner);
  assert.equal((result.messages as string[] | undefined)?.length, 1);
  await until(() => takenOf(id).length === 1);
});

test('attaching (the Harness API) takes it too, and says so once', async () => {
  const { id, owner } = await waiting('attach');
  const { inbox } = daemon.harnesses.pollAttach({ harness: owner.harness, session: owner.session!, workspace: owner.workspace! });
  assert.equal(inbox.length, 1);
  await until(() => takenOf(id).length === 1);
  daemon.harnesses.pollDetach({ harness: owner.harness, session: owner.session!, workspace: owner.workspace! });
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(takenOf(id).length, 1);
});

test('another session taking a wake of the artifact (a long action it started) is not the owner taking it', async () => {
  const { id, owner } = await waiting('owner-away');
  const other: SessionRef = { harness: 'away-app', session: 'started-a-task', workspace };
  // What the end of a long action this other session started sends it (Daemon.taskEnded).
  const done = taskMessage(daemon.store.require(id), { task: 't1', action: 'render', result: null }, { viewUrl: 'v' });
  await daemon.wake.send(other, { artifact: artifactUrl(id), artifactId: id, text: done.text, source: done.source });
  const result = await daemon.tools.call('Artifact', { action: 'list' }, other);
  assert.equal((result.messages as string[] | undefined)?.length, 1, 'the other session got its task message');
  await new Promise((done) => setTimeout(done, 100));
  assert.equal(takenOf(id).length, 0, "the owner's request still waits: no taken");
  assert.equal(daemon.inbox.count(sessionKeyOf(owner)!), 1);
});

test('a take and a put-back report what moved, never an empty list', () => {
  const seen: string[][] = [];
  const inbox = new Inbox({ taken: (_key, messages) => seen.push(messages.map((m) => m.text)) });
  assert.deepEqual(inbox.take('nobody'), []);
  inbox.append('somebody', { kind: 'wake', text: 'hi', artifactId: 'art_x' });
  inbox.take('somebody');
  assert.deepEqual(seen, [['hi']]);
});

test('a listener that throws loses nothing: the caller still gets what it took', () => {
  const inbox = new Inbox({ taken: () => { throw new Error('broken listener'); } });
  inbox.append('k-throws', { kind: 'wake', text: 'kept', artifactId: 'art_x' });
  assert.deepEqual(inbox.take('k-throws').map((m) => m.text), ['kept']);
});

test('what an adapter took and put back with inbox.return waits again: wake/state inbox follows the taken', async () => {
  const { id, owner } = await waiting('returned');
  const { inbox } = daemon.harnesses.pollAttach({ harness: owner.harness, session: owner.session!, workspace: owner.workspace! });
  await until(() => takenOf(id).length === 1);
  const before = events.length;
  daemon.inbox.giveBack(sessionKeyOf(owner)!, inbox);
  await until(() => events.slice(before).some((e) => e.type === 'wake/state' && e.artifactId === id && e.via === 'inbox'));
  daemon.harnesses.pollDetach({ harness: owner.harness, session: owner.session!, workspace: owner.workspace! });
});
