import { wholeAreaToA1AsStored, columnLetters } from '../model/a1-references.ts';
import type { SheetId } from '@open-artifact/sheets-core';
import type { SheetSummary, WorkbookReads } from '../model/workbook.ts';
import type { LineSizes } from '../model/line-sizes.ts';
import type { GridLayout } from '../grid/layout.ts';
import type { CellArea } from '../selection/model.ts';

/** A box of cells by its top row and left column, and how many rows and columns it takes. */
export interface CellsBox {
  top: number;
  left: number;
  rows: number;
  columns: number;
}
/** Where a new chart goes: the A1 range of the cells it draws, and the A1 address of the cell at its top left. */
export interface ChartPlace {
  range: string;
  topLeft: string;
}
export function filledRowSpanOfArea(workbook: WorkbookReads, sheetId: SheetId, area: CellArea): number {
  let onShow = workbook.areaOnShowIn(sheetId, area);
  return onShow === null ? 0 : onShow.topRowIndex + onShow.rowCount - area.topRowIndex;
}
/** What the room for a chart on a sheet looks like: what shows in a box of cells, how many columns some pixels take, and whether a box is free. */
export interface ChartRoomOfSheet {
  onShowIn: (box: CellsBox) => CellArea | null;
  columnsUnder: (column: number, pixels: number) => number;
  isFree: (box: CellsBox) => boolean;
}
export function chartRoomOfSheet(
  workbook: WorkbookReads,
  sheet: SheetSummary,
  rowsUnder: (row: number, pixels: number) => number,
  columnEdges: LineSizes = sheet.columnEdges,
): ChartRoomOfSheet {
  let { sheetId } = sheet,
    onShowIn = (box: CellsBox) => {
      let [rows, columns] = [Math.min(box.rows, sheet.rowCount - box.top), Math.min(box.columns, sheet.columnCount - box.left)];
      return rows <= 0 || columns <= 0
        ? null
        : workbook.areaOnShowIn(sheetId, {
            topRowIndex: box.top,
            leftColumnIndex: box.left,
            rowCount: rows,
            columnCount: columns,
          });
    },
    columnsUnder = (column: number, pixels: number) => columnEdges.indexAt(columnEdges.startOf(column) + pixels - 1) - column + 1,
    placedCharts = workbook.placementsIn(sheetId).map(
      (placement): CellsBox => ({
        top: placement.rowIndex,
        left: placement.columnIndex,
        rows: rowsUnder(placement.rowIndex, placement.heightInPixels + placement.offsetFromAnchorCell.yInPixels),
        columns: columnsUnder(placement.columnIndex, placement.widthInPixels + placement.offsetFromAnchorCell.xInPixels),
      }),
    );
  return {
    onShowIn,
    columnsUnder,
    isFree: (box) => onShowIn(box) === null && !placedCharts.some((placed) => gridBoxesOverlap(placed, box)),
  };
}
/** Where a chart can go on a sheet as it is laid out on the page: the first row and column it may start at, and whether a default-sized chart fits at a cell. */
export interface RoomForChart {
  firstRow: number;
  firstColumn: number;
  isRoomAt(row: number, column: number, withMargin: boolean): boolean;
}
export function roomForChartIn(
  workbook: WorkbookReads,
  sheetId: SheetId,
  { rowEdges, columnEdges }: Pick<GridLayout, 'rowEdges' | 'columnEdges'>,
): RoomForChart | null {
  let sheet = workbook.listSheets().find((summary) => summary.sheetId === sheetId);
  if (sheet === undefined) return null;
  let rowsUnder = (row: number, pixels: number) => rowEdges.indexAt(rowEdges.startOf(row) + pixels - 1) - row + 1,
    { columnsUnder, isFree } = chartRoomOfSheet(workbook, sheet, rowsUnder, columnEdges),
    { top: firstRow, left: firstColumn } = firstChartSpotOfSheet(sheet);
  return {
    firstRow,
    firstColumn,
    isRoomAt(row, column, withMargin) {
      let [rows, margin] = [rowsUnder(row, DEFAULT_CHART_SIZE.heightInPixels), withMargin ? 1 : 0];
      return (
        row >= firstRow &&
        column >= firstColumn &&
        row + rows <= sheet.rowCount &&
        columnEdges.startOf(column) + DEFAULT_CHART_SIZE.widthInPixels <= columnEdges.totalSize &&
        isFree({
          top: row - margin,
          left: Math.max(0, column - margin),
          rows: rows + 2 * margin,
          columns: columnsUnder(column, DEFAULT_CHART_SIZE.widthInPixels) + margin + Math.min(margin, column),
        })
      );
    },
  };
}
export function placeChartForArea(workbook: WorkbookReads, sheetId: SheetId, area: CellArea): ChartPlace | null {
  let sheet = workbook.listSheets().find((summary) => summary.sheetId === sheetId);
  if (sheet === undefined || isChartSourceTooTall(workbook, sheetId, area)) return null;
  let sourceArea =
      area.rowCount > MAX_CHART_SOURCE_ROWS
        ? {
            ...area,
            rowCount: Math.max(1, filledRowSpanOfArea(workbook, sheetId, area)),
          }
        : area,
    {
      onShowIn: filledIn,
      columnsUnder: columnsForPixels,
      isFree: isSpotFree,
    } = chartRoomOfSheet(workbook, sheet, (_row, pixels) => rowsForChartPixels(pixels)),
    rowBelow = sourceArea.topRowIndex + sourceArea.rowCount,
    lastRowBox = {
      top: rowBelow - 1,
      left: sourceArea.leftColumnIndex,
      rows: 1,
      columns: sourceArea.columnCount,
    },
    rowsToAdd = Math.min(MAX_ROWS_ADDED_TO_CHART_SOURCE, sheet.rowCount - rowBelow, MAX_CHART_SOURCE_ROWS - sourceArea.rowCount),
    filledBelow = filledIn({
      ...lastRowBox,
      top: rowBelow,
      rows: rowsToAdd,
    }),
    addedRows =
      filledIn(lastRowBox) === null ? 0 : filledBelow === null ? Math.max(0, rowsToAdd) : Math.max(0, filledBelow.topRowIndex - rowBelow - 1),
    range = wholeAreaToA1AsStored(
      {
        ...sourceArea,
        rowCount: sourceArea.rowCount + addedRows,
      },
      sheet.ownRowOrder,
    );
  if (range === null) return null;
  let chartRows = rowsForChartPixels(DEFAULT_CHART_SIZE.heightInPixels),
    findSpotFrom = (topRow: number, leftColumn: number): CellsBox | null => {
      let firstSpot = firstChartSpotOfSheet(sheet),
        [firstTop, topBelowFrozen, left] = [Math.max(topRow, firstSpot.flush), Math.max(topRow, firstSpot.top), Math.max(leftColumn, firstSpot.left)],
        columns = columnsForPixels(left, DEFAULT_CHART_SIZE.widthInPixels),
        tops = Array.from(
          {
            length: CHART_SPOT_TRIES,
          },
          (_slot, index) => topBelowFrozen + index * (chartRows + 1),
        ),
        spots = [...tops.slice(0, 1), firstTop, ...tops.slice(1)]
          .filter((top) => top < sheet.rowCount)
          .map(
            (top) => ({
              top,
              left,
              rows: chartRows,
              columns,
            }),
          );
      return spots.find(isSpotFree) ?? spots.at(-1) ?? null;
    },
    filledInRows = filledIn({
      top: sourceArea.topRowIndex,
      left: sourceArea.leftColumnIndex,
      rows: sourceArea.rowCount,
      columns: sheet.columnCount,
    }),
    lastFilledColumn =
      filledInRows === null ? sourceArea.leftColumnIndex + sourceArea.columnCount - 1 : filledInRows.leftColumnIndex + filledInRows.columnCount - 1,
    besideColumn = lastFilledColumn + 2,
    spotBelowData = () => {
      let filled = filledIn({
          top: 0,
          left: 0,
          rows: sheet.rowCount,
          columns: sheet.columnCount,
        }),
        rowBelowData = filled === null ? rowBelow : filled.topRowIndex + filled.rowCount;
      return findSpotFrom(rowBelowData + CHART_GAP_ROWS_BELOW_DATA, 0);
    },
    spotBeside = findSpotFrom(sourceArea.topRowIndex, Math.min(besideColumn, sheet.columnCount - 1)),
    canGoBeside =
      lastFilledColumn <= MAX_LAST_COLUMN_FOR_CHART_BESIDE && besideColumn < sheet.columnCount && spotBeside !== null && isSpotFree(spotBeside),
    fitsBeside =
      canGoBeside && sheet.columnEdges.startOf(spotBeside!.left) + DEFAULT_CHART_SIZE.widthInPixels <= sheet.columnEdges.totalSize,
    spotBelow = fitsBeside ? null : spotBelowData(),
    isBelowOffSheet = canGoBeside && (spotBelow === null || spotBelow.top + spotBelow.rows > sheet.rowCount),
    spot = fitsBeside || isBelowOffSheet ? spotBeside : (spotBelow ?? spotBeside);
  return spot === null
    ? null
    : {
        range,
        topLeft: `${columnLetters(spot.left)}${spot.top + 1}`,
      };
}
export const DEFAULT_CHART_SIZE = {
  widthInPixels: 480,
  heightInPixels: 280,
};
export const CHART_ROW_HEIGHT_PX = 21;
export const rowsForChartPixels = (pixels: number): number => Math.ceil(pixels / CHART_ROW_HEIGHT_PX);
export const MAX_LAST_COLUMN_FOR_CHART_BESIDE = 7;
export const CHART_GAP_ROWS_BELOW_DATA = 3;
export const CHART_ROWS_BELOW_FROZEN = 1;
export const MAX_ROWS_ADDED_TO_CHART_SOURCE = 40;
export const MAX_CHART_SOURCE_ROWS = 2000;
export const CHART_SPOT_TRIES = 12;
export const gridBoxesOverlap = (box: CellsBox, other: CellsBox): boolean =>
  box.top < other.top + other.rows && other.top < box.top + box.rows && box.left < other.left + other.columns && other.left < box.left + box.columns;
export const isChartSourceTooTall = (workbook: WorkbookReads, sheetId: SheetId, area: CellArea): boolean =>
  area.rowCount > MAX_CHART_SOURCE_ROWS && filledRowSpanOfArea(workbook, sheetId, area) > MAX_CHART_SOURCE_ROWS;
/** Where charts may start on a sheet: the first row past the frozen ones (flush), the row a chart is put at below them, and the first column past the frozen ones. */
export const firstChartSpotOfSheet = ({
  frozenRowCount,
  frozenColumnCount,
  rowCount,
  columnCount,
}: Pick<SheetSummary, 'frozenRowCount' | 'frozenColumnCount' | 'rowCount' | 'columnCount'>): { flush: number; top: number; left: number } => {
  let flush = frozenRowCount < rowCount ? frozenRowCount : 0;
  return {
    flush,
    top: flush + CHART_ROWS_BELOW_FROZEN,
    left: frozenColumnCount < columnCount ? frozenColumnCount : 0,
  };
};
