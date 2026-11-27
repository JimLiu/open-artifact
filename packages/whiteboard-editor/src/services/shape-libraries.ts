/**
 * The board's shape libraries as the Library panel uses them: reading each
 * library file (an upload), adding libraries from files people pick or drop
 * (a `.shapes.json` library, a zip of SVG files, a draw.io library, SVG
 * files; told apart by their content) or from a link
 * (`shape-library-link.ts`), and removing one from the board.
 *
 * Adding a library cleans every shape first (whiteboard-core's
 * `readShapeLibrary`), uploads the cleaned library once and lists it in
 * `board/shapes`. The upload stays when the library is removed (pages have
 * no way to delete uploads); shapes already placed never depend on it.
 *
 * Loaded with the panel, not with the board.
 */

import {
  MAX_BOARD_SHAPE_LIBRARIES,
  SHAPE_LIBRARY_LIMITS,
  refuseShapeLibrary,
  readShapeLibrary,
  serializeShapeLibrary,
  readShapeLibraryBytes,
  shapeLibraryFromSvgFiles,
  sniffLibraryBytes,
  withShapeLibraries,
  type BoardShapeLibrary,
  type LeftOutShape,
  type ShapeLibrary,
  type ShapeLibraryRead,
} from '@open-artifact/whiteboard-core';
import { resolveAssetUrl } from '../elements/links.ts';
import { changeBoard, useBoard } from '../state/board.ts';
import { ensureEditable } from './actions.ts';
import { announce } from './announce.ts';
import { maybeSession } from './session.ts';

/** Said when the board cannot store files, so it cannot keep a library. */
export const NO_UPLOADS_MESSAGE = 'This board cannot store files here, so shape libraries cannot be added.';

/** A library file as the panel shows it. */
export type LoadedLibrary = { ok: true; library: ShapeLibrary } | { ok: false; reason: string };

const loaded = new Map<string, Promise<LoadedLibrary>>();

/** Reads (once per file) and cleans a library the board lists. */
export function loadShapeLibrary(entry: Pick<BoardShapeLibrary, 'file' | 'name'>): Promise<LoadedLibrary> {
  let pending = loaded.get(entry.file);
  if (pending === undefined) {
    pending = (async (): Promise<LoadedLibrary> => {
      try {
        const response = await fetch(resolveAssetUrl(entry.file), { credentials: 'same-origin' });
        if (!response.ok) return { ok: false, reason: 'Its file is missing.' };
        const read = readShapeLibrary(await response.text(), entry.name);
        return read.ok ? { ok: true, library: read.library } : { ok: false, reason: read.reason };
      } catch {
        return { ok: false, reason: 'Its file could not be read.' };
      }
    })();
    loaded.set(entry.file, pending);
    // A failed read is tried again next time.
    void pending.then((result) => {
      if (!result.ok) loaded.delete(entry.file);
    });
  }
  return pending;
}

/** What adding one library did. */
export type LibraryImport =
  | { ok: true; name: string; added: number; leftOut: LeftOutShape[]; overLimit: number }
  | { ok: false; name: string; reason: string; leftOut: LeftOutShape[] };

/** True for a file that is read as an SVG drawing. */
function isSvgFile(file: File): boolean {
  return /\.svg$/i.test(file.name) || file.type === 'image/svg+xml';
}

/** A name for a library made of loose SVG files that no library on the board has yet. */
function looseLibraryName(libraries: readonly BoardShapeLibrary[]): string {
  const taken = new Set(libraries.map((library) => library.name));
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'My shapes' : `My shapes ${n}`;
    if (!taken.has(name)) return name;
  }
}

