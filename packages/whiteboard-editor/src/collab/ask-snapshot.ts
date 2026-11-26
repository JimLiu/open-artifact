/** What a whiteboard ask is about, as its `selectionSnapshot` (pure). */

import type { JsonRecord, SelectionSnapshot } from '@open-artifact/runtime';
import { selectionSnapshotOf } from '@open-artifact/editor-kit';

/**
 * What an ask is about, as its `selectionSnapshot`: the selected elements, the elements in an area or at a point
 * ({@link askScopeContext}'s `scope`); `null` for the whole board or nothing there.
 */
export function askScopeSnapshot(scope: JsonRecord): SelectionSnapshot | null {
  const kind = typeof scope.kind === 'string' ? scope.kind : '';
  if (kind !== 'selection' && kind !== 'area' && kind !== 'point') return null;
  const ids = Array.isArray(scope.ids) ? scope.ids.filter((id): id is string => typeof id === 'string') : [];
  const labelled = new Map<string, { kind?: string; label?: string }>();
  for (const raw of Array.isArray(scope.items) ? scope.items : []) {
    const item = raw as { id?: unknown; kind?: unknown; label?: unknown } | null;
    if (item && typeof item.id === 'string') {
      labelled.set(item.id, { ...(typeof item.kind === 'string' ? { kind: item.kind } : {}), ...(typeof item.label === 'string' && item.label ? { label: item.label } : {}) });
    }
  }
  const items = ids.map((id) => ({ id, ...labelled.get(id) }));
  const count = ids.length;
  if (count === 0) return null;
  const noun = count === 1 ? 'element' : 'elements';
  const label = kind === 'selection' ? `${count} selected ${noun}` : kind === 'area' ? `Area with ${count} ${noun}` : `${count} ${noun} at a point`;
  return selectionSnapshotOf({ kind: kind === 'selection' ? 'elements' : kind, label, count, items });
}
