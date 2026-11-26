import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTemplate, type HtmlElement } from '@open-artifact/dc';
import { layerOf, loneGraphicOf, loneShapeName, loneShapeOf, paintTargetOf } from '../src/lib/lone-shape.ts';

const svgOf = (html: string): HtmlElement => parseTemplate(html).elements.find((element) => element.tag === 'svg')!;

describe('single-shape graphics', () => {
  it('finds the one shape, arrowheads allowed', () => {
    const svg = svgOf('<svg viewBox="0 0 10 10"><defs><marker id="m"><path d="M0 0L2 1z"/></marker></defs><line x1="0" y1="0" x2="10" y2="10" marker-end="url(#m)" stroke="red"/></svg>');
    const shape = loneShapeOf(svg);
    assert.equal(shape?.tag, 'line');
    assert.equal(loneGraphicOf(shape!), svg);
    assert.equal(layerOf(shape!), svg);
    assert.equal(loneShapeName(svg, shape!), 'Arrow');
  });

  it('is not one layer with two shapes, a group, a nested graphic or foreign attributes', () => {
    assert.equal(loneShapeOf(svgOf('<svg><rect width="2" height="2"/><circle r="1"/></svg>')), null);
    assert.equal(loneShapeOf(svgOf('<svg><g><path d="M0 0"/></g></svg>')), null);
    assert.equal(loneShapeOf(svgOf('<svg><path class="icon" d="M0 0"/></svg>')), null);
    assert.equal(loneShapeOf(svgOf('<svg><path style="margin: 2px" d="M0 0"/></svg>')), null);
    assert.equal(loneShapeOf(svgOf('<svg data-uneditable><path d="M0 0"/></svg>')), null);
    assert.equal(loneShapeOf(svgOf('<svg opacity="0.5"><path opacity="0.5" d="M0 0"/></svg>')), null);
    const nested = parseTemplate('<svg><svg><path d="M0 0"/></svg></svg>').elements.filter((element) => element.tag === 'svg')[1]!;
    assert.equal(loneShapeOf(nested), null);
  });

  it('names the layer', () => {
    const drawing = svgOf('<svg preserveAspectRatio="none" style="fill: none"><path d="M0 0L4 4" stroke="black"/></svg>');
    assert.equal(loneShapeName(drawing, loneShapeOf(drawing)!), 'Drawing');
    const line = svgOf('<svg><defs><marker id="m"/></defs><line x1="0" y1="0" x2="1" y2="1"/></svg>');
    assert.equal(loneShapeName(line, loneShapeOf(line)!), 'Line');
    assert.equal(loneShapeOf(svgOf('<svg width="4" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>')), null, 'width on both');
    const box = svgOf('<svg viewBox="0 0 4 4"><rect width="4" height="4" fill="red"/></svg>');
    assert.equal(loneShapeName(box, loneShapeOf(box)!), 'Rectangle');
    const dot = svgOf('<svg viewBox="0 0 4 4"><circle cx="2" cy="2" r="2" fill="red"/></svg>');
    assert.equal(loneShapeName(dot, loneShapeOf(dot)!), 'Ellipse');
  });

  it('writes paint where it takes effect', () => {
    const svg = svgOf('<svg fill="blue" stroke="red"><path d="M0 0" stroke="green"/></svg>');
    const shape = loneShapeOf(svg)!;
    assert.equal(paintTargetOf(svg, shape, 'stroke', 'black'), 'shape', 'the shape has it');
    assert.equal(paintTargetOf(svg, shape, 'fill', 'black'), 'svg', 'only the graphic has it');
    assert.equal(paintTargetOf(svg, shape, 'fill', 'none'), 'shape', 'removing the fill');
    assert.equal(paintTargetOf(svg, shape, 'stroke-width', '2'), 'shape', 'nobody has it');
    assert.equal(paintTargetOf(svg, shape, 'opacity', '0.5'), 'svg');
  });
});
