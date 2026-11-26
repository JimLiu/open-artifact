/**
 * The selection store: what this viewer has selected, is editing or hovers.
 * Per tab; peers see it through presence.
 */

import { create } from 'zustand';
import type { ElementId } from '@open-artifact/whiteboard-core';
import type { Rect } from '../lib/camera.ts';

/** What text is being edited in place. */
export type TextEditTarget =
  /** An element's main text (note, shape, text, section title, link title). */
  | { kind: 'element'; id: ElementId; /** Select all on start (typing over a new element). */ selectAll?: boolean; /** Character to type first. */ initial?: string; /** Started by a whole-text format button (a placeholder text then still gets the typing bar). */ formatted?: boolean }
  /** An arrow's label. */
  | { kind: 'arrow-label'; id: ElementId }
  /** One table cell. */
  | { kind: 'cell'; id: ElementId; row: string; col: string };

/** One layer of a drawing picked inside it: the drawing, the layer's index (back first) and its id. */
export interface PickedLayer {
  el: ElementId;
  n: number;
  id: string;
}

export interface SelectionState {
  /** Selected element ids, in the order they were picked. */
  ids: readonly ElementId[];
  /** The group the selection works inside (after double-clicking into a group), outermost first. */
  groupPath: readonly string[];
  /** In-place text editing. */
  editing: TextEditTarget | null;
  /** Element under the pointer. */
  hover: ElementId | null;
  /** The rubber band, board units, while dragging over empty board. */
  marquee: Rect | null;
  /** Image whose crop is being edited. */
  cropping: ElementId | null;
  /** The layer picked inside the one selected drawing. */
  layer: PickedLayer | null;
  select(ids: readonly ElementId[], options?: { groupPath?: readonly string[] }): void;
  toggle(id: ElementId): void;
  add(ids: readonly ElementId[]): void;
  clear(): void;
  edit(target: TextEditTarget | null): void;
  setHover(id: ElementId | null): void;
  setMarquee(rect: Rect | null): void;
  setCropping(id: ElementId | null): void;
  /** Selects the layer's drawing alone and picks the layer; `null` goes back to the whole drawing. */
  pickLayer(layer: PickedLayer | null): void;
  /** Drops ids that no longer exist (after a remote delete). */
  prune(exists: (id: ElementId) => boolean): void;
}

const EMPTY: readonly ElementId[] = Object.freeze([]);

function sameIds(a: readonly ElementId[], b: readonly ElementId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export const useSelection = create<SelectionState>()((set, get) => ({
  ids: EMPTY,
  groupPath: EMPTY,
  editing: null,
  hover: null,
  marquee: null,
  cropping: null,
  layer: null,
  select(ids, options) {
    const unique = [...new Set(ids)];
    const groupPath = options?.groupPath ?? (unique.length === 0 ? EMPTY : get().groupPath);
    if (sameIds(unique, get().ids) && sameIds(groupPath, get().groupPath)) return;
    const editing = get().editing;
    set({
      ids: unique.length ? unique : EMPTY,
      groupPath,
      editing: editing && unique.includes(editing.id) ? editing : null,
      cropping: get().cropping && unique.includes(get().cropping!) ? get().cropping : null,
      layer: unique.length === 1 && get().layer?.el === unique[0] ? get().layer : null,
    });
  },
  toggle(id) {
    const ids = get().ids;
    get().select(ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]);
  },
  add(ids) {
    get().select([...get().ids, ...ids]);
  },
  clear() {
    if (get().ids.length === 0 && get().editing === null && get().cropping === null && get().layer === null) return;
    set({ ids: EMPTY, groupPath: EMPTY, editing: null, cropping: null, layer: null });
  },
  edit(target) {
    set(target ? { editing: target, ids: get().ids.includes(target.id) ? get().ids : [target.id], layer: null } : { editing: null });
  },
  setHover(id) {
    if (get().hover !== id) set({ hover: id });
  },
  setMarquee(rect) {
    set({ marquee: rect });
  },
  setCropping(id) {
    set(id ? { cropping: id, layer: null } : { cropping: null });
  },
  pickLayer(layer) {
    if (layer === null) {
      if (get().layer !== null) set({ layer: null });
      return;
    }
    const current = get().layer;
    if (current?.el === layer.el && current.n === layer.n && current.id === layer.id && sameIds(get().ids, [layer.el])) return;
    set({ ids: [layer.el], editing: null, cropping: null, layer });
  },
  prune(exists) {
    const { ids, editing, hover, cropping, layer } = get();
    const kept = ids.filter(exists);
    const next: Partial<SelectionState> = {};
    if (kept.length !== ids.length) next.ids = kept.length ? kept : EMPTY;
    if (editing && !exists(editing.id)) next.editing = null;
    if (hover && !exists(hover)) next.hover = null;
    if (cropping && !exists(cropping)) next.cropping = null;
    if (layer && !exists(layer.el)) next.layer = null;
    if (Object.keys(next).length) set(next);
  },
}));
