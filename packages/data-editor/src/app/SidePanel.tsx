/**
 * The panel beside the page: Sources, Design or History. Its left edge
 * resizes it: drag it, click it to step through the widths (home, widest,
 * narrowest, the viewer's own; a double click steps nowhere), or use the
 * arrow keys, Home and End on the separator. A panel that opens takes
 * the focus: its first row's main control, else the panel itself.
 */

import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import type { DashboardFile, Dataset } from '@open-artifact/data-core';
import { IconButton, isComposingKey } from '@open-artifact/ui';
import { DesignPanel } from '../design/DesignPanel.tsx';
import { HistoryPanel } from '../history/HistoryPanel.tsx';
import type { PageSnapshot } from '../page/runtime.ts';
import { SourcesPanel, type SourcesUsage } from '../sources/SourcesPanel.tsx';
import { useDatasets } from '../state/datasets.ts';
import { useShownContent } from '../state/shown.ts';
import {
  clampPanelWidth,
  closePanel,
  fitPanelWidth,
  nextPanelStop,
  ownPanelWidth,
  PAGE_MIN_WIDTH,
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  resizePress,
  RESIZE_CLICK_WAIT_MS,
  setOwnPanelWidth,
  setPanelWidth,
  usePanel,
  usePanels,
  type PanelId,
} from './panels.ts';
import { CLOSE_PANEL_LABEL, DESIGN_PANEL_NAME, HISTORY_PANEL_NAME, RESIZE_PANEL_LABEL, SOURCES_PANEL_NAME } from './words.ts';

const KEY_STEP = 16;
const NAMES: Record<PanelId, string> = { sources: SOURCES_PANEL_NAME, design: DESIGN_PANEL_NAME, history: HISTORY_PANEL_NAME };

/** How the page uses each source, from the page's snapshot. */
export function sourcesUsage(
  usage: PageSnapshot['usage'],
  datasets: readonly Dataset[] = [],
  files: readonly DashboardFile[] = [],
): SourcesUsage | undefined {
  if (usage === null) return undefined;
  const read = new Set(usage.datasets);
  const unused = datasets.filter(
    (dataset) => !read.has(dataset.id) && dataset.source.kind !== 'calc' && !files.some((file) => file.text.includes(dataset.id)),
  );
  return {
    read: usage.datasets,
    unmarked: new Set(usage.unmarked),
    unread: new Set(usage.unread),
    unused: new Set(unused.map((dataset) => dataset.id)),
  };
}

/**
 * The widest the panel may be: {@link PANEL_MAX_WIDTH}, and no more than the stylesheet's `max-width` on it (the
 * page keeps {@link PAGE_MIN_WIDTH} of the panel's container) or the window allows.
 */
function widestPanel(panel: HTMLElement | null): number {
  const room = panel?.parentElement?.clientWidth;
  const byRoom = room === undefined || room <= 0 ? PANEL_MAX_WIDTH : room - PAGE_MIN_WIDTH;
  return Math.max(PANEL_MIN_WIDTH, Math.min(clampPanelWidth(PANEL_MAX_WIDTH, globalThis.innerWidth ?? Number.POSITIVE_INFINITY), byRoom));
}

