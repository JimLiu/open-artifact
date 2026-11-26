/**
 * A shape's text area: how many lines it shows, and the card that holds
 * the whole text of a shape whose text is cut (`elements/style.ts`).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shapeOutlineColor, shapeTextInsets, shapeTextLineCount, type ShapeElement } from '@open-artifact/whiteboard-core';
import { shapeTextAreaStyle } from '../src/elements/style.ts';

const shape: ShapeElement = { type: 'shape', id: 's', kind: 'rect', color: 'blue', text: 'a b c d e f', x: 0, y: 0, w: 120, h: 60 };

describe('shape text area', () => {
  it('caps the lines at what the text area holds', () => {
    const style = shapeTextAreaStyle(shape, 'light', false);
    assert.deepEqual(style, { '--wb-lines': shapeTextLineCount(shape) });
    assert.ok(shapeTextLineCount(shape) >= 1);
  });

  it('hangs a card as wide as the shape from the top of a cut text area', () => {
    const style = shapeTextAreaStyle(shape, 'light', true);
    const insets = shapeTextInsets('rect', 120, 60);
    assert.equal(style['--wb-card-left'], `${Math.round((-insets.left * 120 - 1) * 100) / 100}px`);
    assert.equal(style['--wb-card-width'], '122px');
    assert.equal(style['--wb-card-least'], `${Math.round((60 * (1 - insets.top) + 1) * 100) / 100}px`);
    assert.equal(style['--wb-card-edge'], `2px solid ${shapeOutlineColor(shape)}`, 'an outline-less shape takes its edge color');
    assert.equal(typeof style['--wb-card-fill'], 'string');
  });

  it('draws the card in the outline of a stroked shape, on the board paper when hollow', () => {
    const stroked = shapeTextAreaStyle({ ...shape, stroke: 'ink', solid: true, hollow: true }, 'light', true);
    assert.match(String(stroked['--wb-card-edge']), /^2px solid #/);
    assert.notEqual(stroked['--wb-card-edge'], `2px solid ${shapeOutlineColor(shape)}`);
    assert.equal(stroked['--wb-card-fill'], undefined);
  });
});
