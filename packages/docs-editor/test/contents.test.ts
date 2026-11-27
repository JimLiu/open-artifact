import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state';
import { filterLanguages, languageLabel } from '../src/code/languages.ts';
import {
  HINT_AGAIN_MS,
  contentsBeside,
  contentsSelected,
  freshLessons,
  hintsToSay,
  insertContents,
  isPageContents,
  pageContents,
  selectedContents,
  stillOnContents,
  wholeContents,
} from '../src/code/contents.ts';
import { schema } from '../src/editor/schema.ts';
import { languagesFor } from '../src/insert/languages.ts';
import { slashItems } from '../src/insert/slash-items.ts';

const { nodes } = schema;
const para = (text = '', attrs: Record<string, unknown> = {}) => nodes.paragraph!.create(attrs, text ? schema.text(text) : null);
const heading = (level: number, text: string, bid?: string) => para(text, { heading: level, ...(bid ? { bid } : {}) });
const contents = (text = '') => nodes.codeBlock!.create({ language: 'toc' }, text ? schema.text(text) : null);
const doc = (...blocks: PMNode[]) => nodes.doc!.create(null, blocks);

function run(state: EditorState, command: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean): EditorState {
  let next = state;
  assert.ok(command(state, tr => (next = state.apply(tr))));
  return next;
}

describe('table of contents on the page', () => {
  it('is an empty toc code block only', () => {
    assert.equal(isPageContents(contents()), true);
    assert.equal(isPageContents(contents('words')), false);
    assert.equal(isPageContents(nodes.codeBlock!.create({ language: 'js' })), false);
  });

  it('lists the headings with links, stepped in, the top ones as groups', () => {
    const lines = pageContents(doc(para('Intro'), contents(), heading(1, 'Plan', 'a1.1'), heading(2, 'Steps', 'a1.2'), heading(4, 'Deep', 'a1.3'), heading(2, 'Draft')));
    assert.deepEqual(lines, [
      { text: 'Plan', indent: 0, group: true, href: '#a1.1~plan' },
      { text: 'Steps', indent: 1, group: false, href: '#a1.2~steps' },
      { text: 'Draft', indent: 1, group: false, href: null },
    ]);
  });

  it('leaves out the heading the tab opens with', () => {
    const lines = pageContents(doc(heading(1, 'Report', 'a1.1'), contents(), heading(2, 'One', 'a1.2'), heading(2, 'Two', 'a1.3')));
    assert.deepEqual(lines.map(line => [line.text, line.group]), [['One', false], ['Two', false]]);
    assert.deepEqual(pageContents(doc(para('No headings'), contents())), []);
  });

  it('lists a heading still waiting as a suggestion, as the page shows it', () => {
    const waiting = para('Maybe', { heading: 2, bid: 'a1.2', suggestId: 's1', suggestOp: 'ins' });
    assert.deepEqual(pageContents(doc(para('Intro'), contents(), heading(2, 'Kept', 'a1.1'), waiting)).map(line => line.text), ['Kept', 'Maybe']);
  });

  it('goes in from the slash menu with an empty line after it to write on', () => {
    const start = doc(para('Intro'), para());
    let state = EditorState.create({ doc: start, selection: TextSelection.create(start, start.child(0).nodeSize + 1) });
    state = run(state, insertContents);
    assert.deepEqual(state.doc.content.content.map(node => node.type.name), ['paragraph', 'codeBlock', 'paragraph']);
    assert.equal(isPageContents(state.doc.child(1)), true);
    assert.equal(state.selection.$from.parent, state.doc.child(2));
    assert.deepEqual(slashItems('toc', { inTable: false, inQuoteOrItem: false, canPickImage: true }).map(item => item.label), ['Table of contents']);
    assert.ok(!slashItems('', { inTable: true, inQuoteOrItem: false, canPickImage: true }).some(item => item.id === 'toc'));
  });

  it('is offered by no language list, but named in the bar', () => {
    assert.ok(!filterLanguages('').some(language => language.key === 'toc'));
    assert.deepEqual(filterLanguages('to'), []);
    assert.deepEqual(languagesFor('toc'), []);
    assert.equal(languageLabel('toc'), 'Table of contents');
  });

  it('is selected whole, from a caret inside it or an arrow beside it', () => {
    const d = doc(para('Intro'), contents(), para('After'));
    const at = d.child(0).nodeSize;
    const inside = EditorState.create({ doc: d, selection: TextSelection.create(d, at + 1) });
    assert.equal(wholeContents(inside)?.from, at);
    const below = EditorState.create({ doc: d, selection: TextSelection.create(d, at + d.child(1).nodeSize + 1) });
    assert.equal(contentsBeside(below, -1, true)?.from, at);
    assert.equal(contentsBeside(below, -1, false), null);
    assert.equal(contentsBeside(below, 1, true), null);
    const above = EditorState.create({ doc: d, selection: TextSelection.create(d, at - 1) });
    assert.equal(contentsBeside(above, 1, true)?.from, at);
    const selected = above.apply(above.tr.setSelection(NodeSelection.create(d, at)));
    assert.equal(selectedContents(selected)?.pos, at);
  });

  it('says, selected, how to reach its links and its actions', () => {
    assert.equal(contentsSelected(true, '⌘F6'), 'Table of contents selected, press Enter to reach its links, or ⌘F6 to reach its actions');
    assert.equal(contentsSelected(true, null), 'Table of contents selected, press Enter to reach its links');
    assert.equal(contentsSelected(false, 'Ctrl+F6'), 'Table of contents selected, press Ctrl+F6 to reach its actions');
    assert.equal(contentsSelected(false, null), 'Table of contents selected');
  });

  it('names a way on until it is used, and again only after two minutes away from tables of contents', () => {
    const lessons = freshLessons();
    const both = ['links', 'actions'] as const;
    const said = (now: number, offered: readonly ('links' | 'actions')[] = both) => [...hintsToSay(lessons, offered, now)].sort();
    // The first time, both; straight after, neither.
    assert.deepEqual(said(1000), ['actions', 'links']);
    assert.deepEqual(said(2000), []);
    // Two minutes since the last time on one is not yet over; past it, they are named again.
    assert.deepEqual(said(2000 + HINT_AGAIN_MS), []);
    assert.deepEqual(said(2001 + 2 * HINT_AGAIN_MS), ['actions', 'links']);
    // Staying on one keeps the time away from starting.
    stillOnContents(lessons, 3 * HINT_AGAIN_MS);
    assert.deepEqual(said(3 * HINT_AGAIN_MS + HINT_AGAIN_MS), []);
    // Once the bar has been reached, only the links are named again.
    lessons.actions.learned = true;
    assert.deepEqual(said(10 * HINT_AGAIN_MS), ['links']);
    lessons.links.learned = true;
    assert.deepEqual(said(20 * HINT_AGAIN_MS), []);
  });

  it('names only the ways on offered, and a way not offered stays untold', () => {
    const lessons = freshLessons();
    // Where it can't be changed or the page hasn't the keyboard, nothing is offered: nothing named, nothing told.
    assert.deepEqual([...hintsToSay(lessons, [], 0)], []);
    assert.equal(lessons.actions.said, false);
    // No links: only the bar.
    assert.deepEqual([...hintsToSay(lessons, ['actions'], 10)], ['actions']);
    assert.deepEqual([...hintsToSay(lessons, ['links', 'actions'], 20)], ['links']);
  });
});
