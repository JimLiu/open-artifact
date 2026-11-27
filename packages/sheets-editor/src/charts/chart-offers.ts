import { PIE_MAX_SLICES, BAR_CHART_MAX_POINTS, HORIZONTAL_BAR_MAX_POINTS, HORIZONTAL_BAR_MAX_BARS } from './chart-kind-fit.ts';
export { PIE_MAX_SLICES, BAR_CHART_MAX_POINTS, HORIZONTAL_BAR_MAX_POINTS, HORIZONTAL_BAR_MAX_BARS };
import type { SheetId } from '@open-artifact/sheets-core';
import { nonEmptyValueOfCell, DATE_TIME_FORMAT_KINDS, isYearCell } from '../selection/figures.ts';
import { numberFormatOfCell } from '../model/workbook.ts';
import { MAX_CHART_SOURCE_ROWS } from './placement.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { CellArea } from '../selection/model.ts';
import type { ChartOnOffer } from '../state/initial-state.ts';
import type { ChartSketch } from './chart-thumbnail-paths.ts';
import type { ChartKindOrAny } from './chart-words.ts';
import { STOCK_CHART_KINDS, isMadeOfPeriodWords, looksLikeTimeLabel, type StockKind } from './stock-programs.ts';
import type { ChartCell, ChartRow } from '../chart-frame/messages.ts';
/** What the numbers of a cell are counted in, as its format or its text shows. */
export type ChartUnit = 'percent' | 'currency' | 'none';
/** What a cell is to a chart offered for it: a label, or a number that is a time, a year or an amount. */
export type ChartCellRole =
  | { is: 'text'; value: string }
  | { is: 'time'; value: number | string }
  | { is: 'year'; value: number; unit: ChartUnit }
  | { is: 'amount'; value: number; unit: ChartUnit };
