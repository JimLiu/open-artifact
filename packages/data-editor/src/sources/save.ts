/** The source editors' saves and tests: a query's arguments, a source's name and description, and a file's rows. */

import {
  DATA_FILE_MIME_TYPES,
  DELETE_FIELD,
  createDeleteFieldPatch,
  getDatasetQuery,
  getQuerySourceKind,
  getUnreferencedBlobId,
  inferDataFileFormat,
  type Dataset,
  type LoadResult,
  type Parameters,
  type QuerySource,
  type UnknownRecord,
} from '@open-artifact/data-core';
import { maybeDataEngine } from '../data/engine.ts';
import { isJointEditing, patchSharedSource, sharedSourceContent } from '../drafts/shared-flow.ts';
import { createMcpToolClient } from '../data/mcp.ts';
import { loadDataset } from '../data/query-store.ts';
import { joinSentences } from '../data/util.ts';
import { deleteAsset, uploadDatasetBlob } from '../platform/assets.ts';
import { getChangedMetadataPatch } from '../platform/metadata.ts';
import { getCurrentViewer } from '../platform/viewer.ts';
import { maybeSession } from '../services/session.ts';
import { useDocument } from '../state/document.ts';
import { LiveWriteError, writeDataset, writeOwnDocument } from '../sync/index.ts';
import { datasetWithEditedArgs, type QueryArguments } from './args.ts';
import { isSharedByMe, reshareAfterSave } from './run-as-actions.ts';
import { waitForDocumentEcho } from './run-as.ts';
import type { SavedDataFile } from './files.ts';
import {
  QUERY_HISTORY_RETENTION_MS,
  appendQueryHistoryEntries,
  parseQueryHistory,
  queryHistoryDocument,
  queryHistoryDocumentName,
  type QueryHistoryRecord,
} from './history.ts';
import {
  FILE_REPLACED_MESSAGE,
  FILE_TOO_LARGE_MESSAGE,
  FILE_UPLOAD_FAILED_MESSAGE,
  QUERY_SAVE_FAILED_MESSAGE,
  SAVE_RETRY_MESSAGE,
  SOURCE_CHANGED_MESSAGE,
  couldNotSaveMessage,
  couldNotSaveSourceMessage,
} from './words.ts';

/** The name and description changes saved with a query (only the fields that changed). */
export interface QueryMetaPatch {
  title?: string;
  description?: string;
}

/** A save that was refused on purpose: its message says why. */
export class QuerySaveRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuerySaveRefusalError';
  }
}

function getStoreErrorMessage(error: unknown): string | null {
  return error instanceof LiveWriteError ? error.message : null;
}

/** What the query editor says when its save fails. */
export function getDraftSaveError(error: unknown): string {
  if (error instanceof QuerySaveRefusalError) return error.message;
  const said = getStoreErrorMessage(error);
  return said === null ? QUERY_SAVE_FAILED_MESSAGE : couldNotSaveMessage(said);
}

/** What the file editor says when its save fails. */
export function getQuerySaveError(error: unknown): string {
  const said = error instanceof QuerySaveRefusalError ? error.message : getStoreErrorMessage(error);
  return said === null ? SAVE_RETRY_MESSAGE : couldNotSaveMessage(said);
}

/** Source `id` as a change is checked against: the shared draft's copy while changes go into the draft. */
function storedDataset(id: string): Dataset | undefined {
  return sharedSourceContent().datasets.find((dataset) => dataset.id === id);
}

/** Writes a source's change: into the shared draft while there is one, else to the artifact itself. */
function writeSource(id: string, patch: UnknownRecord): Promise<void> {
  return isJointEditing() ? patchSharedSource(id, patch) : writeDataset(id, patch);
}

function canWrite(): boolean {
  return useDocument.getState().canWrite;
}

function currentParams(): Parameters {
  return maybeDataEngine()?.params() ?? useDocument.getState().content.params;
}

const previewClient = createMcpToolClient({ mcp: () => maybeSession()?.mcp ?? null });

/** Runs a query with typed arguments, without saving them (the editor's Test). */
export function previewQueryArguments(dataset: Dataset, args: QueryArguments): Promise<LoadResult> {
  const edited = datasetWithEditedArgs(dataset, args, currentParams());
  if (typeof edited === 'string') return Promise.resolve({ ok: false, kind: 'refused', message: edited });
  return loadDataset(
    { client: previewClient },
    { ...edited, ...(dataset.loader === undefined ? {} : { loader: dataset.loader }) },
    () => false,
  );
}

/** This viewer's saved versions of a query, oldest first; `null` when they can't be read now. */
export function readQueryHistory(id: string): QueryHistoryRecord[] | null {
  const state = useDocument.getState();
  if (state.status !== 'ready') return null;
  return parseQueryHistory(state.ownDocuments.get(queryHistoryDocumentName(id)), Date.now());
}

/** Adds versions to a query's history (skipping one that is the same as the last). Never throws. */
export async function appendQueryHistory(id: string, added: readonly QueryHistoryRecord[]): Promise<void> {
  try {
    const stored = readQueryHistory(id);
    if (stored === null) return;
    const next = appendQueryHistoryEntries(stored, added);
    if (next !== null) await writeOwnDocument(queryHistoryDocumentName(id), { ...queryHistoryDocument(next, Date.now()) });
  } catch {
    // The history is a convenience; a save goes through without it.
  }
}

