/**
 * The warning a download options dialog shows when the file will miss
 * slides: the agent is still writing the deck, or some slides have errors
 * and will be left out. Each part says what to show, what to read out when
 * it appears while the dialog is open, and what to say once it is gone.
 */

import { slideList } from './notes.ts';

/** One reason the download will miss slides. */
export interface WarningPart {
  kind: 'writing' | 'held';
  /** Shown in the dialog. */
  line: string;
  /** Read out when the part appears (or changes) while the dialog is open. */
  say: string;
  /** Shown and read out once the part is gone. */
  cleared: string;
}

/** What the warning is built from. */
export interface WarningFacts {
  /** Slides written and planned, while the agent is still writing the deck. */
  writing: { written: number; planned: number } | null;
  /** Numbers (in the deck) of the slides with errors. */
  held: readonly number[];
}

/** The parts of the warning; empty when nothing will be missing. */
export function exportWarning(facts: WarningFacts): WarningPart[] {
  const parts: WarningPart[] = [];
  if (facts.writing) {
    const { written, planned } = facts.writing;
    parts.push({
      kind: 'writing',
      line: `Only ${written} of ${planned} slides are written so far. The download will have just those.`,
      say: 'The deck is still being written.',
      cleared: 'Every slide is written now.',
    });
  }
  const held = [...new Set(facts.held)].sort((a, b) => a - b);
  if (held.length > 0) {
    const one = held.length === 1;
    parts.push({
      kind: 'held',
      line: `${one ? 'Slide' : 'Slides'} ${slideList(held)} ${one ? 'has' : 'have'} errors and will be left out.`,
      say: `${held.length} ${one ? 'slide' : 'slides'} will be left out.`,
      cleared: 'Every slide can be included now.',
    });
  }
  return parts;
}

/**
 * What to read out when the warning goes from `before` to `after` while the
 * dialog is open: the parts that appeared or changed what they say, then the
 * parts that went away. Null when nothing is worth saying.
 */
export function warningSpeech(before: readonly WarningPart[], after: readonly WarningPart[]): string | null {
  const said = after.filter((part) => !before.some((old) => old.kind === part.kind && old.say === part.say)).map((part) => part.say);
  const gone = before.filter((old) => !after.some((part) => part.kind === old.kind)).map((old) => old.cleared);
  const words = [...said, ...gone];
  return words.length ? words.join(' ') : null;
}

/** The line shown once every part of `before` is gone. */
export function clearedLine(before: readonly WarningPart[]): string | null {
  return before.length ? before.map((part) => part.cleared).join(' ') : null;
}
