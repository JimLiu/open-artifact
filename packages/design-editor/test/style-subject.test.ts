import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTemplate, type HtmlElement } from '@open-artifact/dc';
import { refuses, subjectOf } from '../src/lib/style-subject.ts';

const parsed = (html: string) => parseTemplate(html).elements;
const byTag = (html: string, tag: string): HtmlElement => parsed(html).find((element) => element.tag === tag)!;

describe('what Copy / Paste properties works on', () => {
  it('reads a one-shape graphic through its shape, and a graphic with two shapes as a shape itself', () => {
    const svg = byTag('<svg viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" fill="red"/></svg>', 'svg');
    const subject = subjectOf(svg);
    assert.equal(subject.kind, 'shape');
    assert.equal(subject.element.tag, 'rect');
    const two = byTag('<svg><rect width="2" height="2"/><circle r="1"/></svg>', 'svg');
    assert.deepEqual([subjectOf(two).kind, subjectOf(two).element.tag], ['shape', 'svg']);
  });

  it('sorts a rule, an image, text and a box', () => {
    assert.equal(subjectOf(byTag('<div><hr></div>', 'hr')).kind, 'rule');
    assert.equal(subjectOf(byTag('<div><img src="a.png"></div>', 'img')).kind, 'image');
    assert.equal(subjectOf(byTag('<p>Hello</p>', 'p')).kind, 'text');
    assert.equal(subjectOf(byTag('<div><div></div><div></div></div>', 'div')).kind, 'box');
  });

  it('refuses component instances and what is inside repeats, conditions and the head, and a computed style', () => {
    assert.equal(refuses(byTag('<x-import name="Chip"></x-import>', 'x-import')), true);
    assert.equal(refuses(byTag('<sc-for each="{{items}}"><div>a</div></sc-for>', 'div')), true);
    assert.equal(refuses(byTag('<sc-if value="{{on}}"><p>a</p></sc-if>', 'p')), true);
    assert.equal(refuses(byTag('<div style="{{look}}">a</div>', 'div')), true);
    assert.equal(refuses(byTag('<section><div style="color: red">a</div></section>', 'div')), false);
  });
});
