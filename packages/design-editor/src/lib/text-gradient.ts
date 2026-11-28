/**
 * Gradient text: a box's background painted through its glyphs
 * (`background-clip: text`). Picking a gradient for the text color writes
 * the background and the clip together; going back to a solid color
 * removes them and writes `color`.
 */

import type { StylePatch } from '@open-artifact/dc';
import { clipsToText } from './paint.ts';

/** The editor's accent (the `ui` accent token), the color a new gradient leans toward. */
export const GRADIENT_ACCENT = '#2563eb';
/** The second stop of a new gradient that is not for text: the editor's foreground. */
export const GRADIENT_DARK = '#1c1c1a';

/** Said on the Fill row while the background paints the text. */
export const FILL_IS_TEXT = 'This background fills the text — change it under Text › Color';

const LAYERED = /gradient\(/i;

/** The declarations that make a background paint the text. */
const TEXT_CLIP: Record<string, string> = {
  'background-clip': 'text',
  '-webkit-background-clip': 'text',
  '-webkit-text-fill-color': 'transparent',
};

/** Whether the background paints the text: the inline clip, else the computed one. */
export const paintsText = clipsToText;

/** The gradient the text is painted with, as written (the shorthand or `background-image`), or null. */
export function textGradientOf(inline: Record<string, string>, computed: Record<string, string> = {}): string | null {
  if (!paintsText(inline, computed)) return null;
  for (const value of [inline.background, inline['background-image']]) if (value && LAYERED.test(value)) return value.trim();
  const image = computed['background-image'];
  return image && LAYERED.test(image) ? image.trim() : null;
}

/* --------------------------------- colors --------------------------------- */

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Reads a hex or rgb()/rgba() color; null for anything else. */
export function readColor(text: string | undefined): Rgba | null {
  const value = (text ?? '').trim().toLowerCase();
  const hex = /^#([\da-f]+)$/.exec(value);
  if (hex && [3, 4, 6, 8].includes(hex[1]!.length)) {
    let digits = hex[1]!;
    if (digits.length <= 4) digits = [...digits].map((c) => c + c).join('');
    const n = (i: number) => Number.parseInt(digits.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: digits.length === 8 ? n(6) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(value);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: alpha };
  }
  if (value === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (value === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  return null;
}

const hexOf = ({ r, g, b }: Rgba): string => `#${[r, g, b].map((n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')).join('')}`;

/** `from` moved `amount` (0–1) of the way to `to`, as #rrggbb. */
export function mixColors(from: string, to: string, amount: number): string {
  const a = readColor(from) ?? { r: 0, g: 0, b: 0, a: 1 };
  const b = readColor(to) ?? a;
  return hexOf({ r: a.r + (b.r - a.r) * amount, g: a.g + (b.g - a.g) * amount, b: a.b + (b.b - a.b) * amount, a: 1 });
}

/** A color that shows (alpha above 0), as #rrggbb, or null. */
const visible = (text: string | undefined): string | null => {
  const color = readColor(text);
  return color && color.a > 0 ? hexOf(color) : null;
};

/** The fallback of `var(--name, fallback)`. */
const varFallback = (text: string | undefined): string | undefined => /^\s*var\(\s*--[\w-]+\s*,\s*(.+)\)\s*$/.exec(text ?? '')?.[1];

/* -------------------------------- gradients ------------------------------- */

/**
 * The gradient a pick starts from: `last`, the one this element had before
 * it went back to a solid color while still selected; else a top-to-bottom
 * linear gradient from the current color (written and visible, else
 * computed, else a variable's fallback, else the accent) to that color
 * moved 60% toward the accent (toward white when it is the accent). Not for
 * text, the second stop is the dark foreground.
 */
export function initialGradient(color: { inline?: string; computed?: string }, forText = true, last: string | null = null): string {
  if (last && LAYERED.test(last)) return last;
  const first = visible(color.inline) ?? visible(color.computed) ?? visible(varFallback(color.inline)) ?? GRADIENT_ACCENT;
  const second = !forText ? GRADIENT_DARK : mixColors(first, first === GRADIENT_ACCENT ? '#ffffff' : GRADIENT_ACCENT, 0.6);
  return `linear-gradient(180deg, ${first} 0%, ${second} 100%)`;
}

/** The first color of a gradient (a hex or rgb color), or null. */
export function firstStopOf(gradient: string): string | null {
  return /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i.exec(gradient)?.[0] ?? null;
}

/**
 * Paints the text with `gradient`: the background and the three clip
 * declarations. A changed declaration keeps its place and a new one goes at
 * the end, so a `background` shorthand added after a clip already written
 * would reset that clip and paint the whole box. The shorthand is written
 * only where it already is, or when the clip is new (it then comes after
 * the shorthand); otherwise the gradient goes in `background-image`, which
 * leaves the clip alone.
 */
export function textGradientPatch(inline: Record<string, string>, gradient: string): StylePatch {
  const clipWritten = inline['background-clip'] !== undefined || inline['-webkit-background-clip'] !== undefined;
  if (inline.background === undefined && clipWritten) return { 'background-image': gradient, ...TEXT_CLIP };
  const patch: Record<string, string | null> = { background: gradient, ...TEXT_CLIP };
  // Written after the shorthand, these would win over it.
  if (inline['background-image'] !== undefined) patch['background-image'] = null;
  if (inline['background-color'] !== undefined) patch['background-color'] = null;
  return patch;
}

/**
 * Back to a solid text color: `color` is written and the clip goes. A clip
 * written on the element is removed; one that comes from a stylesheet can’t
 * be, so the element overrides it (no background, text filled with its color).
 */
export function solidTextPatch(inline: Record<string, string>, color: string | null): StylePatch {
  const own = clipsToText(inline);
  const layer = inline['background-image'] ?? inline.background;
  const patch: Record<string, string | null> = {
    background: own && layer !== undefined ? null : 'none',
    'background-clip': null,
    '-webkit-background-clip': null,
    '-webkit-text-fill-color': own ? null : 'currentcolor',
    color,
  };
  if (inline['background-image'] !== undefined && LAYERED.test(inline['background-image'])) patch['background-image'] = null;
  return patch;
}
