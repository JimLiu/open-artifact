/**
 * Scale mode (K, or Scale… in the stage menu): scales the selection, and
 * everything inside it, by one factor. While it is on, the format strip
 * holds a percent field in place of its controls and the selection's grips
 * scale instead of resizing. The stage draws a preview; nothing is written
 * until the scale is kept, then as one undo step. Enter (or leaving the
 * strip, clicking elsewhere, changing the selection) keeps it, Escape and
 * ⌘Z put the slide back.
 */

import type { PointerEvent as ReactPointerEvent } from 'react';
import { create } from 'zustand';
import { nodeAt, rotationOf, type NodePath, type Rect, type Slide } from '@open-artifact/slides-core';
import { announce } from '@open-artifact/editor-kit';
import { isComposingKey, toast } from '@open-artifact/ui';
import {
  anchorShift,
  clampScale,
  formatScale,
  gripAnchor,
  gripFactor,
  measuredKey,
  needsMeasure,
  scaleGrips,
  scaleLimits,
  scaleSlide,
  type GripId,
  type Measured,
  type Point,
  type ScaleGrips,
  type ScaleLimits,
  type ScaleTarget,
  type ScaleUnit,
} from '../lib/scale.ts';
import { undoRedoKey } from '../lib/shortcut-keys.ts';
import { useDeck } from '../state/deck.ts';
import { stageScale, useView } from '../state/view.ts';
import { changeSlide, editableEntry, refuse, selectedPaths, selectionLockRefusal } from './commands.ts';
import { elementOf, hostRect, measure, measureBox } from '../components/stage/geometry.ts';

/** The strip while Scale is on (pointer presses in it leave the scale on). */
export const SCALE_STRIP_ATTRIBUTE = 'data-open-artifact-scale';
/** A grip that scales (presses on it leave the scale on). */
export const SCALE_GRIP_ATTRIBUTE = 'data-open-artifact-scale-grip';

/** A scale in progress. */
export interface ScaleSession {
  slideId: string;
  /** The slide when the scale started: what Cancel goes back to, and what the scale is drawn from. */
  before: Slide;
  /** The selection it scales, as a key (a different selection keeps the scale and ends it). */
  selection: string;
  target: ScaleTarget;
  /** The lone selected element's rotation (0 for several). */
  rotation: number;
  limits: ScaleLimits;
  grips: ScaleGrips;
  factor: number;
  /** How far the box has moved so far (the grips keep their opposite side in place). */
  shift: Point;
  /** The slide as scaled now; null while nothing has changed. */
  preview: Slide | null;
  /** What had the focus when the strip appeared. */
  returnTo: Element | null;
}

interface ScaleState {
  session: ScaleSession | null;
  /** A grip is being dragged. */
  dragging: boolean;
  /** The field holds text that is no usable size. */
  typedInvalid: boolean;
}

export const useScale = create<ScaleState>(() => ({ session: null, dragging: false, typedInvalid: false }));

/** True while a scale is on. */
export function scaling(): boolean {
  return useScale.getState().session !== null;
}

const selectionKey = (paths: readonly NodePath[]): string => paths.map((p) => p.join('.')).join(',');

/* -------------------------------------------------------------------------- */
/* Measuring                                                                   */
/* -------------------------------------------------------------------------- */

function stageRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-open-artifact-stage] [data-open-artifact-slide]');
}

/** Measures the selection as drawn now, or says why it cannot be. */
function measureSelection(slide: Slide, paths: readonly NodePath[]): { target: ScaleTarget; rotation: number } | string {
  const root = stageRoot();
  if (!root) return 'The selection could not be measured. Try again.';
  const scale = stageScale(useView.getState());
  const units: ScaleUnit[] = [];
  const bounds: Rect[] = [];
  const rotation = paths.length === 1 ? rotationOf(nodeAt(slide, paths[0]!)!) : 0;
  for (const path of paths) {
    const node = nodeAt(slide, path);
    const el = elementOf(root, path);
    if (!node || !el) return 'The selection could not be measured. Try again.';
    const box = measureBox(root, el, scale, rotationOf(node));
    const host = hostRect(root, slide, path, scale);
    const measured = new Map<string, Measured>();
    const visit = (at: NodePath): void => {
      const inner = nodeAt(slide, at);
      if (!inner) return;
      const need = needsMeasure(inner);
      const shown = need.size || need.font ? elementOf(root, at) : null;
      if (shown) {
        const seen: Measured = {};
        if (need.size) {
          seen.w = shown.offsetWidth;
          seen.h = shown.offsetHeight;
        }
        if (need.font) {
          const size = parseFloat(getComputedStyle(shown).fontSize);
          if (size > 0) seen.fontSize = size;
        }
        measured.set(measuredKey(at), seen);
      }
      if (inner.kind === 'box') inner.children.forEach((_child, i) => visit([...at, i]));
    };
    visit(path);
    units.push({ path, host: { x: host.x, y: host.y }, rect: { x: box.x - host.x, y: box.y - host.y, w: box.w, h: box.h }, measured });
    bounds.push(paths.length === 1 ? box : measure(root, el, scale));
  }
  const x = Math.min(...bounds.map((b) => b.x));
  const y = Math.min(...bounds.map((b) => b.y));
  const box = { x, y, w: Math.max(...bounds.map((b) => b.x + b.w)) - x, h: Math.max(...bounds.map((b) => b.y + b.h)) - y };
  if (!(box.w > 0) || !(box.h > 0)) return 'Something with no width or no height has nothing to scale.';
  return { target: { units, box }, rotation };
}

