/**
 * Shape library files: a named set of small SVG drawings people place on a
 * board as pictures.
 *
 * ```json
 * {
 *   "format": "open-artifact-shapes",
 *   "version": 1,
 *   "name": "Cloud basics",
 *   "source": "https://example.com/icons",
 *   "license": "CC BY 4.0",
 *   "shapes": [{ "name": "Server", "tags": ["compute"], "w": 48, "h": 48, "svg": "<svg …>…</svg>" }]
 * }
 * ```
 *
 * A library is data, never code. Reading one treats it as untrusted: sizes
 * are capped, text is trimmed, every drawing is cleaned and vetted
 * ({@link cleanShapeSvg}), and shapes that do not pass are left out with a
 * reason instead of failing the whole library.
 */

import { cleanShapeSvg } from './clean-svg.ts';

/** The `format` of a library file. */
export const SHAPE_LIBRARY_FORMAT = 'open-artifact-shapes';
/** The library file version this board reads and writes. */
export const SHAPE_LIBRARY_VERSION = 1;

/** Limits on what a library holds. */
export const SHAPE_LIBRARY_LIMITS = {
  /** Largest library file, in bytes of JSON. */
  bytes: 4 * 1024 * 1024,
  /** Most shapes one library keeps (later ones are not read). */
  shapes: 500,
  /** Longest library or shape name. */
  name: 80,
  /** Most tags per shape. */
  tags: 8,
  /** Longest tag. */
  tag: 40,
  /** Longest `source` link. */
  source: 512,
  /** Longest `license` text. */
  license: 200,
  /** Longest `outline`. */
  outline: 2000,
} as const;

/** One shape of a library. */
export interface LibraryShape {
  name: string;
  tags?: string[];
  /** Natural size (keeps the aspect ratio when placed). */
  w: number;
  h: number;
  /** A cleaned, vetted SVG drawing. */
  svg: string;
  /** An optional outline path (`M L C Z` and numbers), kept for later use. */
  outline?: string;
}

/** A library as the board keeps it. */
export interface ShapeLibrary {
  format: typeof SHAPE_LIBRARY_FORMAT;
  version: typeof SHAPE_LIBRARY_VERSION;
  name: string;
  /** Where the library comes from (an `https://` link). */
  source?: string;
  license?: string;
  shapes: LibraryShape[];
}

/** A shape that was left out, and why (a phrase that follows its name: "Router: it uses <text>…"). */
export interface LeftOutShape {
  name: string;
  reason: string;
}

/** A library read from a file. */
export interface ShapeLibraryRead {
  ok: true;
  library: ShapeLibrary;
  /** Shapes that were not usable. */
  leftOut: LeftOutShape[];
  /** Shapes past {@link SHAPE_LIBRARY_LIMITS.shapes} that were not read. */
  overLimit: number;
}

/** A file that is not a library at all. */
export interface ShapeLibraryRefusal {
  ok: false;
  reason: string;
}

type Loose = Record<string, unknown>;

/** Plain one-line text: control characters removed, whitespace collapsed, trimmed, at most `max` characters. */
export function cleanLibraryText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('').trimEnd();
}

