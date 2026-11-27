/**
 * The find bar (⌘F): searches the text of every slide in deck order. Enter
 * or ⌘G goes to the next match, ⇧Enter or ⇧⌘G to the previous one, Escape
 * closes. There is no replace. The bar itself is `FindBar` of
 * `@open-artifact/editor-kit`.
 */

import type { ReactNode } from 'react';
import { FindBar as KitFindBar } from '@open-artifact/editor-kit/react';
import { useFind } from '../services/find.ts';
import { useView } from '../state/view.ts';
import { landAfterDismiss, landAfterDismissPress } from '../lib/focus-landing.ts';

/** The find bar, floating at the top right of the stage area. */
export function FindBar(): ReactNode {
  const open = useView((s) => s.findOpen);
  const query = useFind((s) => s.query);
  const count = useFind((s) => s.matches.length);
  const index = useFind((s) => s.index);
  if (!open) return null;
  const find = useFind.getState();
  return (
    // Closing the bar (its button or Escape) leaves the focus on the page around it.
    <div
      className="contents"
      onClickCapture={(event) => landAfterDismissPress(event.nativeEvent, event.currentTarget)}
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && event.target instanceof HTMLElement) landAfterDismiss(event.target, true);
      }}
    >
      <KitFindBar
        label="Find in presentation"
        // ⌘F while open focuses the field again.
        focusEvent="open-artifact-slides:focus-find"
        liveStatus
        className="absolute right-3 top-[60px] z-20 h-9 pl-2.5 pr-1"
        query={query}
        count={count}
        index={index}
        onQuery={find.setQuery}
        onStep={find.step}
        onClose={find.close}
      />
    </div>
  );
}