/** Uploads a cleaned library and lists it on the board. */
export async function addShapeLibrary(read: ShapeLibraryRead): Promise<LibraryImport> {
  const { library, leftOut, overLimit } = read;
  if (library.shapes.length === 0) {
    return { ok: false, name: library.name, reason: leftOut.length === 1 ? 'Its only shape could not be used.' : leftOut.length > 1 ? `None of its ${leftOut.length} shapes could be used.` : 'It has no shapes.', leftOut };
  }
  const assets = maybeSession()?.assets;
  if (!assets) return { ok: false, name: library.name, reason: NO_UPLOADS_MESSAGE, leftOut };
  let record: { id: string; url: string };
  try {
    record = await assets.upload(new Blob([serializeShapeLibrary(library)], { type: 'application/json' }), { name: `${library.name}.shapes.json` });
  } catch {
    return { ok: false, name: library.name, reason: 'Its file could not be stored. Try again.', leftOut };
  }
  const id = record.id.slice(0, 64).replace(/[^A-Za-z0-9_-]/g, '_');
  let refused: string | undefined;
  changeBoard(
    (board) => {
      const libraries = board.content.shapes ?? [];
      refused = refuseShapeLibrary(libraries, id);
      if (refused !== undefined) return board;
      const entry: BoardShapeLibrary = {
        id,
        name: library.name,
        file: record.url,
        count: library.shapes.length,
        at: Date.now(),
        ...(library.source !== undefined ? { source: library.source } : {}),
        ...(library.license !== undefined ? { license: library.license } : {}),
      };
      return { ...board, content: withShapeLibraries(board.content, [...libraries, entry]) };
    },
    { label: 'Add shape library' },
  );
  if (refused !== undefined) return { ok: false, name: library.name, reason: refused, leftOut };
  loaded.set(record.url, Promise.resolve({ ok: true, library }));
  return { ok: true, name: library.name, added: library.shapes.length, leftOut, overLimit };
}

/**
 * Adds libraries from files: each library file (`.shapes.json`, a zip of
 * SVG files, a draw.io library) is one library, and the SVG files together
 * make one more (named "My shapes"). Returns what happened
 * to each; refuses everything when the board is read-only or cannot store
 * files.
 */
export async function importShapeFiles(files: readonly File[]): Promise<LibraryImport[]> {
  if (!ensureEditable()) return [];
  if (!maybeSession()?.assets) return [{ ok: false, name: 'Shape library', reason: NO_UPLOADS_MESSAGE, leftOut: [] }];
  const results: LibraryImport[] = [];
  const svgs = files.filter(isSvgFile);
  for (const file of files) {
    if (isSvgFile(file)) continue;
    if (file.size > SHAPE_LIBRARY_LIMITS.bytes) {
      results.push({ ok: false, name: file.name, reason: `It is larger than ${SHAPE_LIBRARY_LIMITS.bytes / 1024 / 1024} MB.`, leftOut: [] });
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    // An SVG under another name joins the other SVG files.
    if (sniffLibraryBytes(bytes) === 'svg') {
      svgs.push(file);
      continue;
    }
    const read = await readShapeLibraryBytes(bytes, file.name);
    results.push(read.ok ? await addShapeLibrary(read) : { ok: false, name: file.name, reason: read.reason, leftOut: [] });
  }
  if (svgs.length > 0) {
    const texts = await Promise.all(svgs.slice(0, SHAPE_LIBRARY_LIMITS.shapes).map(async (file) => ({ fileName: file.name, text: file.size > 400_000 ? '' : await file.text() })));
    const read = shapeLibraryFromSvgFiles(texts, looseLibraryName(useBoard.getState().board.content.shapes ?? []));
    results.push(await addShapeLibrary({ ...read, overLimit: read.overLimit + Math.max(0, svgs.length - SHAPE_LIBRARY_LIMITS.shapes) }));
  }
  announce(importSummary(results));
  return results;
}

/** One sentence about what an import did (also spoken). */
export function importSummary(results: readonly LibraryImport[]): string {
  return results
    .map((result) => {
      const left = result.leftOut.length + (result.ok ? result.overLimit : 0);
      if (!result.ok) return `“${result.name}” was not added: ${result.reason}`;
      const total = result.added + left;
      return left > 0 ? `Added “${result.name}”: ${left} of ${total} shapes were left out.` : `Added “${result.name}” with ${result.added} ${result.added === 1 ? 'shape' : 'shapes'}.`;
    })
    .join(' ');
}

/** Removes a library from the board (shapes already placed stay; its file is kept). */
export function removeShapeLibrary(id: string): boolean {
  if (!ensureEditable()) return false;
  let name: string | undefined;
  const removed = changeBoard(
    (board) => {
      const libraries = board.content.shapes ?? [];
      name = libraries.find((library) => library.id === id)?.name;
      if (name === undefined) return board;
      return { ...board, content: withShapeLibraries(board.content, libraries.filter((library) => library.id !== id)) };
    },
    { label: 'Remove shape library' },
  );
  if (removed && name !== undefined) announce(`Removed “${name}” from this board. Shapes already placed stay.`);
  return removed;
}

/** True when the board can take another library. */
export function hasRoomForLibrary(libraries: readonly BoardShapeLibrary[]): boolean {
  return libraries.length < MAX_BOARD_SHAPE_LIBRARIES;
}