/** An `https://` link of at most {@link SHAPE_LIBRARY_LIMITS.source} characters, or `undefined`. */
export function cleanLibrarySource(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > SHAPE_LIBRARY_LIMITS.source || !/^https:\/\/[^\s<>"'`\\\u0000-\u001f\u007f]+$/.test(value)) return undefined;
  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The license text, or `undefined` when there is none. */
export function cleanLibraryLicense(value: unknown): string | undefined {
  const text = cleanLibraryText(value, SHAPE_LIBRARY_LIMITS.license);
  return text === '' ? undefined : text;
}

const OUTLINE_TOKEN_PATTERN = /[MLCZ]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|[\s,]+/y;

/** The outline when it is only `M L C Z` commands and numbers (starting with `M`), else `undefined`. */
export function cleanShapeOutline(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > SHAPE_LIBRARY_LIMITS.outline || !/^\s*M/.test(value)) return undefined;
  OUTLINE_TOKEN_PATTERN.lastIndex = 0;
  while (OUTLINE_TOKEN_PATTERN.lastIndex < value.length) {
    const before = OUTLINE_TOKEN_PATTERN.lastIndex;
    if (OUTLINE_TOKEN_PATTERN.exec(value) === null || OUTLINE_TOKEN_PATTERN.lastIndex === before) return undefined;
  }
  return value.trim();
}

/** Tags: plain strings, at most {@link SHAPE_LIBRARY_LIMITS.tags}, deduplicated (case-insensitively). */
function cleanTags(value: unknown): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const tag = cleanLibraryText(entry, SHAPE_LIBRARY_LIMITS.tag);
    if (tag === '' || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length === SHAPE_LIBRARY_LIMITS.tags) break;
  }
  return tags;
}

/** A size from the file when it is a finite positive number (rounded to 0.01), else `fallback`. */
function sizeOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100_000 ? Math.round(value * 100) / 100 || fallback : fallback;
}

/** The name shown for an unnamed shape. */
function fallbackShapeName(index: number): string {
  return `Shape ${index + 1}`;
}

/**
 * Reads one shape: its drawing cleaned and named, its size from the file or
 * the drawing. Returns the shape, or the reason it is left out.
 */
export function readLibraryShape(raw: unknown, index: number): LibraryShape | LeftOutShape {
  const fields = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : undefined) as Loose | undefined;
  const name = cleanLibraryText(fields?.name, SHAPE_LIBRARY_LIMITS.name) || fallbackShapeName(index);
  if (fields === undefined) return { name, reason: 'is not a shape' };
  if (typeof fields.svg !== 'string') return { name, reason: 'has no drawing' };
  const cleaned = cleanShapeSvg(fields.svg, name);
  if (!cleaned.ok) return { name, reason: cleaned.reason };
  const tags = cleanTags(fields.tags);
  const outline = cleanShapeOutline(fields.outline);
  const w = sizeOr(fields.w, cleaned.w);
  const h = sizeOr(fields.h, cleaned.h);
  return { name, ...(tags.length > 0 ? { tags } : {}), w, h, svg: cleaned.svg, ...(outline !== undefined ? { outline } : {}) };
}

function isLeftOut(shape: LibraryShape | LeftOutShape): shape is LeftOutShape {
  return 'reason' in shape;
}

/** Builds a library from read shapes. */
function libraryOf(name: string, source: string | undefined, license: string | undefined, entries: ReadonlyArray<LibraryShape | LeftOutShape>, overLimit: number): ShapeLibraryRead {
  const shapes: LibraryShape[] = [];
  const leftOut: LeftOutShape[] = [];
  for (const entry of entries) (isLeftOut(entry) ? leftOut : shapes).push(entry as LibraryShape & LeftOutShape);
  return {
    ok: true,
    library: { format: SHAPE_LIBRARY_FORMAT, version: SHAPE_LIBRARY_VERSION, name, ...(source !== undefined ? { source } : {}), ...(license !== undefined ? { license } : {}), shapes },
    leftOut,
    overLimit,
  };
}

/** A library from shapes already read (and the ones left out); other readers (zip packs, draw.io libraries) end here. */
export const shapeLibraryOf = libraryOf;

/** UTF-8 byte length of a string. */
function utf8Length(text: string): number {
  return text.length > SHAPE_LIBRARY_LIMITS.bytes ? text.length * 3 : new TextEncoder().encode(text).length;
}

/**
 * Reads a library file's text. `fallbackName` names a library that has no
 * name of its own (usually the file name). Refuses files that are not a
 * library of this format and version, or too large; otherwise every shape
 * is read on its own.
 */
