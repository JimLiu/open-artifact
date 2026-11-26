/**
 * Picking a drawing's layers: the pure helpers (styles, waiting, mapping
 * board points into the drawing, the layer frame, messages) and the
 * picking service over the live stores (enter, switch, move, hide, show,
 * leave).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { DRAWING_STYLES, decodeSvgDataUrl, drawingLayersOf, svgToBase64DataUrl, type Board, type ImageElement } from '@open-artifact/whiteboard-core';
import { drawnImageSrc } from '../src/export/drawn-svg.ts';
import {
  LAYER_UNSAVED_AFTER_MS,
  drawingPointAt,
  isLayeredStyle,
  layerEditWait,
  layerFrameBox,
  layerMovedMessage,
  layerSelectedMessage,
} from '../src/lib/layer-picking.ts';
import {
  chooseLayer,
  deleteAfterHide,
  enterFirstLayer,
  enterLayerAt,
  layerActionRefusals,
  layeredDrawing,
  leaveLayer,
  pickedDrawingLayer,
  pressWhilePicked,
  runLayerAction,
} from '../src/services/drawing-layers.ts';
import { setBoardSnapshot, useBoard } from '../src/state/board.ts';
import { useSelection } from '../src/state/selection.ts';
import { useTool } from '../src/state/tool.ts';

const SKY = '<g id="sky_wash"><rect width="100" height="60" fill="#bfdbfe" fill-opacity=".3"/></g>';
const HILL = '<g id="green-hill"><path d="M0 60 Q50 20 100 60Z" fill="#16a34a"/></g>';
const SUN = '<g id="sun"><circle cx="80" cy="18" r="10" fill="#facc15"/></g>';
const BIRD = '<g id="bird" opacity="0"><path d="M10 10l5 4 5-4" fill="none" stroke="#111"/></g>';
const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">${SKY}${HILL}${SUN}${BIRD}</svg>`;

function drawing(svg = SCENE, extra: Partial<ImageElement> = {}): ImageElement {
  return { id: 'pic', type: 'image', x: 0, y: 0, w: 200, h: 120, src: svgToBase64DataUrl(svg), style: 'draft', ...extra };
}

function load(element: ImageElement): void {
  const board: Board = { title: 'Board', content: { elements: [element] } };
  setBoardSnapshot(board, { status: 'ready', pending: 0 });
  useSelection.getState().clear();
  useSelection.getState().select([element.id]);
}

function svgNow(): string {
  const element = useBoard.getState().byId.get('pic');
  return element?.type === 'image' ? (decodeSvgDataUrl(element.src) ?? '') : '';
}

/** The text of a drawing outside its groups with opacity 0. */
function shownPart(svg: string): string {
  let shown = '';
  let hiddenDepth = 0;
  for (const part of svg.split(/(?=<)/)) {
    const opening = /^<g\b[^>]*>/.exec(part);
    if (hiddenDepth > 0) {
      if (opening !== null && !opening[0].endsWith('/>')) hiddenDepth += 1;
      else if (part.startsWith('</g>')) hiddenDepth -= 1;
      continue;
    }
    if (opening !== null && /\bopacity=["']0["']/.test(opening[0]) && !opening[0].endsWith('/>')) hiddenDepth = 1;
    else shown += part;
  }
  return shown;
}

function idsNow(): string[] {
  return (drawingLayersOf(svgNow()) ?? []).map((layer) => layer.id);
}

describe('layer picking helpers', () => {
  it('offers layers for every drawing style but plain', () => {
    assert.equal(isLayeredStyle('draft'), true);
    assert.equal(isLayeredStyle('watercolor'), true);
    assert.equal(isLayeredStyle('plain'), false);
    assert.equal(isLayeredStyle(undefined), false);
  });

  it('waits while offline, still loading, or when the last edit stays unsaved', () => {
    const facts = { status: 'ready' as const, pending: 0, online: true, wroteAt: undefined, now: 10_000 };
    assert.equal(layerEditWait(facts), undefined);
    assert.equal(layerEditWait({ ...facts, online: false }), 'offline');
    assert.equal(layerEditWait({ ...facts, status: 'cached' }), 'offline');
    assert.equal(layerEditWait({ ...facts, status: 'error' }), 'offline');
    assert.equal(layerEditWait({ ...facts, pending: 1, wroteAt: 10_000 - LAYER_UNSAVED_AFTER_MS + 10 }), undefined, 'a fresh write may still be on its way');
    assert.equal(layerEditWait({ ...facts, pending: 1, wroteAt: 10_000 - LAYER_UNSAVED_AFTER_MS - 10 }), 'unsaved');
  });

  it('maps board points into the drawing through its turn and crop', () => {
    const frame = { x: 100, y: 50, w: 200, h: 120 };
    assert.deepEqual(drawingPointAt(frame, [100, 60], { x: 260, y: 86 }), [80, 18]);
    const turned = drawingPointAt({ ...frame, turn: 180 }, [100, 60], { x: 140, y: 134 });
    assert.ok(Math.abs(turned[0] - 80) < 1e-9 && Math.abs(turned[1] - 18) < 1e-9, 'a half turn flips the point about the center');
    assert.deepEqual(drawingPointAt({ ...frame, crop: { zoom: 2, x: 0, y: 0 } }, [100, 60], { x: 100, y: 50 }), [0, 0]);
    assert.deepEqual(drawingPointAt({ ...frame, crop: { zoom: 2, x: 1, y: 1 } }, [100, 60], { x: 100, y: 50 }), [50, 30]);
  });

  it('cuts a layer frame to what the drawing shows', () => {
    const frame = { x: 10, y: 20, w: 200, h: 120 };
    assert.deepEqual(layerFrameBox(frame, [100, 60], [70, 8, 90, 28]), { x: 150, y: 36, w: 40, h: 40 });
    assert.deepEqual(layerFrameBox({ ...frame, crop: { zoom: 2, x: 0, y: 0 } }, [100, 60], [40, 0, 80, 10]), { x: 170, y: 20, w: 40, h: 40 });
    assert.equal(layerFrameBox({ ...frame, crop: { zoom: 2, x: 0, y: 0 } }, [100, 60], [60, 40, 80, 50]), undefined);
  });

  it('keeps a hidden layer hidden in every style', () => {
    const hidden = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">${SKY}<g opacity='0' id="sun"><circle cx="80" cy="18" r="10" fill="#facc15"/></g></svg>`;
    for (const style of DRAWING_STYLES) {
      const drawn = decodeSvgDataUrl(drawnImageSrc({ src: svgToBase64DataUrl(hidden), style }, 'ink')) ?? '';
      assert.ok(drawn.includes('<circle cx="80"'), style);
      assert.ok(!shownPart(drawn).includes('<circle cx="80"'), `${style} draws the hidden sun`);
    }
  });

  it('says layer names capitalized and kept apart from the sentence', () => {
    assert.equal(layerSelectedMessage('green hill', 2, 3), '⁨Green hill⁩, layer 2 of 3, selected');
    assert.equal(layerMovedMessage('sun', 'backward'), '⁨Sun⁩ sent backward');
  });
});

describe('picking layers on the board', () => {
  afterEach(() => {
    useSelection.getState().clear();
  });

  it('lists the shown layers and the hidden ones that draw', () => {
    const found = layeredDrawing(drawing());
    assert.deepEqual(found?.shown.map((layer) => layer.id), ['sky_wash', 'green-hill', 'sun']);
    assert.deepEqual(found?.listed.map((layer) => layer.id), ['sky_wash', 'green-hill', 'sun', 'bird']);
    assert.equal(layeredDrawing(drawing(SCENE, { style: 'plain' })), undefined, 'a plain drawing has no layers to pick');
    assert.deepEqual(layeredDrawing(drawing(SCENE, { crop: { zoom: 2, x: 0, y: 0 } }))?.shown.map((layer) => layer.id), ['sky_wash'], 'the hill and the sun are cropped away');
  });

  it('picks the layer under a double-click, front first and solid over faint', () => {
    load(drawing());
    assert.equal(enterLayerAt(drawing(), { x: 160, y: 36 }, 'mouse'), true);
    assert.deepEqual(useSelection.getState().layer, { el: 'pic', n: 2, id: 'sun' });
    assert.equal(pickedDrawingLayer()?.nth, 3);
    assert.equal(pickedDrawingLayer()?.of, 3);
  });

  it('picks the front solid layer with Enter, but not on a link', () => {
    load(drawing());
    assert.equal(enterFirstLayer(), true);
    assert.equal(useSelection.getState().layer?.id, 'sun');
    leaveLayer();
    load(drawing(SCENE, { href: 'https://example.com' }));
    assert.equal(enterFirstLayer(), false);
  });

  it('switches layers with a press on the drawing and ends with a press elsewhere', () => {
    load(drawing());
    const element = useBoard.getState().byId.get('pic');
    enterLayerAt(drawing(), { x: 160, y: 36 }, 'mouse');
    assert.equal(pressWhilePicked(element, { x: 100, y: 110 }, 'mouse'), true);
    assert.equal(useSelection.getState().layer?.id, 'green-hill');
    assert.equal(pressWhilePicked(undefined, { x: 500, y: 500 }, 'mouse'), false);
    assert.equal(useSelection.getState().layer, null);
    assert.deepEqual(useSelection.getState().ids, ['pic'], 'the whole drawing stays selected');
    assert.equal(enterLayerAt(drawing(), { x: 160, y: 36 }, 'mouse'), true);
    assert.equal(useSelection.getState().layer, null, 'a double-click right after does not pick again');
  });

  it('moves the picked layer to the nearest overlapping layer and keeps it picked', () => {
    load(drawing());
    chooseLayer({ n: 0, id: 'sky_wash' });
    const picked = pickedDrawingLayer();
    assert.equal(layerActionRefusals(picked).back, 'This layer is already at the back.');
    assert.equal(runLayerAction('forward'), true);
    assert.deepEqual(idsNow(), ['green-hill', 'sky_wash', 'sun', 'bird']);
    assert.deepEqual(useSelection.getState().layer, { el: 'pic', n: 1, id: 'sky_wash' });
    assert.equal(runLayerAction('front'), true);
    assert.deepEqual(idsNow(), ['green-hill', 'sun', 'bird', 'sky_wash']);
  });

  it('hides the picked layer, ends picking, and holds the next Delete', () => {
    load(drawing());
    chooseLayer({ n: 2, id: 'sun' });
    assert.equal(runLayerAction('hide'), true);
    assert.match(svgNow(), /<g opacity='0' id="sun">/);
    assert.equal(useSelection.getState().layer, null);
    assert.equal(deleteAfterHide('Backspace', false), true, 'the next Delete only says the drawing is selected');
    assert.equal(deleteAfterHide('Backspace', false), false);
  });

  it('shows a hidden layer when it is chosen, and picks it', () => {
    load(drawing());
    assert.equal(chooseLayer({ n: 3, id: 'bird' }), true);
    assert.match(svgNow(), /<g id="bird"><path/);
    assert.deepEqual(useSelection.getState().layer, { el: 'pic', n: 3, id: 'bird' });
  });

  it('refuses to hide the only layer that shows, and edits while offline', () => {
    const lone = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">${SUN}${BIRD}</svg>`;
    load(drawing(lone));
    chooseLayer({ n: 0, id: 'sun' });
    assert.equal(layerActionRefusals(pickedDrawingLayer()).hide, 'This is the only layer that shows.');
    assert.equal(runLayerAction('hide'), false);
    load(drawing());
    chooseLayer({ n: 0, id: 'sky_wash' });
    useBoard.setState({ status: 'offline' });
    assert.equal(runLayerAction('forward'), false);
    assert.deepEqual(idsNow(), ['sky_wash', 'green-hill', 'sun', 'bird']);
  });

  it('sets the pick aside while comments are placed, and has it back after', () => {
    load(drawing());
    useTool.getState().setCommentMode(true);
    assert.equal(enterFirstLayer(), false, 'no picking while commenting');
    useTool.getState().setCommentMode(false);
    chooseLayer({ n: 2, id: 'sun' });
    useTool.getState().setCommentMode(true);
    assert.equal(pickedDrawingLayer(), undefined);
    useTool.getState().setCommentMode(false);
    assert.equal(pickedDrawingLayer()?.layer.id, 'sun');
  });

  it('cannot pick a layer of a locked drawing', () => {
    load(drawing(SCENE, { locked: true }));
    assert.equal(enterFirstLayer(), false);
    assert.equal(chooseLayer({ n: 2, id: 'sun' }), false);
  });
});
