import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { useContextMenu } from '../src/selection/menu-store.ts';

describe('context menu store', () => {
  it('remembers whether the keyboard opened the menu, for each opening', () => {
    const menu = useContextMenu.getState();
    menu.show({ at: { x: 10, y: 20 }, kind: 'items', keyboard: true });
    assert.equal(useContextMenu.getState().keyboard, true);
    menu.hide();
    menu.show({ at: { x: 10, y: 20 }, kind: 'board' });
    assert.deepEqual([useContextMenu.getState().open, useContextMenu.getState().keyboard], [true, false]);
  });
});
