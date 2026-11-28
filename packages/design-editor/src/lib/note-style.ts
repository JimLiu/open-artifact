/**
 * The style a note's quick strip shows and writes: a text note's kind,
 * size, weight, slant, ink and fill; a shape's fill; a line's colour and
 * dash. Each write is a patch of the note's keys (`undefined` removes one),
 * one undo step each.
 */

import { noteFontSize, type CanvasNote, type NoteSize } from '@open-artifact/design-core';

/** Keys to write on a note; `undefined` removes one. */
export type NotePatch = Partial<Record<keyof CanvasNote, unknown>>;

/** A text note is a sticky (no `kind`) or a title. */
export type TextKind = 'sticky' | 'title1';

/** The named text sizes, smallest first. */
export const NOTE_SIZE_PRESETS: readonly { key: Exclude<NoteSize, number>; label: string; px: number }[] = [
  { key: 's', label: 'Small', px: 14 },
  { key: 'm', label: 'Medium', px: 24 },
  { key: 'l', label: 'Large', px: 40 },
  { key: 'xl', label: 'Extra large', px: 72 },
  { key: 'xxl', label: 'Huge', px: 120 },
];

/** The smallest and largest size a note's text takes, px. */
export const NOTE_SIZE_MIN = 8;
export const NOTE_SIZE_MAX = 400;

export const isTextNote = (note: CanvasNote): boolean => !note.kind || note.kind === 'sticky' || note.kind === 'title1';

export const textKind = (note: CanvasNote): TextKind => (note.kind === 'title1' ? 'title1' : 'sticky');

/** What a text note's strip shows. */
export interface TextStyle {
  kind: TextKind;
  px: number;
  /** The named size it has, or null for a size of its own. */
  preset: (typeof NOTE_SIZE_PRESETS)[number] | null;
  bold: boolean;
  italic: boolean;
  /** Named or CSS ink colour; undefined is the default ink. */
  ink: string | undefined;
  /** A sticky's named or CSS fill; undefined is the default yellow (and a title has none). */
  fill: string | undefined;
}

export function readTextStyle(note: CanvasNote): TextStyle {
  const kind = textKind(note);
  const px = noteFontSize(note.size, note.kind);
  return {
    kind,
    px,
    preset: NOTE_SIZE_PRESETS.find((preset) => preset.px === px) ?? null,
    bold: note.bold ?? kind === 'title1',
    italic: note.italic ?? false,
    ink: note.color || undefined,
    fill: kind === 'sticky' ? note.fill || undefined : undefined,
  };
}

/** A change from the strip: a named size or px, a kind, a toggle or a colour (`null`: back to the default). */
export type TextRestyle =
  | { kind: TextKind }
  | { size: Exclude<NoteSize, number> | number }
  | { bold: boolean }
  | { italic: boolean }
  | { ink: string | null }
  | { fill: string | null };

/**
 * The keys a restyle writes. A new kind starts from that kind's own look:
 * its default size, weight, slant and colours, and none of the old kind's
 * box limits (`h`, `maxW`, `maxH`); the words, place and width stay.
 */
export function restylePatch(note: CanvasNote, change: TextRestyle): NotePatch {
  const kind = textKind(note);
  if ('kind' in change) {
    if (change.kind === kind) return {};
    return {
      kind: change.kind === 'title1' ? 'title1' : undefined,
      size: undefined,
      bold: undefined,
      italic: undefined,
      color: undefined,
      fill: undefined,
      h: undefined,
      maxW: undefined,
      maxH: undefined,
    };
  }
  if ('size' in change) {
    // A named size is written by its name, as the Properties panel writes it; any other size as px.
    if (typeof change.size === 'string') return { size: change.size };
    const px = Math.max(NOTE_SIZE_MIN, Math.min(NOTE_SIZE_MAX, Math.round(change.size)));
    return { size: NOTE_SIZE_PRESETS.find((preset) => preset.px === px)?.key ?? px };
  }
  if ('bold' in change) return { bold: change.bold === (kind === 'title1') ? undefined : change.bold };
  if ('italic' in change) return { italic: change.italic ? true : undefined };
  if ('ink' in change) return { color: change.ink ?? undefined };
  return kind === 'sticky' ? { fill: change.fill ?? undefined } : {};
}

/** A rectangle's or oval's fill from its strip: a named colour, or none (no fill and no css background). */
export function shapeFillPatch(note: CanvasNote, fill: string | null): NotePatch {
  const css = { ...note.css };
  delete css.background;
  delete css['background-color'];
  return { fill: fill ?? undefined, css: Object.keys(css).length ? css : undefined };
}

/** A line's, arrow's or drawing's colour from its strip: a named colour, or the default (`null`); a css stroke gives way. */
export function lineColorPatch(note: CanvasNote, color: string | null): NotePatch {
  const css = { ...note.css };
  delete css.stroke;
  return { color: color ?? undefined, css: Object.keys(css).length ? css : undefined };
}

export type LineStyle = 'solid' | 'dashed' | 'dotted';

/** A line's dash from its strip; its own css dash pattern gives way. */
export function lineStylePatch(note: CanvasNote, style: LineStyle): NotePatch {
  const css = { ...note.css };
  delete css['stroke-dasharray'];
  return { dash: style === 'solid' ? undefined : style, css: Object.keys(css).length ? css : undefined };
}

/** The dash a line shows: its own key, else its css dash pattern read as dashed or dotted. */
export function lineStyleOf(note: CanvasNote): LineStyle {
  if (note.dash === 'dashed' || note.dash === 'dotted') return note.dash;
  const pattern = note.css?.['stroke-dasharray']?.split(/[\s,]+/).map(Number) ?? [];
  if (pattern.length < 2 || !pattern.some((n) => n > 0)) return 'solid';
  return pattern[0]! < 1 ? 'dotted' : 'dashed';
}
