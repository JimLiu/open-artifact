import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { linkAround, linkMissed, outermostLink, type LinkNode } from '../src/lib/editor-link.ts';

interface FakeNode extends LinkNode {
  readonly name: string;
}

function node(nodeName: string, name: string, parentNode: FakeNode | null): FakeNode {
  return { nodeName, name, parentNode };
}

// <div editor><p>before <a>outer <a>inner</a></a> <a>other</a></p></div>
const page = node('BODY', 'page', null);
const pageLink = node('A', 'page link', page);
const editor = node('DIV', 'editor', pageLink);
const para = node('P', 'paragraph', editor);
const before = node('#text', 'before', para);
const outer = node('A', 'outer', para);
const outerText = node('#text', 'outer text', outer);
const inner = node('A', 'inner', outer);
const innerText = node('#text', 'inner text', inner);
const other = node('A', 'other', para);
const otherText = node('#text', 'other text', other);
const outside = node('#text', 'outside', page);

describe('the link a text selection sits in', () => {
  it('finds the outermost link below the editor', () => {
    assert.equal(outermostLink<FakeNode>(innerText, editor)?.name, 'outer');
    assert.equal(outermostLink<FakeNode>(outerText, editor)?.name, 'outer');
    assert.equal(outermostLink<FakeNode>(before, editor), null);
  });

  it('never reaches past the editor, nor finds links for nodes outside it', () => {
    assert.equal(outermostLink<FakeNode>(para, editor), null, 'the link around the editor does not count');
    assert.equal(outermostLink<FakeNode>(outside, editor), null);
  });

  it('takes a link only when both ends of the selection are in it', () => {
    assert.equal(linkAround<FakeNode>(outerText, innerText, editor)?.name, 'outer');
    assert.equal(linkAround<FakeNode>(innerText, innerText, editor)?.name, 'outer', 'a caret');
    assert.equal(linkAround<FakeNode>(before, outerText, editor), null);
    assert.equal(linkAround<FakeNode>(outerText, otherText, editor), null, 'two different links');
  });

  it('redoes the link unless the address read back is exactly the new one', () => {
    assert.equal(linkMissed('https://example.com/new', 'https://example.com/new'), false);
    assert.equal(linkMissed('https://example.com/old', 'https://example.com/new'), true, 'a nested link left the old address outside');
    assert.equal(linkMissed(null, 'https://example.com/new'), true, 'no single link around the selection');
  });
});
