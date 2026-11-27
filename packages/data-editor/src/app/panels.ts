/**
 * The side panel beside the page: Sources, Design or History, one at a time,
 * at a width the viewer drags or clicks through (kept in this browser, with
 * the last width dragged to as a stop of its own). Sources and History
 * keep their own open flags (`state/sources-ui.ts`, `history/store.ts`);
 * this module keeps them exclusive and closes Sources and Design while
 * comments are on.
 */

import { create } from 'zustand';
import { announce } from '@open-artifact/editor-kit';
import { toggleVersionHistory, useVersionHistory } from '../history/store.ts';
import { useShown } from '../state/shown.ts';
import { closeSources, openSources, useSourcesUi } from '../state/sources-ui.ts';
import {
  DESIGN_CLOSED_MESSAGE,
  DESIGN_OPEN_MESSAGE,
  HISTORY_CLOSED_MESSAGE,
  HISTORY_OPEN_MESSAGE,
  SOURCES_CLOSED_MESSAGE,
  SOURCES_OPEN_MESSAGE,
} from './words.ts';

export type PanelId = 'sources' | 'design' | 'history';

export const PANEL_MIN_WIDTH = 280;
export const PANEL_MAX_WIDTH = 720;
export const PANEL_DEFAULT_WIDTH = 380;
/** The page keeps at least this much room beside the panel. */
export const PAGE_MIN_WIDTH = 320;
const WIDTH_KEY = 'open-artifact:data:panel-width';
/** The viewer's own width: the last one dragged to that is none of the other stops. */
const OWN_WIDTH_KEY = 'open-artifact:data:panel-width-own';
/** A press on the resize handle that moves less than this (px) along it is a click; past it, a drag. */
export const RESIZE_DRAG_PX = 3;
/** A click may drift this far (px) across the handle. */
export const RESIZE_CLICK_DRIFT_PX = 8;
/** A click on the handle waits this long (ms) for a double click before it steps. */
export const RESIZE_CLICK_WAIT_MS = 500;

/** The widths a click on the resize handle steps through. */
export interface PanelStops {
  home: number;
  max: number;
  min: number;
  /** The viewer's own width, when there is one. */
  own: number | null;
}

/** The width after `width` when the handle is clicked: home, max, min, the viewer's own, then home again. */
export function nextPanelStop(width: number, stops: PanelStops): number {
  const order = [stops.home, stops.max, stops.min, ...(stops.own === null ? [] : [stops.own])].filter(
    (stop, index, all) => all.indexOf(stop) === index,
  );
  const at = order.indexOf(width);
  return order[(at + 1) % order.length] ?? stops.home;
}

/** What a press on the handle became once it moved `dx` along and `dy` across it: still a click, a drag, or neither. */
export function resizePress(dx: number, dy: number): 'click' | 'drag' | 'none' {
  if (Math.abs(dx) > RESIZE_DRAG_PX) return 'drag';
  return Math.abs(dy) > RESIZE_CLICK_DRIFT_PX ? 'none' : 'click';
}

/** A dragged width is the viewer's own when it is none of the other stops. */
export function ownPanelWidth(width: number, stops: Omit<PanelStops, 'own'>): number | null {
  return width === stops.home || width === stops.max || width === stops.min ? null : width;
}

/** A panel width kept between the bounds and clear of the page's least room. */
export function clampPanelWidth(width: number, viewport = Number.POSITIVE_INFINITY): number {
  const max = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, viewport - PAGE_MIN_WIDTH));
  if (!Number.isFinite(width)) return Math.min(PANEL_DEFAULT_WIDTH, max);
  return Math.round(Math.min(max, Math.max(PANEL_MIN_WIDTH, width)));
}

/** The panel shown for the open flags (History, then Design, then Sources). */
export function shownPanel(open: { sources: boolean; design: boolean; history: boolean }): PanelId | null {
  if (open.history) return 'history';
  if (open.design) return 'design';
  if (open.sources) return 'sources';
  return null;
}

function readWidth(): number {
  try {
    const stored = Number(globalThis.localStorage?.getItem(WIDTH_KEY));
    return stored > 0 ? clampPanelWidth(stored) : PANEL_DEFAULT_WIDTH;
  } catch {
    return PANEL_DEFAULT_WIDTH;
  }
}

function readOwnWidth(): number | null {
  try {
    const stored = Number(globalThis.localStorage?.getItem(OWN_WIDTH_KEY));
    return stored > 0 ? clampPanelWidth(stored) : null;
  } catch {
    return null;
  }
}

