/**
 * What a link to the selection names: the block the selection starts in and the selected words, by the ids of their
 * first and last characters; the paragraph the cursor is in, with nothing selected; the first cell, for cells.
 */
import type { DocState } from '@open-artifact/docs-core';
import type { Node as PMNode } from 'prosemirror-model';
import type { Selection } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import { blockIdAt, idsOfRange } from '../comments/anchor-map.ts';

/** What a link to the selection names: its block, and the selected words in it (none for a caret or cells). */
export interface SelectionPlace {
  block: string;
  words?: [string, string];
}

/** The first of the selected cells, by its place in the doc. */
function firstCell(selection: CellSelection): number {
  let first = Infinity;
  selection.forEachCell((_cell, pos) => {
    first = Math.min(first, pos);
  });
  return first;
}

/** The place a selection names, or null when its block has no id yet. `shadow`: the tab's model, for the words' ids. */
export function selectionPlace(doc: PMNode, selection: Selection, shadow: DocState | null): SelectionPlace | null {
  if (selection instanceof CellSelection) {
    const at = firstCell(selection);
    const cell = Number.isFinite(at) ? doc.nodeAt(at) : null;
    const bid = cell?.attrs.bid;
    return typeof bid === 'string' && bid ? { block: bid } : null;
  }
  const block = blockIdAt(doc, selection.from);
  if (!block) return null;
  if (selection.empty || !shadow) return { block };
  const words = idsOfRange(doc, shadow, selection.from, selection.to);
  return words ? { block, words } : { block };
}
