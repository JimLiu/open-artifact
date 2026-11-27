/**
 * How a shape note (rectangle or oval) is drawn, from its palette colours and
 * its `css`: one answer for both canvas renderers. The GPU scene draws the
 * plain looks itself (a solid fill, one even border inside the edge, one
 * corner radius); any other look (a gradient, effects, a border at the
 * centre or outside the edge, sides or corners that differ) is drawn by the
 * DOM body instead, and the scene keeps only a clear box to hit.
 */

import { noteBorderDeclarations, type CanvasNote, type NoteCss } from '@open-artifact/design-core';
import { noteColor } from './notes.ts';

/** The default shape note: a 3px border in the stroke colour, and a 6px corner on a rectangle. */
export const NOTE_BORDER_WIDTH = 3;
export const NOTE_RECT_RADIUS = 6;
const NOTE_STROKE = '#2b2b2b';

/** The border keys of a note's css (its radius aside). */
const BORDER_KEY = /^border-(?!.*radius)/;

/** What the GPU scene draws for a shape note it can draw itself. */
export interface EngineShape {
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  dash?: [number, number];
  opacity?: number;
}

/** A shape note's look. */
export interface ShapeLook {
  /** The body's CSS, for the DOM renderer. */
  dom: Record<string, string>;
  /** What the GPU scene draws, or null when the DOM body draws it. */
  engine: EngineShape | null;
}

/** The fill a shape note shows: its css background, else its palette or CSS colour. */
export function shapeFill(note: CanvasNote): string {
  const css = note.css ?? {};
  return css.background ?? css['background-color'] ?? noteColor(note.fill, 'sticky', 'transparent');
}

/** Whether a note's css sets its border; without, it has the palette border. */
export function hasCssBorder(css: NoteCss | undefined): boolean {
  return Object.keys(css ?? {}).some((key) => BORDER_KEY.test(key) && key !== 'border-position');
}

/** A shape note's corner radius as CSS: its css, else 6px on a rectangle; an oval is always round. */
export function shapeRadius(note: CanvasNote): string {
  if (note.kind === 'oval') return '50%';
  return note.css?.['border-radius'] ?? `${NOTE_RECT_RADIUS}px`;
}

/** A radius worth remembering for the next rectangle, rounded to 0.01, or null. */
export function rememberedRadius(radius: number): number | null {
  return Number.isFinite(radius) && radius >= 0 ? Math.round(radius * 100) / 100 : null;
}

/** A new rectangle with the remembered radius; the default radius is written as no css at all. */
export function withRectRadius(note: CanvasNote, remembered: number): CanvasNote {
  if (note.kind !== 'rect' || remembered === NOTE_RECT_RADIUS || note.css?.['border-radius']) return note;
  return { ...note, css: { ...note.css, 'border-radius': `${remembered}px` } };
}

/** A CSS length in px as a number, or null. */
function px(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^(\d*\.?\d+)(px)?$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

/** The look of a rectangle or oval note. */
export function shapeLook(note: CanvasNote): ShapeLook {
  const css = note.css ?? {};
  const cssBorder = hasCssBorder(css);
  const fill = shapeFill(note);
  const border: Record<string, string> = cssBorder
    ? noteBorderDeclarations(css)
    : { 'border-width': `${NOTE_BORDER_WIDTH}px`, 'border-style': 'solid', 'border-color': noteColor(note.color, 'stroke', NOTE_STROKE) };
  const corners = (['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const).flatMap((corner) => {
    const value = note.kind === 'oval' ? undefined : css[`border-${corner}-radius`];
    return value === undefined ? [] : [[`border-${corner}-radius`, value] as const];
  });
  const dom: Record<string, string> = {
    background: fill,
    ...(cssBorder ? { 'border-style': 'none' } : {}),
    ...border,
    'border-radius': shapeRadius(note),
    ...Object.fromEntries(corners),
    ...(css['box-shadow'] ? { 'box-shadow': css['box-shadow'] } : {}),
    ...(css.filter ? { filter: css.filter } : {}),
    ...(css['backdrop-filter'] ? { 'backdrop-filter': css['backdrop-filter'] } : {}),
    ...(css.opacity ? { opacity: css.opacity } : {}),
  };
  return { dom, engine: engineShape(note, fill, border, corners.length > 0) };
}

/** The GPU scene's shape, or null when only the DOM can draw this look. */
function engineShape(note: CanvasNote, fill: string, border: Record<string, string>, corners: boolean): EngineShape | null {
  const css = note.css ?? {};
  if (/gradient\(/i.test(fill) || css['box-shadow'] || css.filter || css['backdrop-filter'] || corners || 'outline' in border) return null;
  const radius = note.kind === 'oval' ? 0 : px(shapeRadius(note));
  if (radius === null) return null;
  const opacity = css.opacity === undefined ? undefined : css.opacity.endsWith('%') ? Number.parseFloat(css.opacity) / 100 : Number(css.opacity);
  const style = border['border-style'] ?? 'none';
  const sides = ['top', 'right', 'bottom', 'left'].map((side) => border[`border-${side}-width`] ?? border['border-width'] ?? 'medium');
  const width = style === 'none' ? 0 : px(sides[0] === 'medium' ? '3px' : sides[0] === 'thin' ? '1px' : sides[0] === 'thick' ? '5px' : sides[0]);
  if (width === null || !sides.every((side) => side === sides[0]) || !['none', 'solid', 'dashed', 'dotted'].includes(style)) return null;
  const color = border['border-color'] ?? 'currentcolor';
  if (/\s/.test(color.replace(/\([^)]*\)/g, ''))) return null;
  const dash: [number, number] | undefined = style === 'dashed' ? [width * 3, width * 3] : style === 'dotted' ? [0.01, width * 2] : undefined;
  return {
    fill,
    stroke: color === 'currentcolor' ? NOTE_STROKE : color,
    strokeWidth: width,
    radius,
    ...(dash ? { dash } : {}),
    ...(opacity !== undefined && Number.isFinite(opacity) ? { opacity: Math.max(0, Math.min(1, opacity)) } : {}),
  };
}

/** CSS declarations as a React style object (`border-top-width` → `borderTopWidth`). */
export function reactStyle(declarations: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(declarations).map(([key, value]) => [key.replace(/-([a-z])/g, (_m, letter: string) => letter.toUpperCase()), value]));
}

