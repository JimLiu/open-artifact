/**
 * The table cell a context menu's row and column commands act on, outlined
 * on the stage while the menu is open: only while its table is still the one
 * the menu was opened on.
 */

import type { Slide } from '@open-artifact/slides-core';
import { targetTable, type TableTarget } from './table-target.ts';

/** The cell to outline, as [row, column], or null when the menu names none or its table changed. */
export function outlinedCell(target: TableTarget | null, slideId: string | null, slide: Slide | null): readonly [number, number] | null {
  if (!target?.cell) return null;
  return targetTable(slideId, slide, target) ? target.cell : null;
}

/** The selector of a cell inside its table's element. */
export function cellSelector(cell: readonly [number, number]): string {
  return `[data-open-artifact-cell="${cell[0]}:${cell[1]}"]`;
}
