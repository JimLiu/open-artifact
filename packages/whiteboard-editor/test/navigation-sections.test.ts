import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoardElement } from '@open-artifact/whiteboard-core';
import { titledSections } from '../src/services/navigation.ts';

const section = (id: string, x: number, y: number, text: string): BoardElement => ({ id, type: 'container', x, y, w: 400, h: 200, color: 'white', text }) as BoardElement;

describe('the sections "Go to section" lists', () => {
  it('lists titled sections in reading order and leaves out untitled ones and other elements', () => {
    const elements = [
      section('far', 5000, 2400, 'Payment DB'),
      section('blank', 5000, -3000, '   '),
      { id: 'n1', type: 'shape', kind: 'rect', x: 0, y: 0, w: 100, h: 100, color: 'blue', text: 'Not a section' } as BoardElement,
      section('first', 0, 0, 'Overview'),
      section('below', 0, 1200, 'Retro'),
    ];
    assert.deepEqual(
      titledSections(elements, undefined).map((element) => element.id),
      ['first', 'below', 'far'],
    );
  });

  it('lists nothing on a board without sections', () => {
    assert.deepEqual(titledSections([], undefined), []);
  });
});
