import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_NOTE_GROUPS,
  enterNoteGroup,
  expandNotesToGroups,
  freshGroupIds,
  gatherInStack,
  groupRefusalMessage,
  noteGroupIndex,
  normalizeCanvas,
  planGroup,
  planUngroup,
  selectionHasGroup,
  withNoteGroups,
  regroupNotes,
  restackNotes,
  stepNotes,
  freshGroupId,
  addNoteCopies,
  type CanvasNote,
  type GroupedItem,
} from '../src/index.ts';

// a, b in g1; g1 and c in g2; d alone.
const ITEMS: GroupedItem[] = [
  { id: 'a', groups: ['g1', 'g2'] },
  { id: 'b', groups: ['g1', 'g2'] },
  { id: 'c', groups: ['g2'] },
  { id: 'd' },
];

describe('note groups', () => {
  it('normalizes stored groups: unique valid ids, at most the nesting limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => `g${i}`);
    const canvas = normalizeCanvas({
      notes: {
        a: { x: 0, y: 0, text: '', groups: ['g1', 'g1', 'bad id', 3, 'g2'] },
        b: { x: 0, y: 0, text: '', groups: many },
        c: { x: 0, y: 0, text: '', groups: [] },
        d: { x: 0, y: 0, text: '', groups: 'g1' },
      },
    });
    assert.deepEqual(canvas.notes.a!.groups, ['g1', 'g2']);
    assert.equal(canvas.notes.b!.groups!.length, MAX_NOTE_GROUPS);
    assert.equal('groups' in canvas.notes.c!, false);
    assert.equal('groups' in canvas.notes.d!, false);
  });

  it('indexes members and orders each chain smallest group first', () => {
    const index = noteGroupIndex([
      { id: 'a', groups: ['g2', 'g1'] },
      { id: 'b', groups: ['g1', 'g2'] },
      { id: 'c', groups: ['g2', 'lonely'] },
      { id: 'd', groups: ['twin'] },
      { id: 'e', groups: ['twin', 'twin2'] },
      { id: 'f', groups: ['twin2'] },
    ]);
    assert.deepEqual(index.members.get('g1'), ['a', 'b']);
    assert.deepEqual(index.members.get('g2'), ['a', 'b', 'c']);
    assert.equal(index.members.has('lonely'), false, 'a group of one is ignored');
    assert.deepEqual(index.chain.get('a'), ['g1', 'g2']);
    assert.deepEqual(index.chain.get('c'), ['g2']);
  });

  it('drops a group with the same members as an earlier one', () => {
    const index = noteGroupIndex([
      { id: 'a', groups: ['x', 'y'] },
      { id: 'b', groups: ['x', 'y'] },
    ]);
    assert.deepEqual([...index.members.keys()], ['x']);
  });

  it('picking a grouped note selects its outermost group', () => {
    assert.deepEqual(new Set(expandNotesToGroups(ITEMS, ['a'])), new Set(['a', 'b', 'c']));
    assert.deepEqual(expandNotesToGroups(ITEMS, ['d']), ['d']);
  });

  it('double-click steps one group in, then to the note', () => {
    const outer = expandNotesToGroups(ITEMS, ['a']);
    const inner = enterNoteGroup(ITEMS, 'a', outer);
    assert.deepEqual(new Set(inner), new Set(['a', 'b']));
    assert.deepEqual(enterNoteGroup(ITEMS, 'a', inner!), ['a']);
    assert.equal(enterNoteGroup(ITEMS, 'a', ['a']), null);
    assert.equal(enterNoteGroup(ITEMS, 'd', ['d']), null);
  });

  it('clicking inside an entered group stays inside it', () => {
    // g2 is open (only a, b selected): picking c does not reselect all of g2.
    assert.deepEqual(expandNotesToGroups(ITEMS, ['c'], ['a', 'b']), ['c']);
  });

  it('groups loose notes and nests groups', () => {
    const loose = planGroup([{ id: 'x' }, { id: 'y' }], ['x', 'y'], 'n');
    assert.ok(loose instanceof Map);
    assert.deepEqual(loose.get('x'), ['n']);

    const nested = planGroup(ITEMS, ['a', 'b', 'c', 'd'], 'n');
    assert.ok(nested instanceof Map);
    assert.deepEqual(nested.get('a'), ['g1', 'g2', 'n']);
    assert.deepEqual(nested.get('d'), ['n']);
  });

  it('groups inside an entered group nest under it', () => {
    // a and c selected inside g2: the new group sits between their own groups and g2.
    const plan = planGroup(ITEMS, ['c', 'd'], 'n');
    assert.ok(plan instanceof Map);
    const inside = planGroup([...ITEMS, { id: 'e', groups: ['g2'] }], ['c', 'e'], 'n');
    assert.ok(inside instanceof Map);
    assert.deepEqual(inside.get('c'), ['n', 'g2']);
    assert.deepEqual(inside.get('e'), ['n', 'g2']);
  });

  it('refuses one note, one group and too deep a nesting', () => {
    assert.deepEqual(planGroup(ITEMS, ['d'], 'n'), { refused: 'few' });
    assert.deepEqual(planGroup(ITEMS, ['a', 'b', 'c'], 'n'), { refused: 'already' });
    // Note k is in groups l(k-1) .. l7, so l0 = {n0, n1}, l1 = {n0, n1, n2} and so on: n0 is 8 deep.
    const nested: GroupedItem[] = Array.from({ length: MAX_NOTE_GROUPS + 1 }, (_, k) => ({
      id: `n${k}`,
      groups: Array.from({ length: MAX_NOTE_GROUPS }, (_, i) => `l${i}`).slice(Math.max(0, k - 1)),
    }));
    assert.equal(noteGroupIndex(nested).chain.get('n0')!.length, MAX_NOTE_GROUPS);
    const all = [...nested.map((item) => item.id), 'loose'];
    assert.deepEqual(planGroup([...nested, { id: 'loose' }], all, 'n'), { refused: 'deep' });
    assert.match(groupRefusalMessage('deep'), new RegExp(`${MAX_NOTE_GROUPS} levels`));
  });

  it('ungroups the outermost whole groups selected', () => {
    const plan = planUngroup(ITEMS, ['a', 'b', 'c']);
    assert.ok(plan instanceof Map);
    assert.deepEqual(plan.get('a'), ['g1']);
    assert.deepEqual(plan.get('c'), []);
    assert.deepEqual(planUngroup(ITEMS, ['d']), { refused: 'nothing' });
    assert.equal(selectionHasGroup(ITEMS, ['a', 'b', 'c']), true);
    assert.equal(selectionHasGroup(ITEMS, ['d']), false);
  });

  it('copies get fresh group ids and lose dead ones', () => {
    let n = 0;
    const fresh = freshGroupIds([{ id: 'a', groups: ['g1', 'dead'] }, { id: 'b', groups: ['g1'] }], () => `f${++n}`);
    assert.deepEqual(fresh.get('a'), ['f1']);
    assert.deepEqual(fresh.get('b'), ['f1']);
  });

  it('sets or clears the groups key', () => {
    assert.deepEqual(withNoteGroups({ x: 0, y: 0, text: '', groups: ['g'] }, []), { x: 0, y: 0, text: '' });
    assert.deepEqual(withNoteGroups<CanvasNote>({ x: 0, y: 0, text: '' }, ['g']).groups, ['g']);
  });

  it('gathers new group members next to the topmost one on the same page', () => {
    const page = (id: string) => (id === 'p2' ? 'two' : 'one');
    assert.deepEqual(gatherInStack(['a', 'x', 'b', 'p2', 'y'], new Set(['a', 'b']), page), ['x', 'a', 'b', 'p2', 'y']);
    assert.deepEqual(gatherInStack(['a', 'b'], new Set(['z']), page), ['a', 'b']);
  });
});

