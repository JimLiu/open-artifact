import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applySplices, parseTemplate } from '@open-artifact/dc';
import { cssBlocks, pageFillDeclarations, pageFillEdits, pageFillFromCopy, pageFillSplices, readPageFill, rootElementOf, safePageFillValue, type PageFillEdit } from '../src/lib/page-fill.ts';

const write = (template: string, edits: PageFillEdit[]): string | null => {
  const model = parseTemplate(template);
  const splices = pageFillSplices(model, edits);
  return splices ? applySplices(template, splices) : null;
};

describe('page fill', () => {
  it('reads blocks, skipping comments and strings', () => {
    const blocks = cssBlocks('/* { */ body { color: "}" } @media (x) { body { a: b } } .a { .b { c: d } }');
    assert.ok(blocks);
    assert.deepEqual(blocks.map((b) => [b.prelude, b.at, b.nested]), [['body', false, false], ['@media (x)', true, false], ['.a', false, true]]);
    assert.equal(cssBlocks('body { color: red'), null);
  });

  it('reads the body rule, else the html rule', () => {
    assert.deepEqual(readPageFill(parseTemplate('<helmet><style>body { background: #222; }</style></helmet><div></div>')), { color: '#222' });
    assert.deepEqual(readPageFill(parseTemplate('<helmet><style>html { background-color: red }</style></helmet>')), { color: 'red' });
    assert.deepEqual(readPageFill(parseTemplate('<helmet><style>html, body { background: linear-gradient(red, blue) }</style></helmet>')), { image: 'linear-gradient(red, blue)' });
    assert.deepEqual(readPageFill(parseTemplate('<div></div>')), {});
  });

  it('changes a declaration in place and appends a new one', () => {
    const out = write('<helmet><style>body { margin: 0; background-color: #fff; }</style></helmet>', pageFillEdits({ color: 'red' }));
    assert.equal(out, '<helmet><style>body { margin: 0; background-color: red; }</style></helmet>');
    const both = write('<helmet><style>body {\n  background-color: #fff;\n  margin: 0;\n}</style></helmet>', pageFillEdits({ image: 'linear-gradient(red, blue)', color: 'red' }));
    assert.equal(both, '<helmet><style>body {\n  margin: 0;\n  background: linear-gradient(red, blue);\n  background-color: red;\n}</style></helmet>');
  });

  it('keeps the color after the shorthand', () => {
    const out = write('<helmet><style>body { background-color: #fff; background: url(a.png) }</style></helmet>', pageFillEdits({ image: 'url(b.png)', color: 'red' }));
    assert.equal(out, '<helmet><style>body { background: url(b.png); background-color: red; }</style></helmet>');
  });

  it('removes what has no value', () => {
    const out = write('<helmet><style>body { background: url(a.png); background-color: red; margin: 0 }</style></helmet>', pageFillEdits({ color: 'blue' }));
    assert.equal(out, '<helmet><style>body { background-color: blue; margin: 0; }</style></helmet>');
    const cleared = write('<helmet><style>body { background: url(a.png); background-color: red }</style></helmet>', pageFillEdits({}));
    assert.equal(cleared, '<helmet><style>body { }</style></helmet>');
  });

  it('refuses a stylesheet with nested rules', () => {
    assert.equal(write('<helmet><style>.card { .title { color: red } }</style></helmet>', pageFillEdits({ color: 'red' })), null);
  });

  it('creates a helmet when there is none, or a rule in the last stylesheet', () => {
    assert.equal(write('<div>Hi</div>', pageFillEdits({ color: 'red' })), '<helmet>\n<style>body { background-color: red; }</style>\n</helmet>\n<div>Hi</div>');
    assert.equal(write('<helmet><style>.a { color: red }\n</style></helmet>', pageFillEdits({ color: 'blue' })), '<helmet><style>.a { color: red }\nbody { background-color: blue; }\n</style></helmet>');
    assert.equal(write('<helmet><title>x</title></helmet>', pageFillEdits({ color: 'blue' })), '<helmet><title>x</title><style>body { background-color: blue; }</style>\n</helmet>');
  });

  it('drops an html background when body had none', () => {
    const out = write('<helmet><style>html { background: #000; color: red }\nbody { margin: 0 }</style></helmet>', pageFillEdits({ color: 'blue' }));
    assert.equal(out, '<helmet><style>html { color: red; }\nbody { margin: 0; background-color: blue; }</style></helmet>');
  });

  it('takes the copied fill and refuses unsafe values', () => {
    assert.deepEqual(pageFillFromCopy({ 'background-color': 'rgb(255, 0, 0)' }), { color: 'rgb(255, 0, 0)' });
    assert.deepEqual(pageFillFromCopy({ 'background-image': 'linear-gradient(red, blue)', 'background-color': 'transparent' }), { image: 'linear-gradient(red, blue)' });
    assert.equal(pageFillFromCopy({ background: 'url(javascript:alert(1))' }), null);
    assert.equal(safePageFillValue('red; } body { display: none'), false);
    assert.deepEqual(pageFillDeclarations({}), { 'background-color': '#ffffff' });
  });

  it('finds a frameless artboard’s root element', () => {
    const model = parseTemplate('<helmet><style></style></helmet>\n<main><p>Hi</p></main>');
    assert.equal(rootElementOf(model)?.tag, 'main');
  });
});
