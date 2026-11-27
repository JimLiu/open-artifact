/**
 * The `drafts` collection: every draft head (`drafts/<id>`) and the
 * documents of the draft being followed (`drafts/<id>/{datasets,dash,files}`).
 *
 * The shared draft (`drafts/shared`) is followed by itself as well, since
 * a remix can be open over it.
 *
 * Drafts are not part of the live dashboard, so they are read and written
 * through the session's store directly. The host does not echo this page's
 * own writes, so each write updates the state here as well.
 */

import { create } from 'zustand';
import type { DbCapability, DbDocument, JsonRecord } from '@open-artifact/runtime';
import {
  DASH_PARAMS_PATH,
  DRAFT_COLLECTIONS,
  SHARED_DRAFT_ID,
  draftDocsBytes,
  hasSharedChanges,
  pastDraftsToDrop,
  restoreClashes,
  restoreWrites,
  settledDocs,
  withoutCopies,
  type PastDraftHead,
  type SharedDraftHead,
  DRAFTS_COLLECTION,
  draftDocumentPath,
  draftHasPage,
  draftHeadPath,
  parseDataPath,
  parseDraftHead,
  toDraftHeadRecord,
  type DraftDocs,
  type DraftHead,
  type UnknownRecord,
} from '@open-artifact/data-core';
import { maybeSession } from '../services/session.ts';

export interface DraftsState {
  /** Every draft head, parsed (unreadable ones left out). */
  heads: DraftHead[];
  /** The heads were listed at least once. */
  loaded: boolean;
  /** The draft whose documents are followed. */
  id: string | null;
  /** Its documents by path under `drafts/<id>/` (`files/index.html`, `datasets/sales`, `dash/params`). */
  docs: DraftDocs;
  /** Its documents were listed at least once. */
  heard: boolean;
  /** The shared draft's documents, while it is followed. */
  shared: DraftDocs;
  /** The shared draft's documents were listed at least once. */
  sharedHeard: boolean;
}

const EMPTY_DOCS: DraftDocs = new Map();

const INITIAL: DraftsState = { heads: [], loaded: false, id: null, docs: EMPTY_DOCS, heard: false, shared: EMPTY_DOCS, sharedHeard: false };

export const useDrafts = create<DraftsState>()(() => ({ ...INITIAL }));

/** Waits between failed listings, ms. */
export const DRAFTS_RETRY_MS: readonly number[] = [2000, 4000, 8000, 15000, 30000];

function db(): DbCapability | null {
  return maybeSession()?.db ?? null;
}

function draftPrefix(id: string): string {
  return `${DRAFTS_COLLECTION}/${id}/`;
}

