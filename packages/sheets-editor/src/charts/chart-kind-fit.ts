import type { StockKind } from '@open-artifact/sheets-core/stock-charts';
import type { ChartCell, ChartInputs, ChartRow } from '../chart-frame/messages.ts';

// Which kinds of chart suit which cells, and so which kinds the page can swap a chart to by itself, with no agent.
// This module imports nothing of the page, so the tests can load it.

/** The one input that each stock chart program reads. */
export const CHART_ROWS_INPUT = 'rows';
export const PIE_MAX_SLICES = 6;
export const BAR_CHART_MAX_POINTS = 50;
export const HORIZONTAL_BAR_MAX_POINTS = 12;
export const HORIZONTAL_BAR_MAX_BARS = 36;
export const isNumberValuedCell = (cell: ChartCell | undefined): boolean => typeof cell?.value === 'number';
export const isYearValuedCell = (cell: ChartCell | undefined): boolean =>
  typeof cell?.value === 'number' && Number.isInteger(cell.value) && cell.value > 1800 && cell.value < 2200;
export function doesChartKindSuitRows(chartKind: StockKind, rows: readonly ChartRow[]): boolean {
  let rowsWithText = rows.filter((row) => row.some(({ text }) => text !== ''));
  let hasHeaderRow = rowsWithText.length > 1 && rowsWithText[0]?.some(isNumberValuedCell) === false;
  let dataRows = rowsWithText.slice(hasHeaderRow ? 1 : 0);
  let columnCount = dataRows[0]?.length ?? 0;
  let firstColumnIsLabels =
    columnCount > 1 &&
    (!dataRows.some((row) => isNumberValuedCell(row[0])) || dataRows.every((row) => isYearValuedCell(row[0])));
  let numberColumns = Array.from(
    {
      length: columnCount,
    },
    (_slot, columnIndex) => columnIndex,
  ).filter(
    (columnIndex) =>
      columnIndex >= (firstColumnIsLabels ? 1 : 0) && dataRows.some((row) => isNumberValuedCell(row[columnIndex])),
  );
  let numbers = dataRows.flatMap(
    (row) =>
      numberColumns.flatMap((columnIndex) => (typeof row[columnIndex]?.value === 'number' ? [row[columnIndex].value] : [])),
  );
  let fitsParts =
    numbers.every((number) => number >= 0) && numbers.filter((number) => number > 0).length > 1;
  switch (chartKind) {
    case 'bar':
      return dataRows.length <= BAR_CHART_MAX_POINTS;
    case 'horizontalBar':
      return dataRows.length <= HORIZONTAL_BAR_MAX_POINTS && dataRows.length * numberColumns.length <= HORIZONTAL_BAR_MAX_BARS;
    case 'stackedBar':
    case 'stackedBar100':
      return numberColumns.length > 1 && fitsParts && dataRows.length <= BAR_CHART_MAX_POINTS;
    case 'line':
    case 'area':
      return true;
    case 'scatter':
      return numberColumns.length === 2;
    case 'pie':
      return numberColumns.length === 1 && fitsParts && dataRows.length <= PIE_MAX_SLICES;
  }
}
/**
 * Whether a chart drawn from these inputs can become a stock chart of this kind by the page alone, with no agent: the
 * stock programs read one input, `rows`, so the chart must read that one input and nothing else, and its rows must suit
 * the kind. Any chart code may be put in place this way, the agent's own included: the change is shown as a preview
 * first, to keep or to discard.
 */
export function canSwapChartKind(inputs: ChartInputs, kind: StockKind): boolean {
  return readsRowsAlone(inputs) && doesChartKindSuitRows(kind, inputs[CHART_ROWS_INPUT]);
}
export const readsRowsAlone = (inputs: ChartInputs): boolean =>
  inputs !== null &&
  typeof inputs === 'object' &&
  Array.isArray(inputs[CHART_ROWS_INPUT]) &&
  Object.keys(inputs).length === 1;
