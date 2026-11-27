import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { measured, TOP_BAR_GAP, TOP_BAR_INSET, toolbarPlace, topBarsFit, useToolbarWidths } from '../src/transport/placement.ts';

describe('toolbar place', () => {
  beforeEach(() => useToolbarWidths.setState({ room: null, playback: null, actions: null }));

  it('floats the two bars on top while both fit, with the insets and the gap between them', () => {
    const need = 2 * TOP_BAR_INSET + 300 + TOP_BAR_GAP + 400;
    assert.equal(topBarsFit({ room: need, playback: 300, actions: 400 }), true);
    assert.equal(topBarsFit({ room: need - 1, playback: 300, actions: 400 }), false);
    assert.equal(toolbarPlace({ room: need, playback: 300, actions: 400 }, false), 'top');
    assert.equal(toolbarPlace({ room: need - 1, playback: 300, actions: 400 }, false), 'bottom');
  });

  it('goes to the bottom in full screen, and counts bars not measured yet as fitting', () => {
    assert.equal(toolbarPlace({ room: 4000, playback: 300, actions: 400 }, true), 'bottom');
    assert.equal(toolbarPlace({ room: 200, playback: null, actions: 400 }, false), 'top');
    assert.equal(toolbarPlace({ room: null, playback: 300, actions: 400 }, false), 'top');
  });

  it('keeps measured widths rounded up, and leaves the store alone when nothing changed', () => {
    measured('playback', 299.2);
    assert.equal(useToolbarWidths.getState().playback, 300);
    let changes = 0;
    const stop = useToolbarWidths.subscribe(() => changes++);
    measured('playback', 299.9);
    stop();
    assert.equal(changes, 0);
  });
});
