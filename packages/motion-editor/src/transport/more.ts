/**
 * Rows later parts of the page add to the toolbar's More menu. Rows of one `group` sit together, groups in order with
 * a rule between them, and each group's rows by `order`.
 */

import type { ReactNode } from 'react';
import { create } from 'zustand';

export interface MoreItem {
  id: string;
  group: number;
  order: number;
  render: () => ReactNode;
}

export const useMoreItems = create<{ items: readonly MoreItem[] }>()(() => ({ items: [] }));

export function registerMoreItem(item: MoreItem): () => void {
  useMoreItems.setState((state) => ({ items: [...state.items.filter((known) => known.id !== item.id), item] }));
  return () => useMoreItems.setState((state) => ({ items: state.items.filter((known) => known !== item) }));
}

/** The rows in their groups, in order. */
export function moreGroups<T extends Pick<MoreItem, 'group' | 'order'>>(items: readonly T[]): T[][] {
  const groups = new Map<number, T[]>();
  for (const item of [...items].sort((a, b) => a.group - b.group || a.order - b.order)) {
    const rows = groups.get(item.group);
    if (rows === undefined) groups.set(item.group, [item]);
    else rows.push(item);
  }
  return [...groups.values()];
}

/** Groups of the More menu. */
export const MORE_GROUP = { reading: 10, keys: 20 } as const;
