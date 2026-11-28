import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  anchoredIds,
  anchorSubtitle,
  anchorTitle,
  followPastedLinks,
  linkCardFace,
  linkedElementId,
  relinkCopies,
} from '../src/anchors.ts';
import { checkBoardDocuments } from '../src/check.ts';
import { artifactClipboardHtml, boardClipboardPayload, boardClipboardCopy, parseArtifactClipboardHtml } from '../src/clipboard.ts';
import { duplicateSelection, linkCardFromPaste, pasteElements } from '../src/edits.ts';
import { artifactAddressOfUrl, artifactAddressParts, elementAnchorId, normalizeImageHref, normalizeLinkHref } from '../src/links.ts';
import { parseBoardContent } from '../src/normalize.ts';
import { MAX_BOARD_ELEMENTS, type BoardContent, type BoardElement, type ContainerElement, type LinkElement, type NoteElement, type TableElement } from '../src/schema.ts';
import { markdownLinkUrls } from '../src/text/inline-markdown.ts';
import { tableFromGrid } from '../src/table.ts';

const BOARD = 'art_board12345678';
const OTHER = 'art_other12345678';

const note = (id: string, text: string): NoteElement => ({ type: 'note', id, x: 0, y: 0, w: 180, h: 180, color: 'yellow', text, tilt: 0 });
const section = (id: string, text: string): ContainerElement => ({ type: 'container', id, x: 0, y: 0, w: 600, h: 400, color: 'white', text }) as ContainerElement;
const card = (id: string, href: string, title?: string): LinkElement => ({ type: 'link', id, x: 0, y: 0, href, ...(title !== undefined ? { title } : {}) });
const content = (elements: BoardElement[]): BoardContent => ({ elements }) as BoardContent;

