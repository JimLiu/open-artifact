import {
  BUSY_PAUSE_MS,
  STORED_FILE_URL_PATTERN,
  SYSTEM_CLOCK,
  fileLoaderAnswer,
  isPlainObject,
  parseFileAnswer,
  withResultMetadata,
  type DataFileFormat,
  type DatasetLoader,
  type FetchedDataFile,
  type LoadFailure,
  type LoadResult,
  type PollClock,
  type Table,
  type WordedMessage,
} from '@open-artifact/data-core';
import { finalizeQueryResult, runFileLoader } from './queries.ts';
import { RECENTLY_SHOWN_MS, markFlaky, type PageVisibility } from './retry.ts';

/** A stored file is given this long to arrive. */
export const FILE_FETCH_TIMEOUT_MS = 120_000;

export const NO_READABLE_ROWS: WordedMessage = {
  message: 'The file has no rows this dashboard can read.',
  wording: { code: 'fileNoRows' },
};

const EMPTY_FILE_TABLE: Table = Object.freeze({ columns: [], rows: [] }) as Table;

export interface FileEnvironment {
  fetch?: typeof fetch;
  /** The address `_blob/<id>` paths resolve against (the page's); left as a root path when there is none. */
  base?: () => string | undefined;
  clock?: PollClock;
  timeoutMs?: number;
  /** When the page was last shown: a missing file is asked for again while the page was shown only just now. */
  visibility?: PageVisibility;
}

/** Whether a url is a file stored with the dashboard (`/_blob/<id>`) or a browser `blob:` url. */
export function isStoredAssetUrl(url: string): boolean {
  return STORED_FILE_URL_PATTERN.test(url);
}

/** Where a stored file is fetched from: a `blob:` url as it is, a `_blob/<id>` path at the origin's root. */
export function resolveStoredFileUrl(url: string, base?: string): string {
  if (url.startsWith('blob:')) return url;
  const path = url.startsWith('/') ? url : `/${url}`;
  if (base === undefined) return path;
  try {
    return new URL(path, base).href;
  } catch {
    return path;
  }
}

function defaultBase(): string | undefined {
  const href = globalThis.location?.href;
  return typeof href === 'string' ? href : undefined;
}

/** Fetches a stored data file's text; a failed load says why. */
export async function fetchDataFileText(url: string, env: FileEnvironment = {}): Promise<FetchedDataFile | LoadFailure> {
  if (!isStoredAssetUrl(url))
    return {
      ok: false,
      kind: 'refused',
      message: 'This file isn’t stored in the dashboard, so it can’t be read.',
      wording: { code: 'fileNotStored' },
    };
  const fetcher = env.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.timeoutMs ?? FILE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(resolveStoredFileUrl(url, (env.base ?? defaultBase)()), {
      credentials: 'same-origin',
      signal: controller.signal,
    });
    const status = String(response.status);
    if (!response.ok) {
      const failure: LoadFailure = { ok: false, kind: 'failed', message: `Couldn’t load the file (${status}).`, wording: { code: 'fileStatus', status } };
      // Too many requests and server errors are likely passing.
      return response.status === 429 || response.status >= 500 ? markFlaky(failure) : failure;
    }
    const blob = await response.blob();
    return { text: await blob.text(), bytes: blob.size };
  } catch {
    const failure: LoadFailure = { ok: false, kind: 'failed', message: 'Couldn’t load the file.', wording: { code: 'fileFailed' } };
    // A network failure is likely passing; running out of time is not.
    return controller.signal.aborted ? failure : markFlaky(failure);
  } finally {
    clearTimeout(timeout);
  }
}

function isMissingFile(fetched: FetchedDataFile | LoadFailure): boolean {
  return 'ok' in fetched && fetched.wording?.code === 'fileStatus' && fetched.wording.status === '404';
}

/**
 * Fetches a file, asking again for one not found (404) while the page was shown only just now (a file still being
 * stored): each try waits for a hidden page to be shown, then 2 s; it stops once the load is stale.
 */
async function fetchUntilFound(
  url: string,
  env: FileEnvironment,
  clock: PollClock,
  isStale: () => boolean,
): Promise<FetchedDataFile | LoadFailure> {
  let fetched = await fetchDataFileText(url, env);
  const visibility = env.visibility;
  if (visibility === undefined) return fetched;
  while (isMissingFile(fetched)) {
    if (visibility.hidden()) await visibility.whenShown();
    if (clock.now() - visibility.shownAt() > RECENTLY_SHOWN_MS) break;
    await clock.sleep(BUSY_PAUSE_MS);
    if (isStale()) break;
    fetched = await fetchDataFileText(url, env);
  }
  return fetched;
}

/** Loads an attached file: its rows, its value, or what its loader makes of its text; a JSON file's `meta` labels its table. */
export async function loadDatasetFile(
  url: string,
  format: DataFileFormat,
  loader?: DatasetLoader,
  env: FileEnvironment = {},
  isStale: () => boolean = () => false,
): Promise<LoadResult> {
  const clock = env.clock ?? SYSTEM_CLOCK;
  const startedAt = clock.now();
  const fetched = await fetchUntilFound(url, env, clock, isStale);
  if ('ok' in fetched) return fetched;
  const elapsed = (): number => Math.round(clock.now() - startedAt);
  const answer = fileLoaderAnswer(fetched.text, format);
  const withFileMetadata = (table: Table): Table =>
    table.meta === undefined && isPlainObject(answer) ? withResultMetadata(table, answer.meta) : table;
  if (loader !== undefined) {
    const result = finalizeQueryResult(await runFileLoader(answer, loader), elapsed());
    return result.ok ? { ...result, table: withFileMetadata(result.table), bytes: fetched.bytes } : result;
  }
  const parsed = parseFileAnswer(fetched.text, format);
  if (parsed === null) return { ok: false, kind: 'failed', ...NO_READABLE_ROWS };
  return {
    ok: true,
    table: withFileMetadata('table' in parsed ? parsed.table : EMPTY_FILE_TABLE),
    ...('value' in parsed ? { value: parsed.value } : {}),
    ms: elapsed(),
    bytes: fetched.bytes,
  };
}
