import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { after, before, describe, it, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { documentSha256 } from '@open-artifact/live-store/doc-hash';
import { createLocalProvider } from '@open-artifact/runtime';
import { API, type DbWriteRequest, type ServerEvents } from '@open-artifact/runtime/http-api';
import { acceptWebSocket } from '@open-artifact/server-sdk/ws';
import { createTypeServer } from '@open-artifact/type-server';
import { build } from 'esbuild';
import { addBoardInk, removeBoardInk } from '../../whiteboard-editor/src/services/commands.ts';
import { setBoardSink, setBoardSnapshot, useBoard } from '../../whiteboard-editor/src/state/board.ts';
import { addInk, withInks } from '../src/inks.ts';
import { applyJsonMergePatch, isPlainRecord } from '../src/json.ts';
import { MAX_BOARD_INKS, type Board, type BoardContent, type NoteElement } from '../src/schema.ts';
import {
  ACKNOWLEDGED_WRITE_GRACE_MS,
  LIVE_CACHE_WRITE_DELAY_MS,
  LIVE_EDIT_DEBOUNCE_MS,
  LIVE_MESSAGES,
  LIVE_RECONNECT_BACKOFF_MS,
  LIVE_SNAPSHOT_TIMEOUT_MS,
  WRITE_RETRY_BASE_MS,
  type LiveCache,
} from '../src/sync/engine.ts';
import { createBoardLiveCodec, createLiveBoardDocument, nextTimestampAfter, type LiveBoardDocument } from '../src/sync/live-board.ts';
import { collectionOfPath, getDbChangeDeleteMeta, getDbDocMeta, getDbWriteBaseMeta, setDbWriteBaseMeta, type SyncChangeEvent, type SyncDocument, type SyncTimers, type SyncTransport, type SyncWrite } from '../src/sync/transport.ts';

/* ------------------------------------------------------------------ fakes */

/** Lets pending promise callbacks run. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Manual timers: nothing fires until {@link FakeTimers.advance}. */
class FakeTimers implements SyncTimers {
  time = 1_000_000;
  private nextId = 1;
  private queue = new Map<number, { at: number; callback: () => void }>();

  setTimeout = (callback: () => void, ms: number): number => {
    const id = this.nextId++;
    this.queue.set(id, { at: this.time + Math.max(0, ms), callback });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.queue.delete(handle as number);
  };

  now = (): number => this.time;

  random = (): number => 0;

  /** Moves the clock forward, firing due timers in order and letting promises settle between them. */
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    await settle();
    for (;;) {
      let soonest: [number, { at: number; callback: () => void }] | undefined;
      for (const item of this.queue) if (item[1].at <= target && (soonest === undefined || item[1].at < soonest[1].at)) soonest = item;
      if (soonest === undefined) break;
      this.queue.delete(soonest[0]);
      this.time = Math.max(this.time, soonest[1].at);
      soonest[1].callback();
      await settle();
    }
    this.time = target;
    await settle();
  }
}

/** An in-memory store: writes apply at once and are never echoed. */
class FakeTransport implements SyncTransport {
  docs = new Map<string, Record<string, unknown>>();
  batches: SyncWrite[][] = [];
  /** Codes the next write calls fail with, in order. */
  failures: string[] = [];
  /** Codes the next list calls fail with, in order. */
  listFailures: string[] = [];
  private listeners = new Set<(event: SyncChangeEvent) => void>();

  constructor(docs: Record<string, Record<string, unknown>> = {}) {
    for (const [path, data] of Object.entries(docs)) this.docs.set(path, structuredClone(data));
  }

  async get(path: string): Promise<Record<string, unknown> | null> {
    return structuredClone(this.docs.get(path) ?? null);
  }

  async list(collection: string): Promise<SyncDocument[]> {
    const code = this.listFailures.shift();
    if (code !== undefined) throw Object.assign(new Error(code), { code });
    return [...this.docs].filter(([path]) => collectionOfPath(path) === collection).map(([path, data]) => ({ path, data: structuredClone(data) }));
  }

  async write(writes: SyncWrite[]): Promise<void> {
    this.batches.push(structuredClone(writes));
    const code = this.failures.shift();
    if (code !== undefined) throw Object.assign(new Error(code), { code });
    for (const write of writes) {
      if (write.op === 'delete') this.docs.delete(write.path);
      else if (write.op === 'set') this.docs.set(write.path, structuredClone(write.data));
      else this.docs.set(write.path, applyJsonMergePatch(this.docs.get(write.path), write.patch));
    }
  }

  onChange(listener: (event: SyncChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Someone else changes documents. */
  remote(changes: Record<string, Record<string, unknown> | null>): void {
    for (const [path, data] of Object.entries(changes)) {
      if (data === null) this.docs.delete(path);
      else this.docs.set(path, structuredClone(data));
    }
    this.emit(changes);
  }

  /** Delivers a change event without touching the store (one the last read already missed). */
  emit(changes: Record<string, Record<string, unknown> | null>): void {
    for (const listener of [...this.listeners]) listener({ changes: structuredClone(changes) });
  }

  /** Every write of every batch, flattened. */
  writes(): SyncWrite[] {
    return this.batches.flat();
  }
}

/* ---------------------------------------------------------------- helpers */

const note = (id: string, text: string, x = 0): NoteElement => ({ type: 'note', id, x, y: 0, w: 180, h: 180, color: 'yellow', text, tilt: 0 });

const stored = (element: NoteElement): Record<string, unknown> => {
  const { id: _id, ...rest } = element;
  return rest;
};

const seedDocs = (...notes: NoteElement[]): Record<string, Record<string, unknown>> => ({
  'board/meta': { v: 1, title: 'Board', order: notes.map((element) => element.id) },
  'board/inks': { colors: {} },
  ...Object.fromEntries(notes.map((element) => [`elements/${element.id}`, stored(element)])),
});

const textOf = (doc: LiveBoardDocument, id: string): string | undefined => {
  const element = doc.content().elements.find((item) => item.id === id);
  return element?.type === 'note' ? element.text : undefined;
};

const withText = (content: BoardContent, id: string, text: string): BoardContent => ({
  ...content,
  elements: content.elements.map((element) => (element.id === id && element.type === 'note' ? { ...element, text } : element)),
});

async function open(docs = seedDocs(note('n1', 'a')), options: { readOnly?: boolean } = {}) {
  const transport = new FakeTransport(docs);
  const timers = new FakeTimers();
  const doc = createLiveBoardDocument({ transport, timers, ...options });
  await timers.advance(0);
  return { transport, timers, doc };
}

/* ------------------------------------------------------------------ tests */

describe('live board sync', () => {
  it('loads the documents and reports ready', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a'), note('n2', 'b')));
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport, timers });
    assert.equal(doc.getSnapshot().status, 'loading');
    assert.equal(doc.canEdit(), false);
    await timers.advance(0);
    const snapshot = doc.getSnapshot();
    assert.equal(snapshot.status, 'ready');
    assert.equal(snapshot.loadState, 'live');
    assert.equal(doc.title(), 'Board');
    assert.deepEqual(
      doc.content().elements.map((element) => element.id),
      ['n1', 'n2'],
    );
    assert.equal(doc.getSnapshot(), snapshot, 'the snapshot keeps its identity while nothing changes');
    assert.equal(transport.batches.length, 0, 'loading writes nothing');
  });

