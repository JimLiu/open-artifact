import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { foreignObjectSvg, objectAlign, objectFitAspect } from '../src/capture.ts';

describe('object-fit as preserveAspectRatio', () => {
  it('maps each fit', () => {
    assert.equal(objectFitAspect('fill', '50% 50%'), 'none');
    assert.equal(objectFitAspect('cover', '50% 50%'), 'xMidYMid slice');
    assert.equal(objectFitAspect('contain', '50% 50%'), 'xMidYMid meet');
    assert.equal(objectFitAspect('scale-down', '50% 50%'), 'xMidYMid meet');
    assert.equal(objectFitAspect('none', '50% 50%'), null);
  });

  it('aligns to the object position', () => {
    assert.equal(objectAlign('0% 100%'), 'xMinYMax');
    assert.equal(objectAlign('0px 0px'), 'xMinYMin');
    assert.equal(objectAlign('left top'), 'xMinYMin');
    assert.equal(objectAlign('100% 50%'), 'xMaxYMid');
    assert.equal(objectAlign('20% 12px'), 'xMidYMid');
  });
});

describe('a drawing through a foreignObject', () => {
  it('lays out at CSS px when no zoom is said', () => {
    const svg = foreignObjectSvg('<p>hi</p>', '', { width: 800, height: 600 });
    assert.match(svg, /width="800" height="600" viewBox="0 0 800 600"/);
    assert.match(svg, /<foreignObject x="0" y="0" width="800" height="600">/);
    assert.ok(!svg.includes('zoom'));
    assert.equal(foreignObjectSvg('<p>hi</p>', '', { width: 800, height: 600, zoom: 1 }), svg);
  });

  it('lays out at the device pixels the page was measured at, and stays the same size', () => {
    // On a 2x screen the system font's Han glyphs are narrower than at 1x: the drawing is laid out zoomed so its
    // lines wrap where the page's did, in a view box that scales it back.
    const svg = foreignObjectSvg('<p>hi</p>', '', { width: 800, height: 600, zoom: 2 });
    assert.match(svg, /<svg[^>]* width="800" height="600" viewBox="0 0 1600 1200">/);
    assert.match(svg, /<foreignObject x="0" y="0" width="1600" height="1200">/);
    assert.match(svg, /style="width:800px;height:600px;margin:0;overflow:hidden;zoom:2"/);
  });

  it('ignores a zoom that is not a size', () => {
    const plain = foreignObjectSvg('', '', { width: 10, height: 10 });
    for (const zoom of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(foreignObjectSvg('', '', { width: 10, height: 10, zoom }), plain);
  });
});
