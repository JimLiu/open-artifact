/**
 * The files of a Sheet's connected tables, kept in its `sheet/` folder:
 *
 *   sheet/tables/<snapshotId>.jsonl.gz   a snapshot's records: the table file's lines, gzip
 *   sheet/refreshes.jsonl                refreshes that brought no rows, one JSON line each:
 *                                        {sheetId, callDigest, why, toolSaid?, at}
 *
 * A snapshot's file is written before the edit that names it, so a page that hears of the snapshot finds its file.
 * The agent's command line may write both while a server holds the store; the server reads them as it rescans.
 */

import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { WorkspaceDirectory } from '@open-artifact/protocol/workspace-files';
import type { TableFileSlice } from '@open-artifact/runtime/sheet-api';

export const TABLES_DIR = 'tables';
export const REFRESHES_FILE = 'refreshes.jsonl';
/** The bytes of a table file one read answers: a multiple of 3, so each slice is whole base64. */
export const TABLE_FILE_SLICE_BYTES = 3 * 16_384;
/**
 * The format a snapshot's edit (`setSnapshots`) is written in. The engine writes it in format 48 itself, and a page
 * hearing it streamed in a later format cannot read it (a load page in any format can).
 */
export const SNAPSHOT_EDIT_FORMAT_VERSION = 48;
const SNAPSHOT_ID = /^[0-9a-f]{32}$/;

export const isSnapshotId = (value: unknown): value is string => typeof value === 'string' && SNAPSHOT_ID.test(value);

const tableFile = (sheetDir: string, snapshotId: string): string => path.join(sheetDir, TABLES_DIR, `${snapshotId}.jsonl.gz`);

/** Keeps a snapshot's records: the table file's lines, each ended by a line break. */
export function writeTableFile(sheetDir: string, files: WorkspaceDirectory, snapshotId: string, lines: readonly string[]): void {
  if (!isSnapshotId(snapshotId)) throw new Error(`"${snapshotId}" is not a snapshot id.`);
  const file = files.resolve(tableFile(sheetDir, snapshotId), false);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, gzipSync(lines.map((line) => `${line}\n`).join('')));
  fs.renameSync(tmp, file);
}

function tableFileBytes(sheetDir: string, files: WorkspaceDirectory, snapshotId: string): Buffer | null {
  if (!isSnapshotId(snapshotId)) return null;
  try {
    return fs.readFileSync(files.resolve(tableFile(sheetDir, snapshotId)));
  } catch {
    return null;
  }
}

/** A snapshot's lines as one text, or null when its file is not kept (or cannot be read). */
export function tableFileText(sheetDir: string, files: WorkspaceDirectory, snapshotId: string): string | null {
  const bytes = tableFileBytes(sheetDir, files, snapshotId);
  if (bytes === null) return null;
  try {
    return gunzipSync(bytes).toString('utf8');
  } catch {
    return null;
  }
}

/** What a page's read of a table file answers: the bytes from `from` on, at most one slice of them. */
export function sliceOfTableFile(sheetDir: string, files: WorkspaceDirectory, snapshotId: string, from: number): TableFileSlice {
  const bytes = tableFileBytes(sheetDir, files, snapshotId);
  if (bytes === null || from >= bytes.length) return { kind: 'tableFile', isGone: true };
  return {
    kind: 'tableFile',
    body: `${snapshotId}.jsonl.gz`,
    byteCount: bytes.length,
    from,
    bytes: bytes.subarray(from, from + TABLE_FILE_SLICE_BYTES).toString('base64'),
  };
}

/** A refresh that brought no rows, as kept. */
export interface RefreshOutcome {
  sheetId: string;
  callDigest: string;
  why: string;
  toolSaid?: string;
  at: string;
}

export function appendRefreshOutcome(sheetDir: string, files: WorkspaceDirectory, outcome: RefreshOutcome): number {
  const file = files.resolve(path.join(sheetDir, REFRESHES_FILE), false);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = `${JSON.stringify(outcome)}\n`;
  fs.appendFileSync(file, line);
  return Buffer.byteLength(line);
}

/** The size of refreshes.jsonl, 0 when there is none. */
export function refreshesSize(sheetDir: string, files: WorkspaceDirectory): number {
  try {
    return fs.statSync(files.resolve(path.join(sheetDir, REFRESHES_FILE))).size;
  } catch {
    return 0;
  }
}

/** The whole lines of refreshes.jsonl from byte `from` on, and where they end. */
export function readRefreshOutcomes(sheetDir: string, files: WorkspaceDirectory, from: number): { outcomes: RefreshOutcome[]; end: number } {
  let text: Buffer;
  try {
    text = fs.readFileSync(files.resolve(path.join(sheetDir, REFRESHES_FILE)));
  } catch {
    return { outcomes: [], end: 0 };
  }
  if (text.length < from) return { outcomes: [], end: text.length };
  const rest = text.subarray(from);
  const lastBreak = rest.lastIndexOf(0x0a);
  if (lastBreak < 0) return { outcomes: [], end: from };
  const outcomes = rest
    .subarray(0, lastBreak)
    .toString('utf8')
    .split('\n')
    .flatMap((line) => {
      try {
        const outcome = JSON.parse(line) as RefreshOutcome;
        return typeof outcome?.sheetId === 'string' && typeof outcome.callDigest === 'string' && typeof outcome.why === 'string' ? [outcome] : [];
      } catch {
        return [];
      }
    });
  return { outcomes, end: from + lastBreak + 1 };
}
