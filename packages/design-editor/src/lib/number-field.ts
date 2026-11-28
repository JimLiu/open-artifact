/**
 * The properties panel's number fields with limits: what a commit or an
 * arrow-key step keeps, and the sentence said about it. The rules and the
 * words are every editor's (`@open-artifact/ui/number-entry`).
 */

import {
  heldAtLimitMessage,
  isMinusSign,
  minusIgnoredMessage,
  notANumberMessage,
  NUMBER_ENTRY_WORDS,
  numberLimitMessage,
  refusesMinus,
  settleTypedText,
  startsWithMinus,
  type NumberBounds,
  withinBounds,
  type NumberEntryWords,
} from '@open-artifact/ui/number-entry';
import { stepLength } from './field-keys.ts';

/** A number field's rules: its limits, its unit, and whether it takes a number only. */
export interface NumberFieldRule extends NumberBounds {
  /** Shown after the number ("px", "%"); bare numbers are committed with it. */
  unit?: string;
  /**
   * Takes a number only: other text changes nothing and is said so. Without
   * it a field also takes CSS words and other units ("auto", "1.5rem"), and
   * only plain numbers are held inside the limits.
   */
  strict?: boolean;
}

/** A number as said: at most six decimals. */
function plainNumber(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

/** A limit as said: the number, a space, its unit. */
function limitText(value: number, unit: string | undefined): string {
  return unit ? `${plainNumber(value)} ${unit}` : plainNumber(value);
}

/** The words the number fields say (every editor's). */
export const DESIGN_ENTRY_WORDS: NumberEntryWords = NUMBER_ENTRY_WORDS;

/** What a commit keeps. */
export type FieldCommit =
  /** Write `text` (with its unit); the field shows `shown`. */
  | { kind: 'write'; text: string; shown: string; say: string | null }
  /** Change nothing; the field goes back to its value. */
  | { kind: 'refuse'; say: string };

/** `text` without a trailing `unit` ("150%" → "150"). */
function withoutTrailingUnit(text: string, unit: string | undefined): string {
  return unit && text.toLowerCase().endsWith(unit.toLowerCase()) ? text.slice(0, -unit.length).trim() : text;
}

/**
 * What committing `text` keeps under `rule`: a plain number held inside the
 * limits with a refused minus sign left out, other text kept as typed (or,
 * for a strict field, refused). Empty text clears the field and is kept.
 */
export function settleField(text: string, rule: NumberFieldRule, name: string | undefined): FieldCommit {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'write', text: '', shown: '', say: null };
  const core = withoutTrailingUnit(trimmed, rule.unit);
  const settled = settleTypedText(core, rule);
  if (settled) {
    const changed = settled.limits.length > 0;
    // Kept as typed when it is a plain number already ("12.50"); written plainly otherwise ("１２", "+5").
    const shown = !changed && /^-?\d*\.?\d+$/.test(core) ? core : String(settled.value);
    const say = numberLimitMessage(settled.limits, { name, unit: rule.unit, format: plainNumber }) || null;
    return { kind: 'write', text: rule.unit ? `${shown}${rule.unit}` : shown, shown, say };
  }
  if (rule.strict) return { kind: 'refuse', say: notANumberMessage(name, rule.unit) };
  // Digits that read as no one number ("8 16", "1,5") change nothing; CSS words and units are kept.
  if (/[\d０-９]/.test(core) && /^[\p{Cf}\s\d０-９.,．，+＋\p{Pd}−﹣]+$/u.test(core)) return { kind: 'refuse', say: notANumberMessage(name, rule.unit) };
  if (refusesMinus(rule) && startsWithMinus(trimmed)) {
    const kept = trimmed.replace(/^\p{Cf}*\s*./u, '').trim();
    return { kind: 'write', text: kept, shown: kept, say: minusIgnoredMessage(name) };
  }
  return { kind: 'write', text: trimmed, shown: trimmed, say: null };
}

/**
 * An arrow-key step from what the field shows now (its placeholder when it
 * is empty), by `delta`: from the number without a refused minus sign, held
 * inside the limits. Null when there is nothing to step.
 */
export function stepField(text: string, placeholder: string, delta: number, rule: NumberFieldRule, name: string | undefined): { text: string; say: string | null } | null {
  const minus = refusesMinus(rule) && startsWithMinus(text);
  const from = minus ? text.trim().replace(/^\p{Cf}*./u, '') : text;
  const stepped = stepLength(from, placeholder, delta, rule.unit !== undefined || rule.strict === true);
  if (stepped === null) return null;
  const match = /^(-?\d*\.?\d+)(.*)$/.exec(stepped);
  if (!match || (rule.min === undefined && rule.max === undefined)) return { text: stepped, say: null };
  const value = Number(match[1]);
  const limit = rule.max !== undefined && value > rule.max ? 'max' : rule.min !== undefined && value < rule.min ? 'min' : null;
  if (!limit) return { text: stepped, say: null };
  const held = withinBounds(value, rule);
  return { text: `${held}${match[2]}`, say: heldAtLimitMessage(limit, limitText(held, rule.unit), name) };
}

/** A key the field refuses: a minus sign in a field that takes no negative numbers. */
export function refusesKey(key: string, rule: NumberFieldRule): boolean {
  return refusesMinus(rule) && isMinusSign(key);
}