  it('debounces local edits into one patch of the changed document', async () => {
    const { transport, timers, doc } = await open();
    const seen: boolean[] = [];
    doc.subscribe((change) => seen.push(change.remote));
    assert.equal(doc.setContent(withText(doc.content(), 'n1', 'ab')), true);
    assert.equal(doc.setContent(withText(doc.content(), 'n1', 'abc')), true);
    assert.equal(textOf(doc, 'n1'), 'abc', 'edits show at once');
    assert.deepEqual(seen, [false, false]);
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS - 100);
    assert.equal(transport.batches.length, 0, 'still debouncing');
    assert.equal(doc.getSnapshot().status, 'dirty');
    assert.equal(doc.getSnapshot().pending, 1);
    await timers.advance(200);
    assert.deepEqual(transport.writes(), [{ op: 'update', path: 'elements/n1', patch: { text: 'abc' } }]);
    assert.equal(doc.getSnapshot().status, 'ready');
    assert.equal(doc.getSnapshot().pending, 0);
    assert.equal(transport.docs.get('elements/n1')?.text, 'abc');
  });

  it('clears the pending count when an edit changes no document', async () => {
    const { transport, timers, doc } = await open();
    const original = doc.content();
    assert.equal(doc.setContent(withText(original, 'n1', 'a')), true);
    assert.equal(doc.getSnapshot().pending, 1);
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 100);
    assert.equal(transport.batches.length, 0, 'nothing to write');
    assert.equal(doc.getSnapshot().pending, 0);
    assert.equal(doc.getSnapshot().status, 'ready');
  });

  it('writes new elements before the order and deletes after it', async () => {
    const { transport, doc } = await open(seedDocs(note('n1', 'a'), note('n2', 'b')));
    doc.setContent({ ...doc.content(), elements: [doc.content().elements[0]!, note('n3', 'c')] });
    await doc.flush();
    const paths = transport.writes().map((write) => `${write.op} ${write.path}`);
    assert.deepEqual(paths, ['set elements/n3', 'update board/meta', 'delete elements/n2']);
    assert.deepEqual(transport.docs.get('board/meta')?.order, ['n1', 'n3']);
  });

  it('merges a concurrent remote edit of another field', async () => {
    const { transport, timers, doc } = await open();
    doc.setContent(withText(doc.content(), 'n1', 'mine'));
    transport.remote({ 'elements/n1': stored(note('n1', 'a', 500)) });
    const element = doc.content().elements[0];
    assert.equal(element?.type === 'note' && element.x, 500, 'the remote move shows');
    assert.equal(textOf(doc, 'n1'), 'mine', 'the local text survives');
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    assert.deepEqual(transport.writes(), [{ op: 'update', path: 'elements/n1', patch: { text: 'mine' } }]);
    assert.deepEqual(transport.docs.get('elements/n1'), stored({ ...note('n1', 'mine', 500) }));
  });

  it('rebases pending edits over a remote change of the same field (last writer wins locally)', async () => {
    const { transport, timers, doc } = await open();
    doc.setContent(withText(doc.content(), 'n1', 'mine'));
    transport.remote({ 'elements/n1': stored(note('n1', 'theirs')) });
    assert.equal(textOf(doc, 'n1'), 'mine');
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    assert.equal(transport.docs.get('elements/n1')?.text, 'mine');
  });

  it('merges fills and heat maps set by two people cell by cell (the later write wins a cell)', async () => {
    const tableDoc = { type: 'table', x: 0, y: 0, head: true, color: 'white', cols: { c1: { at: 1 }, c2: { at: 2 } }, rows: { r1: { at: 1, c1: 'h', c2: 'h' }, r2: { at: 2, c1: '1', c2: '2' } } };
    const { transport, timers, doc } = await open({ 'board/meta': { v: 1, title: 'Board', order: ['t1'] }, 'board/inks': { colors: {} }, 'elements/t1': tableDoc });
    const withTints = (fields: Record<string, unknown>): BoardContent => ({
      ...doc.content(),
      elements: doc.content().elements.map((element) => (element.id === 't1' && element.type === 'table' ? { ...element, ...fields } : element)),
    });
    doc.setContent(withTints({ fills: { r1: { c1: 'blue' }, r2: { c2: 'peach' } } }));
    transport.remote({ 'elements/t1': { ...tableDoc, fills: { r2: { c1: 'pink', c2: 'green' } }, heat: { cols: { c2: 'purple' } } } });
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    const stored = transport.docs.get('elements/t1');
    assert.deepEqual(stored?.fills, { r1: { c1: 'blue' }, r2: { c1: 'pink', c2: 'peach' } });
    assert.deepEqual(stored?.heat, { cols: { c2: 'purple' } });
    const table = doc.content().elements[0];
    assert.deepEqual(table?.type === 'table' && table.fills, stored?.fills);
  });

  it('keeps a drawing style set by someone else while the drawing moves', async () => {
    const src = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`;
    const drawingDoc = { type: 'image', x: 0, y: 0, w: 100, h: 100, src };
    const { transport, timers, doc } = await open({ 'board/meta': { v: 1, title: 'Board', order: ['d1'] }, 'board/inks': { colors: {} }, 'elements/d1': drawingDoc });
    doc.setContent({ ...doc.content(), elements: doc.content().elements.map((element) => ({ ...element, x: 250 })) });
    transport.remote({ 'elements/d1': { ...drawingDoc, style: 'watercolor' } });
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    assert.deepEqual(transport.docs.get('elements/d1'), { ...drawingDoc, x: 250, style: 'watercolor' });
  });

  it('applies remote changes with remote: true and keeps unchanged elements identical', async () => {
    const { transport, doc } = await open(seedDocs(note('n1', 'a'), note('n2', 'b')));
    const before = doc.content().elements;
    const changes: boolean[] = [];
    doc.subscribe((change) => changes.push(change.remote));
    transport.remote({ 'elements/n2': stored(note('n2', 'B')) });
    assert.deepEqual(changes, [true]);
    assert.equal(doc.content().elements[0], before[0], 'n1 keeps its object');
    assert.equal(textOf(doc, 'n2'), 'B');
  });

  it('drops a pending edit when someone else deletes the element', async () => {
    const { transport, timers, doc } = await open(seedDocs(note('n1', 'a'), note('n2', 'b')));
    doc.setContent(withText(doc.content(), 'n2', 'edit'));
    transport.remote({ 'elements/n2': null, 'board/meta': { v: 1, title: 'Board', order: ['n1'] } });
    assert.deepEqual(
      doc.content().elements.map((element) => element.id),
      ['n1'],
    );
    assert.equal(doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    assert.equal(transport.docs.has('elements/n2'), false, 'no stub is written back');
  });

  it('keeps acknowledged writes over stale remote snapshots during the grace period', async () => {
    const { transport, timers, doc } = await open();
    doc.setContent(withText(doc.content(), 'n1', 'mine'));
    await doc.flush();
    // A change made before ours arrives late.
    transport.remote({ 'elements/n1': stored(note('n1', 'old', 40)) });
    assert.equal(textOf(doc, 'n1'), 'mine', 'our acknowledged text still shows');
    const element = doc.content().elements[0];
    assert.equal(element?.type === 'note' && element.x, 40, 'their other fields show');
    await timers.advance(ACKNOWLEDGED_WRITE_GRACE_MS + 50);
    assert.equal(textOf(doc, 'n1'), 'old', 'after the grace period the store wins');
  });

  it('parks a document the codec refuses and resumes once it fits', async () => {
    const { transport, timers, doc } = await open(seedDocs(note('n1', 'a'), note('n2', 'b')));
    doc.setContent(withText(doc.content(), 'n1', 'x'.repeat(210_000)));
    doc.setContent(withText(doc.content(), 'n2', 'fine'));
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    const snapshot = doc.getSnapshot();
    assert.equal(snapshot.status, 'error');
    assert.match(snapshot.refusal ?? '', /too large to sync/);
    assert.equal(snapshot.retryable, false);
    assert.deepEqual(
      transport.writes().map((write) => write.path),
      ['elements/n2'],
      'other documents keep syncing',
    );
    doc.setContent(withText(doc.content(), 'n1', 'short'));
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    assert.equal(doc.getSnapshot().refusal, undefined);
    assert.equal(doc.getSnapshot().status, 'ready');
    assert.equal(transport.docs.get('elements/n1')?.text, 'short');
  });

  it('retries failed writes and reports offline meanwhile', async () => {
    const { transport, timers, doc } = await open();
    transport.failures.push('unavailable', 'unavailable');
    doc.setContent(withText(doc.content(), 'n1', 'mine'));
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    assert.equal(doc.getSnapshot().status, 'offline');
    assert.equal(doc.getSnapshot().retryable, true);
    assert.equal(textOf(doc, 'n1'), 'mine', 'edits stay on screen');
    // First retry: 300–800 ms of jitter (random() = 0), but never before the edit debounce.
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS);
    assert.equal(transport.batches.length, 2);
    assert.equal(doc.getSnapshot().status, 'offline');
    await timers.advance(2000); // second retry: 2 s
    assert.equal(transport.batches.length, 3);
    assert.equal(doc.getSnapshot().status, 'ready');
    assert.equal(transport.docs.get('elements/n1')?.text, 'mine');
  });

  it('keeps edits made while a failed write waits and sends them together', async () => {
    const { transport, timers, doc } = await open();
    transport.failures.push('unavailable');
    doc.setContent(withText(doc.content(), 'n1', 'one'));
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    doc.setContent(withText(doc.content(), 'n1', 'two'));
    await timers.advance(1000);
    assert.equal(transport.docs.get('elements/n1')?.text, 'two');
    assert.equal(doc.getSnapshot().status, 'ready');
  });

  it('stops writing when access ends', async () => {
    const { transport, timers, doc } = await open();
    transport.failures.push('not_writer');
    doc.setContent(withText(doc.content(), 'n1', 'mine'));
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    const snapshot = doc.getSnapshot();
    assert.equal(snapshot.status, 'error');
    assert.equal(snapshot.readOnly, true);
    assert.equal(snapshot.message, LIVE_MESSAGES.accessEnded);
    assert.equal(doc.canEdit(), false);
    assert.equal(doc.setContent(withText(doc.content(), 'n1', 'more')), false);
    await timers.advance(60_000);
    assert.equal(transport.batches.length, 1, 'no more writes');
  });

  it('never writes in read-only mode but still follows remote edits', async () => {
    const { transport, timers, doc } = await open(undefined, { readOnly: true });
    assert.equal(doc.getSnapshot().status, 'readonly');
    assert.equal(doc.setContent(withText(doc.content(), 'n1', 'mine')), false);
    transport.remote({ 'elements/n1': stored(note('n1', 'theirs')) });
    assert.equal(textOf(doc, 'n1'), 'theirs');
    doc.setReadOnly(false);
    assert.equal(doc.getSnapshot().status, 'ready');
    assert.equal(doc.setTitle('Renamed'), true);
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS + 50);
    assert.equal(transport.docs.get('board/meta')?.title, 'Renamed');
  });

  it('flush sends pending edits at once', async () => {
    const { transport, doc } = await open();
    doc.setContent(withText(doc.content(), 'n1', 'now'));
    await doc.flush();
    assert.equal(transport.docs.get('elements/n1')?.text, 'now');
    assert.equal(doc.getSnapshot().status, 'ready');
  });

  it('retries a failed load with backoff', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a')));
    transport.listFailures.push('unavailable');
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport, timers });
    await timers.advance(0);
    assert.equal(doc.getSnapshot().status, 'error');
    assert.equal(doc.getSnapshot().loadState, 'failed');
    assert.equal(doc.getSnapshot().retryable, true);
    await timers.advance(LIVE_RECONNECT_BACKOFF_MS[0]!);
    assert.equal(doc.getSnapshot().status, 'ready');
    assert.equal(textOf(doc, 'n1'), 'a');
  });

  it('applies changes heard while loading over the loaded documents', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a')));
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport, timers });
    transport.emit({ 'elements/n1': stored(note('n1', 'newer')) });
    await timers.advance(0);
    assert.equal(textOf(doc, 'n1'), 'newer');
    assert.equal(transport.batches.length, 0);
  });

  it('does not retry a load the viewer may not read', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a')));
    transport.listFailures.push('not_granted');
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport, timers });
    await timers.advance(120_000);
    assert.equal(doc.getSnapshot().loadState, 'failed');
    assert.equal(doc.getSnapshot().retryable, false);
  });

  it('stops listening after dispose', async () => {
    const { transport, doc } = await open();
    const value: Board = doc.value();
    doc.dispose();
    transport.remote({ 'elements/n1': stored(note('n1', 'later')) });
    assert.equal(doc.value(), value);
  });
});

/** A saved copy kept in memory, holding `docs` to start with. */
class MemoryCache implements LiveCache {
  saved: SyncDocument[] | undefined;
  writes = 0;

  constructor(docs?: Record<string, Record<string, unknown>>) {
    this.saved = docs && Object.entries(docs).map(([path, data]) => ({ path, data: structuredClone(data) }));
  }

  read(): SyncDocument[] | undefined {
    return structuredClone(this.saved);
  }

  write(documents: SyncDocument[]): void {
    this.writes += 1;
    this.saved = structuredClone(documents);
  }

  text(id: string): unknown {
    return this.saved?.find((document) => document.path === `elements/${id}`)?.data.text;
  }
}

describe('saved copy', () => {
  it('shows the saved copy while the store is out of reach, and sends edits once it is back', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a')));
    transport.listFailures.push('unavailable');
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport, timers, cache: new MemoryCache(seedDocs(note('n1', 'saved'))) });
    await timers.advance(0);
    assert.equal(doc.getSnapshot().loadState, 'cached');
    assert.equal(doc.getSnapshot().status, 'cached');
    assert.equal(doc.getSnapshot().message, LIVE_MESSAGES.cached);
    assert.equal(doc.getSnapshot().retryable, true);
    assert.equal(textOf(doc, 'n1'), 'saved');

    assert.equal(doc.canEdit(), true);
    doc.setContent(withText(doc.content(), 'n1', 'mine'));
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS);
    assert.equal(doc.getSnapshot().message, LIVE_MESSAGES.cachedEdits);
    assert.equal(transport.batches.length, 0);

    await timers.advance(LIVE_RECONNECT_BACKOFF_MS[0]!);
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS);
    assert.equal(doc.getSnapshot().loadState, 'live');
    assert.equal(textOf(doc, 'n1'), 'mine');
    assert.equal(transport.docs.get('elements/n1')?.text, 'mine');
    assert.equal(doc.getSnapshot().status, 'ready');
  });

  it('drops a waiting edit to an element deleted meanwhile', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a')));
    transport.listFailures.push('unavailable');
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport, timers, cache: new MemoryCache(seedDocs(note('n1', 'a'), note('n2', 'b'))) });
    await timers.advance(0);
    assert.equal(textOf(doc, 'n2'), 'b');
    doc.setContent(withText(doc.content(), 'n2', 'gone soon'));
    await timers.advance(LIVE_RECONNECT_BACKOFF_MS[0]!);
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS);
    assert.equal(textOf(doc, 'n2'), undefined);
    assert.equal(transport.docs.has('elements/n2'), false);
    assert.equal(doc.getSnapshot().pending, 0);
  });

  it('shows the saved copy when loading is slow', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a')));
    transport.list = () => new Promise<SyncDocument[]>(() => {});
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport, timers, cache: new MemoryCache(seedDocs(note('n1', 'saved'))) });
    await timers.advance(0);
    assert.equal(doc.getSnapshot().loadState, 'loading');
    await timers.advance(LIVE_SNAPSHOT_TIMEOUT_MS);
    assert.equal(doc.getSnapshot().loadState, 'cached');
    assert.equal(textOf(doc, 'n1'), 'saved');
  });

  it('shows a saved copy read-only to viewers', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a')));
    transport.listFailures.push('unavailable');
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport, timers, readOnly: true, cache: new MemoryCache(seedDocs(note('n1', 'saved'))) });
    await timers.advance(0);
    assert.equal(doc.getSnapshot().status, 'readonly');
    assert.equal(doc.getSnapshot().message, LIVE_MESSAGES.cachedReadOnly);
    assert.equal(doc.canEdit(), false);
  });

  it('fails the load without a saved copy, or when the viewer may not read', async () => {
    const empty = new FakeTransport(seedDocs(note('n1', 'a')));
    empty.listFailures.push('unavailable');
    const timers = new FakeTimers();
    const doc = createLiveBoardDocument({ transport: empty, timers, cache: new MemoryCache() });
    await timers.advance(0);
    assert.equal(doc.getSnapshot().loadState, 'failed');

    const denied = new FakeTransport(seedDocs(note('n1', 'a')));
    denied.listFailures.push('not_granted');
    const other = createLiveBoardDocument({ transport: denied, timers, cache: new MemoryCache(seedDocs(note('n1', 'saved'))) });
    await timers.advance(0);
    assert.equal(other.getSnapshot().loadState, 'failed');
    assert.equal(textOf(other, 'n1'), undefined);
  });

  it('keeps the saved copy up to date once live', async () => {
    const transport = new FakeTransport(seedDocs(note('n1', 'a')));
    const timers = new FakeTimers();
    const cache = new MemoryCache();
    const doc = createLiveBoardDocument({ transport, timers, cache });
    await timers.advance(0);
    assert.equal(cache.writes, 0);
    await timers.advance(LIVE_CACHE_WRITE_DELAY_MS);
    assert.equal(cache.writes, 1);
    assert.equal(cache.text('n1'), 'a');

    doc.setContent(withText(doc.content(), 'n1', 'b'));
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS);
    await timers.advance(LIVE_CACHE_WRITE_DELAY_MS);
    assert.equal(cache.text('n1'), 'b');

    // Someone else's edit lands; leaving writes the copy at once.
    await timers.advance(ACKNOWLEDGED_WRITE_GRACE_MS);
    transport.remote({ 'elements/n1': stored(note('n1', 'theirs')) });
    assert.equal(textOf(doc, 'n1'), 'theirs');
    doc.dispose();
    assert.equal(cache.text('n1'), 'theirs');
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

type InkGetResponse = (data: SyncDocument['data'] | null, response: ServerResponse) => void | Promise<void>;

interface RelayControls {
  page?: { html: string; shellOrigin: string };
  beforeWrite?(body: DbWriteRequest): Promise<void>;
  beforeFrame?(frame: ServerEvents['db']): Promise<void>;
  connected?(): void;
}

/** Forward the real host's HTTP replies and WebSocket frames, optionally using the older db wire format. */
async function relayProvider(t: TestContext, pageUrl: string, unwatermarked: boolean, receipt: (writes: SyncWrite[], status: number) => Promise<void>, inkGetResponse?: InkGetResponse, controls: RelayControls = {}) {
  const relay = createServer(async (req, res) => {
    const target = new URL(req.url!, pageUrl);
    if (controls.page && req.headers.origin === controls.page.shellOrigin) {
      res.setHeader('Access-Control-Allow-Origin', controls.page.shellOrigin);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET, POST' }).end();
        return;
      }
    }
    if (controls.page && target.pathname.endsWith('/sync-client')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(controls.page.html);
      return;
    }
    if (target.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    const body = req.method === 'POST' ? await text(req) : undefined;
    const write = target.pathname === new URL(API.dbWrite, pageUrl).pathname ? JSON.parse(body!) as DbWriteRequest : undefined;
    if (write) await controls.beforeWrite?.(write);
    const upstream = await fetch(target, { method: req.method, ...(body !== undefined ? { body, headers: { 'content-type': 'application/json' } } : {}) });
    const payload = await upstream.json();
    if (write) await receipt(write.writes, upstream.status);
    if (target.pathname === new URL(API.dbGet, pageUrl).pathname && target.searchParams.get('path') === inkPath) {
      await inkGetResponse?.(payload.data, res);
      if (res.destroyed) return;
    }
    if (unwatermarked && target.pathname.includes('/_api/db/')) {
      delete payload.epoch;
      delete payload.seq;
      delete payload.deletedSeq;
      delete payload.deletedSeqs;
    }
    res.writeHead(upstream.status, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
  });
  relay.on('upgrade', (req, socket, head) => {
    const target = new URL(req.url!, pageUrl);
    target.protocol = 'ws:';
    const upstream = new WebSocket(target);
    upstream.onerror = () => socket.destroy();
    upstream.onopen = () => {
      const downstream = acceptWebSocket(req, socket, head);
      if (!downstream) { upstream.close(); return; }
      controls.connected?.();
      downstream.handlers.close = () => upstream.close();
      upstream.onclose = () => downstream.close();
      let delivery = Promise.resolve();
      upstream.onmessage = event => {
        const message = JSON.parse(String(event.data));
        if (unwatermarked && message.event === 'db') {
          delete message.data.epoch;
          delete message.data.seq;
          delete message.data.deletedSeqs;
        }
        delivery = delivery.then(async () => {
          if (message.event === 'db') await controls.beforeFrame?.(message.data);
          downstream.sendText(JSON.stringify(message));
        });
      };
    };
  });
  relay.listen(0, '127.0.0.1');
  await once(relay, 'listening');
  t.after(() => new Promise<void>(done => { relay.close(() => done()); relay.closeAllConnections(); }));
  const address = relay.address();
  assert.ok(address && typeof address !== 'string');
  const url = new URL(pageUrl);
  url.port = String(address.port);
  return url.href;
}

async function openSyncBoard(t: TestContext, mode: 'live' | 'missing-inks' = 'live', hooks: {
  /** True connects directly. Selecting a wire format records the provider's HTTP responses through the relay. */
  localProvider?: boolean | 'watermarked' | 'unwatermarked';
  inkGetResponse?: InkGetResponse;
  initialColors?: Record<string, unknown>;
  beforeWrite?: (writes: SyncWrite[], client: string) => Promise<void>;
  writeSignal?: (client: string) => AbortSignal | undefined;
  afterWrite?: (client: string) => Promise<void>;
  afterGet?: (path: string, client: string, data: SyncDocument['data'] | null) => Promise<void>;
  beforeInkEvent?: (client: string, data: SyncDocument['data'] | null) => Promise<void>;
  afterInkEvent?: (client: string, data: SyncDocument['data'] | null, frame: ServerEvents['db']) => void;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-board-'));
  const cacheFile = join(dir, 'saved.json');
  const cache: LiveCache = {
    read: () => existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : undefined,
    write: docs => writeFileSync(cacheFile, JSON.stringify(docs)),
  };
  let owner = true;
  const server = createTypeServer({
    secret: 'sync-board', idleMs: 0, isLocal: () => owner,
    assetsDir: fileURLToPath(new URL('../../../artifact-types/whiteboard/scripts/', import.meta.url)),
  });
  let providerSocket: WebSocket | undefined;
  t.after(async () => {
    if (providerSocket) { providerSocket.onclose = null; providerSocket.close(); }
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await server.listen();
  const root = join(dir, 'board');
  const { pageUrl, id: artifactId } = await server.open({ root, type: 'whiteboard' });
  const client = 'sync-board';
  const request = async (route: string, query?: Record<string, string>, body?: unknown, onResponse?: (status: number) => void, signal?: AbortSignal) => {
    const url = new URL(route, pageUrl);
    if (query) url.search = new URLSearchParams(query).toString();
    const response = await fetch(url, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
    });
    const data = await response.json();
    onResponse?.(response.status);
    if (!response.ok) throw Object.assign(new Error(data.message), { code: data.code });
    return data;
  };
  const writesFromA: SyncWrite[] = [];
  const receipts: { client: string; writes: SyncWrite[]; status: number }[] = [];
  const socketsReady: Promise<void>[] = [];
  const accepted = async (id: string, writes: SyncWrite[]) => {
    if (id === client) writesFromA.push(...writes);
    await hooks.afterWrite?.(id);
  };
  const relayed = typeof hooks.localProvider === 'string';
  const providerUrl = relayed
    ? await relayProvider(t, pageUrl, hooks.localProvider === 'unwatermarked', async (writes, status) => {
        receipts.push({ client, writes, status });
        if (status === 200) await accepted(client, writes);
      }, hooks.inkGetResponse)
    : pageUrl;
  const db = hooks.localProvider ? await createLocalProvider({ base: providerUrl }).get('db') : undefined;
  if (hooks.localProvider) assert.ok(db);
  function trackSocket(socket: WebSocket, id: string, receive: (event: MessageEvent) => void): void {
    let delivery = Promise.resolve();
    socketsReady.push(new Promise(resolve => socket.addEventListener('open', () => resolve(), { once: true })));
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      delivery = delivery.then(async () => {
        const inks = message.event === 'db' ? (message.data as SyncChangeEvent).changes[inkPath] : undefined;
        if (inks !== undefined) await hooks.beforeInkEvent?.(id, inks);
        receive(event);
        if (inks !== undefined) hooks.afterInkEvent?.(id, inks, message.data);
      });
    };
  }
  const connect = (id: string): SyncTransport => ({
    get: async path => {
      const data = id === client && db ? await db.get(path) : (await request(API.dbGet, { path })).data;
      await hooks.afterGet?.(path, id, data);
      return data;
    },
    write: async writes => {
      await hooks.beforeWrite?.(writes, id);
      if (id === client && db) {
        await db.write(writes as Parameters<typeof db.write>[0]);
        if (relayed) return;
      } else await request(API.dbWrite, undefined, { writes, client: id }, status => receipts.push({ client: id, writes, status }), hooks.writeSignal?.(id));
      await accepted(id, writes);
    },
    list: async collection => id === client && db ? db.list(collection) : (await request(API.dbList, { collection })).documents,
    onChange(listener) {
      if (id === client && db) {
        // Capture the provider's native socket so the test can delay its actual incoming frames.
        const Native = globalThis.WebSocket;
        const sockets: WebSocket[] = [];
        globalThis.WebSocket = class extends Native {
          constructor(...args: ConstructorParameters<typeof Native>) { super(...args); sockets.push(this); }
        };
        let off: () => void;
        try { off = db.onChange(listener); }
        finally { globalThis.WebSocket = Native; }
        const [socket] = sockets;
        assert.ok(socket?.onmessage);
        providerSocket = socket;
        trackSocket(socket, id, socket.onmessage.bind(socket));
        return () => { off(); socket.onclose = null; socket.close(); };
      }
      const url = new URL(API.events, pageUrl);
      url.protocol = 'ws:';
      url.searchParams.set('client', id);
      const socket = new WebSocket(url);
      trackSocket(socket, id, event => {
        const message = JSON.parse(String(event.data));
        if (message.event !== 'db') return;
        const { changes, author } = message.data as SyncChangeEvent;
        listener({ changes, author });
      });
      return () => socket.close();
    },
  });
  const transport = connect(client);
  const peer = connect('second-editor');
  const remote = seedDocs({ ...note('n1', 'remote', 80), color: 'blue' }, note('n3', 'other'));
  if (mode === 'missing-inks') delete remote['board/inks'];
  else remote['board/inks'] = { colors: hooks.initialColors ?? { aabbcc: 10 } };
  await peer.write(Object.entries(remote)
    .map(([path, data]) => ({ op: 'set', path, data })));
  if (mode === 'missing-inks') await peer.write([{ op: 'delete', path: 'board/inks' }]);
  const doc = createLiveBoardDocument({ transport, cache });
  t.after(() => doc.dispose());
  await Promise.all([...socketsReady, whenSnapshot(doc, () => doc.getSnapshot().loadState === 'live')]);
  const disk = (path: string) => JSON.parse(readFileSync(join(dir, 'board', 'db', path + '.json'), 'utf8'));
  return { doc, cache, db, transport, peer, connect, disk, writesFromA, receipts, socketsReady,
    server, artifactId, pageUrl, root, request,
    revokeAccess: () => { owner = false; } };
}

function whenSnapshot(doc: LiveBoardDocument, ready: () => boolean): Promise<void> {
  if (ready()) return Promise.resolve();
  return new Promise(resolve => {
    const off = doc.subscribe(() => {
      if (ready()) { off(); resolve(); }
    });
  });
}

type SyncBoard = Awaited<ReturnType<typeof openSyncBoard>>;
const inkPath = 'board/inks';
const inkPatch = (colors: Record<string, number | null>, ifMatch: string | null): SyncWrite => ({ op: 'update', path: inkPath, patch: { colors }, ifMatch });
const colorsOf = (client: LiveBoardDocument) => Object.fromEntries((client.content().inks ?? []).map(ink => [ink.color.slice(1), ink.at]));

async function twoEditors(t: TestContext, board: SyncBoard) {
  const other = createLiveBoardDocument({ transport: board.peer });
  t.after(() => other.dispose());
  const clients = [board.doc, other];
  await Promise.all([...board.socketsReady, ...clients.map(client => whenSnapshot(client, () => client.getSnapshot().loadState === 'live'))]);
  return other;
}

async function assertStoredInks(t: TestContext, board: SyncBoard, other: LiveBoardDocument, colors: Record<string, number> | null) {
  if (colors === null) assert.throws(() => board.disk(inkPath), { code: 'ENOENT' });
  else assert.deepEqual(board.disk(inkPath), { colors });
  assert.deepEqual(await board.connect('inspector').get(inkPath), colors && { colors });
  const reader = createLiveBoardDocument({ transport: board.connect('new-reader'), readOnly: true });
  t.after(() => reader.dispose());
  await whenSnapshot(reader, () => reader.getSnapshot().loadState === 'live');
  assert.equal(reader.canEdit(), false);
  for (const client of [board.doc, other, reader]) {
    await whenSnapshot(client, () => colors === null ? !client.content().inks?.length : Object.entries(colors).every(([color, at]) => colorsOf(client)[color] === at));
    assert.deepEqual(colorsOf(client), colors ?? {});
    assert.equal(client.getSnapshot().pending, 0);
    assert.equal(client.getSnapshot().flights, 0);
  }
  return reader;
}

function fullPalette(count = MAX_BOARD_INKS): Record<string, number> {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [(i + 1).toString(16).padStart(6, '0'), i + 1]));
}

function holdDelivery() {
  const entered = deferred(), released = deferred();
  return { entered: entered.promise, release: released.resolve, async hold() { entered.resolve(); await released.promise; } };
}

const inkProviders = { bare: false, LocalProvider: 'watermarked', 'unwatermarked LocalProvider': 'unwatermarked' } as const;
type InkTransport = keyof typeof inkProviders;

/** Queue real deletion/recreation notifications at A before its guarded update conflicts and GET returns null. */
async function queueInkDeletions(t: TestContext, transport: InkTransport, options: {
  oldRecreations?: readonly `#${string}`[];
  inkGetResponse?: InkGetResponse;
  firstInkAt?: number | 'now';
  followupReads?: readonly ReturnType<typeof holdDelivery>[];
} = {}) {
  const oldRecreations = options.oldRecreations ?? ['#aabbcc'];
  const oldWrite = holdDelivery(), creation = holdDelivery(), receipt = holdDelivery(), verification = holdDelivery();
  const readGates = [verification, ...(options.followupReads ?? [])];
  const frames: { release: ReturnType<typeof deferred>; delivered: ReturnType<typeof deferred> }[] = [];
  const frameAt = (index: number) => frames[index] ??= { release: deferred(), delivered: deferred() };
  const wire: ServerEvents['db'][] = [], attempts: SyncWrite[] = [], reads: (SyncDocument['data'] | null)[] = [];
  const base = { colors: { '445566': 8 } };
  const board = await openSyncBoard(t, 'live', {
    initialColors: base.colors,
    inkGetResponse: options.inkGetResponse,
    localProvider: inkProviders[transport],
    async beforeWrite(writes, id) {
      if (id !== 'sync-board') return;
      attempts.push(...writes);
      if (attempts.length === 1) await oldWrite.hold();
      if (attempts.length === 2) await creation.hold();
    },
    async afterWrite(id) {
      if (id === 'sync-board' && board.writesFromA.length === 1) await receipt.hold();
    },
    async afterGet(path, id, data) {
      if (id !== 'sync-board' || path !== inkPath) return;
      reads.push(data);
      await readGates[reads.length - 2]?.hold();
    },
    async beforeInkEvent(id) {
      if (id === 'sync-board') await frameAt(wire.length).release.promise;
    },
    afterInkEvent(id, _data, frame) {
      if (id !== 'sync-board') return;
      wire.push(frame);
      frameAt(wire.length - 1).delivered.resolve();
    },
  });
  t.after(() => {
    for (const gate of [oldWrite, creation, receipt, ...readGates]) gate.release();
    frames.forEach(frame => frame.release.resolve());
  });
  const { doc } = board;
  const other = await twoEditors(t, board);
  const third = board.connect('third-editor');
  const add = (client: LiveBoardDocument, color: `#${string}`, at?: number) =>
    client.updateContent(content => withInks(content, addInk(content.inks ?? [], color, at)));
  add(doc, '#778899', 9);
  const conflict = doc.flush();
  await oldWrite.entered;
  await third.write([{ op: 'delete', path: inkPath }]);
  await whenSnapshot(other, () => !other.content().inks?.length);
  for (const [i, color] of oldRecreations.entries()) {
    add(other, color, 10 + i);
    await other.flush();
    await third.write([{ op: 'delete', path: inkPath }]);
    await whenSnapshot(other, () => !other.content().inks?.length);
  }
  oldWrite.release();
  await conflict;
  assert.deepEqual(reads, [null]);
  assert.deepEqual(attempts, [inkPatch({ '778899': 9 }, documentSha256(base))]);
  assert.equal(doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
  const noticeId = doc.getSnapshot().notice!.id;
  const views: Record<string, number>[] = [];
  t.after(doc.subscribe(change => { if (change.valueChanged) views.push(colorsOf(doc)); }));
  add(doc, '#112233', options.firstInkAt === 'now' ? undefined : options.firstInkAt ?? 11);
  const firstAt = doc.content().inks!.find(ink => ink.color === '#112233')!.at;
  return {
    board, doc, other, third, attempts, reads, wire, views, noticeId, creation, receipt, verification, firstAt,
    addSecond: () => add(doc, '#334455', firstAt + 1),
    async deliver(index: number) {
      const frame = frameAt(index);
      frame.release.resolve();
      await frame.delivered.promise;
    },
  };
}

describe('palette edits after a null conflict read', { timeout: 15_000 }, () => {
  const first = { '112233': 11 }, second = { '334455': 12 }, both = { ...first, ...second };
  for (const transport of ['bare', 'LocalProvider', 'unwatermarked LocalProvider'] as const) {
    for (const timing of ['queued before delivery', 'queued between events', 'still debouncing', 'peer deletes after commit'] as const) {
      it(`${transport}, ${timing}`, async t => {
        const race = await queueInkDeletions(t, transport);
        const { board, doc, other, third, creation, receipt, verification, views } = race;
        const pendingOnly = timing === 'still debouncing';
        const deleted = timing === 'peer deletes after commit';
        const firstFlush = pendingOnly ? undefined : doc.flush();
        if (pendingOnly) {
          doc.documentBytes();
          assert.equal(race.attempts.length, 1);
          assert.equal(doc.getSnapshot().flights, 0);
        } else {
          await creation.entered;
          if (timing !== 'queued between events') race.addSecond();
          doc.documentBytes();
          assert.equal(doc.getSnapshot().pending, 1);
          assert.equal(doc.getSnapshot().flights, 1);
        }
        const deliveredViews: Record<string, number>[] = [];
        for (const index of [0, 1, 2]) {
          if (index === 2 && timing === 'queued between events') race.addSecond();
          await race.deliver(index);
          deliveredViews.push(colorsOf(doc));
        }
        assert.deepEqual(race.wire.map(event => event.changes[inkPath]), [null, { colors: { aabbcc: 10 } }, null]);
        for (const event of race.wire) {
          assert.equal(Object.hasOwn(event, 'epoch'), transport !== 'unwatermarked LocalProvider');
          assert.equal(Object.hasOwn(event, 'seq'), transport !== 'unwatermarked LocalProvider');
        }
        if (pendingOnly) await verification.entered;
        const saving = firstFlush ?? doc.flush();
        if (pendingOnly) assert.equal(race.attempts.length, 1, 'flush waits for the outstanding GET');
        verification.release();
        await creation.entered;
        creation.release();
        await receipt.entered;
        assert.deepEqual(board.disk(inkPath), { colors: first });
        if (deleted) {
          await third.write([{ op: 'delete', path: inkPath }]);
          await race.deliver(3);
          assert.deepEqual(colorsOf(doc), both);
        }
        receipt.release();
        await saving;
        await doc.whenWritten([inkPath]);
        const own = board.receipts.filter(r => r.client === 'sync-board');
        const expected = [inkPatch({ '778899': 9 }, documentSha256({ colors: { '445566': 8 } })), inkPatch(first, null)];
        if (!pendingOnly && !deleted) expected.push(inkPatch(second, documentSha256({ colors: first })));
        assert.deepEqual(own.map(r => r.writes), expected.map(write => [write]));
        assert.deepEqual(own.map(r => r.status), expected.map((_, index) => index === 0 ? 409 : 200));
        assert.deepEqual(race.attempts, expected);
        const expectedViews = pendingOnly ? [first, first, first] : timing === 'queued between events' ? [first, first, both] : [both, both, both];
        assert.deepEqual(deliveredViews, expectedViews);
        if (deleted) {
          assert.deepEqual(race.reads.at(-1), null);
          assert.equal(doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
          assert.ok(doc.getSnapshot().notice!.id > race.noticeId);
          assert.throws(() => board.disk(inkPath), { code: 'ENOENT' });
          assert.equal(await third.get(inkPath), null);
          const reader = createLiveBoardDocument({ transport: board.connect('new-reader'), readOnly: true });
          t.after(() => reader.dispose());
          for (const client of [doc, other, reader]) {
            await whenSnapshot(client, () => client.getSnapshot().loadState === 'live' && !client.content().inks?.length);
            assert.equal(client.getSnapshot().pending, 0);
            assert.equal(client.getSnapshot().flights, 0);
          }
        } else {
          assert.deepEqual(views, pendingOnly ? [first] : [first, both]);
          assert.equal(doc.getSnapshot().notice!.id, race.noticeId);
          await assertStoredInks(t, board, other, pendingOnly ? first : both);
        }
      });
    }
  }

  it('retains a debounced creation when the null verification completes before the last old deletion', async t => {
    const { doc, board, other, creation, receipt, verification, deliver, attempts, reads } = await queueInkDeletions(t, 'bare');
    doc.documentBytes();
    await deliver(0);
    await deliver(1);
    await verification.entered;
    verification.release();
    await settle();
    assert.deepEqual(reads, [null, null]);
    assert.equal(attempts.length, 1);
    await deliver(2);
    assert.deepEqual(colorsOf(doc), first);
    creation.release();
    receipt.release();
    await doc.flush();
    await assertStoredInks(t, board, other, first);
  });

  it('checks a newer peer deletion before sending the queued edit when the accepted creation GET is delayed', async t => {
    const { board, doc, third, addSecond, creation, receipt, verification, deliver, reads, noticeId } = await queueInkDeletions(t, 'bare');
    const saving = doc.flush();
    await creation.entered;
    addSecond();
    for (const index of [0, 1, 2]) await deliver(index);
    creation.release();
    await receipt.entered;
    receipt.release();
    await verification.entered;
    assert.deepEqual(reads.at(-1), { colors: first });
    await third.write([{ op: 'delete', path: inkPath }]);
    await deliver(3);
    assert.deepEqual(colorsOf(doc), both);
    verification.release();
    await saving;
    assert.deepEqual(reads.at(-1), null);
    assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), [409, 200]);
    assert.ok(doc.getSnapshot().notice!.id > noticeId);
    assert.equal(doc.getSnapshot().notice!.message, LIVE_MESSAGES.itemGone);
    assert.deepEqual(colorsOf(doc), {});
    assert.equal(doc.getSnapshot().pending, 0);
    assert.equal(doc.getSnapshot().flights, 0);
    assert.throws(() => board.disk(inkPath), { code: 'ENOENT' });
  });

  for (const queued of [false, true]) {
    it(`keeps ${queued ? 'both inks' : 'the accepted ink'} when the verification GET loses its HTTP connection`, async t => {
      const { doc, board, other, addSecond, creation, receipt, verification, deliver } = await queueInkDeletions(t, 'bare');
      const saving = doc.flush();
      await creation.entered;
      if (queued) addSecond();
      for (const index of [0, 1, 2]) await deliver(index);
      creation.release();
      await receipt.entered;
      let disconnected = false;
      const disconnect = (req: IncomingMessage) => {
        if (req.method === 'GET' && new URL(req.url!, board.pageUrl).pathname.endsWith(API.dbGet)) {
          disconnected = true;
          req.socket.destroy();
        }
      };
      board.server.server.prependListener('request', disconnect);
      try {
        verification.release();
        receipt.release();
        await saving;
      } finally { board.server.server.off('request', disconnect); }
      assert.ok(disconnected);
      if (queued) assert.deepEqual(board.writesFromA, [inkPatch(first, null), inkPatch(second, documentSha256({ colors: first }))]);
      else assert.equal(doc.getSnapshot().lastError?.code, 'unavailable');
      await assertStoredInks(t, board, other, queued ? both : first);
    });
  }
});