interface PanelsState {
  design: boolean;
  width: number;
  /** The viewer's own width (see {@link OWN_WIDTH_KEY}). */
  own: number | null;
}

export const usePanels = create<PanelsState>()(() => ({ design: false, width: readWidth(), own: readOwnWidth() }));

/** The open panel. */
export function usePanel(): PanelId | null {
  const sources = useSourcesUi((state) => state.open);
  const design = usePanels((state) => state.design);
  const history = useVersionHistory((state) => state.open);
  return shownPanel({ sources, design, history });
}

export function getPanel(): PanelId | null {
  return shownPanel({ sources: useSourcesUi.getState().open, design: usePanels.getState().design, history: useVersionHistory.getState().open });
}

export function openPanel(id: PanelId): void {
  if (id === 'sources') {
    if (!useSourcesUi.getState().open) openSources(useSourcesUi.getState().selected);
  } else if (id === 'design') usePanels.setState({ design: true });
  else toggleVersionHistory(true);
}

export function closePanel(id: PanelId | null = getPanel()): void {
  if (id === 'sources') closeSources();
  else if (id === 'design') usePanels.setState({ design: false });
  else if (id === 'history') toggleVersionHistory(false);
}

export function togglePanel(id: PanelId): void {
  if (getPanel() === id) closePanel(id);
  else openPanel(id);
}

export function setPanelWidth(width: number): void {
  const next = clampPanelWidth(width, globalThis.innerWidth ?? Number.POSITIVE_INFINITY);
  if (next === usePanels.getState().width) return;
  usePanels.setState({ width: next });
  try {
    globalThis.localStorage?.setItem(WIDTH_KEY, String(next));
  } catch {
    // Kept for this visit only.
  }
}

/** Keeps a dragged width as the viewer's own stop. */
export function setOwnPanelWidth(width: number | null): void {
  if (width === usePanels.getState().own) return;
  usePanels.setState({ own: width });
  try {
    if (width === null) globalThis.localStorage?.removeItem(OWN_WIDTH_KEY);
    else globalThis.localStorage?.setItem(OWN_WIDTH_KEY, String(width));
  } catch {
    // Kept for this visit only.
  }
}

/** Draws the panel no wider than `max` (the room left changed), keeping the width the viewer chose for later. */
export function fitPanelWidth(max: number): void {
  if (usePanels.getState().width > max) usePanels.setState({ width: Math.max(PANEL_MIN_WIDTH, Math.round(max)) });
}

const OPEN_WORDS: Record<PanelId, [string, string]> = {
  sources: [SOURCES_OPEN_MESSAGE, SOURCES_CLOSED_MESSAGE],
  design: [DESIGN_OPEN_MESSAGE, DESIGN_CLOSED_MESSAGE],
  history: [HISTORY_OPEN_MESSAGE, HISTORY_CLOSED_MESSAGE],
};

/** Keeps one panel open at a time, closes Sources and Design while comments are on and reads the changes out. */
export function startPanels(): () => void {
  const opened = (id: PanelId): void => {
    if (id !== 'sources' && useSourcesUi.getState().open) closeSources();
    if (id !== 'design' && usePanels.getState().design) usePanels.setState({ design: false });
    if (id !== 'history' && useVersionHistory.getState().open) toggleVersionHistory(false);
  };
  const say = (id: PanelId, open: boolean): void => announce(OPEN_WORDS[id][open ? 0 : 1]);
  const stops = [
    useSourcesUi.subscribe((state, previous) => {
      if (state.open === previous.open) return;
      if (state.open) opened('sources');
      say('sources', state.open);
    }),
    usePanels.subscribe((state, previous) => {
      if (state.design === previous.design) return;
      if (state.design) opened('design');
      say('design', state.design);
    }),
    useVersionHistory.subscribe((state, previous) => {
      if (state.open === previous.open) return;
      if (state.open) opened('history');
      say('history', state.open);
    }),
    useShown.subscribe((state, previous) => {
      if (!state.commenting || previous.commenting) return;
      if (useSourcesUi.getState().open) closeSources();
      if (usePanels.getState().design) usePanels.setState({ design: false });
    }),
    useShown.subscribe((state, previous) => {
      if (state.editing && !previous.editing && usePanels.getState().design) usePanels.setState({ design: false });
    }),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
