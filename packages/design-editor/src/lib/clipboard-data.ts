/**
 * Clipboard payloads of the design editor and their encoding: the payload
 * rides in clipboard HTML inside a marker attribute (base64 JSON), next to
 * the elements' own source so other apps get usable HTML.
 */

import { applySplices, escapeAttribute, getAttribute, parseDcDocument, parseTemplate, type Splice } from '@open-artifact/dc';
import type { BoardEntry, CanvasNote } from '@open-artifact/design-core';

/** Copied elements of one artboard. */
export interface ElementsPayload {
  kind: 'elements';
  board: string;
  /** The elements' template source. */
  html: string[];
  /** The project it came from (pastes into the same artboard use the source as is). */
  from?: string;
  /**
   * Per element, its rendered markup when its source depends on the
   * artboard (loops, conditions, components, values): what a paste into
   * another artboard uses. `null` when the source stands on its own.
   */
  rendered?: (string | null)[];
  /** Style rules of the artboard that apply to the elements, carried into another artboard's helmet. */
  css?: string[];
  /**
   * Per element, where it sat in its artboard when copied (against the
   * root), with what it computed: pastes into an artboard keep them apart
   * as they were. Missing when the page could not be measured.
   */
  boxes?: CopiedBox[];
  /**
   * The elements as standalone HTML (computed styles inline), for other
   * apps. Written to the clipboard, not kept in the marker.
   */
  standalone?: string;
  /** Where the artboard sat on the canvas when copied (the parts of a selection across files). */
  at?: { x: number; y: number };
}

/** Copied artboards and notes. */
export interface ObjectsPayload {
  kind: 'objects';
  externalCode?: boolean;
  boards: { path: string; entry: BoardEntry; source: string }[];
  notes: CanvasNote[];
}

/**
 * The elements of a selection across files: each artboard's elements as an
 * elements payload of their own. Artboards and notes are not copied along.
 */
export interface MixedPayload {
  kind: 'mixed';
  elements: ElementsPayload[];
}

/** What a copy holds. */
export type ClipboardPayload = ElementsPayload | ObjectsPayload | MixedPayload;

/**
 * Copied elements of several artboards in the simplest shape that holds
 * them: one artboard's elements stay an elements payload; `null` when
 * there are none.
 */
export function joinedPayload(elements: readonly ElementsPayload[]): ElementsPayload | MixedPayload | null {
  const parts = elements.filter((part) => part.html.length);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0]!;
  return { kind: 'mixed', elements: [...parts] };
}

/** A copied element's border box against its artboard's root, and its computed layout. */
export interface CopiedBox {
  left: number;
  top: number;
  width: number;
  height: number;
  computed: Record<string, string>;
}

export const MARKER = 'data-open-artifact-design';


/* -------------------------------- encoding ------------------------------- */

function encode(payload: ClipboardPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(text: string): ClipboardPayload | null {
  try {
    const binary = atob(text);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes)) as ClipboardPayload;
    return value && (value.kind === 'elements' || value.kind === 'objects' || (value.kind === 'mixed' && Array.isArray(value.elements))) ? value : null;
  } catch {
    return null;
  }
}

/** The clipboard flavours of a payload. */
export function clipboardData(payload: ClipboardPayload): { html: string; text: string } {
  if (payload.kind === 'elements') {
    // Other apps get the standalone rendering: the source needs this artboard's styles, data and components.
    const { standalone, ...kept } = payload;
    const body = standalone ?? payload.html.join('\n');
    return { html: `<meta ${MARKER}="${encode(kept)}">${body}`, text: body };
  }
  if (payload.kind === 'mixed') {
    // Other apps get the standalone HTML; the marker keeps the source.
    const kept = { ...payload, elements: payload.elements.map(({ standalone: _standalone, ...part }) => part) };
    const body = payload.elements.map((part) => part.standalone ?? part.html.join('\n')).join('\n');
    return { html: `<meta ${MARKER}="${encode(kept)}">${body}`, text: body };
  }
  const text = [...payload.boards.map((b) => b.entry.title ?? b.path), ...payload.notes.map((n) => n.text).filter(Boolean)].join('\n');
  return { html: `<meta ${MARKER}="${encode(payload)}">`, text };
}

/** Reads our payload out of clipboard HTML. */
export function payloadFromHtml(html: string): ClipboardPayload | null {
  const match = new RegExp(`${MARKER}="([^"]*)"`).exec(html);
  if (match) return decode(match[1]!);
  const external = /\bdata-appifact-object=["']([A-Za-z0-9+/=]+)["']/.exec(html);
  if (!external) return null;
  try {
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(external[1]!), c => c.charCodeAt(0)));
    const value = JSON.parse(decoded);
    if (value?.appifact !== 1 || value.kind !== 'design-artboards' || !Array.isArray(value.data?.artboards)) return null;
    const boards: Extract<ClipboardPayload, { kind: 'objects' }>['boards'] = [];
    const stems = new Set<string>();
    for (const board of value.data.artboards) {
      if (!board || typeof board.src !== 'string' || typeof board.stem !== 'string' || !board.stem || stems.has(board.stem) || board.stem.includes('/') || ![board.dx, board.dy, board.w, board.h].every(Number.isFinite)) return null;
      stems.add(board.stem);
      boards.push({ path: board.stem + '.dc.html', source: board.src, entry: { x: board.dx, y: board.dy, w: board.w, h: board.h, title: board.stem } });
    }
    return boards.length ? { kind: 'objects', externalCode: true, boards, notes: [] } : null;
  } catch { return null; }
}

/** Redirect imports and prototype links to other boards in the same paste. */
export function remapBoardReferences(source: string, path: string, names: ReadonlyMap<string, string>): string {
  const template = parseDcDocument(source).template;
  if (!template) return source;
  const base = new URL(path, 'https://artifact.invalid/');
  const edits: Splice[] = [];
  for (const element of parseTemplate(template.text).elements) {
    const imported = element.tag === 'dc-import';
    const attr = getAttribute(element, imported ? 'name' : 'href');
    if (!attr?.value || (!imported && element.tag !== 'a')) continue;
    let url: URL;
    try { url = new URL(imported ? attr.value + '.dc.html' : attr.value, base); } catch { continue; }
    if (url.origin !== base.origin) continue;
    let target: string;
    try { target = decodeURIComponent(url.pathname.slice(1)); } catch { continue; }
    const renamed = names.get(target);
    if (!renamed) continue;
    const value = imported ? renamed.replace(/\.dc\.html$/, '') : renamed + url.search + url.hash;
    if (value !== attr.value) edits.push({ start: template.start + attr.start, end: template.start + attr.end, text: `${attr.name}="${escapeAttribute(value)}"` });
  }
  return applySplices(source, edits);
}