/** A cell whose number a chart can draw. */
export type ChartNumberCell = Extract<ChartCellRole, { is: 'year' | 'amount' }>;
/** A kind of chart offered for the cells selected, with the series its thumbnail draws. */
export type ChartOfferOfCells = ChartOnOffer & ChartSketch;
/** How the cells read for offers lie: how wide they are, how many rows were left unread, and the kind the chart is now. */
interface RolesRead {
  columnCount: number;
  rowsNotRead: number;
  kindNow: StockKind | null;
}
/** What decides the order of the kinds offered. */
interface ChartShape {
  isRun: boolean;
  isLineFirst: boolean;
  hasLabels: boolean;
  isOneSeries: boolean;
  areUnitsMixed: boolean;
}
export let CHART_OFFER_MAX_ROWS: number;
export let CHART_OFFER_MAX_COLUMNS: number;
export function chartCellKind(reads: WorkbookReads, sheetId: SheetId, rowIndex: number, columnIndex: number): ChartCellRole | null {
  let cellId = reads.cellIdAt(sheetId, rowIndex, columnIndex);
  let value = nonEmptyValueOfCell(reads, cellId);
  if (cellId === null || value === null) return null;
  if (value.kind !== 'number')
    return {
      is: 'text',
      value: String(value.value).trim().toLowerCase(),
    };
  let { kind: formatKind } = numberFormatOfCell(reads, cellId);
  if (DATE_TIME_FORMAT_KINDS.has(formatKind))
    return {
      is: 'time',
      value: value.value,
    };
  let isYear = isYearCell(reads, sheetId, {
      rowIndex,
      columnIndex,
    }),
    unit: ChartUnit = formatKind === 'percent' || formatKind === 'currency' ? formatKind : 'none';
  return {
    is: isYear ? 'year' : 'amount',
    value: value.value,
    unit,
  };
}
export function chartRoleOfCellText({ value, text }: ChartCell): ChartCellRole | null {
  if (text === '') return null;
  if (typeof value !== 'number')
    return {
      is: looksLikeTimeLabel(text) ? 'time' : 'text',
      value: text.trim().toLowerCase(),
    };
  let isYear = Number.isInteger(value) && value >= 1900 && value <= 2100 && text === String(value),
    unit: ChartUnit = text.includes('%') ? 'percent' : /\p{Sc}/u.test(text) ? 'currency' : 'none';
  return {
    is: isYear ? 'year' : 'amount',
    value,
    unit,
  };
}
export function hasRepeatedLabels(cells: readonly (ChartCellRole | null)[]): boolean {
  let labels = cells.flatMap((cell) => (cell === null || cell.value === '' ? [] : [cell.value]));
  return new Set(labels).size < labels.length;
}
export function isRepeatingCycle(labels: readonly (string | number | undefined)[]): boolean {
  let cycleLength = labels.indexOf(labels[0], 1);
  return (
    cycleLength > 1 &&
    new Set(labels.slice(0, cycleLength)).size === cycleLength &&
    labels.every((label, index) => label === labels[index % cycleLength])
  );
}
export function looksLikeAxisLabels(cells: readonly (ChartCellRole | null)[]): boolean {
  let numbers = cells.filter(isChartNumber).map(({ value }) => value);
  let steps = numbers.slice(1).map((number, index) => number - (numbers[index] ?? 0));
  let isMonotonic =
    steps.some((step) => step !== 0) &&
    (steps.every((step) => step >= 0) || steps.every((step) => step <= 0));
  return !cells.some(isChartAmount) && cells.some((cell) => cell !== null) && (numbers.length < 2 || isMonotonic);
}
export function sampleChartPointsEvenly<Point>(points: readonly Point[], count: number): readonly Point[] {
  if (points.length <= count) return points;
  let keptIndexes = new Set(
    Array.from(
      {
        length: count,
      },
      (_slot, index) => Math.round((index * (points.length - 1)) / (count - 1)),
    ),
  );
  return points.filter((_point, index) => keptIndexes.has(index));
}
export function chartKindsOfferedForCells(reads: WorkbookReads, sheetId: SheetId, area: CellArea): ChartOfferOfCells[] {
  let { topRowIndex, leftColumnIndex, rowCount, columnCount } = area,
    grid = Array.from(
      {
        length: Math.min(rowCount, CHART_OFFER_MAX_ROWS),
      },
      (_row, rowOffset) =>
        Array.from(
          {
            length: Math.min(columnCount, CHART_OFFER_MAX_COLUMNS),
          },
          (_cell, columnOffset) => chartCellKind(reads, sheetId, topRowIndex + rowOffset, leftColumnIndex + columnOffset),
        ),
    ),
    sourceArea = {
      ...area,
      rowCount: Math.min(rowCount, MAX_CHART_SOURCE_ROWS + 1),
    },
    shownArea = rowCount > grid.length ? reads.areaOnShowIn(sheetId, sourceArea) : null,
    rowsBeyond = shownArea === null ? 0 : Math.max(0, shownArea.topRowIndex + shownArea.rowCount - topRowIndex - grid.length);
  return chartKindsOfferedForRoles(grid, {
    columnCount,
    rowsNotRead: rowsBeyond,
    kindNow: null,
  });
}
export function chartKindsInOrder(shape: ChartShape): StockKind[] {
  if (shape.isRun) {
    if (!shape.isLineFirst) return ['bar', 'line', 'stackedBar', 'pie', 'area'];
    return shape.isOneSeries ? ['line', 'bar', 'area'] : ['line', 'bar', 'stackedBar', 'area'];
  }
  if (shape.isOneSeries) return ['horizontalBar', 'pie', 'bar'];
  if (!shape.hasLabels || shape.areUnitsMixed) return shape.isLineFirst ? ['scatter', 'line', 'bar'] : ['scatter', 'bar', 'line'];
  return ['bar', 'stackedBar', 'horizontalBar'];
}
export function chartKindsOfferedForRoles(
  grid: readonly (readonly (ChartCellRole | null)[])[],
  { columnCount, rowsNotRead: rowsBeyond, kindNow }: RolesRead,
): ChartOfferOfCells[] {
  let filledRows = grid.filter((row) => row.some((cell) => cell !== null)),
    isLabelRow = (row: readonly (ChartCellRole | null)[], rowIndex: number) =>
      rowIndex < filledRows.length - 1 &&
      looksLikeAxisLabels(row) &&
      !row.some((cell, columnIndex) => isChartNumber(cell) && isChartTimeOrYear(filledRows[rowIndex + 1]?.[columnIndex] ?? null)),
    rows = filledRows.slice(
      Math.max(
        0,
        filledRows.findIndex((row, rowIndex) => !isLabelRow(row, rowIndex)),
      ),
    ),
    firstColumn = rows.map((row) => row[0] ?? null),
    hasLabelColumn = (rows[0]?.length ?? 0) > 1 && looksLikeAxisLabels(firstColumn),
    columns = (rows[0] ?? []).map((_cell, columnIndex) => rows.map((row) => row[columnIndex] ?? null)).slice(hasLabelColumn ? 1 : 0),
    series = rows.length === 1 ? [columns.flat()] : columns,
    hasAmounts = series.some((cells) => cells.some(isChartAmount)),
    numberColumns = series.filter((cells) => cells.filter(isChartNumber).length >= 2 && !(hasAmounts && looksLikeAxisLabels(cells))),
    numberSeries = numberColumns.map((cells) => cells.map((cell) => (isChartNumber(cell) ? cell.value : 0))),
    skippedRows = filledRows.length - rows.length,
    isYear = (cell: ChartCellRole | null) => isChartNumber(cell) && Number.isInteger(cell.value) && cell.value > 1800 && cell.value < 2200,
    isTableShaped =
      columnCount <= CHART_OFFER_MAX_COLUMNS &&
      rows.length > 1 &&
      skippedRows <= 1 &&
      (filledRows[0] ?? []).some(isChartNumber) === (skippedRows === 0) &&
      hasLabelColumn === ((rows[0]?.length ?? 0) > 1 && (!firstColumn.some(isChartNumber) || firstColumn.every(isYear))) &&
      !(hasLabelColumn && firstColumn.includes(null)) &&
      series.filter((cells) => cells.some(isChartNumber)).length === numberSeries.length,
    pointCount = numberSeries[0]?.length ?? 0,
    allNumbers = numberSeries.flat();
  if (pointCount === 0 || !Number.isFinite(sumOfNumbers(allNumbers.map(Math.abs)))) return [];
  let positives = allNumbers.filter((number) => number > 0),
    isAllPositive = allNumbers.every((number) => number >= 0) && positives.length > 0,
    isOverTime = hasLabelColumn && firstColumn.some(isChartTimeOrYear),
    prefersLine = isOverTime || pointCount > LINE_CHART_MIN_POINTS,
    isBarOffered = pointCount + rowsBeyond <= BAR_CHART_MAX_POINTS,
    isForPage = isTableShaped && grid.length + rowsBeyond <= MAX_CHART_SOURCE_ROWS,
    isCycle = isRepeatingCycle(firstColumn.map((cell) => cell?.value)) && series.length === numberSeries.length,
    isLabelsRepeated = hasLabelColumn && hasRepeatedLabels(firstColumn) && !isCycle,
    isTooBigForPage =
      !isOverTime &&
      (hasLabelColumn ? 1 : 0) + series.filter((cells) => cells.some((cell) => cell !== null && cell.value !== '')).length > 1 &&
      pointCount + rowsBeyond > LEFT_TO_AGENT_MIN_POINTS,
    isBestLeftToAgent = isLabelsRepeated || isTooBigForPage,
    isOneSeries = numberSeries.length === 1,
    areUnitsMixed = new Set(numberColumns.map((cells) => cells.find(isChartNumber)?.unit)).size > 1,
    canStack = isAllPositive && !areUnitsMixed,
    areLabelsPeriods = hasLabelColumn && firstColumn.every(isTimeOrPeriodRole),
    areLabelsPeriodsButLast =
      hasLabelColumn && !areLabelsPeriods && firstColumn.length > 2 && firstColumn.slice(0, -1).every(isTimeOrPeriodRole),
    isRun = hasLabelColumn ? isOverTime || areLabelsPeriods || areLabelsPeriodsButLast : isOneSeries,
    areLabelsTimes = hasLabelColumn && firstColumn.every((cell) => looksLikeTimeLabel(textOfChartRole(cell))),
    [firstNumberColumn = [], secondNumberColumn = []] = numberColumns,
    pairedPointCount = firstNumberColumn.filter((cell, index) => isChartNumber(cell) && isChartNumber(secondNumberColumn[index] ?? null)).length,
    isKindOffered: Record<StockKind, boolean> = {
      bar: isBarOffered,
      horizontalBar: pointCount + rowsBeyond <= HORIZONTAL_BAR_MAX_POINTS && pointCount * numberSeries.length <= HORIZONTAL_BAR_MAX_BARS,
      stackedBar: isBarOffered && !isOneSeries && canStack,
      stackedBar100: isBarOffered && !isOneSeries && canStack,
      line: true,
      area: isRun && !areLabelsPeriodsButLast && !areUnitsMixed && numberSeries.length <= AREA_CHART_MAX_SERIES,
      scatter: numberSeries.length === 2 && pairedPointCount >= SCATTER_MIN_POINTS,
      pie: isOneSeries && isAllPositive && pointCount <= PIE_MAX_SLICES && positives.length > 1,
    },
    kindsInOrder = chartKindsInOrder({
      isRun,
      isLineFirst: (prefersLine || areLabelsTimes) && !areLabelsPeriodsButLast,
      hasLabels: hasLabelColumn,
      isOneSeries,
      areUnitsMixed,
    });
  return [...new Set([...kindsInOrder, ...STOCK_CHART_KINDS])]
    .filter((kind) => isKindOffered[kind] || kind === kindNow)
    .map(
      (kind) => ({
        kind,
        isForPage,
        isBestLeftToAgent,
        series: numberSeries
          .slice(0, CHART_PREVIEW_SAMPLE_SIZES[kind].series)
          .map((points) => sampleChartPointsEvenly(points, CHART_PREVIEW_SAMPLE_SIZES[kind].points))
          .map((points) => (CHART_KINDS_WITHOUT_NEGATIVES.has(kind) ? points.map((point) => Math.max(0, point)) : points)),
      }),
    );
}
export const INSERT_CHART_LABEL = 'Insert chart';
export const chartAskPayload = (chartKind: ChartKindOrAny, request: string) => ({
  chartKind,
  ...(request !== '' && {
    request,
  }),
});
export const IS_CHART_OFFER_AT_SELECTION_ON = false;
[CHART_OFFER_MAX_ROWS, CHART_OFFER_MAX_COLUMNS] = [100, 8];
export const CHART_PREVIEW_SAMPLE_SIZES: Readonly<Record<StockKind, { series: number; points: number }>> = {
  bar: {
    series: 2,
    points: 4,
  },
  horizontalBar: {
    series: 2,
    points: 4,
  },
  stackedBar: {
    series: 3,
    points: 5,
  },
  stackedBar100: {
    series: 3,
    points: 5,
  },
  line: {
    series: 3,
    points: 12,
  },
  area: {
    series: 3,
    points: 12,
  },
  scatter: {
    series: 2,
    points: 8,
  },
  pie: {
    series: 1,
    points: 6,
  },
};
export const CHART_KINDS_WITHOUT_NEGATIVES: ReadonlySet<StockKind> = new Set<StockKind>(['stackedBar', 'stackedBar100', 'pie']);
export const LINE_CHART_MIN_POINTS = 8;
export const AREA_CHART_MAX_SERIES = 2;
export const SCATTER_MIN_POINTS = 4;
export const LEFT_TO_AGENT_MIN_POINTS = 24;
export const isChartNumber = (role: ChartCellRole | null): role is ChartNumberCell => role?.is === 'amount' || role?.is === 'year';
export const isChartAmount = (role: ChartCellRole | null): boolean => role?.is === 'amount';
export const isChartTimeOrYear = (role: ChartCellRole | null): boolean => role?.is === 'time' || role?.is === 'year';
export const sumOfNumbers = (numbers: readonly number[]) =>
  numbers.reduce((total, number) => total + number, 0);
