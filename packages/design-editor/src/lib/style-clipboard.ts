/**
 * Copy properties and Paste properties: an element's, a canvas note's or an
 * artboard's look, kept as groups (fill, border, text…) so it can land on a
 * different kind of thing. A box's fill and border become a shape's fill
 * and stroke and back; a note takes the nearest colour of its palette.
 * Pasting a group replaces it: what a class gives the target in that group
 * is reset, so the result looks like the source.
 */

import { formatHex, parseColor, rgbaToOklch } from '@open-artifact/ui/color';
import type { CanvasNote, NoteColor } from '@open-artifact/design-core';
import { DEFAULT_STICKY, NOTE_PALETTE, noteColor, noteFontSize, noteStroke } from './notes.ts';
import { NOTE_BORDER_WIDTH, NOTE_RECT_RADIUS, shapeFill } from './note-look.ts';

/** The groups a look is copied in. */
export type StyleGroup = 'fill' | 'border' | 'outline' | 'radius' | 'shadow' | 'filter' | 'backdrop' | 'blend' | 'opacity' | 'text' | 'paint';

/** The kinds of element a look is copied from and pasted onto. */
export type ElementClass = 'text' | 'box' | 'image' | 'shape' | 'rule';

/** Where a copied look came from. */
export type StyleSource = ElementClass | 'text-note' | 'shape-note' | 'image-note' | 'line-note' | 'board';

/** CSS declarations, kebab-case. */
export type Declarations = Record<string, string>;

/** What Copy properties keeps: each group the source has, with its values (none = the defaults). */
export interface CopiedStyle {
  source: StyleSource;
  groups: Partial<Record<StyleGroup, Declarations>>;
}

/** The most declarations a copy keeps. */
export const MAX_DECLARATIONS = 64;

const BOX_GROUPS: readonly StyleGroup[] = ['fill', 'border', 'outline', 'radius', 'shadow', 'filter', 'backdrop', 'blend', 'opacity'];

/** The groups each kind of element has, and takes. */
export const GROUPS_OF: Record<ElementClass, readonly StyleGroup[]> = {
  text: [...BOX_GROUPS, 'text'],
  box: BOX_GROUPS,
  image: BOX_GROUPS.filter((group) => group !== 'fill'),
  shape: ['paint', 'shadow', 'filter', 'backdrop', 'blend', 'opacity'],
  // A line drawn by its border (`<hr>`).
  rule: ['border', 'shadow', 'filter', 'backdrop', 'blend', 'opacity'],
};

/** The groups a canvas note or an artboard takes. */
export const NOTE_GROUPS: Record<'text-note' | 'shape-note' | 'image-note' | 'line-note' | 'board', readonly StyleGroup[]> = {
  'text-note': ['text', 'fill'],
  'shape-note': ['fill', 'border', 'radius', 'shadow', 'filter', 'backdrop', 'opacity'],
  // A picture takes no fill: pasting never paints behind it.
  'image-note': ['border', 'radius', 'shadow', 'filter', 'backdrop', 'opacity'],
  'line-note': ['paint'],
  // The page background and the frame's corners.
  board: ['fill', 'radius'],
};

