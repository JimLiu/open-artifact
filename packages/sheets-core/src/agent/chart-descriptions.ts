/**
 * The Sheet's charts described for an .xlsx file. The engine checks each description against the cells and writes the
 * file's own chart from it (readXlsxFile's `charts`). No model is asked here: a chart that one of the page's stock
 * programs draws (bar, horizontal bar, stacked bar, 100% stacked bar, line, area, pie) is described from that program's
 * own rules. So is a chart of an earlier stock program (area, horizontal bar, scatter), whose rules are known here too.
 * Any other chart is left out of the file: one whose code the agent wrote, and a scatter of today's program.
 *
 * The stock programs read one input, `rows`. Of its first 100 rows, those with a text in them are looked at: the first
 * is a heading row when it holds no number, the first column holds labels when it holds no number (or only years), and
 * each other column with a number in it is a series. The pie draws the first of those only, as a ring. The grammar's
 * table form says just that ("its first row holds headings and its first column holds labels"), so a chart is described
 * only when its input is laid out that way from its first row; otherwise it is left out rather than written as
 * something it is not.
 */

import { type EngineMessage, isObject } from './engine.ts';
import { STOCK_INPUT, type StockKind, stockProgramOf } from './stock-charts.ts';
import type { WorkbookContents } from './workbook.ts';

/** A cell of a chart's input as the engine reads it (readInputsOfView): its value and the text it shows. */
export interface ChartCell {
  value?: unknown;
  text: string;
}

/** A description in the engine's chart grammar: bar, line, area, pie, doughnut, scatter, or none. */
export type ChartDescription = EngineMessage;

/** One chart of a workbook described for readXlsxFile. */
export interface DescribedChart {
  viewId: string;
  description: ChartDescription;
}

/** How many rows of the input a stock program looks at to tell headings, labels and series. */
const ROWS_LOOKED_AT = 100;

/**
 * The kind of stock chart this code is, by its text, as the file describes it: today's programs and the earlier ones,
 * but for today's scatter, which is left out of the file (null). An earlier scatter is described by its own rules.
 */
export function stockKindOf(code: string | null | undefined): StockKind | null {
  const program = typeof code === 'string' ? stockProgramOf(code) : null;
  if (program === null || (program.kind === 'scatter' && !program.isEarlier)) return null;
  return program.kind;
}

const isNumber = (cell: ChartCell | undefined): boolean => typeof cell?.value === 'number';
const isFilled = (row: ChartCell[]): boolean => row.some((cell) => cell.text !== '');
const isYear = (cell: ChartCell | undefined): boolean => typeof cell?.value === 'number' && Number.isInteger(cell.value) && cell.value > 1800 && cell.value < 2200;

/** The columns after the labels that hold a number in any of these rows. */
function columnsWithNumbers(rows: ChartCell[][], width: number): number[] {
  return Array.from({ length: width }, (_, i) => i).filter((i) => i >= 1 && rows.some((row) => isNumber(row[i])));
}

/** What a stock chart of this kind draws from these rows (its input), in the grammar; null when it cannot be said. */
export function describeStockChart(kind: StockKind, rows: ChartCell[][]): ChartDescription | null {
  const seen = rows.slice(0, ROWS_LOOKED_AT).filter(isFilled);
  const head = rows[0];
  const hasHead = seen.length > 1 && !seen[0]!.some(isNumber);
  // The table form's heading row is the input's first row: a blank row above the headings would be taken for them.
  if (!hasHead || head === undefined || !isFilled(head)) return null;
  const probe = seen.slice(1);
  const width = probe[0]?.length ?? 0;
  if (kind === 'scatter') return describeStockScatter(rows, probe, width);
  const hasLabels = width > 1 && (!probe.some((row) => isNumber(row[0])) || probe.every((row) => isYear(row[0])));
  if (!hasLabels) return null;
  const drawn = columnsWithNumbers(probe, width);
  const [first, ...others] = drawn;
  if (first === undefined) return null;
  // A column with its first number past the rows the program looks at: the program leaves it out, the file would not.
  if (columnsWithNumbers(rows.slice(1).filter(isFilled), width).join() !== drawn.join()) return null;
  const table = (labelsLeftOut: string[]): EngineMessage => ({ from: 'table', input: STOCK_INPUT, seriesAre: 'columns', labelsLeftOut });
  if (kind === 'pie') {
    // The ring of the first column with numbers; every other such column is left out by its heading.
    const heading = (i: number): string => head[i]?.text ?? '';
    const leftOut = others.map(heading);
    if (leftOut.some((text) => text === '' || text === heading(first))) return null;
    return { kind: 'doughnut', data: table(leftOut) };
  }
  if (kind === 'line') return { kind: 'line', stacking: 'none', data: table([]) };
  // Each area runs down to zero by itself, drawn over the ones before it: they are not stacked.
  if (kind === 'area') return { kind: 'area', stacking: 'none', data: table([]) };
  const bars = BAR_SHAPES[kind];
  if (bars.stacking === 'stackedToTheWhole' && holdsANegative(rows.slice(1), drawn)) return null;
  return { kind: 'bar', ...bars, data: table([]) };
}

