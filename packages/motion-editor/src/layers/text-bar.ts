/**
 * Which line of words the floating text styles bar is for. A word pressed on the picture, or its field taking focus
 * under Text, sets it while the bar may show; it stays after the field lets the focus go, and goes on Close or once
 * the bar may no longer show (out of full screen, playing, Tweaks closed, comment mode). After Close, the focus going
 * back to the same word's field does not bring the bar back; pressing the word again does.
 */

import { create } from 'zustand';
import { useComments } from '../comments/comments.ts';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useUi } from '../stores/ui.ts';
import { useWorking } from '../stores/working.ts';
import { useText } from '../text/text-store.ts';
import { TWEAKS_PANEL } from '../tweaks/panel-id.ts';
import { textBarApplies } from './text-bar-place.ts';

export interface TextBarState {
  /** The word whose line the bar styles (its id under Text). */
  id: string | null;
  /** The layer the bar picked for that line, so letting the bar go lets the pick go too. */
  rowId: string | null;
  /** The word whose bar was closed by hand. */
  closed: string | null;
}

export const useTextBar = create<TextBarState>()(() => ({ id: null, rowId: null, closed: null }));

/** Whether the bar may show now. */
export function textBarNow(): boolean {
  const ui = useUi.getState();
  return textBarApplies({
    fullscreen: ui.fullscreen,
    tweaksOpen: ui.panel === TWEAKS_PANEL,
    ready: useFilm.getState().stage === 'ready',
    playing: usePlayback.getState().playing,
    commenting: useComments.getState().on,
    readOnly: useWorking.getState().readOnlyReason !== null,
  });
}

/** The bar is for a word now: the layers are read in full screen for it. */
export const textBarWanted = (): boolean => useTextBar.getState().id !== null && textBarNow();

function forWord(id: string): void {
  if (useTextBar.getState().id !== id) useTextBar.setState({ id, rowId: null, closed: null });
}

/** Lets the bar go; `byHand`: its Close, so the word's field taking the focus again does not bring it back. */
export function closeTextBar(byHand = false): void {
  const { id } = useTextBar.getState();
  if (id !== null) useTextBar.setState({ id: null, rowId: null, closed: byHand ? id : null });
}

/** Follows the pressed and focused words and the stores the bar depends on; returns a stop function. */
export function startTextBar(): () => void {
  const follow = (): void => {
    if (!textBarNow()) {
      closeTextBar();
      if (useTextBar.getState().closed !== null) useTextBar.setState({ closed: null });
    } else if (useTextBar.getState().id === null) {
      const held = useText.getState().held;
      if (held !== null && held.id !== useTextBar.getState().closed) forWord(held.id);
    }
  };
  const stops = [
    useText.subscribe((state, before) => {
      if (!textBarNow()) return;
      if (state.asked !== null && state.asked !== before.asked) forWord(state.asked.id);
      else if (state.held !== null && state.held.id !== before.held?.id && state.held.id !== useTextBar.getState().closed) forWord(state.held.id);
    }),
    useUi.subscribe((state, before) => {
      if (state.fullscreen !== before.fullscreen || state.panel !== before.panel) follow();
    }),
    useFilm.subscribe((state, before) => {
      if (state.stage !== before.stage) follow();
    }),
    usePlayback.subscribe((state, before) => {
      if (state.playing !== before.playing) follow();
    }),
    useComments.subscribe((state, before) => {
      if (state.on !== before.on) follow();
    }),
    useWorking.subscribe((state, before) => {
      if (state.readOnlyReason !== before.readOnlyReason) follow();
    }),
  ];
  return () => {
    for (const stop of stops) stop();
    useTextBar.setState({ id: null, rowId: null, closed: null });
  };
}