const TEXT_PROPERTIES = new Set(['color', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-shadow']);
const FILL_EXTRAS = new Set(['-webkit-background-clip', '-webkit-text-fill-color']);

/** The group a style property belongs to, or null (size, place, layout…). */
export function groupOf(property: string): StyleGroup | null {
  if (property === 'backdrop-filter' || property === '-webkit-backdrop-filter') return 'backdrop';
  if (property === 'filter') return 'filter';
  if (property === 'box-shadow') return 'shadow';
  if (property === 'mix-blend-mode') return 'blend';
  if (property === 'opacity') return 'opacity';
  if (/^border(-(top|bottom)-(left|right))?-radius$/.test(property)) return 'radius';
  if (/^border(-|$)/.test(property)) return 'border';
  if (/^outline(-|$)/.test(property)) return 'outline';
  if (/^background(-|$)/.test(property) || FILL_EXTRAS.has(property)) return 'fill';
  if (/^(fill|stroke)(-|$)/.test(property)) return 'paint';
  if (/^font(-|$)/.test(property) || /^text-decoration(-|$)/.test(property) || TEXT_PROPERTIES.has(property)) return 'text';
  return null;
}

/* --------------------------------- colours --------------------------------- */

/** True for a colour that paints nothing (or none at all). */
function clear(color: string | undefined): boolean {
  const value = (color ?? '').trim().toLowerCase();
  if (!value || value === 'none' || value === 'transparent') return true;
  const parsed = parseColor(value);
  return parsed !== null && parsed.rgba.a === 0;
}

/** A colour with `opacity` folded into it, as `#rrggbb[aa]`; unread colours stay as written. */
export function withOpacity(color: string, opacity: string | undefined): string {
  const parsed = parseColor(color);
  if (!parsed) return color;
  const amount = opacity === undefined ? 1 : opacity.trim().endsWith('%') ? parseFloat(opacity) / 100 : Number(opacity);
  const a = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 1;
  return formatHex({ ...parsed.rgba, a: parsed.rgba.a * a });
}

/* --------------------------------- borders --------------------------------- */

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const STYLES = new Set(['none', 'hidden', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset']);
const WIDTH_WORDS: Record<string, number> = { thin: 1, medium: 3, thick: 5 };

/** Splits a value at spaces outside parentheses. */
function tokens(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current) out.push(current);
      current = '';
    } else current += ch;
  }
  if (current) out.push(current);
  return out;
}

/** A width in px, or null. */
function widthPx(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (WIDTH_WORDS[value] !== undefined) return WIDTH_WORDS[value]!;
  const match = /^(-?\d*\.?\d+)(px)?$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

/** The value of each side from a 1–4 value shorthand. */
function perSide(value: string): [string, string, string, string] {
  const [t, r = t, b = t, l = r] = tokens(value);
  return [t!, r!, b!, l!];
}

interface Side {
  width: string;
  style: string;
  color: string;
}

/** A border's four sides, from its shorthands and longhands. */
function bordersOf(css: Declarations): Side[] {
  const sides: Side[] = SIDES.map(() => ({ width: 'medium', style: 'none', color: 'currentcolor' }));
  const shorthand = (side: Side, value: string) => {
    side.width = 'medium';
    side.style = 'none';
    side.color = 'currentcolor';
    for (const token of tokens(value)) {
      if (STYLES.has(token)) side.style = token;
      else if (widthPx(token) !== null) side.width = token;
      else side.color = token;
    }
  };
  for (const [property, value] of Object.entries(css)) {
    if (property === 'border') sides.forEach((side) => shorthand(side, value));
    else if (property === 'border-width' || property === 'border-style' || property === 'border-color') {
      const key = property.slice(7) as keyof Side;
      perSide(value).forEach((part, index) => (sides[index]![key] = part));
    } else {
      const match = /^border-(top|right|bottom|left)(?:-(width|style|color))?$/.exec(property);
      if (!match) continue;
      const side = sides[SIDES.indexOf(match[1] as (typeof SIDES)[number])]!;
      if (match[2]) side[match[2] as keyof Side] = value;
      else shorthand(side, value);
    }
  }
  return sides;
}

/** The border that is drawn: its style and colour from the first drawn side, the widest width. Null when none is. */
export function drawnBorder(css: Declarations): { width: number; style: string; color: string } | null {
  const drawn = bordersOf(css).filter((side) => side.style !== 'none' && side.style !== 'hidden' && (widthPx(side.width) ?? 0) > 0);
  if (!drawn.length) return null;
  return { width: Math.max(...drawn.map((side) => widthPx(side.width)!)), style: drawn[0]!.style, color: drawn[0]!.color };
}

/** A border style as a stroke's dashes, at width `w` (rounded, 1–300). */
export function dashesFor(style: string, w: number): string {
  const width = Math.max(1, Math.min(300, Math.round(w)));
  if (style === 'dashed') return `${3 * width} ${3 * width}`;
  if (style === 'dotted') return `1 ${2 * width + 1}`;
  return 'none';
}

/** A stroke's dashes as a border style. */
export function borderStyleFor(dashes: string | undefined): 'solid' | 'dashed' | 'dotted' {
  const numbers = (dashes ?? '').trim().toLowerCase() === 'none' ? [] : (dashes ?? '').split(/[\s,]+/).filter(Boolean).map(parseFloat);
  if (!numbers.length || numbers.every((n) => n === 0)) return 'solid';
  if (numbers.length === 2 && numbers[0]! <= 2) return 'dotted';
  return 'dashed';
}

/* ---------------------------------- copying ---------------------------------- */

const DEFAULTS: Record<'shadow' | 'filter' | 'backdrop' | 'blend' | 'opacity', [string, string]> = {
  shadow: ['box-shadow', 'none'],
  filter: ['filter', 'none'],
  backdrop: ['backdrop-filter', 'none'],
  blend: ['mix-blend-mode', 'normal'],
  opacity: ['opacity', '1'],
};

const isZero = (value: string | undefined) => !value || /^0(px)?$/.test(value.trim()) || /^0px 0px$/.test(value.trim());

/** One group's values from what the browser computed; empty when it is at its default. */
function computedGroup(group: StyleGroup, computed: Declarations): Declarations {
  const c = (key: string) => computed[key]?.trim() ?? '';
  switch (group) {
    case 'fill': {
      const out: Declarations = {};
      if (/gradient\(/i.test(c('background-image'))) {
        out['background-image'] = c('background-image');
        for (const key of ['background-size', 'background-position', 'background-repeat']) if (c(key)) out[key] = c(key);
      }
      if (!clear(c('background-color'))) out['background-color'] = c('background-color');
      return out;
    }
    case 'border': {
      const styles = SIDES.map((side) => c(`border-${side}-style`) || 'none');
      const widths = SIDES.map((side) => c(`border-${side}-width`));
      if (styles.every((style) => style === 'none' || style === 'hidden') || widths.every(isZero)) return {};
      const out: Declarations = {};
      for (const side of SIDES) for (const part of ['width', 'style', 'color']) out[`border-${side}-${part}`] = c(`border-${side}-${part}`) || (part === 'style' ? 'none' : part === 'width' ? '0px' : 'currentcolor');
      return collapseSides(out);
    }
    case 'outline':
      if (!c('outline-style') || c('outline-style') === 'none') return {};
      return { 'outline-width': c('outline-width'), 'outline-style': c('outline-style'), 'outline-color': c('outline-color'), 'outline-offset': c('outline-offset') || '0px' };
    case 'radius': {
      const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((corner) => c(`border-${corner}-radius`) || '0px');
      if (corners.every(isZero)) return {};
      return corners.every((corner) => corner === corners[0]) ? { 'border-radius': corners[0]! } : { 'border-radius': corners.join(' ') };
    }
    case 'text': {
      const out: Declarations = {};
      for (const key of ['font-family', 'font-size', 'font-weight', 'font-style']) if (c(key)) out[key] = c(key);
      const size = widthPx(c('font-size'));
      const line = widthPx(c('line-height'));
      if (size && line !== null) out['line-height'] = String(Math.round((line / size) * 1000) / 1000);
      else if (/^\d*\.?\d+$/.test(c('line-height'))) out['line-height'] = c('line-height');
      if (c('color')) out.color = c('color');
      if (c('letter-spacing') && c('letter-spacing') !== 'normal' && !isZero(c('letter-spacing'))) out['letter-spacing'] = c('letter-spacing');
      if (c('text-align') && !['start', 'left'].includes(c('text-align'))) out['text-align'] = c('text-align');
      if (c('text-transform') && c('text-transform') !== 'none') out['text-transform'] = c('text-transform');
      if (c('text-decoration-line') && c('text-decoration-line') !== 'none') out['text-decoration-line'] = c('text-decoration-line');
      if (c('text-shadow') && c('text-shadow') !== 'none') out['text-shadow'] = c('text-shadow');
      return out;
    }
    case 'paint': {
      const out: Declarations = {};
      if (c('fill')) out.fill = paintColor(c('fill'), c('fill-opacity'));
      if (c('stroke')) out.stroke = paintColor(c('stroke'), c('stroke-opacity'));
      if (c('stroke-width')) out['stroke-width'] = c('stroke-width');
      if (c('stroke-dasharray') && c('stroke-dasharray') !== 'none') out['stroke-dasharray'] = c('stroke-dasharray');
      if (c('stroke-linecap') && c('stroke-linecap') !== 'butt') out['stroke-linecap'] = c('stroke-linecap');
      if (c('stroke-linejoin') && c('stroke-linejoin') !== 'miter') out['stroke-linejoin'] = c('stroke-linejoin');
      return out;
    }
    default: {
      const [key, fallback] = DEFAULTS[group];
      return c(key) && c(key) !== fallback ? { [key]: c(key) } : {};
    }
  }
}

/** A fill or stroke with its opacity folded in; `none` and unread colours as written. */
function paintColor(color: string, opacity: string | undefined): string {
  return color === 'none' || !parseColor(color) ? color : withOpacity(color, opacity);
}

/** Four sides' longhands written as one shorthand each when the sides agree. */
function collapseSides(css: Declarations): Declarations {
  const out: Declarations = {};
  for (const part of ['width', 'style', 'color']) {
    const values = SIDES.map((side) => css[`border-${side}-${part}`]!);
    if (values.every((value) => value === values[0])) out[`border-${part}`] = values[0]!;
    else SIDES.forEach((side, index) => (out[`border-${side}-${part}`] = values[index]!));
  }
  return out;
}

/** One group's values as written inline: opacity folded into a shape's paint. */
function inlineGroup(group: StyleGroup, inline: Declarations): Declarations {
  const out: Declarations = {};
  for (const [key, value] of Object.entries(inline)) if (groupOf(key) === group) out[key] = value;
  if (group === 'paint') {
    for (const role of ['fill', 'stroke'] as const) {
      const opacity = out[`${role}-opacity`];
      if (opacity === undefined) continue;
      if (out[role] && parseColor(out[role]!)) {
        out[role] = withOpacity(out[role]!, opacity);
        delete out[`${role}-opacity`];
      }
    }
  }
  return out;
}

/**
 * An element's look: each group its kind has, as written inline when its
 * style writes any of it, else from what the browser computed (only what
 * differs from the default).
 */
export function copyElementStyle(kind: ElementClass, inline: Declarations, computed: Declarations): CopiedStyle {
  const groups: Partial<Record<StyleGroup, Declarations>> = {};
  let count = 0;
  for (const group of GROUPS_OF[kind]) {
    const written = Object.keys(inline).some((key) => groupOf(key) === group);
    const values = written ? inlineGroup(group, inline) : computedGroup(group, computed);
    const kept: Declarations = {};
    for (const [key, value] of Object.entries(values)) {
      if (count >= MAX_DECLARATIONS) break;
      kept[key] = value;
      count++;
    }
    groups[group] = kept;
  }
  return { source: kind, groups };
}

/** True when a copied look holds any value. */
export function hasValues(style: CopiedStyle): boolean {
  return Object.values(style.groups).some((values) => values && Object.keys(values).length > 0);
}

/** A text note's default text colour. */
export const NOTE_TEXT_COLOR = '#1d1d1b';
const NOTE_STROKE = '#2b2b2b';

/** Which kind of note this is for Copy and Paste properties; null when it has no look to copy (a link). */
export function noteClass(note: CanvasNote): 'text-note' | 'shape-note' | 'image-note' | 'line-note' | null {
  if (!note.kind || note.kind === 'sticky' || note.kind === 'title1') return 'text-note';
  if (note.kind === 'rect' || note.kind === 'oval') return 'shape-note';
  if (note.kind === 'image') return 'image-note';
  if (note.kind === 'line' || note.kind === 'arrow' || note.kind === 'pen') return 'line-note';
  return null;
}

/** A canvas note's look, or null when it has none to copy. */
export function copyNoteStyle(note: CanvasNote): CopiedStyle | null {
  const kind = noteClass(note);
  if (!kind) return null;
  if (kind === 'text-note') {
    const sticky = note.kind !== 'title1';
    const text: Declarations = {
      'font-size': `${noteFontSize(note.size, note.kind)}px`,
      'font-weight': note.bold ? '700' : '400',
      'font-style': note.italic ? 'italic' : 'normal',
      color: noteColor(note.color, 'stroke', NOTE_TEXT_COLOR),
    };
    const fill = noteColor(note.fill, 'sticky', sticky ? DEFAULT_STICKY : 'transparent');
    return { source: kind, groups: { text, fill: clear(fill) ? {} : { 'background-color': fill } } };
  }
  if (kind === 'line-note') {
    const stroke = noteStroke(note);
    const dashes = note.dash ? dashesFor(note.dash, stroke.width) : note.css?.['stroke-dasharray'];
    return { source: kind, groups: { paint: { stroke: stroke.color ?? NOTE_STROKE, 'stroke-width': `${stroke.width}px`, ...(dashes && dashes !== 'none' ? { 'stroke-dasharray': dashes } : {}) } } };
  }
  const css = note.css ?? {};
  const one = (key: 'box-shadow' | 'filter' | 'backdrop-filter' | 'opacity'): Declarations => (css[key] ? { [key]: css[key]! } : {});
  if (kind === 'image-note') {
    // A picture has no border and square corners until its css gives them.
    const border: Declarations = {};
    for (const [key, value] of Object.entries(css)) if (groupOf(key) === 'border' || key === 'border-position') border[key] = value;
    const radius: Declarations = {};
    for (const [key, value] of Object.entries(css)) if (groupOf(key) === 'radius') radius[key] = value;
    return {
      source: kind,
      groups: {
        border: drawnBorder(border) ? border : {},
        radius: Object.keys(radius).length ? radius : { 'border-radius': '0px' },
        shadow: one('box-shadow'),
        filter: one('filter'),
        backdrop: one('backdrop-filter'),
        opacity: one('opacity'),
      },
    };
  }
  const fill = shapeFill(note);
  const border: Declarations = {};
  for (const [key, value] of Object.entries(css)) if (groupOf(key) === 'border' || key === 'border-position') border[key] = value;
  if (!Object.keys(border).length) Object.assign(border, { 'border-width': `${NOTE_BORDER_WIDTH}px`, 'border-style': 'solid', 'border-color': noteColor(note.color, 'stroke', NOTE_STROKE) });
  const radius: Declarations = {};
  if (note.kind === 'rect') {
    for (const [key, value] of Object.entries(css)) if (groupOf(key) === 'radius') radius[key] = value;
    if (!Object.keys(radius).length) radius['border-radius'] = `${NOTE_RECT_RADIUS}px`;
  }
  return {
    source: kind,
    groups: {
      fill: clear(fill) ? {} : /gradient\(/i.test(fill) ? { 'background-image': fill } : { 'background-color': fill },
      border: border['border-style'] === 'none' ? {} : border,
      ...(note.kind === 'rect' ? { radius } : {}),
      shadow: one('box-shadow'),
      filter: one('filter'),
      backdrop: one('backdrop-filter'),
      opacity: one('opacity'),
    },
  };
}

/**
 * An artboard's look: its page background (see `lib/page-fill.ts`; white
 * when nothing sets one) and its corner radius (0 when it has none).
 */
export function copyBoardStyle(radius: number | undefined, fill: Declarations): CopiedStyle {
  return { source: 'board', groups: { fill, radius: { 'border-radius': `${radius ?? 0}px` } } };
}

/* -------------------------------- converting -------------------------------- */

/** A box's fill and border as a shape's paint. */
function boxToPaint(fill: Declarations | undefined, border: Declarations | undefined): Declarations {
  const out: Declarations = {};
  const color = fill?.['background-color'] ?? (fill?.background && !/gradient\(|url\(/i.test(fill.background) ? fill.background : undefined);
  if (fill && !fill['background-image'] && color && !clear(color)) out.fill = paintColor(color, undefined);
  const drawn = border ? drawnBorder(border) : null;
  if (drawn) {
    out.stroke = paintColor(drawn.color, undefined);
    out['stroke-width'] = `${drawn.width}px`;
    out['stroke-dasharray'] = dashesFor(drawn.style, drawn.width);
  }
  return out;
}

/** A shape's paint as a box's fill and border. */
function paintToBox(paint: Declarations): { fill: Declarations; border: Declarations } {
  const fill: Declarations = {};
  const border: Declarations = {};
  if (paint.fill && !clear(paint.fill)) fill['background-color'] = paintColor(paint.fill, paint['fill-opacity']);
  const width = widthPx(paint['stroke-width'] ?? '1');
  if (paint.stroke && !clear(paint.stroke) && width !== null && width > 0) {
    border['border-width'] = `${width}px`;
    border['border-style'] = borderStyleFor(paint['stroke-dasharray']);
    border['border-color'] = paintColor(paint.stroke, paint['stroke-opacity']);
  }
  return { fill, border };
}

/** The copied groups as the target's kind takes them: converted between boxes and shapes. */
export function groupsFor(copied: CopiedStyle, takes: readonly StyleGroup[]): Partial<Record<StyleGroup, Declarations>> {
  const groups = { ...copied.groups };
  if (takes.includes('paint') && !groups.paint && (groups.fill || groups.border)) groups.paint = boxToPaint(groups.fill, groups.border);
  if (!takes.includes('paint') && groups.paint && !groups.fill && !groups.border) {
    const box = paintToBox(groups.paint);
    groups.fill = box.fill;
    groups.border = box.border;
  }
  return Object.fromEntries(Object.entries(groups).filter(([group]) => takes.includes(group as StyleGroup)));
}

/* --------------------------------- pasting --------------------------------- */

/** A reset that covers what a class gives, and when the target needs it: a computed value that is not the default. */
interface Reset {
  property: string;
  value: string;
  shows(computed: Declarations): boolean;
}

const differs = (key: string, ...defaults: string[]) => (computed: Declarations) => computed[key] !== undefined && computed[key] !== '' && !defaults.includes(computed[key]!.trim());
const anySide = (part: string, ...defaults: string[]) => (computed: Declarations) => SIDES.some((side) => differs(`border-${side}-${part}`, ...defaults)(computed));
const clipsText = differs('background-clip', 'border-box');

/** What each group resets when it is pasted. */
export const RESETS: Record<StyleGroup, readonly Reset[]> = {
  fill: [
    { property: 'background', value: 'none', shows: (c) => differs('background-image', 'none')(c) || !clear(c['background-color']) },
    { property: 'background-clip', value: 'border-box', shows: clipsText },
    { property: '-webkit-background-clip', value: 'border-box', shows: clipsText },
    { property: '-webkit-text-fill-color', value: 'currentcolor', shows: clipsText },
  ],
  border: [{ property: 'border', value: 'none', shows: anySide('style', 'none', 'hidden') }],
  outline: [{ property: 'outline', value: 'none', shows: differs('outline-style', 'none') }],
  radius: [{ property: 'border-radius', value: '0', shows: (c) => ['top-left', 'top-right', 'bottom-right', 'bottom-left'].some((corner) => !isZero(c[`border-${corner}-radius`] ?? '0')) }],
  shadow: [{ property: 'box-shadow', value: 'none', shows: differs('box-shadow', 'none') }],
  filter: [{ property: 'filter', value: 'none', shows: differs('filter', 'none') }],
  backdrop: [{ property: 'backdrop-filter', value: 'none', shows: differs('backdrop-filter', 'none') }],
  blend: [{ property: 'mix-blend-mode', value: 'normal', shows: differs('mix-blend-mode', 'normal') }],
  opacity: [{ property: 'opacity', value: '1', shows: differs('opacity', '1') }],
  text: [
    { property: 'font-style', value: 'normal', shows: differs('font-style', 'normal') },
    { property: 'line-height', value: 'normal', shows: differs('line-height', 'normal') },
    { property: 'letter-spacing', value: 'normal', shows: differs('letter-spacing', 'normal', '0px') },
    { property: 'text-align', value: 'start', shows: differs('text-align', 'start', 'left') },
    { property: 'text-transform', value: 'none', shows: differs('text-transform', 'none') },
    { property: 'text-decoration', value: 'none', shows: differs('text-decoration-line', 'none') },
    { property: 'text-shadow', value: 'none', shows: differs('text-shadow', 'none') },
  ],
  paint: [
    { property: 'fill-opacity', value: '1', shows: differs('fill-opacity', '1') },
    { property: 'stroke-opacity', value: '1', shows: differs('stroke-opacity', '1') },
    { property: 'stroke-dasharray', value: 'none', shows: differs('stroke-dasharray', 'none') },
    { property: 'stroke-linecap', value: 'butt', shows: differs('stroke-linecap', 'butt') },
    { property: 'stroke-linejoin', value: 'miter', shows: differs('stroke-linejoin', 'miter') },
  ],
};

/** Every reset value, by property (the full table). */
export const RESET_VALUES: Readonly<Record<string, string>> = Object.fromEntries(Object.values(RESETS).flatMap((resets) => resets.map((reset) => [reset.property, reset.value])));

/** Which way a line element runs. */
export type LineRun = 'across' | 'down';

/**
 * The inline style an element has once the copied look is pasted: its own
 * declarations of each pasted group dropped, a reset written where the
 * target still shows a class's value the paste does not set, then the
 * copied values. Null when its kind takes none of the copied groups.
 */
export function pastedElementStyle(copied: CopiedStyle, kind: ElementClass, inline: Declarations, computed: Declarations, run: LineRun = 'across'): Declarations | null {
  const takes = GROUPS_OF[kind];
  let groups = groupsFor(copied, takes);
  if (kind === 'rule' && copied.groups.paint && !copied.groups.border) groups = { ...groups, border: paintToBox(copied.groups.paint).border };
  const pasted = Object.keys(groups) as StyleGroup[];
  if (!pasted.length) return null;
  const out: Declarations = {};
  for (const [key, value] of Object.entries(inline)) {
    const group = groupOf(key);
    if (!group || !pasted.includes(group)) out[key] = value;
  }
  for (const group of pasted) {
    const values = kind === 'rule' && group === 'border' ? ruleBorder(groups.border!, run) : groups[group]!;
    for (const reset of RESETS[group]) {
      if (values[reset.property] !== undefined) continue;
      const covered = Object.keys(values).some((key) => key.startsWith(`${reset.property}-`) || reset.property.startsWith(`${key}-`));
      // A shorthand reset goes first, so the copied longhands after it win.
      if (covered && reset.property !== 'background' && reset.property !== 'border') continue;
      if (reset.shows(computed)) out[reset.property] = reset.value;
    }
    // Where a note's border sits is no CSS an element takes.
    for (const [key, value] of Object.entries(values)) if (key !== 'border-position') out[key] = value;
  }
  return out;
}

/** A border on a line element: only its top edge (across) or its left edge (down), over no fill. */
function ruleBorder(border: Declarations, run: LineRun): Declarations {
  const drawn = drawnBorder(border);
  if (!drawn) return { 'background-color': 'transparent', 'border-style': 'none' };
  return {
    'background-color': 'transparent',
    'border-width': run === 'across' ? `${drawn.width}px 0px 0px` : `0px 0px 0px ${drawn.width}px`,
    'border-style': drawn.style,
    'border-color': drawn.color,
  };
}

/* ----------------------------- notes and artboards ----------------------------- */

const STICKY_FILLS = (Object.keys(NOTE_PALETTE) as NoteColor[]).map((name) => [name, NOTE_PALETTE[name].sticky] as const);
const STROKES = (Object.keys(NOTE_PALETTE) as NoteColor[]).map((name) => [name, NOTE_PALETTE[name].stroke] as const);

/** Below this OKLab chroma a colour has no hue. */
const GRAY_CHROMA = 0.03;

/**
 * The palette colour nearest `color` for a note: the same colour if the
 * palette has it; a colour without hue is gray (text only between lightness
 * 0.4 and 0.85, else the default); any other the palette colour of the
 * nearest hue (a fill may also get the default). Undefined = the default.
 */
export function nearestNoteColor(color: string, role: 'text' | 'fill'): NoteColor | undefined {
  const parsed = parseColor(color);
  if (!parsed) return undefined;
  const hex = formatHex({ ...parsed.rgba, a: 1 });
  const choices: (readonly [NoteColor | undefined, string])[] = role === 'fill' ? [...STICKY_FILLS, [undefined, DEFAULT_STICKY]] : STROKES;
  const same = choices.find(([, value]) => value.toLowerCase() === hex);
  if (same) return same[0];
  const lab = rgbaToOklch(parsed.rgba);
  if (lab.c < GRAY_CHROMA) return role === 'fill' || (lab.l >= 0.4 && lab.l <= 0.85) ? 'gray' : undefined;
  let best: NoteColor | undefined;
  let gap = Infinity;
  for (const [name, value] of choices) {
    const other = rgbaToOklch(parseColor(value)!.rgba);
    if (other.c < GRAY_CHROMA) continue;
    const turn = Math.abs(((lab.h - other.h + 540) % 360) - 180);
    if (turn < gap) {
      gap = turn;
      best = name;
    }
  }
  return best;
}

/** A note with `key` set, or without it when `value` is undefined. */
function withKey(note: CanvasNote, key: string, value: unknown): CanvasNote {
  const next: CanvasNote = { ...note };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

/** The css keys of a shape note each group writes. */
const NOTE_CSS_GROUP: Partial<Record<StyleGroup, (key: string) => boolean>> = {
  fill: (key) => key === 'background' || key === 'background-color',
  border: (key) => (groupOf(key) === 'border' && !key.endsWith('-style') && !key.endsWith('-color')) || key === 'border-style' || key === 'border-color' || key === 'border-position',
  radius: (key) => groupOf(key) === 'radius',
  shadow: (key) => key === 'box-shadow',
  filter: (key) => key === 'filter',
  backdrop: (key) => key === 'backdrop-filter',
  opacity: (key) => key === 'opacity',
};

/** One group's copied values as a shape note's css. */
function noteCssOf(group: StyleGroup, values: Declarations): Declarations {
  if (group === 'fill') {
    const image = values['background-image'] ?? (values.background && /gradient\(/i.test(values.background) ? values.background : undefined);
    if (image) return { background: image };
    const color = values['background-color'] ?? values.background;
    return { 'background-color': color && !clear(color) ? paintColor(color, undefined) : 'transparent' };
  }
  if (group === 'border') {
    const drawn = drawnBorder(values);
    if (!drawn) return { 'border-style': 'none' };
    return { 'border-width': `${drawn.width}px`, 'border-style': drawn.style, 'border-color': drawn.color, ...(values['border-position'] ? { 'border-position': values['border-position'] } : {}) };
  }
  if (group === 'radius') {
    const value = values['border-radius'];
    if (value && tokens(value).length > 1) {
      const [tl, tr, br, bl] = perSide(value);
      return { 'border-top-left-radius': tl, 'border-top-right-radius': tr, 'border-bottom-right-radius': br, 'border-bottom-left-radius': bl };
    }
    return { ...values, ...(Object.keys(values).length ? {} : { 'border-radius': '0px' }) };
  }
  return values;
}

/**
 * A note once the copied look is pasted on it, or null when it takes none
 * of it. A shape note's css takes the box groups (a shape's paint as a fill
 * and border); a text note takes the text size, weight, slant and colour,
 * and the fill, as the nearest palette colours; a line takes the stroke.
 * `valid` keeps only the css a note takes.
 */
export function pastedNote(copied: CopiedStyle, note: CanvasNote, valid: (key: string, value: string) => string | null): CanvasNote | null {
  const kind = noteClass(note);
  if (!kind) return null;
  const takes = NOTE_GROUPS[kind].filter((group) => !(note.kind === 'oval' && group === 'radius'));
  const groups = groupsFor(copied, takes);
  const pasted = Object.keys(groups) as StyleGroup[];
  if (!pasted.length) return null;
  if (kind === 'shape-note' || kind === 'image-note') {
    const css: Declarations = {};
    for (const [key, value] of Object.entries(note.css ?? {})) if (!pasted.some((group) => NOTE_CSS_GROUP[group]?.(key))) css[key] = value;
    for (const group of pasted) for (const [key, value] of Object.entries(noteCssOf(group, groups[group]!))) {
      const kept = valid(key, value);
      if (kept !== null) css[key] = kept;
    }
    return withKey(note, 'css', Object.keys(css).length ? css : undefined);
  }
  if (kind === 'line-note') {
    const paint = groups.paint ?? {};
    let next = note;
    if (paint.stroke && !clear(paint.stroke)) next = withKey(next, 'color', paint.stroke);
    const width = widthPx(paint['stroke-width']);
    if (width !== null && width > 0) next = withKey(next, 'stroke', Math.max(0.1, Math.min(100, Math.round(width * 100) / 100)));
    const style = borderStyleFor(paint['stroke-dasharray']);
    return withKey(next, 'dash', style === 'solid' ? undefined : style);
  }
  let next = note;
  const text = groups.text;
  if (text) {
    const size = widthPx(text['font-size']);
    if (size !== null && size > 0) next = withKey(next, 'size', Math.max(8, Math.min(400, Math.round(size))));
    const weight = text['font-weight'] === 'bold' ? 700 : Number(text['font-weight']);
    if (text['font-weight'] !== undefined) next = withKey(next, 'bold', Number.isFinite(weight) && weight >= 600 ? true : undefined);
    if (text['font-style'] !== undefined) next = withKey(next, 'italic', /italic|oblique/.test(text['font-style']) ? true : undefined);
    if (text.color) next = withKey(next, 'color', nearestNoteColor(text.color, 'text'));
  }
  const fill = groups.fill;
  if (fill) {
    const color = fill['background-color'] ?? fill.background;
    // A fill drawn from an image (a gradient) is no palette colour: the note keeps its own.
    if (!fill['background-image'] && !(color && /gradient\(|url\(/i.test(color))) next = withKey(next, 'fill', color && !clear(color) ? nearestNoteColor(color, 'fill') : undefined);
  }
  return next;
}

/**
 * An artboard's radius once the copied look is pasted, or null when the
 * copy has no radius group or a corner isn't in px. An artboard keeps one
 * radius: the top-left corner's when the corners differ.
 */
export function pastedBoardRadius(copied: CopiedStyle): number | undefined | null {
  const radius = copied.groups.radius;
  if (!radius) return null;
  const corners = radius['border-radius'] !== undefined
    ? perSide(radius['border-radius'])
    : (['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const).map((corner) => radius[`border-${corner}-radius`] ?? '0px');
  const values = corners.map((corner) => (/^(-?\d*\.?\d+)(px)?$/.test(corner.trim()) && (corner.trim().endsWith('px') || /^0+(\.0+)?$/.test(corner.trim())) ? widthPx(corner) : null));
  if (values.some((value) => value === null)) return null;
  const value = values[0]!;
  return value > 0 ? Math.round(value) : undefined;
}

/* ------------------------------- what is said ------------------------------- */

export const STYLE_CLIPBOARD_TEXT = {
  copied: 'Properties copied',
  copyFailed: 'Couldn’t copy the properties. Try again.',
  justOne: 'Select just one element to copy its properties',
  nothing: 'This element has no properties to copy.',
  copyFirst: 'Copy an element’s properties first.',
  selectTargets: 'Select the elements to paste the properties onto.',
  component: 'This is part of a component. Open the component to copy or paste properties there.',
  pasteFailed: 'Couldn’t paste the properties. Try again.',
};

/** What a paste says: how many took the properties, and how many couldn’t. */
export function pasteReport(pasted: number, refused: number): string {
  if (!refused) return pasted === 1 ? 'Properties pasted' : `Properties pasted onto ${pasted} elements`;
  if (!pasted) return refused === 1 ? 'The copied properties can’t be pasted onto this element.' : 'The copied properties can’t be pasted onto these elements.';
  return refused === 1 ? 'Properties pasted. 1 element couldn’t take them.' : `Properties pasted. ${refused} elements couldn’t take them.`;
}

/* ---------------------------------- storage ---------------------------------- */

/** Where the copied look is kept between sessions and tabs. */
export const STYLE_CLIPBOARD_KEY = 'mc-design/style-clipboard';

/** Reads the copied look, or null when there is none (or it can't be read). */
export function readCopiedStyle(storage: () => Storage | undefined = () => globalThis.localStorage): CopiedStyle | null {
  try {
    const raw = storage()?.getItem(STYLE_CLIPBOARD_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as CopiedStyle;
    if (!value || typeof value !== 'object' || typeof value.source !== 'string' || !value.groups || typeof value.groups !== 'object') return null;
    return value;
  } catch {
    return null;
  }
}

/** Keeps the copied look; false when it can't be written. */
export function writeCopiedStyle(style: CopiedStyle, storage: () => Storage | undefined = () => globalThis.localStorage): boolean {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(STYLE_CLIPBOARD_KEY, JSON.stringify(style));
    return true;
  } catch {
    return false;
  }
}
