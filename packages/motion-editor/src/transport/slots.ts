/**
 * Buttons later parts of the page add to the actions bar. `start` items lead it; `end` items follow, ordered by
 * {@link TOOLBAR_ORDER} so Export and Comments keep their places whichever registers first; More and full screen come
 * next, and `last` items (the panel toggle) close the bar, beside the side panel.
 */

import type { ReactNode } from 'react';
import { create } from 'zustand';

export const TOOLBAR_ORDER = { tweaks: 10, style: 20, layers: 30, export: 40, comments: 50 } as const;

export interface ToolbarItem {
  id: string;
  side: 'start' | 'end' | 'last';
  order: number;
  render: () => ReactNode;
}

export const useToolbar = create<{ items: readonly ToolbarItem[] }>()(() => ({ items: [] }));

export function registerToolbarItem(item: ToolbarItem): () => void {
  useToolbar.setState((state) => ({ items: [...state.items.filter((known) => known.id !== item.id), item].sort((a, b) => a.order - b.order) }));
  return () => useToolbar.setState((state) => ({ items: state.items.filter((known) => known !== item) }));
}