function sortHeads(heads: DraftHead[]): DraftHead[] {
  return heads.sort((left, right) => left.at - right.at || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function headsFrom(documents: readonly DbDocument[]): DraftHead[] {
  return sortHeads(
    documents.flatMap((document) => {
      const parsed = parseDataPath(document.path);
      if (parsed?.kind !== 'draft') return [];
      const head = parseDraftHead(parsed.draftId, document.data);
      return head === null ? [] : [head];
    }),
  );
}

/** Puts a head in the listing (`null`: takes it out); for writes the host does not echo. */
export function putHead(head: DraftHead | null, id: string): void {
  const heads = useDrafts.getState().heads.filter((item) => item.id !== id);
  useDrafts.setState({ heads: sortHeads(head === null ? heads : [...heads, head]) });
}

async function listDraftDocs(store: DbCapability, id: string): Promise<DraftDocs> {
  const prefix = draftPrefix(id);
  const lists = await Promise.all(DRAFT_COLLECTIONS.map((collection) => store.list(prefix + collection)));
  const docs: DraftDocs = new Map();
  for (const document of lists.flat()) {
    if (document.path.startsWith(prefix)) docs.set(document.path.slice(prefix.length), document.data as UnknownRecord);
  }
  return docs;
}

let followRequest = 0;

/** Follows the documents of draft `id` (`null`: none). */
export function followDraft(id: string | null): void {
  if (useDrafts.getState().id === id) return;
  const request = ++followRequest;
  useDrafts.setState({ id, docs: EMPTY_DOCS, heard: false });
  const store = db();
  if (id === null || store === null) return;
  let attempt = 0;
  const load = (): void => {
    listDraftDocs(store, id).then(
      (docs) => {
        if (request === followRequest) useDrafts.setState({ docs, heard: true });
      },
      () => {
        if (request !== followRequest) return;
        setTimeout(load, DRAFTS_RETRY_MS[Math.min(attempt++, DRAFTS_RETRY_MS.length - 1)]);
      },
    );
  };
  load();
}

/** Reads draft `id`'s documents fresh; `null` when they could not be read. */
export async function readDraft(id: string): Promise<DraftDocs | null> {
  const store = db();
  if (store === null) return null;
  try {
    return await listDraftDocs(store, id);
  } catch {
    return null;
  }
}

/** Writes a new draft head; false when the store refused it. */
export async function beginDraft(head: DraftHead): Promise<boolean> {
  const store = db();
  if (store === null) return false;
  try {
    await store.write([{ op: 'set', path: draftHeadPath(head.id), data: toDraftHeadRecord(head) as unknown as JsonRecord, ifMatch: null }]);
    putHead(head, head.id);
    return true;
  } catch {
    return false;
  }
}

/** Marks draft `id` saved, so every page stops offering it. */
export async function markDraftSaved(id: string): Promise<boolean> {
  const store = db();
  if (store === null) return false;
  try {
    await store.write([{ op: 'update', path: draftHeadPath(id), patch: { saved: true } }]);
    const head = useDrafts.getState().heads.find((item) => item.id === id);
    if (head !== undefined) putHead({ ...head, saved: true }, id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes drafts: each head and its documents, in one batch. With `bareOnly`,
 * a draft that has a page is kept (and the result is false). True when every
 * draft is gone.
 */
export async function dropDrafts(ids: readonly string[], bareOnly = false): Promise<boolean> {
  const store = db();
  if (store === null || ids.length === 0) return ids.length === 0;
  try {
    const found = await Promise.all(ids.map(async (id) => [id, await listDraftDocs(store, id)] as const));
    const dropped = found.filter(([, docs]) => !bareOnly || !draftHasPage(docs));
    if (dropped.length > 0) {
      await store.write(
        dropped.flatMap(([id, docs]) => [
          ...[...docs.keys()].map((path) => ({ op: 'delete' as const, path: draftDocumentPath(id, path) })),
          { op: 'delete' as const, path: draftHeadPath(id) },
        ]),
      );
      const gone = new Set(dropped.map(([id]) => id));
      useDrafts.setState((state) => ({
        heads: state.heads.filter((head) => !gone.has(head.id)),
        ...(state.id !== null && gone.has(state.id) ? { docs: EMPTY_DOCS } : {}),
      }));
    }
    return dropped.length === ids.length;
  } catch {
    return false;
  }
}

/** Lists the heads and follows changes to drafts. Returns a stop function. */
export function startDrafts(): () => void {
  const store = db();
  if (store === null) return () => {};
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const list = (): void => {
    store.list(DRAFTS_COLLECTION).then(
      (documents) => {
        if (!stopped) useDrafts.setState({ heads: headsFrom(documents), loaded: true });
      },
      () => {
        if (!stopped) timer = setTimeout(list, DRAFTS_RETRY_MS[Math.min(attempt++, DRAFTS_RETRY_MS.length - 1)]);
      },
    );
  };
  list();
  const off = store.onChange(({ changes }) => {
    let docs: DraftDocs | null = null;
    let shared: DraftDocs | null = null;
    const { id } = useDrafts.getState();
    for (const [path, data] of Object.entries(changes)) {
      const parsed = parseDataPath(path);
      if (parsed?.kind === 'draft') putHead(data === null ? null : parseDraftHead(parsed.draftId, data), parsed.draftId);
      else if (parsed?.kind === 'draft-document' && parsed.draftId === id) {
        docs ??= new Map(useDrafts.getState().docs);
        if (data === null) docs.delete(parsed.path);
        else docs.set(parsed.path, data as UnknownRecord);
      }
      if (parsed?.kind === 'draft-document' && parsed.draftId === SHARED_DRAFT_ID && following) {
        shared ??= new Map(useDrafts.getState().shared);
        if (data === null) shared.delete(parsed.path);
        else shared.set(parsed.path, data as UnknownRecord);
      }
    }
    if (docs !== null) useDrafts.setState({ docs });
    if (shared !== null) useDrafts.setState({ shared });
  });
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    off();
    followRequest++;
    sharedRequest++;
    useDrafts.setState({ ...INITIAL });
  };
}

/** `data` stamped as `by`'s edit at `at`. */
export function stampEdit(data: UnknownRecord, by: string, at: number): UnknownRecord {
  const edit = typeof data.edit === 'object' && data.edit !== null && !Array.isArray(data.edit) ? (data.edit as UnknownRecord) : {};
  return { ...data, edit: { ...edit, by, byAt: at } };
}

let following = false;
let sharedRequest = 0;

/** Follows the shared draft's documents (`false`: stops). */
export function followSharedDraft(on: boolean): void {
  if (following === on) return;
  following = on;
  const request = ++sharedRequest;
  useDrafts.setState({ shared: EMPTY_DOCS, sharedHeard: false });
  const store = db();
  if (!on || store === null) return;
  let attempt = 0;
  const load = (): void => {
    listDraftDocs(store, SHARED_DRAFT_ID).then(
      (shared) => {
        if (request === sharedRequest) useDrafts.setState({ shared, sharedHeard: true });
      },
      () => {
        if (request === sharedRequest) setTimeout(load, DRAFTS_RETRY_MS[Math.min(attempt++, DRAFTS_RETRY_MS.length - 1)]);
      },
    );
  };
  load();
}

function setSharedDoc(path: string, data: UnknownRecord | null): void {
  const shared = new Map(useDrafts.getState().shared);
  if (data === null) shared.delete(path);
  else shared.set(path, data);
  useDrafts.setState({ shared });
}

/** A JSON merge patch (RFC 7396) applied to a record. */
function mergePatch(base: UnknownRecord, patch: UnknownRecord): UnknownRecord {
  const merged: UnknownRecord = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else if (typeof value === 'object' && !Array.isArray(value)) {
      const current = merged[key];
      merged[key] = mergePatch(typeof current === 'object' && current !== null && !Array.isArray(current) ? (current as UnknownRecord) : {}, value as UnknownRecord);
    } else merged[key] = value;
  }
  return merged;
}

/** Merges `patch` into head `id` (RFC 7396: `null` removes a field); false when the store refused it. */
export async function patchDraftHead(id: string, patch: UnknownRecord): Promise<boolean> {
  const store = db();
  if (store === null) return false;
  try {
    await store.write([{ op: 'update', path: draftHeadPath(id), patch: patch as JsonRecord }]);
    const head = useDrafts.getState().heads.find((item) => item.id === id);
    if (head !== undefined) putHead(parseDraftHead(id, mergePatch(toDraftHeadRecord(head) as unknown as UnknownRecord, patch)), id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts the shared draft when there is none. True when one is open for this artifact (made here or found), false
 * when it could not be made.
 */
export async function beginSharedDraft(head: SharedDraftHead): Promise<boolean> {
  const store = db();
  if (store === null) return false;
  const found = (): DraftHead | undefined => useDrafts.getState().heads.find((item) => item.id === SHARED_DRAFT_ID);
  try {
    await store.write([{ op: 'set', path: draftHeadPath(head.id), data: toDraftHeadRecord(head) as unknown as JsonRecord, ifMatch: null }]);
    putHead(head, head.id);
    return true;
  } catch {
    try {
      useDrafts.setState({ heads: headsFrom(await store.list(DRAFTS_COLLECTION)) });
    } catch {
      return false;
    }
    const now = found();
    return now?.kind === 'edit' && now.saved !== true && now.artifact === head.artifact;
  }
}

/** Reads one of the shared draft's documents fresh (`null`: there is none). */
export async function readSharedDoc(path: string): Promise<UnknownRecord | null> {
  const store = db();
  if (store === null) throw Object.assign(new Error('no store'), { code: 'unavailable' });
  return ((await store.get(draftDocumentPath(SHARED_DRAFT_ID, path))) as UnknownRecord | null) ?? null;
}

/** Writes one of the shared draft's documents (`null`: deletes it). */
export async function putSharedDoc(path: string, data: UnknownRecord | null): Promise<void> {
  const store = db();
  if (store === null) throw Object.assign(new Error('no store'), { code: 'unavailable' });
  const target = draftDocumentPath(SHARED_DRAFT_ID, path);
  await store.write([data === null ? { op: 'delete', path: target } : { op: 'set', path: target, data: data as JsonRecord }]);
  setSharedDoc(path, data);
}

/** Writes several of the shared draft's documents in one batch. */
export async function putSharedDocs(entries: readonly (readonly [string, UnknownRecord | null])[]): Promise<void> {
  const store = db();
  if (store === null) throw Object.assign(new Error('no store'), { code: 'unavailable' });
  if (entries.length === 0) return;
  await store.write(
    entries.map(([path, data]) =>
      data === null
        ? { op: 'delete' as const, path: draftDocumentPath(SHARED_DRAFT_ID, path) }
        : { op: 'set' as const, path: draftDocumentPath(SHARED_DRAFT_ID, path), data: data as JsonRecord },
    ),
  );
  for (const [path, data] of entries) setSharedDoc(path, data);
}

/** What settling the shared draft did: whether someone's changes were left in it, and the past head kept. */
export interface SettledDraft {
  left: boolean;
  past: PastDraftHead | null;
}

/**
 * Publishes or discards the shared draft as `shown`: takes those documents out of it (a discard first keeps them
 * under the past head's id), resets the head when nothing is left, and keeps a past head for History. `null` when
 * the draft could not be read or changed.
 */
export async function settleSharedDraft(
  shown: DraftDocs,
  settle: { id: string; what: 'saved' | 'discarded'; by: string },
  options: { base?: string; quiet?: boolean } = {},
): Promise<SettledDraft | null> {
  const store = db();
  if (store === null) return null;
  const stored = await readDraft(SHARED_DRAFT_ID);
  if (stored === null) return null;
  const taken = settledDocs(stored, shown);
  const head = useDrafts.getState().heads.find((item): item is SharedDraftHead => item.id === SHARED_DRAFT_ID && item.kind === 'edit');
  try {
    if (settle.what === 'discarded' && taken.length > 0)
      await store.write(taken.map(([path, data]) => ({ op: 'set' as const, path: draftDocumentPath(settle.id, path), data: data as JsonRecord })));
    if (taken.length > 0) {
      await store.write(taken.map(([path]) => ({ op: 'delete' as const, path: draftDocumentPath(SHARED_DRAFT_ID, path) })));
      for (const [path] of taken) setSharedDoc(path, null);
    }
  } catch {
    return null;
  }
  const left = hasSharedChanges(new Map([...stored].filter(([path]) => !taken.some(([gone]) => gone === path))));
  const editors = head?.editors ?? [];
  await patchDraftHead(
    SHARED_DRAFT_ID,
    left
      ? options.base === undefined
        ? {}
        : { base: options.base }
      : { base: '', agent: null, held: null, changed: null, editors: editors.length === 0 ? null : Object.fromEntries(editors.map((editor) => [editor, null])) },
  );
  const changes = withoutCopies(new Map(taken));
  if (changes.size === 0 || options.quiet === true) return { left, past: null };
  const past: PastDraftHead = {
    id: settle.id,
    kind: 'past',
    what: settle.what,
    by: settle.by,
    at: Date.now(),
    ...(head?.artifact === undefined ? {} : { artifact: head.artifact }),
    base: head?.base ?? '',
    ...(editors.length > 0 ? { editors } : {}),
    ...(head?.agent === true ? { agent: true as const } : {}),
    ...(left ? { left: true as const } : {}),
    bytes: settle.what === 'saved' ? 0 : draftDocsBytes(changes.values()),
  };
  try {
    await store.write([{ op: 'set', path: draftHeadPath(past.id), data: toDraftHeadRecord(past) as unknown as JsonRecord }]);
    putHead(past, past.id);
  } catch {
    return { left, past: null };
  }
  const pasts = useDrafts.getState().heads.filter((item): item is PastDraftHead => item.kind === 'past');
  const drop = pastDraftsToDrop(pasts, past);
  if (drop.length > 0) void dropDrafts(drop.map((item) => item.id));
  return { left, past };
}

/** What restoring a past draft did. */
export type RestoreOutcome = 'done' | 'gone' | 'clash' | null;

/**
 * Puts a discarded draft back into the shared one. `clash` when the shared draft has changes to the same documents
 * (unless `force`), `gone` when nothing of it is left; `null` when it failed. `liveBase` is the dashboard's hash now;
 * the documents put back are stamped as `by`'s edit.
 */
export async function restorePastDraft(past: PastDraftHead, liveBase: string, force: boolean, by: string): Promise<RestoreOutcome> {
  const store = db();
  if (store === null) return null;
  const [kept, shared] = await Promise.all([readDraft(past.id), readDraft(SHARED_DRAFT_ID)]);
  if (kept === null || shared === null) return null;
  if (kept.size === 0) {
    void dropDrafts([past.id]);
    return 'gone';
  }
  if (!force && restoreClashes(shared, kept)) return 'clash';
  const writes = restoreWrites(shared, kept);
  const empty = !hasSharedChanges(shared);
  const head = useDrafts.getState().heads.find((item) => item.id === SHARED_DRAFT_ID);
  const rebase = empty || (head !== undefined && head.base !== '' && head.base !== liveBase);
  const editors = past.editors ?? [];
  const now = Date.now();
  if (
    !(await patchDraftHead(SHARED_DRAFT_ID, {
      ...(rebase ? { base: past.base } : {}),
      held: true,
      ...(editors.length > 0 ? { editors: Object.fromEntries(editors.map((editor) => [editor, true])) } : {}),
      ...(past.agent === true ? { agent: true } : {}),
      ...(writes.length > 0 ? { changed: now } : {}),
    }))
  )
    return null;
  try {
    await putSharedDocs(writes.map(([path, data]) => [path, path === DASH_PARAMS_PATH ? data : stampEdit(data, by, now)]));
  } catch {
    if (empty) void patchDraftHead(SHARED_DRAFT_ID, { base: '', held: null, agent: null });
    return null;
  }
  void dropDrafts([past.id]);
  return 'done';
}
