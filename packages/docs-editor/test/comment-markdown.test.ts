import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COMMENT_MARKDOWN_LIMITS, hasMarkdown, inlineOnly, type MdBlock, type MdInline, parseCommentMarkdown, plainText, safeHref } from '../src/comments/markdown.ts';

const text = (value: string): MdInline => ({ t: 'text', text: value });
/** The inline nodes of a comment that is one paragraph. */
const inline = (source: string, mentions: string[] = []): MdInline[] => {
  const blocks = parseCommentMarkdown(source, mentions);
  assert.ok(blocks, `"${source}" is drawn`);
  const nodes = inlineOnly(blocks);
  assert.ok(nodes, `"${source}" is one paragraph`);
  return nodes;
};
const blocks = (source: string, mentions: string[] = []): MdBlock[] => {
  const parsed = parseCommentMarkdown(source, mentions);
  assert.ok(parsed);
  return parsed;
};

describe('comment Markdown: inline marks', () => {
  it('reads bold, italic, strike and code', () => {
    assert.deepEqual(inline('**bold** *it* _also_ ~~gone~~ `x < y`'), [
      { t: 'strong', c: [text('bold')] },
      text(' '),
      { t: 'em', c: [text('it')] },
      text(' '),
      { t: 'em', c: [text('also')] },
      text(' '),
      { t: 'del', c: [text('gone')] },
      text(' '),
      { t: 'code', text: 'x < y' },
    ]);
    assert.deepEqual(inline('***both***'), [{ t: 'em', c: [{ t: 'strong', c: [text('both')] }] }]);
    assert.deepEqual(inline('__strong__'), [{ t: 'strong', c: [text('strong')] }]);
  });

  it('leaves what is not a mark as typed', () => {
    assert.deepEqual(inline('snake_case_name, 2 * 3 * 4, ~5 min'), [text('snake_case_name, 2 * 3 * 4, ~5 min')]);
    assert.deepEqual(inline('**open only'), [text('**open only')]);
    assert.deepEqual(inline('\\*not em\\*'), [text('*not em*')]);
    assert.deepEqual(inline('`code with **stars**`'), [{ t: 'code', text: 'code with **stars**' }]);
    assert.deepEqual(inline('`unclosed'), [text('`unclosed')]);
  });

  it('marks Chinese and Japanese text, which has no spaces to tell by', () => {
    assert.deepEqual(inline('这是**“重点”**文字'), [text('这是'), { t: 'strong', c: [text('“重点”')] }, text('文字')]);
    assert.deepEqual(inline('中文**粗体**中文'), [text('中文'), { t: 'strong', c: [text('粗体')] }, text('中文')]);
  });
});

describe('comment Markdown: links', () => {
  it('links http(s) and mailto, written or bare', () => {
    assert.deepEqual(inline('[the spec](https://example.com/spec "Spec")'), [{ t: 'link', href: 'https://example.com/spec', c: [text('the spec')] }]);
    assert.deepEqual(inline('see https://example.com/a_(b). Then www.example.org!'), [
      text('see '),
      { t: 'link', href: 'https://example.com/a_(b)', c: [text('https://example.com/a_(b)')] },
      text('. Then '),
      { t: 'link', href: 'http://www.example.org', c: [text('www.example.org')] },
      text('!'),
    ]);
    assert.deepEqual(inline('<mailto:ana@example.com>'), [{ t: 'link', href: 'mailto:ana@example.com', c: [text('mailto:ana@example.com')] }]);
    assert.deepEqual(inline('**https://example.com**'), [{ t: 'strong', c: [{ t: 'link', href: 'https://example.com', c: [text('https://example.com')] }] }]);
  });

  it('keeps a link to anything else, pictures and HTML as typed', () => {
    assert.deepEqual(inline('[click](javascript:alert(1))'), [text('[click](javascript:alert(1))')]);
    assert.deepEqual(inline('[x](data:text/html,hi) [y](/relative)'), [text('[x](data:text/html,hi) [y](/relative)')]);
    assert.deepEqual(inline('![chart](https://example.com/c.png)'), [text('![chart](https://example.com/c.png)')]);
    assert.deepEqual(inline('<img src=x onerror=alert(1)> <b>hi</b>'), [text('<img src=x onerror=alert(1)> <b>hi</b>')]);
  });

  it('opens only safe addresses', () => {
    assert.equal(safeHref('https://example.com'), 'https://example.com');
    assert.equal(safeHref('HTTP://EXAMPLE.COM'), 'HTTP://EXAMPLE.COM');
    assert.equal(safeHref('www.example.com'), 'http://www.example.com');
    assert.equal(safeHref('tel:+15551234'), 'tel:+15551234');
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'java\nscript:x', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', '/path', '#top', 'https://', 'https:///x', 'mailto:']) {
      assert.equal(safeHref(bad), null, bad);
    }
  });
});

