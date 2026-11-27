import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layerMoveEdit, layerVisibilityEdit } from '../src/drawn-svg/layer-edits.ts';
import { moveDrawingLayer, readDrawingLayers, setDrawingLayerHidden } from '../src/drawn-svg/layers.ts';

const SKY = '<g id="sky_wash"><rect width="100" height="60" fill="#bfdbfe"/></g>';
const HILL = '<g id="hill" opacity=".8"><path d="M0 60 Q50 20 100 60Z" fill="#16a34a"/></g>';
const SUN = '<g id="sun"><circle cx="80" cy="18" r="10" fill="#facc15"/></g>';
const BIRD = '<g id="bird"><path d="M10 10l5 4 5-4" fill="none" stroke="#111"/></g>';
const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">\n  ${SKY}\n  ${HILL}\n  ${SUN}\n  ${BIRD}\n</svg>`;

function order(svg: string): string[] {
  return (readDrawingLayers(svg) ?? []).map((layer) => (layer.hidden ? `(${layer.id})` : layer.id));
}

function text(value: string | false): string {
  assert.equal(typeof value, 'string');
  assert.ok(!['gone', 'long', 'unread'].includes(value as string), `refused: ${value}`);
  return value as string;
}

describe('layer edits that undo on their own', () => {
  it('takes back a hide without taking back what others changed since', () => {
    const edit = layerVisibilityEdit({ n: 2, id: 'sun' }, true);
    const hidden = text(edit.apply(SCENE));
    assert.deepEqual(order(hidden), ['sky_wash', 'hill', '(sun)', 'bird']);
    const elsewhere = text(moveDrawingLayer(hidden, { n: 3, id: 'bird' }, 0));
    const undone = text(edit.revert(elsewhere));
    assert.deepEqual(order(undone), ['bird', 'sky_wash', 'hill', 'sun']);
    const redone = text(edit.apply(undone));
    assert.deepEqual(order(redone), ['bird', 'sky_wash', 'hill', '(sun)']);
    assert.equal(text(edit.revert(redone)), undone);
  });

  it('keeps a hidden layer’s own opacity when it is shown again by undo', () => {
    const edit = layerVisibilityEdit({ n: 1, id: 'hill' }, true);
    const hidden = text(edit.apply(SCENE));
    assert.equal(text(edit.revert(hidden)), SCENE);
  });

  it('refuses to undo once the layer itself changed', () => {
    const edit = layerVisibilityEdit({ n: 2, id: 'sun' }, true);
    const hidden = text(edit.apply(SCENE));
    const shownAgain = text(setDrawingLayerHidden(hidden, { n: 2, id: 'sun' }, false));
    const restyled = shownAgain.replace('#facc15', '#f97316');
    assert.equal(edit.revert(restyled), 'gone');
    assert.equal(layerVisibilityEdit({ n: 0, id: 'nope' }, true).apply(SCENE), 'gone');
  });

  it('puts a moved layer back over the layer it stood on, with the text between them', () => {
    const edit = layerMoveEdit({ n: 0, id: 'sky_wash' }, 'front');
    const front = text(edit.apply(SCENE));
    assert.deepEqual(order(front), ['hill', 'sun', 'bird', 'sky_wash']);
    assert.equal(text(edit.revert(front)), SCENE);
    const again = text(edit.apply(SCENE));
    assert.equal(again, front);
  });

  it('undoes a move where the drawing is now, leaving other edits', () => {
    const edit = layerMoveEdit({ n: 2, id: 'sun' }, 0);
    const back = text(edit.apply(SCENE));
    assert.deepEqual(order(back), ['sun', 'sky_wash', 'hill', 'bird']);
    const elsewhere = text(setDrawingLayerHidden(back, { n: 3, id: 'bird' }, true));
    const undone = text(edit.revert(elsewhere));
    assert.deepEqual(order(undone), ['sky_wash', 'hill', 'sun', '(bird)']);
    assert.equal(undone, text(setDrawingLayerHidden(SCENE, { n: 3, id: 'bird' }, true)));
  });

  it('goes back over the layer it stood on, wherever that layer is now', () => {
    const edit = layerMoveEdit({ n: 2, id: 'sun' }, 'front');
    const front = text(edit.apply(SCENE));
    const hillOnTop = text(moveDrawingLayer(front, { n: 1, id: 'hill' }, 3));
    assert.deepEqual(order(hillOnTop), ['sky_wash', 'bird', 'sun', 'hill']);
    assert.deepEqual(order(text(edit.revert(hillOnTop))), ['sky_wash', 'bird', 'hill', 'sun']);
  });

  it('refuses a second undo and an undo once the layer is gone', () => {
    const edit = layerMoveEdit({ n: 1, id: 'hill' }, 'back');
    const back = text(edit.apply(SCENE));
    const undone = text(edit.revert(back));
    assert.equal(edit.revert(undone), 'gone');
    const other = layerMoveEdit({ n: 1, id: 'hill' }, 'back');
    const moved = text(other.apply(SCENE));
    const without = moved.replace(HILL, '');
    assert.equal(other.revert(without), 'gone');
  });
});