/** The server has created #112233, but A has not received its 200 response. */
async function holdAcceptedInk(race: Awaited<ReturnType<typeof queueInkDeletions>>, queueSecond: boolean) {
  const saved = race.doc.flush();
  await race.creation.entered;
  if (queueSecond) race.addSecond();
  for (const index of [0, 1, 2]) await race.deliver(index);
  race.creation.release();
  await race.receipt.entered;
  assert.deepEqual(race.board.disk(inkPath), { colors: { '112233': race.firstAt } });
  return { saved };
}

/** Hold the creation GET after it has read the accepted ink. */
async function holdCreationRead(race: Awaited<ReturnType<typeof queueInkDeletions>>) {
  race.receipt.release();
  await race.verification.entered;
  assert.deepEqual(race.reads.at(-1), { colors: { '112233': race.firstAt } });
}

describe('palette verification across peer edits and reconnects', { timeout: 30_000 }, () => {
  const first = { '112233': 11 }, second = { '334455': 12 };
  for (const transport of ['bare', 'LocalProvider', 'unwatermarked LocalProvider'] as const) {
    for (const timing of ['before the creation GET', 'after the creation GET'] as const) {
      for (const edit of ['64-color rebuild', 'one-color rebuild', 'add only'] as const) {
        it(`${transport}, ${edit} ${timing}`, async t => {
          const race = await queueInkDeletions(t, transport);
          const { board, doc, third, reads, receipt, verification } = race;
          const { saved } = await holdAcceptedInk(race, true);
          const gap = timing === 'after the creation GET';
          if (gap) await holdCreationRead(race);
          let frame = 3;
          const addOnly = edit === 'add only';
          const peer: Record<string, number> = addOnly ? { ...first, aabbcc: 14 } : edit === '64-color rebuild' ? fullPalette() : { ccddee: 14 };
          if (addOnly) {
            await third.write([inkPatch({ aabbcc: 14 }, documentSha256({ colors: first }))]);
          } else {
            await third.write([{ op: 'delete', path: inkPath }]);
            await race.deliver(frame++);
            await third.write([{ op: 'set', path: inkPath, data: { colors: peer } }]);
          }
          await race.deliver(frame);
          receipt.release();
          await verification.entered;
          verification.release();
          await saved;
          await doc.whenWritten([inkPath]);
          assert.deepEqual(reads, [null, ...(gap ? [{ colors: first }] : []), { colors: peer }]);
          const writes = [inkPatch(first, null)];
          if (addOnly) writes.push(inkPatch(second, documentSha256({ colors: peer })));
          assert.deepEqual(board.writesFromA, writes);
          assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), addOnly ? [409, 200, 200] : [409, 200]);
          if (addOnly) assert.equal(doc.getSnapshot().notice!.id, race.noticeId);
          else {
            assert.equal(doc.getSnapshot().notice!.message, LIVE_MESSAGES.itemGone);
            assert.ok(doc.getSnapshot().notice!.id > race.noticeId);
          }
          await assertStoredInks(t, board, race.other, addOnly ? { ...peer, ...second } : peer);
        });
      }
    }
  }

  for (const transport of ['bare', 'unwatermarked LocalProvider'] as const) {
    it(`${transport} keeps both debounced inks across three pre-GET deletions`, async t => {
      const race = await queueInkDeletions(t, transport, { oldRecreations: ['#aabbcc', '#ddeeff'] });
      const { doc, board, reads, verification } = race;
      const both = { ...first, ...second };
      race.addSecond();
      doc.documentBytes();
      assert.equal(doc.getSnapshot().pending, 1);
      assert.equal(doc.getSnapshot().flights, 0);
      await race.deliver(0);
      await race.deliver(1);
      await verification.entered;
      verification.release();
      await settle();
      assert.deepEqual(reads, [null, null]);
      for (const index of [2, 3, 4]) {
        await race.deliver(index);
      }
      assert.deepEqual(colorsOf(doc), both);
      assert.deepEqual(race.views, [first, both]);
      assert.deepEqual(race.wire.map(ev => ev.changes[inkPath]), [null, { colors: { aabbcc: 10 } }, null, { colors: { ddeeff: 11 } }, null]);
      assert.equal(race.attempts.length, 1, 'the post-GET inputs are still debouncing');
      race.creation.release();
      race.receipt.release();
      await doc.flush();
      assert.deepEqual(board.writesFromA, [inkPatch(both, null)]);
      assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), [409, 200]);
      await assertStoredInks(t, board, race.other, both);
    });
  }

  for (const recovery of ['note after 650ms', 'timer only', 'manual retry', 'note during backoff'] as const) {
    const outcomes = recovery === 'note after 650ms' ? ['deleted', 'retained', 'retained with queued edit'] as const : ['deleted'] as const;
    for (const outcome of outcomes) {
      it(`recovers a disconnected verification GET: ${outcome}, ${recovery}`, async t => {
        let disconnected = false;
        const lost: (SyncDocument['data'] | null)[] = [], recovered: (SyncDocument['data'] | null)[] = [];
        const race = await queueInkDeletions(t, 'unwatermarked LocalProvider', {
          inkGetResponse(data, response) {
            if (disconnected) { lost.push(data); response.destroy(); }
            else if (lost.length) recovered.push(data);
          },
        });
        const { doc, board, third } = race;
        const deleted = outcome === 'deleted', queued = outcome === 'retained with queued edit';
        const { saved } = await holdAcceptedInk(race, queued);
        if (deleted) {
          await third.write([{ op: 'delete', path: inkPath }]);
          await race.deliver(3);
        }
        const offline = whenSnapshot(doc, () => doc.getSnapshot().lastError?.code === 'unavailable');
        disconnected = true;
        race.verification.release();
        race.receipt.release();
        await offline;
        assert.deepEqual(lost[0], deleted ? null : { colors: first });
        assert.deepEqual(colorsOf(doc), queued ? { ...first, ...second } : first);
        await saved;
        await doc.whenWritten([inkPath]);
        let backoffStarted: number | undefined;
        if (recovery === 'note after 650ms') {
          await delay(650);
        } else {
          const firstError = doc.getSnapshot().lastError;
          await whenSnapshot(doc, () => doc.getSnapshot().lastError !== firstError);
          assert.ok(lost.length >= 2, 'a scheduled GET retried while disconnected');
          backoffStarted = performance.now();
        }
        disconnected = false;
        if (recovery === 'manual retry') doc.retry();
        if (recovery === 'note after 650ms' || recovery === 'note during backoff') {
          await third.write([{ op: 'update', path: 'elements/n1', patch: { text: 'reconnected' } }]);
          await whenSnapshot(doc, () => textOf(doc, 'n1') === 'reconnected');
        }
        await whenSnapshot(doc, () => !doc.getSnapshot().lastError && doc.getSnapshot().flights === 0);
        if (backoffStarted !== undefined) {
          const elapsed = performance.now() - backoffStarted;
          if (recovery === 'timer only') assert.ok(elapsed >= WRITE_RETRY_BASE_MS - 100, 'successive failures back off');
          else assert.ok(elapsed < WRITE_RETRY_BASE_MS / 2, 'reconnect and retry wake the scheduled GET');
        }
        if (!queued) assert.deepEqual(recovered, [deleted ? null : { colors: first }]);
        const writes = [inkPatch(first, null)];
        if (queued) writes.push(inkPatch(second, documentSha256({ colors: first })));
        assert.deepEqual(board.writesFromA, writes);
        assert.equal(doc.getSnapshot().pending, 0);
        await assertStoredInks(t, board, race.other, deleted ? null : queued ? { ...first, ...second } : first);
      });
    }
  }
});

describe('same-hex palette rebuilds and capacity evictions', { timeout: 30_000 }, () => {
  const first = { '112233': 100 }, second = { '334455': 101 };
  const numbered = fullPalette(MAX_BOARD_INKS - 1);
  const full = { name: '64 rebuilt inks', colors: { ...numbered, '112233': 250 } };
  const two = { name: 'two rebuilt inks', colors: { '112233': 250, ccddee: 251 } };
  const sameTime = { name: 'the original timestamp', colors: { ...first, ccddee: 251 } };
  for (const transport of ['bare', 'LocalProvider', 'unwatermarked LocalProvider'] as const) {
    for (const [timing, rebuilt] of [
      ['before creation GET', full],
      ['during creation GET', two], ['during creation GET', full],
      ['during null recheck', full], ['during null recheck', two], ['during null recheck', sameTime],
      ['during replacement recheck', sameTime],
    ] as const) {
      it(`${transport}, ${rebuilt.name} ${timing}`, async t => {
        const recheck = holdDelivery(), finalRead = holdDelivery();
        const race = await queueInkDeletions(t, transport, { firstInkAt: 100, followupReads: [recheck, finalRead] });
        const { board, doc, third, receipt, verification, reads } = race;
        const { saved } = await holdAcceptedInk(race, true);
        const before = timing === 'before creation GET';
        const superseded = timing === 'during null recheck' || timing === 'during replacement recheck';
        if (!before) await holdCreationRead(race);
        let frame = 3;
        await third.write([{ op: 'delete', path: inkPath }]);
        await race.deliver(frame++);
        const intermediate = timing === 'during replacement recheck' ? { colors: two.colors } : null;
        if (intermediate) {
          await third.write([{ op: 'set', path: inkPath, data: intermediate }]);
          await race.deliver(frame++);
        }
        if (superseded) {
          verification.release();
          await recheck.entered;
          assert.deepEqual(reads.at(-1), intermediate);
          if (intermediate) assert.deepEqual(board.disk(inkPath), intermediate);
          else assert.throws(() => board.disk(inkPath), { code: 'ENOENT' });
        }
        const latest = { colors: rebuilt.colors };
        await third.write([{ op: 'set', path: inkPath, data: latest }]);
        await race.deliver(frame);
        assert.deepEqual(colorsOf(doc), { ...first, ...second });
        receipt.release();
        verification.release();
        recheck.release();
        if (superseded) {
          await finalRead.entered;
          assert.deepEqual(reads.at(-1), latest);
          assert.deepEqual(colorsOf(doc), intermediate?.colors ?? {});
          assert.equal(doc.getSnapshot().pending, 0);
        }
        finalRead.release();
        await saved;
        await doc.whenWritten([inkPath]);
        assert.deepEqual(reads, [null, ...(before ? [] : [{ colors: first }]), ...(superseded ? [intermediate] : []), latest]);
        assert.deepEqual(board.writesFromA, [inkPatch(first, null)]);
        assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), [409, 200]);
        assert.equal(doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
        assert.ok(doc.getSnapshot().notice!.id > race.noticeId);
        await assertStoredInks(t, board, race.other, rebuilt.colors);
      });
    }

    for (const eviction of [false, true]) {
      it(`${transport} preserves the queued ink after ${eviction ? 'the oldest of 64 is evicted' : '63 inks are appended'}`, async t => {
        const race = await queueInkDeletions(t, transport, { firstInkAt: 100 });
        const { board, other, third, receipt, verification } = race;
        const { saved } = await holdAcceptedInk(race, true);
        const filled = { ...first, ...numbered };
        await third.write([inkPatch(numbered, documentSha256({ colors: first }))]);
        await race.deliver(3);
        receipt.release();
        await verification.entered;
        assert.deepEqual(race.reads.at(-1), { colors: filled });
        const peer: Record<string, number> = { ...filled };
        if (eviction) {
          await whenSnapshot(other, () => other.content().inks?.length === MAX_BOARD_INKS);
          other.updateContent(content => withInks(content, addInk(content.inks!, '#aabbcc', 200)));
          await other.flush();
          await race.deliver(4);
          delete peer['000001'];
          peer.aabbcc = 200;
        }
        assert.deepEqual(board.disk(inkPath), { colors: peer });
        verification.release();
        await saved;
        assert.deepEqual(race.reads, [null, { colors: filled }, ...(eviction ? [{ colors: peer }] : [])]);
        const oldest = eviction ? '000002' : '000001';
        const final: Record<string, number> = { ...peer, ...second };
        delete final[oldest];
        assert.deepEqual(board.writesFromA, [inkPatch(first, null), { op: 'update', path: inkPath,
          patch: { colors: { [oldest]: null, ...second } }, ifMatch: documentSha256({ colors: peer }) }]);
        assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), [409, 200, 200]);
        assert.equal(race.doc.getSnapshot().notice!.id, race.noticeId);
        await assertStoredInks(t, board, other, final);
      });
    }
  }

  it('breaks timestamp ties by hex and permits only an oldest prefix to be evicted', () => {
    const sameDocument = createBoardLiveCodec().sameDocument!;
    const colors = Object.fromEntries(Object.entries(fullPalette()).reverse());
    colors['000002'] = colors['000001']!;
    for (const [removed, continuous] of [['000001', true], ['000002', false], ['000040', false]] as const) {
      const next: Record<string, number> = { ...colors, aabbcc: 200 };
      delete next[removed];
      assert.equal(sameDocument({ colors }, { colors: next }), continuous);
    }
    assert.equal(sameDocument({ colors }, { colors: { ...colors, '000040': 250 } }), false);
    assert.equal(sameDocument({ colors: { '112233': 100 } }, { colors: { '112233': '100' } }), false);
  });
});

/** Hold A's first guarded write and its incoming peer frames until the test delivers each. */
async function holdInkConflict(t: TestContext, transport: InkTransport, initialColors: Record<string, unknown>, peerFrames: number) {
  const write = holdDelivery(), events = holdDelivery(), delivered = deferred();
  const base = { colors: initialColors }, reads: (SyncDocument['data'] | null)[] = [];
  const baseHash = documentSha256(base);
  let frames = 0;
  const board = await openSyncBoard(t, 'live', {
    initialColors, localProvider: inkProviders[transport],
    async beforeWrite(writes, id) {
      if (id === 'sync-board' && writes[0]?.ifMatch === baseHash) await write.hold();
    },
    async afterGet(path, id, data) { if (id === 'sync-board' && path === inkPath) reads.push(data); },
    async beforeInkEvent(id) { if (id === 'sync-board') await events.hold(); },
    afterInkEvent(id) { if (id === 'sync-board' && ++frames === peerFrames) delivered.resolve(); },
  });
  t.after(() => { write.release(); events.release(); });
  const other = await twoEditors(t, board);
  assert.deepEqual(board.disk(inkPath), base);
  async function holdWrite() {
    const saved = board.doc.flush();
    await write.entered;
    return async () => { write.release(); await saved; };
  }
  return {
    board, other, reads, holdWrite,
    async startWrite(color: string, at = 100) {
      board.doc.updateContent(content => withInks(content, addInk(content.inks ?? [], color, at)));
      return holdWrite();
    },
    async deliverPeerFrames() { events.release(); await delivered.promise; },
  };
}

describe('identical ink recreations and concurrent palette additions', { timeout: 30_000 }, () => {
  for (const transport of ['bare', 'LocalProvider', 'unwatermarked LocalProvider'] as const) {
    for (const timing of ['identical after null', 'editor timestamp after null', 'fill after identical', 'restore after replacement'] as const) {
      it(`${transport}, ${timing} before the recheck returns`, async t => {
        const recheck = holdDelivery(), finalRead = holdDelivery();
        const started = Date.now();
        const race = await queueInkDeletions(t, transport, {
          firstInkAt: timing === 'editor timestamp after null' ? 'now' : 100,
          followupReads: [recheck, finalRead],
        });
        const { doc, board, third, firstAt } = race;
        const { saved } = await holdAcceptedInk(race, true);
        if (timing === 'editor timestamp after null') assert.ok(firstAt >= started && firstAt <= Date.now());
        const first = { '112233': firstAt };
        const original = board.disk(inkPath);
        assert.deepEqual(original, { colors: first });
        await holdCreationRead(race);
        let frame = 3;
        await third.write([{ op: 'delete', path: inkPath }]);
        await race.deliver(frame++);
        const intermediate = timing === 'restore after replacement' ? { colors: { '112233': 250 } } : null;
        if (intermediate) {
          await third.write([{ op: 'set', path: inkPath, data: intermediate }]);
          await race.deliver(frame++);
        }
        race.verification.release();
        await recheck.entered;
        assert.deepEqual(race.reads, [null, original, intermediate]);
        if (intermediate) assert.deepEqual(board.disk(inkPath), intermediate);
        else assert.throws(() => board.disk(inkPath), { code: 'ENOENT' });

        await third.write([{ op: 'set', path: inkPath, data: original }]);
        await race.deliver(frame++);
        assert.deepEqual(race.wire.at(-1)!.changes[inkPath], original);
        const latest = { ...first };
        if (timing === 'fill after identical') {
          const additions = fullPalette(MAX_BOARD_INKS - 1);
          await third.write([inkPatch(additions, documentSha256(original))]);
          await race.deliver(frame);
          Object.assign(latest, additions);
        }
        assert.deepEqual(board.disk(inkPath), { colors: latest });
        const visibleBeforeRead = colorsOf(doc);
        recheck.release();
        await Promise.race([finalRead.entered, saved]);
        assert.deepEqual(board.writesFromA, [inkPatch(first, null)]);
        assert.deepEqual(race.reads, [null, original, intermediate, { colors: latest }]);
        assert.deepEqual(visibleBeforeRead, { ...first, '334455': firstAt + 1 });
        assert.deepEqual(colorsOf(doc), intermediate?.colors ?? {});
        assert.equal(doc.getSnapshot().pending, 0);
        finalRead.release();
        await saved;
        await doc.whenWritten([inkPath]);
        assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), [409, 200]);
        assert.equal(doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
        assert.ok(doc.getSnapshot().notice!.id > race.noticeId);
        await assertStoredInks(t, board, race.other, latest);
      });
    }

    for (const count of [63, 62, 'legacy'] as const) {
      it(`${transport} preserves a concurrent add on a ${count}-ink starting record`, async t => {
        const legacy = count === 'legacy';
        const visible: Record<string, number> = legacy ? { '445566': 8 } : fullPalette(count);
        const raw = legacy ? { ...visible, abcdef: '10' } : visible;
        const additions = ['aabbcc', 'bbccdd', 'ccddee'].slice(0, legacy ? 1 : MAX_BOARD_INKS + 1 - count);
        const race = await holdInkConflict(t, transport, raw, additions.length);
        const finishWrite = await race.startWrite('#112233');
        const { board, other } = race;
        assert.deepEqual(colorsOf(other), visible);
        assert.deepEqual(colorsOf(board.doc), { ...visible, '112233': 100 });
        const peer = { ...visible };
        for (const [i, hex] of additions.entries()) {
          const guard = documentSha256({ colors: i === 0 ? raw : peer });
          const at = 200 + i;
          other.updateContent(content => withInks(content, addInk(content.inks!, '#' + hex, at)));
          await other.flush();
          const patch: Record<string, number | null> = { [hex]: at };
          if (legacy) patch.abcdef = null;
          else if (i === additions.length - 1) { patch['000001'] = null; delete peer['000001']; }
          peer[hex] = at;
          assert.deepEqual(board.receipts.at(-1), { client: 'second-editor', status: 200,
            writes: [{ op: 'update', path: inkPath, patch: { colors: patch }, ifMatch: guard }] });
        }
        assert.deepEqual(board.disk(inkPath), { colors: peer });
        await finishWrite();
        assert.deepEqual(race.reads, [{ colors: peer }]);
        const patch: Record<string, number | null> = { '112233': 100 };
        const final: Record<string, number> = { ...peer, '112233': 100 };
        if (!legacy) { patch['000002'] = null; delete final['000002']; }
        assert.deepEqual(board.writesFromA, [{ op: 'update', path: inkPath,
          patch: { colors: patch }, ifMatch: documentSha256({ colors: peer }) }]);
        const own = board.receipts.filter(r => r.client === 'sync-board');
        assert.deepEqual(own.map(r => r.status), [409, 200]);
        assert.equal(own[0]!.writes[0]!.ifMatch, documentSha256({ colors: raw }));
        assert.ok(board.receipts.every(r => r.writes.every(w => w.op !== 'delete')));
        await race.deliverPeerFrames();
        await board.doc.flush();
        assert.equal(board.doc.getSnapshot().notice, undefined);
        await assertStoredInks(t, board, other, final);
      });
    }

    it(`${transport} drops a queued edit on a rebuilt full palette containing older inks`, async t => {
      const base = { '000050': 50, '112233': 100 };
      const latest = { ...fullPalette(MAX_BOARD_INKS - 1), '112233': 100 };
      const race = await holdInkConflict(t, transport, base, 2);
      const finishWrite = await race.startWrite('#334455');
      const { board } = race;
      const rebuilder = board.connect('rebuilder');
      await rebuilder.write([{ op: 'delete', path: inkPath }]);
      await rebuilder.write([{ op: 'set', path: inkPath, data: { colors: latest } }]);
      await finishWrite();
      assert.deepEqual(race.reads, [{ colors: latest }]);
      assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), [409]);
      assert.equal(board.doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
      await race.deliverPeerFrames();
      await board.doc.flush();
      assert.deepEqual(board.writesFromA, []);
      await assertStoredInks(t, board, race.other, latest);
    });
  }

  it('compares normalized inks when legacy timestamps and invalid hex keys are cleaned', () => {
    const codec = createBoardLiveCodec(), same = codec.sameDocument!;
    const legacy = { colors: { '445566': 8, abcdef: '10', invalid: 7 } };
    assert.deepEqual(codec.normalizeDocument!(inkPath, legacy), { colors: { '445566': 8 } });
    assert.equal(same(legacy, { colors: { '445566': 8, aabbcc: 200 } }), true);
    assert.equal(same(legacy, { colors: { '445566': 9, aabbcc: 200 } }), false);
    assert.equal(same({ colors: { abcdef: '10' } }, { colors: {} }), true);
  });

  it('allows eviction across capacity only when every omitted ink precedes the oldest retained ink', () => {
    const same = createBoardLiveCodec().sameDocument!;
    for (const count of [62, 63]) {
      const initial = fullPalette(count);
      const next: Record<string, number> = { ...initial, aabbcc: 200, bbccdd: 201, ...(count === 62 ? { ccddee: 202 } : {}) };
      delete next['000001'];
      assert.equal(same({ colors: initial }, { colors: next }), true);
    }
    const full = { ...fullPalette(MAX_BOARD_INKS - 1), '112233': 100 };
    assert.equal(same({ colors: { '000050': 50, '112233': 100 } }, { colors: full }), false);
    assert.equal(same({ colors: { '0000ff': 1, '112233': 100 } }, { colors: full }), false);
    assert.equal(same({ colors: { '000000': 1, '112233': 100 } }, { colors: full }), true);
    assert.equal(same({ colors: { '112233': 100 } }, { colors: { ...full, '112233': 250 } }), false);
  });
});

