import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkLayeredSvg,
  drawingLayerAlone,
  drawingLayerHits,
  drawingLayerName,
  drawingLayerShapesOf,
  drawingPlacement,
  firstSolidDrawingLayer,
  moveDrawingLayer,
  overlappingDrawingLayer,
  readDrawingLayers,
  setDrawingLayerHidden,
  topDrawingLayerHit,
  type DrawingLayerShapes,
} from '../src/drawn-svg/layers.ts';
import { unknownSvgParts } from '../src/drawn-svg/vetting.ts';

const SKY = '<g id="sky_wash"><rect width="100" height="60" fill="#bfdbfe" fill-opacity=".3"/></g>';
const HILL = '<g id="green-hill" opacity=".8"><path d="M0 60 Q50 20 100 60Z" fill="#16a34a"/></g>';
const SUN = '<g id="sun"><circle cx="80" cy="18" r="10" fill="#facc15"/></g>';
const BIRD = '<g id="bird" opacity="0"><path d="M10 10l5 4 5-4" fill="none" stroke="#111"/></g>';
const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">${SKY}\n${HILL}<rect id="frame" x="1" y="1" width="2" height="2"/>${SUN}${BIRD}</svg>`;

function ids(svg: string): string[] {
  return (readDrawingLayers(svg) ?? []).map((layer) => layer.id);
}

