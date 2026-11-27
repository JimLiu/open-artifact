/**
 * The shared draft (`drafts/shared`): while it is on, every editor's and
 * the agent's changes gather there, and nothing changes for viewers until
 * someone publishes it. Published or discarded drafts stay listed in
 * History as past heads (`drafts/<id>`, kind `past`), a discarded one with
 * its documents so it can be restored.
 *
 * Pure helpers for the flow: what counts as a change, the publish plan,
 * the page files shown, which past drafts to keep, restoring and the three
 * cases where the draft is not published by itself.
 */

import { stableStringify } from '@open-artifact/live-store/json';
import type { DashboardContent, DashboardFile, UnknownRecord } from './types.ts';
import type { DocumentWritePlan } from './versions.ts';
import { parseDataset } from './model.ts';
import {
  DASHBOARD_ENTRY_PATH,
  DASH_PARAMS_PATH,
  DATASETS_COLLECTION,
  DRAFT_COLLECTIONS,
  FILES_COLLECTION,
  filePath,
  getCollectionPath,
  getDocumentId,
  isDraftDocumentPath,
} from './paths.ts';
import { compareDraftKeys, draftSourceKey, draftText, draftTextHash, type DraftDocs, type PastDraftHead } from './drafts.ts';

/** The shared draft's id. */
export const SHARED_DRAFT_ID = 'shared';
/** How many past drafts of each kind are kept. */
export const PAST_DRAFTS_KEPT = { saved: 5, discarded: 20 } as const;
/** Discarded drafts past this many stored bytes in all are let go, newest kept first. */
export const PAST_DRAFT_BYTES = 10_000_000;

const sameJson = (left: unknown, right: unknown): boolean => stableStringify(left) === stableStringify(right);

/**
 * A page file copied into the draft when the agent's turn starts, so the agent edits the draft's copy: its text and
 * a hash of it. A copy nobody changed is not a change.
 */
export function draftFileCopy(text: string): UnknownRecord {
  return { text, copy: draftTextHash(text) };
}

/** A copied page file whose text is still what was copied. */
export function isUntouchedCopy(data: UnknownRecord): boolean {
  return typeof data.copy === 'string' && data.copy === draftTextHash(draftText(data.text));
}

/** The draft's documents without untouched copies (the same map when there are none). */
export function withoutCopies(docs: DraftDocs): DraftDocs {
  const kept = [...docs].filter(([, data]) => !isUntouchedCopy(data));
  return kept.length === docs.size ? docs : new Map(kept);
}

/** The shared draft holds a change: a dashboard document that is not an untouched copy. */
export function hasSharedChanges(docs: DraftDocs): boolean {
  return [...docs].some(([path, data]) => isDraftDocumentPath(path) && !isUntouchedCopy(data));
}

/** A copy in the draft whose page file changed live since it was copied (the draft would undo that change). */
export function hasStaleCopies(docs: DraftDocs, files: readonly DashboardFile[]): boolean {
  return files.some(({ name, text }) => {
    const copy = docs.get(filePath(name));
    return copy !== undefined && typeof copy.copy === 'string' && draftText(copy.text) !== text && copy.copy !== draftTextHash(text);
  });
}

/** The live page files the agent's turn should copy into the draft: missing there, or an untouched copy gone stale. */
export function filesToCopy(docs: DraftDocs, files: readonly DashboardFile[]): DashboardFile[] {
  return files.filter(({ name, text }) => {
    const data = docs.get(filePath(name));
    return data === undefined || (draftText(data.text) !== text && isUntouchedCopy(data));
  });
}

/** The page files shown with the shared draft: the live ones, each replaced or joined by the draft's, by name. */
export function mergeDraftFiles(live: readonly DashboardFile[], draft: readonly DashboardFile[]): DashboardFile[] {
  return [...new Map([...live, ...draft].map((file) => [file.name, file])).values()].sort((left, right) =>
    compareDraftKeys(left.name, right.name),
  );
}

/** Draft documents in write order: datasets, then `dash`, then page files, the entry page last. */
export function orderDraftWrites<T>(entries: readonly (readonly [string, T])[]): [string, T][] {
  const rank = (path: string): number => DRAFT_COLLECTIONS.indexOf(getCollectionPath(path));
  const last = (path: string): number => Number(path === DASHBOARD_ENTRY_PATH);
  return entries
    .map(([path, data]): [string, T] => [path, data])
    .sort(([left], [right]) => last(left) - last(right) || rank(left) - rank(right) || compareDraftKeys(left, right));
}

/**
 * Publishing the shared draft: its documents written over the dashboard's (copies stripped of their hash, datasets
 * that don't read left out). Nothing is removed: a page file the draft lacks stays as it is.
 */
