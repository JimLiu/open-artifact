import type { ColumnId, SheetId } from '@open-artifact/sheets-core';
import { cellPaddingBeside, textLineMiddleY } from '../grid/cell-metrics.ts';
import { clampBetween, isSpanInSight } from '../grid/geometry.ts';
import { clampSpanToShown } from './own-filter-list.ts';
import { columnLabelOf } from '../format/conditional/editor-view.ts';
import { isColumnFiltered } from './filter-model.ts';
import type { ColumnSpanOfId, PlacedFilterButton, TableWithFilterButtons, TextLookOfHeaderCell } from './table-drawing.ts';
import type { GridPoint, PaneRect, ShownStretch, SpanOnScreen } from '../grid/geometry.ts';
import type { CellDensity } from '../grid/cell-metrics-values.ts';
/** Where the columns of a table found in sight are on screen, and the room its filter buttons leave at its end. */
export interface FoundTableSpan {
  table: SpanOnScreen;
  /** Where the cells in view end, which the button is kept clear of. */
  endOfView: number;
  takenAtEnd: number;
}
/** The grid as far as finding the found table under a point goes. */
export interface GridWithFoundTables {
  body: Pick<PaneRect, 'left' | 'top'>;
  areCellsHeld: boolean;
  editorBox: unknown;
  filterButtons: readonly Pick<PlacedFilterButton, 'isOfFoundTable' | 'tableKey' | 'left' | 'top'>[];
  foundTableOutlines: readonly (PaneRect & { tableKey: string })[];
}
export function roomAroundFilterButton(
  start: number,
  { showFrom, showTo }: ShownStretch,
): [roomBefore: number, roomAfter: number] | null {
  const [roomBefore, roomAfter] = [start - showFrom, showTo - start - FILTER_BUTTON_SIZE];
  return Math.min(roomBefore, roomAfter) <= -FILTER_BUTTON_SIZE ? null : [roomBefore, roomAfter];
}
export function foundTableKeyAtPointer(point: GridPoint, drawn: GridWithFoundTables, tableKey: string | null): string | null {
  let [x, y] = [point.x - drawn.body.left, point.y - drawn.body.top];
  if (drawn.areCellsHeld || drawn.editorBox !== null) return null;
  let button = drawn.filterButtons.find((one) => one.isOfFoundTable && one.tableKey === tableKey);
  let isNearButton = (before: number, below: number): boolean =>
    button !== undefined &&
    x >= button.left - before &&
    x < button.left + FILTER_BUTTON_SIZE + FILTER_BUTTON_HIT_MARGIN &&
    y >= button.top - FILTER_BUTTON_HIT_MARGIN &&
    y < button.top + FILTER_BUTTON_SIZE + below;
  if (isNearButton(FILTER_BUTTON_HIT_MARGIN, FILTER_BUTTON_HIT_MARGIN)) return tableKey;
  let outline =
    x < 0 || y < 0
      ? undefined
      : drawn.foundTableOutlines.find(({ left, top, width, height }) => x >= left && x < left + width && y >= top && y < top + height);
  if (outline !== undefined) return outline.tableKey;
  return isNearButton(FILTER_BUTTON_END_ROOM, 2 * FILTER_BUTTON_SIZE) ? tableKey : null;
}
export function filterButtonLeftInTable(across: ShownStretch, { table, endOfView, takenAtEnd }: FoundTableSpan): number {
  const tableEndShown = table.showFrom < across.showFrom ? Math.max(table.end, across.showFrom) : table.end;
  const lastLeft = endOfView - takenAtEnd - FILTER_BUTTON_HIT_MARGIN - FILTER_BUTTON_SIZE;
  return Math.min(tableEndShown + FILTER_BUTTON_END_ROOM, Math.max(lastLeft, table.start, table.showFrom));
}
export function filterButtonsOfTable(
  filterTable: TableWithFilterButtons,
  placeOfColumn: (columnId: ColumnId) => ColumnSpanOfId | null,
  rowSpan: SpanOnScreen,
  density: CellDensity,
  columnWithListOpen: ColumnId | null,
  textLookOfColumn: (columnIndex: number) => TextLookOfHeaderCell,
  foundTableSpan: FoundTableSpan | null = null,
  foundTableButtonLeft: number | null = null,
): PlacedFilterButton[] {
  const rowHeight = rowSpan.end - rowSpan.start;
  if (rowHeight < FILTER_BUTTON_SIZE) return [];
  const columnIndexOfColumn = (sheetId: SheetId, columnId: ColumnId) => placeOfColumn(columnId)?.columnIndex ?? null;
  return filterTable.columns.flatMap(({ c: columnId, name }): PlacedFilterButton[] => {
    const place = placeOfColumn(columnId);
    if (place === null) return [];
    const { start: acrossStart, end: acrossEnd } = place.across;
    const padding = cellPaddingBeside(density);
    if (foundTableButtonLeft !== null && foundTableButtonLeft < acrossEnd && acrossStart < foundTableButtonLeft + FILTER_BUTTON_SIZE) return [];
    const left =
      foundTableSpan === null ? Math.max(acrossStart, acrossEnd - padding - FILTER_BUTTON_SIZE) : filterButtonLeftInTable(place.across, foundTableSpan);
    const span =
      foundTableSpan === null
        ? place.across
        : {
            ...foundTableSpan.table,
            showFrom: Math.max(foundTableSpan.table.start, foundTableSpan.table.showFrom),
            showTo: foundTableSpan.endOfView + 1,
          };
    const clearAcross = roomAroundFilterButton(left, span);
    if (acrossEnd - acrossStart < FILTER_BUTTON_SIZE || clearAcross === null) return [];
    if (foundTableSpan !== null && !isSpanInSight(foundTableSpan.table)) return [];
    const { fontSizeInPoints, isAt, hiddenByBorderAtFoot } = textLookOfColumn(place.columnIndex);
    const textMiddle = textLineMiddleY(rowHeight, fontSizeInPoints, isAt, density, hiddenByBorderAtFoot);
    const top = rowSpan.start + clampBetween(Math.floor(textMiddle - FILTER_BUTTON_SIZE / 2), 0, rowHeight - FILTER_BUTTON_SIZE);
    const clearDown = roomAroundFilterButton(top, rowSpan);
    if (clearDown === null) return [];
    const [[cellLeft, cellWidth], [cellTop, cellHeight]] = [clampSpanToShown(place.across), clampSpanToShown(rowSpan)];
    return [
      {
        tableKey: filterTable.key,
        r: filterTable.table.header.lastRow,
        isOfFoundTable: filterTable.columnsOfFound !== undefined,
        isOfColumnOfFoundTable: filterTable.areColumnsOfFound === true,
        c: columnId,
        columnIndex: place.columnIndex,
        column: columnLabelOf(
          {
            columnIndexOf: columnIndexOfColumn,
          },
          filterTable.table.sheetId,
          {
            c: columnId,
            name,
          },
        ),
        left,
        top,
        clearAt: {
          left: clearAcross[0],
          right: clearAcross[1],
          top: clearDown[0],
          bottom: clearDown[1],
        },
        cell: {
          left: cellLeft,
          top: cellTop,
          width: cellWidth,
          height: cellHeight,
        },
        isOn: isColumnFiltered(filterTable.filter, columnId),
        isListOpen: columnId === columnWithListOpen,
      },
    ];
  });
}
export const FILTER_BUTTON_SIZE = 20;
export const FILTER_BUTTON_HIT_MARGIN = 2;
export const FILTER_BUTTON_END_ROOM = 8 + FILTER_BUTTON_HIT_MARGIN;
export const filterButtonCellKey = ({ r, c }: Pick<PlacedFilterButton, 'r' | 'c'>): string => `${r} ${c}`;
export const MAX_FILTER_BUTTON_FADE = 20;
export const FILTER_BUTTON_GAP = 2;
export const ROOM_AT_TABLE_END_FOR_FILTER_BUTTONS = 10;
