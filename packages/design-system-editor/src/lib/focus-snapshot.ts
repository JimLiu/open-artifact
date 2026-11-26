/** What a design system request is about, as its `selectionSnapshot` (pure). */

import type { SelectionSnapshot } from '@open-artifact/runtime';
import { selectionSnapshotOf } from '@open-artifact/editor-kit';
import type { Focus } from '../state/view.ts';

/** What the viewer focused, as a request's `selectionSnapshot`: one token, style, component, asset… */
export function focusSnapshot(focus: Focus | null): SelectionSnapshot | null {
  if (!focus) return null;
  const what = focus.family ? `${focus.kind} in ${focus.family}` : focus.kind;
  return selectionSnapshotOf({ kind: 'focus', label: `${what}: ${focus.name}`, count: 1, items: [{ id: focus.name, kind: focus.kind, label: focus.name }] });
}
