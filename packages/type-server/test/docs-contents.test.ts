/**
 * A table of contents in the files a doc exports to: a list of links to the headings of its tab, not an empty code block.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { after, describe, it } from 'node:test';
import { birth, type DocPerson, runCall } from '../src/docs/calls.ts';
import { DocStore, docDirOf } from '../src/docs/store.ts';
import { exportDocFile } from '../src/docs/transfer.ts';

const person: DocPerson = { id: 'owner', name: 'Owner' };

const MARKDOWN = `# Field notes

\`\`\`toc
\`\`\`

## Plan

### Steps

## Risks
`;

/** One entry of a zip, by name. */
function entryOf(bytes: Buffer, wanted: string): string {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  let at = bytes.readUInt32LE(end + 16);
  for (let index = bytes.readUInt16LE(end + 10); index > 0; index--) {
    const nameLength = bytes.readUInt16LE(at + 28);
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength);
    if (name === wanted) {
      const local = bytes.readUInt32LE(at + 42);
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const data = bytes.subarray(start, start + bytes.readUInt32LE(at + 20));
      return (bytes.readUInt16LE(at + 10) === 0 ? Buffer.from(data) : inflateRawSync(data)).toString('utf8');
    }
    at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  throw new Error(`no ${wanted} in the zip`);
}

describe('table of contents in exported files', () => {
  const roots: string[] = [];
  const storeOf = (markdown: string) => {
    const root = mkdtempSync(join(tmpdir(), 'open-artifact-docs-contents-'));
    roots.push(root);
    const made = birth(docDirOf(root), { name: 'Field notes', doc: { markdown } }, person);
    assert.equal(made.status, 200, JSON.stringify(made.body));
    return DocStore.open(docDirOf(root));
  };
  after(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  it('draws a nav of links in the print page', async () => {
    const html = (await exportDocFile(storeOf(MARKDOWN), person, new URLSearchParams({ format: 'html' }))).bytes.toString('utf8');
    assert.match(html, /<nav(?: id="[^"]*")? class="contents" aria-label="Table of contents">/);
    assert.match(html, /<div dir="auto" class="step-0 group"><a href="#plan">Plan<\/a><\/div><div dir="auto" class="step-1"><a href="#steps">Steps<\/a><\/div>/);
    assert.match(html, /<h2 id="plan">Plan<\/h2>/);
    assert.doesNotMatch(html, /<pre/);
    // The tab's title heads the page; it is no line of its contents.
    assert.doesNotMatch(html, /href="#field-notes"/);
  });

  it('lists the headings the file has: not one still waiting as a suggestion', async () => {
    const store = storeOf(MARKDOWN);
    const answer = runCall(store, { tool: 'update', ref: { object: 'node', id: '' }, payload: { suggest: true, ops: [{ op: 'insert', target: { kind: 'root' }, side: 'end', source: { markdown: '## Maybe' } }] } }, person) as unknown as { body: Record<string, unknown> };
    assert.ok(answer.body.suggestId, JSON.stringify(answer));
    const html = (await exportDocFile(DocStore.open(store.root), person, new URLSearchParams({ format: 'html' }))).bytes.toString('utf8');
    assert.match(html, /href="#risks">Risks</);
    assert.doesNotMatch(html, /Maybe/);
  });

  it('draws nothing where there are no headings to list', async () => {
    const html = (await exportDocFile(storeOf('Intro\n\n```toc\n```\n\nJust words.'), person, new URLSearchParams({ format: 'html' }))).bytes.toString('utf8');
    assert.doesNotMatch(html, /<nav|<pre/);
  });

  it('keeps a toc block with words in it as code', async () => {
    const html = (await exportDocFile(storeOf('Intro\n\n```toc\nnot a table\n```\n\n## One'), person, new URLSearchParams({ format: 'html' }))).bytes.toString('utf8');
    assert.doesNotMatch(html, /<nav/);
    assert.match(html, /<pre><code>not a table<\/code><\/pre>/);
  });

  it('links each line to a bookmark in Word', async () => {
    const xml = entryOf((await exportDocFile(storeOf(MARKDOWN), person, new URLSearchParams({ format: 'docx' }))).bytes, 'word/document.xml');
    const plan = /<w:bookmarkStart w:id="\d+" w:name="(_Link\d+)"\/><w:bookmarkEnd w:id="\d+"\/><w:r>(?:(?!<\/w:p>).)*Plan/.exec(xml);
    assert.ok(plan, 'the Plan heading holds a bookmark');
    assert.match(xml, new RegExp(`<w:hyperlink w:anchor="${plan[1]}" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/><w:b/>`));
    assert.match(xml, /<w:ind w:left="360"\/>(?:(?!<\/w:p>).)*Steps/);
    assert.doesNotMatch(xml, /w:val="Code"/);
  });

  it('writes a nested list of links in markdown', async () => {
    const markdown = (await exportDocFile(storeOf(MARKDOWN), person, new URLSearchParams())).bytes.toString('utf8');
    assert.match(markdown, /# Field notes\n\n- \[Plan\]\(#plan\)\n {2}- \[Steps\]\(#steps\)\n- \[Risks\]\(#risks\)\n\n## Plan/);
    assert.doesNotMatch(markdown, /```toc/);
  });

  it('keeps the words of a line from reading as markdown', async () => {
    const markdown = (await exportDocFile(storeOf('Intro\n\n```toc\n```\n\n## Use a_b [x]'), person, new URLSearchParams())).bytes.toString('utf8');
    assert.match(markdown, /- \[Use a\\_b \\\[x\\\]\]\(#/);
  });
});
