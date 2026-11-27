import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filmSeconds, playSeconds } from '@open-artifact/motion-core';
import type { LayerLook, LayerRow } from '@open-artifact/motion-stage/protocol';
import { boldItalicKey, placeTextBar, styleChipLabel, textBarApplies, textRowForWord, wordEdges, type TextBarGate } from '../src/layers/text-bar-place.ts';

const look = { cls: 'line', kin: '0/1', at: filmSeconds(1) } as unknown as LayerLook;

function row(over: Partial<LayerRow> = {}): LayerRow {
  return {
    id: 'intro:0.1/p',
    kind: 'text',
    round: false,
    name: '',
    hidden: false,
    under: null,
    own: false,
    many: 0,
    texts: ['Hello'],
    spans: [[playSeconds(0), playSeconds(5)]],
    at: playSeconds(1),
    enter: { how: [], from: playSeconds(0), to: playSeconds(0) },
    leave: { how: [], from: playSeconds(5), to: playSeconds(5) },
    box: [0, 0, 400, 100],
    wordsBox: null,
    look,
    kids: [],
    sole: null,
    whole: false,
    drawn: '',
    full: false,
    ...over,
  };
}

const OPEN: TextBarGate = { fullscreen: true, tweaksOpen: true, ready: true, playing: false, commenting: false, readOnly: false };

test('the text styles bar shows only in full screen, with Tweaks open, paused, and the words open to change', () => {
  assert.equal(textBarApplies(OPEN), true);
  assert.equal(textBarApplies({ ...OPEN, fullscreen: false }), false, 'out of full screen the Layers section has the styles');
  assert.equal(textBarApplies({ ...OPEN, tweaksOpen: false }), false);
  assert.equal(textBarApplies({ ...OPEN, ready: false }), false);
  assert.equal(textBarApplies({ ...OPEN, playing: true }), false);
  assert.equal(textBarApplies({ ...OPEN, commenting: true }), false);
  assert.equal(textBarApplies({ ...OPEN, readOnly: true }), false);
});

test('a pressed word finds the smallest line of words round its middle that has styles to tell', () => {
  const heading = row({ id: 'intro:0.1/h1', box: [100, 100, 600, 120], wordsBox: [120, 110, 300, 80] });
  const card = row({ id: 'intro:0.2/div', kind: 'shape', box: [0, 0, 1280, 720] });
  const outer = row({ id: 'intro:0.3/p', box: [0, 0, 1280, 400], kids: [heading] });
  const fresh = row({ id: 'intro:0.1/h1+', box: [120, 110, 300, 80] });
  const plain = row({ id: 'intro:0.4/p', box: [120, 110, 300, 80], look: null });
  const rows = [card, outer, fresh, plain];
  assert.equal(textRowForWord(rows, [{ x: 150, y: 120, w: 100, h: 40 }])?.id, 'intro:0.1/h1', 'the words box, the smallest, inside another line');
  // Outside the heading's words box (but inside its box): the outer line.
  assert.equal(textRowForWord(rows, [{ x: 500, y: 190, w: 100, h: 20 }])?.id, 'intro:0.3/p');
  // The first box counts, for a word over two lines.
  assert.equal(textRowForWord(rows, [{ x: 150, y: 120, w: 100, h: 40 }, { x: 900, y: 500, w: 40, h: 40 }])?.id, 'intro:0.1/h1');
  assert.equal(textRowForWord(rows, [{ x: 900, y: 500, w: 40, h: 40 }]), null, 'no line there');
  assert.equal(textRowForWord(rows, []), null);
  assert.equal(textRowForWord(null, [{ x: 150, y: 120, w: 100, h: 40 }]), null);
});

test('the box round a word, on screen', () => {
  assert.deepEqual(wordEdges([{ x: 10, y: 20, w: 100, h: 30 }, { x: 0, y: 60, w: 40, h: 30 }], 0.5), { left: 0, top: 10, right: 55, bottom: 45 });
  assert.equal(wordEdges([], 1), null);
});

test('the bar goes above the words, else below, else over them, centred and inside the picture', () => {
  const view = { width: 800, height: 450 };
  const bar = { width: 300, height: 36 };
  // Room above: 10px over the words, centred on them.
  assert.deepEqual(placeTextBar(view, bar, { left: 300, top: 200, right: 500, bottom: 240 }), { left: 250, top: 154, placed: 'above', covers: false, most: 784 });
  // No room above: below.
  assert.deepEqual(placeTextBar(view, bar, { left: 300, top: 20, right: 500, bottom: 60 }), { left: 250, top: 70, placed: 'below', covers: false, most: 784 });
  // Words as tall as the picture: above, over them, held inside the picture.
  const over = placeTextBar(view, bar, { left: 300, top: 10, right: 500, bottom: 440 });
  assert.equal(over.placed, 'above');
  assert.equal(over.covers, true);
  assert.equal(over.top, 4);
  // Kept off the sides.
  assert.equal(placeTextBar(view, bar, { left: 0, top: 200, right: 40, bottom: 240 }).left, 8);
  assert.equal(placeTextBar(view, bar, { left: 760, top: 200, right: 800, bottom: 240 }).left, 492);
  // A bar wider than the picture starts at the margin, and may be no wider than the picture less the margins.
  const wide = placeTextBar({ width: 200, height: 450 }, bar, { left: 80, top: 200, right: 120, bottom: 240 });
  assert.equal(wide.left, 8);
  assert.equal(wide.most, 184);
});

test('the style chip says the weight and the size', () => {
  assert.equal(styleChipLabel('Semibold', 47.6, 'Spacing'), 'Semibold · 48');
  assert.equal(styleChipLabel(null, 32, 'Spacing'), '32');
  assert.equal(styleChipLabel('Bold Italic', null, 'Spacing'), 'Bold Italic');
  assert.equal(styleChipLabel(null, null, 'Spacing'), 'Spacing');
});

test('Cmd+B and Cmd+I (Ctrl elsewhere) are told apart from other keys', () => {
  const press = (key: string, over: Partial<Parameters<typeof boldItalicKey>[0]> = {}) => ({ key, code: `Key${key.toUpperCase()}`, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });
  assert.equal(boldItalicKey(press('b', { metaKey: true }), true), 'b');
  assert.equal(boldItalicKey(press('I', { metaKey: true }), true), 'i');
  assert.equal(boldItalicKey(press('b', { ctrlKey: true }), true), null, 'Ctrl on a Mac');
  assert.equal(boldItalicKey(press('b', { ctrlKey: true }), false), 'b');
  assert.equal(boldItalicKey(press('b', { metaKey: true }), false), null);
  assert.equal(boldItalicKey(press('b', { metaKey: true, shiftKey: true }), true), null);
  assert.equal(boldItalicKey(press('b', { metaKey: true, altKey: true }), true), null);
  assert.equal(boldItalicKey(press('u', { metaKey: true }), true), null);
  // A keyboard that types other letters: where the key sits.
  assert.equal(boldItalicKey({ ...press('и', { metaKey: true }), code: 'KeyB' }, true), 'b');
  // A Latin letter on a moved key: the letter.
  assert.equal(boldItalicKey({ ...press('b', { metaKey: true }), code: 'KeyN' }, true), 'b');
});
