/**
 * A canvas note as artboard HTML: what a note becomes when it is pasted,
 * dropped or moved into an artboard. Each kind of note has one HTML form
 * that looks like the note does on the canvas; a note without one (a link
 * card, an empty text, text with `{{`, an image whose address would read
 * as template syntax) gives `null`.
 *
 * The element is laid out at the note's world box (`box`): callers place
 * it inside the artboard and position it from there.
 */

import { escapeAttribute, escapeText } from '@open-artifact/dc';
import { videoOptions, type CanvasNote, type Rect } from '@open-artifact/design-core';
import { bezierPathData, readNodes } from './bezier.ts';
import { DEFAULT_STICKY, NOTE_LINE_HEIGHT, inlineRuns, isPathNote, markdownBlocks, noteBounds, noteColor, noteFontSize, noteStroke, penViewBox, type MarkdownBlock } from './notes.ts';
import { imageLook, shapeFill, shapeLook } from './note-look.ts';
import { cropPictureStyle } from './note-crop.ts';

/** A note turned into one artboard element. */
export interface NoteLayer {
  html: string;
  /** Where the element sits in world coordinates (before its transform). */
  box: Rect;
}

/** What `noteHtml` needs from the page. */
export interface NoteHtmlOptions {
  /** A fresh id for `<marker>` elements (unique in the artboard). */
  freshId(): string;
  /** The size the note rendered at, when it was measured (text notes). */
  measured?: { w: number; h: number };
}

/** Text that the template would read as an expression. */
const templated = (text: string): boolean => text.includes('{{');

/** A number written into CSS or SVG: up to two decimals. */
const num = (value: number): string => String(Number(value.toFixed(2)) || 0);
const px = (value: number): string => `${num(value)}px`;

/** The note's rotation and flips as a CSS transform declaration, or ''. */
export function noteTransformCss(note: CanvasNote): string {
  const parts: string[] = [];
  if (note.rotate) parts.push(`rotate(${num(note.rotate)}deg)`);
  if (note.flipX || note.flipY) parts.push(`scale(${note.flipX ? -1 : 1}, ${note.flipY ? -1 : 1})`);
  return parts.length ? ` transform: ${parts.join(' ')};` : '';
}