export function readShapeLibrary(text: string, fallbackName = 'Shapes'): ShapeLibraryRead | ShapeLibraryRefusal {
  if (typeof text !== 'string') return { ok: false, reason: 'This is not a shape library.' };
  if (text.length > SHAPE_LIBRARY_LIMITS.bytes || utf8Length(text) > SHAPE_LIBRARY_LIMITS.bytes) {
    return { ok: false, reason: `This shape library is larger than ${SHAPE_LIBRARY_LIMITS.bytes / 1024 / 1024} MB: split it into smaller libraries.` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'This file is not a shape library (it is not JSON).' };
  }
  const fields = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Loose;
  if (fields.format !== SHAPE_LIBRARY_FORMAT) return { ok: false, reason: `This file is not a shape library ("format" must be "${SHAPE_LIBRARY_FORMAT}").` };
  if (fields.version !== SHAPE_LIBRARY_VERSION) return { ok: false, reason: `This shape library is version ${JSON.stringify(fields.version ?? null)}; boards read version ${SHAPE_LIBRARY_VERSION}.` };
  if (!Array.isArray(fields.shapes)) return { ok: false, reason: 'This shape library has no "shapes" list.' };
  const name = cleanLibraryText(fields.name, SHAPE_LIBRARY_LIMITS.name) || cleanLibraryText(fallbackName, SHAPE_LIBRARY_LIMITS.name) || 'Shapes';
  const kept = fields.shapes.slice(0, SHAPE_LIBRARY_LIMITS.shapes);
  return libraryOf(
    name,
    cleanLibrarySource(fields.source),
    cleanLibraryLicense(fields.license),
    kept.map((shape, index) => readLibraryShape(shape, index)),
    fields.shapes.length - kept.length,
  );
}

/** A loose SVG file: its name and text. */
export interface SvgFile {
  fileName: string;
  text: string;
}

/** A shape name from a file name: without its folder and `.svg` extension. */
export function shapeNameOfFile(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  return base.replace(/\.svg$/i, '');
}

/**
 * A library from loose SVG files, one shape per file, named after the file
 * (without its extension). `name` names the library.
 */
export function shapeLibraryFromSvgFiles(files: readonly SvgFile[], name: string): ShapeLibraryRead {
  const kept = files.slice(0, SHAPE_LIBRARY_LIMITS.shapes);
  return libraryOf(
    cleanLibraryText(name, SHAPE_LIBRARY_LIMITS.name) || 'Shapes',
    undefined,
    undefined,
    kept.map((file, index) => readLibraryShape({ name: shapeNameOfFile(file.fileName), svg: file.text }, index)),
    files.length - kept.length,
  );
}

/** The library as file text (what is uploaded and read back). */
export function serializeShapeLibrary(library: ShapeLibrary): string {
  return JSON.stringify(library);
}

/** True when a shape's name or one of its tags contains every word of `query` (case-insensitively). */
export function shapeMatchesQuery(shape: Pick<LibraryShape, 'name' | 'tags'>, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return true;
  const haystack = [shape.name, ...(shape.tags ?? [])].join(' ').toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * The shape names of a library file, without cleaning any drawing (what an
 * agent is told about a library). Returns `undefined` for a file that is
 * not a library.
 */
export function shapeNamesOfLibraryText(text: string): { name: string; shapes: string[] } | undefined {
  if (typeof text !== 'string' || text.length > SHAPE_LIBRARY_LIMITS.bytes) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const fields = (typeof raw === 'object' && raw !== null ? raw : {}) as Loose;
  if (fields.format !== SHAPE_LIBRARY_FORMAT || fields.version !== SHAPE_LIBRARY_VERSION || !Array.isArray(fields.shapes)) return undefined;
  return {
    name: cleanLibraryText(fields.name, SHAPE_LIBRARY_LIMITS.name),
    shapes: fields.shapes
      .slice(0, SHAPE_LIBRARY_LIMITS.shapes)
      .map((shape, index) => cleanLibraryText((shape as Loose | null)?.name, SHAPE_LIBRARY_LIMITS.name) || fallbackShapeName(index)),
  };
}
