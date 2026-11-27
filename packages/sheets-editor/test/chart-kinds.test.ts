import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STOCK_CHART_PROGRAMS, STOCK_KINDS } from '@open-artifact/sheets-core/stock-charts';
import { canSwapChartKind, doesChartKindSuitRows } from '../src/charts/chart-kind-fit.ts';
import { canAskChartChange, chartChangeOffers } from '../src/charts/change-offers.ts';
import { chartThumbnailPaths } from '../src/charts/chart-thumbnail-paths.ts';
import type { ChartCell } from '../src/chart-frame/messages.ts';
import type { ChartOfView } from '../src/charts/placed-views.ts';

const cell = (value: unknown): ChartCell => ({ value: typeof value === 'number' ? value : undefined, text: String(value) });
const table = (...rows: unknown[][]) => rows.map((row) => row.map(cell));

/** Months of two positive series: the shape of the chart in the screenshot this change came from. */
const MONTHS = table(['Month', 'Online', 'Stores'], ['Jan', 120, 80], ['Feb', 150, 95], ['Mar', 170, 90]);
const POINTS = table(['Price', 'Sold'], [10, 300], [12, 260], [15, 210]);

// The page swaps a chart's kind with no agent (agent-edits.ts). Those modules load the page's components, which the
// tests cannot, so what is tested here is the choosing of kinds; the swap itself is checked in the page.
describe('changing a chart’s kind', () => {
  it('keeps, with no agent, only the kinds the page swaps to', () => {
    const chart: ChartOfView = { kind: 'code', nodeId: 'n1', inputs: { rows: MONTHS } };
    const offers = STOCK_KINDS.map((kind) => ({ kind, series: [[1, 2, 3]] }));
    assert.deepEqual(
      chartChangeOffers(offers, chart, false).map(({ kind }) => kind),
      STOCK_KINDS.filter((kind) => doesChartKindSuitRows(kind, MONTHS)),
    );
    assert.equal(chartChangeOffers(offers, chart, true).length, offers.length);
    assert.equal(canAskChartChange({}, chart, false), true);
    // A chart that reads other inputs is the agent's to change, and is offered nothing without it.
    const other: ChartOfView = { kind: 'code', nodeId: 'n1', inputs: { costs: MONTHS } };
    assert.deepEqual(chartChangeOffers(offers, other, false), []);
    assert.equal(canAskChartChange({}, other, false), false);
    assert.ok(chartChangeOffers(offers, other, true).every(({ isSwap }) => !isSwap));
  });

  it('suits a scatter to two columns of numbers', () => {
    assert.equal(doesChartKindSuitRows('scatter', MONTHS), true);
    assert.equal(doesChartKindSuitRows('scatter', POINTS), true);
    assert.equal(doesChartKindSuitRows('scatter', table(['Month', 'Online'], ['Jan', 120], ['Feb', 150])), false);
    assert.equal(canSwapChartKind({ rows: MONTHS }, 'scatter'), true);
    assert.equal(canSwapChartKind({ rows: MONTHS, more: MONTHS }, 'scatter'), false);
  });

  it('stacks two or more columns of numbers', () => {
    assert.equal(doesChartKindSuitRows('stackedBar', table(['Month', 'Online'], ['Jan', 120], ['Feb', 150])), false);
    assert.equal(doesChartKindSuitRows('bar', POINTS), true);
    assert.equal(doesChartKindSuitRows('stackedBar', MONTHS), true);
    assert.equal(doesChartKindSuitRows('stackedBar100', MONTHS), true);
    // Years down the first column are labels, not points along a line: their columns still stack.
    const YEARS = table(['Year', 'Online', 'Stores'], [2023, 120, 80], [2024, 150, 95], [2025, 170, 90]);
    assert.equal(doesChartKindSuitRows('stackedBar', YEARS), true);
  });

  it('draws a thumbnail of every kind', () => {
    for (const kind of STOCK_KINDS) {
      const paths = chartThumbnailPaths({ kind, series: [[1, 3, 2, 4], [2, 1, 3, 2]] });
      assert.ok(paths.length > 0, kind);
      for (const { path } of paths) assert.doesNotMatch(path, /NaN|Infinity/, kind);
    }
  });
});