/* -------------------------------------------------------------------------- */
/* Starting and ending                                                         */
/* -------------------------------------------------------------------------- */

/** Why Scale cannot start on the selection now, or null when it can. */
export function scaleRefusal(): string | null {
  const view = useView.getState();
  if (!editableEntry(view.current)) return 'This slide cannot be changed right now.';
  if (view.textEdit || view.cropping) return 'Finish editing first.';
  if (selectedPaths().length === 0) return 'Select something on the slide to scale it.';
  return selectionLockRefusal();
}

/** Starts scaling the selection (K, Scale…). */
export function startScale(): void {
  if (scaling()) return;
  const refusal = scaleRefusal();
  if (refusal) {
    refuse(refusal);
    return;
  }
  const view = useView.getState();
  const slideId = view.current!;
  const slide = useDeck.getState().slides[slideId]!.slide;
  const paths = topmostPaths(selectedPaths());
  const measured = measureSelection(slide, paths);
  if (typeof measured === 'string') {
    toast.add({ title: measured });
    return;
  }
  useScale.setState({
    session: {
      slideId,
      before: slide,
      selection: selectionKey(view.selection),
      target: measured.target,
      rotation: measured.rotation,
      limits: scaleLimits(slide, measured.target, nodeAt),
      grips: scaleGrips(slide, paths, nodeAt),
      factor: 1,
      shift: { x: 0, y: 0 },
      preview: null,
      returnTo: document.activeElement,
    },
    dragging: false,
    typedInvalid: false,
  });
  listen(true);
}

function topmostPaths(paths: readonly NodePath[]): NodePath[] {
  const inside = (outer: NodePath, inner: NodePath): boolean => outer.length < inner.length && outer.every((step, i) => inner[i] === step);
  return paths.filter((p) => !paths.some((q) => inside(q, p)));
}

/** How a scale ended: kept, cancelled, or cut short because the slide changed under it. */
type Ending = 'keep' | 'cancel' | 'changed';

function end(how: Ending): void {
  const { session, typedInvalid } = useScale.getState();
  if (!session) return;
  stopDrag?.();
  listen(false);
  const focusInStrip = Boolean(document.activeElement?.closest(`[${SCALE_STRIP_ATTRIBUTE}]`));
  useScale.setState({ session: null, dragging: false, typedInvalid: false });
  if (how === 'keep' && session.preview) {
    changeSlide(session.slideId, 'Scale', (slide) => (slide === session.before ? session.preview : null));
    announce(typedInvalid ? `No usable size was typed: the scale stays at ${formatScale(session.factor)}` : `Scaled to ${formatScale(session.factor)}`);
  } else if (how === 'cancel' && session.preview) {
    announce('Scale cancelled');
  } else if (how === 'changed') {
    announce('Scale ended: the slide was changed elsewhere');
  }
  if (focusInStrip) returnFocus(session.returnTo);
}

function returnFocus(to: Element | null): void {
  if (to instanceof HTMLElement && to.isConnected && to !== document.body && !to.closest(`[${SCALE_STRIP_ATTRIBUTE}]`)) {
    to.focus({ preventScroll: true });
    // It may no longer take the focus (the stage only does while it holds it).
    if (document.activeElement === to) return;
  }
  const stage = document.querySelector<HTMLElement>('[data-open-artifact-stage]');
  if (!stage) return;
  if (!stage.hasAttribute('tabindex')) {
    stage.setAttribute('tabindex', '-1');
    stage.addEventListener('blur', () => stage.removeAttribute('tabindex'), { once: true });
  }
  stage.focus({ preventScroll: true });
}

/** Keeps the scale as it is now. */
export function keepScale(): void {
  end('keep');
}

/** Puts the slide back as it was and ends the scale. */
export function cancelScale(): void {
  end('cancel');
}

/* -------------------------------------------------------------------------- */
/* Changing the factor                                                         */
/* -------------------------------------------------------------------------- */

function draw(factor: number, shift: Point): void {
  const { session } = useScale.getState();
  if (!session) return;
  const scaled = scaleSlide(session.before, session.target, factor, shift);
  useScale.setState({ session: { ...session, factor, shift, preview: scaled === session.before ? null : scaled } });
}