export const chartKindsOfferedForRows = (rows: readonly ChartRow[], kindNow: StockKind | null): ChartOfferOfCells[] =>
  chartKindsOfferedForRoles(
    rows.slice(0, CHART_OFFER_MAX_ROWS).map((row) => row.slice(0, CHART_OFFER_MAX_COLUMNS).map(chartRoleOfCellText)),
    {
      columnCount: rows[0]?.length ?? 0,
      rowsNotRead: Math.max(0, rows.length - CHART_OFFER_MAX_ROWS),
      kindNow,
    },
  );
export const textOfChartRole = (role: ChartCellRole | null): string => String(role?.value ?? '');
export const isTimeOrPeriodRole = (role: ChartCellRole | null): boolean =>
  isMadeOfPeriodWords(textOfChartRole(role)) || looksLikeTimeLabel(textOfChartRole(role));
export const isChartMadeByPage = (offer: ChartOnOffer | undefined, canLeaveToAgent: boolean): boolean =>
  offer?.isForPage === true && !(offer.isBestLeftToAgent && canLeaveToAgent);
export const NO_CHART_OFFERS: readonly never[] = [];
export const chartOffersForPage = <Offer extends ChartOnOffer>(offers: readonly Offer[], canLeaveToAgent: boolean): readonly Offer[] =>
  isChartMadeByPage(offers[0], canLeaveToAgent) ? offers : NO_CHART_OFFERS;
export const chartOfferAtSelection = <Offer extends ChartOnOffer>(offers: readonly Offer[], isOn: boolean = IS_CHART_OFFER_AT_SELECTION_ON): Offer | undefined =>
  isOn ? offers[0] : undefined;
