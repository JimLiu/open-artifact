import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeBoard, decomposeBoard, elementPath, toStoredElement } from '../src/codec.ts';
import { svgBase64ToTextDataUrl, svgTextToBase64DataUrl, svgToBase64DataUrl } from '../src/image-source.ts';
import type { Board, ImageElement } from '../src/schema.ts';

const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20">\n\t<rect width="12" height="8" fill="#e11d48"/><path d="M2 18h30" stroke="currentColor" stroke-dasharray="40%"/></svg>';

function drawing(src: string): ImageElement {
  return { id: 'pic1', type: 'image', x: 10, y: 20, w: 80, h: 40, src };
}

describe('drawings saved as text', () => {
  it('saves a base64 drawing as a readable text data URL with %, #, tabs and line breaks escaped', () => {
    const base64 = svgToBase64DataUrl(DRAWING);
    const text = svgBase64ToTextDataUrl(base64);
    assert.ok(text.startsWith('data:image/svg+xml,<svg '));
    assert.ok(text.includes('fill="%23e11d48"') && text.includes('40%25') && text.includes('%0A%09'));
    assert.doesNotMatch(text, /[#\t\n\r]/);
    assert.equal(svgTextToBase64DataUrl(text), base64);
  });

  it('round-trips a drawing through the stored documents to the same base64', () => {
    const base64 = svgToBase64DataUrl(DRAWING);
    const board: Board = { title: 'Board', content: { elements: [drawing(base64)] } };
    const documents = decomposeBoard(board);
    const stored = documents.get(elementPath('pic1'));
    assert.equal(typeof stored?.src === 'string' && stored.src.startsWith('data:image/svg+xml,'), true);
    const composed = composeBoard(documents).content.elements[0];
    assert.equal(composed?.type === 'image' && composed.src, base64);
    assert.deepEqual(decomposeBoard({ title: 'Board', content: { elements: composeBoard(documents).content.elements } }).get(elementPath('pic1')), stored);
  });

  it('keeps base64 when the text would not read back the same', () => {
    const noViewBox = svgToBase64DataUrl('<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.equal(svgBase64ToTextDataUrl(noViewBox), noViewBox);
    const invalidUtf8 = 'data:image/svg+xml;base64,' + Buffer.from([0x3c, 0x73, 0x76, 0x67, 0xff, 0x3e]).toString('base64');
    assert.equal(svgBase64ToTextDataUrl(invalidUtf8), invalidUtf8);
    const upload = toStoredElement(drawing('/_blob/0123456789abcdef0123456789abcdef'));
    assert.equal(upload.type === 'image' && upload.src, '/_blob/0123456789abcdef0123456789abcdef');
  });
});
