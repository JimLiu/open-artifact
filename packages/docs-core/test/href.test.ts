import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Block, type Char, parseMarkdown, storableHref } from '../src/index.ts';

function ids() {
  let n = 0;
  return { take: () => `id${++n}` };
}

function paragraph(markdown: string, lenient = false): Char[] {
  const blocks: Block[] = parseMarkdown(markdown, ids(), {}, { lenient });
  const block = blocks[0];
  assert.ok(block?.inline);
  return block.inline.filter((item): item is Char => 'ch' in item);
}

function textOf(chars: Char[]): string {
  return chars.map((item) => item.ch).join('');
}

function hrefsOf(chars: Char[]): string[] {
  return chars.flatMap((item) => (item.marks?.link ? [item.marks.link] : []));
}

describe('storableHref', () => {
  it('keeps http(s), mailto, tel, a fragment and a single-slash path', () => {
    for (const href of ['https://example.com', 'http://example.com/a?b=1#c', 'mailto:a@b.com', 'tel:+1-555-0100', '#id', '#', '/docs/a']) {
      assert.equal(storableHref(href), href);
    }
    assert.equal(storableHref('  https://example.com\n'), 'https://example.com');
  });

  it('refuses scripts, data, protocol-relative URLs and control-character bypasses', () => {
    for (const href of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,hi',
      'vbscript:msg',
      '//evil.example/a',
      'java\nscript:alert(1)',
      'java\tscript:alert(1)',
      'java\rscript:alert(1)',
      'java\u0000script:alert(1)',
      '\u0000javascript:alert(1)',
      'javascript\t:alert(1)',
      '&#106;avascript:alert(1)',
      'java&#10;script:alert(1)',
      '/\\evil',
      'http:alert(1)',
      'mailto:',
      'tel:',
    ]) {
      assert.equal(storableHref(href), null, href);
    }
  });
});

describe('parseMarkdown links', () => {
  it('does not store an href the document may not keep', () => {
    const chars = paragraph('[x](javascript:alert(1))');
    assert.equal(textOf(chars), 'x');
    assert.deepEqual(hrefsOf(chars), []);
    assert.equal(JSON.stringify(chars).includes('javascript:'), false);
  });

  it('stores an allowed link', () => {
    const chars = paragraph('[ok](https://example.com)');
    assert.equal(textOf(chars), 'ok');
    assert.deepEqual(hrefsOf(chars), ['https://example.com', 'https://example.com']);
    assert.deepEqual(hrefsOf(paragraph('[go](/docs/a)')), ['/docs/a', '/docs/a']);
    assert.deepEqual(hrefsOf(paragraph('[here](#id)')), ['#id', '#id', '#id', '#id']);
  });

  it('keeps a lenient anchor label without an illegal href', () => {
    const chars = paragraph('<a href="javascript:alert(1)">label</a>', true);
    assert.equal(textOf(chars), 'label');
    assert.deepEqual(hrefsOf(chars), []);
  });
});
