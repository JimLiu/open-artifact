/**
 * Transient interaction state the selection overlay draws: the transform in
 * progress (so the selection bar hides), snap guides, the live turn angle,
 * the element an arrow end would attach to, the arrow being drawn, and the
 * pen stroke being drawn.
 *
 * Only the overlay subscribes to this store, so a drag re-renders the
 * overlay and nothing else. The pen preview skips React entirely: the pen
 * tool writes its path straight into the registered SVG path element.
 */

import { create } from 'zustand';
import type { ArrowSide, ElementId, InkColor, SnapGuide } from '@open-artifact/whiteboard-core';
import type { Point } from '../lib/camera.ts';

/** A transform the selection is going through. */
export type TransformKind = 'move' | 'resize' | 'turn' | 'arrow' | 'draw';

/** The element an arrow end would attach to, and the side. */
export interface ConnectTarget {
  id: ElementId;
  side?: ArrowSide;
}

/** An arrow being drawn (board units). */
export interface ArrowDraft {
  from: Point;
  to: Point;
  color: InkColor;
}

/** A guide line to draw, board units: a vertical (`x`) or horizontal (`y`) line spanning `from`–`to`. */
export interface GuideLine extends SnapGuide {
  from: number;
  to: number;
}

/** How the pen stroke being drawn looks. */
export interface InkLook {
  color: InkColor;
  width: number;
  filled?: boolean;
}

/** The interaction store's state. */
export interface InteractionState {
  /** The transform in progress, if any. */
  transform: TransformKind | null;
  /** Snap guides matched by the drag. */
  guides: readonly GuideLine[];
  /** The selection's turn while it is being turned, degrees. */
  turnDegrees: number | null;
  /** The element an arrow end would attach to. */
  connect: ConnectTarget | null;
  /** The arrow being drawn. */
  arrowDraft: ArrowDraft | null;
  /** The pen stroke's look while drawing (`filled`: drawn with pressure, its path is an outline). */
  ink: InkLook | null;
  /** The lasso being drawn, board points. */
  lasso: readonly Point[] | null;
  /** Where a long press on empty board is held (the ring is shown there), board point. */
  holdRing: Point | null;
  setTransform(transform: TransformKind | null): void;
  setGuides(guides: readonly GuideLine[]): void;
  setTurnDegrees(degrees: number | null): void;
  setConnect(target: ConnectTarget | null): void;
  setArrowDraft(draft: ArrowDraft | null): void;
  setInk(ink: InkLook | null): void;
  setLasso(lasso: readonly Point[] | null): void;
  setHoldRing(at: Point | null): void;
  /** Clears everything (a gesture ended). */
  reset(): void;
}

const NO_GUIDES: readonly GuideLine[] = Object.freeze([]);

function sameGuides(a: readonly GuideLine[], b: readonly GuideLine[]): boolean {
  return (
    a.length === b.length &&
    a.every((guide, index) => {
      const other = b[index]!;
      return guide.axis === other.axis && guide.pos === other.pos && guide.kind === other.kind && guide.from === other.from && guide.to === other.to;
    })
  );
}

/** Transient interaction state (see the module comment). */
export const useInteraction = create<InteractionState>()((set, get) => ({
  transform: null,
  guides: NO_GUIDES,
  turnDegrees: null,
  connect: null,
  arrowDraft: null,
  ink: null,
  lasso: null,
  holdRing: null,
  setTransform(transform) {
    if (get().transform !== transform) set({ transform });
  },
  setGuides(guides) {
    if (!sameGuides(get().guides, guides)) set({ guides: guides.length === 0 ? NO_GUIDES : guides });
  },
  setTurnDegrees(degrees) {
    if (get().turnDegrees !== degrees) set({ turnDegrees: degrees });
  },
  setConnect(target) {
    const current = get().connect;
    if (current?.id === target?.id && current?.side === target?.side) return;
    set({ connect: target });
  },
  setArrowDraft(draft) {
    set({ arrowDraft: draft });
  },
  setInk(ink) {
    set({ ink });
  },
  setLasso(lasso) {
    set({ lasso });
  },
  setHoldRing(at) {
    if (get().holdRing !== at) set({ holdRing: at });
  },
  reset() {
    const state = get();
    if (state.transform === null && state.guides.length === 0 && state.turnDegrees === null && state.connect === null && state.arrowDraft === null && state.ink === null && state.lasso === null && state.holdRing === null)
      return;
    set({ transform: null, guides: NO_GUIDES, turnDegrees: null, connect: null, arrowDraft: null, ink: null, lasso: null, holdRing: null });
  },
}));

/* ------------------------------------------------------------------------ */
/* Pen preview                                                              */
/* ------------------------------------------------------------------------ */

let inkPath: SVGPathElement | null = null;
let pendingInk = '';

/** Registers the SVG path the pen preview draws into (`null` when it unmounts). */
export function registerInkPath(path: SVGPathElement | null): void {
  inkPath = path;
  if (path) path.setAttribute('d', pendingInk);
}

/** Sets the pen preview's path data (board units). */
export function drawInkPreview(d: string): void {
  pendingInk = d;
  inkPath?.setAttribute('d', d);
}

/** Receives the pen stroke being drawn (flat x, y board points, and its widths with pressure), or `null` once it ends. */
export type InkTrailListener = (points: readonly number[] | null, widths?: string) => void;

const inkTrailListeners = new Set<InkTrailListener>();

/** Calls `listener` as the pen stroke being drawn grows; returns a function that stops. */
export function onInkTrail(listener: InkTrailListener): () => void {
  inkTrailListeners.add(listener);
  return () => {
    inkTrailListeners.delete(listener);
  };
}

/** Tells the listeners about the pen stroke being drawn (`null`: it ended). */
export function reportInkTrail(points: readonly number[] | null, widths?: string): void {
  for (const listener of inkTrailListeners) listener(points, widths);
}
