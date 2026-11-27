/**
 * The properties panel at the editor's right edge.
 *
 * With nothing selected it shows the slide: its transition and its
 * background. With elements selected it shows, top to bottom: Size, Layout,
 * the element's own content (image or video, icon, connector, line, table,
 * embed), Appearance, Text, Effects and the Advanced settings. Text elements
 * show Text before Appearance, everything else the other way round.
 *
 * A Properties / Theme switch heads the panel; the Theme tab restyles the
 * whole deck from an installed design system's look (ThemePanel.tsx). The
 * stage's top-right card toggles the panel, and it can be resized from its
 * left edge; the width and the tab are remembered per browser.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { isTextual, setTransition, TRANSITIONS, type SlideNode, type Transition } from '@open-artifact/slides-core';
import { Note, Row, Section, Segmented, SelectInput } from './kit.tsx';
import { ThemePanel } from '../ThemePanel.tsx';
import { useSelectedNodes } from '../../state/selection.ts';
import { changeCurrent } from '../../services/commands.ts';
import { AdvancedSection } from './AdvancedSection.tsx';
import { ConnectorSection, EmbedSection, IconSection, ImageSection, LineSection, TableSection } from './ContentSections.tsx';
import { LayoutSection, SizeSection } from './LayoutSections.tsx';
import { AppearanceSection, EffectsSection } from './StyleSections.tsx';
import { TextSection } from './TextSection.tsx';
import type { Target } from './shared.tsx';
import { landAfterRowPress } from '../../lib/focus-landing.ts';
import { holdHandle, isHandlePress, moveHandle, PANEL_PRESS_DELAY, pressedWidth, type HandlePointer } from '../../lib/panel-width.ts';

/* -------------------------------------------------------------------------- */
/* Width                                                                       */
/* -------------------------------------------------------------------------- */

const WIDTH_KEY = 'open-artifact-slides:properties-width';
const DEFAULT_WIDTH = 304;
const MIN_WIDTH = 285;

/** The widest the panel may get: 560px, and always 120px of room for the stage. */
function maxWidth(): number {
  return Math.min(560, window.innerWidth - 120);
}

function clampWidth(width: number): number {
  return Math.round(Math.max(MIN_WIDTH, Math.min(maxWidth(), width)));
}

function readWidth(): number {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return stored ? clampWidth(stored) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(width: number): void {
  try {
    if (width === DEFAULT_WIDTH) localStorage.removeItem(WIDTH_KEY);
    else localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // Storage is a convenience: without it the panel opens at its default width.
  }
}

/** The panel's width, its resize handle's props, and re-clamping on window resize. */
function usePanelWidth(): { width: number; handle: ReactNode } {
  const [width, setWidth] = useState(readWidth);
  const drag = useRef<{ pointer: HandlePointer; width: number; mouse: boolean } | null>(null);
  const latest = useRef(width);
  latest.current = width;
  // Only a drag sets this (not Home, End, arrows or a press); it lasts while the page is open.
  const dragged = useRef<number | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const onResize = (): void => setWidth((w) => clampWidth(w));
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(pressTimer.current);
    };
  }, []);

  const commit = (next: number): number => {
    const clamped = clampWidth(next);
    setWidth(clamped);
    saveWidth(clamped);
    return clamped;
  };
  const press = (): void => {
    const presets = { home: clampWidth(DEFAULT_WIDTH), min: clampWidth(MIN_WIDTH), max: clampWidth(maxWidth()), dragged: dragged.current };
    commit(pressedWidth(latest.current, presets));
  };
  const cancelPress = (): void => {
    clearTimeout(pressTimer.current);
    pressTimer.current = undefined;
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    cancelPress();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: holdHandle(event.clientX, event.clientY), width, mouse: event.pointerType === 'mouse' };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const held = drag.current;
    if (!held) return;
    held.pointer = moveHandle(held.pointer, event.clientX, event.clientY);
    if (held.pointer.dragging) setWidth(clampWidth(held.width + held.pointer.x - event.clientX));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const held = drag.current;
    if (!held) return;
    drag.current = null;
    held.pointer = moveHandle(held.pointer, event.clientX, event.clientY);
    if (held.pointer.dragging) {
      dragged.current = commit(held.width + held.pointer.x - event.clientX);
    } else if (isHandlePress(held.pointer)) {
      if (held.mouse) pressTimer.current = setTimeout(press, PANEL_PRESS_DELAY);
      else press();
    }
  };
  /** The pointer was taken away: keep what a drag reached, never count it as a press. */
  const onPointerLost = (): void => {
    const held = drag.current;
    if (!held) return;
    drag.current = null;
    if (held.pointer.dragging) dragged.current = commit(latest.current);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === 'ArrowLeft') commit(width + step);
    else if (event.key === 'ArrowRight') commit(width - step);
    else if (event.key === 'Home') commit(MIN_WIDTH);
    else if (event.key === 'End') commit(maxWidth());
    else if (event.key === 'Enter' || event.key === ' ') {
      if (!event.repeat) press();
    } else return;
    event.preventDefault();
  };

  const handle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the properties panel"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={maxWidth()}
      tabIndex={0}
      title="Drag to resize. Click to step through sizes, double-click to reset."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerLost}
      onLostPointerCapture={onPointerLost}
      onDoubleClick={() => {
        cancelPress();
        commit(DEFAULT_WIDTH);
      }}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-0 -left-1 z-10 flex w-2 cursor-col-resize justify-center outline-none"
    >
      <span className="h-full w-px bg-transparent transition-colors group-hover:bg-chrome-accent group-focus-visible:bg-chrome-accent group-active:bg-chrome-accent" />
    </div>
  );
  return { width, handle };
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                       */
/* -------------------------------------------------------------------------- */