/** Sets the factor from the field: the box's top-left stays where it is. */
export function setScale(factor: number): void {
  const { session } = useScale.getState();
  if (!session) return;
  const next = clampScale(factor, session.limits);
  const move = anchorShift(session.target.box, { x: 0, y: 0 }, session.factor, next, session.rotation);
  draw(next, { x: session.shift.x + move.x, y: session.shift.y + move.y });
}

/** Tells the scale whether the field holds an unusable size (said when the scale is kept anyway). */
export function noteTypedInvalid(invalid: boolean): void {
  if (useScale.getState().typedInvalid !== invalid) useScale.setState({ typedInvalid: invalid });
}

let stopDrag: (() => void) | null = null;

/** Drags a grip: scales about the opposite corner (or side), in the box's own frame when it is turned. */
export function startScaleGrip(event: ReactPointerEvent, grip: GripId): void {
  const { session } = useScale.getState();
  event.stopPropagation();
  if (!session || stopDrag || event.button !== 0) return;
  // The field keeps the focus: typing goes on from where the drag leaves the factor.
  event.preventDefault();
  const zoom = stageScale(useView.getState());
  const from = { x: event.clientX, y: event.clientY, factor: session.factor, shift: session.shift, pointer: event.pointerId };
  const anchor = gripAnchor(grip);
  const { box } = session.target;
  const onMove = (move: PointerEvent): void => {
    if (move.pointerId !== from.pointer) return;
    if (move.buttons === 0) {
      stopDrag?.();
      return;
    }
    const ratio = gripFactor({ w: box.w * from.factor, h: box.h * from.factor }, grip, (move.clientX - from.x) / zoom, (move.clientY - from.y) / zoom, session.rotation);
    const factor = clampScale(Math.round(from.factor * ratio * 1000) / 1000, session.limits);
    const moved = anchorShift(box, anchor, from.factor, factor, session.rotation);
    draw(factor, { x: from.shift.x + moved.x, y: from.shift.y + moved.y });
  };
  const onUp = (up: PointerEvent): void => {
    if (up.pointerId === from.pointer) stopDrag?.();
  };
  stopDrag = () => {
    stopDrag = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    useScale.setState({ dragging: false });
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  useScale.setState({ dragging: true });
}

/* -------------------------------------------------------------------------- */
/* Keys, presses and changes around it                                         */
/* -------------------------------------------------------------------------- */

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

/**
 * A key pressed while a scale is on and the focus is not in its strip (the
 * field handles its own): Escape cancels, ⌘Z cancels (and undoes the step
 * before when the scale had changed nothing yet), Enter keeps, and any
 * other key keeps the scale and then does what it does. True when the key
 * was used up.
 */
export function scaleKey(event: KeyboardEvent): boolean {
  const { session } = useScale.getState();
  if (!session || isComposingKey(event) || MODIFIERS.has(event.key)) return false;
  if (event.target instanceof Element && event.target.closest(`[${SCALE_STRIP_ATTRIBUTE}]`)) return false;
  const undoKey = undoRedoKey(event) === 'undo';
  if (event.key === 'Escape' || (undoKey && session.preview)) {
    event.preventDefault();
    cancelScale();
    return true;
  }
  if (undoKey) {
    cancelScale();
    return false;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    keepScale();
    return true;
  }
  keepScale();
  return false;
}

/** ⌘Z in the field: cancels once the scale has changed something (before that it undoes the typing). */
export function scaleUndoInField(): boolean {
  const { session } = useScale.getState();
  if (!session?.preview) return false;
  cancelScale();
  return true;
}

const onPointerDown = (event: PointerEvent): void => {
  const target = event.target;
  if (target instanceof Element && target.closest(`[${SCALE_STRIP_ATTRIBUTE}], [${SCALE_GRIP_ATTRIBUTE}]`)) return;
  keepScale();
};
const onBlur = (): void => keepScale();
const onVisibility = (): void => {
  if (document.visibilityState === 'hidden') keepScale();
};

function listen(on: boolean): void {
  if (on) {
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
  } else {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
  }
}

// Another selection or slide keeps the scale; text editing or cropping puts the slide back.
useView.subscribe((view, previous) => {
  const { session } = useScale.getState();
  if (!session) return;
  if ((view.textEdit && !previous.textEdit) || (view.cropping && !previous.cropping)) cancelScale();
  else if (view.current !== session.slideId || selectionKey(view.selection) !== session.selection) keepScale();
});

// The slide changed under the scale (the agent, another window, a read-only switch): the preview is dropped.
useDeck.subscribe((deck) => {
  const { session } = useScale.getState();
  if (!session) return;
  const entry = deck.slides[session.slideId];
  if (!entry || entry.slide !== session.before || deck.readOnly) end('changed');
});