/** Inline runs of a line as HTML: bold, italic, code, and links to web addresses (others keep their words). */
function inlineHtml(text: string): string {
  return inlineRuns(text)
    .map((run) => {
      let html = escapeText(run.text);
      if (run.code) html = `<code>${html}</code>`;
      if (run.italic) html = `<em>${html}</em>`;
      if (run.bold) html = `<strong>${html}</strong>`;
      if (run.href && /^https?:\/\//i.test(run.href) && !/[{}<]/.test(run.href)) html = `<a href="${escapeAttribute(run.href)}">${html}</a>`;
      return html;
    })
    .join('');
}

/** A run of list items in a row, or one other block. */
type Part = { kind: 'list'; ordered: boolean; start: number; items: string[] } | { kind: 'block'; block: Exclude<MarkdownBlock, { kind: 'item' }> };

function parts(text: string): Part[] {
  const out: Part[] = [];
  for (const block of markdownBlocks(text)) {
    if (block.kind !== 'item') {
      out.push({ kind: 'block', block });
      continue;
    }
    const ordered = /^\d/.test(block.marker);
    const last = out[out.length - 1];
    if (last?.kind === 'list' && last.ordered === ordered) last.items.push(block.text);
    else out.push({ kind: 'list', ordered, start: ordered ? Number.parseInt(block.marker, 10) : 1, items: [block.text] });
  }
  return out;
}

/** A sticky's text: one line as it is; several as one `<div>` each, lists as `<ul>` / `<ol>`. */
function stickyBody(text: string): string {
  const all = parts(text);
  const only = all[0];
  if (all.length === 1 && only?.kind === 'block' && only.block.kind === 'paragraph') return inlineHtml(only.block.text);
  return all
    .map((part) => {
      if (part.kind === 'list') {
        const items = part.items.map((item) => `<li>${inlineHtml(item)}</li>`).join('');
        return part.ordered ? `<ol start="${part.start}">${items}</ol>` : `<ul>${items}</ul>`;
      }
      if (part.block.kind === 'heading') return `<div style="font-size: 1.15em; font-weight: 700;">${inlineHtml(part.block.text)}</div>`;
      return part.block.text.trim() ? `<div>${inlineHtml(part.block.text)}</div>` : '<div><br></div>';
    })
    .join('');
}

/** The text style a text note writes: size, weight, slant and colour. */
function textCss(note: CanvasNote, defaultBold: boolean): string {
  const size = noteFontSize(note.size, note.kind);
  const bold = note.bold ?? defaultBold;
  return ` font-size: ${size}px;${bold ? ' font-weight: 700;' : ''}${note.italic ? ' font-style: italic;' : ''}`;
}

function titleHtml(note: CanvasNote, box: Rect): string {
  const text = note.text ?? '';
  const color = note.color ? ` color: ${noteColor(note.color, 'stroke', '#1d1d1b')};` : '';
  const maxW = typeof note.maxW === 'number' ? ` max-width: ${px(note.maxW)}; overflow-wrap: break-word;` : '';
  const width = note.w !== undefined ? ` width: ${px(box.w)};` : '';
  const lines = text.split('\n').map(escapeText).join('<br>');
  return `<div style="margin: 0; line-height: ${NOTE_LINE_HEIGHT};${maxW}${width}${textCss(note, true)}${color} white-space: pre-wrap;${noteTransformCss(note)}">${lines}</div>`;
}

function stickyHtml(note: CanvasNote, box: Rect): string {
  const fill = noteColor(note.fill ?? note.color, 'sticky', DEFAULT_STICKY);
  return `<div style="margin: 0; box-sizing: border-box; width: ${px(box.w)}; min-height: ${px(box.h)}; padding: 12px; border-radius: 2px; background-color: ${fill}; line-height: ${NOTE_LINE_HEIGHT};${textCss(note, false)} white-space: pre-wrap;${noteTransformCss(note)}">${stickyBody(note.text ?? '')}</div>`;
}

function shapeHtml(note: CanvasNote, box: Rect): string {
  const look = shapeLook(note).dom;
  const fill = shapeFill(note);
  const declarations: string[] = ['box-sizing: border-box', 'display: flex', 'flex-direction: column'];
  if (note.kind === 'oval' || note.text) declarations.push('align-items: center', 'justify-content: center');
  declarations.push(`width: ${px(box.w)}`, `height: ${px(box.h)}`);
  if (!/gradient\(/i.test(fill)) declarations.push(`background-color: ${fill}`);
  for (const [key, value] of Object.entries(look)) {
    if (key === 'background' && !/gradient\(/i.test(value)) continue;
    declarations.push(`${key}: ${value}`);
  }
  const text = note.text?.trim() ? `<span style="text-align: center; line-height: ${NOTE_LINE_HEIGHT};${textCss(note, false)} white-space: pre-wrap;">${escapeText(note.text)}</span>` : '';
  return `<div style="${declarations.join('; ')};${noteTransformCss(note)}">${text}</div>`;
}

/** A marker drawing one arrow head, in user units so its size does not follow the stroke width. */
function markerHtml(id: string, kind: 'open' | 'filled', color: string, width: number): string {
  const length = 10.8;
  const half = 5.2;
  if (kind === 'filled') {
    return `<marker id="${id}" viewBox="0 0 ${length} ${half * 2}" refX="0" refY="${half}" markerWidth="${length}" markerHeight="${half * 2}" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L${length} ${half}L0 ${half * 2}Z" fill="${escapeAttribute(color)}"></path></marker>`;
  }
  const pad = width;
  return `<marker id="${id}" viewBox="${-pad} ${-pad} ${length + pad * 2} ${half * 2 + pad * 2}" refX="${length}" refY="${half}" markerWidth="${length + pad * 2}" markerHeight="${half * 2 + pad * 2}" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="M0 0L${length} ${half}L0 ${half * 2}" fill="none" stroke="${escapeAttribute(color)}" stroke-width="${num(width)}" stroke-linecap="round" stroke-linejoin="round"></path></marker>`;
}

/** The svg shell every drawn line shares. */
function svgOpen(box: Rect, viewBox: [number, number, number, number], color: string, width: number, dash: [number, number] | undefined, transform: string): string {
  const dashCss = dash ? ` stroke-dasharray: ${num(dash[0])} ${num(dash[1])};` : '';
  return `<svg width="${num(box.w)}" height="${num(box.h)}" viewBox="${viewBox.map(num).join(' ')}" preserveAspectRatio="none" style="width: ${px(box.w)}; height: ${px(box.h)}; overflow: visible; fill: none; stroke: ${color}; stroke-width: ${num(width)};${dashCss} stroke-linecap: round; stroke-linejoin: round;${transform}">`;
}

function lineHtml(note: CanvasNote, box: Rect, options: NoteHtmlOptions): string | null {
  const points = note.points ?? [];
  if (points.length < 2) return null;
  const { width, dash, color: raw } = noteStroke(note);
  const color = noteColor(raw, 'stroke', '#2b2b2b');
  const minX = box.x - note.x;
  const minY = box.y - note.y;
  const heads = {
    start: note.headStart === 'open' || note.headStart === 'filled' ? note.headStart : null,
    end: (note.headEnd ?? (note.kind === 'arrow' ? 'filled' : 'none')) as string,
  };
  const end = heads.end === 'open' || heads.end === 'filled' ? heads.end : null;
  const line = points.map(([x, y]) => [x, y] as [number, number]);
  // A filled head draws from the end back: the line stops where the head starts.
  const pull = (at: number, toward: number): void => {
    const [x, y] = line[at]!;
    const [a, b] = line[toward]!;
    const length = Math.hypot(x - a, y - b);
    if (length < 1e-6) return;
    const by = Math.min(length, 10.8);
    line[at] = [x + ((a - x) / length) * by, y + ((b - y) / length) * by];
  };
  if (heads.start === 'filled') pull(0, 1);
  if (end === 'filled') pull(line.length - 1, line.length - 2);
  const defs: string[] = [];
  let markers = '';
  if (heads.start) {
    const id = options.freshId();
    defs.push(markerHtml(id, heads.start, color, width));
    markers += ` marker-start="url(#${id})"`;
  }
  if (end) {
    const id = options.freshId();
    defs.push(markerHtml(id, end, color, width));
    markers += ` marker-end="url(#${id})"`;
  }
  const d = line.map(([x, y], i) => `${i ? 'L' : 'M'}${num(x)} ${num(y)}`).join(' ');
  return `${svgOpen(box, [minX, minY, box.w, box.h], color, width, dash, noteTransformCss(note))}${defs.length ? `<defs>${defs.join('')}</defs>` : ''}<path d="${d}"${markers}></path></svg>`;
}

function penHtml(note: CanvasNote, box: Rect): string | null {
  const { width, dash, color: raw } = noteStroke(note);
  const color = noteColor(raw, 'stroke', '#2b2b2b');
  const nodes = readNodes(note.nodes);
  let d: string;
  let viewBox: [number, number, number, number];
  if (nodes && nodes.length >= 2) {
    d = bezierPathData(nodes, note.closed === true, (x, y) => ({ x: Number(num(x)), y: Number(num(y)) }));
    viewBox = [box.x - note.x, box.y - note.y, box.w, box.h];
  } else if (note.points?.length) {
    d = note.points.map(([x, y], i) => `${i ? 'L' : 'M'}${num(x)} ${num(y)}`).join(' ');
    viewBox = [box.x - note.x, box.y - note.y, box.w, box.h];
  } else if (note.d && !/[{}<"]/.test(note.d)) {
    d = note.d;
    viewBox = [0, 0, ...penViewBox(note.d)];
  } else return null;
  return `${svgOpen(box, viewBox, color, width, dash, noteTransformCss(note))}<path d="${escapeAttribute(d)}" vector-effect="non-scaling-stroke"></path></svg>`;
}

function imageHtml(note: CanvasNote, box: Rect): string | null {
  const src = note.src;
  const unsafe = (address: string) => /[{}<]/.test(address);
  if (!src || unsafe(src) || (note.video && unsafe(note.video))) return null;
  const alt = note.alt ?? note.text ?? '';
  if (templated(alt)) return null;
  const look = imageLook(note).dom;
  // The look as the canvas draws it, without what an <img> has anyway.
  const plain = (key: string, value: string) => key === 'box-sizing' || key.startsWith('object-') || (key === 'border-style' && value === 'none') || (key === 'border-radius' && value === '0px');
  const rest = Object.entries(look).filter(([key, value]) => !plain(key, value)).map(([key, value]) => ` ${key}: ${value};`).join('');
  const open = (style: string): string => {
    if (!note.video) return `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}"${note.crop ? '' : ` width="${Math.round(box.w)}" height="${Math.round(box.h)}"`} style="${style}">`;
    const play = videoOptions(note);
    const label = alt ? ` aria-label="${escapeAttribute(alt)}"` : '';
    const flags = `${play.autoplay ? ' autoplay' : ''}${play.loop ? ' loop' : ''}${play.sound ? '' : ' muted'} playsinline`;
    return `<video src="${escapeAttribute(note.video)}" poster="${escapeAttribute(src)}"${label}${flags} style="${style}"></video>`;
  };
  if (note.crop) {
    // Cropped: a frame with the note's look clips the zoomed picture.
    const bordered = /(^| )(border-(?!\S*radius)|outline)/.test(rest);
    const picture = Object.entries(cropPictureStyle(note.crop)).map(([key, value]) => `${key}: ${value};`).join(' ');
    return `<div style="${bordered ? 'box-sizing: border-box; ' : ''}position: relative; contain: layout; overflow: hidden; width: ${px(box.w)}; height: ${px(box.h)};${rest}${noteTransformCss(note)}">${open(picture)}</div>`;
  }
  const place = look['object-position'] ? ` object-position: ${look['object-position']};` : '';
  return open(`width: ${px(box.w)}; height: ${px(box.h)}; object-fit: ${look['object-fit']};${place}${rest}${noteTransformCss(note)}`);
}

/** The world box a note's element takes. */
export function noteLayerBox(note: CanvasNote, measured?: { w: number; h: number }): Rect {
  const bounds = noteBounds(note);
  if (isPathNote(note) || note.kind === 'image' || note.kind === 'rect' || note.kind === 'oval') return bounds;
  return measured ? { x: note.x, y: note.y, w: measured.w, h: measured.h } : bounds;
}

/** The note as one artboard element, or `null` when it has no HTML form. */
export function noteHtml(note: CanvasNote, options: NoteHtmlOptions): NoteLayer | null {
  const box = noteLayerBox(note, options.measured);
  let html: string | null;
  switch (note.kind) {
    case 'link':
      return null;
    case 'line':
    case 'arrow':
      html = lineHtml(note, box, options);
      break;
    case 'pen':
      html = penHtml(note, box);
      break;
    case 'image':
      html = imageHtml(note, box);
      break;
    case 'rect':
    case 'oval':
      if (note.text && templated(note.text)) return null;
      html = shapeHtml(note, box);
      break;
    case 'title1':
      html = !note.text?.trim() || templated(note.text) ? null : titleHtml(note, box);
      break;
    default:
      html = !note.text?.trim() || templated(note.text) ? null : stickyHtml(note, box);
  }
  return html ? { html, box } : null;
}

/** Why a note has no HTML form, as a word for messages: an image or a note. */
export const noteNoun = (note: CanvasNote): 'image' | 'note' => (note.kind === 'image' ? 'image' : 'note');
