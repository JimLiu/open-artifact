import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NO_SELECTION,
  crossFileActionLabel,
  elementGroupsOf,
  inspectorRoute,
  mergedValue,
  sharedPaintRoles,
  paintKindOf,
  paintProperty,
  paintRoles,
  selectionCounts,
  selectionFrom,
  toggleBoard,
  toggleElement,
  toggleNotes,
  withBoardElements,
  withObjects,
  type ElementSelection,
  type Selection,
} from '../src/lib/selection.ts';

const el = (tid: number): ElementSelection => ({ tid, path: [tid], instance: 0 });
const fragments = new Set(['frag.dc.html', 'frag2.dc.html']);
const isFragment = (board: string) => fragments.has(board);

describe('selection shapes', () => {
  it('keeps the simple shapes whenever they fit', () => {
    assert.deepEqual(selectionFrom({ boards: [], notes: [], elements: [] }), NO_SELECTION);
    assert.deepEqual(selectionFrom({ boards: ['a'], notes: ['n'], elements: [] }), { kind: 'objects', boards: ['a'], notes: ['n'] });
    assert.deepEqual(selectionFrom({ boards: [], notes: [], elements: [{ board: 'a', items: [el(1)] }, { board: 'a', items: [el(2), el(1)] }] }), {
      kind: 'elements',
      board: 'a',
      items: [el(1), el(2)],
    });
  });

  it('is mixed for elements of two artboards, or elements with objects', () => {
    const two = selectionFrom({ boards: [], notes: [], elements: [{ board: 'a', items: [el(1)] }, { board: 'b', items: [el(2)] }] });
    assert.equal(two.kind, 'mixed');
    const withNote = selectionFrom({ boards: [], notes: ['n'], elements: [{ board: 'a', items: [el(1)] }] });
    assert.equal(withNote.kind, 'mixed');
    assert.deepEqual(withNote.kind === 'mixed' && withNote.primary, { kind: 'element', board: 'a', item: el(1) });
  });

  it('drops the elements of a selected artboard and empty groups', () => {
    const selection = selectionFrom({ boards: ['a'], notes: [], elements: [{ board: 'a', items: [el(1)] }, { board: 'b', items: [] }] });
    assert.deepEqual(selection, { kind: 'objects', boards: ['a'], notes: [] });
  });
});

describe('shift presses', () => {
  const elements: Selection = { kind: 'elements', board: 'frag.dc.html', items: [el(1)] };

  it('adds an element of another artboard', () => {
    const next = toggleElement(elements, 'frag2.dc.html', el(5), isFragment);
    assert.equal(next.kind, 'mixed');
    assert.deepEqual(elementGroupsOf(next).map((group) => group.board), ['frag.dc.html', 'frag2.dc.html']);
    assert.deepEqual(next.kind === 'mixed' && next.primary, { kind: 'element', board: 'frag2.dc.html', item: el(5) });
  });

  it('takes an element out, back to the simple shape', () => {
    const mixed = toggleElement(elements, 'frag2.dc.html', el(5), isFragment);
    assert.deepEqual(toggleElement(mixed, 'frag2.dc.html', el(5), isFragment), elements);
  });

  it('selects the artboard instead while a full artboard is selected, or the artboard itself', () => {
    const withFull = toggleBoard(elements, 'full.dc.html');
    assert.equal(withFull.kind, 'mixed');
    const promoted = toggleElement(withFull, 'frag2.dc.html', el(5), isFragment);
    assert.deepEqual(promoted.kind === 'mixed' && promoted.boards, ['full.dc.html', 'frag2.dc.html']);
    assert.deepEqual(elementGroupsOf(promoted).map((group) => group.board), ['frag.dc.html']);
    const own = toggleElement({ kind: 'objects', boards: ['frag.dc.html'], notes: [] }, 'frag.dc.html', el(2), isFragment);
    assert.deepEqual(own, { kind: 'objects', boards: ['frag.dc.html'], notes: [] });
  });

  it('mixes an element with a selected fragment artboard', () => {
    const next = toggleElement({ kind: 'objects', boards: ['frag.dc.html'], notes: [] }, 'frag2.dc.html', el(3), isFragment);
    assert.equal(next.kind, 'mixed');
  });

  it('adding an artboard replaces its own selected elements', () => {
    const next = toggleBoard(elements, 'frag.dc.html');
    assert.deepEqual(next, { kind: 'objects', boards: ['frag.dc.html'], notes: [] });
  });

  it('notes join and leave with their group', () => {
    const next = toggleNotes(elements, ['n1', 'n2'], false);
    assert.deepEqual(next.kind === 'mixed' && next.notes, ['n1', 'n2']);
    assert.deepEqual(toggleNotes(next, ['n1', 'n2'], true), elements);
  });

  it('a marquee with Shift keeps the elements, one inside an artboard keeps the rest', () => {
    const next = withObjects(elements, ['b'], ['n']);
    assert.equal(next.kind, 'mixed');
    assert.equal(selectionCounts(next).elements, 1);
    const replaced = withBoardElements(next, 'frag.dc.html', [el(7), el(8)]);
    assert.deepEqual(selectionCounts(replaced), { elements: 2, elementBoards: 1, objects: 2 });
  });
});

