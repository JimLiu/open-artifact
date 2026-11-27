/**
 * What a number field does with what is typed or pasted into it: a value
 * past a limit is held at the limit, a field whose minimum is zero or more
 * drops a minus sign instead of zeroing the value, and text that is no
 * number changes nothing. Each is said out loud, so a screen reader user
 * learns the field did not keep what they typed; the words are the
 * editor's own ({@link NumberEntryWords}).
 */

/** A field's limits. */
export interface NumberBounds {
  min?: number;
  max?: number;
}

/** A field whose lowest value is zero or more: a typed minus sign is dropped. */
export function refusesMinus(bounds: NumberBounds): boolean {
  return bounds.min !== undefined && bounds.min >= 0;
}

/** ASCII hyphen-minus, the dashes U+2010–U+2015, minus sign, small and full-width hyphen-minus. */
const MINUS = /[-‐-―−﹣－]/;

/** The key types a minus sign (ASCII, typographic or full-width). */
export function isMinusKey(key: string): boolean {
  return key.length === 1 && MINUS.test(key);
}

/** Invisible formatting marks some keyboards and locales put around numbers. */
const FORMAT_MARKS = /\p{Cf}/gu;

/** The text, read as a number, starts with a minus sign. */
export function startsWithMinus(text: string): boolean {
  return MINUS.test(text.replace(FORMAT_MARKS, '').trimStart().charAt(0));
}

/**
 * The number typed, or null when the text is not one. `decimal` is the
 * separator the field shows ("." or ","); the other one is taken as grouping.
 */
export function parseEntry(text: string, decimal = '.'): number | null {
  let plain = text
    .replace(FORMAT_MARKS, '')
    .replace(/\s+/g, '')
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/．/g, '.')
    .replace(/，/g, ',')
    .replace(new RegExp(MINUS.source, 'g'), '-')
    .replace(/＋/g, '+');
  plain = decimal === ',' ? plain.replace(/\./g, '').replace(',', '.') : plain.replace(/,/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(plain)) return null;
  const n = Number(plain);
  return Number.isFinite(n) ? n : null;
}

/** `n` held inside the limits. */
export function withinBounds(n: number, bounds: NumberBounds): number {
  if (bounds.max !== undefined && n > bounds.max) return bounds.max;
  if (bounds.min !== undefined && n < bounds.min) return bounds.min;
  return n;
}

/** How a typed value was changed before it was kept. */
export interface EntryOutcome {
  /** The value kept. */
  value: number;
  /** A minus sign the field refuses was left out. */
  minusDropped: boolean;
  /** The value went past this limit and was held at it. */
  limit: 'max' | 'min' | null;
}

/**
 * What typed or pasted text keeps: a refused minus sign left out, then held
 * inside the limits. Null when the text is no number.
 */
export function settleEntry(text: string, bounds: NumberBounds, decimal = '.'): EntryOutcome | null {
  const typed = parseEntry(text, decimal);
  if (typed === null) return null;
  const minusDropped = refusesMinus(bounds) && startsWithMinus(text);
  const asMeant = minusDropped ? Math.abs(typed) : typed;
  const limit = bounds.max !== undefined && asMeant > bounds.max ? 'max' : bounds.min !== undefined && asMeant < bounds.min ? 'min' : null;
  return { value: withinBounds(asMeant, bounds), minusDropped, limit };
}

/**
 * What a number field reports: a refused minus key, a typed value it
 * changed, or text it did not take because it is no number.
 */
export type NumberEntryEvent = { kind: 'minus-key' } | { kind: 'entry'; outcome: EntryOutcome } | { kind: 'not-a-number' };

/**
 * An arrow-key step from text that starts with a refused minus sign: it
 * steps from the number without the sign. Null when that does not apply.
 */
export function stepWithoutMinus(text: string, change: number, bounds: NumberBounds, decimal = '.'): number | null {
  if (!refusesMinus(bounds) || !startsWithMinus(text)) return null;
  const typed = parseEntry(text, decimal);
  return typed === null ? null : withinBounds(roundStep(Math.abs(typed) + change), bounds);
}

/**
 * An arrow-key step from what the field shows now (typed or not): from the
 * number without a refused minus sign, held inside the limits. `limit` says
 * which limit stopped it. Null when the text is no number.
 */
export function stepEntry(text: string, change: number, bounds: NumberBounds, decimal = '.'): EntryOutcome | null {
  const typed = parseEntry(text, decimal);
  if (typed === null) return null;
  const minusDropped = refusesMinus(bounds) && startsWithMinus(text);
  const stepped = roundStep((minusDropped ? Math.abs(typed) : typed) + change);
  const limit = bounds.max !== undefined && stepped > bounds.max ? 'max' : bounds.min !== undefined && stepped < bounds.min ? 'min' : null;
  return { value: withinBounds(stepped, bounds), minusDropped, limit };
}

/** Drops float noise a step adds (0.1 + 0.2). */
function roundStep(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** The words an editor's number fields say; each editor brings its own. */
export interface NumberEntryWords {
  /** A minus sign was typed into a field that refuses one. */
  minusKey(name: string | undefined): string;
  /**
   * A typed value was changed before it was kept; null when it was kept as
   * typed. `shown` is the kept value as the field shows it (with its unit).
   */
  changed(outcome: EntryOutcome, name: string | undefined, shown: string): string | null;
  /** Text that is no number was not taken. */
  notANumber(name: string | undefined, unit: string | undefined): string;
}

/** What the field context of a message holds. */
export interface EntryMessageContext {
  name: string | undefined;
  /** The kept value as the field shows it (with its unit). */
  shown: string;
  unit: string | undefined;
}

/** What to say for an event a number field reports, in `words`; null for nothing. */
export function entryMessage(event: NumberEntryEvent, words: NumberEntryWords, context: EntryMessageContext): string | null {
  if (event.kind === 'minus-key') return words.minusKey(context.name);
  if (event.kind === 'not-a-number') return words.notANumber(context.name, context.unit);
  return words.changed(event.outcome, context.name, context.shown);
}
