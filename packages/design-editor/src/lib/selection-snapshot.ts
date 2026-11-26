/** What a Design request names, as its `selectionSnapshot` (pure). */

import type { DesignViewContext } from '@open-artifact/design-core';
import type { SelectionSnapshot } from '@open-artifact/runtime';
import { selectionSnapshotOf } from '@open-artifact/editor-kit';

/**
 * The selection a "Send to agent" names, as its `selectionSnapshot`: the selected elements (labelled as the view
 * context labels them; `count` is how many are selected), else the selected artboards; `null` with neither.
 */
export function designSelectionSnapshot(context: DesignViewContext, selectedCount: number): SelectionSnapshot | null {
  const where = context.pageName ? `Page "${context.pageName}"` : undefined;
  if (context.selected.length) {
    const labelled = new Map((context.selection ?? []).map((item) => [item.id, item]));
    return selectionSnapshotOf({
      kind: 'elements',
      noun: 'element',
      count: Math.max(selectedCount, context.selected.length),
      items: context.selected.map((id) => {
        const known = labelled.get(id);
        return { id, ...(known?.kind ? { kind: known.kind } : {}), ...(known?.label ? { label: known.label } : {}) };
      }),
      ...(where ? { where } : {}),
    });
  }
  if (context.selectedArtboards.length) {
    return selectionSnapshotOf({ kind: 'artboards', noun: 'artboard', items: context.selectedArtboards.map((id) => ({ id })), ...(where ? { where } : {}) });
  }
  return null;
}