function editStamp(at: number): { at: string; by: string } {
  return { at: new Date(at).toISOString(), by: getCurrentViewer()?.name ?? '' };
}

/**
 * Saves a query's typed arguments, with the name and description changes typed beside them. Refuses when the stored
 * arguments changed since the editor opened (`base`), and records both versions in this viewer's history.
 */
export async function saveQueryArguments(dataset: Dataset, base: string, args: QueryArguments, meta?: QueryMetaPatch): Promise<void> {
  const readStored = (): { stored: Dataset; call: QuerySource } => {
    const stored = storedDataset(dataset.id);
    const call = stored === undefined ? undefined : getDatasetQuery(stored);
    if (!canWrite() || stored === undefined || call === undefined || (call.template ?? call.args) !== base)
      throw new QuerySaveRefusalError(QUERY_SAVE_FAILED_MESSAGE);
    return { stored, call };
  };
  const { stored, call } = readStored();
  const edited = datasetWithEditedArgs(stored, args, currentParams());
  if (typeof edited === 'string') throw new QuerySaveRefusalError(edited);
  const savedAt = Date.now();
  const previousAt =
    stored.updated !== null && stored.updated.at > savedAt - QUERY_HISTORY_RETENTION_MS ? stored.updated.at : savedAt - 1;
  const callMark: { call?: true } = call.call === true ? { call: true } : {};
  const rules = call.rules ?? (call.rulesRefused === true ? call.refusedRules : undefined);
  const source = {
    kind: getQuerySourceKind(call),
    connector: call.connector,
    tool: call.tool,
    args: createDeleteFieldPatch(JSON.parse(base) as unknown, args),
    ...(rules === undefined ? {} : { rules }),
  };
  await appendQueryHistory(stored.id, [
    { at: previousAt, args: base, ...callMark },
    { at: savedAt, args: JSON.stringify(args), ...callMark },
  ]);
  readStored();
  const metaPatch = meta === undefined ? {} : getChangedMetadataPatch(meta, stored);
  const before = useDocument.getState().content;
  const joint = isJointEditing();
  await writeSource(dataset.id, { ...metaPatch, source, updated: editStamp(savedAt) });
  // A connector this viewer shares is shared again for the saved call, once the document has it (a change to the
  // shared draft goes live only when the draft is published).
  if (!joint && isSharedByMe(call.connector)) {
    await waitForDocumentEcho(before);
    await reshareAfterSave(call.connector);
  }
}

/** Saves a source's name and description. Resolves with why it couldn't, or `null` once saved. */
export async function saveSourceMetadata(dataset: Dataset, patch: QueryMetaPatch): Promise<string | null> {
  let failure: string | null;
  try {
    const stored = storedDataset(dataset.id);
    if (!canWrite() || stored === undefined) failure = SOURCE_CHANGED_MESSAGE;
    else {
      const changed = getChangedMetadataPatch(patch, stored);
      if (Object.keys(changed).length > 0) await writeSource(dataset.id, { ...changed, updated: editStamp(Date.now()) });
      failure = null;
    }
  } catch (error) {
    failure = getStoreErrorMessage(error) ?? SAVE_RETRY_MESSAGE;
  }
  return failure === null ? null : joinSentences(couldNotSaveSourceMessage(dataset.title || dataset.id), failure);
}

function isFileUnchanged(id: string, url: string): boolean {
  const stored = storedDataset(id);
  return canWrite() && stored !== undefined && stored.source.kind === 'file' && stored.source.url === url;
}

function deleteUnreferencedBlob(blob: string, datasetId: string): void {
  const state = useDocument.getState();
  if (state.status !== 'ready' || !state.canWrite || state.save === 'failed') return;
  const unreferenced = getUnreferencedBlobId(state.content, blob, datasetId);
  if (unreferenced !== null) void deleteAsset(unreferenced);
}

/**
 * Saves a file source's new rows: uploads them as a new file and points the source at it. Refuses when someone
 * replaced the file meanwhile. The old file stays (the version history may still show it).
 */
export async function saveDataFile(dataset: Dataset, url: string, file: SavedDataFile): Promise<void> {
  if (!isFileUnchanged(dataset.id, url)) throw new QuerySaveRefusalError(FILE_REPLACED_MESSAGE);
  const uploaded = await uploadDatasetBlob(new Blob([file.body], { type: DATA_FILE_MIME_TYPES[file.format] }), file.name);
  if ('refused' in uploaded)
    throw new QuerySaveRefusalError(uploaded.refused === 'too_large' ? FILE_TOO_LARGE_MESSAGE : FILE_UPLOAD_FAILED_MESSAGE);
  if (!isFileUnchanged(dataset.id, url)) {
    deleteUnreferencedBlob(uploaded.ref, dataset.id);
    throw new QuerySaveRefusalError(FILE_REPLACED_MESSAGE);
  }
  const format = inferDataFileFormat(file.name) === file.format ? DELETE_FIELD : file.format;
  try {
    await writeSource(dataset.id, {
      source: { kind: 'file', url: uploaded.ref, name: file.name, format },
      updated: editStamp(Date.now()),
    });
  } catch (error) {
    if (getStoreErrorMessage(error) !== null) deleteUnreferencedBlob(uploaded.ref, dataset.id);
    throw error;
  }
}
