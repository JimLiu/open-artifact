import type { FileCursor, LoadOutcome } from './requests.ts';
import type { WorkbookStore } from './workbook-node.ts';
import type { Json } from '@open-artifact/runtime/sheet-api';

/** A page of a load, as the engine takes it (`receiveLoadPage`): `next` is where the next page starts. */
export interface LoadPage {
  revision: number;
  v: number;
  ops: Json[];
  next: number | null;
}

export type LoadPageOutcome = LoadPage | 'pageOutOfDate' | 'calledOff' | { busyForMs: number } | null;

const OPS_PER_PAGE = 8;
/** As the reference page: the page runs between pages every 64 operations (each eighth page). */
const OPS_BEFORE_YIELDING = 64;

/**
 * Loads the workbook's operations in one call and hands them to the engine a few at a time, letting the page run
 * between pages. A load dropped meanwhile (an edit was sent) is called off.
 */
export function createPagedLoader({
  store,
  isWanted,
  noteLoaded,
  letOthersRun,
}: {
  store: Pick<WorkbookStore, 'loadOps'>;
  isWanted: () => boolean;
  noteLoaded: () => void;
  letOthersRun: () => Promise<void>;
}) {
  let loaded: { revision: number; v: number; ops: Json[] } | null = null;
  let loadCount = 0;
  const pageOf = (start: number, { revision, v, ops }: { revision: number; v: number; ops: Json[] }): LoadPage => {
    const end = start + OPS_PER_PAGE;
    const next = end < ops.length ? end : null;
    if (next === null) loaded = null;
    return { revision, v, ops: ops.slice(start, end), next };
  };
  return {
    async loadPage(start: number): Promise<LoadPageOutcome> {
      const loadAtStart = loadCount;
      if (start > 0) {
        if (loaded === null) throw Error('a later page of a load with no operations');
        if (start % OPS_BEFORE_YIELDING === 0) await letOthersRun();
        return loadCount === loadAtStart && loaded !== null ? pageOf(start, loaded) : 'calledOff';
      }
      loaded = null;
      const outcome: LoadOutcome = await store.loadOps();
      if (outcome === null || outcome === 'pageOutOfDate' || 'busyForMs' in outcome) return outcome;
      noteLoaded();
      if (loadCount !== loadAtStart || !isWanted()) return 'calledOff';
      loaded = outcome;
      return pageOf(0, outcome);
    },
    drop(): void {
      loadCount += 1;
      loaded = null;
    },
  };
}

/** A table read at most this many times. */
export const MOST_TABLE_FILE_TRIES = 6;

export function decodeBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

