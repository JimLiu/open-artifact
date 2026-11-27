/** What a deck without slides shows besides its empty state. */

/** Why the insert tools wait on a deck without slides. */
export const EMPTY_DECK_INSERT = 'Add a slide first';

/** What decides whether an empty deck shows the bottom toolbar. */
export interface EmptyDeckState {
  /** This viewer can change the deck now (not read-only, loaded). */
  editable: boolean;
  /** The agent is writing the deck: its outline takes the stage. */
  writing: boolean;
  /** Slides the deck has, and the most it may hold. */
  slides: number;
  maxSlides: number;
}

/**
 * True when an empty deck keeps the bottom toolbar (insert tools and the Ask
 * field): only where a slide could be added right now.
 */
export function emptyDeckToolbar(state: EmptyDeckState): boolean {
  return state.slides === 0 && state.editable && !state.writing && state.slides < state.maxSlides;
}

/** Who is looking at an empty deck, for its one line. */
export interface EmptyDeckViewer {
  /** This viewer can add slides now. */
  editable: boolean;
  /** The agent's name when one can be asked, else null. */
  agent: string | null;
}

/** The one line an empty deck shows under its icon. */
export function emptyDeckMessage({ editable, agent }: EmptyDeckViewer): string {
  const lead = 'This presentation has no slides yet.';
  if (!editable) return `${lead} Slides will show here once they are added.`;
  return agent ? `${lead} Add one, or let ${agent} add some.` : `${lead} Add one to get started.`;
}
