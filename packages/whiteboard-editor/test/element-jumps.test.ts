import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { BoardElement } from '@open-artifact/whiteboard-core';
import { boardLinkElement, boardLinkTarget, storedLinkOf } from '../src/elements/links.ts';
import { clearJumpBack, fitBoard, goToElement, jumpBack } from '../src/services/navigation.ts';
import { setBoardSnapshot } from '../src/state/board.ts';
import { useCamera } from '../src/state/camera.ts';
import { MAX_JUMP_BACK, useJump } from '../src/state/jump.ts';

const elements: BoardElement[] = [
  { id: 'near', type: 'container', x: 0, y: 0, w: 400, h: 200, color: 'white', text: 'Overview' } as BoardElement,
  { id: 'far', type: 'shape', kind: 'rect', x: 6000, y: 3000, w: 200, h: 100, color: 'blue', text: 'Payment DB' } as BoardElement,
  { id: 'card', type: 'link', x: 0, y: 400, w: 280, h: 72, href: '#element=far' } as BoardElement,
];

describe('going to an element of the board', () => {
  beforeEach(() => {
    setBoardSnapshot({ title: 'Board', content: { elements } }, { status: 'ready', pending: 0 });
    useCamera.setState({ camera: { x: 0, y: 0, zoom: 1 }, width: 1280, height: 800, insets: { top: 56, right: 16, bottom: 88, left: 16 } });
    useJump.setState({ back: [], flash: null });
  });
  afterEach(() => clearJumpBack());

  it('shows the element, rings it and remembers where the view was', () => {
    assert.equal(goToElement('far', { glide: false }), true);
    const { camera } = useCamera.getState();
    assert.ok(camera.x > 5000 && camera.y > 2000, `the view moved to the element (${JSON.stringify(camera)})`);
    assert.ok(camera.zoom <= 1, 'never past 100%');
    assert.deepEqual(useJump.getState().back, [{ x: 0, y: 0, zoom: 1 }]);
    assert.equal(useJump.getState().flash?.id, 'far');
  });

  it('goes back to where the view was, and has nothing more to go back to', () => {
    goToElement('far', { glide: false });
    assert.equal(jumpBack(), true);
    assert.deepEqual(useCamera.getState().camera, { x: 0, y: 0, zoom: 1 });
    assert.equal(useJump.getState().back.length, 0);
    assert.equal(jumpBack(), false);
  });

  it('goes back one jump at a time and remembers a bounded number of views', () => {
    goToElement('far', { glide: false });
    goToElement('near', { glide: false });
    assert.equal(useJump.getState().back.length, 2);
    jumpBack();
    assert.ok(useCamera.getState().camera.x > 5000, 'back at the first element');
    for (let i = 0; i < MAX_JUMP_BACK + 5; i += 1) goToElement(i % 2 === 0 ? 'near' : 'far', { glide: false });
    assert.equal(useJump.getState().back.length, MAX_JUMP_BACK);
  });

  it('does not remember the view when told not to (a page opened at the element)', () => {
    goToElement('far', { glide: false, back: false });
    assert.equal(useJump.getState().back.length, 0);
  });

  it('refuses an element that is not on the board and leaves the view', () => {
    assert.equal(goToElement('gone', { glide: false }), false);
    assert.deepEqual(useCamera.getState().camera, { x: 0, y: 0, zoom: 1 });
    assert.equal(useJump.getState().back.length, 0);
  });

  it('forgets the way back once the whole board is shown', () => {
    goToElement('far', { glide: false });
    fitBoard();
    assert.equal(useJump.getState().back.length, 0);
  });
});

describe('links to elements, as stored and as opened', () => {
  it('reads a stored link to an element of this board', () => {
    assert.equal(boardLinkElement('#element=far', undefined), 'far');
    assert.equal(boardLinkElement('open-artifact://artifact/art_board0000001#element=far', 'art_board0000001'), 'far');
    assert.equal(boardLinkElement('open-artifact://artifact/art_board0000002#element=far', 'art_board0000001'), undefined);
    assert.equal(boardLinkElement('https://example.com/#element=far', 'art_board0000001'), undefined);
  });

  it('opens a link to an element as the board page at that element', () => {
    assert.equal(boardLinkTarget('#element=far', 'http://127.0.0.1:4800', undefined, 'art_board0000001'), 'http://127.0.0.1:4800/a/art_board0000001#element=far');
    assert.equal(boardLinkTarget('#element=far', undefined, undefined, undefined), '#element=far');
    assert.equal(boardLinkTarget('open-artifact://artifact/art_board0000002#slide-3', 'http://127.0.0.1:4800'), 'http://127.0.0.1:4800/a/art_board0000002#slide-3');
  });

  it('stores a pasted link to this board as a link to the element, and to another board as its address', () => {
    assert.equal(storedLinkOf('http://127.0.0.1:4800/a/art_board0000001#element=far', 'art_board0000001', 'http://127.0.0.1:4800'), '#element=far');
    assert.equal(storedLinkOf('http://127.0.0.1:4800/a/art_board0000002#element=far', 'art_board0000001', 'http://127.0.0.1:4800'), 'open-artifact://artifact/art_board0000002#element=far');
    assert.equal(storedLinkOf('https://example.com/a/art_board0000002', 'art_board0000001', 'http://127.0.0.1:4800'), 'https://example.com/a/art_board0000002');
  });
});
