/**
 * The controls floating over the stage (or the grid and canvas views): View
 * at the top-left when the rail does not show it, Add slide / Present /
 * properties at the top-right, and, while a slide is on stage, the insert
 * toolbar at the bottom (with Comment), the pager and zoom card at the
 * bottom-right (above the toolbar when a narrow stage has no room beside
 * it), and the text format strip next to the selected text. A deck without slides keeps
 * the bottom toolbar where one can be added: the Ask field, and the insert
 * tools waiting for a slide.
 *
 * The layer itself lets pointer events through; only the cards take them.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useDeck } from '../state/deck.ts';
import { useAgent } from '../services/agent.ts';
import { canComment, useComments } from '../services/comments.ts';
import { canChange } from '../services/commands.ts';
import { EMPTY_DECK_INSERT } from '../lib/empty-deck.ts';
import { CORNER_GAP, cornerShift } from '../lib/narrow.ts';
import { useView } from '../state/view.ts';
import { EndCard, PagerCard } from './EndCard.tsx';
import { FormatBar } from './FormatBar.tsx';
import { TextLinkCard } from './TextLinkCard.tsx';
import { FootToolbar } from './FootToolbar.tsx';
import { FollowingPill, PresenceCard } from './Presence.tsx';
import { StartControls } from './StartCard.tsx';

/** Gap between the floating cards and the stage's edges, px. */
export const CHROME_INSET = 12;

/** Height of the top cards and the bottom toolbar, px. */
export const CHROME_CARD = 40;

/** Room the top cards take from the stage (inset, card, gap), px. */
export const CHROME_TOP = CHROME_INSET + CHROME_CARD + 8;

/** Room the bottom toolbar takes from the stage (gap, toolbar, inset), px. */
export const CHROME_BOTTOM = 8 + CHROME_CARD + CHROME_INSET;

/** Room a pager card stacked above the toolbar takes from the stage too (gap, card), px. */
export const CHROME_STACKED = CORNER_GAP + CHROME_CARD;

/** Props of {@link FootRow}. */
interface FootRowProps {
  editing: boolean;
  ask: boolean;
  comment: boolean;
  /** Show the pager and zoom card (a slide is on stage). */
  pager: boolean;
  insertBlocked?: string;
}

/**
 * The bottom of the stage: the toolbar centred, the pager and zoom card at
 * the right. Short of room the toolbar moves left to keep clear of the card,
 * and shorter still the card goes above the toolbar (the stage then keeps
 * room for both).
 */
function FootRow({ editing, ask, comment, pager, insertBlocked }: FootRowProps): ReactNode {
  const row = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const corner = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ shift: number | 'above'; lift: number }>({ shift: 0, lift: 0 });
  useLayoutEffect(() => {
    const rowEl = row.current;
    const barEl = bar.current;
    const cornerEl = corner.current;
    if (!rowEl || !barEl || !cornerEl || typeof ResizeObserver === 'undefined') {
      setPlace({ shift: 0, lift: 0 });
      return;
    }
    const measure = (): void => {
      const width = barEl.offsetWidth;
      const shift = width > 0 ? cornerShift(rowEl.clientWidth, width, cornerEl.offsetWidth) : 0;
      const lift = shift === 'above' ? barEl.offsetHeight + CORNER_GAP : 0;
      setPlace((old) => (old.shift === shift && old.lift === lift ? old : { shift, lift }));
      useView.getState().setFootStacked(shift === 'above');
    };
    const observer = new ResizeObserver(measure);
    for (const element of [rowEl, barEl, cornerEl]) observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      useView.getState().setFootStacked(false);
    };
  }, [pager]);
  return (
    <>
      <div ref={row} data-open-artifact-foot-row="" className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
        <div ref={bar} className="flex min-w-0 max-w-full" style={{ marginRight: typeof place.shift === 'number' ? place.shift * 2 : 0 }}>
          <FootToolbar editing={editing} ask={ask} comment={comment} insertBlocked={insertBlocked} />
        </div>
      </div>
      {pager ? (
        <div
          ref={corner}
          data-open-artifact-corner={place.shift === 'above' ? 'above' : 'beside'}
          className="pointer-events-none absolute right-3 z-10 flex"
          style={{ bottom: CHROME_INSET + place.lift }}
        >
          <PagerCard />
        </div>
      ) : null}
    </>
  );
}

/** Props of {@link StageChrome}. */
export interface StageChromeProps {
  /** A slide is on stage (the bottom toolbar and the zoom show). */
  onStage: boolean;
  /** Show View at the top-left (the rail is hidden or another view is up; not on an empty deck, where nothing in it applies yet). */
  startCard: boolean;
  /** The edit view of a deck without slides, where one can be added: the bottom toolbar shows. */
  emptyDeck?: boolean;
}

/** The floating layer. */
export function StageChrome({ onStage, startCard, emptyDeck = false }: StageChromeProps): ReactNode {
  const readOnly = useDeck((s) => s.readOnly);
  const agentAvailable = useAgent((s) => s.status.available);
  // The comments store is available once its host answers; canComment says whether this viewer may write.
  const comment = useComments((s) => s.available) && canComment();
  const editing = !readOnly && canChange();
  return (
    <>
      {startCard ? (
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex">
          <StartControls className="pointer-events-auto" />
        </div>
      ) : null}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex gap-1">
        <PresenceCard />
        <EndCard onStage={onStage} />
      </div>
      <FollowingPill />
      {onStage || emptyDeck ? <FootRow editing={editing} ask={agentAvailable && !readOnly} comment={comment && onStage} pager={onStage} insertBlocked={onStage ? undefined : EMPTY_DECK_INSERT} /> : null}
      {onStage ? (
        <>
          <FormatBar />
          <TextLinkCard />
        </>
      ) : null}
    </>
  );
}
