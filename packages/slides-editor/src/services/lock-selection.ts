/**
 * Keeps an editable selection from mixing locked and unlocked elements:
 * whatever sets it (a click, a sweep, an undo, a change from elsewhere), the
 * locked part is let go once the change has settled.
 */

import { settledSelection } from '../lib/locks.ts';
import { useDeck } from '../state/deck.ts';
import { useView } from '../state/view.ts';
import { currentSlide, editableEntry } from './commands.ts';

/** Starts watching the selection. Returns the stopper. */
export function installLockedSelection(): () => void {
  let queued = false;
  const settle = (): void => {
    queued = false;
    const view = useView.getState();
    const slide = currentSlide();
    if (!slide || view.selection.length < 2) return;
    const next = settledSelection(slide, view.selection, editableEntry(view.current) !== null);
    if (next) view.select(next);
  };
  const queue = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(settle);
  };
  const stopView = useView.subscribe((state, previous) => {
    if (state.selection !== previous.selection || state.current !== previous.current) queue();
  });
  const stopDeck = useDeck.subscribe((state, previous) => {
    if (state.slides !== previous.slides || state.readOnly !== previous.readOnly || state.status !== previous.status) queue();
  });
  return () => {
    stopView();
    stopDeck();
  };
}