describe('palette rebasing after capacity evictions', { timeout: 60_000 }, () => {
  async function saveInk(client: LiveBoardDocument, color: string, at: number) {
    assert.ok(client.updateContent(content => withInks(content, addInk(content.inks ?? [], color, at))));
    await client.flush();
  }

  function assertRetry(board: SyncBoard, base: Record<string, number>, first: Record<string, number | null>,
    peer: Record<string, number>, retry: Record<string, number | null>) {
    const accepted = inkPatch(retry, documentSha256({ colors: peer }));
    assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board'), [
      { client: 'sync-board', status: 409, writes: [inkPatch(first, documentSha256({ colors: base }))] },
      { client: 'sync-board', status: 200, writes: [accepted] },
    ]);
    assert.deepEqual(board.writesFromA, [accepted]);
    assert.equal(board.doc.getSnapshot().notice, undefined);
  }

  for (const transport of ['bare', 'LocalProvider', 'unwatermarked LocalProvider'] as const) {
    for (const timing of ['before', 'after'] as const) {
      it(`${transport} keeps a re-added color when its frames arrive ${timing} the 409`, async t => {
        const base = fullPalette();
        const race = await holdInkConflict(t, transport, base, 2);
        const { board, other } = race;
        const finishWrite = await race.startWrite('#112233');
        const firstPeer: Record<string, number> = { ...base, aabbcc: 200 };
        delete firstPeer['000001'];
        const peer: Record<string, number> = { ...firstPeer, '000001': 250 };
        delete peer['000002'];
        const final: Record<string, number> = { ...peer, '112233': 100 };
        delete final['000003'];
        const offset = board.receipts.length;
        await saveInk(other, '#AABBCC', 200);
        await saveInk(other, '#000001', 250);
        assert.deepEqual(board.receipts.slice(offset), [
          { client: 'second-editor', status: 200, writes: [inkPatch({ aabbcc: 200, '000001': null }, documentSha256({ colors: base }))] },
          { client: 'second-editor', status: 200, writes: [inkPatch({ '000001': 250, '000002': null }, documentSha256({ colors: firstPeer }))] },
        ]);
        if (timing === 'before') {
          await race.deliverPeerFrames();
          assert.deepEqual(colorsOf(board.doc), final);
        }
        await finishWrite();
        assert.deepEqual(race.reads, [{ colors: peer }]);
        assertRetry(board, base, { '112233': 100, '000001': null }, peer, { '112233': 100, '000003': null });
        if (timing === 'after') await race.deliverPeerFrames();
        await assertStoredInks(t, board, other, final);
      });
    }

    it(`${transport} keeps a peer's re-added ink throughout the acknowledged-write grace period`, async t => {
      const base = fullPalette(), delivered = deferred();
      const board = await openSyncBoard(t, 'live', {
        initialColors: base, localProvider: inkProviders[transport],
        afterInkEvent(id, data) {
          if (id === 'sync-board' && data && isPlainRecord(data.colors) && data.colors['000001'] === 250) delivered.resolve();
        },
      });
      const other = await twoEditors(t, board);
      const started = performance.now();
      await saveInk(board.doc, '#112233', 100);
      const acknowledged = performance.now();
      await whenSnapshot(other, () => colorsOf(other)['112233'] === 100);
      await saveInk(other, '#AABBCC', 200);
      await saveInk(other, '#000001', 250);
      await delivered.promise;
      const final: Record<string, number> = { ...base, '112233': 100, aabbcc: 200, '000001': 250 };
      delete final['000002'];
      delete final['000003'];
      assert.deepEqual(colorsOf(board.doc), final);
      assert.deepEqual(board.disk(inkPath), { colors: final });
      await delay(LIVE_CACHE_WRITE_DELAY_MS + 50);
      assert.ok(performance.now() - started < ACKNOWLEDGED_WRITE_GRACE_MS);
      assert.deepEqual(board.cache.read()?.find(doc => doc.path === inkPath)?.data, { colors: final });
      await delay(acknowledged + ACKNOWLEDGED_WRITE_GRACE_MS + 25 - performance.now());
      await assertStoredInks(t, board, other, final);
      assert.deepEqual(board.writesFromA, [inkPatch({ '112233': 100, '000001': null }, documentSha256({ colors: base }))]);
    });

    for (const rebuild of ['same 64 hexes', '64 older inks'] as const) {
      it(`${transport} drops a stale write when GET sees a rebuild with ${rebuild} before its frames`, async t => {
        const sameHexes = rebuild === 'same 64 hexes';
        const base = sameHexes ? fullPalette() : { '000050': 70 };
        const latest = fullPalette();
        if (sameHexes) latest['000001'] = 250;
        const race = await holdInkConflict(t, transport, base, 2);
        const { board } = race;
        const finishWrite = await race.startWrite('#112233');
        const rebuilder = board.connect('rebuilder');
        await rebuilder.write([{ op: 'delete', path: inkPath }]);
        await rebuilder.write([{ op: 'set', path: inkPath, data: { colors: latest } }]);
        await finishWrite();
        assert.deepEqual(race.reads, [{ colors: latest }]);
        assert.equal(createBoardLiveCodec().sameDocument!({ colors: base }, { colors: latest }), false);
        const first = inkPatch({ '112233': 100, ...(sameHexes ? { '000001': null } : {}) }, documentSha256({ colors: base }));
        assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board'), [{ client: 'sync-board', status: 409, writes: [first] }]);
        assert.equal(board.doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
        await race.deliverPeerFrames();
        await board.doc.flush();
        assert.deepEqual(board.writesFromA, []);
        await assertStoredInks(t, board, race.other, latest);
      });
    }

    it(`${transport} resolves a lagging-clock conflict according to the available deletion history`, async t => {
      const future = Date.now() + 90_000;
      const base = Object.fromEntries(Object.entries(fullPalette()).map(([hex, at]) => [hex, future + at]));
      const race = await holdInkConflict(t, transport, base, 1);
      const { board, other } = race;
      const peerAt = Date.now();
      await saveInk(other, '#AABBCC', peerAt);
      const peer: Record<string, number> = { ...base, aabbcc: peerAt };
      delete peer['000001'];
      assert.deepEqual(board.disk(inkPath), { colors: peer });
      assert.deepEqual(colorsOf(board.doc), base);
      const localAt = Date.now();
      assert.ok(Math.max(peerAt, localAt) < base['000001']!);
      const finishWrite = await race.startWrite('#112233', localAt);
      await finishWrite();
      assert.deepEqual(race.reads, [{ colors: peer }]);
      if (transport !== 'LocalProvider') {
        assert.equal(board.doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
        assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), [409]);
        await race.deliverPeerFrames();
        await board.doc.flush();
        await assertStoredInks(t, board, other, peer);
        return;
      }
      assertRetry(board, base, { '112233': localAt, '000001': null }, peer, { '112233': localAt, '000002': null });
      const final: Record<string, number> = { ...peer, '112233': localAt };
      delete final['000002'];
      await race.deliverPeerFrames();
      await assertStoredInks(t, board, other, final);
    });

    it(`${transport} resolves 64 successive same-time additions according to the available deletion history`, async t => {
      const base = { '445566': 8 };
      const race = await holdInkConflict(t, transport, base, MAX_BOARD_INKS);
      const { board, other } = race;
      const peer: Record<string, number> = {};
      const offset = board.receipts.length;
      for (let i = 0; i < MAX_BOARD_INKS; i++) {
        const hex = (0x101 + i).toString(16).padStart(6, '0');
        await saveInk(other, '#' + hex, 200);
        peer[hex] = 200;
      }
      const receipts = board.receipts.slice(offset);
      assert.equal(receipts.length, MAX_BOARD_INKS);
      assert.ok(receipts.every(r => r.client === 'second-editor' && r.status === 200 && r.writes.length === 1 &&
        r.writes[0]!.op === 'update' && r.writes[0]!.path === inkPath));
      assert.deepEqual(board.disk(inkPath), { colors: peer });
      assert.deepEqual(colorsOf(board.doc), base);
      const finishWrite = await race.startWrite('#112233');
      await finishWrite();
      assert.deepEqual(race.reads, [{ colors: peer }]);
      if (transport !== 'LocalProvider') {
        assert.equal(board.doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
        assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), [409]);
        await race.deliverPeerFrames();
        await board.doc.flush();
        await assertStoredInks(t, board, other, peer);
        return;
      }
      assertRetry(board, base, { '112233': 100 }, peer, { '112233': 201, '000101': null });
      const final: Record<string, number> = { ...peer, '112233': 201 };
      delete final['000101'];
      await race.deliverPeerFrames();
      await assertStoredInks(t, board, other, final);
    });
  }

  it('dates editor additions after the latest saved ink even when the device clock lags', t => {
    const initial = useBoard.getState().board;
    t.after(() => setBoardSnapshot(initial));
    const future = Date.now() + 90_000;
    setBoardSnapshot({ title: '', content: { elements: [], inks: [{ color: '#445566', at: future }, { color: '#000001', at: 1 }] } });
    addBoardInk('#AABBCC');
    addBoardInk('#112233');
    addBoardInk('#AABBCC');
    assert.deepEqual(useBoard.getState().board.content.inks?.slice(2), [
      { color: '#aabbcc', at: future + 1 }, { color: '#112233', at: future + 2 },
    ]);
  });

  it('removes only the original ink and keeps the later timestamp for concurrent additions of one hex', () => {
    const rebase = createBoardLiveCodec().rebaseDocument!;
    const previous = { colors: { '112233': 1, '334455': 2, '556677': 3 } };
    const current = { colors: { '112233': 7, '334455': 2, '556677': 11, aabbcc: 5 } };
    const patch = { colors: { '112233': null, '334455': null, '556677': 9, aabbcc: 12 } };
    assert.deepEqual(rebase(inkPath, previous, current, patch), { colors: { '112233': 7, '556677': 11, aabbcc: 12 } });
    assert.deepEqual(rebase(inkPath, undefined, current, { colors: { '334455': null } }), current);
    assert.deepEqual(rebase(inkPath, previous, current, { colors: null }), current);
    assert.equal(rebase('board/meta', previous, current, patch), undefined);
  });

  it('advances lagging additions in order only when full turnover would evict them', () => {
    const rebase = createBoardLiveCodec().rebaseDocument!;
    const previous = { colors: { '445566': 8 } };
    const peer = Object.fromEntries(Object.keys(fullPalette()).map(hex => [hex, 200]));
    const expected: Record<string, number> = { ...peer, '112233': 201, '334455': 202 };
    delete expected['000001'];
    delete expected['000002'];
    assert.deepEqual(rebase(inkPath, previous, { colors: peer }, { colors: { '334455': 101, '112233': 100 } }), { colors: expected });
    const later: Record<string, number> = { ...peer, '112233': 300 };
    delete later['000001'];
    assert.deepEqual(rebase(inkPath, previous, { colors: peer }, { colors: { '112233': 300 } }), { colors: later });
  });
});

