import type { CellPoint, ColumnPoint, RowPoint, SheetId, StoredFormula } from '@open-artifact/sheets-core';
import type { WorkbookReads } from './workbook.ts';
import type { CellArea } from '../selection/model.ts';
import { areaAsSeen } from './a1-references.ts';
import { tokenizeFormulaWithReferences } from '../formulas/tokenizer.ts';
import { referencesWithNamedRangesExpanded } from '../formulas/references.ts';
import type { ReferenceOnSheet } from '../formulas/references.ts';
export function areaOfReference(reads: WorkbookReads, reference: ReferenceOnSheet): CellArea | null {
  let { sheetId } = reference;
  let sheet = reads.listSheets().find((summary) => summary.sheetId === sheetId);
  if (sheet === undefined) return null;
  let ownRowOrder = sheet.ownRowOrder;
  let rowOf = ({ r: rowId }: RowPoint | CellPoint): number | null => (ownRowOrder === null ? reads.rowIndexOf(sheetId, rowId) : ownRowOrder.stored.indexOf(rowId));
  let columnOf = ({ c }: ColumnPoint | CellPoint): number | null => reads.columnIndexOf(sheetId, c);
  let rows: (number | null)[];
  let columns: (number | null)[];
  switch (reference.kind) {
    case 'cell':
      [rows, columns] = [[rowOf(reference.cell)], [columnOf(reference.cell)]];
      break;
    case 'range': {
      let corners = [reference.topLeft, reference.bottomRight];
      [rows, columns] = [corners.map(rowOf), corners.map(columnOf)];
      break;
    }
    case 'columns':
      rows = [reference.top === null ? 0 : rowOf(reference.top), sheet.rowCount - 1];
      columns = [reference.left, reference.right].map(columnOf);
      break;
    case 'rows':
      rows = [reference.top, reference.bottom].map(rowOf);
      columns = [reference.left === null ? 0 : columnOf(reference.left), sheet.columnCount - 1];
      break;
    // References to a column or a part of a connected table.
    case 'tableColumn':
      rows = [reference.hasItsHeading ? 0 : 1, sheet.rowCount - 1];
      columns = [reads.columnIndexOf(sheetId, reference.c)];
      break;
    case 'tablePart': {
      let { columns: partColumns, rows: partRows } = reference;
      rows = [partRows === 'records' ? 1 : 0, partRows === 'heading' ? 0 : sheet.rowCount - 1];
      columns =
        partColumns === null
          ? [0, sheet.columnCount - 1]
          : [partColumns.left, partColumns.right].map((columnId) => reads.columnIndexOf(sheetId, columnId));
      break;
    }
  }
  if (!isNoneMissing(rows) || !isNoneMissing(columns)) return null;
  let [topRow, leftColumn] = [Math.min(...rows), Math.min(...columns)];
  let areaAsStored = {
    topRowIndex: topRow,
    leftColumnIndex: leftColumn,
    rowCount: Math.max(...rows) - topRow + 1,
    columnCount: Math.max(...columns) - leftColumn + 1,
  };
  return areaAsSeen(areaAsStored, ownRowOrder);
}
export const isNoneMissing = (indexes: readonly (number | null)[]): indexes is number[] => !indexes.includes(null);
/** Whether a formula's text names a named range or a connected table (not as a function). */
export function textNamesARange(reads: WorkbookReads, text: StoredFormula): boolean {
  let connectedSheets = reads.listSheets().filter((sheet) => reads.connectedTableIn(sheet.sheetId) !== null);
  let named = [...reads.namedRanges().map(({ namedRange }) => namedRange), ...connectedSheets];
  let names = new Set(named.map(({ name }) => name.toUpperCase()));
  if (names.size === 0) return false;
  let tokens = tokenizeFormulaWithReferences(text);
  return tokens.some((token, index) => token.kind === 'name' && tokens[index + 1]?.kind !== 'open' && names.has(token.text.toUpperCase()));
}
/** The areas of the named ranges a formula reads, in one sheet. */
export const namedRangeAreasInSheet = (reads: WorkbookReads, sheetId: SheetId, { references }: Pick<StoredFormula, 'references'>): (CellArea | null)[] =>
  referencesWithNamedRangesExpanded(reads, {
    references: references.filter(({ kind }) => kind === 'namedRange'),
  })
    .filter((reference) => reference.sheetId === sheetId)
    .map((reference) => areaOfReference(reads, reference));