describe('drawing layers', () => {
  it('reads the named groups right under the root, back to front', () => {
    const layers = readDrawingLayers(SCENE);
    assert.deepEqual(
      layers?.map((layer) => [layer.n, layer.id, layer.name, layer.hidden]),
      [
        [0, 'sky_wash', 'sky wash', false],
        [1, 'green-hill', 'green hill', false],
        [2, 'sun', 'sun', false],
        [3, 'bird', 'bird', true],
      ],
    );
    const sun = layers?.[2];
    assert.equal(sun && SCENE.slice(sun.from, sun.to), SUN);
  });

  it('names layers from ids, cut to 40 characters', () => {
    assert.equal(drawingLayerName('left__arm-2'), 'left arm 2');
    assert.equal(drawingLayerName('---'), '');
    assert.equal([...drawingLayerName('x'.repeat(60))].length, 40);
  });

  it('has no layers when the text is not one plain svg element', () => {
    assert.equal(readDrawingLayers('<?xml version="1.0"?>' + SCENE), undefined);
    assert.equal(readDrawingLayers(SCENE.replace('<g id="sun">', '<g id="s&amp;n">')), undefined, 'an entity in an id');
    assert.equal(readDrawingLayers(SCENE.replace('</svg>', '')), undefined);
    assert.equal(readDrawingLayers(SCENE.replace('id="sun"', 'id="sun" id="moon"')), undefined, 'a repeated attribute');
    assert.equal(readDrawingLayers('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9"><g><rect width="1" height="1"/></g></svg>'), undefined, 'no named groups');
    const many = Array.from({ length: 25 }, (_, index) => `<g id="l${String(index)}"/>`).join('');
    assert.equal(readDrawingLayers(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9">${many}</svg>`), undefined, 'more than 24');
  });

  it('passes over comments and character data', () => {
    const svg = SCENE.replace(SUN, `<!-- <g id="fake"> -->${SUN}`);
    assert.deepEqual(ids(svg), ['sky_wash', 'green-hill', 'sun', 'bird']);
  });

  it('moves a layer to an index, keeping the text between the others', () => {
    const front = moveDrawingLayer(SCENE, { n: 0, id: 'sky_wash' }, 3);
    assert.equal(typeof front === 'string' && ids(front).join(), 'green-hill,sun,bird,sky_wash');
    assert.ok(front.includes(`${BIRD}${SKY}</svg>`), 'the top lands just before the root ends');
    const back = moveDrawingLayer(SCENE, { n: 2, id: 'sun' }, 0);
    assert.equal(ids(back).join(), 'sun,sky_wash,green-hill,bird');
    assert.ok(back.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">${SUN}${SKY}\n${HILL}`));
    assert.equal(moveDrawingLayer(SCENE, { n: 1, id: 'green-hill' }, 1), SCENE, 'already there');
    assert.equal(moveDrawingLayer(SCENE, { n: 1, id: 'nope' }, 0), 'gone');
    assert.deepEqual(unknownSvgParts(front), []);
  });

  it('hides a layer with opacity 0, keeping an opacity of its own inside', () => {
    const sun = setDrawingLayerHidden(SCENE, { n: 2, id: 'sun' }, true);
    assert.ok(sun.includes(`<g opacity='0' id="sun"><circle`));
    assert.equal(readDrawingLayers(sun)?.[2]?.hidden, true);
    const hill = setDrawingLayerHidden(SCENE, { n: 1, id: 'green-hill' }, true);
    assert.ok(hill.includes(`<g id="green-hill" opacity='0'><g opacity=".8"><path d="M0 60 Q50 20 100 60Z" fill="#16a34a"/></g></g>`));
    const shown = setDrawingLayerHidden(hill, { n: 1, id: 'green-hill' }, false);
    assert.ok(shown.includes(`<g id="green-hill"><g opacity=".8">`), 'showing it again keeps the opacity it had');
    assert.equal(setDrawingLayerHidden(SCENE, { n: 3, id: 'bird' }, true), SCENE, 'already hidden');
    const bird = setDrawingLayerHidden(SCENE, { n: 3, id: 'bird' }, false);
    assert.ok(bird.includes('<g id="bird"><path'));
  });

  it('refuses an edit that would not read back or would be too long', () => {
    assert.equal(checkLayeredSvg(SCENE, ['sky_wash', 'green-hill', 'bird', 'sun']), 'unread', 'layers out of the wanted order');
    assert.equal(checkLayeredSvg(SCENE.replace('<rect id="frame"', '<text>hi</text><rect id="frame"'), ids(SCENE)), 'unread', 'a part that does not vet');
    const long = SCENE.replace(SUN, SUN + `<g id="pad"><path d="M0 0${' l1 1'.repeat(8000)}"/></g>`);
    assert.equal(checkLayeredSvg(long, ids(long)), 'long');
    assert.equal(checkLayeredSvg(SCENE, ids(SCENE)), SCENE);
  });

  it('draws one layer alone for a thumbnail', () => {
    const alone = drawingLayerAlone(SCENE.replace('<g id="sky_wash">', '<defs><linearGradient id="fade"/></defs><g id="sky_wash">'), { n: 3, id: 'bird' });
    assert.equal(alone, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><defs><linearGradient id="fade"/></defs><g id="bird"><path d="M10 10l5 4 5-4" fill="none" stroke="#111"/></g></svg>');
    assert.equal(drawingLayerAlone(SCENE, { n: 0, id: 'gone' }), undefined);
  });

  it('finds the layers under a point, front first, solid ones picked over faint ones', () => {
    const shapes = drawingLayerShapesOf(SCENE) as DrawingLayerShapes;
    assert.deepEqual(shapes.size, [100, 60]);
    assert.deepEqual(
      shapes.layers.map((layer) => layer.n),
      [0, 1, 2],
      'the hidden bird draws nothing',
    );
    const onSun = drawingLayerHits(shapes, 80, 18, 0.5);
    assert.deepEqual(onSun, [
      { n: 2, solid: true },
      { n: 0, solid: false },
    ]);
    assert.equal(topDrawingLayerHit(onSun), 2);
    const onSky = drawingLayerHits(shapes, 20, 10, 0.5);
    assert.deepEqual(onSky, [{ n: 0, solid: false }]);
    assert.equal(topDrawingLayerHit(onSky), 0, 'a faint layer is still picked when nothing else is there');
    assert.equal(firstSolidDrawingLayer(shapes), 2);
  });

  it('finds the nearest overlapping layer over and under one', () => {
    const shapes = drawingLayerShapesOf(SCENE) as DrawingLayerShapes;
    assert.equal(overlappingDrawingLayer(shapes, 0, 'forward'), 1);
    assert.equal(overlappingDrawingLayer(shapes, 2, 'backward'), 0, 'the hill lies lower than the sun');
    assert.equal(overlappingDrawingLayer(shapes, 1, 'forward'), undefined);
    assert.equal(overlappingDrawingLayer(shapes, 2, 'forward'), undefined);
  });

  it('has no shapes for a drawing laid out otherwise', () => {
    assert.equal(drawingLayerShapesOf(SCENE.replace('viewBox="0 0 100 60"', 'viewBox="0 0 100 60" preserveAspectRatio="none"')), undefined);
    assert.equal(drawingLayerShapesOf(SCENE.replace('viewBox="0 0 100 60"', 'viewBox="10 0 100 60"')), undefined);
  });

  it('places a drawing to cover its frame, then zooms and pans it', () => {
    assert.deepEqual(drawingPlacement(200, 120, [100, 60]), { scale: 2, x: 0, y: 0 });
    assert.deepEqual(drawingPlacement(100, 100, [100, 50]), { scale: 2, x: -50, y: 0 }, 'a wide drawing in a square frame');
    assert.deepEqual(drawingPlacement(100, 50, [100, 50], { zoom: 2, x: 0, y: 1 }), { scale: 2, x: 0, y: -50 });
  });
});