/** A connected table's file is gzipped lines. */
export async function unpackLines(parts: readonly Uint8Array<ArrayBuffer>[]): Promise<string | null> {
  try {
    const stream = new Blob([...parts]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  } catch {
    return null;
  }
}

/** A page of lines ends at the end of the first line past 256 KB. */
export function linesPageEnd(start: number, lines: string): number | null {
  const end = lines.indexOf('\n', start + 262144) + 1;
  return end > 0 && end < lines.length ? end : null;
}

/** Where a read of a table's file stands. */
interface TableFileRead {
  after: FileCursor | null;
  parts: Uint8Array<ArrayBuffer>[];
  retryCount: number;
  startCount: number;
}

export const tableFileReadFrom = (startCount: number): TableFileRead => ({
  after: null,
  parts: [],
  retryCount: startCount - 1,
  startCount,
});

/** What the loader of the connected tables' files is given. */
export interface TableFiles {
  store: Pick<WorkbookStore, 'loadSliceOfTableFile'>;
  /** The snapshot ids of the files the workbook wants. */
  wanted(): string[];
  /** Hands a page of lines to the engine: `'read'`, or `'unreadable'`. */
  handOver(snapshotId: string, lines: string, isLast: boolean): 'read' | 'unreadable';
  giveUp(snapshotId: string): void;
  waitToRetry(tries: number, busyForMs: number): Promise<void>;
  letOthersRun(): Promise<void>;
  reportFault(fault: 'tableFileNotRead'): void;
}

/**
 * Reads the files of the connected tables the workbook wants (snapshot ids), one table at a time, and hands each
 * over in pages of lines. A table is tried {@link MOST_TABLE_FILE_TRIES} times at most.
 */
export function createTableFileLoader(files: TableFiles): () => void {
  const isWanted = (snapshotId: string): boolean => files.wanted().includes(snapshotId);
  async function readFile(snapshotId: string, { after, parts, retryCount, startCount }: TableFileRead): Promise<{ lines: string } | 'none' | 'calledOff'> {
    if (!isWanted(snapshotId)) return 'calledOff';
    const slice = await files.store.loadSliceOfTableFile(snapshotId, after);
    if (slice === 'isGone') return 'none';
    if (slice === 'startOver') {
      if (startCount === MOST_TABLE_FILE_TRIES) return 'none';
      await files.waitToRetry(startCount, 0);
      return readFile(snapshotId, tableFileReadFrom(startCount + 1));
    }
    if (slice === null || 'busyForMs' in slice) {
      await files.waitToRetry(retryCount, slice?.busyForMs ?? 0);
      return readFile(snapshotId, { after, parts, retryCount: retryCount + 1, startCount });
    }
    const bytes = decodeBase64ToBytes(slice.base64);
    if (bytes !== null) parts.push(bytes);
    if (bytes !== null && slice.byteCountHeld < slice.byteCountOfBody) {
      const cursor: FileCursor = { bodyName: slice.bodyName, byteCountHeld: slice.byteCountHeld };
      return readFile(snapshotId, { after: cursor, parts, retryCount: 0, startCount });
    }
    const lines = bytes === null ? null : await unpackLines(parts);
    if (lines !== null) return { lines };
    files.reportFault('tableFileNotRead');
    return 'none';
  }
  async function handOverFrom(start: number, lines: string, snapshotId: string): Promise<void> {
    const end = linesPageEnd(start, lines);
    if (files.handOver(snapshotId, lines.slice(start, end ?? undefined), end === null) !== 'read') {
      files.reportFault('tableFileNotRead');
      return files.giveUp(snapshotId);
    }
    if (end === null) return;
    await files.letOthersRun();
    return handOverFrom(end, lines, snapshotId);
  }
  async function loadOne(snapshotId: string): Promise<void> {
    const read = await readFile(snapshotId, tableFileReadFrom(1));
    if (read === 'calledOff') return;
    if (read === 'none') return files.giveUp(snapshotId);
    return handOverFrom(0, read.lines, snapshotId);
  }
  const triesBySnapshot = new Map<string, number>();
  function nextToLoad(): string | undefined {
    const wanted = files.wanted();
    for (const snapshotId of triesBySnapshot.keys()) if (!wanted.includes(snapshotId)) triesBySnapshot.delete(snapshotId);
    return (
      wanted.find((snapshotId) => !triesBySnapshot.has(snapshotId)) ??
      wanted.find((snapshotId) => triesBySnapshot.get(snapshotId) !== MOST_TABLE_FILE_TRIES)
    );
  }
  let isLoading = false;
  async function loadWhileWanted(): Promise<void> {
    const snapshotId = nextToLoad();
    isLoading = snapshotId !== undefined;
    if (snapshotId === undefined) return;
    const tries = triesBySnapshot.get(snapshotId) ?? 0;
    if (tries > 0) await files.waitToRetry(tries - 1, 0);
    await loadOne(snapshotId);
    triesBySnapshot.set(snapshotId, tries + 1);
    return loadWhileWanted();
  }
  async function load(): Promise<void> {
    try {
      await loadWhileWanted();
    } catch {
      isLoading = false;
      files.reportFault('tableFileNotRead');
    }
  }
  return (): void => void (isLoading || load());
}