const TRANSITION_LABELS: Record<Transition | 'none', string> = { none: 'None', fade: 'Fade', push: 'Push', magic: 'Magic move' };

const TRANSITION_TIP = 'How this slide leaves for the next one in Present';

const MAGIC_MOVE_NOTE =
  'Magic move animates elements this slide shares with the next one into their new place. Duplicate the slide, then move or resize — duplicates keep the element identity that pairs them up.';

/* -------------------------------------------------------------------------- */
/* Tab                                                                         */
/* -------------------------------------------------------------------------- */

const TAB_KEY = 'open-artifact-slides:properties-tab';

type PanelTab = 'properties' | 'theme';

function readTab(): PanelTab {
  try {
    return localStorage.getItem(TAB_KEY) === 'theme' ? 'theme' : 'properties';
  } catch {
    return 'properties';
  }
}

/** The panel's tab, remembered per browser. */
function usePanelTab(): [PanelTab, (tab: PanelTab) => void] {
  const [tab, setTab] = useState<PanelTab>(readTab);
  const choose = (next: PanelTab): void => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Storage is a convenience: the panel then opens on Properties.
    }
  };
  return [tab, choose];
}

/** The panel. */
export function PropertiesPanel(): ReactNode {
  const { slide, slideId, readOnly, paths, nodes } = useSelectedNodes();
  const { width, handle } = usePanelWidth();
  const [tab, setTab] = usePanelTab();
  const target: Target | null = useMemo(() => (slide ? { slide, paths: nodes.length ? paths : [[]], nodes } : null), [slide, paths, nodes]);

  let body: ReactNode = null;
  if (readOnly) {
    body = <Note className="py-4">This presentation is read-only here, so its properties can’t be edited.</Note>;
  } else if (slide && target && slideId) {
    body =
      nodes.length === 0 ? (
        <SlideSections target={target} />
      ) : (
        <>
          <ElementSections target={target} nodes={nodes} />
          <AdvancedSection target={target} />
        </>
      );
  }

  return (
    <aside
      data-open-artifact-properties
      aria-label="Properties"
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-l border-chrome-sep bg-chrome text-chrome-fg"
      onClickCapture={(event) => landAfterRowPress(event.nativeEvent, event.currentTarget)}
    >
      {handle}
      <div className="shrink-0 border-b border-chrome-sep px-3 py-2">
        <Segmented<PanelTab>
          aria-label="Panel"
          value={tab}
          options={[
            { value: 'properties', label: 'Properties' },
            { value: 'theme', label: 'Theme' },
          ]}
          onChange={setTab}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pb-1">{tab === 'theme' ? <ThemePanel /> : body}</div>
    </aside>
  );
}

/** Sections shown for the slide itself: its transition and its background. */
function SlideSections({ target }: { target: Target }): ReactNode {
  const { slide } = target;
  return (
    <>
      <Section title="Slide">
        <Row label="Transition" tip={TRANSITION_TIP}>
          <SelectInput<Transition | 'none'>
            aria-label="Transition"
            title={TRANSITION_TIP}
            value={slide.transition ?? 'none'}
            options={(['none', ...TRANSITIONS] as const).map((t) => ({ value: t, label: TRANSITION_LABELS[t] }))}
            onChange={(value) => changeCurrent('Transition', (s) => setTransition(s, value === 'none' ? undefined : value))}
          />
        </Row>
      </Section>
      <AppearanceSection target={target} fillLabel="Background" opacity={false} radius={false} border={false} />
      <Note className="pt-3">{MAGIC_MOVE_NOTE}</Note>
    </>
  );
}

/** Sections shown for selected elements. */
function ElementSections({ target, nodes }: { target: Target; nodes: SlideNode[] }): ReactNode {
  const kinds = new Set(nodes.map((n) => n.kind));
  const only = kinds.size === 1 ? [...kinds][0]! : null;
  const isLine = nodes.every((n) => n.kind === 'rule' || (n.kind === 'shape' && n.shape === 'line'));
  const allText = nodes.every(isTextual);
  const anyShape = nodes.some((n) => n.kind === 'shape');
  // Connectors draw their own Appearance (line, color, width).
  const appearance =
    only === 'connector' ? null : (
      <AppearanceSection
        target={target}
        fill={!isLine}
        gradients={!anyShape && only !== 'icon'}
        radius={!isLine && only !== 'icon' && only !== 'svg' && !nodes.some((n) => n.kind === 'shape' && n.shape !== 'rect' && n.shape !== 'rounded')}
        border={!isLine && only !== 'svg' && only !== 'embed'}
        buildControlled={nodes.some((n) => n.buildIn || n.buildOut)}
      />
    );
  return (
    <>
      <SizeSection target={target} />
      <LayoutSection target={target} />
      <ImageSection target={target} />
      <IconSection target={target} />
      <ConnectorSection target={target} />
      <LineSection target={target} />
      <TableSection target={target} />
      <EmbedSection target={target} />
      {allText ? null : appearance}
      <TextSection target={target} />
      {allText ? appearance : null}
      <EffectsSection target={target} />
    </>
  );
}
