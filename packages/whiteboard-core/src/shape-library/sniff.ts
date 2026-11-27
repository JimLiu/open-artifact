/**
 * What a library file is, told from its content (never its name or media
 * type), and reading it whatever it is: a zip pack, a draw.io library, a
 * `.shapes.json` library or one SVG drawing.
 */

import { inflateRawLimited } from './inflate.ts';
import { readShapeLibrary, shapeLibraryFromSvgFiles, shapeNameOfFile, SHAPE_LIBRARY_LIMITS, type ShapeLibraryRead, type ShapeLibraryRefusal } from './library.ts';
import { isMxLibraryText, mxLibraryName, readMxLibrary } from './mxlibrary.ts';
import { isZipBytes, readZipShapeLibrary, zipPackName, type Inflate } from './zip-pack.ts';

/** The kinds of file a library can come from. */
export type LibraryFileKind = 'zip' | 'mxlibrary' | 'json' | 'svg' | 'unknown';

/** Said when a file is none of the kinds a library comes from. */
export const UNKNOWN_LIBRARY_FILE_REASON = 'This is not a shape library: add a .shapes.json file, a .zip of SVG files, a draw.io library (.xml) or SVG files.';

/** The text of `bytes` as UTF-8. */
export function libraryText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/** True when `text`'s root element (after an XML declaration, comments and a doctype) is `<svg`. */
function isSvgText(text: string): boolean {
  const body = text
    .replace(/^\uFEFF/, '')
    .replace(/^\s*<\?xml[\s\S]*?\?>/, '')
    .replace(/^(?:\s*<!--[\s\S]*?-->|\s*<!DOCTYPE[^>]*>)*/i, '');
  return /^\s*<svg[\s>]/.test(body);
}

/** What `bytes` hold. */
export function sniffLibraryBytes(bytes: Uint8Array): LibraryFileKind {
  if (isZipBytes(bytes)) return 'zip';
  const text = libraryText(bytes.subarray(0, Math.min(bytes.length, 4096)));
  if (isMxLibraryText(text)) return 'mxlibrary';
  if (isSvgText(text)) return 'svg';
  if (/^\uFEFF?\s*[{[]/.test(text)) {
    try {
      JSON.parse(libraryText(bytes));
      return 'json';
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

/**
 * Reads a library file of any kind. `fileName` names the library (and the
 * shape, for one SVG drawing).
 */
export async function readShapeLibraryBytes(bytes: Uint8Array, fileName: string, inflate: Inflate = inflateRawLimited): Promise<(ShapeLibraryRead & { kind: LibraryFileKind }) | ShapeLibraryRefusal> {
  if (bytes.length > SHAPE_LIBRARY_LIMITS.bytes) return { ok: false, reason: `This file is larger than ${SHAPE_LIBRARY_LIMITS.bytes / 1024 / 1024} MB: split it into smaller libraries.` };
  const kind = sniffLibraryBytes(bytes);
  const withKind = (read: ShapeLibraryRead | ShapeLibraryRefusal) => (read.ok ? { ...read, kind } : read);
  switch (kind) {
    case 'zip':
      return withKind(await readZipShapeLibrary(bytes, zipPackName(fileName), inflate));
    case 'mxlibrary':
      return withKind(await readMxLibrary(libraryText(bytes), mxLibraryName(fileName), inflate));
    case 'json':
      return withKind(readShapeLibrary(libraryText(bytes), fileName.replace(/\.shapes\.json$/i, '').replace(/\.json$/i, '') || 'Shapes'));
    case 'svg': {
      const name = shapeNameOfFile(fileName) || 'Shapes';
      return withKind(shapeLibraryFromSvgFiles([{ fileName: fileName || 'Shape.svg', text: libraryText(bytes) }], name));
    }
    default:
      return { ok: false, reason: UNKNOWN_LIBRARY_FILE_REASON };
  }
}