describe('what the panels show', () => {
  it('routes the properties panel by the members', () => {
    assert.equal(inspectorRoute(NO_SELECTION), 'none');
    assert.equal(inspectorRoute({ kind: 'objects', boards: ['a'], notes: [] }), 'board');
    assert.equal(inspectorRoute({ kind: 'objects', boards: [], notes: ['n'] }), 'note');
    assert.equal(inspectorRoute({ kind: 'objects', boards: ['a', 'b'], notes: [] }), 'boards');
    assert.equal(inspectorRoute({ kind: 'objects', boards: ['a'], notes: ['n'] }), 'mixed');
    assert.equal(inspectorRoute({ kind: 'elements', board: 'a', items: [el(1)] }), 'elements');
    assert.equal(inspectorRoute(toggleNotes({ kind: 'elements', board: 'a', items: [el(1)] }, ['n'], false)), 'mixed');
  });

  it('labels Duplicate and Delete by what they reach', () => {
    assert.equal(crossFileActionLabel('Duplicate', { elements: 3, elementBoards: 2, objects: 1 }, '⌘D'), 'Duplicate 3 elements on 2 artboards and 1 canvas object (⌘D)');
    assert.equal(crossFileActionLabel('Delete', { elements: 1, elementBoards: 1, objects: 2 }), 'Delete 1 element and 2 canvas objects');
    assert.equal(crossFileActionLabel('Delete', { elements: 2, elementBoards: 2, objects: 0 }), 'Delete 2 elements on 2 artboards');
  });
});

describe('colors by kind across files', () => {
  it('writes each role to the property its kind takes', () => {
    assert.equal(paintProperty('text', 'text'), 'color');
    assert.equal(paintProperty('box', 'text'), null);
    assert.equal(paintProperty('box', 'fill'), 'background-color');
    assert.equal(paintProperty('shape', 'fill'), 'fill');
    assert.equal(paintProperty('shape', 'stroke'), 'stroke');
    assert.equal(paintProperty('box', 'stroke'), 'border-color');
  });

  it('never fills a line or gives it a border', () => {
    assert.equal(paintProperty('line', 'fill'), null);
    assert.equal(paintProperty('line', 'stroke'), 'stroke');
    assert.equal(paintProperty('text', 'fill'), null);
  });

  it('offers the roles some member takes', () => {
    assert.deepEqual(paintRoles(['line']), ['stroke']);
    assert.deepEqual(paintRoles(['text', 'line']), ['text', 'stroke']);
    assert.deepEqual(paintRoles(['box', 'text']), ['text', 'fill', 'stroke']);
    assert.equal(paintKindOf('other', 'ul'), 'box');
    assert.equal(paintKindOf('shape', 'div'), 'box');
    assert.equal(paintKindOf('shape', 'svg'), 'shape');
    assert.equal(paintKindOf('line', 'path'), 'line');
  });
});

describe('merged rows', () => {
  it('shows the one value, or Mixed', () => {
    assert.equal(mergedValue(['#fff', '#fff']), '#fff');
    assert.equal(mergedValue(['#fff', '#000']), 'Mixed');
    assert.equal(mergedValue([]), '');
  });

  it('lists only the colors every member takes', () => {
    assert.deepEqual(sharedPaintRoles(['box', 'box']), ['fill', 'stroke']);
    assert.deepEqual(sharedPaintRoles(['box', 'line']), ['stroke']);
    assert.deepEqual(sharedPaintRoles(['text', 'box']), []);
    assert.deepEqual(sharedPaintRoles([]), []);
  });
});