export function planSharedPublish(docs: DraftDocs): DocumentWritePlan {
  const write = [...withoutCopies(docs)].flatMap(([path, data]): [string, UnknownRecord][] => {
    if (!isDraftDocumentPath(path)) return [];
    const collection = getCollectionPath(path);
    if (collection === DATASETS_COLLECTION && parseDataset(getDocumentId(path), data) === null) return [];
    if (collection !== FILES_COLLECTION) return [[path, data]];
    const { copy: _copy, ...rest } = data;
    return [[path, rest]];
  });
  return { write: orderDraftWrites(write), remove: [] };
}

/** The documents to take out of the shared draft when it is settled: those still as they were shown. */
export function settledDocs(stored: DraftDocs, shown: DraftDocs): [string, UnknownRecord][] {
  return [...stored].filter(([path, data]) => shown.has(path) && sameJson(shown.get(path), data));
}

/**
 * Past drafts to let go once `added` is kept: past the count for each kind, the bytes for discarded ones, and any
 * left from another artifact (a copy's). One without an artifact is kept beside one with.
 */
export function pastDraftsToDrop(past: readonly PastDraftHead[], added: PastDraftHead): PastDraftHead[] {
  const counts = { saved: 0, discarded: 0, [added.what]: 1 };
  let bytes = added.bytes;
  return [...past]
    .sort((left, right) => right.at - left.at || compareDraftKeys(left.id, right.id))
    .filter((head) => {
      if (head.id === added.id) return false;
      if (head.artifact !== added.artifact) return head.artifact !== undefined && added.artifact !== undefined;
      bytes += head.bytes;
      return ++counts[head.what] > PAST_DRAFTS_KEPT[head.what] || (head.what === 'discarded' && bytes > PAST_DRAFT_BYTES);
    });
}

/** A document without its edit stamp (filters keep theirs, they have none worth comparing). */
function unstamped(path: string, data: UnknownRecord | undefined): unknown {
  if (data === undefined || path === DASH_PARAMS_PATH) return data;
  const { edit: _edit, ...rest } = data;
  return rest;
}

/** What restoring a past draft into the shared one writes: the past documents that differ, in write order. */
export function restoreWrites(shared: DraftDocs, past: DraftDocs): [string, UnknownRecord][] {
  const now = withoutCopies(shared);
  return orderDraftWrites([...past].filter(([path, data]) => !sameJson(unstamped(path, now.get(path)), unstamped(path, data))));
}

/** Restoring would replace changes the shared draft holds now. */
export function restoreClashes(shared: DraftDocs, past: DraftDocs): boolean {
  const now = withoutCopies(shared);
  return restoreWrites(shared, past).some(([path]) => now.has(path));
}

/**
 * The draft's documents changed from `before` in a way someone made: a document differs, and it is not only a new
 * edit stamp.
 */
export function draftDocsMoved(before: DraftDocs, after: DraftDocs): boolean {
  return [...after].some(
    ([path, data]) => !sameJson(before.get(path), data) && (typeof data.edit !== 'object' || sameJson(data.edit, before.get(path)?.edit)),
  );
}

/** What the change check compares, by store path. */
function comparable(content: Pick<DashboardContent, 'params' | 'datasets' | 'files'>): Map<string, string> {
  return new Map([
    [DASH_PARAMS_PATH, stableStringify(content.params)],
    ...content.datasets.map((dataset): [string, string] => [`${DATASETS_COLLECTION}/${dataset.id}`, stableStringify([dataset.title, draftSourceKey(dataset)])]),
    ...content.files.map((file): [string, string] => [filePath(file.name), file.text]),
  ]);
}

/**
 * The dashboard went from `before` to `after` only by taking what the draft holds (a publish, or the agent writing
 * the same live): every part that changed now equals the draft's.
 */
export function changedOnlyByDraft(
  before: DashboardContent,
  after: DashboardContent,
  draft: Pick<DashboardContent, 'params' | 'datasets' | 'files'>,
  docs: DraftDocs,
): boolean {
  const [was, now, held] = [comparable(before), comparable(after), comparable(draft)];
  return [...was.keys(), ...now.keys()].every((path) => was.get(path) === now.get(path) || (docs.has(path) && now.get(path) === held.get(path)));
}

/** Why a ready shared draft is not published by itself after the agent's turn, or `null` when it is. */
export type AutoPublishBlock = 'off' | 'others' | 'changed';

/**
 * Whether the shared draft goes live by itself: auto-publish is on, nobody but the viewer changed it, and the
 * dashboard did not change after the draft began.
 */
export function autoPublishBlock(input: { autoPublish: boolean; others: readonly string[]; changedSince: boolean }): AutoPublishBlock | null {
  if (!input.autoPublish) return 'off';
  if (input.changedSince) return 'changed';
  return input.others.length > 0 ? 'others' : null;
}

/** The size of documents as stored, roughly: their JSON in UTF-8 bytes. */
export function draftDocsBytes(docs: Iterable<UnknownRecord>): number {
  let bytes = 0;
  for (const data of docs) bytes += new TextEncoder().encode(JSON.stringify(data)).length;
  return bytes;
}
