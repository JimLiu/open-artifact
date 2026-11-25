import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DASH_DEFINED_TOKENS, type Dataset, type DatasetRun } from '@open-artifact/data-core';
import { applyStyleTweaks, countStyleTweaks, readStyleTweaks, withoutStyleTweaks } from '../src/page/look.ts';
import {
  buildDashboardRunReport,
  escapedJsonByteSize,
  isCleanRunReport,
  limitReportedNames,
} from '../src/page/runs.ts';
import {
  areRequestedSourcesSettled,
  createDashboardReadyGate,
  getPageChartColor,
  getPageChartColors,
  type DashboardReadyState,
} from '../src/page/runtime.ts';
import { getSelectionLabelText, type ElementSelection } from '../src/page/selection.ts';
import { PAGE_ALIAS_TOKENS, PAGE_BASE_TOKENS, PAGE_DARK_TOKENS, PAGE_LIGHT_TOKENS, getDefaultTokenCss, getPageStyleCss } from '../src/page/tokens.ts';

const AT = Date.UTC(2026, 0, 1);
const fileDataset = (id: string): Dataset => ({
  id,
  title: id,
  description: '',
  source: { kind: 'file', url: '/_blob/0123456789abcdef0123456789abcdef', name: `${id}.csv`, format: 'csv' },
  updated: null,
  schedule: '',
  staleAfterHours: null,
});
const ok = (rows: number): DatasetRun => ({
  status: 'ok',
  at: AT,
  ms: 12,
  table: { columns: ['a'], rows: Array.from({ length: rows }, (_, a) => ({ a })) },
});

describe('run report', () => {
  it('measures escaped JSON in UTF-8 bytes', () => {
    assert.equal(escapedJsonByteSize('a'), 3);
    assert.equal(escapedJsonByteSize('<'), 8);
    assert.equal(escapedJsonByteSize('é'), 4);
  });

  it('limits names with a count of the rest', () => {
    assert.deepEqual(limitReportedNames(['a', 'b', 'c'], 2), ['a', 'b', 'and 1 more']);
    assert.deepEqual(limitReportedNames(['a'], 2), ['a']);
  });

  it('reports each source run and waits for sources that have not started', () => {
    const runs = new Map<string, DatasetRun>([
      ['sales', ok(3)],
      ['costs', { status: 'idle' }],
    ]);
    const runOf = (id: string): DatasetRun => runs.get(id) ?? { status: 'idle' };
    assert.equal(buildDashboardRunReport([fileDataset('sales'), fileDataset('costs')], [], runOf, [], 0), null);
    const report = buildDashboardRunReport([fileDataset('sales')], ['region'], runOf, [], 0);
    assert.deepEqual(report, {
      params: ['region'],
      datasets: { sales: { status: 'ok', rows: 3, ms: 12, at: new Date(AT).toISOString() } },
    });
    assert.ok(report !== null && isCleanRunReport(report));
    assert.equal(buildDashboardRunReport([], [], runOf, [], 0), null);
  });

  it('adds the page faults it was given', () => {
    const report = buildDashboardRunReport([], [], () => ({ status: 'idle' }), [], 0, [
      { kind: 'stopped', name: 'TypeError', message: 'x', count: 1 },
    ]);
    assert.equal(report?.errors?.length, 1);
    assert.ok(report !== null && !isCleanRunReport(report));
  });
});

describe('style tweaks', () => {
  it('keeps only tweaks on offer', () => {
    const stored = { tweaks: { palette: 'Ocean', page: 'white', corners: 4, font: 'Comic', size: 'huge' } };
    assert.deepEqual(readStyleTweaks(stored), { palette: 'Ocean', page: 'white', corners: 4 });
    assert.equal(countStyleTweaks(readStyleTweaks(stored)), 3);
    assert.deepEqual(withoutStyleTweaks({ ...stored, corners: 2 }), { corners: 2 });
  });

  it('lays tweaks over the default colors when the page has no look of its own', () => {
    const applied = applyStyleTweaks({}, { palette: 'Meadow', page: 'white', size: 'large' });
    assert.equal((applied?.light as Record<string, unknown>).ground, '#ffffff');
    assert.equal(((applied?.dark as Record<string, unknown>).charts as string[])[0], '#488166');
    assert.equal((applied?.sizes as Record<string, string>).body, '16px');
    assert.equal(applyStyleTweaks({}, {}), null);
  });
});

