/**
 * The board's list of shape libraries, `board/shapes`:
 *
 * ```json
 * {"libs": {"<id>": {"name": "Cloud basics", "file": "/_blob/<32 hex>", "count": 12, "at": 1767225600000, "source": "https://…", "license": "…"}}}
 * ```
 *
 * The list only says which libraries the board offers in its Library panel;
 * shapes placed on the board are ordinary pictures that never point back at
 * it, so removing a library (or losing its file) changes nothing drawn.
 */

import { isUploadedBlobSource } from '../image-source.ts';
import type { BoardContent, BoardShapeLibrary } from '../schema.ts';
import { cleanLibraryLicense, cleanLibrarySource, cleanLibraryText, SHAPE_LIBRARY_LIMITS } from './library.ts';

/** The shape libraries document. */
export const BOARD_SHAPES_PATH = 'board/shapes';
/** Most libraries one board keeps. */
export const MAX_BOARD_SHAPE_LIBRARIES = 8;
/** A library key in `board/shapes`. */
export const SHAPE_LIBRARY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The `board/shapes` document. */
export interface BoardShapesRecord {
  libs: Record<string, Omit<BoardShapeLibrary, 'id'>>;
}

type Loose = Record<string, unknown>;

/** One library entry, or `undefined` when it is unusable (no id, name or upload path). */
export function normalizeBoardShapeLibrary(raw: unknown): BoardShapeLibrary | undefined {
  const fields = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : undefined) as Loose | undefined;
  if (fields === undefined) return undefined;
  const { id, file, count, at } = fields;
  const name = cleanLibraryText(fields.name, SHAPE_LIBRARY_LIMITS.name);
  if (typeof id !== 'string' || !SHAPE_LIBRARY_ID_PATTERN.test(id) || name === '' || typeof file !== 'string' || !isUploadedBlobSource(file)) return undefined;
  const source = cleanLibrarySource(fields.source);
  const license = cleanLibraryLicense(fields.license);
  return {
    id,
    name,
    file: file.startsWith('/') ? file : '/' + file,
    count: typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.min(SHAPE_LIBRARY_LIMITS.shapes, Math.round(count))) : 0,
    at: typeof at === 'number' && Number.isFinite(at) ? Math.round(at) : 0,
    ...(source !== undefined ? { source } : {}),
    ...(license !== undefined ? { license } : {}),
  };
}

/**
 * Shape libraries: usable entries, one per id, oldest first; at most
 * {@link MAX_BOARD_SHAPE_LIBRARIES} (a library added past that is not kept).
 */
export function normalizeBoardShapeLibraries(raw: unknown): BoardShapeLibrary[] {
  const byId = new Map<string, BoardShapeLibrary>();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const library = normalizeBoardShapeLibrary(entry);
    if (library !== undefined && !byId.has(library.id)) byId.set(library.id, library);
  }
  return [...byId.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, MAX_BOARD_SHAPE_LIBRARIES);
}

/** The libraries of a `board/shapes` document (not yet normalized), or `undefined` when it has no `libs` map. */
export function shapeLibrariesOfRecord(record: unknown): unknown[] | undefined {
  const libs = typeof record === 'object' && record !== null ? (record as Loose).libs : undefined;
  if (typeof libs !== 'object' || libs === null || Array.isArray(libs)) return undefined;
  return Object.entries(libs as Loose).map(([id, entry]) => (typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? { ...(entry as Loose), id } : entry));
}

/** The `board/shapes` document of a list of libraries. */
export function shapeLibrariesToRecord(libraries: readonly BoardShapeLibrary[]): BoardShapesRecord {
  return { libs: Object.fromEntries(libraries.map(({ id, ...entry }) => [id, entry])) };
}

/** The content with a new library list. */
export function withShapeLibraries<T extends BoardContent>(content: T, libraries: readonly BoardShapeLibrary[]): T {
  return { ...content, shapes: normalizeBoardShapeLibraries(libraries) };
}

/** Why a library cannot be added to the board, or `undefined` when it can. */
export function refuseShapeLibrary(libraries: readonly BoardShapeLibrary[], id: string): string | undefined {
  if (libraries.some((library) => library.id === id)) return 'This library is already on the board.';
  if (libraries.length >= MAX_BOARD_SHAPE_LIBRARIES) return `A board holds up to ${MAX_BOARD_SHAPE_LIBRARIES} shape libraries: remove one first.`;
  return undefined;
}
