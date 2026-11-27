import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arrangeLayers, dropPoint, groupBoxHtml, layerPatch, staysInPlace, styledMarkup } from '../src/lib/paste-layers.ts';

describe('where pasted layers go in an artboard', () => {
  it('drops on the artboard’s centre while the centre is in view', () => {
    assert.deepEqual(dropPoint({ x: 100, y: 100, w: 400, h: 200 }, { x: 0, y: 0, w: 1000, h: 800 }), { x: 200, y: 100 });
    assert.deepEqual(dropPoint({ x: 100, y: 100, w: 400, h: 200 }, null), { x: 200, y: 100 });
  });

  it('drops on the centre of the part in view when the centre is out of view', () => {
    // Only the artboard's left 100 × 200 shows.
    assert.deepEqual(dropPoint({ x: 900, y: 0, w: 400, h: 200 }, { x: 0, y: 0, w: 1000, h: 800 }), { x: 50, y: 100 });
    // Nothing of it shows: its centre.
    assert.deepEqual(dropPoint({ x: 2000, y: 0, w: 400, h: 200 }, { x: 0, y: 0, w: 1000, h: 800 }), { x: 200, y: 100 });
  });

  it('keeps copies from the same artboard in place when they overlap it enough', () => {
    const board = { x: 0, y: 0, w: 800, h: 600 };
    assert.equal(staysInPlace({ x: 40, y: 40, w: 100, h: 50 }, board), true);
    // A sliver of 10px across is less than one cascade step.
    assert.equal(staysInPlace({ x: 790, y: 40, w: 100, h: 50 }, board), false);
    // Something smaller than a step only has to overlap by its own size.
    assert.equal(staysInPlace({ x: 790, y: 40, w: 10, h: 10 }, board), true);
    assert.equal(staysInPlace({ x: 900, y: 40, w: 100, h: 50 }, board), false);
  });
});

describe('the markup of pasted layers', () => {
  it('appends the position after the layer’s own styles and drops its margins', () => {
    const html = '<div style="margin-top: 12px; color: red">Hi</div>';
    assert.equal(
      styledMarkup(html, layerPatch(html, 10, 20)),
      '<div style="color: red; position: absolute; left: 10px; top: 20px; right: auto; bottom: auto; margin: 0px">Hi</div>',
    );
  });

  it('gives an artboard’s root its width', () => {
    const html = '<main style="padding: 8px">x</main>';
    assert.equal(
      styledMarkup(html, layerPatch(html, 0, 0, 300)),
      '<main style="padding: 8px; box-sizing: border-box; width: 300px; position: absolute; left: 0px; top: 0px; right: auto; bottom: auto; margin: 0px">x</main>',
    );
  });

  it('writes a group box the way ungrouping reads it', () => {
    assert.equal(
      groupBoxHtml({ x: 5, y: 6, w: 70, h: 80.5 }, '<i></i>'),
      '<div data-dc-group style="box-sizing: border-box; position: absolute; margin: 0px; left: 5px; top: 6px; width: 70px; height: 80.5px"><i></i></div>',
    );
  });

  it('keeps layers apart as they were, centres them, and boxes a shared group', () => {
    const html = arrangeLayers(
      [
        { html: '<p>a</p>', box: { x: 1000, y: 1000, w: 100, h: 40 }, groups: ['g1'] },
        { html: '<p>b</p>', box: { x: 1200, y: 1060, w: 100, h: 40 }, groups: ['g1'] },
        { html: '<div>root</div>', box: { x: 900, y: 1000, w: 50, h: 50 }, root: true },
      ],
      { x: 400, y: 300 },
    );
    // Bounds 900..1300 × 1000..1100, centred on (400, 300): origin (200, 250).
    assert.equal(
      html,
      '<div data-dc-group style="box-sizing: border-box; position: absolute; margin: 0px; left: 300px; top: 250px; width: 300px; height: 100px">'
        + '<p style="position: absolute; left: 0px; top: 0px; right: auto; bottom: auto; margin: 0px">a</p>\n'
        + '<p style="position: absolute; left: 200px; top: 60px; right: auto; bottom: auto; margin: 0px">b</p></div>\n'
        + '<div style="box-sizing: border-box; width: 50px; position: absolute; left: 200px; top: 250px; right: auto; bottom: auto; margin: 0px">root</div>',
    );
  });

  it('nests an inner group inside the outer one, and leaves a group of one unboxed', () => {
    const html = arrangeLayers(
      [
        { html: '<i>a</i>', box: { x: 0, y: 0, w: 10, h: 10 }, groups: ['inner', 'outer'] },
        { html: '<i>b</i>', box: { x: 20, y: 0, w: 10, h: 10 }, groups: ['inner', 'outer'] },
        { html: '<i>c</i>', box: { x: 40, y: 0, w: 10, h: 10 }, groups: ['outer'] },
        { html: '<i>d</i>', box: { x: 60, y: 0, w: 10, h: 10 }, groups: ['alone'] },
      ],
      { x: 35, y: 5 },
    )!;
    assert.equal((html.match(/data-dc-group/g) ?? []).length, 2);
    assert.ok(html.startsWith('<div data-dc-group style="box-sizing: border-box; position: absolute; margin: 0px; left: 0px; top: 0px; width: 50px; height: 10px"><div data-dc-group style="box-sizing: border-box; position: absolute; margin: 0px; left: 0px; top: 0px; width: 30px; height: 10px"><i'));
    assert.ok(html.endsWith('<i style="position: absolute; left: 60px; top: 0px; right: auto; bottom: auto; margin: 0px">d</i>'));
  });

  it('refuses markup that is not one element', () => {
    assert.equal(arrangeLayers([{ html: 'just words', box: { x: 0, y: 0, w: 1, h: 1 } }], { x: 0, y: 0 }), null);
  });
});