describe('document deletion history and local ink intent', { timeout: 60_000 }, () => {
  it('exposes committed deletions on HTTP, events and receipts while keeping document values unchanged', async t => {
    let delivered = deferred();
    const frames: ServerEvents['db'][] = [];
    const board = await openSyncBoard(t, 'live', {
      localProvider: 'watermarked',
      afterInkEvent(id, _data, raw) {
        if (id === 'sync-board') { frames.push(raw); delivered.resolve(); }
      },
    });
    await twoEditors(t, board);
    const db = board.db!;
    const path = inkPath, initial = await db.get(path);
    const meta = getDbDocMeta(initial)!;
    assert.deepEqual(initial, { colors: { aabbcc: 10 } });
    assert.equal(meta.deletedSeq, undefined);
    const { epoch, seq } = meta;
    await assert.rejects(db.write([{ op: 'delete', path }, { op: 'set', path, data: initial!, ifMatch: documentSha256(initial!) }]), { code: 'conflict' });
    assert.deepEqual(await board.request(API.dbGet, { path }), { data: initial, epoch, seq });
    const events: SyncChangeEvent[] = [];
    t.after(db.onChange(event => events.push(event)));
    await board.peer.write([{ op: 'delete', path }, { op: 'set', path, data: initial! }]);
    await delivered.promise;
    const lineage = { epoch, seq: seq + 1, deletedSeq: seq + 1 };
    assert.deepEqual(getDbDocMeta(events[0]!.changes[path]), lineage);
    assert.deepEqual(events[0], { changes: { [path]: initial }, author: 'second-editor' });
    assert.deepEqual(frames[0], { ...events[0], epoch, seq: seq + 1, deletedSeqs: { [path]: seq + 1 } });
    assert.deepEqual(getDbDocMeta(await db.get(path)), lineage);
    const listed = await db.list('board');
    assert.deepEqual(getDbDocMeta(listed.find(doc => doc.path === path)!.data), lineage);
    assert.deepEqual(getDbDocMeta(listed.find(doc => doc.path === 'board/meta')!.data), { epoch, seq: seq + 1 });
    assert.deepEqual((await board.request(API.dbList, { collection: 'board' })).deletedSeqs, { [path]: seq + 1 });
    const writes: Parameters<typeof db.write>[0] = [
      { op: 'update', path, patch: { colors: { aabbcc: 20 } } }, { op: 'update', path: 'board/meta', patch: { title: 'another title' } },
    ];
    await db.write(writes);
    assert.deepEqual(getDbDocMeta(writes[0]), { ...lineage, seq: seq + 2 });
    assert.deepEqual(getDbDocMeta(writes[1]), { epoch, seq: seq + 2 });
    assert.deepEqual(getDbDocMeta(initial), { epoch, seq });
    assert.deepEqual(Object.keys(writes[0]!).sort(), ['op', 'patch', 'path']);
    delivered = deferred();
    const file = join(board.root, 'db', 'board', 'inks.json');
    rmSync(file);
    await delivered.promise;
    assert.deepEqual(frames.at(-1), { changes: { [path]: null }, author: 'agent', epoch, seq: seq + 3 });
    assert.deepEqual(await board.request(API.dbGet, { path }), { data: null, epoch, seq: seq + 3 });
    delivered = deferred();
    writeFileSync(file, JSON.stringify(initial));
    await delivered.promise;
    assert.deepEqual(getDbDocMeta(events.at(-1)!.changes[path]), { epoch, seq: seq + 4, deletedSeq: seq + 3 });
    assert.deepEqual(board.disk(path), initial);
    board.doc.dispose();
    assert.ok(board.server.close(board.artifactId));
    const reopened = await board.server.open({ root: board.root, type: 'whiteboard' });
    const url = new URL(API.dbGet, reopened.pageUrl);
    url.searchParams.set('path', path);
    const fresh = await (await fetch(url)).json();
    assert.notEqual(fresh.epoch, epoch);
    assert.deepEqual(fresh, { data: initial, epoch: fresh.epoch, seq: 0 });
  });

  for (const transport of ['LocalProvider', 'unwatermarked LocalProvider', 'bare'] as const) {
    for (const shape of ['disjoint', 'same hexes', 'earlier replacement'] as const) {
      for (const history of ['delete and set', 'updates'] as const) {
        if (history === 'updates' && transport !== 'LocalProvider') continue;
        for (const order of ['GET first', 'push first'] as const) {
          it(`${transport}, ${history}, ${shape}, ${order}`, async t => {
            const disjoint = shape === 'disjoint';
            const base: Record<string, number> = disjoint ? { '445566': 8 } : fullPalette();
            const add: Record<string, number> = shape === 'earlier replacement' ? { aabbcc: 0 } : { '000001': 250 };
            const peer: Record<string, number> = { ...base };
            const updates: Record<string, number | null>[] = [];
            if (disjoint) {
              delete peer['445566'];
              for (let i = 0; i < MAX_BOARD_INKS; i++) {
                const last = i === MAX_BOARD_INKS - 1;
                const hex = last ? '112233' : (0x101 + i).toString(16).padStart(6, '0');
                peer[hex] = last ? 250 : 200;
                updates.push({ [hex]: peer[hex]!, ...(last ? { '445566': null } : {}) });
              }
            } else {
              delete peer['000001'];
              Object.assign(peer, add);
              updates.push({ '000001': null }, add);
            }
            const rebuild = history === 'delete and set';
            const race = await holdInkConflict(t, transport, base, rebuild ? 1 : updates.length);
            const { board } = race;
            const finishWrite = await race.startWrite('#334455', 300);
            const writer = board.connect('peer-writer');
            if (rebuild) {
              await writer.write([{ op: 'delete', path: inkPath }, { op: 'set', path: inkPath, data: { colors: peer } }]);
            } else {
              for (const colors of updates) await writer.write([{ op: 'update', path: inkPath, patch: { colors } }]);
            }
            assert.deepEqual(board.disk(inkPath), { colors: peer });
            if (order === 'push first') {
              await race.deliverPeerFrames();
              if (rebuild) assert.deepEqual(colorsOf(board.doc), peer);
            }
            await finishWrite();
            assert.deepEqual(race.reads, [{ colors: peer }]);
            const meta = getDbDocMeta(race.reads[0]);
            if (transport === 'LocalProvider') {
              assert.ok(meta);
              assert.equal(meta.deletedSeq, rebuild ? meta.seq : undefined);
            } else assert.equal(meta, undefined);
            assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), rebuild ? [409] : [409, 200]);
            const final = { ...peer };
            if (rebuild) {
              assert.deepEqual(board.writesFromA, []);
              assert.equal(board.doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
            } else {
              const oldest = disjoint ? '000101' : '000002';
              delete final[oldest];
              final['334455'] = 300;
              assert.deepEqual(board.writesFromA, [inkPatch({ [oldest]: null, '334455': 300 }, documentSha256({ colors: peer }))]);
              assert.equal(board.doc.getSnapshot().notice, undefined);
            }
            if (order === 'GET first') await race.deliverPeerFrames();
            await board.doc.flush();
            await assertStoredInks(t, board, race.other, final);
          });
        }
      }
    }
  }

  function editPalette(client: LiveBoardDocument, edit: () => void) {
    const previous = useBoard.getState().board;
    setBoardSnapshot(client.value());
    setBoardSink(next => client.setContent(next.content));
    try { edit(); }
    finally { setBoardSink(null); setBoardSnapshot(previous); }
  }

  const future = 4_102_444_800_000;
  const futureInk = { '445566': future }, retainedInk = { '556677': 5 };
  const refreshedFuture = { '445566': future + 1 }, refreshedEarlier = { '556677': 6 };
  const twoInks = { ...futureInk, ...retainedInk };
  const additions: Record<string, number> = Object.fromEntries(Array.from({ length: MAX_BOARD_INKS - 1 },
    (_, i) => [(0x101 + i).toString(16).padStart(6, '0'), 200]));
  const overlapping = { ...additions, ...retainedInk };
  for (const [label, previous, current, expected] of [
    ['a pure addition', twoInks, { ...twoInks, '778899': 9 }, true],
    ['a single explicit removal', twoInks, retainedInk, true],
    ['a single ink swap', twoInks, { ...retainedInk, '778899': 9 }, true],
    ['a rebuild retaining the earlier ink', twoInks, overlapping, false],
    ['a rebuild retaining the future ink', twoInks, { ...additions, ...futureInk }, false],
    ['a shrink from 64 inks to one', overlapping, retainedInk, false],
    ['refreshing the earlier of two inks', twoInks, { ...futureInk, ...refreshedEarlier }, true],
    ['refreshing the later of two inks', twoInks, { ...refreshedFuture, ...retainedInk }, true],
    ['refreshing the only ink', futureInk, refreshedFuture, true],
    ['replacing the only ink with a different color', futureInk, { '112233': 250 }, false],
    ['refreshing the only ink and adding 63 colors', futureInk, { ...refreshedFuture, ...additions }, false],
  ] as const) {
    it(`determines pending palette continuity for ${label}`, () => {
      assert.equal(createBoardLiveCodec().sameDocument!({ colors: previous }, { colors: current }, true), expected);
    });
  }

  const addEach = (colors: Record<string, number>) => Object.entries(colors).map(([hex, at]) => ({ [hex]: at }));
  const middleInks = Object.fromEntries(Object.entries(additions).slice(0, 62));
  const palettes = [
    { label: 'no retained ink', seed: futureInk, peerColors: { ...additions, '112233': 250 },
      updates: [...addEach(additions), { '445566': null, '112233': 250 }], evicted: '000101' },
    { label: 'one retained ink', seed: twoInks, peerColors: overlapping,
      updates: [{ '445566': null }, ...addEach(additions)], evicted: '556677' },
    { label: 'a timestamp refresh followed by additions and a swap', seed: twoInks,
      peerColors: { ...retainedInk, ...middleInks, '112233': 250 }, updatesOnly: true, evicted: '556677',
      updates: [refreshedFuture, ...addEach(middleInks), { '445566': null, '112233': 250 }],
      expectedPeerHash: 'b912eaebefe03130603b621a2928e7c01b1728585023e40d3b63cb7f0faa4d72' },
    { label: 'only the earlier timestamp refreshed', seed: twoInks, peerColors: { ...futureInk, ...refreshedEarlier },
      updates: [refreshedEarlier], updatesOnly: true },
  ];
  for (const transport of ['unwatermarked LocalProvider', 'bare'] as const) {
    for (const { label, seed, peerColors, updates, evicted, updatesOnly, expectedPeerHash } of palettes) {
      const updateLabel = updates.length === 1 ? 'one update' : '64 updates';
      for (const rebuild of updatesOnly ? [false] : [false, true]) {
        for (const peerFirst of [false, true]) {
          it(`${transport} handles pending palette turnover with ${label} by ${rebuild ? 'atomic rebuild' : updateLabel}, ${peerFirst ? 'peer frame queued first' : 'local edit first'}`, async t => {
            const firstFrame = holdDelivery(), delivered = deferred();
            const frameCount = rebuild ? 1 : updates.length, sentAfter: number[] = [];
            let lastPeerHash: string | undefined;
            let frames = 0;
            const board = await openSyncBoard(t, 'live', {
              initialColors: seed, localProvider: inkProviders[transport],
              async beforeWrite(_writes, id) { if (id === 'sync-board') sentAfter.push(frames); },
              async beforeInkEvent(id) { if (id === 'sync-board' && frames === 0) await firstFrame.hold(); },
              afterInkEvent(id, data) {
                if (id === 'sync-board' && ++frames === frameCount) {
                  lastPeerHash = documentSha256(data);
                  delivered.resolve();
                }
              },
            });
            t.after(firstFrame.release);
            const other = await twoEditors(t, board), peer = board.connect('peer-writer');
            const edit = () => {
              assert.deepEqual(colorsOf(board.doc), seed);
              editPalette(board.doc, () => addBoardInk('#778899'));
              board.doc.documentBytes();
              assert.equal(colorsOf(board.doc)['778899'], future + 1);
              assert.equal(board.doc.getSnapshot().pending, 1);
              assert.deepEqual(sentAfter, []);
            };
            const publish = async () => {
              if (rebuild) {
                await peer.write([{ op: 'delete', path: inkPath }, { op: 'set', path: inkPath, data: { colors: peerColors } }]);
              } else {
                for (const colors of updates) await peer.write([{ op: 'update', path: inkPath, patch: { colors } }]);
              }
            };
            if (!peerFirst) edit();
            await Promise.all([publish(), firstFrame.entered.then(() => {
              if (peerFirst) edit();
              firstFrame.release();
            })]);
            await delivered.promise;
            const peerHash = expectedPeerHash ?? documentSha256({ colors: peerColors });
            assert.equal(lastPeerHash, peerHash);
            if (expectedPeerHash) assert.equal(frames, 64);
            await board.doc.flush();
            const ownInk = { '778899': future + 1 };
            const expected: Record<string, number> = rebuild ? { ...peerColors } : { ...peerColors, ...ownInk };
            const patch: Record<string, number | null> = { ...ownInk };
            if (!rebuild && evicted) {
              delete expected[evicted];
              patch[evicted] = null;
            }
            assert.equal(Object.keys(expected).length, updates.length === 1 ? 3 : MAX_BOARD_INKS);
            assert.deepEqual(sentAfter, rebuild ? [] : [frameCount]);
            assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), rebuild ? [] : [200]);
            assert.deepEqual(board.writesFromA, rebuild ? [] : [inkPatch(patch, peerHash)]);
            assert.equal(board.doc.getSnapshot().notice?.message, rebuild ? LIVE_MESSAGES.itemGone : undefined);
            assert.deepEqual(colorsOf(board.doc), expected);
            await assertStoredInks(t, board, other, expected);
          });
        }
      }
    }

    for (const setLast of [false, true]) {
      for (const receiptFirst of [true, false]) {
        it(`${transport} verifies a whole-palette deletion through the grace window, ${setLast ? 'delete then set' : 'set then delete'}, ${receiptFirst ? 'receipt first' : 'deletion first with GET held'}`, async t => {
          const request = holdDelivery(), receipt = holdDelivery(), frame = holdDelivery(), delivered = deferred();
          const verification = receiptFirst ? undefined : holdDelivery();
          const reads: (SyncDocument['data'] | null)[] = [];
          let viewAtDelivery: Record<string, number> | undefined;
          const board = await openSyncBoard(t, 'live', {
            localProvider: inkProviders[transport],
            async beforeWrite(_writes, id) { if (id === 'sync-board') await request.hold(); },
            async afterWrite(id) { if (id === 'sync-board') await receipt.hold(); },
            async beforeInkEvent(id, data) { if (id === 'sync-board' && data === null) await frame.hold(); },
            afterInkEvent(id, data) {
              if (id === 'sync-board' && data === null) { viewAtDelivery = colorsOf(board.doc); delivered.resolve(); }
            },
            async afterGet(path, id, data) {
              if (id !== 'sync-board' || path !== inkPath) return;
              reads.push(data);
              await verification?.hold();
            },
          });
          t.after(() => { request.release(); receipt.release(); frame.release(); verification?.release(); });
          const other = await twoEditors(t, board), peer = board.connect('deleting-peer');
          const colors = { '112233': 100, '445566': 8 }, expected = setLast ? colors : null;
          const remove = () => peer.write([{ op: 'delete', path: inkPath }]);
          const saved = board.doc.writeNow([{ op: 'set', path: inkPath, data: { colors } }]);
          await request.entered;
          if (setLast) await remove();
          request.release();
          await receipt.entered;
          if (!setLast) await remove();
          await frame.entered;
          if (!receiptFirst) {
            frame.release();
            await delivered.promise;
            assert.deepEqual(viewAtDelivery, {});
          }
          receipt.release();
          await saved;
          const receivedAt = performance.now();
          assert.deepEqual(colorsOf(board.doc), colors);
          if (receiptFirst) {
            frame.release();
            await delivered.promise;
            if (setLast) assert.deepEqual(viewAtDelivery, colors);
            await board.doc.flush();
          }
          await verification?.entered;
          const waitUntilSample = async (elapsed: number) => {
            await delay(Math.max(0, Math.ceil(receivedAt + elapsed - performance.now())) + 1);
            assert.ok(performance.now() - receivedAt >= elapsed);
          };
          for (const elapsed of [100, ACKNOWLEDGED_WRITE_GRACE_MS / 2]) {
            await waitUntilSample(elapsed);
            assert.ok(performance.now() - receivedAt < ACKNOWLEDGED_WRITE_GRACE_MS);
            assert.deepEqual(colorsOf(board.doc), receiptFirst ? (expected ?? {}) : colors);
          }
          verification?.release();
          await board.doc.flush();
          assert.deepEqual(colorsOf(board.doc), expected ?? {});
          assert.deepEqual(reads, [expected && { colors: expected }]);
          await waitUntilSample(ACKNOWLEDGED_WRITE_GRACE_MS + 550);
          assert.deepEqual(colorsOf(board.doc), expected ?? {});
          await peer.write([{ op: 'update', path: 'board/meta', patch: { title: 'After grace' } }]);
          await whenSnapshot(board.doc, () => board.doc.title() === 'After grace');
          assert.deepEqual(colorsOf(board.doc), expected ?? {});
          assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), [200]);
          await assertStoredInks(t, board, other, expected);
        });
      }
    }

    for (const same of [false, true]) {
      it(`${transport} rebases an unsent palette edit when the peer removes ${same ? 'the same color' : 'another color'}`, async t => {
        const initial = fullPalette(), frame = holdDelivery(), delivered = deferred();
        let sends = 0;
        const board = await openSyncBoard(t, 'live', {
          initialColors: initial, localProvider: inkProviders[transport],
          async beforeWrite(_writes, id) { if (id === 'sync-board') sends++; },
          async beforeInkEvent(id) { if (id === 'sync-board') await frame.hold(); },
          afterInkEvent(id) { if (id === 'sync-board') delivered.resolve(); },
        });
        t.after(frame.release);
        const other = await twoEditors(t, board);
        editPalette(other, () => removeBoardInk(same ? '#000001' : '#000020'));
        await other.flush();
        await frame.entered;
        editPalette(board.doc, () => {
          removeBoardInk('#000001');
          if (!same) addBoardInk('#112233');
        });
        board.doc.documentBytes();
        const expected = { ...initial };
        delete expected['000001'];
        if (!same) {
          delete expected['000020'];
          expected['112233'] = colorsOf(board.doc)['112233']!;
        }
        assert.equal(board.doc.getSnapshot().pending, 1);
        assert.equal(sends, 0);
        frame.release();
        await delivered.promise;
        assert.equal(sends, 0);
        assert.equal(board.doc.getSnapshot().notice, undefined);
        assert.deepEqual(colorsOf(board.doc), expected);
        await board.doc.flush();
        assert.equal(board.doc.getSnapshot().notice, undefined);
        const replies = board.receipts.filter(r => r.client === 'sync-board');
        assert.deepEqual(replies.map(r => r.status), same ? [] : [200]);
        assert.equal(sends, replies.length);
        assert.equal(Object.keys(expected).length, 63);
        await assertStoredInks(t, board, other, expected);
      });
    }
  }

  it('skips cleanup of an acknowledged patch when a newer whole-document deletion arrived first', async t => {
    const receipt = holdDelivery(), delivered = deferred();
    const board = await openSyncBoard(t, 'live', {
      localProvider: 'watermarked',
      async afterWrite(id) { if (id === 'sync-board') await receipt.hold(); },
      afterInkEvent(id, data) { if (id === 'sync-board' && data === null) delivered.resolve(); },
    });
    t.after(receipt.release);
    const other = await twoEditors(t, board);
    board.doc.updateContent(c => withInks(c, addInk(c.inks!, '#112233', 100)));
    const saved = board.doc.flush();
    await receipt.entered;
    await board.connect('deleting-peer').write([{ op: 'delete', path: inkPath }]);
    await delivered.promise;
    receipt.release();
    await saved;
    assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => [r.writes[0]!.op, r.status]), [['update', 200]]);
    await assertStoredInks(t, board, other, null);
  });

  it('retains a settled and remotely restored removal when a peer frees a palette slot', async t => {
    const base = fullPalette(), write = holdDelivery();
    let overflow = false;
    const board = await openSyncBoard(t, 'live', {
      initialColors: base, localProvider: 'watermarked',
      async beforeWrite(_writes, id) {
        if (overflow && id === 'sync-board') await write.hold();
      },
    });
    t.after(write.release);
    const other = await twoEditors(t, board);
    editPalette(board.doc, () => removeBoardInk('#000001'));
    await board.doc.flush();
    await whenSnapshot(other, () => colorsOf(other)['000001'] === undefined);
    await board.connect('restoring-editor').write([{ op: 'update', path: inkPath, patch: { colors: { '000001': 1 } } }]);
    for (const client of [board.doc, other]) await whenSnapshot(client, () => colorsOf(client)['000001'] === 1);
    overflow = true;
    editPalette(board.doc, () => addBoardInk('#778899'));
    const at = colorsOf(board.doc)['778899']!;
    const saved = board.doc.flush();
    await write.entered;
    editPalette(other, () => removeBoardInk('#000020'));
    await other.flush();
    write.release();
    await saved;
    const final: Record<string, number> = { ...base, '778899': at };
    delete final['000020'];
    assert.equal(Object.keys(final).length, MAX_BOARD_INKS);
    assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), [200, 409, 200]);
    await assertStoredInks(t, board, other, final);
  });

  it('keeps guarded batches atomic and the base stamp separate from the receipt', async t => {
    const pushed = deferred();
    const board = await openSyncBoard(t, 'live', {
      localProvider: 'watermarked', afterInkEvent(id) { if (id === 'sync-board') pushed.resolve(); },
    });
    await twoEditors(t, board);
    const initial = await board.db!.get(inkPath), base = getDbDocMeta(initial)!;
    const hash = documentSha256(initial!);
    await board.peer.write([{ op: 'delete', path: inkPath }, { op: 'set', path: inkPath, data: initial! }]);
    await pushed.promise;
    const latest = await board.db!.get(inkPath);
    const fresh = getDbDocMeta(latest)!;
    const stale = inkPatch({ '112233': 100 }, hash);
    setDbWriteBaseMeta(stale, base);
    const batch: SyncWrite[] = [{ op: 'set', path: 'elements/atomic', data: stored(note('atomic', 'uncommitted')) }, stale];
    await assert.rejects(board.doc.writeNow(batch), { code: 'conflict' });
    assert.deepEqual(await board.request(API.dbGet, { path: 'elements/atomic' }), { data: null, epoch: fresh.epoch, seq: fresh.seq });
    assert.deepEqual(board.disk(inkPath), initial);
    assert.deepEqual(getDbWriteBaseMeta(stale), base);
    assert.equal(getDbDocMeta(stale), undefined);
    assert.deepEqual(Reflect.ownKeys(stale).sort(), ['ifMatch', 'op', 'patch', 'path']);
    const current = inkPatch({ '223344': 90 }, hash);
    await board.doc.writeNow([current]);
    assert.deepEqual(getDbWriteBaseMeta(current), fresh);
    assert.deepEqual(getDbDocMeta(current), { ...fresh, seq: fresh.seq + 1 });
    assert.deepEqual(Reflect.ownKeys(current).sort(), Reflect.ownKeys(stale).sort());
    assert.deepEqual(board.disk(inkPath), { colors: { aabbcc: 10, '223344': 90 } });
    // The second condition here refers to the first write in this same atomic batch.
    await board.doc.writeNow([{ op: 'set', path: inkPath, data: initial! }, stale]);
    assert.deepEqual(getDbWriteBaseMeta(stale), base);
    assert.equal(getDbDocMeta(stale)?.seq, fresh.seq + 2);
    assert.deepEqual(board.disk(inkPath), { colors: { aabbcc: 10, '112233': 100 } });
  });

  for (const superseded of [false, true]) {
    it(`settles an accepted move across a pushed deletion when the receipt is ${superseded ? 'superseded' : 'newest'}`, async t => {
      const write = holdDelivery(), receipt = holdDelivery(), path = 'elements/n1';
      const board = await openSyncBoard(t, 'live', {
        localProvider: 'watermarked',
        async beforeWrite(writes, id) { if (id === 'sync-board' && writes[0]?.path === path) await write.hold(); },
        async afterWrite(id) { if (id === 'sync-board') await receipt.hold(); },
      });
      t.after(() => { write.release(); receipt.release(); });
      const other = await twoEditors(t, board), peer = board.connect('recreating-editor');
      const position = (client: LiveBoardDocument) => {
        const item = client.content().elements.find(e => e.id === 'n1');
        return item?.type === 'note' ? item.x : undefined;
      };
      board.doc.updateContent(c => ({ ...c, elements: c.elements.map(e => e.id === 'n1' ? { ...e, x: 60 } : e) }));
      const saved = board.doc.flush();
      await write.entered;
      await peer.write([{ op: 'delete', path }]);
      await peer.write([{ op: 'set', path, data: stored(note('n1', 'Recreated', 20)) }]);
      await whenSnapshot(board.doc, () => position(board.doc) === 20);
      write.release();
      await receipt.entered;
      if (superseded) {
        await peer.write([{ op: 'update', path, patch: { x: 90 } }]);
        await whenSnapshot(board.doc, () => position(board.doc) === 90);
      }
      receipt.release();
      await saved;
      await board.doc.whenWritten([path]);
      const x = superseded ? 90 : 60;
      await whenSnapshot(other, () => position(other) === x);
      assert.equal(position(board.doc), x);
      assert.equal(board.doc.getSnapshot().pending, 0);
      assert.equal(textOf(board.doc, 'n1'), 'Recreated');
      assert.deepEqual(board.disk(path), stored(note('n1', 'Recreated', x)));
    });
  }

  for (const direct of [false, true]) {
    it(`prunes a superseded ${direct ? 'writeNow' : 'flush'} acknowledgement during delivery of the peer frame`, async t => {
      const delivered = deferred(), base = { '445566': 8 };
      let seen: Record<string, number> | undefined;
      const board = await openSyncBoard(t, 'live', {
        initialColors: base, localProvider: 'watermarked',
        afterInkEvent(id) {
          if (id === 'sync-board') { seen = colorsOf(board.doc); delivered.resolve(); }
        },
      });
      const other = await twoEditors(t, board);
      const first = { ...base, '112233': 100 };
      if (direct) await board.doc.writeNow([{ op: 'set', path: inkPath, data: { colors: first } }]);
      else {
        board.doc.updateContent(content => withInks(content, addInk(content.inks!, '#112233', 100)));
        await board.doc.flush();
      }
      assert.deepEqual(colorsOf(board.doc), first);
      await board.connect('later-writer').write([inkPatch({ '112233': null, aabbcc: 250 }, documentSha256({ colors: first }))]);
      await delivered.promise;
      const final = { ...base, aabbcc: 250 };
      assert.deepEqual(seen, final);
      await assertStoredInks(t, board, other, final);
    });
  }

  for (const transport of ['bare', 'unwatermarked LocalProvider'] as const) {
    for (const rebuild of [false, true]) {
      it(`converges after identical ${rebuild ? 'delete and set' : 'updates'} pushed before acceptance on ${transport}`, async t => {
        const base = fullPalette();
        const race = await holdInkConflict(t, transport, base, rebuild ? 1 : 2);
        const finish = await race.startWrite('#778899', 100);
        const { board } = race;
        if (rebuild) await board.peer.write([{ op: 'delete', path: inkPath }, { op: 'set', path: inkPath, data: { colors: base } }]);
        else {
          for (const at of [177, 1]) await board.peer.write([{ op: 'update', path: inkPath, patch: { colors: { '000001': at } } }]);
        }
        assert.equal(documentSha256(board.disk(inkPath)), documentSha256({ colors: base }));
        await race.deliverPeerFrames();
        await finish();
        assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), [200]);
        const final: Record<string, number> = { ...base, '778899': 100 };
        delete final['000001'];
        if (!rebuild) assert.deepEqual(race.reads, [{ colors: final }]);
        assert.deepEqual(colorsOf(board.doc), final);
        await assertStoredInks(t, board, race.other, final);
      });
    }
  }

  for (const direct of [false, true]) {
    it(`keeps the newer peer update when an older ${direct ? 'writeNow' : 'flush'} receipt arrives`, async t => {
      const receipt = holdDelivery(), delivered = deferred();
      const base = { '445566': 8 }, final = { ...base, aabbcc: 250 };
      const board = await openSyncBoard(t, 'live', {
        initialColors: base, localProvider: 'watermarked',
        async afterWrite(id) { if (id === 'sync-board') await receipt.hold(); },
        afterInkEvent(id, data) {
          if (id === 'sync-board' && data && isPlainRecord(data.colors) && data.colors.aabbcc === 250) delivered.resolve();
        },
      });
      t.after(receipt.release);
      const other = await twoEditors(t, board);
      const first = { ...base, '112233': 100 };
      if (!direct) board.doc.updateContent(content => withInks(content, addInk(content.inks!, '#112233', 100)));
      const saved = direct ? board.doc.writeNow([{ op: 'set', path: inkPath, data: { colors: first } }]) : board.doc.flush();
      await receipt.entered;
      await board.connect('later-writer').write([inkPatch({ '112233': null, aabbcc: 250 }, documentSha256({ colors: first }))]);
      await delivered.promise;
      receipt.release();
      await saved;
      assert.deepEqual(colorsOf(board.doc), final);
      await assertStoredInks(t, board, other, final);
    });
  }

  for (const timing of ['pending', 'in flight'] as const) {
    for (const explicit of [false, true]) {
      it(`keeps the ${explicit ? 'explicit removal' : 'automatically evicted color'} when a peer frees a slot, ${timing}`, async t => {
        const base = fullPalette();
        const race = await holdInkConflict(t, 'LocalProvider', base, 1);
        const { board, other } = race;
        const editLocal = () => editPalette(board.doc, () => {
          if (explicit) removeBoardInk('#000001');
          addBoardInk('#AABBCC');
        });
        let finish: (() => Promise<void>) | undefined;
        if (timing === 'in flight') { editLocal(); finish = await race.holdWrite(); }
        editPalette(other, () => removeBoardInk('#000002'));
        await other.flush();
        if (timing === 'pending') editLocal();
        const at = colorsOf(board.doc).aabbcc!;
        await race.deliverPeerFrames();
        if (finish) await finish();
        await board.doc.flush();
        const peer = { ...base };
        delete peer['000002'];
        const final: Record<string, number> = { ...peer, aabbcc: at };
        if (explicit) delete final['000001'];
        assert.deepEqual(board.writesFromA, [inkPatch({ aabbcc: at, ...(explicit ? { '000001': null } : {}) }, documentSha256({ colors: peer }))]);
        assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), finish ? [409, 200] : [200]);
        await assertStoredInks(t, board, other, final);
      });
    }
  }

  it('advances editor and rebased timestamps past the safe integer boundary', t => {
    const high = 2 ** 53;
    assert.equal(nextTimestampAfter(Number.MAX_SAFE_INTEGER, 0), high);
    assert.equal(nextTimestampAfter(high, 0), high + 2);
    assert.equal(nextTimestampAfter(high, high + 8), high + 8);
    assert.equal(nextTimestampAfter(Number.MAX_VALUE, 0), Number.MAX_VALUE);
    assert.equal(nextTimestampAfter(-Infinity, 42), 42);
    const previous = useBoard.getState().board;
    t.after(() => setBoardSnapshot(previous));
    setBoardSnapshot({ title: '', content: { elements: [], inks: [{ color: '#000001', at: high }] } });
    addBoardInk('#aabbcc');
    assert.equal(useBoard.getState().board.content.inks?.at(-1)?.at, high + 2);
    const peer = Object.fromEntries(Object.keys(fullPalette()).map(hex => [hex, high]));
    const rebased = createBoardLiveCodec().rebaseDocument!(inkPath, { colors: { '445566': 8 } }, { colors: peer }, { colors: { aabbcc: 100, ccddee: 101 } });
    const expected: Record<string, number> = { ...peer, aabbcc: high + 2, ccddee: high + 4 };
    delete expected['000001'];
    delete expected['000002'];
    assert.deepEqual(rebased, { colors: expected });
  });
});

const chrome = await import(new URL('../../../e2e/lib/browser.mjs', import.meta.url).href);

