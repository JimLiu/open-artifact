/**
 * What a number field does with typed text it can't keep as typed: a value
 * past a bound is held at the bound, and a field that takes no negative
 * numbers (its minimum is zero or more) drops a leading minus sign instead
 * of turning the value into the minimum. The fields report each change as
 * a {@link NumberLimit}, so the editor can say it out loud. No DOM.
 */

/** Why a field changed what was typed: held at its maximum or minimum, or a minus sign dropped. */
export type NumberLimitReason = 'max' | 'min' | 'no-minus';

/** One change a field made to typed text. */
export interface NumberLimit {
  reason: NumberLimitReason;
  /** The bound the value was held at; for `no-minus`, the field's minimum. */
  limit: number;
}

/** A field's bounds. */
export interface NumberBounds {
  min?: number;
  max?: number;
}

/** What typed text keeps once the field's bounds apply. */
export interface SettledNumber {
  value: number;
  /** What changed, in the order it happened (minus sign first). */
  limits: NumberLimit[];
}

/** The minus signs a number may start with: ASCII, the typographic minus, full-width, figure dash, en and em dash, small minus. */
const MINUS_SIGN = /[-−－‒–—﹣]/;
const MINUS_SIGNS = /[-−－‒–—﹣]/g;
/** Invisible format characters some keyboards and locales put around numbers. */
const FORMAT_CHARS = /\p{Cf}/gu;

/** True for a field that takes no negative numbers. */
export function refusesMinus(bounds: NumberBounds): boolean {
  return bounds.min !== undefined && bounds.min >= 0;
}

/** True when a key types a minus sign. */
export function isMinusSign(key: string): boolean {
  return key.length === 1 && MINUS_SIGN.test(key);
}

/** True when text, read as a number, starts with a minus sign (format characters and leading spaces aside). */
export function startsWithMinus(text: string): boolean {
  return MINUS_SIGN.test(text.replace(FORMAT_CHARS, '').trimStart().charAt(0));
}

/** True when nothing but spaces and format characters comes before `at`: a minus sign typed there leads the number. */
export function leadsNumber(text: string, at: number): boolean {
  return text.slice(0, at).replace(FORMAT_CHARS, '').trim() === '';
}

/**
 * The number in typed text, or null when it is none. `decimal` is the
 * separator the field writes (`.` or `,`); the other one is taken as
 * grouping. Full-width digits and any minus sign are read too.
 */
export function readTypedNumber(text: string, decimal = '.'): number | null {
  let plain = text
    .replace(FORMAT_CHARS, '')
    .replace(/\s+/g, '')
    .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
    .replace(/．/g, '.')
    .replace(/，/g, ',')
    .replace(MINUS_SIGNS, '-')
    .replace(/＋/g, '+');
  plain = decimal === ',' ? plain.replace(/\./g, '').replace(',', '.') : plain.replace(/,/g, '');
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(plain)) return null;
  const value = Number(plain);
  return Number.isFinite(value) ? value : null;
}

/**
 * Applies the bounds to a typed number. `leadingMinus` says the text
 * started with a minus sign: a field that takes no negative numbers keeps
 * the number without it (and reports `no-minus`); then a value past a bound
 * is held there (and reports `max` or `min`).
 */
export function settleNumber(typed: number, leadingMinus: boolean, bounds: NumberBounds): SettledNumber {
  const limits: NumberLimit[] = [];
  let value = typed;
  if (leadingMinus && refusesMinus(bounds)) {
    value = Math.abs(value);
    limits.push({ reason: 'no-minus', limit: bounds.min ?? 0 });
  }
  if (bounds.max !== undefined && value > bounds.max) {
    value = bounds.max;
    limits.push({ reason: 'max', limit: bounds.max });
  } else if (bounds.min !== undefined && value < bounds.min) {
    value = bounds.min;
    limits.push({ reason: 'min', limit: bounds.min });
  }
  return { value, limits };
}

/** What typed text keeps (see {@link settleNumber}); null when the text is no number. */
export function settleTypedText(text: string, bounds: NumberBounds, decimal = '.'): SettledNumber | null {
  const typed = readTypedNumber(text, decimal);
  return typed === null ? null : settleNumber(typed, startsWithMinus(text), bounds);
}

/**
 * The bound limits that still hold once a field kept `kept`: a `max` or `min`
 * counts only when the value really ended at that bound (the field may have
 * rounded it elsewhere). A dropped minus sign always counts.
 */
export function limitsKept(limits: readonly NumberLimit[], kept: number | null): NumberLimit[] {
  return limits.filter((limit) => limit.reason === 'no-minus' || limit.limit === kept);
}

/** How a limit message names the field and writes the value. */
export interface NumberLimitWording {
  /** The field's name (its accessible name); "This field" without one. */
  name?: string;
  /** The unit written after the value, after a space. */
  unit?: string;
  /** How the field writes a number (default: the locale's plain number format). */
  format?: (value: number) => string;
}

/**
 * What to tell a screen reader about the changes a field made to typed text,
 * one sentence each, in order; empty when there were none. Fields report
 * several changes at once (`-50` in a 0–32 field: the minus sign, then the
 * maximum), and a live region reads only its latest message, so they are said
 * together.
 */
export function numberLimitMessage(limits: readonly NumberLimit[], wording: NumberLimitWording = {}): string {
  const name = wording.name?.trim() || 'This field';
  const format = wording.format ?? ((value: number) => new Intl.NumberFormat().format(value));
  const shown = (value: number) => (wording.unit ? `${format(value)} ${wording.unit}` : format(value));
  return limits
    .map((limit) => {
      if (limit.reason === 'no-minus') return `Minus sign ignored. ${name} doesn’t take negative numbers.`;
      return `Changed to ${shown(limit.limit)}. ${name} can’t go ${limit.reason === 'max' ? 'higher' : 'lower'}.`;
    })
    .join(' ');
}
