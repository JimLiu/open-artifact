import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSpaceKey, pressPointer, pressSpace, releaseOtherKey, releasePointer, releaseSpace, SPACE_RELEASED, type SpaceHold } from '../src/lib/space-pan.ts';

const press = { repeat: false, chord: false, elsewhere: false };
const held: SpaceHold = { held: true, dragging: false, dragged: false };

describe('space pan', () => {
  it('knows the Space bar by its physical key', () => {
    assert.equal(isSpaceKey({ code: 'Space', key: ' ' }), true);
    assert.equal(isSpaceKey({ code: 'Space', key: 'x' }), true);
    assert.equal(isSpaceKey({ code: 'KeyA', key: ' ' }), false);
    assert.equal(isSpaceKey({ code: '', key: ' ' }), true);
  });

  it('holds on a plain press and keeps the page from scrolling', () => {
    assert.deepEqual(pressSpace(SPACE_RELEASED, press), { hold: held, preventDefault: true });
  });

  it('leaves the key alone in a field, on a control, or with Alt, Ctrl or ⌘', () => {
    assert.deepEqual(pressSpace(SPACE_RELEASED, { ...press, elsewhere: true }), { hold: SPACE_RELEASED, preventDefault: false });
    assert.deepEqual(pressSpace(SPACE_RELEASED, { ...press, chord: true }), { hold: SPACE_RELEASED, preventDefault: false });
  });

  it('stops every repeat while held, even once the focus moved', () => {
    assert.deepEqual(pressSpace(held, { ...press, repeat: true }), { hold: held, preventDefault: true });
    assert.deepEqual(pressSpace(held, { repeat: true, chord: false, elsewhere: true }), { hold: held, preventDefault: true });
  });

  it('a fresh press elsewhere ends the hold', () => {
    assert.equal(pressSpace(held, { ...press, elsewhere: true }).hold.held, false);
  });

  it('drags the stage on a pointer press only while held', () => {
    assert.deepEqual(pressPointer(SPACE_RELEASED), { hold: SPACE_RELEASED, drags: false });
    assert.deepEqual(pressPointer(held), { hold: { held: true, dragging: true, dragged: true }, drags: true });
  });

  it('swallows the release after a drag, not after a plain hold', () => {
    assert.equal(releaseSpace(held).preventDefault, false);
    const dragged = pressPointer(held).hold;
    const step = releaseSpace(releasePointer(dragged));
    assert.equal(step.preventDefault, true);
    assert.deepEqual(step.hold, SPACE_RELEASED);
  });

  it('keeps dragging after Space is let go, until the pointer is', () => {
    const dragging = releaseSpace(pressPointer(held).hold).hold;
    assert.deepEqual(dragging, { held: false, dragging: true, dragged: false });
    // Pressed again mid-drag: its release is swallowed too.
    const again = pressSpace(dragging, press).hold;
    assert.equal(again.dragged, true);
    assert.deepEqual(releasePointer(again), { held: true, dragging: false, dragged: true });
  });

  it('ends the hold when ⌘ is let go', () => {
    assert.equal(releaseOtherKey(held, 'Meta').held, false);
    assert.equal(releaseOtherKey(held, 'Shift').held, true);
  });
});
