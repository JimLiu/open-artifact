import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type DocState, applyOps } from '@open-artifact/docs-core';
import { schema } from '../src/editor/schema.ts';
import { type PageNode, canonical, docToPage } from '../src/sync/page.ts';

const MARKDOWN = [
  '# Plan',
  '',
  'Words with **bold**, *italic*, ~~gone~~, `code` and a [link](https://example.com).',
  '',
  '- one',
  '  - nested',
  '- two',
  '',
  '3. third',
  '4. fourth',
  '',
  '- [ ] task',
  '- [x] done',
  '',
  '> quoted',
  '',
  '```ts',
  'const x = 1;',
  '```',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | **2** |',
  '',
  '---',
].join('\n');

function richDoc(): DocState {
  const session = { sess: 's1', next: 1 };
  let doc: DocState = { rev: 0, blocks: [{ id: 's0.0', type: 'paragraph', inline: [] }] };
  doc = applyOps(doc, [{ op: 'replace', target: { kind: 'blocks', ids: ['s0.0'] }, with: { as: 'markdown', from: { kind: 'inline', content: MARKDOWN } } }], session).doc;
  const chips = {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Due ' },
      { type: 'date', attrs: { ts: '2026-12-01' } },
      { type: 'text', text: ' for ' },
      { type: 'mention', attrs: { principal: 'user:me', name: 'Me' } },
      { type: 'hardBreak' },
      { type: 'dropdown', attrs: { enum: 'status', index: 1 } },
      { type: 'text', text: ' red', marks: [{ type: 'textColor', attrs: { color: 'red' } }] },
      { type: 'text', text: ' lit', marks: [{ type: 'highlight' }, { type: 'underline' }] },
      { type: 'media', attrs: { blob: 'blob/abc', alt: 'A picture' } },
    ],
  };
  doc = applyOps(doc, [{ op: 'insert', target: { kind: 'root' }, side: 'end', with: { as: 'blocks', from: { kind: 'blocks', content: [chips] } } }], session).doc;
  const suggest = { id: 'sg1', info: { by: 'agent', at: '2026-11-18T00:00:00Z', via: 'agent' } };
  doc = applyOps(doc, [{ op: 'insert', target: { kind: 'root' }, side: 'end', with: { as: 'markdown', from: { kind: 'inline', content: 'A suggested paragraph.' } } }], session, { suggest }).doc;
  const second = doc.blocks[1]!;
  const word = second.inline!.slice(0, 5);
  doc = applyOps(doc, [{ op: 'delete', target: { kind: 'chars', range: [word[0]!.id, word.at(-1)!.id] } }], session, { suggest: { id: 'sg2', info: suggest.info } }).doc;
  return doc;
}

const types = (node: PageNode, out = new Set<string>()): Set<string> => {
  out.add(node.type);
  for (const mark of node.marks ?? []) out.add(`mark:${mark.type}`);
  for (const child of node.content ?? []) types(child, out);
  return out;
};

describe('the editor schema', () => {
  it('reads every page doc and writes it back unchanged', () => {
    const page = docToPage(richDoc());
    const seen = types(page);
    for (const name of ['list', 'listItem', 'blockquote', 'codeBlock', 'table', 'tableRow', 'cell', 'horizontalRule', 'date', 'mention', 'dropdown', 'hardBreak', 'media', 'mark:suggestIns', 'mark:suggestDel', 'mark:textColor', 'mark:highlight', 'mark:link']) {
      assert.ok(seen.has(name), `the sample has ${name}`);
    }
    const node = schema.nodeFromJSON(page);
    node.check();
    assert.deepEqual(canonical(node.toJSON() as PageNode), canonical(page));
  });

  it('keeps a block’s suggestion and every block’s id', () => {
    const page = docToPage(richDoc());
    const node = schema.nodeFromJSON(page);
    const ids: string[] = [];
    node.descendants(child => {
      if (child.isBlock && child.attrs.bid) ids.push(child.attrs.bid);
    });
    const pageIds: string[] = [];
    const walk = (item: PageNode) => {
      if (item.type !== 'doc' && item.attrs?.bid) pageIds.push(item.attrs.bid as string);
      item.content?.forEach(walk);
    };
    walk(page);
    assert.deepEqual(ids, pageIds);
    const last = node.lastChild!;
    assert.equal(last.attrs.suggestOp, 'ins');
    assert.equal(last.attrs.suggestId, 'sg1');
  });

  it('does not keep a link the document may not store', () => {
    const bad = schema.marks.link.create({ href: 'javascript:alert(1)' });
    const badSpec = schema.marks.link.spec.toDOM!(bad, true);
    assert.ok(Array.isArray(badSpec));
    const badAttrs = badSpec[1] as Record<string, string>;
    assert.equal(badAttrs.href, undefined);
    assert.equal(badAttrs.rel, 'noopener noreferrer nofollow');

    const good = schema.marks.link.create({ href: 'https://example.com' });
    const goodSpec = schema.marks.link.spec.toDOM!(good, true);
    assert.ok(Array.isArray(goodSpec));
    assert.equal((goodSpec[1] as Record<string, string>).href, 'https://example.com');

    const getAttrs = schema.marks.link.spec.parseDOM?.[0]?.getAttrs as ((dom: { getAttribute(name: string): string | null }) => false | { href: string }) | undefined;
    assert.equal(typeof getAttrs, 'function');
    const read = (href: string) => getAttrs!({ getAttribute: (name: string) => (name === 'href' ? href : null) });
    assert.equal(read('javascript:alert(1)'), false);
    assert.equal(read('java\nscript:alert(1)'), false);
    assert.deepEqual(read('https://example.com'), { href: 'https://example.com' });
    assert.deepEqual(read('#section'), { href: '#section' });
  });
});