describe('note group edits on a canvas', () => {
  const canvas = () =>
    normalizeCanvas({
      notes: {
        a: { x: 0, y: 0, text: 'a' },
        x: { x: 0, y: 0, text: 'x' },
        b: { x: 0, y: 0, text: 'b' },
        c: { x: 0, y: 0, text: 'c' },
      },
    });

  it('groups, gathers the stack, and ungroups', () => {
    const result = regroupNotes(canvas(), ['a', 'b'], 'group', 'g1');
    assert.ok('canvas' in result);
    const grouped = result.canvas;
    assert.deepEqual(Object.keys(grouped.notes), ['x', 'a', 'b', 'c']);
    assert.deepEqual(grouped.notes.a!.groups, ['g1']);
    assert.equal('groups' in grouped.notes.x!, false);

    const ungrouped = regroupNotes(grouped, ['a', 'b'], 'ungroup', 'unused');
    assert.ok('canvas' in ungrouped);
    assert.equal('groups' in ungrouped.canvas.notes.a!, false);
    assert.deepEqual(regroupNotes(canvas(), ['a'], 'group', 'g1'), { refused: 'few' });
  });

  it('copies of a group form a new group of their own', () => {
    const result = regroupNotes(canvas(), ['a', 'b'], 'group', 'g1');
    assert.ok('canvas' in result);
    const grouped = result.canvas;
    assert.equal(freshGroupId(grouped), 'g2');
    const { canvas: next, ids } = addNoteCopies(grouped, [grouped.notes.a!, grouped.notes.b!, grouped.notes.c!], (note) => ({ ...note, x: note.x + 24 }));
    assert.equal(ids.length, 3);
    assert.deepEqual(next.notes[ids[0]!]!.groups, ['g2']);
    assert.deepEqual(next.notes[ids[1]!]!.groups, ['g2']);
    assert.equal('groups' in next.notes[ids[2]!]!, false);
    assert.equal(next.notes[ids[0]!]!.x, 24);
    // A lone copy of a grouped note is not in any group.
    const single = addNoteCopies(grouped, [grouped.notes.a!], (note) => note);
    assert.equal('groups' in single.canvas.notes[single.ids[0]!]!, false);
  });
});

