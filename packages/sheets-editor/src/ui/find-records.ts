/** Find hits laid out by record line, for the records view. */
import { indexOfActiveFindHit } from './find.ts';
import type { Find, PageState } from '../state/initial-state.ts';
import type { RecordsOfTable } from '../tables/sort.ts';
import type { FoundInRecords } from '../tables/records-view.tsx';
import type { ColumnId } from '@open-artifact/sheets-core';
import type { CellId } from '../model/workbook.ts';

interface FoundInRecordsCached {
  records: RecordsOfTable;
  activeCell: CellId;
  found: FoundInRecords;
}

let foundInRecordsCache = new WeakMap<Find, FoundInRecordsCached>();

export function foundInRecordsOf(state: Pick<PageState, 'find' | 'activeCell'>, records: RecordsOfTable): FoundInRecords | null {
  let { find, activeCell } = state;
  if (find === null) return null;
  let cached = foundInRecordsCache.get(find);
  if (cached?.records === records && cached.activeCell === activeCell) return cached.found;
  let columnsByLine = new Map<number, Set<ColumnId>>();
  for (let { cellId } of find.hits) {
    let line = records.lineOf(cellId);
    if (line !== null) columnsByLine.set(line, (columnsByLine.get(line) ?? new Set<ColumnId>()).add(cellId.columnId));
  }
  let goneToLine = indexOfActiveFindHit(state) === null ? null : records.lineOf(activeCell);
  let found: FoundInRecords = {
    columnsByLine,
    goneTo:
      goneToLine === null
        ? null
        : {
            line: goneToLine,
            columnId: activeCell.columnId,
          },
    timesGoneToCell: find.timesGoneToCell,
    isBarUp: !find.isReplaceShown,
  };
  foundInRecordsCache.set(find, {
    records,
    activeCell,
    found,
  });
  return found;
}
