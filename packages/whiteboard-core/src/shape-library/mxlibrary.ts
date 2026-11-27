/**
 * draw.io libraries (`<mxlibrary>` files): a JSON list of entries, each an
 * SVG picture (`data`) or a small graph (`xml`). The SVG pictures become
 * shapes; a graph is taken only when it is one cell showing an SVG picture
 * (`shape=image;…;image=data:image/svg+xml,…`). Everything else (stencils,
 * groups of cells, raster pictures) is left out with a reason: boards never
 * draw graph cells themselves.
 *
 * A graph's `xml` is plain XML, or compressed: base64 of raw deflate of the
 * URL-encoded XML. Both are read; inflating is capped like zip entries.
 */

import { parseXml, XmlElement } from '../drawn-svg/xml.ts';
import { inflateRawLimited } from './inflate.ts';
import { cleanLibraryText, readLibraryShape, shapeLibraryOf, SHAPE_LIBRARY_LIMITS, type LeftOutShape, type LibraryShape, type ShapeLibraryRead, type ShapeLibraryRefusal } from './library.ts';
import { ZIP_PACK_LIMITS, type Inflate } from './zip-pack.ts';

/** Why a graph entry is left out. */
export const MX_UNREADABLE_REASON = 'is drawn in a way boards cannot read';
/** Why a raster picture entry is left out. */
export const MX_RASTER_REASON = 'is a raster picture (PNG, JPEG or similar), not a drawing';

/** True when `text` (after a BOM and white space) starts a draw.io library. */
export function isMxLibraryText(text: string): boolean {
  return /^\uFEFF?\s*<mxlibrary[\s>]/.test(text);
}

/** The library name a draw.io file's name gives (without `.xml` / `.drawio`). */
export function mxLibraryName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  return cleanLibraryText(base.replace(/\.(xml|drawio)$/i, ''), SHAPE_LIBRARY_LIMITS.name) || 'Shapes';
}

