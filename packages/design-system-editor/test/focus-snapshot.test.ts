/** What a design system request is about, as its `selectionSnapshot`: the part in focus, or none. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { focusSnapshot } from '../src/lib/focus-snapshot.ts';
import type { Focus } from '../src/state/view.ts';

test('the focused part, with its family', () => {
  assert.deepEqual(focusSnapshot({ kind: 'component', family: 'Buttons', name: 'Primary' } as Focus), {
    kind: 'focus',
    label: 'component in Buttons: Primary',
    count: 1,
    items: [{ id: 'Primary', kind: 'component', label: 'Primary' }],
  });
  assert.equal(focusSnapshot({ kind: 'token', name: 'color.brand' } as Focus)!.label, 'token: color.brand');
  assert.equal(focusSnapshot(null), null);
});
