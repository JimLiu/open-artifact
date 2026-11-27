/**
 * What a number field does with what is typed or pasted into it, and what it
 * says about it. One set of rules and words for every editor's number fields:
 *
 * - a value past a bound is held at the bound;
 * - a field whose minimum is zero or more takes no negative numbers: it drops
 *   a leading minus sign and keeps the number (`-5` is 5, not the minimum);
 * - text that is no number changes nothing.
 *
 * A field reports each change as a {@link NumberLimit}; the sentences below
 * ({@link numberLimitMessage}, {@link notANumberMessage}) are what a screen
 * reader hears about them. No DOM.
 */

/* --------------------------------- reading --------------------------------- */

/** A field's bounds. */
export interface NumberBounds {
  min?: number;
  max?: number;
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

/** `value` held inside the bounds. */
export function withinBounds(value: number, bounds: NumberBounds): number {
  if (bounds.max !== undefined && value > bounds.max) return bounds.max;
  if (bounds.min !== undefined && value < bounds.min) return bounds.min;
  return value;
}

/* ------------------------------ what is kept ------------------------------- */

/** Why a field changed what was typed: held at its maximum or minimum, or a minus sign dropped. */
export type NumberLimitReason = 'max' | 'min' | 'no-minus';

/** One change a field made to typed text. */
export interface NumberLimit {
  reason: NumberLimitReason;
  /** The bound the value was held at; for `no-minus`, the field's minimum. */
  limit: number;
}

/** What typed text keeps once the field's bounds apply. */
export interface SettledNumber {
  value: number;
  /** What changed, in the order it happened (minus sign first). */
  limits: NumberLimit[];
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

/** Drops the float noise a step adds (0.1 + 0.2). */
function roundStep(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * An arrow-key step by `change` from typed text: from the number without a
 * minus sign the field refuses, then held inside the bounds. Null when the
 * text is no number.
 */
export function stepTypedText(text: string, change: number, bounds: NumberBounds, decimal = '.'): SettledNumber | null {
  const typed = readTypedNumber(text, decimal);
  if (typed === null) return null;
  const dropped = startsWithMinus(text) && refusesMinus(bounds);
  const held = settleNumber(roundStep((dropped ? Math.abs(typed) : typed) + change), false, bounds);
  return dropped ? { value: held.value, limits: [{ reason: 'no-minus', limit: bounds.min ?? 0 }, ...held.limits] } : held;
}

/**
 * The limits that still hold once a field kept `kept`: a `max` or `min`
 * counts only when the value really ended at that bound (the field may have
 * rounded it elsewhere). A dropped minus sign always counts.
 */
export function limitsKept(limits: readonly NumberLimit[], kept: number | null): NumberLimit[] {
  return limits.filter((limit) => limit.reason === 'no-minus' || limit.limit === kept);
}

/* --------------------------------- words ---------------------------------- */

/** The field's name in a sentence: its accessible name, or "This field". */
function fieldSubject(name: string | undefined): string {
  return name?.trim() || 'This field';
}

/** Said when a field that takes no negative numbers drops a minus sign (typed, pasted, or pressed). */
export function minusIgnoredMessage(name?: string): string {
  return `Minus sign ignored. ${fieldSubject(name)} doesn’t take negative numbers.`;
}

/** Said when a typed value was held at a bound; `shown` is the bound as the field writes it, with its unit. */
export function heldAtLimitMessage(reason: 'max' | 'min', shown: string, name?: string): string {
  return `Changed to ${shown}. ${fieldSubject(name)} can’t go ${reason === 'max' ? 'higher' : 'lower'}.`;
}

/** Said when the text committed is no number, so nothing changed. */
export function notANumberMessage(name?: string, unit?: string): string {
  return `Nothing changed. ${fieldSubject(name)} takes a number ${unit ? `in ${unit}` : 'only'}.`;
}

/** How a message names the field and writes a value. */
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
  const format = wording.format ?? ((value: number) => new Intl.NumberFormat().format(value));
  const shown = (value: number) => (wording.unit ? `${format(value)} ${wording.unit}` : format(value));
  return limits
    .map((limit) => (limit.reason === 'no-minus' ? minusIgnoredMessage(wording.name) : heldAtLimitMessage(limit.reason, shown(limit.limit), wording.name)))
    .join(' ');
}

/* ------------------------------- older names ------------------------------- */
// The shapes the fields used before the rules above were one set. They read
// the same rules and say the same words.

/** Same as {@link isMinusSign}. */
export const isMinusKey = isMinusSign;

/** Same as {@link readTypedNumber}. */
export const parseEntry = readTypedNumber;

/** How a typed value was changed before it was kept. */
export interface EntryOutcome {
  /** The value kept. */
  value: number;
  /** A minus sign the field refuses was left out. */
  minusDropped: boolean;
  /** The value went past this bound and was held at it. */
  limit: 'max' | 'min' | null;
}

/** A {@link SettledNumber} as an {@link EntryOutcome}. */
export function entryOutcome(settled: SettledNumber): EntryOutcome {
  const bound = settled.limits.find((limit) => limit.reason !== 'no-minus');
  return { value: settled.value, minusDropped: settled.limits.some((limit) => limit.reason === 'no-minus'), limit: bound ? (bound.reason as 'max' | 'min') : null };
}

/** What typed or pasted text keeps, as an {@link EntryOutcome}; null when it is no number. */
export function settleEntry(text: string, bounds: NumberBounds, decimal = '.'): EntryOutcome | null {
  const settled = settleTypedText(text, bounds, decimal);
  return settled && entryOutcome(settled);
}

/** An arrow-key step, as an {@link EntryOutcome} (see {@link stepTypedText}). */
export function stepEntry(text: string, change: number, bounds: NumberBounds, decimal = '.'): EntryOutcome | null {
  const stepped = stepTypedText(text, change, bounds, decimal);
  return stepped && entryOutcome(stepped);
}

/** The value of an arrow-key step from text that starts with a minus sign the field refuses; null otherwise. */
export function stepWithoutMinus(text: string, change: number, bounds: NumberBounds, decimal = '.'): number | null {
  if (!refusesMinus(bounds) || !startsWithMinus(text)) return null;
  return stepTypedText(text, change, bounds, decimal)?.value ?? null;
}

/** What a number field reports: a refused minus key, a typed value it changed, or text it did not take. */
export type NumberEntryEvent = { kind: 'minus-key' } | { kind: 'entry'; outcome: EntryOutcome } | { kind: 'not-a-number' };

/** The sentences for each {@link NumberEntryEvent}. */
export interface NumberEntryWords {
  minusKey(name: string | undefined): string;
  /** Null when the value was kept as typed. `shown` is the kept value as the field shows it (with its unit). */
  changed(outcome: EntryOutcome, name: string | undefined, shown: string): string | null;
  notANumber(name: string | undefined, unit: string | undefined): string;
}

/** The words every number field says (the sentences above). */
export const NUMBER_ENTRY_WORDS: NumberEntryWords = {
  minusKey: (name) => minusIgnoredMessage(name),
  changed(outcome, name, shown) {
    const parts: string[] = [];
    if (outcome.minusDropped) parts.push(minusIgnoredMessage(name));
    if (outcome.limit) parts.push(heldAtLimitMessage(outcome.limit, shown, name));
    return parts.length ? parts.join(' ') : null;
  },
  notANumber: (name, unit) => notANumberMessage(name, unit),
};

/** What the field context of a message holds. */
export interface EntryMessageContext {
  name: string | undefined;
  /** The kept value as the field shows it (with its unit). */
  shown: string;
  unit: string | undefined;
}

/** What to say for an event a number field reports; null for nothing. */
export function entryMessage(event: NumberEntryEvent, words: NumberEntryWords, context: EntryMessageContext): string | null {
  if (event.kind === 'minus-key') return words.minusKey(context.name);
  if (event.kind === 'not-a-number') return words.notANumber(context.name, context.unit);
  return words.changed(event.outcome, context.name, context.shown);
}