describe('comment Markdown: mentions', () => {
  it('marks the @names given, not inside code or words', () => {
    assert.deepEqual(inline('@Ann Lee can you check, @Agent?', ['Ann', 'Ann Lee', 'Agent']), [
      { t: 'mention', text: '@Ann Lee' },
      text(' can you check, '),
      { t: 'mention', text: '@Agent' },
      text('?'),
    ]);
    assert.deepEqual(inline('`@Agent` mail ana@Agent.com', ['Agent']), [{ t: 'code', text: '@Agent' }, text(' mail ana@Agent.com')]);
    // As for who a message asks (mentionsIn): an @name starts the text or follows a space.
    assert.deepEqual(inline('**@Agent** please', ['Agent']), [{ t: 'strong', c: [text('@Agent')] }, text(' please')]);
  });

  it('marks @names in Chinese text, touching the words and full-width punctuation around them', () => {
    assert.deepEqual(inline('请@宝玉看，@Agent。', ['宝玉', 'Agent']), [text('请'), { t: 'mention', text: '@宝玉' }, text('看，'), { t: 'mention', text: '@Agent' }, text('。')]);
  });
});

describe('comment Markdown: blocks', () => {
  it('keeps the line breaks of a paragraph', () => {
    assert.deepEqual(blocks('one *two*\nthree'), [{ t: 'p', c: [text('one '), { t: 'em', c: [text('two')] }, text('\nthree')] }]);
  });

  it('reads lists, nested by indentation', () => {
    assert.deepEqual(blocks('- a\n- b\n  - c\n\n3. three\n4. four'), [
      {
        t: 'list',
        ordered: false,
        start: 1,
        items: [[{ t: 'p', c: [text('a')] }], [{ t: 'p', c: [text('b')] }, { t: 'list', ordered: false, start: 1, items: [[{ t: 'p', c: [text('c')] }]] }]],
      },
      { t: 'list', ordered: true, start: 3, items: [[{ t: 'p', c: [text('three')] }], [{ t: 'p', c: [text('four')] }]] },
    ]);
    // A number inside a sentence does not start a list.
    assert.equal(blocks('We need\n2. not a list').length, 1);
  });

  it('reads quotes, headings, code and rules', () => {
    assert.deepEqual(blocks('> quoted **text**\n> more'), [{ t: 'quote', c: [{ t: 'p', c: [text('quoted '), { t: 'strong', c: [text('text')] }, text('\nmore')] }] }]);
    assert.deepEqual(blocks('## Plan\nbody'), [
      { t: 'h', level: 2, c: [text('Plan')] },
      { t: 'p', c: [text('body')] },
    ]);
    assert.deepEqual(blocks('```ts\nconst a = `x`;\n  **not bold**\n```\nafter'), [
      { t: 'code', lang: 'ts', text: 'const a = `x`;\n  **not bold**' },
      { t: 'p', c: [text('after')] },
    ]);
    assert.deepEqual(blocks('above\n\n---\n\nbelow'), [{ t: 'p', c: [text('above')] }, { t: 'hr' }, { t: 'p', c: [text('below')] }]);
    assert.deepEqual(blocks('#hashtag'), [{ t: 'p', c: [text('#hashtag')] }]);
  });

  it('draws the plain text of its marks', () => {
    assert.equal(plainText(inline('**a** [b](https://x.y) `c` @Ann', ['Ann'])), 'a b c @Ann');
  });
});

describe('comment Markdown: what it takes to draw', () => {
  it('says when a text has anything to draw', () => {
    for (const plain of ['Looks good to me', 'Can we move this up?', 'a - b', 'Call me at 5']) assert.equal(hasMarkdown(plain), false, plain);
    for (const marked of ['**a**', '- item', '1. one', '> q', '## h', 'see https://x.y', '`c`', '---']) assert.equal(hasMarkdown(marked), true, marked);
  });

  it('shows a comment too deep or too big as plain text', () => {
    assert.equal(parseCommentMarkdown(`${'>'.repeat(60)} deep`), null);
    assert.equal(parseCommentMarkdown(`${'  '.repeat(60)}- deep`.replace(/^/, '- '.repeat(55))), null);
    assert.equal(parseCommentMarkdown('x'.repeat(COMMENT_MARKDOWN_LIMITS.length + 1)), null);
    const nested = Array.from({ length: 60 }, (_, n) => `${'  '.repeat(n)}- level ${n}`).join('\n');
    assert.equal(parseCommentMarkdown(nested), null);
    // Within the limits it is drawn.
    assert.ok(parseCommentMarkdown(Array.from({ length: 10 }, (_, n) => `${'  '.repeat(n)}- level ${n}`).join('\n')));
  });

  it('leaves the delimiters past the limit as typed', () => {
    const many = '_a_ '.repeat(COMMENT_MARKDOWN_LIMITS.delimiters);
    const nodes = inline(many.trim());
    assert.equal(nodes.filter(node => node.t === 'em').length, COMMENT_MARKDOWN_LIMITS.delimiters / 2);
  });
});
