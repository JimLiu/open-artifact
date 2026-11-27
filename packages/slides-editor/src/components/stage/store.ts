/**
 * Transient state of a gesture on the stage: the slide as it would be if
 * the gesture ended now, snap guides, the marquee and the shape being
 * drawn, and the keys held over the stage (Space to pan, Alt to measure).
 * Nothing here is saved; a gesture commits through the commands.
 */

import { create } from 'zustand';
import type { NodePath, Rect, Slide } from '@open-artifact/slides-core';
import type { Tool } from '../../state/view.ts';
import type { TableTarget } from '../../lib/table-target.ts';

/** A move preview: the moving elements are drawn shifted by (dx, dy). */
export interface MovePreview {
  keys: string[];
  dx: number;
  dy: number;
}

/** A shape being drawn by a draw tool. */
export interface DrawPreview {
  tool: Exclude<Tool, 'select'>;
  /** Start and current point (lines and connectors draw between them). */
  from: { x: number; y: number };
  to: { x: number; y: number };
}

interface StageGestureState {
  /** The slide with the gesture applied (resize, rotate, crop, endpoints). */
  draft: { slideId: string; slide: Slide } | null;
  move: MovePreview | null;
  guides: { x: number[]; y: number[] } | null;
  marquee: Rect | null;
  draw: DrawPreview | null;
  /** The element under the pointer (hover outline). */
  hover: NodePath | null;
  /** The pointer is over the slide itself (not the stage around it). */
  pointerOnSlide: boolean;
  /** Alt (Option) is held: distances from the selection show. */
  altHeld: boolean;
  /** Distances are drawn on the stage right now. */
  measuring: boolean;
  /** Space is held: a press on the stage drags it instead of selecting. */
  spaceHeld: boolean;
  /** The stage is being dragged to scroll it. */
  panning: boolean;
  /** The table cell an open context menu's row and column commands act on (outlined while it stays put). */
  menuCell: TableTarget | null;
  /** Bumped whenever the overlay should re-measure (fonts, images, resizes). */
  layoutTick: number;
  set(patch: Partial<Omit<StageGestureState, 'set' | 'reset' | 'relayout'>>): void;
  /** Ends any gesture preview. */
  reset(): void;
  relayout(): void;
}

/** The stage gesture store. */
export const useStageGesture = create<StageGestureState>()((set, get) => ({
  draft: null,
  move: null,
  guides: null,
  marquee: null,
  draw: null,
  hover: null,
  pointerOnSlide: false,
  altHeld: false,
  measuring: false,
  spaceHeld: false,
  panning: false,
  menuCell: null,
  layoutTick: 0,
  set(patch) {
    set(patch);
  },
  reset() {
    set({ draft: null, move: null, guides: null, marquee: null, draw: null });
  },
  relayout() {
    set({ layoutTick: get().layoutTick + 1 });
  },
}));
