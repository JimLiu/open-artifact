/**
 * The slides editor's words for its number fields. What a field does with
 * typed text (limits, a refused minus sign) is shared in
 * `@open-artifact/ui/number-entry`.
 */
import type { EntryOutcome, NumberEntryEvent as SharedEntryEvent } from '@open-artifact/ui/number-entry';

export {
  isMinusKey,
  parseEntry,
  refusesMinus,
  settleEntry,
  startsWithMinus,
  stepWithoutMinus,
  withinBounds,
} from '@open-artifact/ui/number-entry';
export type { EntryOutcome, NumberBounds } from '@open-artifact/ui/number-entry';

/** What a slides number field reports: it leaves text that is no number as it was, silently. */
export type NumberEntryEvent = Exclude<SharedEntryEvent, { kind: 'not-a-number' }>;

/** What screen readers hear about a field: its name, or "This setting". */
function fieldName(name: string | undefined): string {
  return name?.trim() || 'This setting';
}

/** Said when a minus sign is typed into a field that refuses one. */
export function minusRefusal(name: string | undefined): string {
  return `${fieldName(name)} can't be negative`;
}

/**
 * Said when a typed value was changed before it was kept; null when it was
 * kept as typed. `shown` is the kept value as the field shows it (with its unit).
 */
export function entryAnnouncement(outcome: EntryOutcome, name: string | undefined, shown: string): string | null {
  const limit = outcome.limit === 'max' ? `at its maximum, ${shown}` : outcome.limit === 'min' ? `at its minimum, ${shown}` : null;
  if (outcome.minusDropped) return `${minusRefusal(name)}, so it's ${limit ?? shown}`;
  return limit ? `${fieldName(name)} is now ${limit}` : null;
}