describe('page tokens and chart colors', () => {
  it('cycles the look chart colors past the eighth', () => {
    assert.equal(getPageChartColor(1), 'var(--dash-chart-1)');
    assert.equal(getPageChartColor(10), 'var(--dash-chart-10, var(--dash-chart-2))');
    assert.equal(getPageChartColors(3).length, 3);
  });

  it('writes light defaults on the root and dark ones by mode or scheme', () => {
    const css = getDefaultTokenCss();
    assert.match(css, /^#dash-root\{--font-sans:Inter/);
    assert.match(css, /--font-serif:ui-serif, Georgia, 'Times New Roman', serif/);
    assert.match(css, /html\[data-mode="dark"\] #dash-root\{/);
    assert.match(css, /html:not\(\[data-mode\]\) #dash-root\{/);
    assert.ok(getPageStyleCss().startsWith(css));
  });

  it('defines exactly the tokens the page check knows', () => {
    const aliases = Object.keys(PAGE_ALIAS_TOKENS);
    const light = new Set([...Object.keys(PAGE_BASE_TOKENS), ...Object.keys(PAGE_LIGHT_TOKENS), ...aliases]);
    const dark = new Set([...Object.keys(PAGE_BASE_TOKENS), ...Object.keys(PAGE_DARK_TOKENS), ...aliases]);
    const known = [...DASH_DEFINED_TOKENS].filter((token) => token !== '--dash-gutter');
    assert.deepEqual([...light].filter((token) => !DASH_DEFINED_TOKENS.has(token)), []);
    assert.deepEqual(known.filter((token) => !light.has(token)), []);
    assert.deepEqual(known.filter((token) => !dark.has(token)), []);
  });

  it('sets each claude.ai token name on the root to a token the theme defines', () => {
    const css = getDefaultTokenCss();
    const rootRule = css.slice(0, css.indexOf('}'));
    const themed = new Set([...Object.keys(PAGE_BASE_TOKENS), ...Object.keys(PAGE_LIGHT_TOKENS)]);
    for (const [alias, value] of Object.entries(PAGE_ALIAS_TOKENS)) {
      const token = /^var\((--[\w-]+)\)$/.exec(value)?.[1] ?? '';
      assert.ok(themed.has(token), `${alias} stands for ${value}, which the root does not set`);
      assert.ok(Object.hasOwn(PAGE_DARK_TOKENS, token) || Object.hasOwn(PAGE_BASE_TOKENS, token), `${token} has no dark value`);
      assert.ok(rootRule.includes(`${alias}:${value}`), `the root rule does not set ${alias}`);
    }
    assert.equal(PAGE_ALIAS_TOKENS['--cds-gap-md'], 'var(--dash-gap-md)');
    assert.equal(PAGE_ALIAS_TOKENS['--cds-chart-status-critical'], 'var(--dash-chart-critical)');
    assert.equal(PAGE_ALIAS_TOKENS['--cds-chart-categorical-1'], 'var(--dash-chart-1)');
    assert.equal(PAGE_ALIAS_TOKENS['--font-anthropic-serif'], 'var(--font-serif)');
    assert.ok(!/html\[data-mode="dark"\] #dash-root\{[^}]*--cds-/.test(css), 'the dark rule repeats the aliases');
  });
});

describe('ready gate', () => {
  const files = [{ name: 'index.html', text: '' }] as never;
  const state = (status: DatasetRun['status'], reads: string[], page = files): DashboardReadyState => ({
    page,
    pages: 1,
    reads: { page: 1, datasets: new Set(reads) },
    datasets: [fileDataset('sales')],
    status: () => status,
  });

  it('settles when the read sources have finished', () => {
    assert.equal(areRequestedSourcesSettled(state('running', ['sales']), new Set(['sales'])), false);
    assert.equal(areRequestedSourcesSettled(state('running', []), new Set()), true);
    assert.equal(areRequestedSourcesSettled(state('ok', ['sales']), new Set(['sales'])), true);
  });

  it('resolves once the asked page has drawn with its sources settled', async () => {
    const gate = createDashboardReadyGate();
    let done = false;
    void gate.begin(files).then(() => {
      done = true;
    });
    gate.check(state('running', ['sales']));
    await Promise.resolve();
    assert.equal(done, false);
    gate.check(state('ok', ['sales']));
    await Promise.resolve();
    assert.equal(done, true);
  });
});

describe('selection label', () => {
  const selection = (patch: Partial<ElementSelection>): ElementSelection => ({
    kind: 'Text',
    text: 'Revenue grew 12%',
    title: '',
    under: 'Overview',
    hook: '',
    tab: '',
    source: null,
    ...patch,
  });

  it('prefers a heading, then the heading a chart sits under, then the text', () => {
    assert.equal(getSelectionLabelText(selection({ title: 'Sales' })), 'Sales');
    assert.equal(getSelectionLabelText(selection({ kind: 'Chart' })), 'Overview');
    assert.equal(getSelectionLabelText(selection({})), 'Revenue grew 12%');
  });
});
