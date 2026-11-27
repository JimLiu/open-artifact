/**
 * Where the toolbar goes. While the page is wide enough the playback controls and the actions float as two bars over
 * the top of the page; otherwise, and in full screen, they share one bar at the bottom.
 */

import { createContext, useContext } from 'react';
import { create } from 'zustand';

export type ToolbarPlace = 'top' | 'bottom';

/** Space between the top bars and the page's edges. */
export const TOP_BAR_INSET = 12;
/** The least space between the two top bars. */
export const TOP_BAR_GAP = 8;
/** Room kept for the volume slider, which opens on hover: the bars must not move when it does. */
export const SLIDER_ROOM = 96;

export interface ToolbarWidths {
  /** The page's width; `null` until measured. */
  room: number | null;
  /** Each top bar's width as last measured on top (with {@link SLIDER_ROOM}); `null` until then. */
  playback: number | null;
  actions: number | null;
}

/** Both bars fit side by side in the page. Unmeasured counts as fitting, so the bars are measured on top first. */
export function topBarsFit({ room, playback, actions }: ToolbarWidths): boolean {
  if (room === null || playback === null || actions === null) return true;
  return 2 * TOP_BAR_INSET + playback + TOP_BAR_GAP + actions <= room;
}

export function toolbarPlace(widths: ToolbarWidths, fullscreen: boolean): ToolbarPlace {
  return !fullscreen && topBarsFit(widths) ? 'top' : 'bottom';
}

export const useToolbarWidths = create<ToolbarWidths>()(() => ({ room: null, playback: null, actions: null }));

/** Records a measured width; a value already known changes nothing. */
export function measured(key: keyof ToolbarWidths, width: number): void {
  const rounded = Math.ceil(width);
  if (useToolbarWidths.getState()[key] !== rounded) useToolbarWidths.setState({ [key]: rounded });
}

/** Which bar a button is in, so its menu opens away from the page's edge. */
export const ToolbarPlaceContext = createContext<ToolbarPlace>('bottom');

export function usePopupSide(): 'top' | 'bottom' {
  return useContext(ToolbarPlaceContext) === 'top' ? 'bottom' : 'top';
}