/** A note's css opacity as a number 0–1, or undefined when it sets none. */
export function noteOpacity(note: CanvasNote): number | undefined {
  const value = note.css?.opacity;
  if (value === undefined) return undefined;
  const n = value.endsWith('%') ? Number.parseFloat(value) / 100 : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : undefined;
}

/** The background an image note shows while it has no picture (and no fill of its own). */
export const IMAGE_PLACEHOLDER = '#e8e6e1';

/** An image note's look: CSS for the `<img>`, and whether the GPU scene can draw it as a plain texture. */
export interface ImageLook {
  dom: Record<string, string>;
  engine: boolean;
}

/**
 * How an image note is drawn, from its `css`: the picture fills its box
 * (`object-fit: fill` unless the css says otherwise), square corners, no
 * border until a width is given (then solid unless a style is), a border
 * at the centre or outside the edge drawn as an outline, the effects,
 * see-through and a background color as written, and a placeholder color
 * while there is no picture. The GPU scene draws only the plain picture.
 */
export function imageLook(note: CanvasNote): ImageLook {
  const css: NoteCss = { ...note.css };
  const widths = Object.keys(css).some((key) => /^border(-(top|right|bottom|left))?-width$/.test(key));
  if (!css['border-style']) css['border-style'] = widths ? 'solid' : 'none';
  const border = noteBorderDeclarations(css);
  const corners = (['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const).flatMap((corner) => {
    const value = css[`border-${corner}-radius`];
    return value === undefined ? [] : [[`border-${corner}-radius`, value] as const];
  });
  const background = css['background-color'] ?? (note.src ? undefined : IMAGE_PLACEHOLDER);
  const dom: Record<string, string> = {
    'box-sizing': 'border-box',
    'object-fit': css['object-fit'] ?? 'fill',
    ...(css['object-position'] ? { 'object-position': css['object-position'] } : {}),
    ...('outline' in border ? { 'border-style': 'none' } : {}),
    ...border,
    'border-radius': css['border-radius'] ?? '0px',
    ...Object.fromEntries(corners),
    ...(css['box-shadow'] ? { 'box-shadow': css['box-shadow'] } : {}),
    ...(css.filter ? { filter: css.filter } : {}),
    ...(css['backdrop-filter'] ? { 'backdrop-filter': css['backdrop-filter'] } : {}),
    ...(css.opacity ? { opacity: css.opacity } : {}),
    ...(background ? { 'background-color': background } : {}),
  };
  const drawnBorder = css['border-style'] !== 'none' && css['border-style'] !== 'hidden';
  const radius = [css['border-radius'], ...corners.map(([, value]) => value)].some((value) => value !== undefined && px(value) !== 0);
  const opacity = noteOpacity(note);
  const engine =
    !drawnBorder && !radius && !css['box-shadow'] && !css.filter && !css['backdrop-filter'] && css['background-color'] === undefined &&
    (css['object-fit'] === undefined || css['object-fit'] === 'fill') && css['object-position'] === undefined && (opacity === undefined || opacity >= 1);
  return { dom, engine };
}
