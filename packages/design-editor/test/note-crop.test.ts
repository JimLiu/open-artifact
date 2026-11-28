import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  contentInsets,
  cropFrameStyle,
  cropKeyAction,
  cropRefusal,
  intoNote,
  cropFromPosition,
  cropOf,
  cropPictureStyle,
  dragFrameEdge,
  panPicture,
  pictureRect,
  placeFrame,
  zoomFromCorner,
  zoomPicture,
} from '../src/lib/note-crop.ts';
import { imageLook } from '../src/lib/note-look.ts';
import { noteItem } from '../src/lib/scene.ts';

const BLOB = '/_blob/0123456789abcdef0123456789abcdef';

describe('a cropped note’s style', () => {
  it('sizes and places the picture in percent of the frame', () => {
    const style = cropPictureStyle({ zoom: 2, x: 0.25, y: 1 });
    assert.equal(style.width, '200%');
    assert.equal(style.height, '200%');
    assert.equal(style.left, '-25%');
    assert.equal(style.top, '-100%');
    assert.equal(style['object-position'], '25% 100%');
    assert.equal(style['object-fit'], 'cover');
    assert.equal(style['max-width'], 'none');
  });

  it('rounds to four places and writes no negative zero', () => {
    const style = cropPictureStyle({ zoom: 1.23456, x: 0, y: 1 / 3 });
    assert.equal(style.width, '123.456%');
    assert.equal(style.left, '0%');
    assert.equal(style.top, '-7.8187%');
    assert.equal(style['object-position'], '0% 33.3333%');
  });

  it('puts the note’s look on the frame, not the picture’s fit', () => {
    const look = imageLook({ x: 0, y: 0, kind: 'image', src: BLOB, crop: { zoom: 2, x: 0, y: 0 }, css: { 'border-radius': '12px', 'object-fit': 'cover' } });
    const frame = cropFrameStyle(look.dom);
    assert.equal(frame.overflow, 'hidden');
    assert.equal(frame['border-radius'], '12px');
    assert.equal(frame['object-fit'], undefined);
    assert.equal(frame.inset, '0');
  });

  it('is always drawn by the DOM body, cropped or a video', () => {
    assert.equal(imageLook({ x: 0, y: 0, kind: 'image', src: BLOB }).engine, true);
    assert.equal(imageLook({ x: 0, y: 0, kind: 'image', src: BLOB, crop: { zoom: 2, x: 0, y: 0 } }).engine, false);
    assert.equal(imageLook({ x: 0, y: 0, kind: 'image', src: BLOB, video: BLOB }).engine, false);
    assert.equal((noteItem('v', { x: 0, y: 0, w: 10, h: 10, kind: 'image', src: BLOB, video: BLOB }, { z: 0, editable: true, locked: false } as Parameters<typeof noteItem>[2]) as { fill?: string }).fill, 'transparent');
  });

  it('fills a video note’s box with a cover the user set', () => {
    assert.equal(imageLook({ x: 0, y: 0, kind: 'image', src: BLOB, video: BLOB }).dom['object-fit'], 'fill');
    assert.equal(imageLook({ x: 0, y: 0, kind: 'image', src: BLOB, video: BLOB, videoCover: 'custom' }).dom['object-fit'], 'cover');
    assert.equal(imageLook({ x: 0, y: 0, kind: 'image', src: BLOB, video: BLOB, videoCover: 'custom', css: { 'object-fit': 'contain' } }).dom['object-fit'], 'contain');
  });
});