describe('document races through the browser DB capability', { skip: !chrome.findChrome(), timeout: 60_000 }, () => {
  let browser: Awaited<ReturnType<typeof chrome.launch>>;
  let shellOrigin: string;
  let assets: ReturnType<typeof createServer>;
  before(async () => {
    const bundle = await build({
      stdin: { resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), contents: `
        export { call, want } from './packages/shell/src/shell/broker.ts';
        export { createLocalProvider, createShellProvider } from '@open-artifact/runtime';
        export { getDbChangeDeleteMeta, getDbDocMeta } from '@open-artifact/live-store/transport';
        export { createLiveBoardDocument } from './packages/whiteboard-core/src/sync/live-board.ts';
        export { addInk, withInks } from './packages/whiteboard-core/src/inks.ts';
      ` },
      bundle: true, write: false, format: 'iife', globalName: 'modules',
    });
    assets = createServer((req, res) => {
      if (req.url === '/modules.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }).end(bundle.outputFiles[0]!.contents); return; }
      if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<iframe></iframe><script src="/modules.js"></script><script>
        const frame = document.querySelector('iframe');
        const editor = new URL(new URLSearchParams(location.search).get('editor'));
        window.calls = [];
        addEventListener('message', event => {
          if (event.source !== frame.contentWindow || event.origin !== editor.origin) return;
          const post = (message, transfer) => event.source.postMessage(message, event.origin, transfer);
          const m = event.data;
          if (m.openArtifact === 'cap_want') modules.want(m, event.origin, post);
          if (m.openArtifact === 'cap') {
            if (m.cap === 'db' && m.method === 'write') calls.push(m);
            modules.call(m, event, post);
          }
        });
        frame.src = editor.href;
      </script>`);
    });
    assets.listen(0, '127.0.0.1');
    await once(assets, 'listening');
    const address = assets.address();
    assert.ok(address && typeof address !== 'string');
    shellOrigin = 'http://127.0.0.1:' + address.port;
    browser = await chrome.launch();
  });
  after(async () => {
    await browser?.close();
    if (assets?.listening) await new Promise<void>(resolve => assets.close(() => resolve()));
  });

  async function openClient(t: TestContext, board: SyncBoard, shell: boolean, controls: RelayControls & {
    unwatermarked?: boolean;
    afterWrite?(): Promise<void>;
    inkGetResponse?: InkGetResponse;
  }) {
    const requests: DbWriteRequest[] = [], statuses: number[] = [];
    const connected = deferred();
    const html = `<script src="${shellOrigin}/modules.js"></script><script type="module">
      const provider = parent === self ? modules.createLocalProvider() : modules.createShellProvider({ origin: ${JSON.stringify(shellOrigin)} });
      const db = window.db = await provider.get('db');
      window.board = modules.createLiveBoardDocument({ transport: db });
      window.events = 0;
      db.onChange(event => { window.lastEvent = event; window.events++; });
    </script>`;
    const base = await relayProvider(t, board.pageUrl, controls.unwatermarked === true, async (_writes, status) => {
      statuses.push(status);
      await controls.afterWrite?.();
    }, controls.inkGetResponse, {
      ...controls, connected: connected.resolve, page: { shellOrigin, html },
      async beforeWrite(body) { requests.push(body); await controls.beforeWrite?.(body); },
    });
    const editor = new URL('sync-client', base);
    const url = shell ? new URL(shellOrigin) : editor;
    if (shell) url.searchParams.set('editor', editor.href);
    const ready = "window.board?.getSnapshot().loadState === 'live'";
    const page = await browser.load(url.href, { ready, settle: 0, timeout: 8000 });
    t.after(() => page.close());
    assert.ok(await page.waitFor(ready, 1000), page.problems.join('\n'));
    await connected.promise;
    const run = async (expression: string) => {
      const results = await page.evaluateAll(`window.board && (async () => ({ value: await (${expression}) }))()`);
      const answer = results.find((r: unknown) => r != null);
      assert.ok(answer, expression);
      return answer.value;
    };
    return { page, run, requests, statuses };
  }

  for (const transport of ['LocalProvider', 'Shell', 'unwatermarked LocalProvider'] as const) {
    const shell = transport === 'Shell', unwatermarked = transport === 'unwatermarked LocalProvider';
    for (const setLast of [false, true]) {
      for (const receiptFirst of [false, true]) {
        it(`${transport} writeNow, ${setLast ? 'delete then set' : 'set then delete'}, ${receiptFirst ? 'receipt' : 'deletion event'} delivered first`, async t => {
          const board = await openSyncBoard(t), other = await twoEditors(t, board);
          const { epoch, seq } = await board.request(API.dbGet, { path: inkPath });
          const request = holdDelivery(), receipt = holdDelivery(), frame = holdDelivery();
          const verification = unwatermarked && !receiptFirst ? holdDelivery() : undefined;
          t.after(() => { request.release(); receipt.release(); frame.release(); verification?.release(); });
          const reads: (SyncDocument['data'] | null)[] = [];
          const client = await openClient(t, board, shell, {
            unwatermarked, beforeWrite: request.hold, afterWrite: receipt.hold,
            async beforeFrame(event) { if (event.changes[inkPath] === null) await frame.hold(); },
            async inkGetResponse(data) { reads.push(data); await verification?.hold(); },
          });
          if (shell) await client.run(`(addEventListener('message', e => {
            if (e.source === parent && e.data.openArtifact === 'cap_ev' && e.data.cap === 'db') window.lastDbPush = e.data;
          }), true)`);
          const colors = { '112233': 100, '445566': 8 };
          const write: SyncWrite = { op: 'set', path: inkPath, data: { colors } };
          await client.run(`(window.sent = ${JSON.stringify(write)}, window.saved = board.writeNow([window.sent]), true)`);
          await request.entered;
          const remove = async () => {
            await board.connect('deleting-peer').write([{ op: 'delete', path: inkPath }]);
            await frame.entered;
          };
          if (setLast) await remove();
          request.release();
          await receipt.entered;
          if (!setLast) await remove();
          const deletion = { epoch, seq: seq + (setLast ? 1 : 2) };
          const deliver = async () => {
            frame.release();
            assert.ok(await client.page.waitFor('window.events === 1'));
            assert.deepEqual(await client.run(`({
              eventKeys: Reflect.ownKeys(lastEvent).map(String).sort(),
              changeKeys: Reflect.ownKeys(lastEvent.changes).map(String),
              changes: lastEvent.changes,
              meta: modules.getDbChangeDeleteMeta(lastEvent.changes, 'board/inks') ?? null
            })`), { eventKeys: ['author', 'changes'], changeKeys: [inkPath], changes: { [inkPath]: null }, meta: unwatermarked ? null : deletion });
            if (shell) assert.deepEqual(await client.run('[lastDbPush.data.changes, lastDbPush.dbMeta]'), [{ [inkPath]: null }, { [inkPath]: deletion }]);
          };
          if (!receiptFirst) await deliver();
          receipt.release();
          await client.run('window.saved');
          const view = 'Object.fromEntries((board.content().inks ?? []).map(i => [i.color.slice(1), i.at]))';
          if (receiptFirst) {
            assert.deepEqual(await client.run(view), colors);
            await deliver();
          } else {
            await verification?.entered;
            assert.deepEqual(await client.run(view), unwatermarked || setLast ? colors : {});
            verification?.release();
          }
          await client.run('board.flush()');
          const final = setLast ? colors : null;
          assert.deepEqual(await client.run(view), final ?? {});
          assert.deepEqual(await client.run('[board.getSnapshot().pending, board.getSnapshot().flights]'), [0, 0]);
          assert.deepEqual(await client.run('modules.getDbDocMeta(window.sent) ?? null'), unwatermarked ? null :
            { epoch, seq: seq + (setLast ? 2 : 1), ...(setLast ? { deletedSeq: deletion.seq } : {}) });
          assert.deepEqual(reads, unwatermarked ? [final && { colors: final }] : []);
          assert.deepEqual(client.statuses, [200]);
          await assertStoredInks(t, board, other, final);
        });
      }
    }
  }

  for (const shell of [false, true]) {
    const provider = shell ? 'Shell' : 'LocalProvider';
    it(`${provider} preserves the empty board LIST position for a second browser reader`, async t => {
      const host = await openSyncBoard(t), peer = host.doc, frame = holdDelivery();
      t.after(frame.release);
      let inkGets = 0;
      const client = await openClient(t, host, shell, {
        async beforeFrame(event) { if (inkPath in event.changes) await frame.hold(); },
        inkGetResponse() { inkGets++; },
      });
      await peer.writeNow([{ op: 'set', path: inkPath, data: { colors: { '8899aa': 41 } } }]);
      await frame.entered;
      const deletes = [{ op: 'delete', path: inkPath }, { op: 'delete', path: 'board/meta' }];
      await client.run(`board.writeNow(${JSON.stringify(deletes)})`);
      await whenSnapshot(peer, () => !peer.content().inks?.length);
      const { documents, epoch, seq } = await host.request(API.dbList, { collection: 'board' });
      assert.deepEqual(documents, []);
      assert.equal(seq, 3);
      await client.run('(window.reader = modules.createLiveBoardDocument({ transport: db, readOnly: true }), true)');
      assert.ok(await client.page.waitFor("window.reader?.getSnapshot().loadState === 'live'"));
      if (shell) await client.run(`(addEventListener('message', event => {
        if (event.source === parent && event.data.openArtifact === 'cap_r' && Array.isArray(event.data.result)) window.listReply = event.data;
      }), true)`);
      const list = () => client.run(`db.list('board').then(docs => ({
        docs, meta: modules.getDbDocMeta(docs) ?? null, items: docs.map(doc => modules.getDbDocMeta(doc.data))
      }))`);
      const empty = await list();
      const views = () => client.run(`Promise.all([board.flush(), reader.flush()]).then(() => [board, reader].map(doc =>
        [doc.content().inks ?? [], doc.getSnapshot().pending, doc.getSnapshot().flights]))`);
      frame.release();
      await peer.writeNow([{ op: 'set', path: 'elements/progress', data: stored(note('progress', 'Delivered')) }]);
      assert.ok(await client.page.waitFor("window.reader?.content().elements.some(e => e.id === 'progress' && e.text === 'Delivered')"));
      assert.deepEqual(await views(), [[[], 0, 0], [[], 0, 0]]);
      assert.deepEqual(empty, { docs: [], meta: { epoch, seq }, items: [] });
      if (shell) assert.deepEqual(await client.run("[listReply.result, listReply.dbListMeta, 'dbMeta' in listReply]"), [[], { epoch, seq }, false]);
      assert.equal((await host.request(API.dbGet, { path: inkPath })).data, null);
      assert.throws(() => host.disk(inkPath), { code: 'ENOENT' });
      const colors = { '223344': 90 };
      await peer.writeNow([{ op: 'set', path: inkPath, data: { colors } }]);
      assert.ok(await client.page.waitFor("window.reader?.content().inks?.some(ink => ink.color === '#223344')"));
      const view = [[{ color: '#223344', at: 90 }], 0, 0];
      assert.deepEqual(await views(), [view, view]);
      const position = { epoch, seq: seq + 2 };
      const items = [{ ...position, deletedSeq: seq }];
      assert.deepEqual(await list(), { docs: [{ path: inkPath, data: { colors } }], meta: position, items });
      if (shell) assert.deepEqual(await client.run('[listReply.dbListMeta, listReply.dbMeta]'), [position, items]);
      assert.equal(inkGets, 0);
      assert.deepEqual(client.requests.map(body => body.writes), [deletes]);
    });

    it(`${provider} merges a delayed peer text change with an acknowledged unguarded move`, async t => {
      const board = await openSyncBoard(t);
      const other = await twoEditors(t, board), path = 'elements/partial';
      await board.connect('seed-note').write([
        { op: 'set', path, data: stored(note('partial', 'Original')) },
        { op: 'update', path: 'board/meta', patch: { order: ['partial'] } },
      ]);
      await whenSnapshot(other, () => textOf(other, 'partial') === 'Original');
      const frame = holdDelivery();
      t.after(frame.release);
      const client = await openClient(t, board, shell, { async beforeFrame(event) { if (path in event.changes) await frame.hold(); } });
      other.updateContent(content => withText(content, 'partial', 'Peer edits'));
      await other.flush();
      await frame.entered;
      await client.run("board.updateContent(c => ({ ...c, elements: c.elements.map(e => e.id === 'partial' ? { ...e, x: 60 } : e) }))");
      await client.run('board.flush()');
      const [body] = client.requests;
      assert.deepEqual(client.requests, [{ writes: [{ op: 'update', path, patch: { x: 60 } }], client: body!.client }]);
      assert.deepEqual(client.statuses, [200]);
      if (shell) assert.deepEqual(await client.page.evaluate("calls.map(m => Object.hasOwn(m, 'dbGuards'))"), [false]);
      frame.release();
      assert.ok(await client.page.waitFor('window.events === 1'));
      const expected = note('partial', 'Peer edits', 60);
      assert.deepEqual(await client.run("board.content().elements.find(e => e.id === 'partial')"), expected);
      await whenSnapshot(other, () => other.content().elements.some(e => e.type === 'note' && e.id === 'partial' && e.x === 60));
      assert.deepEqual(other.content().elements.find(e => e.id === 'partial'), expected);
      assert.deepEqual(await board.connect('reader').get(path), stored(expected));
      assert.deepEqual(board.disk(path), stored(expected));
    });

    for (const rebuild of [false, true]) {
      for (const pushFirst of [false, true]) {
        it(`${provider}, byte-identical ${rebuild ? 'delete and set' : 'updates'}, ${pushFirst ? 'push first' : 'read first'}`, async t => {
          const base = fullPalette(), board = await openSyncBoard(t, 'live', { initialColors: base });
          const other = await twoEditors(t, board);
          const { epoch, seq } = await board.request(API.dbGet, { path: inkPath });
          const write = holdDelivery(), frame = holdDelivery();
          t.after(() => { write.release(); frame.release(); });
          const client = await openClient(t, board, shell, { beforeWrite: () => write.hold(), beforeFrame: () => frame.hold() });
          await client.run("board.updateContent(c => modules.withInks(c, modules.addInk(c.inks, '#778899', 100)))");
          await client.run('(window.saved = board.flush(), true)');
          await write.entered;
          const peer = board.connect('peer-writer');
          if (rebuild) await peer.write([{ op: 'delete', path: inkPath }, { op: 'set', path: inkPath, data: { colors: base } }]);
          else {
            for (const at of [177, 1]) await peer.write([{ op: 'update', path: inkPath, patch: { colors: { '000001': at } } }]);
          }
          assert.equal(documentSha256(board.disk(inkPath)), documentSha256({ colors: base }));
          await frame.entered;
          if (pushFirst) {
            frame.release();
            assert.ok(await client.page.waitFor('window.events === ' + (rebuild ? 1 : 2)));
          }
          write.release();
          await client.run('window.saved');
          frame.release();
          const outgoing = inkPatch({ '000001': null, '778899': 100 }, documentSha256({ colors: base }));
          assert.deepEqual(client.requests, [{ writes: [outgoing], client: client.requests[0]!.client, guards: [{ epoch, seq }] }]);
          assert.deepEqual(client.statuses, [rebuild ? 409 : 200]);
          if (shell) assert.deepEqual(await client.page.evaluate('calls.map(m => [m.args[0], m.dbGuards])'), [[[outgoing], [{ epoch, seq }]]]);
          const final = { ...base };
          if (!rebuild) { delete final['000001']; final['778899'] = 100; }
          assert.deepEqual(await client.run('Object.fromEntries(board.content().inks.map(i => [i.color.slice(1), i.at]))'), final);
          assert.deepEqual(await client.run('[board.getSnapshot().pending, board.getSnapshot().flights]'), [0, 0]);
          await assertStoredInks(t, board, other, final);
        });
      }
    }
  }
});

describe('concurrent edits to the shared palette', { timeout: 30_000 }, () => {
  it('merges an ink added to an implicit local record with another editor’s first inks document', async t => {
    const frame = holdDelivery(), delivered = deferred();
    const { doc, peer, disk, writesFromA } = await openSyncBoard(t, 'missing-inks', {
      async beforeInkEvent(id) { if (id === 'sync-board') await frame.hold(); },
      afterInkEvent(id) { if (id === 'sync-board') delivered.resolve(); },
    });
    t.after(frame.release);
    await peer.write([inkPatch({ aabbcc: 10 }, null)]);
    await frame.entered;
    doc.setContent({ ...doc.content(), inks: [{ color: '#112233', at: 11 }] });
    frame.release();
    await delivered.promise;
    await doc.flush();
    assert.deepEqual(writesFromA, [inkPatch({ '112233': 11 }, documentSha256({ colors: { aabbcc: 10 } }))]);
    assert.deepEqual(disk(inkPath), { colors: { aabbcc: 10, '112233': 11 } });
  });

  for (const mode of ['missing-inks', 'live'] as const) {
    const scenario = mode === 'live' ? 'after both clients observe deletion of the palette' : 'on an initially empty palette';
    it(`atomically merges simultaneous inks ${scenario}`, async t => {
      const requests: SyncWrite[] = [];
      let holdWrites = false;
      const together = deferred();
      const read = deferred();
      const deliverRead = deferred();
      const retrySent = deferred();
      const deliverRetry = deferred();
      let loser = '';
      const board = await openSyncBoard(t, mode, {
        async beforeWrite(writes) {
          if (!holdWrites) return;
          requests.push(...writes);
          if (requests.length === 2) together.resolve();
          await together.promise;
          if (requests.length === 3) {
            retrySent.resolve();
            await deliverRetry.promise;
          }
        },
        async afterGet(path, id, data) {
          if (!holdWrites || id === 'inspector') return;
          assert.equal(path, inkPath);
          assert.deepEqual(data, board.disk(inkPath));
          loser = id;
          read.resolve();
          await deliverRead.promise;
        },
      });
      t.after(() => { together.resolve(); deliverRead.resolve(); deliverRetry.resolve(); });
      const { doc, peer, connect, writesFromA } = board;
      const other = await twoEditors(t, board);
      const clients = [doc, other];
      if (mode === 'live') {
        for (const client of clients) assert.deepEqual(client.content().inks, [{ color: '#aabbcc', at: 10 }]);
        doc.setContent({ ...doc.content(), inks: [...doc.content().inks!, { color: '#778899', at: 20 }] });
        assert.equal(doc.getSnapshot().pending, 1);
        await connect('external-editor').write([{ op: 'delete', path: 'board/inks' }]);
        await Promise.all(clients.map(client => whenSnapshot(client, () => !client.content().inks?.length)));
        assert.equal(doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
        assert.equal(doc.getSnapshot().pending, 0);
        assert.deepEqual(writesFromA, []);
      }
      assert.equal(await peer.get('board/inks'), null);
      for (const client of clients) assert.equal(client.content().inks?.length ?? 0, 0);
      const start = board.receipts.length;
      holdWrites = true;
      doc.setContent({ ...doc.content(), inks: [{ color: '#112233', at: 11 }] });
      other.setContent({ ...other.content(), inks: [{ color: '#aabbcc', at: 10 }] });
      const flushed = new Set<LiveBoardDocument>();
      const written = new Set<LiveBoardDocument>();
      const done = Promise.all(clients.flatMap(client => [
        client.flush().then(() => flushed.add(client)),
        client.whenWritten([inkPath]).then(() => written.add(client)),
      ]));
      await read.promise;
      const waiting = loser === 'sync-board' ? doc : other;
      const winnerHash = documentSha256(board.disk(inkPath));
      assert.equal(waiting.getSnapshot().flights, 1);
      assert.equal(flushed.has(waiting) || written.has(waiting), false);
      deliverRead.resolve();
      await retrySent.promise;
      assert.equal(flushed.has(waiting) || written.has(waiting), false);
      deliverRetry.resolve();
      await done;
      assert.equal(requests.length, 3);
      assert.deepEqual(new Set(requests.slice(0, 2)), new Set([inkPatch({ '112233': 11 }, null), inkPatch({ aabbcc: 10 }, null)]));
      assert.deepEqual(requests[2], inkPatch(waiting === doc ? { '112233': 11 } : { aabbcc: 10 }, winnerHash));
      assert.deepEqual(board.receipts.slice(start).map(receipt => receipt.status).sort(), [200, 200, 409]);
      await assertStoredInks(t, board, other, { '112233': 11, aabbcc: 10 });
    });
  }

  for (const ackFirst of [true, false]) {
    it(`keeps both new inks when the old HTTP acknowledgement arrives ${ackFirst ? 'before' : 'after'} the peer update`, async t => {
      const oldWriteSaved = deferred();
      const deliverOldAck = deferred();
      const sendPeerUpdate = deferred();
      let deleted = false;
      const board = await openSyncBoard(t, 'live', {
        async beforeWrite(_writes, id) {
          if (deleted && id === 'second-editor') await sendPeerUpdate.promise;
        },
        async afterWrite(id) {
          if (id === 'sync-board' && !deleted) {
            oldWriteSaved.resolve();
            await deliverOldAck.promise;
          }
        },
      });
      const { doc, peer, connect, disk, writesFromA } = board;
      const other = await twoEditors(t, board);
      t.after(() => { deliverOldAck.resolve(); sendPeerUpdate.resolve(); });
      const clients = [doc, other];
      doc.setContent({ ...doc.content(), inks: [...doc.content().inks!, { color: '#778899', at: 9 }] });
      const firstFlush = doc.flush();
      await Promise.all([oldWriteSaved.promise, whenSnapshot(other, () => colorsOf(other)['778899'] === 9)]);
      assert.deepEqual(writesFromA, [inkPatch({ '778899': 9 }, documentSha256({ colors: { aabbcc: 10 } }))]);
      assert.equal(disk('board/inks').colors['778899'], 9);
      assert.equal(doc.getSnapshot().flights, 1);

      await connect('external-editor').write([{ op: 'delete', path: 'board/inks' }]);
      await Promise.all(clients.map(client => whenSnapshot(client, () => !client.content().inks?.length)));
      assert.equal(await peer.get('board/inks'), null);
      deleted = true;
      const start = board.receipts.length;
      let oldInkReappeared = false;
      for (const client of clients) t.after(client.subscribe(() => { oldInkReappeared ||= '778899' in colorsOf(client); }));
      doc.setContent({ ...doc.content(), inks: [{ color: '#112233', at: 11 }] });
      other.setContent({ ...other.content(), inks: [{ color: '#aabbcc', at: 10 }] });
      const ownFlush = doc.flush();
      const peerFlush = other.flush();
      if (ackFirst) {
        deliverOldAck.resolve();
        await firstFlush;
        sendPeerUpdate.resolve();
      } else {
        sendPeerUpdate.resolve();
        await peerFlush;
        await whenSnapshot(doc, () => colorsOf(doc).aabbcc === 10);
        deliverOldAck.resolve();
      }
      await Promise.all([firstFlush, ownFlush, peerFlush]);
      const receipts = board.receipts.slice(start);
      assert.ok(receipts.every(({ writes }) => writes.every(write => write.op === 'update' && write.ifMatch !== undefined)));
      const first: Record<string, number> = ackFirst ? { '112233': 11 } : { aabbcc: 10 };
      const second: Record<string, number> = ackFirst ? { aabbcc: 10 } : { '112233': 11 };
      assert.deepEqual(receipts.filter(({ status }) => status === 200).flatMap(({ writes }) => writes),
        [inkPatch(first, null), inkPatch(second, documentSha256({ colors: first }))]);
      await assertStoredInks(t, board, other, { '112233': 11, aabbcc: 10 });
      assert.equal(oldInkReappeared, false);
    });
  }

  it('refuses a delayed stub cleanup after the other editor has recreated the palette', async t => {
    const saved = deferred();
    const deliverAck = deferred();
    const cleanup = deferred();
    const sendCleanup = deferred();
    const board = await openSyncBoard(t, 'live', {
      async afterWrite(id) {
        if (id !== 'sync-board') return;
        saved.resolve();
        await deliverAck.promise;
      },
      async beforeWrite(writes, id) {
        if (id !== 'sync-board' || writes[0]?.op !== 'delete') return;
        cleanup.resolve();
        await sendCleanup.promise;
      },
    });
    t.after(() => { deliverAck.resolve(); sendCleanup.resolve(); });
    const { doc, connect, receipts, disk } = board;
    const other = await twoEditors(t, board);
    const start = receipts.length;
    doc.setContent({ ...doc.content(), inks: [...doc.content().inks!, { color: '#778899', at: 9 }] });
    const done = doc.flush();
    await Promise.all([saved.promise, whenSnapshot(other, () => colorsOf(other)['778899'] === 9)]);
    assert.equal(disk(inkPath).colors['778899'], 9);
    await connect('third-editor').write([{ op: 'delete', path: inkPath }]);
    await Promise.all([doc, other].map(client => whenSnapshot(client, () => !client.content().inks?.length)));
    deliverAck.resolve();
    await cleanup.promise;
    other.setContent({ ...other.content(), inks: [{ color: '#aabbcc', at: 10 }] });
    await other.flush();
    await whenSnapshot(doc, () => colorsOf(doc).aabbcc === 10);
    assert.deepEqual(disk(inkPath), { colors: { aabbcc: 10 } });
    sendCleanup.resolve();
    await Promise.all([done, doc.whenWritten([inkPath])]);
    assert.deepEqual(receipts.slice(start).map(({ status }) => status), [200, 200, 200, 409]);
    assert.deepEqual(receipts.at(-1)?.writes, [{ op: 'delete', path: inkPath, ifMatch: documentSha256({ colors: { '778899': 9 } }) }]);
    await assertStoredInks(t, board, other, { aabbcc: 10 });
  });

  it('refuses the pre-deletion update in transit and saves the two post-deletion colors', async t => {
    const dispatched = deferred();
    const sendOld = deferred();
    const read = deferred();
    const deliverRead = deferred();
    const oldColors = { '445566': 8 };
    let attempts = 0;
    const board = await openSyncBoard(t, 'live', {
      initialColors: oldColors,
      writeSignal: id => id === 'sync-board' && attempts === 1 ? AbortSignal.abort() : undefined,
      async beforeWrite(writes, id) {
        if (id === 'sync-board' && writes[0]?.ifMatch === documentSha256({ colors: oldColors })) {
          if (++attempts === 1) return;
          dispatched.resolve();
          await sendOld.promise;
        }
      },
      async afterGet(path, id, data) {
        if (id !== 'sync-board') return;
        assert.equal(path, inkPath);
        assert.deepEqual(data, { colors: { aabbcc: 10 } });
        read.resolve();
        await deliverRead.promise;
      },
    });
    t.after(() => { sendOld.resolve(); deliverRead.resolve(); });
    const { doc, connect, disk, receipts } = board;
    const other = await twoEditors(t, board);
    const start = receipts.length;
    doc.setContent({ ...doc.content(), inks: [...doc.content().inks!, { color: '#778899', at: 9 }] });
    // A cancelled fetch leaves an earlier backoff on this document when the delayed request starts.
    await doc.flush();
    assert.equal(doc.getSnapshot().status, 'offline');
    doc.retry();
    await dispatched.promise;
    let flushed = false;
    const done = doc.flush().then(() => { flushed = true; });
    assert.deepEqual(disk(inkPath), { colors: oldColors });
    await connect('third-editor').write([{ op: 'delete', path: inkPath }]);
    await Promise.all([doc, other].map(client => whenSnapshot(client, () => !client.content().inks?.length)));
    assert.throws(() => disk(inkPath), { code: 'ENOENT' });
    let sawOldInk = false;
    for (const client of [doc, other]) t.after(client.subscribe(() => { sawOldInk ||= '778899' in colorsOf(client); }));
    doc.setContent({ ...doc.content(), inks: [{ color: '#112233', at: 11 }] });
    let written = false;
    const waiting = doc.whenWritten([inkPath]).then(() => { written = true; });
    other.setContent({ ...other.content(), inks: [{ color: '#aabbcc', at: 10 }] });
    await other.flush();
    await whenSnapshot(doc, () => colorsOf(doc).aabbcc === 10);
    assert.deepEqual(disk(inkPath), { colors: { aabbcc: 10 } });
    sendOld.resolve();
    await read.promise;
    assert.equal(flushed || written, false);
    assert.deepEqual(disk(inkPath), { colors: { aabbcc: 10 } });
    deliverRead.resolve();
    await done;
    assert.equal(doc.getSnapshot().pending, 0);
    await waiting;
    assert.deepEqual(receipts.slice(start).map(({ status, writes }) => [status, writes]), [
      [200, [{ op: 'delete', path: inkPath }]],
      [200, [inkPatch({ aabbcc: 10 }, null)]],
      [409, [inkPatch({ '778899': 9 }, documentSha256({ colors: oldColors }))]],
      [200, [inkPatch({ '112233': 11 }, documentSha256({ colors: { aabbcc: 10 } }))]],
    ]);
    await assertStoredInks(t, board, other, { '112233': 11, aabbcc: 10 });
    assert.equal(sawOldInk, false);
  });

  it('splits a refused batch and discovers a deletion through GET before its WebSocket event', async t => {
    const batch = deferred();
    const sendBatch = deferred();
    const deletion = deferred();
    const deliverDeletion = deferred();
    const reads: (SyncDocument['data'] | null)[] = [];
    const board = await openSyncBoard(t, 'live', {
      async beforeWrite(writes, id) {
        if (id === 'sync-board' && writes.length > 1) {
          batch.resolve();
          await sendBatch.promise;
        }
      },
      async beforeInkEvent(id, data) {
        if (id === 'sync-board' && data === null) {
          deletion.resolve();
          await deliverDeletion.promise;
        }
      },
      async afterGet(path, id, data) { if (id === 'sync-board' && path === inkPath) reads.push(data); },
    });
    t.after(() => { sendBatch.resolve(); deliverDeletion.resolve(); });
    const { doc, connect, peer, disk } = board;
    const other = await twoEditors(t, board);
    doc.setTitle('Survives the batch conflict');
    doc.setContent({ ...doc.content(), inks: [...doc.content().inks!, { color: '#778899', at: 9 }] });
    const done = Promise.all([doc.flush(), doc.whenWritten([inkPath, 'board/meta'])]);
    await batch.promise;
    await connect('third-editor').write([{ op: 'delete', path: inkPath }]);
    await deletion.promise;
    assert.equal(colorsOf(doc)['778899'], 9);
    sendBatch.resolve();
    await done;
    const receipts = board.receipts.filter(receipt => receipt.client === 'sync-board');
    assert.deepEqual(receipts.map(({ writes, status }) => [writes.length, status]).sort(), [[1, 200], [1, 409], [2, 409]]);
    assert.deepEqual(reads, [null]);
    assert.equal(doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
    assert.equal(doc.getSnapshot().pending, 0);
    assert.equal(doc.getSnapshot().flights, 0);
    assert.equal(await peer.get(inkPath), null);
    assert.throws(() => disk(inkPath), { code: 'ENOENT' });
    assert.deepEqual(colorsOf(doc), {});
    assert.equal(disk('board/meta').title, 'Survives the batch conflict');
    deliverDeletion.resolve();
    await whenSnapshot(other, () => other.title() === 'Survives the batch conflict');
    assert.deepEqual(colorsOf(other), {});
  });

  for (const recreated of [false, true]) {
    const scenario = recreated ? 'a rebuilt palette' : 'a missing palette';
    it(`counts the deletion once when a conflict GET sees ${scenario} before WebSocket delivery`, async t => {
      const oldSent = deferred(), sendOld = deferred();
      const newSent = deferred(), sendNew = deferred();
      const deleteQueued = deferred(), releaseEvents = deferred();
      const deleteDelivered = deferred(), recreationDelivered = deferred();
      const base = { '445566': 8 }, peerColors = { aabbcc: 10 }, newColor = { '112233': 11 };
      const oldWrite = inkPatch({ '778899': 9 }, documentSha256({ colors: base }));
      const requests: SyncWrite[] = [];
      const reads: (SyncDocument['data'] | null)[] = [];
      const views: Record<string, number>[] = [];
      let savingNew = false;
      const board = await openSyncBoard(t, 'live', {
        initialColors: base,
        async beforeWrite(writes, id) {
          if (id !== 'sync-board') return;
          requests.push(...writes);
          if (requests.length === 1) { oldSent.resolve(); await sendOld.promise; }
          else if (savingNew) { newSent.resolve(); await sendNew.promise; }
        },
        async afterGet(path, id, data) { if (id === 'sync-board' && path === inkPath) reads.push(data); },
        async beforeInkEvent(id, data) {
          if (id === 'sync-board' && data === null) {
            deleteQueued.resolve();
            await releaseEvents.promise;
          }
        },
        afterInkEvent(id, data) {
          if (id !== 'sync-board') return;
          views.push(colorsOf(board.doc));
          (data === null ? deleteDelivered : recreationDelivered).resolve();
        },
      });
      t.after(() => { sendOld.resolve(); sendNew.resolve(); releaseEvents.resolve(); });
      const { doc, connect, disk, receipts } = board;
      const other = await twoEditors(t, board);
      const third = connect('third-editor');
      doc.setContent({ ...doc.content(), inks: [...doc.content().inks!, { color: '#778899', at: 9 }] });
      const oldDone = Promise.all([doc.flush(), doc.whenWritten([inkPath])]);
      await oldSent.promise;
      await third.write([{ op: 'delete', path: inkPath }]);
      await Promise.all([deleteQueued.promise, whenSnapshot(other, () => !other.content().inks?.length)]);
      if (recreated) {
        other.setContent({ ...other.content(), inks: [{ color: '#aabbcc', at: 10 }] });
        await other.flush();
        assert.deepEqual(disk(inkPath), { colors: peerColors });
      }
      sendOld.resolve();
      await oldDone;
      assert.deepEqual(reads, [recreated ? { colors: peerColors } : null]);
      assert.deepEqual(requests, [oldWrite]);
      assert.equal(doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
      assert.deepEqual(colorsOf(doc), recreated ? peerColors : {});
      if (recreated) {
        releaseEvents.resolve();
        await recreationDelivered.promise;
        assert.deepEqual(views, [peerColors, peerColors]);
      }
      savingNew = true;
      doc.setContent({ ...doc.content(), inks: [...(doc.content().inks ?? []), { color: '#112233', at: 11 }] });
      const newDone = Promise.all([doc.flush(), doc.whenWritten([inkPath])]);
      await newSent.promise;
      if (!recreated) {
        releaseEvents.resolve();
        await deleteDelivered.promise;
      }
      sendNew.resolve();
      await newDone;
      const newWrite = inkPatch(newColor, recreated ? documentSha256({ colors: peerColors }) : null);
      assert.deepEqual(requests, [oldWrite, newWrite]);
      assert.deepEqual(receipts.filter(r => r.client === 'sync-board').map(r => [r.status, r.writes]), [[409, [oldWrite]], [200, [newWrite]]]);
      if (!recreated) assert.deepEqual(views, [newColor]);
      const reader = await assertStoredInks(t, board, other, recreated ? { ...peerColors, ...newColor } : newColor);
      await Promise.all(board.socketsReady);
      await third.write([{ op: 'delete', path: inkPath }]);
      await Promise.all([doc, other, reader].map(client => whenSnapshot(client, () => !client.content().inks?.length)));
      assert.equal(await third.get(inkPath), null);
      assert.throws(() => disk(inkPath), { code: 'ENOENT' });
    });
  }

  it('keeps the latest palette while two read-ahead deletions and recreations reach the editor', async t => {
    const base = { '445566': 8 };
    const intermediate = { aabbcc: 10 };
    const latest = { ccddee: 12 };
    const rounds = [base, intermediate].map((colors, index) => ({
      hash: documentSha256({ colors }), replacement: index === 0 ? intermediate : latest,
      sent: deferred(), release: deferred(),
    }));
    const releaseEvents = deferred(), delivered = deferred();
    const views: Record<string, number>[] = [];
    const board = await openSyncBoard(t, 'live', {
      initialColors: base,
      async beforeWrite(writes, id) {
        const round = rounds.find(r => r.hash === writes[0]?.ifMatch);
        if (id === 'sync-board' && round) { round.sent.resolve(); await round.release.promise; }
      },
      async beforeInkEvent(id) { if (id === 'sync-board') await releaseEvents.promise; },
      afterInkEvent(id) {
        if (id !== 'sync-board') return;
        views.push(colorsOf(board.doc));
        if (views.length === 4) delivered.resolve();
      },
    });
    t.after(() => { for (const round of rounds) round.release.resolve(); releaseEvents.resolve(); });
    const other = await twoEditors(t, board);
    const { doc } = board;
    const third = board.connect('third-editor');
    let lastNotice = 0;
    for (const round of rounds) {
      doc.setContent({ ...doc.content(), inks: [...doc.content().inks!, { color: '#778899', at: 9 }] });
      const declined = doc.flush();
      await round.sent.promise;
      await third.write([{ op: 'delete', path: inkPath }]);
      await third.write([{ op: 'set', path: inkPath, data: { colors: round.replacement } }]);
      round.release.resolve();
      await declined;
      assert.deepEqual(colorsOf(doc), round.replacement);
      const notice = doc.getSnapshot().notice;
      assert.ok(notice && notice.message === LIVE_MESSAGES.itemGone && notice.id > lastNotice);
      lastNotice = notice.id;
    }
    doc.setContent({ ...doc.content(), inks: [...doc.content().inks!, { color: '#112233', at: 11 }] });
    await doc.flush();
    releaseEvents.resolve();
    await delivered.promise;
    const saved = { ...latest, '112233': 11 };
    assert.deepEqual(views, [saved, saved, saved, saved]);
    assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), [409, 409, 200]);
    await assertStoredInks(t, board, other, saved);
  });

  it('rebases a conflict when a full palette evicts its oldest color', async t => {
    const colors = Object.fromEntries(Array.from({ length: MAX_BOARD_INKS }, (_, i) => [(i + 1).toString(16).padStart(6, '0'), i + 1]));
    const oldSent = deferred(), sendOld = deferred(), releaseEvent = deferred();
    let attempts = 0;
    const board = await openSyncBoard(t, 'live', {
      initialColors: colors,
      async beforeWrite(_writes, id) {
        if (id === 'sync-board' && ++attempts === 1) { oldSent.resolve(); await sendOld.promise; }
      },
      async beforeInkEvent(id) { if (id === 'sync-board') await releaseEvent.promise; },
    });
    t.after(() => { sendOld.resolve(); releaseEvent.resolve(); });
    const { doc, receipts } = board;
    const other = await twoEditors(t, board);
    doc.setContent({ ...doc.content(), inks: doc.content().inks!.map(ink => ink.color === '#000002' ? { ...ink, at: 100 } : ink) });
    const done = Promise.all([doc.flush(), doc.whenWritten([inkPath])]);
    await oldSent.promise;
    other.setContent({ ...other.content(), inks: [...other.content().inks!.slice(1), { color: '#aabbcc', at: 90 }] });
    await other.flush();
    const peerColors = colorsOf(other);
    const peerHash = documentSha256(board.disk(inkPath));
    assert.equal(Object.keys(peerColors).length, MAX_BOARD_INKS);
    assert.equal(Object.hasOwn(peerColors, '000001'), false);
    sendOld.resolve();
    await done;
    assert.deepEqual(receipts.filter(r => r.client === 'sync-board').map(r => [r.status, r.writes]), [
      [409, [inkPatch({ '000002': 100 }, documentSha256({ colors }))]],
      [200, [inkPatch({ '000002': 100 }, peerHash)]],
    ]);
    releaseEvent.resolve();
    await assertStoredInks(t, board, other, { ...peerColors, '000002': 100 });
    assert.equal(doc.getSnapshot().notice, undefined);
  });

  for (const localProvider of [false, true]) {
    for (const timing of ['absent', 'rebuilt', 'receipt first', 'peer edits after save', 'peer deletes after save']) {
      const rebuilt = timing === 'rebuilt';
      const peerEdit = timing === 'peer edits after save', peerDelete = timing === 'peer deletes after save';
      const endpoint = localProvider ? 'LocalProvider' : 'bare transport';
      it(`reconciles a new save after two deletions before one GET (${endpoint}, ${timing})`, async t => {
        const oldSent = deferred(), sendOld = deferred(), newSent = deferred(), sendNew = deferred();
        const releaseEvents = deferred(), delivered = deferred();
        const verifying = deferred(), returnRead = deferred();
        const releasePeer = deferred(), peerDelivered = deferred();
        const reads: (SyncDocument['data'] | null)[] = [];
        const requests: SyncWrite[] = [], events: (SyncDocument['data'] | null)[] = [], views: Record<string, number>[] = [];
        const publicEvents: SyncChangeEvent[] = [];
        const base = { '445566': 8 }, intermediate = { colors: { aabbcc: 10 } }, latest = { colors: { ccddee: 12 } };
        const board = await openSyncBoard(t, 'live', {
          localProvider, initialColors: base,
          async beforeWrite(writes, id) {
            if (id !== 'sync-board') return;
            requests.push(...writes);
            if (requests.length === 1) { oldSent.resolve(); await sendOld.promise; }
            if (requests.length === 2) { newSent.resolve(); await sendNew.promise; }
          },
          async afterWrite(id) {
            if (id !== 'sync-board' || requests.length !== 2) return;
            if (peerEdit) await board.connect('third-editor').write([{ op: 'set', path: inkPath, data: latest }]);
            if (peerDelete) await board.connect('third-editor').write([{ op: 'delete', path: inkPath }]);
          },
          async afterGet(path, id, data) {
            if (id !== 'sync-board' || path !== inkPath) return;
            reads.push(data);
            if (timing === 'absent' && reads.length === 2) {
              verifying.resolve(); await returnRead.promise;
            }
          },
          async beforeInkEvent(id) {
            if (id !== 'sync-board') return;
            await releaseEvents.promise;
            if ((peerEdit || peerDelete) && events.length === 3) await releasePeer.promise;
          },
          afterInkEvent(id, data) {
            if (id !== 'sync-board') return;
            events.push(data);
            views.push(colorsOf(board.doc));
            if (events.length === (rebuilt ? 4 : 3)) delivered.resolve();
            if ((peerEdit || peerDelete) && events.length === 4) peerDelivered.resolve();
          },
        });
        t.after(() => { sendOld.resolve(); sendNew.resolve(); releaseEvents.resolve(); returnRead.resolve(); releasePeer.resolve(); });
        const { doc } = board;
        const other = await twoEditors(t, board);
        const third = board.connect('third-editor');
        const off = board.db?.onChange(event => publicEvents.push(event));
        if (off) t.after(off);
        doc.setContent({ ...doc.content(), inks: [...doc.content().inks!, { color: '#778899', at: 9 }] });
        const oldDone = doc.flush();
        await oldSent.promise;
        await third.write([{ op: 'delete', path: inkPath }]);
        await third.write([{ op: 'set', path: inkPath, data: intermediate }]);
        await third.write([{ op: 'delete', path: inkPath }]);
        if (rebuilt) await third.write([{ op: 'set', path: inkPath, data: latest }]);
        sendOld.resolve();
        await oldDone;
        assert.deepEqual(reads, [rebuilt ? latest : null]);
        assert.equal(doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
        const oldNotice = doc.getSnapshot().notice!.id;
        doc.setContent({ ...doc.content(), inks: [...(doc.content().inks ?? []), { color: '#112233', at: 11 }] });
        let written = false;
        const newDone = Promise.all([doc.flush(), doc.whenWritten([inkPath]).then(() => { written = true; })]);
        await newSent.promise;
        if (rebuilt || timing === 'receipt first') { sendNew.resolve(); await newDone; }
        releaseEvents.resolve();
        await delivered.promise;
        sendNew.resolve();
        if (timing === 'absent') {
          await verifying.promise;
          assert.equal(written, false);
          assert.equal(doc.getSnapshot().flights, 1);
          returnRead.resolve();
        }
        await newDone;
        await doc.flush();
        const saved = { ...(rebuilt ? latest.colors : {}), '112233': 11 };
        const history = rebuilt ? [null, intermediate, null, latest] : [null, intermediate, null];
        const changeFor = (data: SyncDocument['data'] | null) => ({ author: 'third-editor', changes: { [inkPath]: data } });
        assert.deepEqual(events, history);
        if (rebuilt) assert.deepEqual(views, [saved, saved, saved, saved]);
        if (timing === 'receipt first') assert.deepEqual(views, [saved, saved, saved]);
        if (localProvider) assert.deepEqual(publicEvents, history.map(changeFor));
        if (timing === 'absent') assert.deepEqual(reads, [null, { colors: saved }]);
        if (localProvider && rebuilt) assert.deepEqual(reads, [latest]);
        assert.deepEqual(requests, [inkPatch({ '778899': 9 }, documentSha256({ colors: base })),
          inkPatch({ '112233': 11 }, rebuilt ? documentSha256(latest) : null)]);
        if (peerEdit || peerDelete) {
          assert.deepEqual(reads.at(-1), peerEdit ? latest : null);
          assert.deepEqual(colorsOf(doc), peerEdit ? latest.colors : {});
          releasePeer.resolve();
          await peerDelivered.promise;
          if (peerEdit) await assertStoredInks(t, board, other, latest.colors);
          else {
            assert.equal(doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
            assert.ok(doc.getSnapshot().notice!.id > oldNotice);
            assert.equal(await third.get(inkPath), null);
            assert.throws(() => board.disk(inkPath), { code: 'ENOENT' });
          }
          return;
        }
        const reader = await assertStoredInks(t, board, other, saved);
        await third.write([{ op: 'delete', path: inkPath }]);
        await Promise.all([doc, other, reader].map(client => whenSnapshot(client, () => !client.content().inks?.length)));
        assert.equal(await third.get(inkPath), null);
        assert.throws(() => board.disk(inkPath), { code: 'ENOENT' });
        if (localProvider) assert.deepEqual(publicEvents, [...history, null].map(changeFor));
      });
    }
  }

  it('stamps page, disk and reserved writes in one host epoch and starts a new epoch on reopen', async t => {
    const frames: ServerEvents['db'][] = [];
    let received = deferred();
    const board = await openSyncBoard(t, 'live', {
      afterInkEvent(id, _data, raw) { if (id === 'sync-board') { frames.push(raw); received.resolve(); } },
    });
    await twoEditors(t, board);
    const { epoch, seq } = await board.request(API.dbList, { collection: 'board' });
    assert.match(epoch, /^[0-9a-f-]{36}$/);
    assert.ok(Number.isSafeInteger(seq));
    const colors = { aabbcc: 20 };
    const receipt = await board.request(API.dbWrite, undefined, { client: 'page', writes: [{ op: 'set', path: inkPath, data: { colors } }] });
    await received.promise;
    assert.deepEqual(receipt, { ok: true, epoch, seq: seq + 1 });
    received = deferred();
    writeFileSync(join(board.root, 'db', 'board', 'inks.json'), JSON.stringify({ colors: { aabbcc: 21 } }));
    await received.promise;
    received = deferred();
    const res = await fetch(new URL('/__open-artifact/actions/open-artifact.db.write', board.pageUrl), {
      method: 'POST', headers: { authorization: 'Bearer sync-board', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'ink-action', root: board.root, args: { writes: [{ op: 'set', path: inkPath, data: { colors: { aabbcc: 22 } } }] } }),
    });
    assert.equal(res.status, 200);
    await received.promise;
    assert.deepEqual(frames, [20, 21, 22].map((at, index) => ({
      changes: { [inkPath]: { colors: { aabbcc: at } } }, author: index === 0 ? 'page' : 'agent', epoch, seq: seq + index + 1,
    })));
    assert.deepEqual(await board.request(API.dbGet, { path: inkPath }), { data: { colors: { aabbcc: 22 } }, epoch, seq: seq + 3 });
    assert.ok(board.server.close(board.artifactId));
    const reopened = await board.server.open({ root: board.root, type: 'whiteboard' });
    const url = new URL(API.dbGet, reopened.pageUrl);
    url.searchParams.set('path', inkPath);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const fresh = await response.json();
    assert.notEqual(fresh.epoch, epoch);
    assert.equal(fresh.seq, 0);
    assert.deepEqual(fresh.data, { colors: { aabbcc: 22 } });
  });

  for (const read of ['LIST', 'GET'] as const) {
    it(`delivers a delayed palette rebuild to every editor sharing the db after a ${read}`, async t => {
      const frame = holdDelivery(), initial = { '445566': 70 }, rebuilt = { '8899aa': 41 };
      let inkGets = 0;
      const board = await openSyncBoard(t, 'live', {
        localProvider: 'watermarked',
        inkGetResponse() { inkGets++; },
        async beforeInkEvent(id) { if (id === 'sync-board') await frame.hold(); },
      });
      t.after(frame.release);
      const { doc, db } = board;
      assert.ok(db);
      const peer = await twoEditors(t, board);
      const saved = { op: 'set' as const, path: inkPath, data: { colors: initial } };
      await doc.writeNow([saved]);
      assert.ok(getDbDocMeta(saved));
      const openReader = async () => {
        const reader = createLiveBoardDocument({ transport: db, readOnly: true });
        t.after(() => reader.dispose());
        await whenSnapshot(reader, () => reader.getSnapshot().loadState === 'live');
        return reader;
      };
      const watching = read === 'GET' ? await openReader() : undefined;
      if (watching) assert.deepEqual(colorsOf(watching), initial);
      const pushes: SyncChangeEvent[] = [];
      t.after(db.onChange(event => { if (inkPath in event.changes) pushes.push(event); }));
      await peer.writeNow([{ op: 'delete', path: inkPath }, { op: 'set', path: inkPath, data: { colors: rebuilt } }]);
      await frame.entered;
      const reader = watching ?? await openReader();
      if (read === 'LIST') assert.deepEqual(colorsOf(reader), rebuilt);
      else assert.deepEqual(await db.get(inkPath), { colors: rebuilt });
      assert.deepEqual(colorsOf(doc), initial);
      frame.release();
      await peer.writeNow([{ op: 'set', path: 'elements/progress', data: stored(note('progress', 'Delivered')) }]);
      await Promise.all([doc, reader].map(client => whenSnapshot(client, () => textOf(client, 'progress') === 'Delivered')));
      for (const client of [doc, reader, peer]) {
        await client.flush();
        assert.deepEqual(colorsOf(client), rebuilt);
        assert.equal(client.getSnapshot().pending, 0);
        assert.equal(client.getSnapshot().flights, 0);
      }
      assert.equal(reader.canEdit(), false);
      assert.deepEqual(pushes, [{ author: 'second-editor', changes: { [inkPath]: { colors: rebuilt } } }]);
      assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.writes), [[saved]]);
      assert.equal(inkGets, read === 'GET' ? 1 : 0);
      assert.deepEqual((await board.request(API.dbGet, { path: inkPath })).data, { colors: rebuilt });
      assert.deepEqual(board.disk(inkPath), { colors: rebuilt });
    });
  }

  for (const delivery of ['live', 'buffered'] as const) {
    it(`keeps a deleted palette absent after an empty LIST and a ${delivery} older update`, async t => {
      const frame = holdDelivery(), list = holdDelivery(), progress = deferred();
      const old = { '8899aa': 41 }, fresh = { '223344': 90 };
      let inkGets = 0;
      const board = await openSyncBoard(t, 'live', {
        localProvider: 'watermarked', inkGetResponse() { inkGets++; },
        async beforeInkEvent(id) { if (id === 'sync-board') await frame.hold(); },
      });
      t.after(() => { frame.release(); list.release(); });
      const { doc, db } = board;
      assert.ok(db);
      const peer = await twoEditors(t, board);
      await peer.writeNow([{ op: 'set', path: inkPath, data: { colors: old } }]);
      await frame.entered;
      // Remove the fixture's board/meta in the same commit so the collection is empty.
      const remove = { op: 'delete' as const, path: inkPath };
      const deletes = [remove, { op: 'delete' as const, path: 'board/meta' }];
      await doc.writeNow(deletes);
      const receipt = getDbDocMeta(remove);
      assert.ok(receipt);
      const { epoch, seq } = receipt;
      assert.equal(seq, 3);
      await whenSnapshot(peer, () => !peer.content().inks?.length);
      let boardList: SyncDocument[] | undefined;
      const reader = createLiveBoardDocument({ readOnly: true, transport: {
        ...db,
        async list(collection) {
          const docs = await db.list(collection);
          if (collection === 'board') { boardList = docs; await list.hold(); }
          return docs;
        },
      } });
      t.after(() => reader.dispose());
      await list.entered;
      assert.deepEqual(boardList, []);
      const live = whenSnapshot(reader, () => reader.getSnapshot().loadState === 'live');
      if (delivery === 'live') { list.release(); await live; }
      const views: Record<string, number>[] = [];
      t.after(reader.subscribe(change => { if (change.valueChanged) views.push(colorsOf(reader)); }));
      const positions: number[] = [];
      t.after(db.onChange(({ changes }) => {
        const data = changes[inkPath];
        if (data) {
          const meta = getDbDocMeta(data);
          assert.ok(meta);
          assert.equal(meta.epoch, epoch);
          positions.push(meta.seq);
        }
        if ('elements/progress' in changes) progress.resolve();
      }));
      frame.release();
      await peer.writeNow([{ op: 'set', path: 'elements/progress', data: stored(note('progress', 'Delivered')) }]);
      await progress.promise;
      if (delivery === 'buffered') assert.equal(reader.getSnapshot().loadState, 'loading');
      list.release();
      await live;
      for (const client of [reader, doc, peer]) {
        await client.flush();
        assert.deepEqual(colorsOf(client), {});
        assert.equal(textOf(client, 'progress'), 'Delivered');
        assert.equal(client.getSnapshot().pending, 0);
        assert.equal(client.getSnapshot().flights, 0);
      }
      assert.ok(views.every(colors => Object.keys(colors).length === 0));
      assert.deepEqual(getDbDocMeta(boardList), { epoch, seq });
      assert.deepEqual(positions, [seq - 1]);
      assert.equal((await board.request(API.dbGet, { path: inkPath })).data, null);
      assert.throws(() => board.disk(inkPath), { code: 'ENOENT' });
      await peer.writeNow([{ op: 'set', path: inkPath, data: { colors: fresh } }]);
      for (const client of [reader, doc, peer]) {
        await whenSnapshot(client, () => colorsOf(client)['223344'] === 90);
        assert.deepEqual(colorsOf(client), fresh);
      }
      assert.deepEqual(positions, [seq - 1, seq + 2]);
      assert.deepEqual(board.disk(inkPath), { colors: fresh });
      assert.deepEqual((await board.request(API.dbGet, { path: inkPath })).data, { colors: fresh });
      assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.writes), [deletes]);
      assert.equal(inkGets, 0);
    });
  }

  it('applies only frames newer than its board LIST when replaying buffered changes', async t => {
    const startList = holdDelivery(), finishList = holdDelivery(), delivered = deferred();
    const rebuilt = { '8899aa': 41 }, next = { ...rebuilt, aabbcc: 90 };
    let inkGets = 0, listSeq = -1;
    const board = await openSyncBoard(t, 'live', {
      localProvider: 'watermarked', inkGetResponse() { inkGets++; },
    });
    const { db, peer } = board;
    assert.ok(db);
    const reader = createLiveBoardDocument({ readOnly: true, transport: {
      ...db,
      async list(collection) {
        if (collection !== 'board') return db.list(collection);
        await startList.hold();
        const docs = await db.list(collection);
        const inks = docs.find(doc => doc.path === inkPath);
        assert.deepEqual(inks?.data, { colors: rebuilt });
        const meta = getDbDocMeta(inks?.data);
        assert.ok(meta);
        listSeq = meta.seq;
        await finishList.hold();
        return docs;
      },
    } });
    t.after(() => { startList.release(); finishList.release(); reader.dispose(); });
    const frames: number[] = [];
    t.after(db.onChange(({ changes }) => {
      const data = changes[inkPath];
      if (data === undefined) return;
      const meta = data === null ? getDbChangeDeleteMeta(changes, inkPath) : getDbDocMeta(data);
      assert.ok(meta);
      frames.push(meta.seq);
      if ('elements/progress' in changes) delivered.resolve();
    }));
    await startList.entered;
    await peer.write([{ op: 'delete', path: inkPath }]);
    await peer.write([{ op: 'set', path: inkPath, data: { colors: rebuilt } }]);
    startList.release();
    await finishList.entered;
    await peer.write([
      { op: 'update', path: inkPath, patch: { colors: { aabbcc: 90 } } },
      { op: 'set', path: 'elements/progress', data: stored(note('progress', 'Delivered')) },
    ]);
    await delivered.promise;
    assert.deepEqual(frames, [listSeq - 1, listSeq, listSeq + 1]);
    finishList.release();
    await whenSnapshot(reader, () => reader.getSnapshot().loadState === 'live');
    await reader.flush();
    assert.deepEqual(colorsOf(reader), next);
    assert.equal(textOf(reader, 'progress'), 'Delivered');
    assert.equal(inkGets, 0);
    assert.equal(board.receipts.filter(r => r.client === 'sync-board').length, 0);
  });

  it('ignores frames already covered by its creation verification GET', async t => {
    const race = await queueInkDeletions(t, 'LocalProvider');
    const { saved } = await holdAcceptedInk(race, false);
    const rebuilt = { '8899aa': 41 }, next = { ...rebuilt, aabbcc: 90 };
    await race.third.write([{ op: 'delete', path: inkPath }]);
    await race.third.write([{ op: 'set', path: inkPath, data: { colors: rebuilt } }]);
    race.receipt.release();
    await race.verification.entered;
    const meta = getDbDocMeta(race.reads.at(-1));
    assert.ok(meta);
    race.verification.release();
    await saved;
    assert.deepEqual(colorsOf(race.doc), rebuilt);
    const viewCount = race.views.length;
    await race.deliver(3);
    await race.deliver(4);
    await race.doc.flush();
    assert.equal(race.views.length, viewCount);
    await race.third.write([{ op: 'update', path: inkPath, patch: { colors: { aabbcc: 90 } } }]);
    await race.deliver(5);
    await race.doc.flush();
    assert.deepEqual(race.wire.slice(3).map(frame => [frame.epoch, frame.seq]),
      [meta.seq - 1, meta.seq, meta.seq + 1].map(seq => [meta.epoch, seq]));
    assert.deepEqual(race.views.slice(viewCount), [next]);
    assert.deepEqual(race.reads, [null, { colors: rebuilt }]);
    await assertStoredInks(t, race.board, race.other, next);
  });

  for (const source of ['writeNow receipt', 'conflict GET'] as const) {
    it(`ignores earlier and equal frames after its own ${source} and accepts the next update`, async t => {
      const rebuilt = { '8899aa': 41 }, next = { ...rebuilt, aabbcc: 90 };
      const race = await holdInkConflict(t, 'LocalProvider', { '445566': 70 }, 2);
      const { board, reads } = race, { doc, db } = board;
      assert.ok(db);
      const finish = source === 'conflict GET' ? await race.startWrite('#112233') : undefined;
      const peer = board.connect('recreating-peer');
      await peer.write([{ op: 'delete', path: inkPath }]);
      const set = { op: 'set' as const, path: inkPath, data: { colors: rebuilt } };
      await peer.write([set]);
      if (finish) await finish();
      else await doc.writeNow([set]);
      const meta = getDbDocMeta(finish ? reads[0] : set);
      assert.ok(meta);
      assert.deepEqual(colorsOf(doc), rebuilt);
      const frames: number[] = [], views: Record<string, number>[] = [];
      t.after(db.onChange(({ changes }) => {
        const data = changes[inkPath];
        if (data === undefined) return;
        const position = data === null ? getDbChangeDeleteMeta(changes, inkPath) : getDbDocMeta(data);
        assert.ok(position);
        assert.equal(position.epoch, meta.epoch);
        frames.push(position.seq);
      }));
      t.after(doc.subscribe(change => { if (change.valueChanged) views.push(colorsOf(doc)); }));
      await race.deliverPeerFrames();
      await doc.flush();
      assert.deepEqual(frames, [meta.seq - 1, meta.seq]);
      assert.deepEqual(views, []);
      await peer.write([{ op: 'update', path: inkPath, patch: { colors: { aabbcc: 90 } } }]);
      await whenSnapshot(doc, () => colorsOf(doc).aabbcc === 90);
      await doc.flush();
      assert.deepEqual(frames, [meta.seq - 1, meta.seq, meta.seq + 1]);
      assert.deepEqual(views, [next]);
      assert.deepEqual(reads, finish ? [{ colors: rebuilt }] : []);
      await assertStoredInks(t, board, race.other, next);
    });
  }

  it('rebases two concurrent additions at capacity and keeps 63 colors after the peer removes its ink', async t => {
    const oldSent = deferred(), sendOld = deferred(), peerEvent = deferred(), oldDelivered = deferred();
    const colors = fullPalette();
    const board = await openSyncBoard(t, 'live', {
      initialColors: colors,
      async beforeWrite(writes, id) {
        if (id === 'sync-board' && writes[0]?.ifMatch === documentSha256({ colors })) {
          oldSent.resolve(); await sendOld.promise;
        }
      },
      async beforeInkEvent(id) { if (id === 'sync-board') await peerEvent.promise; },
      afterInkEvent(id) { if (id === 'sync-board') oldDelivered.resolve(); },
    });
    t.after(() => { sendOld.resolve(); peerEvent.resolve(); });
    const { doc } = board;
    const other = await twoEditors(t, board);
    doc.setContent({ ...doc.content(), inks: [...doc.content().inks!.slice(1), { color: '#112233', at: 101 }] });
    const done = doc.flush();
    await oldSent.promise;
    other.setContent({ ...other.content(), inks: [...other.content().inks!.slice(1), { color: '#aabbcc', at: 100 }] });
    await other.flush();
    sendOld.resolve();
    await done;
    peerEvent.resolve();
    await oldDelivered.promise;
    const { '000001': first, '000002': second, ...retained } = colors;
    assert.equal(first, 1); assert.equal(second, 2);
    const saved = { ...retained, aabbcc: 100, '112233': 101 };
    const reader = await assertStoredInks(t, board, other, saved);
    const receipts = board.receipts.filter(r => r.client === 'sync-board');
    assert.deepEqual(receipts.map(r => r.status), [409, 200]);
    assert.deepEqual(receipts[1]!.writes[0], { op: 'update', path: inkPath,
      patch: { colors: { '000002': null, '112233': 101 } }, ifMatch: documentSha256({ colors: { '000002': second, ...retained, aabbcc: 100 } }) });
    other.setContent({ ...other.content(), inks: other.content().inks!.filter(ink => ink.color !== '#aabbcc') });
    await other.flush();
    const final = { ...retained, '112233': 101 };
    assert.equal(Object.keys(final).length, 63);
    await Promise.all([doc, reader].map(client => whenSnapshot(client, () => !('aabbcc' in colorsOf(client)))));
    for (const client of [doc, other, reader]) assert.deepEqual(colorsOf(client), final);
    await assertStoredInks(t, board, other, final);
  });

  it('removes a visible ink from a 65-color disk record without reviving the hidden oldest ink', async t => {
    const colors = fullPalette();
    delete colors['000001'];
    const initial = { ...colors, aabbcc: 100, '112233': 101 };
    const board = await openSyncBoard(t, 'live', { initialColors: initial });
    const other = await twoEditors(t, board);
    assert.equal(Object.keys(board.disk(inkPath).colors).length, 65);
    assert.equal(Object.keys(colorsOf(board.doc)).length, 64);
    assert.equal(Object.hasOwn(colorsOf(board.doc), '000002'), false);
    board.doc.setContent({ ...board.doc.content(), inks: board.doc.content().inks!.filter(ink => ink.color !== '#aabbcc') });
    await board.doc.flush();
    delete colors['000002'];
    const final = { ...colors, '112233': 101 };
    assert.equal(Object.keys(final).length, 63);
    await assertStoredInks(t, board, other, final);
  });

  it('drops an in-flight edit when a full palette is deleted and recreated with a single overlapping color', async t => {
    const colors = fullPalette();
    delete colors['000001'];
    colors.aabbcc = 1;
    const oldSent = deferred(), sendOld = deferred(), deliverEvents = deferred();
    const board = await openSyncBoard(t, 'live', {
      initialColors: colors,
      async beforeWrite(_writes, id) {
        if (id === 'sync-board') { oldSent.resolve(); await sendOld.promise; }
      },
      async beforeInkEvent(id) { if (id === 'sync-board') await deliverEvents.promise; },
    });
    t.after(() => { sendOld.resolve(); deliverEvents.resolve(); });
    const { doc } = board;
    const other = await twoEditors(t, board);
    doc.setContent({ ...doc.content(), inks: [...doc.content().inks!.slice(1), { color: '#778899', at: 101 }] });
    const done = doc.flush();
    await oldSent.promise;
    const third = board.connect('third-editor');
    await third.write([{ op: 'delete', path: inkPath }]);
    await third.write([{ op: 'set', path: inkPath, data: { colors: { aabbcc: 90 } } }]);
    sendOld.resolve();
    await done;
    assert.equal(doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
    assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board').map(r => r.status), [409]);
    deliverEvents.resolve();
    await assertStoredInks(t, board, other, { aabbcc: 90 });
  });

  it('accounts for an in-place ink removal before the next real document deletion', async t => {
    const base = { '445566': 8, aabbcc: 10 };
    const oldSent = deferred(), sendOld = deferred();
    const sendPeerEvent = deferred(), peerEventDelivered = deferred(), deletionDelivered = deferred();
    const board = await openSyncBoard(t, 'live', {
      initialColors: base,
      async beforeWrite(writes, id) {
        if (id === 'sync-board' && writes[0]?.ifMatch === documentSha256({ colors: base })) {
          oldSent.resolve();
          await sendOld.promise;
        }
      },
      async beforeInkEvent(id, data) { if (id === 'sync-board' && data !== null) await sendPeerEvent.promise; },
      afterInkEvent(id, data) { if (id === 'sync-board') (data === null ? deletionDelivered : peerEventDelivered).resolve(); },
    });
    t.after(() => { sendOld.resolve(); sendPeerEvent.resolve(); });
    const { doc, receipts, disk } = board;
    const other = await twoEditors(t, board);
    doc.setContent({ ...doc.content(), inks: [...doc.content().inks!, { color: '#778899', at: 9 }] });
    const oldDone = doc.flush();
    await oldSent.promise;
    other.setContent({ ...other.content(), inks: other.content().inks!.filter(ink => ink.color !== '#445566') });
    await other.flush();
    assert.deepEqual(disk(inkPath), { colors: { aabbcc: 10 } });
    sendOld.resolve();
    await oldDone;
    assert.equal(doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
    doc.setContent({ ...doc.content(), inks: [...doc.content().inks!, { color: '#112233', at: 11 }] });
    await doc.flush();
    const savedHash = documentSha256(disk(inkPath));
    sendPeerEvent.resolve();
    await peerEventDelivered.promise;
    doc.setContent({ ...doc.content(), inks: [...doc.content().inks!, { color: '#334455', at: 12 }] });
    await doc.flush();
    const own = receipts.filter(r => r.client === 'sync-board');
    assert.deepEqual(own.map(r => r.status), [409, 200, 200]);
    assert.deepEqual(own.at(-1)?.writes, [inkPatch({ '334455': 12 }, savedHash)]);
    await assertStoredInks(t, board, other, { aabbcc: 10, '112233': 11, '334455': 12 });
    await board.connect('third-editor').write([{ op: 'delete', path: inkPath }]);
    await deletionDelivered.promise;
    assert.deepEqual(colorsOf(doc), {});
  });

  for (const localProvider of [false, 'watermarked'] as const) it(`bounds repeated real conflicts and saves on explicit retry (${localProvider || 'bare'})`, async t => {
    let competingWrites = 0;
    let racing = true;
    const peerColors: Record<string, number> = { aabbcc: 10 };
    const board = await openSyncBoard(t, 'live', {
      localProvider,
      async beforeWrite(_writes, id) {
        if (id === 'sync-board' && racing && competingWrites < 12) {
          competingWrites++;
          const hex = localProvider ? '445566' : competingWrites.toString(16).padStart(6, '0');
          peerColors[hex] = competingWrites;
          await board.peer.write([{ op: 'update', path: inkPath, patch: { colors: { [hex]: competingWrites } } }]);
        }
      },
    });
    const other = await twoEditors(t, board);
    const { doc } = board;
    doc.setContent({ ...doc.content(), inks: [...doc.content().inks!, { color: '#112233', at: 11 }] });
    await Promise.all([doc.flush(), assert.rejects(doc.whenWritten([inkPath]), { code: 'conflict' })]);
    assert.ok(competingWrites > 1 && competingWrites < 12);
    assert.ok(board.receipts.filter(r => r.client === 'sync-board').every(r => r.status === 409));
    assert.equal(doc.getSnapshot().status, 'error');
    assert.equal(doc.getSnapshot().pending, 1);
    assert.equal(doc.getSnapshot().flights, 0);
    racing = false;
    doc.retry();
    await Promise.all([doc.flush(), doc.whenWritten([inkPath])]);
    await assertStoredInks(t, board, other, { ...peerColors, '112233': 11 });
  });

  for (const end of ['dispose', 'revoke'] as const) {
    it(`releases waiters when the board closes or loses access during a conflict read (${end})`, async t => {
      const read = deferred();
      const deliverRead = deferred();
      const board = await openSyncBoard(t, 'live', {
        async beforeWrite(writes, id) {
          if (id === 'sync-board' && writes[0]?.path === inkPath) {
            await board.peer.write([{ op: 'update', path: inkPath, patch: { colors: { '445566': 8 } } }]);
          }
        },
        async afterGet(_path, id) {
          if (id === 'sync-board') {
            read.resolve();
            await deliverRead.promise;
          }
        },
      });
      t.after(deliverRead.resolve);
      const { doc } = board;
      await twoEditors(t, board);
      doc.setContent({ ...doc.content(), inks: [...doc.content().inks!, { color: '#112233', at: 11 }] });
      const done = doc.flush();
      const rejected = assert.rejects(doc.whenWritten([inkPath]), { code: end === 'dispose' ? 'disposed' : 'not_granted' });
      await read.promise;
      if (end === 'dispose') doc.dispose();
      else {
        board.revokeAccess();
        doc.setTitle('Access revoked');
        await doc.flush();
      }
      await Promise.all([done, rejected]);
      deliverRead.resolve();
      await settle();
      assert.deepEqual(board.receipts.filter(r => r.client === 'sync-board' && r.writes[0]?.path === inkPath).map(r => r.status), [409]);
      assert.deepEqual(board.disk(inkPath), { colors: { aabbcc: 10, '445566': 8 } });
    });
  }

  it('cleans up the stub of an old update when nobody recreates the deleted palette', async t => {
    const updateDispatched = deferred();
    const sendOldUpdate = deferred();
    const { doc, peer, disk, writesFromA } = await openSyncBoard(t, 'missing-inks', {
      async beforeWrite(writes, id) {
        if (id !== 'sync-board') return;
        if (writes[0]?.op === 'update') {
          updateDispatched.resolve();
          await sendOldUpdate.promise;
        } else {
          assert.deepEqual(disk(inkPath), { colors: { '778899': 9 } });
        }
      },
    });
    t.after(sendOldUpdate.resolve);
    doc.setContent({ ...doc.content(), inks: [{ color: '#778899', at: 9 }] });
    const done = doc.flush();
    await updateDispatched.promise;
    await peer.write([inkPatch({ '445566': 8 }, null)]);
    await whenSnapshot(doc, () => colorsOf(doc)['445566'] === 8);
    await peer.write([{ op: 'delete', path: 'board/inks' }]);
    await whenSnapshot(doc, () => !doc.content().inks?.length);
    sendOldUpdate.resolve();
    await done;
    assert.deepEqual(writesFromA, [
      inkPatch({ '778899': 9 }, null),
      { op: 'delete', path: 'board/inks', ifMatch: documentSha256({ colors: { '778899': 9 } }) },
    ]);
    assert.equal(await peer.get('board/inks'), null);
    assert.throws(() => disk('board/inks'), { code: 'ENOENT' });
    assert.equal(doc.getSnapshot().notice?.message, LIVE_MESSAGES.itemGone);
    assert.equal(doc.getSnapshot().pending, 0);
    assert.equal(doc.getSnapshot().flights, 0);
  });
});

describe('stickers on hosts', () => {
  const docs = (): Record<string, Record<string, unknown>> => ({
    'board/meta': { v: 1, title: 'Board', order: ['n1', 's1'] },
    'board/inks': { colors: {} },
    'elements/n1': stored(note('n1', 'host')),
    'elements/s1': { type: 'sticker', x: 100, y: 20, w: 40, h: 40, glyph: '👍', on: ['n1', 0, 0, 100, 20] },
  });
  const stickerX = (doc: LiveBoardDocument): number | undefined => {
    const sticker = doc.content().elements.find((element) => element.id === 's1');
    return sticker?.type === 'sticker' ? sticker.x : undefined;
  };

  it('follows a host someone else moved, then stores where the sticker went', async () => {
    const { transport, timers, doc } = await open(docs());
    assert.equal(stickerX(doc), 100);
    transport.remote({ 'elements/n1': stored(note('n1', 'host', 300)) });
    await timers.advance(0);
    // Shown moved with its host, still stored where it was.
    assert.equal(stickerX(doc), 400);
    assert.equal(transport.docs.get('elements/s1')?.x, 100);
    await timers.advance(5000);
    assert.equal(transport.docs.get('elements/s1')?.x, 400);
    assert.equal(stickerX(doc), 400);
  });

  it('does not store followed stickers from a read-only page', async () => {
    const { transport, timers, doc } = await open(docs(), { readOnly: true });
    transport.remote({ 'elements/n1': stored(note('n1', 'host', 300)) });
    await timers.advance(5000);
    assert.equal(stickerX(doc), 400);
    assert.equal(transport.docs.get('elements/s1')?.x, 100);
  });
});
