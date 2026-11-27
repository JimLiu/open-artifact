import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDashboardPresenceContext,
  choosePresenceContext,
  collectPagePresenceHooks,
  decodeLocationFragment,
  formatPresenceHook,
  isSafePresenceId,
  parseDataset,
  sanitizePresenceContext,
  sanitizePresenceLabel,
  sanitizeViewArea,
  validateDataViewContext,
} from '../src/index.ts';
import type { Dataset } from '../src/index.ts';

const hidden = (code: number): string => String.fromCodePoint(code);

describe('presence', () => {
  it('accepts safe ids only', () => {
    assert.equal(isSafePresenceId('sales-chart'), true);
    assert.equal(isSafePresenceId('a%20b'), true);
    assert.equal(isSafePresenceId('a b'), false);
    assert.equal(isSafePresenceId('%3Cscript%3E'), false);
    assert.equal(isSafePresenceId('%E2%80%8B'), false);
    assert.equal(isSafePresenceId('%ZZ'), false);
  });

  it('cleans labels: hidden and markup characters out, spaces folded, long ones cut', () => {
    assert.equal(sanitizePresenceLabel(`  Revenue${hidden(0x200b)}  by\n\nregion <b> `), 'Revenue by region b');
    assert.equal(sanitizePresenceLabel(`${hidden(0xfe0f)} `), '');
    const long = sanitizePresenceLabel('x'.repeat(100));
    assert.equal([...long].length, 60);
    assert.ok(long.endsWith('…'));
  });

  it('keeps a full and a lean context', () => {
    const { full, lean } = sanitizePresenceContext({
      mode: 'page',
      dirty: false,
      count: 1.5,
      selected: ['a', 'b c'],
      failures: [{ id: 'sales', label: 'Sales <x>' }, { id: 'bad id' }],
      field: { text: 'Region name' },
      area: { x: 1, y: 2 },
      edits: 4,
      'bad key': 1,
      constructor: 'x',
    });
    assert.deepEqual(full, {
      mode: 'page',
      dirty: false,
      count: null,
      selected: ['a'],
      failures: [{ id: 'sales', label: 'Sales x' }],
      field: 'Region name',
      area: { x: 1, y: 2 },
    });
    assert.deepEqual(lean, { mode: 'page', dirty: false, count: null, selected: ['a'], area: { x: 1, y: 2 } });
    assert.deepEqual(choosePresenceContext({ full, lean }, 2).view, { ...full, edits: 2 });
    const big = { full: { ...full, field: 'x'.repeat(4000) }, lean };
    assert.deepEqual(choosePresenceContext(big, 0).view, lean);
  });

  it('builds what the dashboard tells the agent', () => {
    const sales = parseDataset('sales', { title: 'Sales', source: { kind: 'file', url: '', name: 'a.csv' } }) as Dataset;
    const costs = parseDataset('costs', { title: '', source: { kind: 'file', url: '', name: 'b.csv' } }) as Dataset;
    const hooks = collectPagePresenceHooks([{ name: 'index.html', text: '<div id="top"><span data-field=region id=\'kpi\'></span></div>' }]);
    assert.deepEqual([...hooks.ids], ['top', 'kpi']);
    assert.deepEqual([...hooks.fields], ['region']);
    const context = buildDashboardPresenceContext(
      { datasets: { sales: { status: 'ok' }, costs: { status: 'error' }, gone: { status: 'error' } } },
      hooks,
      new Map([
        ['sales', sales],
        ['costs', costs],
      ]),
      {
        data: false,
        dirty: true,
        place: 'top',
        pointed: { at: ['nope', 'kpi'], sources: ['sales', 'other'], field: 'sales__region' },
        shown: null,
        filters: ['region'],
        form: 'dashboard',
        draft: null,
      },
    );
    assert.deepEqual(context, {
      mode: 'page',
      dirty: true,
      selected: ['sales'],
      place: 'top',
      at: 'kpi',
      field: 'region',
      filters: ['region'],
      form: 'dashboard',
      failed: 1,
      failures: [{ id: 'costs', label: 'costs' }],
    });
  });

  it('says which draft is shown and where changes go', () => {
    const hooks = collectPagePresenceHooks([]);
    const options = { data: false, dirty: false, place: '', pointed: null, shown: null, filters: [], form: null };
    const onDraft = buildDashboardPresenceContext(null, hooks, new Map(), {
      ...options,
      draft: 'abc',
      showing: 'drafts/abc',
      writeTo: 'drafts/abc',
    });
    assert.equal(onDraft.showing, 'drafts/abc');
    assert.equal(onDraft.writeTo, 'drafts/abc');
    assert.equal(onDraft.draft, 'abc');
    assert.deepEqual(sanitizePresenceContext(onDraft).full.writeTo, 'drafts/abc');
    const onDashboard = buildDashboardPresenceContext(null, hooks, new Map(), { ...options, draft: null });
    assert.equal(Object.hasOwn(onDashboard, 'showing'), false);
    assert.equal(Object.hasOwn(onDashboard, 'writeTo'), false);
  });

  it('formats hooks and fragments', () => {
    assert.equal(formatPresenceHook('kpi-1'), 'kpi-1');
    assert.deepEqual(formatPresenceHook('Total revenue'), { text: 'Total revenue' });
    assert.equal(formatPresenceHook('x'.repeat(61) + ' '), null);
    assert.equal(formatPresenceHook(undefined), null);
    assert.equal(decodeLocationFragment('#a%20b'), 'a b');
    assert.equal(decodeLocationFragment('#%ZZ'), '%ZZ');
  });
});

describe('view context', () => {
  it('reads a view area', () => {
    assert.deepEqual(sanitizeViewArea({ x: -5, y: 0, w: 10, h: 1, z: 1 }), { x: -5, y: 0, w: 10, h: 1 });
    assert.equal(sanitizeViewArea({ x: 0, y: 0, w: 0, h: 1 }), undefined);
    assert.equal(sanitizeViewArea({ x: 2e9, y: 0, w: 1, h: 1 }), undefined);
    assert.equal(sanitizeViewArea(null), undefined);
  });

  it('validates a received context', () => {
    assert.deepEqual(validateDataViewContext({ mode: 'data', selected: ['sales'], edits: 3, junk: '<x>' }), {
      mode: 'data',
      selected: ['sales'],
      junk: null,
      edits: 3,
    });
    assert.equal(validateDataViewContext(null), null);
    assert.equal(validateDataViewContext([1]), null);
    assert.equal(validateDataViewContext({ big: 'x'.repeat(40000) }), null);
  });
});