/** The bytes of a base64 text, or `undefined`. */
function base64Bytes(text: string): Uint8Array | undefined {
  try {
    return Uint8Array.from(atob(text.replace(/\s+/g, '')), (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/** The SVG inside an SVG data URL (base64, or URL-encoded text), or `undefined` for anything else. */
export function svgOfDataUrl(url: string): string | undefined {
  const match = /^data:image\/svg\+xml((?:;[^,;]*)*),(.*)$/is.exec(url.trim());
  if (!match) return undefined;
  const [, params = '', payload = ''] = match;
  const looksBase64 = /;base64/i.test(params) || (!payload.includes('<') && !payload.includes('%') && /^[A-Za-z0-9+/=\s]+$/.test(payload));
  if (looksBase64) {
    const bytes = base64Bytes(payload);
    return bytes === undefined ? undefined : new TextDecoder('utf-8').decode(bytes);
  }
  try {
    return decodeURIComponent(payload);
  } catch {
    return payload;
  }
}

/** True for a data URL or link of a raster picture. */
function isRasterPicture(url: string): boolean {
  return /^data:image\/(?!svg\+xml)/i.test(url.trim());
}

/** Reads a graph entry's `xml` (plain or compressed) as text. */
async function graphText(xml: string, inflate: Inflate): Promise<string | undefined> {
  const trimmed = xml.trim();
  if (trimmed.startsWith('<')) return trimmed;
  const bytes = base64Bytes(trimmed);
  if (bytes === undefined) return undefined;
  const inflated = await inflate(bytes, ZIP_PACK_LIMITS.entryBytes);
  if (!inflated.ok) return undefined;
  const text = new TextDecoder('utf-8').decode(inflated.bytes);
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Every element below (and including) `root`. */
function* elementsOf(root: XmlElement): Generator<XmlElement> {
  yield root;
  for (const child of root.children) yield* elementsOf(child);
}

/** A graph style (`a=b;c;…`) as a map; a bare first word is the shape. */
function styleOf(style: string): Map<string, string> {
  const map = new Map<string, string>();
  style.split(';').forEach((part, index) => {
    const at = part.indexOf('=');
    if (at > 0) map.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
    else if (index === 0 && part.trim() !== '') map.set('shape', part.trim());
  });
  return map;
}

/** What a graph shows: the SVG of its one picture cell, or why it is left out. */
export function svgOfGraph(text: string): { svg: string; w?: number; h?: number } | { reason: string } {
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch {
    return { reason: MX_UNREADABLE_REASON };
  }
  const cells = [...elementsOf(root)].filter((element) => element.localName === 'mxCell' && (element.getAttribute('vertex') === '1' || element.getAttribute('edge') === '1'));
  if (cells.length !== 1 || cells[0]!.getAttribute('vertex') !== '1') return { reason: MX_UNREADABLE_REASON };
  const cell = cells[0]!;
  const style = styleOf(cell.getAttribute('style') ?? '');
  const image = style.get('image');
  if (style.get('shape') !== 'image' || image === undefined) return { reason: MX_UNREADABLE_REASON };
  if (isRasterPicture(image)) return { reason: MX_RASTER_REASON };
  const svg = svgOfDataUrl(image);
  if (svg === undefined) return { reason: MX_UNREADABLE_REASON };
  const geometry = cell.children.find((child) => child.localName === 'mxGeometry');
  const w = Number(geometry?.getAttribute('width'));
  const h = Number(geometry?.getAttribute('height'));
  return { svg, ...(w > 0 ? { w } : {}), ...(h > 0 ? { h } : {}) };
}

/** The entries list inside `<mxlibrary>…</mxlibrary>`, or `undefined`. */
function entriesOf(text: string): unknown[] | undefined {
  const match = /^\uFEFF?\s*<mxlibrary(?:\s[^>]*)?>([\s\S]*)<\/mxlibrary>\s*$/.exec(text);
  if (!match) return undefined;
  const inner = match[1]!.trim();
  for (const candidate of [inner, inner.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&')]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // try the next reading
    }
  }
  return undefined;
}

/** Reads a draw.io library into a library named `name`. */
export async function readMxLibrary(text: string, name: string, inflate: Inflate = inflateRawLimited): Promise<ShapeLibraryRead | ShapeLibraryRefusal> {
  if (text.length > SHAPE_LIBRARY_LIMITS.bytes) return { ok: false, reason: `This library is larger than ${SHAPE_LIBRARY_LIMITS.bytes / 1024 / 1024} MB: split it into smaller libraries.` };
  const entries = entriesOf(text);
  if (entries === undefined) return { ok: false, reason: 'This draw.io library could not be read (its list of shapes is not JSON).' };
  const kept = entries.slice(0, SHAPE_LIBRARY_LIMITS.shapes);
  const read: Array<LibraryShape | LeftOutShape> = [];
  for (const [index, raw] of kept.entries()) {
    const fields = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    const title = cleanLibraryText(fields.title, SHAPE_LIBRARY_LIMITS.name) || `Shape ${index + 1}`;
    const size = { ...(typeof fields.w === 'number' ? { w: fields.w } : {}), ...(typeof fields.h === 'number' ? { h: fields.h } : {}) };
    if (typeof fields.data === 'string') {
      if (isRasterPicture(fields.data)) {
        read.push({ name: title, reason: MX_RASTER_REASON });
        continue;
      }
      const svg = svgOfDataUrl(fields.data);
      read.push(svg === undefined ? { name: title, reason: MX_UNREADABLE_REASON } : readLibraryShape({ name: title, svg, ...size }, index));
      continue;
    }
    if (typeof fields.xml === 'string') {
      const graph = await graphText(fields.xml, inflate);
      const found = graph === undefined ? { reason: MX_UNREADABLE_REASON } : svgOfGraph(graph);
      if ('reason' in found) read.push({ name: title, reason: found.reason });
      else read.push(readLibraryShape({ name: title, svg: found.svg, w: size.w ?? found.w, h: size.h ?? found.h }, index));
      continue;
    }
    read.push({ name: title, reason: 'is not a shape' });
  }
  return shapeLibraryOf(cleanLibraryText(name, SHAPE_LIBRARY_LIMITS.name) || 'Shapes', undefined, undefined, read, entries.length - kept.length);
}
