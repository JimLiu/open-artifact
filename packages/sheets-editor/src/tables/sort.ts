import { layoutOfView, rowsHiddenByOwnFilters, sheetOfViewOrEmpty } from '../grid/layout.ts';
import { columnLetters } from '../model/a1-references.ts';
import { selectionPositionsOf, selectedArea, selectionAreaAndKind, selectionAtCell } from '../selection/model.ts';
import { withNoEffects } from '../state/transitions.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { isInSpan } from '../grid/geometry.ts';
import { placedTablesOfSheet, hasTableHeadings } from './finding.ts';
import { isSelectionOneCell } from '../selection/keyboard.ts';
import { currentRegionAround } from '../selection/jumps.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { areaRefBetween, numberFormatOfCell } from '../model/workbook.ts';
import { ownFilterByKey, rowBelowOwnFilterButtonsAt } from './own-filters.ts';
import { collapseLineSizes, createLineSizes } from '../model/line-sizes.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { cellShownText } from '../clipboard/text-escaping.ts';
import { isColumnFiltered } from './filter-model.ts';
import { isAreaWithin } from '../selection/several-ranges.ts';
import { headedTableBoundsAtCell } from './table-to-sort.ts';
import type { ColumnId, Edit, HorizontalAlignment, RowId, SheetId, SortDirection } from '@open-artifact/sheets-core';
import type { CellId, SheetRead, WorkbookReads } from '../model/workbook.ts';
import type { PageState, SortHoldsOfColumn } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { SheetChange } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { CellArea } from '../selection/model.ts';
import type { LayoutView } from '../grid/layout.ts';
import type { OwnFilter } from './own-filters.ts';
/** The sorts of a whole sheet by a column. */
export type SheetSortChange = Extract<SheetChange, 'sortAscending' | 'sortDescending'>;
/** The sorts of the selected range by a column. */
export type RangeSortChange = Extract<SheetChange, 'sortRangeAscending' | 'sortRangeDescending'>;
/** What a range sort takes in: the selection alone, or the table around it. */
export type SortWidening = 'selection' | 'table';
/** Which sorts of a range offer the selection or the table around it: the sorts of the menu, or the sort pane's keys. */
export type ChangeOfCellsToSort = RangeSortChange | 'sortByKeysOfPane';
/** The selection and the wider table a sort could take in, as A1 references. */
export interface SortWideningChoice {
  selection: string;
  table: string;
}
/** The question of which cells to sort: the sort asked for, and the selection and table it could take in. */
export interface CellsToSortAsked extends SortWideningChoice {
  change: ChangeOfCellsToSort;
}
/** The rows a sort takes in. */
export type RowsToSort = Pick<CellArea, 'topRowIndex' | 'rowCount'>;
/** A column of a sheet. */
export type ColumnOfSheet = Pick<CellId, 'sheetId' | 'columnId'>;
/** What a cell holds that a sort goes by, `'other'` when it is nothing a sort can name. */
export type SortHoldsOfCell = SortHoldsOfColumn | 'other';
/** An edit that sorts rows or cells. */
export type SortEdit = Extract<Edit, { kind: 'sortRows' | 'sortCells' }>;
/** The first and last cells of a sheet's sort by a column, below the headings, and the column's letters. */
export interface SheetSortEnds {
  first: CellId;
  last: CellId;
  column: string;
}
/** How to sort a range: its corners, the column to sort by and its letters, whether whole rows are selected, and the heading rows left out. */
export interface RangeSortPlan {
  topLeft: CellId;
  bottomRight: CellId;
  byColumn: ColumnId;
  column: string;
  areWholeRows: boolean;
  headingRowCount: number;
  topLeftWithHeadings: CellId;
}
/** A column of a connected table as its records show it. */
export interface RecordColumn {
  columnId: ColumnId;
  name: string;
  /** How formulas name the column. */
  reference: string;
  widthInPixels: number;
  /** Whether the width is fitted to the column's texts, as the column was never sized. */
  isFitted: boolean;
  alignment: HorizontalAlignment;
  isFiltered: boolean;
  sorted: SortDirection | null;
}
/** A connected table as its records view shows it: line 0 is the names, a record's line is its index plus one. */
export interface RecordsOfTable {
  sheetId: SheetId;
  name: string;
  columns: RecordColumn[];
  recordCount: number;
  canBeFiltered: boolean;
  /** Whether the snapshot's rows are fetched but not held yet. */
  areOnTheirWay: boolean;
  areAllFilteredOut: boolean;
  textsOf(record: number): string[];
  lineOf(cell: CellId): number | null;
  cellAt(line: number, columnIndex: number): CellId | null;
  linesOf(rows: { topRowIndex: number; rowCount: number }): { first: number; end: number };
}
/** The records last made of the reads, with what they were made from. */
export interface RecordsViewCached {
  records: RecordsOfTable;
  outOfView: Set<RowId> | undefined;
  filtered: OwnFilter | null;
}
/** The view the records are made for. */
export type ViewOfRecords = LayoutView & Pick<PageState, 'ownFilters' | 'ownCollapsing' | 'rowsOutOfViewByOwnFilters'>;
export function sheetSortColumnLetters(state: PageState, reads: ReadsWithTextMeasurer, columnId: ColumnId | null): string | null {
  let columnIndex = sortColumnIndex(state, reads, columnId);
  let hasRowsBelow = layoutOfView(state, reads).rowCount > headingRowCountByFilter(state, reads);
  return columnIndex === null || !hasRowsBelow ? null : columnLetters(columnIndex);
}
export function sheetSortArea(state: PageState, reads: ReadsWithTextMeasurer): RowsToSort {
  let topRowIndex = Math.max(headingRowCountByFreeze(state, reads), headingRowCountByFilter(state, reads));
  return {
    topRowIndex,
    rowCount: layoutOfView(state, reads).rowCount - topRowIndex,
  };
}
export function sheetSortEnds(state: PageState, reads: ReadsWithTextMeasurer, columnId: ColumnId | null): SheetSortEnds | null {
  let columnIndex = sortColumnIndex(state, reads, columnId);
  let lettersOfColumn = sheetSortColumnLetters(state, reads, columnId);
  if (columnIndex === null || lettersOfColumn === null) return null;
  let first = reads.cellIdAt(state.sheetId, headingRowCountByFilter(state, reads), columnIndex);
  let last = reads.cellIdAt(state.sheetId, layoutOfView(state, reads).rowCount - 1, columnIndex);
  return first === null || last === null
    ? null
    : {
        first,
        last,
        column: lettersOfColumn,
      };
}
export function sortSheetByColumn(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  change: SheetSortChange,
  columnId: ColumnId | null,
  withNoKeyboard: boolean,
): PageTransition {
  let ends = sheetSortEnds(state, reads, columnId);
  let selectionPositions = selectionPositionsOf(state, reads);
  if (ends === null || selectionPositions === null) return withNoEffects(state);
  let { first, last, column } = ends;
  const direction = change === 'sortAscending' ? 'ascending' : 'descending';
  return queueEdit(
    state,
    {
      kind: 'sortRows',
      sheetId: state.sheetId,
      oneRow: first.rowId,
      otherRow: last.rowId,
      byColumn: first.columnId,
      direction,
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: selectionPositions,
      done: {
        what: 'rowsSorted',
        column,
        direction,
      },
      undoOffer: withNoKeyboard
        ? {
            kind: 'sortedWithNoKeyboard',
            column,
            direction,
            isSaved: false,
          }
        : null,
    },
  );
}
export function firstRowBelowTableHeader(
  view: Pick<PageState, 'sheetId' | 'tablesRead'>,
  reads: WorkbookReads,
  { topRowIndex, leftColumnIndex, columnCount }: Pick<CellArea, 'topRowIndex' | 'leftColumnIndex' | 'columnCount'>,
): number {
  let columnsShown = reads
    .columnIndexesOnShowIn(view.sheetId, topRowIndex)
    .filter((columnIndex) => isInSpan(columnIndex, leftColumnIndex, columnCount));
  let tablesWithHeaderAtTop = placedTablesOfSheet(view, reads, view.sheetId).all.filter(
    ({ table, header }) => hasTableHeadings(table) && topRowIndex >= header.first && topRowIndex <= header.last,
  );
  let headerEnds = columnsShown.map(
    (columnIndex) =>
      tablesWithHeaderAtTop.find(({ columns }) => columnIndex >= columns.first && columnIndex <= columns.last)?.header
        .last,
  );
  return headerEnds.every((headerEnd) => headerEnd !== undefined)
    ? Math.max(topRowIndex - 1, ...headerEnds) + 1
    : topRowIndex;
}
export function withoutFooterRows(state: PageState, reads: WorkbookReads, area: CellArea): CellArea {
  let bottomRow = {
    ...area,
    topRowIndex: area.topRowIndex + area.rowCount - 1,
    rowCount: 1,
  };
  let rowCount =
    (placedTablesOfSheet(state, reads, state.sheetId).all.find(
      ({ table: { footerRows }, area: tableArea }) =>
        footerRows !== null &&
        isAreaWithin(bottomRow, tableArea) &&
        bottomRow.topRowIndex >= (reads.rowIndexOf(state.sheetId, footerRows.firstRow) ?? 1 / 0),
    )?.body?.last ?? -1) -
    area.topRowIndex +
    1;
  return rowCount > 0 && rowCount < area.rowCount ? { ...area, rowCount } : area;
}
export function rangeSortArea(state: PageState, reads: ReadsWithTextMeasurer): CellArea | null {
  let area = selectedArea(state, reads);
  if (area === null || isSelectionOneCell(state, reads)) return null;
  let layout = layoutOfView(state, reads);
  if (area.rowCount === layout.rowCount) return null;
  let { frozenRowCount } = sheetOfViewOrEmpty(state, reads);
  let topRowIndex = Math.max(firstRowBelowTableHeader(state, reads, area), MIN_SORT_HEADING_ROWS, frozenRowCount);
  let rowCount = area.topRowIndex + area.rowCount - topRowIndex;
  let sortArea = withoutFooterRows(state, reads, {
    ...area,
    topRowIndex,
    rowCount,
  });
  return sortArea.rowCount < 2 ? null : sortArea;
}
export function widenToRegionColumns(state: PageState, reads: ReadsWithTextMeasurer, area: CellArea): CellArea {
  let [firstCell] = reads.cellsOnShowIn(state.sheetId, area);
  if (firstCell === undefined) return area;
  let { leftColumnIndex, columnCount } = currentRegionAround(state, reads, area);
  let rightColumnIndex = leftColumnIndex + columnCount - 1;
  let isColumnShown = (columnIndex: number) =>
    columnIndex >= 0 &&
    reads.areaOnShowIn(state.sheetId, {
      ...area,
      leftColumnIndex: columnIndex,
      columnCount: 1,
    }) !== null;
  let table = [leftColumnIndex - 2, rightColumnIndex + 2].some(isColumnShown) ? headedTableBoundsAtCell(reads, firstCell)?.table : undefined;
  if (table === undefined)
    return {
      ...area,
      leftColumnIndex,
      columnCount,
    };
  let left = Math.min(leftColumnIndex, table.leftColumnIndex);
  let end = Math.max(rightColumnIndex + 1, table.leftColumnIndex + table.columnCount);
  return {
    ...area,
    leftColumnIndex: left,
    columnCount: end - left,
  };
}
export function rangeSortWideningChoice(state: PageState, reads: ReadsWithTextMeasurer): SortWideningChoice | null {
  let area = rangeSortArea(state, reads);
  if (area === null) return null;
  let widenedArea = widenToRegionColumns(state, reads, area);
  return widenedArea.columnCount === area.columnCount
    ? null
    : {
        selection: areaToA1AsStored(area, ownRowOrderOfSheet(reads, state.sheetId)),
        table: areaToA1AsStored(widenedArea, ownRowOrderOfSheet(reads, state.sheetId)),
      };
}
export function rangeSortAreaIn(state: PageState, reads: ReadsWithTextMeasurer, widening: SortWidening): CellArea | null {
  let area = rangeSortArea(state, reads);
  if (area === null) return null;
  return widening === 'table' ? widenToRegionColumns(state, reads, area) : area;
}
export function rangeSortPlan(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  widening: SortWidening,
  columnId: ColumnId | null,
): RangeSortPlan | null {
  let area = rangeSortAreaIn(state, reads, widening);
  if (area === null) return null;
  let columnIndex = sortColumnIndex(state, reads, columnId);
  if (columnIndex === null) return null;
  let { topRowIndex, leftColumnIndex, rowCount, columnCount } = area;
  let headingRowCount = topRowIndex - (selectedArea(state, reads)?.topRowIndex ?? topRowIndex);
  let topLeft = reads.cellIdAt(state.sheetId, topRowIndex, leftColumnIndex);
  let topLeftWithHeadings = reads.cellIdAt(state.sheetId, topRowIndex - headingRowCount, leftColumnIndex);
  let bottomRight = reads.cellIdAt(state.sheetId, topRowIndex + rowCount - 1, leftColumnIndex + columnCount - 1);
  let byColumn = reads.cellIdAt(state.sheetId, topRowIndex, columnIndex)?.columnId;
  return topLeft === null || topLeftWithHeadings === null || bottomRight === null || byColumn === undefined
    ? null
    : {
        topLeft,
        bottomRight,
        byColumn,
        column: columnLetters(columnIndex),
        areWholeRows: selectionAreaAndKind(state, reads)?.kind === 'rows',
        headingRowCount,
        topLeftWithHeadings,
      };
}
export function sortRange(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  change: RangeSortChange,
  widening: SortWidening,
  columnId: ColumnId | null,
  withNoKeyboard: boolean,
): PageTransition {
  let plan = rangeSortPlan(state, reads, widening, columnId);
  if (plan === null) return withNoEffects(state);
  let {
    topLeft,
    bottomRight,
    byColumn,
    column,
    areWholeRows,
    headingRowCount,
  } = plan;
  const direction = change === 'sortRangeAscending' ? 'ascending' : 'descending';
  let rowSelection = areWholeRows ? selectionPositionsOf(state, reads) : null;
  let { activeCell } = state;
  let walkedSelection = {
    ...selectionAtCell(activeCell),
    rangeWalked: {
      from: plan.topLeftWithHeadings,
      to: bottomRight,
      at: activeCell,
    },
  };
  return queueEdit(
    state,
    rowSelection === null
      ? {
          kind: 'sortCells',
          cells: areaRefBetween(topLeft, bottomRight),
          byColumn,
          direction,
        }
      : {
          kind: 'sortRows',
          sheetId: state.sheetId,
          oneRow: topLeft.rowId,
          otherRow: bottomRight.rowId,
          byColumn,
          direction,
        },
    {
      ...IF_QUEUED_DEFAULTS,
      select: rowSelection ?? (widening === 'table' ? walkedSelection : null),
      done: {
        what: 'cellsSorted',
        column,
        direction,
        headingRowCount,
      },
      undoOffer: withNoKeyboard
        ? {
            kind: 'sortedWithNoKeyboard',
            column,
            direction,
            isSaved: false,
          }
        : null,
    },
  );
}
export function sortHoldsOfCell(reads: WorkbookReads, cellId: CellId): SortHoldsOfCell | null {
  let cell = reads.cellOnShowIn(cellId);
  if (cell === null) return null;
  let input = 'input' in cell ? cell.input : null;
  if (input?.kind === 'dropdownOption') {
    let { optionId } = input;
    return reads.dropdownOf(cellId)?.options.some((option) => option.optionId === optionId) === true ? 'options' : 'other';
  }
  let value = cell.value ?? (input?.kind === 'formula' ? null : input);
  if (value === null || value.kind === 'boolean') return 'other';
  if (value.kind === 'error') return null;
  if (value.kind !== 'number') return value.kind === 'text' && value.value === '' ? null : 'text';
  let formatKind = numberFormatOfCell(reads, cellId).kind;
  if (formatKind === 'date' || formatKind === 'dateAndTime') return 'dates';
  if (formatKind !== 'time') return 'numbers';
  return value.value >= 0 && value.value < 1 ? 'times' : 'other';
}
export function sortHoldsOfColumnArea(
  reads: WorkbookReads,
  { sheetId, columnId }: ColumnOfSheet,
  { topRowIndex, rowCount }: RowsToSort,
): SortHoldsOfColumn | null {
  let holds: SortHoldsOfColumn | null = null;
  let dropdownId: string | null = null;
  for (let rowId of reads.cellsHeldByRow(sheetId).keys()) {
    let cellId = {
      sheetId,
      rowId,
      columnId,
    };
    if (reads.cellOnShowIn(cellId) === null) continue;
    let rowIndex = reads.rowIndexOf(sheetId, rowId);
    if (rowIndex === null || rowIndex < topRowIndex || rowIndex >= topRowIndex + rowCount) continue;
    let cellHolds = sortHoldsOfCell(reads, cellId);
    if (cellHolds === null) continue;
    if (cellHolds === 'other' || (holds !== null && cellHolds !== holds)) return null;
    holds = cellHolds;
    if (cellHolds !== 'options') continue;
    let rowDropdownId = reads.dropdownOf(cellId)?.dropdownId ?? null;
    if (dropdownId !== null && rowDropdownId !== dropdownId) return null;
    dropdownId = rowDropdownId;
  }
  return holds;
}
export function sortHoldsOfColumn(reads: WorkbookReads, column: ColumnOfSheet, span: RowsToSort): SortHoldsOfColumn | null {
  let sheet = reads.sheetAsItStands(column.sheetId);
  if (sheet === null || span.rowCount < 1) return null;
  let bySpan = sortHoldsCache.get(sheet) ?? new Map<string, SortHoldsOfColumn | null>();
  sortHoldsCache.set(sheet, bySpan);
  let key = `${column.columnId} ${span.topRowIndex} ${span.rowCount}`;
  let cached = bySpan.get(key);
  if (cached !== undefined) return cached;
  let holds = sortHoldsOfColumnArea(reads, column, span);
  bySpan.set(key, holds);
  return holds;
}
export function sortHoldsForMenu(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  scope: 'sheet' | 'range',
  columnId: ColumnId | null,
): SortHoldsOfColumn | null {
  let { sheetId } = state;
  let columnIndex = sortColumnIndex(state, reads, columnId);
  let byColumnId = columnIndex === null ? undefined : reads.cellIdAt(sheetId, 0, columnIndex)?.columnId;
  let span = scope === 'range' ? rangeSortArea(state, reads) : sheetSortArea(state, reads);
  return byColumnId === undefined || span === null
    ? null
    : sortHoldsOfColumn(
        reads,
        {
          sheetId,
          columnId: byColumnId,
        },
        span,
      );
}
export function recordsOfConnectedTable(view: ViewOfRecords, reads: ReadsWithTextMeasurer): RecordsOfTable | null {
  let { sheetId } = view;
  let connectedTable = reads.connectedTableIn(sheetId);
  if (connectedTable === null) return null;
  let cached = recordsViewCache.get(reads);
  let outOfView = view.rowsOutOfViewByOwnFilters.get(sheetId);
  let ownFilter = ownFilterByKey(view, sheetId);
  if (cached?.records.sheetId === sheetId && cached.outOfView === outOfView && cached.filtered === ownFilter) return cached.records;
  let rowCount = connectedTable.rows.kind === 'held' ? connectedTable.rows.rowCount : 0;
  let lines = collapseLineSizes(createLineSizes(rowCount + 1, [], 1), rowsHiddenByOwnFilters(view, reads, sheetId));
  let cellIdAt = (line: number, columnIndex: number): CellId | null => reads.cellIdAt(sheetId, lines.indexAt(line), columnIndex);
  let cellOfRecord = (record: number, columnIndex: number) => {
    let cellId = cellIdAt(record + 1, columnIndex);
    return cellId === null ? null : reads.cellOnShowIn(cellId);
  };
  let stored = reads.asStored() ?? reads;
  let sampleCells = (columnIndex: number) =>
    Array.from(
      {
        length: Math.min(rowCount, RECORDS_VIEW_SAMPLE_ROWS),
      },
      (input, offset) => {
        let cellId = stored.cellIdAt(sheetId, offset + 1, columnIndex);
        return cellId === null ? null : reads.cellOnShowIn(cellId);
      },
    );
  let holdsNumbers = (columnIndex: number): boolean =>
    sampleCells(columnIndex)
      .map(cellValueOf)
      .find((value) => value !== null)?.kind === 'number';
  let fittedWidth = (name: string, columnIndex: number): number =>
    Math.min(
      RECORDS_VIEW_COLUMN_WIDTHS.widest,
      Math.max(
        name.length * RECORDS_VIEW_COLUMN_WIDTHS.ofCharacter + RECORDS_VIEW_COLUMN_WIDTHS.besideName,
        ...sampleCells(columnIndex).map(
          (cell) => cellShownText(cell, reads.decimalSign).length * RECORDS_VIEW_COLUMN_WIDTHS.ofCharacter + RECORDS_VIEW_COLUMN_WIDTHS.besideText,
        ),
      ),
    );
  let { columnEdges } = layoutOfView(view, reads);
  let isUnsized = (columnIndex: number): boolean => columnEdges.sizeOf(columnIndex) === connectedTable.widthOfUnsizedColumn;
  let records: RecordsOfTable = {
    sheetId,
    name: reads.listSheets().find((sheet) => sheet.sheetId === sheetId)?.name ?? '',
    columns: connectedTable.columns.map(({ c: columnId, column }, columnIndex) => ({
      columnId,
      name: column.name,
      reference: connectedTable.references.find((reference) => reference.c === columnId)?.text ?? '',
      widthInPixels: isUnsized(columnIndex) ? fittedWidth(column.name, columnIndex) : columnEdges.sizeOf(columnIndex),
      isFitted: isUnsized(columnIndex),
      alignment: column.horizontalAlignment ?? (holdsNumbers(columnIndex) ? 'right' : 'left'),
      isFiltered: isColumnFiltered(ownFilter?.filter ?? null, columnId),
      sorted: ownFilter?.sort?.by.find((key) => key.c === columnId)?.direction ?? null,
    })),
    recordCount: lines.totalSize - 1,
    canBeFiltered: rowCount > 0,
    areOnTheirWay: connectedTable.snapshot !== null && connectedTable.rows.kind === 'notHeld',
    areAllFilteredOut: rowCount > 0 && lines.totalSize === 1,
    textsOf: (record) => connectedTable.columns.map((input, columnIndex) => cellShownText(cellOfRecord(record, columnIndex), reads.decimalSign)),
    lineOf(cell) {
      let position = cell.sheetId === sheetId ? reads.positionOfCell(cell) : null;
      return position === null || lines.sizeOf(position.rowIndex) === 0 ? null : lines.startOf(position.rowIndex);
    },
    cellAt: cellIdAt,
    linesOf: ({ topRowIndex, rowCount: count }) => ({
      first: lines.startOf(topRowIndex),
      end: lines.startOf(topRowIndex + count),
    }),
  };
  recordsViewCache.set(reads, {
    records,
    outOfView,
    filtered: ownFilter,
  });
  return records;
}
export const MIN_SORT_HEADING_ROWS = 1;
export const headingRowCountByFreeze = (state: PageState, reads: WorkbookReads): number =>
  Math.max(MIN_SORT_HEADING_ROWS, sheetOfViewOrEmpty(state, reads).frozenRowCount);
export const headingRowCountByFilter = (state: PageState, reads: WorkbookReads): number =>
  Math.max(MIN_SORT_HEADING_ROWS, rowBelowOwnFilterButtonsAt(state, reads, state.activeCell));
export const sortColumnIndex = (state: PageState, reads: WorkbookReads, columnId: ColumnId | null): number | null =>
  reads.columnIndexOf(state.sheetId, columnId ?? state.activeCell.columnId);
export const canSortRange = (state: PageState, reads: ReadsWithTextMeasurer): boolean => rangeSortArea(state, reads) !== null;
export const rangeSortColumnLetters = (state: PageState, reads: ReadsWithTextMeasurer, columnId: ColumnId | null): string | null =>
  rangeSortPlan(state, reads, 'selection', columnId)?.column ?? null;
export const sortHoldsCache = new WeakMap<SheetRead, Map<string, SortHoldsOfColumn | null>>();
export const RECORDS_VIEW_SAMPLE_ROWS = 20;
export const RECORDS_VIEW_COLUMN_WIDTHS = {
  ofCharacter: 8,
  besideText: 28,
  besideName: 72,
  widest: 320,
};
export const recordsViewCache = new WeakMap<WorkbookReads, RecordsViewCached>();