function Resizer(): ReactElement {
  const width = usePanels((state) => state.width);
  const own = usePanels((state) => state.own);
  const handle = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; width: number; dragging: boolean } | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [max, setMax] = useState(PANEL_MAX_WIDTH);

  // The room beside the page changes with the window: the widest stop follows, and a wider panel comes back in.
  useEffect(() => {
    const panel = handle.current?.parentElement ?? null;
    const container = panel?.parentElement ?? null;
    const measure = (): void => {
      const widest = widestPanel(panel);
      setMax(widest);
      fitPanelWidth(widest);
    };
    measure();
    if (container === null || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => clearTimeout(clickTimer.current), []);

  const cancelClick = (): void => {
    clearTimeout(clickTimer.current);
    clickTimer.current = undefined;
  };
  const stops = { home: clampPanelWidth(PANEL_DEFAULT_WIDTH), max, min: PANEL_MIN_WIDTH };
  const down = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { x: event.clientX, y: event.clientY, width, dragging: false };
  };
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const pressed = press.current;
    if (pressed === null) return;
    if (!pressed.dragging && resizePress(event.clientX - pressed.x, event.clientY - pressed.y) !== 'drag') return;
    if (!pressed.dragging) cancelClick();
    pressed.dragging = true;
    setPanelWidth(Math.min(max, pressed.width + (pressed.x - event.clientX)));
  };
  const up = (event: PointerEvent<HTMLDivElement>): void => {
    const pressed = press.current;
    press.current = null;
    if (pressed === null) return;
    if (pressed.dragging) {
      const own = ownPanelWidth(usePanels.getState().width, stops);
      if (own !== null) setOwnPanelWidth(own);
      return;
    }
    if (event.type !== 'pointerup' || resizePress(event.clientX - pressed.x, event.clientY - pressed.y) !== 'click') return;
    // A click steps once it is clear no double click follows.
    cancelClick();
    clickTimer.current = setTimeout(() => {
      clickTimer.current = undefined;
      const current = usePanels.getState();
      setPanelWidth(nextPanelStop(current.width, { ...stops, own: current.own }));
    }, RESIZE_CLICK_WAIT_MS);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (isComposingKey(event.nativeEvent)) return;
    cancelClick();
    const delta = event.key === 'ArrowLeft' ? KEY_STEP : event.key === 'ArrowRight' ? -KEY_STEP : 0;
    if (event.key === 'Home') setPanelWidth(max);
    else if (event.key === 'End') setPanelWidth(PANEL_MIN_WIDTH);
    else if (delta !== 0) setPanelWidth(Math.min(max, width + delta));
    else return;
    event.preventDefault();
  };
  return (
    <div
      ref={handle}
      role="separator"
      aria-orientation="vertical"
      aria-label={RESIZE_PANEL_LABEL}
      aria-valuemin={PANEL_MIN_WIDTH}
      aria-valuemax={max}
      aria-valuenow={width}
      data-own-width={own ?? undefined}
      tabIndex={0}
      className="dash-panel-resizer"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={cancelClick}
      onKeyDown={key}
    />
  );
}

function Titled({ id, children }: { id: PanelId; children: ReactElement }): ReactElement {
  return (
    <>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-fg">{NAMES[id]}</h2>
        <IconButton size="sm" label={CLOSE_PANEL_LABEL} icon={<X className="size-4" />} onClick={() => closePanel(id)} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </>
  );
}

/** Where the focus goes in a panel that opens: a row's run-as control, else the first row's main control, else the panel. */
export const PANEL_FOCUS_TARGETS = ['[data-runs-as]', '[data-row-main]'] as const;

function panelFocusTarget(panel: HTMLElement): HTMLElement {
  for (const selector of PANEL_FOCUS_TARGETS) {
    const found = panel.querySelector<HTMLElement>(selector);
    if (found !== null) return found;
  }
  return panel;
}

/** Whether the last thing the viewer did was press with a pointer, so a panel it opened takes the focus without a ring. */
function usePointerLast(): { readonly current: boolean } {
  const pointer = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const options = { capture: true, signal: controller.signal };
    window.addEventListener('pointerdown', () => (pointer.current = true), options);
    window.addEventListener(
      'keydown',
      (event) => {
        if (!isComposingKey(event)) pointer.current = false;
      },
      options,
    );
    return () => controller.abort();
  }, []);
  return pointer;
}

export interface SidePanelProps {
  usage: PageSnapshot['usage'];
  onAskWhy?: (datasets: Dataset[]) => void;
}

export function SidePanel({ usage, onAskWhy }: SidePanelProps): ReactElement | null {
  const panel = usePanel();
  const width = usePanels((state) => state.width);
  const datasets = useDatasets((state) => state.datasets);
  const files = useShownContent().content.files;
  const used = useMemo(() => sourcesUsage(usage, datasets, files), [usage, datasets, files]);
  const aside = useRef<HTMLElement>(null);
  const pointerLast = usePointerLast();
  // A panel that opens takes the focus on the next frame, once its rows are drawn.
  useEffect(() => {
    if (panel === null) return;
    const frame = requestAnimationFrame(() => {
      const root = aside.current;
      // A panel whose own controls already took the focus keeps it there.
      if (root === null || root.contains(document.activeElement)) return;
      const options: FocusOptions & { focusVisible?: boolean } = { preventScroll: true };
      if (pointerLast.current) options.focusVisible = false;
      panelFocusTarget(root).focus(options);
    });
    return () => cancelAnimationFrame(frame);
  }, [panel, pointerLast]);
  if (panel === null) return null;
  return (
    <aside
      ref={aside}
      tabIndex={-1}
      className="dash-side outline-none"
      aria-label={NAMES[panel]}
      style={{ width }}
      data-uncommentable=""
      data-panel={panel}
    >
      <Resizer />
      {panel === 'sources' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <SourcesPanel usage={used} onClose={() => closePanel('sources')} {...(onAskWhy === undefined ? {} : { onAskWhy })} />
        </div>
      ) : panel === 'design' ? (
        <Titled id="design">
          <DesignPanel />
        </Titled>
      ) : (
        <Titled id="history">
          <HistoryPanel />
        </Titled>
      )}
    </aside>
  );
}