describe('cropping geometry', () => {
  const natural = { w: 400, h: 200 };
  const frame = { x: 0, y: 0, w: 100, h: 100 };

  it('covers the frame at zoom 1 and aligns by x and y', () => {
    assert.deepEqual(pictureRect(natural, frame, { zoom: 1, x: 0.5, y: 0.5 }), { x: -50, y: 0, w: 200, h: 100 });
    assert.deepEqual(pictureRect(natural, frame, { zoom: 2, x: 0, y: 1 }), { x: 0, y: -100, w: 400, h: 200 });
  });

  it('reads the crop back from where the picture is', () => {
    assert.deepEqual(cropOf(natural, frame, { x: -100, y: -50, w: 400, h: 200 }), { zoom: 2, x: 0.33333, y: 0.5 });
    assert.deepEqual(cropOf(natural, frame, { x: 0, y: -100, w: 400, h: 200 }), { zoom: 2, x: 0, y: 1 });
  });

  it('centres an axis the picture overflows by less than half a unit', () => {
    const square = { w: 100, h: 100 };
    assert.deepEqual(cropOf(square, frame, { x: -0.3, y: 0, w: 100.4, h: 100.4 }), { zoom: 1.004, x: 0.5, y: 0.5 });
  });

  it('keeps x and y within 0 to 1 when panning', () => {
    const picture = { x: -50, y: 0, w: 200, h: 100 };
    assert.deepEqual(panPicture(picture, frame, 500, 0), { x: 0, y: 0, w: 200, h: 100 });
    assert.deepEqual(panPicture(picture, frame, -500, 30), { x: -100, y: 0, w: 200, h: 100 });
    const crop = cropOf(natural, frame, panPicture(picture, frame, -500, 0));
    assert.equal(crop.x, 1);
  });

  it('zooms about a point and never below covering the frame', () => {
    const picture = { x: -50, y: 0, w: 200, h: 100 };
    const bigger = zoomPicture(picture, frame, natural, 2, 50, 50);
    assert.deepEqual(bigger, { x: -150, y: -50, w: 400, h: 200 });
    assert.deepEqual(zoomPicture(picture, frame, natural, 0.5, 50, 50), picture);
    assert.equal(zoomPicture(picture, frame, natural, 1000, 50, 50).w, 200 * 50);
  });

  it('zooms from a corner with the opposite corner still, at least zoom 1', () => {
    const picture = { x: -50, y: 0, w: 200, h: 100 };
    const grown = zoomFromCorner(picture, frame, natural, 'se', 250, 150);
    assert.deepEqual(grown, { x: -50, y: 0, w: 300, h: 150 });
    const shrunk = zoomFromCorner(picture, frame, natural, 'se', 0, 0);
    assert.ok(shrunk.w >= 200 && shrunk.x + shrunk.w >= 100 && shrunk.y + shrunk.h >= 100, JSON.stringify(shrunk));
  });

  it('shrinks the frame only within the picture, never below 16 by 16, on whole units', () => {
    const picture = { x: -50, y: 0, w: 200, h: 100 };
    assert.deepEqual(dragFrameEdge(frame, picture, 'e', -30.4, 0), { x: 0, y: 0, w: 70, h: 100 });
    assert.deepEqual(dragFrameEdge(frame, picture, 'e', 500, 0), { x: 0, y: 0, w: 150, h: 100 });
    assert.deepEqual(dragFrameEdge(frame, picture, 'nw', 200, 200), { x: 84, y: 84, w: 16, h: 16 });
    assert.deepEqual(dragFrameEdge(frame, picture, 'w', -500, 0), { x: -50, y: 0, w: 150, h: 100 });
  });

  it('moves the note so a rotated frame stays where it was drawn', () => {
    const note = { x: 0, y: 0, w: 100, h: 100 };
    assert.deepEqual(placeFrame(note, { x: 50, y: 0, w: 50, h: 100 }), { x: 50, y: 0, w: 50, h: 100 });
    assert.deepEqual(placeFrame({ ...note, rotate: 90 }, { x: 50, y: 0, w: 50, h: 100 }), { x: 25, y: 25, w: 50, h: 100 });
    assert.deepEqual(placeFrame({ ...note, flipX: true }, { x: 50, y: 0, w: 50, h: 100 }), { x: 0, y: 0, w: 50, h: 100 });
  });

  it('starts from object-position when there is no crop yet', () => {
    assert.deepEqual(cropFromPosition('20% 50%'), { zoom: 1, x: 0.2, y: 0.5 });
    assert.deepEqual(cropFromPosition('right top'), { zoom: 1, x: 1, y: 0 });
    assert.deepEqual(cropFromPosition('top'), { zoom: 1, x: 0.5, y: 0 });
    assert.deepEqual(cropFromPosition(undefined), { zoom: 1, x: 0.5, y: 0.5 });
  });
});

describe('cropping by keyboard and its refusals', () => {
  it('maps keys to what they do while cropping', () => {
    const press = (key: string, more: Partial<{ code: string; meta: boolean; shift: boolean; alt: boolean }> = {}) => cropKeyAction({ key, meta: false, shift: false, ...more });
    assert.deepEqual(press('ArrowRight'), { kind: 'move', dx: 1, dy: 0 });
    assert.deepEqual(press('ArrowUp', { shift: true }), { kind: 'move', dx: 0, dy: -10 });
    assert.deepEqual(press('+'), { kind: 'zoom', factor: 1.1 });
    assert.deepEqual(press('='), { kind: 'zoom', factor: 1.1 });
    assert.equal(press('-').kind, 'zoom');
    assert.deepEqual(press('Enter'), { kind: 'confirm' });
    assert.deepEqual(press('Escape'), { kind: 'confirm' });
    assert.deepEqual(press('z', { code: 'KeyZ', meta: true }), { kind: 'cancel' });
    assert.deepEqual(press('ы', { code: 'KeyZ', meta: true }), { kind: 'cancel' }, 'by the physical key');
    assert.deepEqual(press('z', { code: 'KeyZ', meta: true, shift: true }), { kind: 'confirm-pass' });
    assert.deepEqual(press('=', { code: 'Equal', meta: true }), { kind: 'pass' });
    assert.deepEqual(press('0', { code: 'Digit0', meta: true }), { kind: 'pass' });
    assert.deepEqual(press(' '), { kind: 'pass' });
    assert.deepEqual(press('Tab'), { kind: 'hold' });
    assert.deepEqual(press('Shift'), { kind: 'pass' });
    assert.deepEqual(press('v'), { kind: 'confirm-pass' });
  });

  it('refuses a locked, flipped or unloaded picture', () => {
    assert.equal(cropRefusal({ locked: true, flipX: true }, false), 'locked');
    assert.equal(cropRefusal({ flipY: true }, true), 'flipped');
    assert.equal(cropRefusal({}, false), 'unloaded');
    assert.equal(cropRefusal({}, true), null);
  });

  it('takes a border drawn inside the edge out of the frame', () => {
    assert.deepEqual(contentInsets({ 'border-width': '4px', 'border-style': 'solid' }), { top: 4, right: 4, bottom: 4, left: 4 });
    assert.deepEqual(contentInsets({ 'border-width': '4px', 'border-left-width': '1px' }), { top: 4, right: 4, bottom: 4, left: 1 });
    assert.deepEqual(contentInsets({ 'border-width': '4px', 'border-position': 'outside' }), { top: 0, right: 0, bottom: 0, left: 0 });
    assert.deepEqual(contentInsets(undefined), { top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('turns a screen movement into the rotated note’s space', () => {
    const moved = intoNote(10, 0, 90, 2);
    assert.ok(Math.abs(moved.dx) < 1e-9 && Math.abs(moved.dy + 5) < 1e-9, JSON.stringify(moved));
  });
});