describe('restackNotes', () => {
  const canvas = normalizeCanvas({ notes: { a: { x: 0, y: 0, text: '' }, b: { x: 0, y: 0, text: '' }, c: { x: 0, y: 0, text: '' } } });

  it('brings notes to the front or sends them to the back', () => {
    assert.deepEqual(Object.keys(restackNotes(canvas, ['a', 'b'], 'front').notes), ['c', 'a', 'b']);
    assert.deepEqual(Object.keys(restackNotes(canvas, ['c'], 'back').notes), ['c', 'a', 'b']);
  });

  it('returns the same canvas when nothing moves', () => {
    assert.equal(restackNotes(canvas, ['c'], 'front'), canvas);
    assert.equal(restackNotes(canvas, ['zz'], 'back'), canvas);
  });
});

describe('stepNotes', () => {
  const note = (extra: Record<string, unknown> = {}) => ({ x: 0, y: 0, text: '', ...extra });
  const canvas = normalizeCanvas({ notes: { a: note(), b: note(), c: note(), d: note() } });
  const order = (next: ReturnType<typeof stepNotes>) => Object.keys(next.notes).join('');

  it('steps one note past its neighbour', () => {
    assert.equal(order(stepNotes(canvas, ['a'], 'forward')), 'bacd');
    assert.equal(order(stepNotes(canvas, ['c'], 'backward')), 'acbd');
  });

  it('keeps a selection together and steps past one neighbour', () => {
    assert.equal(order(stepNotes(canvas, ['a', 'b'], 'forward')), 'cabd');
    assert.equal(order(stepNotes(canvas, ['c', 'd'], 'backward')), 'acdb');
  });

  it('steps past a whole group', () => {
    const grouped = normalizeCanvas({ notes: { a: note(), b: note({ groups: ['g'] }), c: note({ groups: ['g'] }), d: note() } });
    assert.equal(order(stepNotes(grouped, ['a'], 'forward')), 'bcad');
    assert.equal(order(stepNotes(grouped, ['d'], 'backward')), 'adbc');
  });

  it('leaves locked notes and other pages alone', () => {
    const locked = normalizeCanvas({ notes: { a: note({ locked: true }), b: note(), c: note() } });
    assert.equal(stepNotes(locked, ['a'], 'forward'), locked);
    const paged = normalizeCanvas({ pages: [{ id: 'p1', title: 'One' }, { id: 'p2', title: 'Two' }], notes: { a: note({ page: 'p1' }), b: note({ page: 'p2' }), c: note({ page: 'p1' }) } });
    assert.equal(order(stepNotes(paged, ['a'], 'forward')), 'bca');
  });

  it('returns the same canvas at the end', () => {
    assert.equal(stepNotes(canvas, ['d'], 'forward'), canvas);
    assert.equal(stepNotes(canvas, ['a'], 'backward'), canvas);
    assert.equal(stepNotes(canvas, ['zz'], 'forward'), canvas);
  });
});
