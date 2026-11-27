import { pivotTableCellsOfSheet, pivotTableOfSidePane, isCellInTableOfPivot } from '../tables/pivot-tables.ts';
import { isSameCell } from '../selection/model.ts';
import { withNoEffects } from './transitions.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { cellRefOf } from '../model/workbook.ts';
import type { PivotTable, PivotTableAtAnswer, Refused, SheetId, TableOfASheet } from '@open-artifact/sheets-core';
import type { PageState } from './initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { PageTransition } from './transitions.ts';
/** A pivot table that no longer matches its records; `isTableClear` when it reads a table, so updating it is clear. */
export interface PivotTableOutOfDate {
  at: CellId;
  isTableClear: boolean;
}
/**
 * How a pivot table stands against its records: null while unread, [] when it matches.
 * A pivot table over a table is out of date and clear; one over records summed in part is not clear.
 */
export function pivotTableOutOfDateOf(reads: WorkbookReads, cell: CellId): PivotTableOutOfDate[] | null {
  let answer = reads.pivotTableAt(cell);
  if (answer === null) return null;
  let read = answer.kind === 'pivotTableAt' ? answer.read : null;
  if (read === null || read.pivotTable === null || read.readsJustTheRecords) return [];
  if (read.table !== null)
    return [
      {
        at: cell,
        isTableClear: true,
      },
    ];
  let { source, values } = read.pivotTable;
  let tables = reads.tablesOfSheet(source.sheetId);
  if (tables === null) return null;
  let headerCells: CellId[] = values.map(({ column }) => ({
    sheetId: source.sheetId,
    rowId: source.headerRow,
    columnId: column,
  }));
  let isSumOfSomeRecords = (table: TableOfASheet): boolean =>
    table.basis.kind === 'assumed' &&
    table.basis.whyNotRecognized === 'sumOfSomeRecords' &&
    headerCells.some((headerCell) => isCellInTableOfPivot(reads, table, headerCell));
  return tables.kind !== 'refused' && tables.tables.some(isSumOfSomeRecords)
    ? [
        {
          at: cell,
          isTableClear: false,
        },
      ]
    : [];
}
export function withPivotTablesOutOfDate(state: PageState, reads: WorkbookReads): PageState {
  if (sheetCheckedForPivotTables.get(reads) === state.sheetId) return state;
  let outOfDateBefore = state.pivotTablesOutOfDate;
  let cells = pivotTableCellsOfSheet(reads, state.sheetId).slice(0, MOST_PIVOT_TABLES_CHECKED);
  let answers = cells.map((cell) => pivotTableOutOfDateOf(reads, cell));
  if (answers.includes(null)) sheetCheckedForPivotTables.delete(reads);
  else sheetCheckedForPivotTables.set(reads, state.sheetId);
  let outOfDate = cells.flatMap(
    (cell, index): PivotTableOutOfDate[] => answers[index] ?? outOfDateBefore.filter((before) => isSameCell(before.at, cell)),
  );
  return JSON.stringify(outOfDate) === JSON.stringify(outOfDateBefore)
    ? state
    : {
        ...state,
        pivotTablesOutOfDate: outOfDate,
      };
}
/** The out-of-date pivot table the bar names: one over a table first. */
export function pivotTableOutOfDateOnBar(state: PageState): PivotTableOutOfDate | null {
  let pivotTableInPane = pivotTableOfSidePane(state);
  let isShown = ({ at: cell }: PivotTableOutOfDate): boolean =>
    cell.sheetId === state.sheetId && (pivotTableInPane === null || !isSameCell(pivotTableInPane.cellId, cell));
  let shown = state.pivotTablesOutOfDate.filter(isShown);
  return shown.find((outOfDate) => outOfDate.isTableClear) ?? shown[0] ?? null;
}
export function updatePivotTable(state: PageState, reads: WorkbookReads, cell: CellId): PageTransition {
  let answer: PivotTableAtAnswer | Refused | null = reads.pivotTableAt(cell);
  let pivotTable: PivotTable | null = answer?.kind === 'pivotTableAt' ? (answer.read?.pivotTable ?? null) : null;
  if (pivotTable === null) return withNoEffects(state);
  return queueEdit(
    state,
    {
      kind: 'changePivotTable',
      sheetId: cell.sheetId,
      cell: cellRefOf(cell),
      pivotTable,
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: {
        what: 'pivotTableUpdated',
      },
    },
  );
}
/** The most pivot tables of a sheet read to tell which are out of date. */
export const MOST_PIVOT_TABLES_CHECKED = 10;
/** The sheet whose pivot tables were checked against each read of the workbook. */
export const sheetCheckedForPivotTables = new WeakMap<WorkbookReads, SheetId>();
