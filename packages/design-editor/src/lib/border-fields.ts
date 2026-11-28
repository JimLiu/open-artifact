/**
 * The border fields of an element: its style, color and the width of each
 * side, read from the inline style (missing parts from the computed one)
 * and written so the change wins over what is already written — a part of
 * a `border` shorthand is changed in the shorthand.
 */

import type { StylePatch } from '@open-artifact/dc';
import { splitShorthand } from './border-align.ts';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** The styles the Border field offers. */
export const BORDER_STYLES = ['none', 'solid', 'dashed', 'dotted', 'double'] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

/** Said while the four widths differ and only the one field shows. */
export const WIDTHS_DIFFER = 'The values differ — make them equal to use one field';

const fourOf = (value: string | undefined): string[] | null => {
  if (!value?.trim()) return null;
  const [a, b = a, c = a, d = b] = value.trim().split(/\s+(?![^(]*\))/);
  return [a!, b!, c!, d!];
};

/** The border's style as written (first side), else as computed; `none` when there is none. */
export function borderStyleOf(inline: Record<string, string>, computed: Record<string, string>): string {
  return inline['border-top-style'] ?? fourOf(inline['border-style'])?.[0] ?? splitShorthand(inline['border-top']).style ?? splitShorthand(inline.border).style ?? computed['border-top-style'] ?? 'none';
}

/** The border's color as written, or ''. */
export function borderColorOf(inline: Record<string, string>): string {
  return inline['border-top-color'] ?? fourOf(inline['border-color'])?.[0] ?? splitShorthand(inline['border-top']).color ?? splitShorthand(inline.border).color ?? '';
}

/** Each side's width as written ('' when not). */
export function borderWidthsOf(inline: Record<string, string>): string[] {
  const widths = fourOf(inline['border-width']);
  const short = splitShorthand(inline.border).width;
  return SIDES.map((side, i) => inline[`border-${side}-width`] ?? splitShorthand(inline[`border-${side}`]).width ?? widths?.[i] ?? short ?? '');
}

const joinShorthand = (parts: { width?: string; style?: string; color?: string }): string | null =>
  [parts.width, parts.style, parts.color].filter(Boolean).join(' ') || null;

/**
 * Sets the border's style. `none` keeps the width and color written, so
 * picking a style again brings the same border back; a style picked for a
 * box with no width written gets 1px.
 */
export function borderStylePatch(inline: Record<string, string>, computed: Record<string, string>, style: string): StylePatch {
  const patch: Record<string, string | null> = {};
  for (const side of SIDES) if (inline[`border-${side}-style`] !== undefined) patch[`border-${side}-style`] = null;
  const short = inline.border !== undefined ? splitShorthand(inline.border) : null;
  if (short) {
    patch.border = joinShorthand({ ...short, style });
    if (inline['border-style'] !== undefined) patch['border-style'] = null;
  } else patch['border-style'] = style;
  // A zero width (`border: 0`) is no width: the style alone would not show.
  // A keyword or a variable counts as written.
  const widthWritten = borderWidthsOf(inline).some((width) => width !== '' && Number.parseFloat(width) !== 0);
  const shownWidth = Number.parseFloat(computed['border-top-width'] ?? '0') || 0;
  if (style !== 'none' && !widthWritten && shownWidth === 0) {
    if (short) patch.border = joinShorthand({ ...short, width: '1px', style });
    else patch['border-width'] = '1px';
  }
  return patch;
}

/** Sets the border's color on every side. */
export function borderColorPatch(inline: Record<string, string>, color: string): StylePatch {
  const patch: Record<string, string | null> = {};
  for (const side of SIDES) if (inline[`border-${side}-color`] !== undefined) patch[`border-${side}-color`] = null;
  if (inline.border !== undefined) {
    patch.border = joinShorthand({ ...splitShorthand(inline.border), color: color || undefined });
    if (inline['border-color'] !== undefined) patch['border-color'] = null;
  } else patch['border-color'] = color || null;
  return patch;
}

/** Sets one width on every side. */
export function borderWidthPatch(inline: Record<string, string>, width: string): StylePatch {
  const patch: Record<string, string | null> = {};
  for (const side of SIDES) if (inline[`border-${side}-width`] !== undefined) patch[`border-${side}-width`] = null;
  if (inline.border !== undefined) {
    patch.border = joinShorthand({ ...splitShorthand(inline.border), width: width || undefined });
    if (inline['border-width'] !== undefined) patch['border-width'] = null;
  } else patch['border-width'] = width || null;
  return patch;
}

/** Sets each side's width: `border-width` goes, the four `border-<side>-width` are written. */
export function borderSidesPatch(inline: Record<string, string>, widths: string[]): StylePatch {
  const patch: Record<string, string | null> = { 'border-width': null };
  // A width in the shorthand would win over sides written before it.
  const short = splitShorthand(inline.border);
  if (inline.border !== undefined && short.width) patch.border = joinShorthand({ ...short, width: undefined });
  SIDES.forEach((side, i) => (patch[`border-${side}-width`] = widths[i] || null));
  return patch;
}
