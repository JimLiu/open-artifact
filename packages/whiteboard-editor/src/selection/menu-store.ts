/**
 * The context menu's state: where it opens and what it is about. Kept apart
 * from the menu component so the keyboard (Shift+F10, the Menu key) and the
 * surface's `contextmenu` event can open it without importing React views.
 */

import { create } from 'zustand';
import type { ElementId } from '@open-artifact/whiteboard-core';
import type { Point } from '../lib/camera.ts';

/** A table cell the menu was opened on. */
export interface MenuCell {
  table: ElementId;
  row: string;
  col: string;
}

/** What the menu is about. */
export type MenuKind = 'board' | 'items';

/** The context menu store's state. */
export interface ContextMenuState {
  open: boolean;
  /** Where it opens, viewport (client) pixels. */
  at: Point;
  kind: MenuKind;
  /** Board point under the press (paste lands there). */
  board: Point | null;
  /** The table cell under the press, if any. */
  cell: MenuCell | null;
  /** Opened from the keyboard: its first item takes focus. */
  keyboard: boolean;
  /** Opened from the selection bar's More actions button, which shows it as expanded. */
  fromBar: boolean;
  show(options: { at: Point; kind: MenuKind; board?: Point | null; cell?: MenuCell | null; keyboard?: boolean; fromBar?: boolean }): void;
  hide(): void;
}

/** The context menu store. */
export const useContextMenu = create<ContextMenuState>()((set) => ({
  open: false,
  at: { x: 0, y: 0 },
  kind: 'board',
  board: null,
  cell: null,
  keyboard: false,
  fromBar: false,
  show({ at, kind, board = null, cell = null, keyboard = false, fromBar = false }) {
    set({ open: true, at, kind, board, cell, keyboard, fromBar });
  },
  hide() {
    set({ open: false });
  },
}));