/** How each bar kind lies and stacks in the file's grammar. */
const BAR_SHAPES: Readonly<Record<'bar' | 'horizontalBar' | 'stackedBar' | 'stackedBar100', { direction: 'vertical' | 'horizontal'; stacking: 'none' | 'stacked' | 'stackedToTheWhole' }>> = {
  bar: { direction: 'vertical', stacking: 'none' },
  horizontalBar: { direction: 'horizontal', stacking: 'none' },
  stackedBar: { direction: 'vertical', stacking: 'stacked' },
  stackedBar100: { direction: 'vertical', stacking: 'stackedToTheWhole' },
};

/**
 * Whether a drawn column holds a number below zero in these rows. The 100% stacked bar program skips such a value and
 * says so under the chart; Excel's 100% stack would draw it, so the chart is left out of the file instead.
 */
function holdsANegative(rows: readonly ChartCell[][], columns: readonly number[]): boolean {
  for (const row of rows) {
    for (const i of columns) {
      const value = row[i]?.value;
      if (typeof value === 'number' && value < 0) return true;
    }
  }
  return false;
}

/**
 * The earlier scatter program reads the first column as the numbers each point lies along and each other column with a
 * number as a series, leaving out the rows with no number in the first column. The file's table form draws every row,
 * so such a scatter is described only when every row under the headings has a number there.
 */
function describeStockScatter(rows: ChartCell[][], probe: ChartCell[][], width: number): ChartDescription | null {
  const below = rows.slice(1).filter(isFilled);
  if (width < 2 || below.length === 0 || !below.every((row) => isNumber(row[0]))) return null;
  const drawn = columnsWithNumbers(probe, width);
  if (drawn.length === 0 || columnsWithNumbers(below, width).join() !== drawn.join()) return null;
  return { kind: 'scatter', data: { from: 'table', input: STOCK_INPUT, seriesAre: 'columns', labelsLeftOut: [] } };
}

const isChartCell = (value: unknown): value is ChartCell => isObject(value) && typeof value.text === 'string';

/** The rows of an input, as readInputsOfView gives them. */
function rowsOf(value: unknown): ChartCell[][] | null {
  if (!Array.isArray(value)) return null;
  const rows: ChartCell[][] = [];
  for (const row of value) {
    if (!Array.isArray(row) || !row.every(isChartCell)) return null;
    rows.push(row);
  }
  return rows;
}

/**
 * What readXlsxFile is told of the charts: a description of each chart that a stock program draws, from the code its
 * widget publishes (`publishedCode`) and its input as the engine reads it (`answer`, a session of the workbook). A
 * chart of any other code is not described, and the file leaves it out. `only` keeps the charts with these ids.
 */
export function xlsxChartsOf(
  workbook: WorkbookContents,
  answer: (request: EngineMessage) => EngineMessage,
  publishedCode: (widgetId: string) => string | null | undefined,
  only?: ReadonlySet<string>,
): DescribedChart[] {
  const shown = new Set(workbook.sheets.flatMap((sheet) => (sheet.placements ?? []).map(({ placement }) => placement.shows.viewId)));
  return (workbook.views ?? []).flatMap(({ viewId, view }) => {
    if (only && !only.has(viewId)) return [];
    const [element] = view.elements;
    const widgetId = /^node\/(.+)$/.exec(element?.embed.ref ?? '')?.[1];
    const kind = shown.has(viewId) && view.elements.length === 1 && widgetId ? stockKindOf(publishedCode(widgetId)) : null;
    if (!kind || !element) return [];
    const read = answer({ kind: 'readInputsOfView', viewId });
    const elements = read.kind === 'inputsOfView' && Array.isArray(read.elements) ? read.elements.filter(isObject) : [];
    const inputs = elements.find((e) => e.elementId === element.elementId)?.inputs;
    if (!Array.isArray(inputs) || inputs.length !== 1 || !isObject(inputs[0]) || inputs[0].name !== STOCK_INPUT) return [];
    const rows = rowsOf(inputs[0].rows);
    const description = rows ? describeStockChart(kind, rows) : null;
    return description ? [{ viewId, description }] : [];
  });
}