describe('links to elements of the board', () => {
  it('reads and keeps #element=<id>, artifact places and web links', () => {
    assert.equal(elementAnchorId('#element=e12'), 'e12');
    assert.equal(elementAnchorId('#element=..'), undefined);
    assert.equal(elementAnchorId('#e12'), undefined);
    assert.equal(normalizeLinkHref(' #element=e12 '), '#element=e12');
    assert.equal(normalizeLinkHref(`open-artifact://artifact/${OTHER}#slide-3`), `open-artifact://artifact/${OTHER}#slide-3`);
    assert.equal(normalizeLinkHref(`open-artifact://artifact/${OTHER}#element=a b`), undefined);
    assert.equal(normalizeImageHref('#element=n1'), '#element=n1');
    assert.equal(normalizeLinkHref('javascript:alert(1)'), undefined);
    assert.deepEqual(artifactAddressParts(`open-artifact://artifact/${OTHER}#element=e3`), { artifact: OTHER, place: '#element=e3' });
  });

  it('turns a Shell page URL into the address it stands for, on the Shell only', () => {
    const shell = 'http://127.0.0.1:4800';
    assert.equal(artifactAddressOfUrl(`${shell}/a/${OTHER}`, [shell]), `open-artifact://artifact/${OTHER}`);
    assert.equal(artifactAddressOfUrl(`${shell}/a/${BOARD}#element=e4`, [shell]), `open-artifact://artifact/${BOARD}#element=e4`);
    assert.equal(artifactAddressOfUrl(`${shell}/a/${OTHER}#it's`, [shell]), `open-artifact://artifact/${OTHER}`);
    assert.equal(artifactAddressOfUrl(`https://example.com/a/${OTHER}`, [shell]), undefined);
    assert.equal(artifactAddressOfUrl(`${shell}/a/${OTHER}?x=1`, [shell]), undefined);
    assert.equal(artifactAddressOfUrl(`${shell}/a/not-an-id`, [shell]), undefined);
  });

  it('finds the element of this board a link points at', () => {
    assert.equal(linkedElementId('#element=n1'), 'n1');
    assert.equal(linkedElementId(`open-artifact://artifact/${BOARD}#element=n1`, BOARD), 'n1');
    assert.equal(linkedElementId(`open-artifact://artifact/${OTHER}#element=n1`, BOARD), undefined);
    assert.equal(linkedElementId('https://example.com/#element=n1', BOARD), undefined);
  });

  it('lets text, cards and pictures link to elements, and lists every target', () => {
    assert.deepEqual([...markdownLinkUrls('See [the plan](#element=s1) and [docs](https://example.com)')], ['#element=s1', 'https://example.com']);
    const tableEl: TableElement = { type: 'table', id: 't1', x: 0, y: 0, head: true, color: 'white', ...tableFromGrid([['Step'], ['[Pay](#element=n2)']]) };
    assert.deepEqual(anchoredIds(tableEl), ['n2']);
    assert.deepEqual(anchoredIds(note('n3', '[a](#element=s1) [b](#element=s1)')), ['s1']);
    assert.deepEqual(anchoredIds(card('l1', '#element=n1')), ['n1']);
  });

  it('titles a card by what it points at, live, and by its stored title once that is gone', () => {
    const byId = new Map<string, BoardElement>([
      ['s1', section('s1', 'Payments\nall flows')],
      ['n1', note('n1', '- **Ship** [it](https://x.test)\nlater')],
      ['s2', section('s2', '  ')],
    ]);
    assert.equal(anchorTitle(byId.get('s1')!), 'Payments');
    assert.equal(anchorTitle(byId.get('n1')!), 'Ship it');
    assert.equal(anchorTitle(byId.get('s2')!), 'Untitled section');
    assert.equal(anchorSubtitle(byId.get('s1')), 'Section · On this board');
    assert.deepEqual(linkCardFace(card('l1', '#element=s1', 'Old title'), byId), { title: 'Payments', subtitle: 'Section · On this board', anchored: 's1', gone: false });
    assert.deepEqual(linkCardFace(card('l2', '#element=gone', 'Old title'), byId), { title: 'Old title', subtitle: 'Not on this board', anchored: 'gone', gone: true });
    assert.equal(linkCardFace(card('l3', '#element=gone'), byId).title, 'Missing item');
    assert.equal(linkCardFace(card('l4', `open-artifact://artifact/${OTHER}`, 'Deck'), byId).title, 'Deck');
  });

  it('warns about a link to an element that is not on the board, and one to itself', () => {
    const elements: BoardElement[] = [section('s1', 'A'), card('l1', '#element=s1'), card('l2', '#element=nope'), note('n1', '[me](#element=n1)')];
    const documents = new Map<string, Record<string, unknown>>([['board/meta', { v: 1, title: 'B', order: elements.map((element) => element.id) }]]);
    for (const { id, ...rest } of elements) documents.set(`elements/${id}`, rest);
    const text = JSON.stringify(checkBoardDocuments(documents));
    assert.match(text, /#element=nope, which is not on the board/);
    assert.match(text, /links to itself \(#element=n1\)/);
    assert.doesNotMatch(text, /#element=s1/);
  });

  it('keeps element links when a board file is read', () => {
    const read = parseBoardContent({ elements: [card('l1', '#element=s1'), { type: 'image', id: 'i1', x: 0, y: 0, w: 10, h: 10, src: 'data:image/png;base64,AA==', href: '#element=s1' }] });
    const [first, second] = read.elements;
    assert.equal(first?.type === 'link' ? first.href : undefined, '#element=s1');
    assert.equal(second?.type === 'image' ? second.href : undefined, '#element=s1');
  });
});

describe('copies keep their links pointing where they should', () => {
  const map = new Map([
    ['s1', 's1copy'],
    ['l1', 'l1copy'],
  ]);

  it('points a link at the copy of an element copied with it', () => {
    const [copy] = relinkCopies([card('l1copy', '#element=s1')], map, { from: BOARD, here: BOARD });
    assert.equal((copy as LinkElement).href, '#element=s1copy');
  });

  it('keeps a link to an element left behind: on the same board as it is, on another through the source board', () => {
    const same = relinkCopies([note('n', '[x](#element=keep)')], map, { from: BOARD, here: BOARD })[0] as NoteElement;
    assert.equal(same.text, '[x](#element=keep)');
    const elsewhere = relinkCopies([note('n', '[x](#element=keep)')], map, { from: BOARD, here: OTHER })[0] as NoteElement;
    assert.equal(elsewhere.text, `[x](open-artifact://artifact/${BOARD}#element=keep)`);
    const unknown = relinkCopies([card('c', '#element=keep')], map, {})[0] as LinkElement;
    assert.equal(unknown.href, '#element=keep');
  });

  it('turns a link to the destination board through its address into a plain element link', () => {
    const [copy] = relinkCopies([card('c', `open-artifact://artifact/${OTHER}#element=n9`)], map, { from: BOARD, here: OTHER });
    assert.equal((copy as LinkElement).href, '#element=n9');
  });

  it('moves links to cut elements onto their pasted copies', () => {
    const [kept, untouched] = followPastedLinks([card('l9', '#element=s1'), card('l8', '#element=here')], new Map([['s1', 's1new']]).set('here', 'x')).map((element) => (element as LinkElement).href);
    assert.equal(kept, '#element=s1new');
    assert.equal(untouched, '#element=x');
    const present = followPastedLinks([card('l9', '#element=s1'), section('s1', 'still here')], new Map([['s1', 's1new']]));
    assert.equal((present[0] as LinkElement).href, '#element=s1');
  });

  it('pastes a copy with its links pointing at the pasted elements', () => {
    const board = content([]);
    const result = pasteElements(board, [section('s1', 'A'), card('l1', '#element=s1')], 0, 0);
    const pasted = result.content.elements;
    const copySection = pasted.find((element) => element.type === 'container');
    const copyCard = pasted.find((element) => element.type === 'link') as LinkElement | undefined;
    assert.ok(copySection && copyCard);
    assert.notEqual(copySection.id, 's1');
    assert.equal(copyCard.href, `#element=${copySection.id}`);
  });

  it('points links to a copied arrow at the arrow’s copy, in a duplicate and in a paste', () => {
    const arrow: BoardElement = { type: 'arrow', id: 'arr', from: 'a', to: 'b' } as BoardElement;
    const source = [note('a', 'A'), note('b', 'B'), arrow, card('l1', '#element=arr'), note('n1', '[flow](#element=arr) [start](#element=a)')];
    const ids = new Set(source.map((element) => element.id));
    for (const added of [
      duplicateSelection(content(source), ids).content.elements.slice(source.length),
      pasteElements(content([]), source, 0, 0, false, { from: BOARD, here: OTHER }).content.elements,
    ]) {
      const copyArrow = added.find((element) => element.type === 'arrow');
      const copyA = added.find((element) => element.type === 'note' && element.text === 'A');
      assert.ok(copyArrow && copyA);
      assert.notEqual(copyArrow.id, 'arr');
      assert.equal((added.find((element) => element.type === 'link') as LinkElement).href, `#element=${copyArrow.id}`);
      assert.equal((added.find((element) => element.type === 'note' && element.text.startsWith('[flow]')) as NoteElement).text, `[flow](#element=${copyArrow.id}) [start](#element=${copyA.id})`);
    }
  });

  it('moves the board’s links to a cut arrow onto its pasted copy', () => {
    const arrow: BoardElement = { type: 'arrow', id: 'arr', from: 'a', to: 'b' } as BoardElement;
    const board = content([card('l1', '#element=arr')]);
    const result = pasteElements(board, [note('a', 'A'), note('b', 'B'), arrow], 0, 0, true, { from: BOARD, here: BOARD });
    const copyArrow = result.content.elements.find((element) => element.type === 'arrow');
    assert.ok(copyArrow);
    assert.equal((result.content.elements.find((element) => element.id === 'l1') as LinkElement).href, `#element=${copyArrow.id}`);
  });

  it('leaves a link to an element whose copy did not fit on the board pointing at the original', () => {
    const fill = Array.from({ length: MAX_BOARD_ELEMENTS - 1 }, (_, index) => note(`f${index}`, ''));
    const result = pasteElements(content(fill), [card('l1', '#element=s1'), section('s1', 'A')], 0, 0);
    const added = result.content.elements.slice(fill.length);
    assert.equal(added.length, 1);
    assert.equal((added[0] as LinkElement).href, '#element=s1');
  });

  it('carries the source board in the clipboard', () => {
    const copy = boardClipboardCopy([note('n1', 'hi')], [note('n1', 'hi')]);
    const parsed = parseArtifactClipboardHtml(artifactClipboardHtml(boardClipboardPayload(copy, BOARD), copy.text));
    assert.equal(parsed?.from, BOARD);
    const bad = parseArtifactClipboardHtml(artifactClipboardHtml(boardClipboardPayload(copy, 'not an id'), copy.text));
    assert.equal(bad?.from, undefined);
  });

  it('makes a card from a pasted element link, with the title given', () => {
    const made = linkCardFromPaste(' #element=s1 ', [], { x: 0, y: 0 }, 24, undefined, 'Payments');
    assert.equal(made?.href, '#element=s1');
    assert.equal(made?.title, 'Payments');
    assert.equal(linkCardFromPaste('#nothing', [], { x: 0, y: 0 }, 24), undefined);
  });
});
