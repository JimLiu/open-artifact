/**
 * The Whiteboard type as the server sees it: a db-backed type whose content
 * is the documents under `db/` (see `@open-artifact/whiteboard-core`'s
 * codec), not files under `project/`.
 *
 * ```
 * db/board/meta.json        {v: 1, title, order: [id…]}   the marker
 * db/board/inks.json        {colors: {}}
 * db/elements/<id>.json     one element each
 * comments.json             review threads
 * ```
 */

import { BOARD_CLAIM_PREFIX, BOARD_INKS_PATH, BOARD_META_PATH, BOARD_TIMER_PATH, checkBoardDocuments, type DocumentValue } from '@open-artifact/whiteboard-core';
import type { CheckFinding } from './types.ts';

/** Largest view context the editor may publish, bytes of JSON. */
const MAX_VIEW_CONTEXT_BYTES = 32 * 1024;

/** The marker file, relative to the content folder (`db/`). */
export const WHITEBOARD_MARKER = `${BOARD_META_PATH}.json`;

/** Files of a new, empty board, relative to `db/`. */
export function scaffoldWhiteboard(title: string): Record<string, string> {
  return {
    [`${BOARD_META_PATH}.json`]: `${JSON.stringify({ v: 1, title, order: [] })}\n`,
    [`${BOARD_INKS_PATH}.json`]: `${JSON.stringify({ colors: {} })}\n`,
  };
}

/** The view context the editor publishes: any plain object up to 32 KB. */
export function validateWhiteboardContext(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    return Buffer.byteLength(JSON.stringify(value)) <= MAX_VIEW_CONTEXT_BYTES ? value : null;
  } catch {
    return null;
  }
}

/**
 * Documents the version history leaves out: the agent's claims (`board/claim-*`,
 * held for seconds while it works), the shared timer (a live control, not an
 * undo step either) and people's private data (`data/users/<id>/idea`, an
 * idea the page deletes once seen). Recording them would bury the board's
 * real edits under noise, and bringing one back would revive stale state.
 */
export function whiteboardHistoryIgnores(path: string): boolean {
  return path.startsWith(BOARD_CLAIM_PREFIX) || path === BOARD_TIMER_PATH || path.startsWith('data/');
}

/** The file under the project of a document path (`elements/n1`) or a collection (`elements/`). */
const fileOf = (path: string): string => (path.endsWith('/') ? `db/${path}` : `db/${path}.json`);

/**
 * Checks a board. `files` maps document paths (`elements/n1`) to the raw
 * JSON text on disk. Errors are what the editor would drop or refuse;
 * warnings are what it repairs on its own (see `checkBoardDocuments`).
 */
export function checkWhiteboard(files: ReadonlyMap<string, string>, blobExists?: (id: string) => boolean): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const documents = new Map<string, DocumentValue>();
  for (const [path, text] of files) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      findings.push({ file: fileOf(path), level: 'error', message: 'Not valid JSON: the board ignores this document until it parses.' });
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      findings.push({ file: fileOf(path), level: 'error', message: 'A document is a JSON object.' });
      continue;
    }
    documents.set(path, value as DocumentValue);
  }
  for (const finding of checkBoardDocuments(documents, { describe: fileOf, ...(blobExists ? { blobExists } : {}) })) {
    findings.push({ file: fileOf(finding.path), level: finding.level, message: finding.message });
  }
  return findings;
}
