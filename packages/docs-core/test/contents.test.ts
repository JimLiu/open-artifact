import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOps, blocksFromJson, blocksToMarkdown, contentsGrouped, contentsLines, contentsOf, type DocState, docToJson, isContents, linkAnchors, parseMarkdown, plainText, type Session } from '../src/index.ts';

const idsFor = (session: Session) => ({ take: () => `${session.sess}.${session.next++}` });
const parse = (markdown: string) => parseMarkdown(markdown, idsFor({ sess: 'e0000000001', next: 1 }));
const listed = (markdown: string) => contentsOf(parse(markdown)).map(line => `${line.indent}:${plainText(line.heading.block)}`);

test('a table of contents lists the headings of its tab, stepped in from the shallowest', () => {
  assert.deepEqual(listed('Intro\n\n```toc\n```\n\n## Plan\n\n### Steps\n\n#### Too deep\n\n## Risks'), ['0:Plan', '1:Steps', '0:Risks']);
  assert.deepEqual(listed('```toc\n```\n\nNo headings here.'), []);
  // Headings with no words in them have nothing to show.
  assert.deepEqual(listed('Intro\n\n## \n\n## Kept'), ['0:Kept']);
});

test('the heading a tab opens with is its title and stays out', () => {
  assert.deepEqual(listed('# Report\n\n```toc\n```\n\n## One\n\n## Two'), ['0:One', '0:Two']);
  assert.deepEqual(listed('Lead-in\n\n# Report\n\n## One'), ['0:Report', '1:One']);
});

test('headings inside lists and quotes are listed too', () => {
  assert.deepEqual(listed('Intro\n\n> ## Quoted\n\n- item\n\n## After'), ['0:Quoted', '0:After']);
});

test('top lines read as groups only when lines sit under them', () => {
  assert.equal(contentsGrouped(contentsLines([{ level: 2 }, { level: 2 }], false)), false);
  assert.equal(contentsGrouped(contentsLines([{ level: 1 }, { level: 2 }], false)), true);
  assert.deepEqual(
    contentsLines([{ level: 1 }, { level: 2 }, { level: 3 }], true).map(line => line.indent),
    [0, 1],
  );
});

test('only an empty toc code block is a table of contents', () => {
  const [bare, filled, other] = parse('```toc\n```\n\n```toc\nwords\n```\n\n```ts\n```');
  assert.equal(isContents(bare!), true);
  assert.equal(isContents(filled!), false);
  assert.equal(isContents(other!), false);
});

test('a table of contents keeps its fence through markdown, json and an insert', () => {
  const source = 'Intro\n\n```toc\n\n```\n\n## One';
  const blocks = parse(source);
  assert.equal(blocks[1]!.type, 'codeBlock');
  assert.equal(blocks[1]!.attrs?.language, 'toc');
  const out = blocksToMarkdown(blocks);
  assert.equal(out, source);
  assert.equal(blocksToMarkdown(parse(out)), out);
  const session: Session = { sess: 'f0000000001', next: 1 };
  const again = blocksFromJson((docToJson({ rev: 1, blocks }) as { content: unknown }).content, idsFor(session));
  assert.equal(isContents(again[1]!), true);
  const doc: DocState = { rev: 1, blocks: parse('Intro') };
  const result = applyOps(doc, [{ op: 'insert', target: { kind: 'root' }, side: 'end', source: { markdown: '```toc\n```' } }], session);
  assert.equal(isContents(result.doc.blocks[1]!), true);
});

test('a file links each table of contents to the headings it lists', () => {
  const tab = { id: 't1', name: 'Tab', blocks: parse('# Report\n\n```toc\n```\n\n## Plan\n\n### Steps\n\n## Risks') };
  const { tabs, anchors } = linkAnchors([tab]);
  const lines = anchors.contents!.get(tabs[0]!.blocks[1]!.id)!;
  assert.deepEqual(
    lines.map(line => [line.text, line.indent, line.group, line.anchor?.id]),
    [
      ['Plan', 0, true, 'plan'],
      ['Steps', 1, false, 'steps'],
      ['Risks', 0, true, 'risks'],
    ],
  );
  // The headings it lists are the places those links land.
  assert.equal(anchors.blocks.get(tabs[0]!.blocks[2]!.id)?.id, 'plan');
});

test('a file draws twenty tables of contents at most', () => {
  const markdown = [...Array.from({ length: 22 }, () => '```toc\n```'), '## One'].join('\n\n');
  const { anchors } = linkAnchors([{ id: 't1', name: 'Tab', blocks: parse(markdown) }]);
  assert.equal(anchors.contents!.size, 20);
});
