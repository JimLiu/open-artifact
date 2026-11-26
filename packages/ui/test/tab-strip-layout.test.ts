import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { closeGroups, dragOrder, fitTabs, moveTo, pickedPlace, sameFit, type FitInput } from '../src/tab-strip-layout.ts';

/** A row of a fixed home tab (60px) and `count` tabs of 100px each, 4px apart, ▾ 32px with its space. */
function row(count: number, avail: number, init: Partial<FitInput> = {}): FitInput {
  const ids = ['home', ...Array.from({ length: count }, (_, i) => `t${i}`)];
  return {
    ids,
    fixed: ids.map((id) => id === 'home'),
    widths: ids.map((id) => (id === 'home' ? 60 : 100)),
    needs: ids.map(() => 0),
    gap: 4,
    avail,
    more: 32,
    activeId: 'home',
    start: 0,
    ...init,
  };
}

describe('fitTabs', () => {
  it('shows every tab when they fit, and lists none', () => {
    const fit = fitTabs(row(3, 1000));
    assert.deepEqual([...fit.hidden], []);
    assert.equal(fit.start, 0);
  });

  it('lists the tabs past the room, never the fixed one', () => {
    // 60 + 4 for home, ▾ takes 32: 400 - 32 - 64 = 304 holds two tabs of 100 (204) and not three (308).
    const fit = fitTabs(row(6, 400));
    assert.deepEqual([...fit.hidden], ['t2', 't3', 't4', 't5']);
    assert.equal(fit.hidden.has('home'), false);
  });

  it('keeps the tab in front in sight, moving the first tab shown up to it', () => {
    const fit = fitTabs(row(6, 400, { activeId: 't4' }));
    assert.equal(fit.hidden.has('t4'), false);
    assert.deepEqual([...fit.hidden], ['t0', 't1', 't2', 't5']);
    assert.equal(fit.start, 3);
  });

  it('keeps the first tab shown while the tab in front stays in sight', () => {
    const fit = fitTabs(row(6, 400, { activeId: 't3', start: 3 }));
    assert.equal(fit.start, 3);
    assert.deepEqual([...fit.hidden], ['t0', 't1', 't2', 't5']);
  });

  it('brings the tabs before back when the last ones close', () => {
    // Was showing t3 and t4 of five; t4 is now the last: t2 comes back only if it fits, so start stays at 3.
    const fit = fitTabs(row(5, 400, { activeId: 't4', start: 3 }));
    assert.deepEqual([...fit.hidden], ['t0', 't1', 't2']);
    // With room for three, t2 comes back into the row.
    const wider = fitTabs(row(5, 500, { activeId: 't4', start: 3 }));
    assert.equal(wider.start, 2);
    assert.deepEqual([...wider.hidden], ['t0', 't1']);
  });

  it('gives what is left over to the titles that are cut, the ones that need least first', () => {
    // Three tabs (372 in all) do not fit in 360: 360 - 32 for ▾ - 64 for home = 264 holds two (204), 60 is left over.
    const input = row(3, 360);
    input.needs = [0, 30, 200, 0];
    const fit = fitTabs(input);
    assert.deepEqual([...fit.hidden], ['t2']);
    assert.equal(fit.stretch.get('t0'), 30);
    assert.equal(fit.stretch.get('t1'), 30);
    assert.deepEqual([...fit.clipped], ['t1']);
  });

  it('marks a cut title when every tab fits but the title is longer than its cap', () => {
    const input = row(2, 1000);
    input.needs = [0, 0, 40];
    const fit = fitTabs(input);
    assert.deepEqual([...fit.clipped], ['t1']);
    assert.equal(fit.stretch.size, 0);
  });

  it('compares fits by what they show', () => {
    assert.equal(sameFit(fitTabs(row(6, 400)), fitTabs(row(6, 400))), true);
    assert.equal(sameFit(fitTabs(row(6, 400)), fitTabs(row(6, 1000))), false);
  });
});

describe('moveTo', () => {
  it('moves an id to an index of the order', () => {
    assert.deepEqual(moveTo(['a', 'b', 'c', 'd'], 'a', 2), ['b', 'c', 'a', 'd']);
    assert.deepEqual(moveTo(['a', 'b', 'c', 'd'], 'd', 0), ['d', 'a', 'b', 'c']);
    assert.deepEqual(moveTo(['a', 'b'], 'a', 9), ['b', 'a']);
  });
});

describe('dragOrder', () => {
  const order = ['home', 'a', 'b', 'c'];
  const middles: Record<string, number> = { a: 100, b: 200, c: 300 };
  const middleOf = (id: string) => middles[id];

  it('puts the dragged tab after every tab whose middle it passed', () => {
    assert.deepEqual(dragOrder(order, ['a', 'b', 'c'], 'a', 250, middleOf), ['home', 'b', 'a', 'c']);
    assert.deepEqual(dragOrder(order, ['a', 'b', 'c'], 'a', 350, middleOf), ['home', 'b', 'c', 'a']);
    assert.deepEqual(dragOrder(order, ['a', 'b', 'c'], 'c', 50, middleOf), ['home', 'c', 'a', 'b']);
  });

  it('leaves the order alone when the tab has not passed a middle', () => {
    assert.deepEqual(dragOrder(order, ['a', 'b', 'c'], 'b', 190, middleOf), order);
  });

  it('counts from the first tab shown when the ones before are in the list', () => {
    const long = ['home', 'x', 'a', 'b', 'c'];
    assert.deepEqual(dragOrder(long, ['a', 'b', 'c'], 'c', 50, middleOf), ['home', 'x', 'c', 'a', 'b']);
  });
});

describe('pickedPlace', () => {
  it('puts a tab from the list next to the last tab shown', () => {
    // Shown: home, a, b; listed: c, d. Picking d puts it after b.
    assert.equal(pickedPlace(['home', 'a', 'b', 'c', 'd'], 'd', 'b'), 3);
    // A listed tab before the row (when the row starts later) goes to the last tab's place.
    assert.equal(pickedPlace(['home', 'x', 'a', 'b'], 'x', 'b'), 3);
  });

  it('says nothing to move when the tab is already there', () => {
    assert.equal(pickedPlace(['home', 'a', 'b', 'c'], 'c', 'b'), null);
    assert.equal(pickedPlace(['home', 'a'], 'a', undefined), null);
  });
});

describe('closeGroups', () => {
  it('names the others, the ones to the right and all, closable ones only', () => {
    const closable = (id: string) => id !== 'home';
    assert.deepEqual(closeGroups(['home', 'a', 'b', 'c'], closable, 'b'), { others: ['a', 'c'], right: ['c'], all: ['a', 'b', 'c'] });
    assert.deepEqual(closeGroups(['home', 'a'], closable, 'a'), { others: [], right: [], all: ['a'] });
  });
});
