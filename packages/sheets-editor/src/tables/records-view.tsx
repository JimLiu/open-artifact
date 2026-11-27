import * as React from 'react';
import { Button } from '../kit/button.tsx';
import { Icon } from '../kit/icon.tsx';
import { Menu } from '../kit/menu.tsx';
import { ResizeHandle } from '../kit/resize-handle.tsx';
import { ContentsBox } from '../ui/contents-box.tsx';
import { useLatestCallback } from '../ui/latest-callback.ts';
import { SORT_DIRECTION_ICONS } from '../ui/icons/sort-direction.tsx';
import { clampColumnWidth } from '../grid/geometry.ts';
import { MAX_COLUMN_WIDTH } from '../model/line-sizes.ts';
import { isSameCell } from '../selection/model.ts';
import { filterByColumnLabel } from './filter-messages.ts';
import { resizeColumnsLabel } from '../i18n/grid-action-labels.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { connectedTableMessages } from './connected-table-messages.ts';
import type { ColumnId, SheetId } from '@open-artifact/sheets-core';
import type { CellId } from '../model/workbook.ts';
import type { RecordColumn, RecordsOfTable } from './sort.ts';

/** A cell of the records: its line (0 is the names) and its column. */
export interface CellOfRecords {
  line: number;
  columnId: ColumnId;
}
/** What the find bar found in the records. */
export interface FoundInRecords {
  columnsByLine: Map<number, Set<ColumnId>>;
  goneTo: CellOfRecords | null;
  timesGoneToCell: number;
  isBarUp: boolean;
}
/** The selection as the records show it. */
export interface SelectedInRecords {
  lines: { first: number; end: number };
  leftColumnIndex: number;
  columnCount: number;
  active: CellOfRecords | null;
  corner: CellOfRecords;
}
/** Which way a scroll brings a cell into view: rows to the nearest edge, rows to the middle, or columns alone. */
export type RowsScrolledHow = 'nearest' | 'middle' | null;
/** What to scroll to bring the selection into view after a key. */
export interface ScrollToSelection {
  rows: boolean;
  columns: boolean;
}
/** A column being sized. */
export interface SizingOfColumn {
  columnId: ColumnId;
  atPress: number;
  width: number;
  isByMouse: boolean;
}
/** A drag across the records. */
export interface DraggingOverRecords {
  at: { x: number; y: number };
  frame: number;
  over: CellId | null;
}
/** How a column's sizing ends: kept, or dropped. */
export type SizingEnd = 'size' | 'drop';
/** Which column a records cell is in use with: the last one, or one between. */
export type ColumnInUse = 'last' | 'too';
export interface RecordsTableProps {
  records: RecordsOfTable;
  found: FoundInRecords | null;
  selected: SelectedInRecords | null;
  isLoading: boolean;
  zoom: number;
  scrollerRef: React.RefObject<HTMLTableElement | null>;
  /** Whether a pointer is picking a column. */
  isPointedIn: boolean;
  columnInUse: ColumnId | null;
  inUseFrom?: ColumnId | null;
  isViewOnly: boolean;
  onCellPicked: (cell: CellId, isExtended: boolean, scrollAfter?: () => void) => void;
  isEventUnfinished: () => boolean;
  onKeyForCells: (event: React.KeyboardEvent<HTMLTableElement>, scrollAfter: () => void) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  wasKeyPressedLast: () => boolean;
  onNamePressed: (columnId: ColumnId, button: HTMLButtonElement, shiftKey: boolean) => void;
  onCopyChosen: (column: RecordColumn, what: 'column' | 'reference') => void;
  onColumnSized: (sheetId: SheetId, columnId: ColumnId, width: number, whenRefused: () => void) => void;
}

export function recordsInnerBox(table: HTMLElement, headHeight: number): { left: number; right: number; top: number; bottom: number } {
  let box = table.getBoundingClientRect(),
    [left, top] = [box.left + table.clientLeft, box.top + table.clientTop];
  return {
    left,
    right: left + table.clientWidth,
    top: top + headHeight,
    bottom: top + table.clientHeight,
  };
}
export const RECORD_HEIGHT_PX = 32;
export const RECORDS_OVERSCAN = 12;
export const MIN_RECORD_COLUMN_WIDTH = 48;
export const RECORDS_EDGE_SCROLL_SPEED = 0.4;
export const clampLeastValueMost = (least: number, value: number, most: number): number => Math.max(least, Math.min(value, most));
export const headerCellsOf = (table: HTMLElement): HTMLTableCellElement[] => [...table.querySelectorAll('th')];
export const recordColumnWidth = (width: number): number => Math.max(MIN_RECORD_COLUMN_WIDTH, clampColumnWidth(width));
export const RecordsTable = React.memo(function (props: RecordsTableProps) {
  let { records, found, selected, isLoading, zoom, scrollerRef, isPointedIn, columnInUse } = props,
    [isFocusByKey, setIsFocusByKey] = React.useState(false),
    { recordCount } = records,
    [recordsBefore, setRecordsBefore] = React.useState(records);
  if (!records.areOnTheirWay && recordsBefore !== records) setRecordsBefore(records);
  let recordCountShown = (records.areOnTheirWay ? recordsBefore : records).recordCount,
    columns = !records.areOnTheirWay
      ? records.columns
      : records.columns.map((column) => {
          let columnBefore = recordsBefore.columns.find(({ columnId }) => columnId === column.columnId) ?? column,
            { widthInPixels } = column.isFitted ? columnBefore : column;
          return {
            ...column,
            widthInPixels,
            alignment: columnBefore.alignment,
          };
        }),
    [lastInUseIndex = -1, firstInUseIndex = -1] = [columnInUse, props.inUseFrom ?? columnInUse].map((columnId) =>
      columns.findIndex(({ columnId: each }) => each === columnId),
    ),
    inUseOfColumn = (index: number): ColumnInUse | undefined => {
      if (index === lastInUseIndex) return 'last';
      return (index - firstInUseIndex) * (index - lastInUseIndex) <= 0 && firstInUseIndex >= 0 && lastInUseIndex >= 0 ? 'too' : void 0;
    },
    [scrolled, setScrolled] = React.useState({
      top: 0,
      height: 0,
    });
  React.useLayoutEffect(() => {
    let scroller = scrollerRef.current;
    if (scroller === null) return;
    let measure = () =>
        setScrolled({
          top: scroller.scrollTop,
          height: scroller.clientHeight,
        }),
      observer = new ResizeObserver(measure);
    return (
      observer.observe(scroller),
      scroller.addEventListener('scroll', measure, { passive: true }),
      () => {
        (observer.disconnect(), scroller.removeEventListener('scroll', measure));
      }
    );
  }, [scrollerRef]),
    React.useLayoutEffect(() => {
      if (columnInUse === null) return;
      scrollerRef.current?.querySelector('[data-is-in-use="last"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [scrollerRef, columnInUse]);
  let rowHeight = RECORD_HEIGHT_PX * zoom,
    { line: goneToLine = null, columnId: goneToColumnId = null } = found?.goneTo ?? {},
    foundOf = (line: number, columnId: ColumnId | undefined): 'now' | 'too' | undefined =>
      columnId === void 0 || found?.columnsByLine.get(line)?.has(columnId) !== true
        ? void 0
        : line === goneToLine && columnId === goneToColumnId
          ? 'now'
          : 'too',
    firstLineDrawn = Math.max(0, Math.floor(scrolled.top / rowHeight) - RECORDS_OVERSCAN),
    endLineDrawn = Math.min(recordCount, Math.ceil((scrolled.top + scrolled.height) / rowHeight) + RECORDS_OVERSCAN),
    [widthsSet, setWidthsSet] = React.useState(new Map<ColumnId, number>()),
    widthOf = (column: RecordColumn): number => recordColumnWidth(widthsSet.get(column.columnId) ?? column.widthInPixels),
    sizingRef = React.useRef<SizingOfColumn | null>(null),
    setWidths = () => {
      let widths = columns.map(
        (column) =>
          `max(${(sizingRef.current?.columnId === column.columnId ? sizingRef.current.width : widthOf(column)) * zoom}px, 2 * var(--ui-gap-sm))`,
      );
      scrollerRef.current?.style.setProperty('--sheet-records-widths', widths.join(' '));
    };
  React.useLayoutEffect(setWidths);
  let scrollToCell = (cell: CellOfRecords, rowsHow: RowsScrolledHow, alsoColumn: boolean) => {
      let scroller = scrollerRef.current;
      if (scroller === null) return;
      let top = cell.line * rowHeight,
        [highest, lowest] = [top - rowHeight, top + rowHeight - scroller.clientHeight],
        nearest = Math.min(highest, Math.max(lowest, scroller.scrollTop));
      if (rowsHow === 'nearest') scroller.scrollTop = nearest;
      else if (rowsHow === 'middle' && nearest !== scroller.scrollTop) scroller.scrollTop = top - scroller.clientHeight / 2;
      let columnIndex = columns.findIndex(({ columnId }) => columnId === cell.columnId);
      if (alsoColumn)
        headerCellsOf(scroller)[columnIndex]?.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
        });
    },
    goToFound = useLatestCallback(() => {
      let goneTo = found?.goneTo ?? null;
      if (goneTo !== null) scrollToCell(goneTo, goneTo.line > 0 ? 'middle' : null, true);
    }),
    timesGoneToCell = found?.timesGoneToCell;
  React.useLayoutEffect(() => {
    if (timesGoneToCell !== void 0) goToFound();
  }, [goToFound, timesGoneToCell]);
  let [toScrollToSelection, setToScrollToSelection] = React.useState<ScrollToSelection | null>(null),
    scrollToSelection = useLatestCallback((how: ScrollToSelection) => {
      if (selected === null) return;
      let { lines, corner, columnCount } = selected,
        isAllLines = lines.first === 0 && lines.end > recordCount,
        scrollsRows = how.rows || (corner.line > 0 && !isAllLines);
      scrollToCell(corner, scrollsRows ? 'nearest' : null, how.columns || columnCount < columns.length);
    });
  React.useLayoutEffect(() => {
    if (toScrollToSelection !== null) scrollToSelection(toScrollToSelection);
  }, [scrollToSelection, toScrollToSelection]);
  let onKeyDown = (event: React.KeyboardEvent<HTMLTableElement>) => {
      if (event.target !== event.currentTarget || event.defaultPrevented || isPointedIn) return;
      let { key, shiftKey } = event,
        isCommand = event.ctrlKey || event.metaKey,
        isHomeOrEnd = key === 'Home' || key === 'End',
        isUpOrDown = /(?:Up|Down)$/u.test(key),
        scrollAfter = () =>
          setToScrollToSelection({
            rows: isUpOrDown || (isHomeOrEnd && isCommand),
            columns: !isUpOrDown,
          }),
        pageStep = ({ PageDown: 1, PageUp: -1 } as Partial<Record<string, number>>)[key];
      if (pageStep === void 0 || isCommand || event.altKey) return props.onKeyForCells(event, scrollAfter);
      if ((event.preventDefault(), selected === null)) return;
      let from = (shiftKey ? null : selected.active) ?? selected.corner,
        lines = pageStep * Math.max(1, Math.floor(scrolled.height / rowHeight) - 1),
        cell = records.cellAt(
          clampLeastValueMost(0, from.line + lines, recordCount),
          columns.findIndex(({ columnId }) => columnId === from.columnId),
        );
      return cell === null ? void 0 : props.onCellPicked(cell, shiftKey, scrollAfter);
    },
    draggingRef = React.useRef<DraggingOverRecords | null>(null),
    pickAtPoint = useLatestCallback((point: { x: number; y: number }, isExtended: boolean) => {
      let table = scrollerRef.current;
      if (table === null || recordCount === 0) return;
      let box = recordsInnerBox(table, rowHeight),
        [x, y] = [clampLeastValueMost(box.left, point.x, box.right), clampLeastValueMost(box.top, point.y, box.bottom - 1)],
        line = Math.floor((y - box.top + table.scrollTop) / rowHeight) + 1,
        distanceTo = (headerCell: HTMLTableCellElement) => {
          let { left, right } = headerCell.getBoundingClientRect();
          return Math.abs(x - clampLeastValueMost(left, x, right));
        },
        distances = headerCellsOf(table).map(distanceTo),
        cell = records.cellAt(Math.min(recordCount, line), distances.indexOf(Math.min(...distances))),
        over = draggingRef.current?.over ?? null;
      if (cell === null || (over !== null && isSameCell(over, cell))) return;
      if (draggingRef.current !== null) draggingRef.current.over = cell;
      props.onCellPicked(cell, isExtended);
    }),
    stopDragging = useLatestCallback(() => {
      if (draggingRef.current !== null) cancelAnimationFrame(draggingRef.current.frame);
      draggingRef.current = null;
    });
  React.useLayoutEffect(() => stopDragging, [stopDragging]);
  let scrollAtEdge = useLatestCallback((next: () => void) => {
      let [dragging, table] = [draggingRef.current, scrollerRef.current];
      if (dragging === null || table === null) return;
      dragging.frame = requestAnimationFrame(next);
      let box = recordsInnerBox(table, rowHeight),
        byX = dragging.at.x - clampLeastValueMost(box.left, dragging.at.x, box.right),
        byY = dragging.at.y - clampLeastValueMost(box.top, dragging.at.y, box.bottom);
      if ((byX === 0 && byY === 0) || props.isEventUnfinished()) return;
      (table.scrollBy(byX * RECORDS_EDGE_SCROLL_SPEED, byY * RECORDS_EDGE_SCROLL_SPEED), pickAtPoint(dragging.at, true));
    }),
    keepScrollingAtEdge = (): void => scrollAtEdge(keepScrollingAtEdge),
    isOnRecord = ({ target }: { target: EventTarget }): boolean => !isPointedIn && target instanceof Element && target.closest('.sheet-record') !== null,
    isSelected = (line: number, columnIndex: number): boolean =>
      selected !== null &&
      line >= selected.lines.first &&
      line < selected.lines.end &&
      columnIndex >= selected.leftColumnIndex &&
      columnIndex < selected.leftColumnIndex + selected.columnCount,
    activeId = React.useId(),
    isActive = (line: number, columnId: ColumnId | undefined): boolean => selected?.active?.line === line && selected.active.columnId === columnId,
    activeLine = selected?.active?.line,
    isActiveDrawn = activeLine === 0 || (activeLine !== void 0 && activeLine > firstLineDrawn && activeLine <= endLineDrawn),
    endSizing = (column: RecordColumn, how: SizingEnd) => {
      let width = sizingRef.current?.columnId === column.columnId ? sizingRef.current.width : null;
      if (width === null) return;
      if (((sizingRef.current = null), how === 'drop' || width === widthOf(column))) return setWidths();
      (setWidthsSet((widths) => new Map(widths).set(column.columnId, width)),
        props.onColumnSized(records.sheetId, column.columnId, width, () =>
          setWidthsSet((widths) => new Map([...widths].filter(([columnId, each]) => columnId !== column.columnId || each !== width))),
        ));
    },
    endSizingAndFocus = (column: RecordColumn, how: SizingEnd) => {
      (endSizing(column, how), scrollerRef.current?.focus({ preventScroll: true }));
    },
    namesId = React.useId();
  return (
    <ContentsBox
      onFocus={() => setIsFocusByKey(props.wasKeyPressedLast())}
      onKeyDown={props.onKeyDown}
      onMouseDown={isPointedIn ? (event) => event.preventDefault() : void 0}
    >
      <table
        ref={scrollerRef}
        role="grid"
        tabIndex={0}
        aria-label={records.name}
        aria-rowcount={recordCount + 1}
        aria-readonly
        aria-multiselectable
        aria-activedescendant={isActiveDrawn ? activeId : void 0}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if ((stopDragging(), !isOnRecord(event) || event.pointerType === 'touch' || event.button !== 0)) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          let at = { x: event.clientX, y: event.clientY };
          ((draggingRef.current = { at, frame: 0, over: null }), pickAtPoint(at, event.shiftKey), keepScrollingAtEdge());
        }}
        onPointerMove={(event) => {
          if (event.buttons === 0) stopDragging();
          if (draggingRef.current === null) return;
          ((draggingRef.current.at = { x: event.clientX, y: event.clientY }), pickAtPoint(draggingRef.current.at, true));
        }}
        onLostPointerCapture={stopDragging}
        onContextMenu={stopDragging}
        onPointerUp={(event) => {
          if (isOnRecord(event) && event.pointerType === 'touch') pickAtPoint({ x: event.clientX, y: event.clientY }, false);
        }}
        aria-roledescription={connectedTableMessages.connectedTable()}
        className="sheet-records"
        data-uncommentable=""
        style={{
          fontSize: `calc(var(--ui-font-size-body) * ${zoom})`,
        }}
        data-are-loading={isLoading || void 0}
        data-is-focus-by-key={isFocusByKey}
        data-is-under-find-bar={found?.isBarUp === true || void 0}
      >
        <thead>
          <tr aria-rowindex={1} className="sheet-records-names" style={{ height: rowHeight }}>
            {columns.map((column, columnIndex) => (
              <th
                key={column.columnId}
                scope="col"
                id={isActive(0, column.columnId) ? activeId : void 0}
                aria-selected={isSelected(0, columnIndex)}
                data-is-active={isActive(0, column.columnId) || void 0}
                aria-label={column.name}
                data-alignment={column.alignment}
                aria-sort={column.sorted ?? void 0}
                data-is-in-use={inUseOfColumn(columnIndex)}
                data-found={foundOf(0, column.columnId)}
              >
                {!isPointedIn && (
                  <Menu.Root modal={false}>
                    <Menu.Trigger
                      render={
                        <Button variant="ghost" size="xxs" iconOnly icon="DotsHorizontal" className="sheet-records-more" aria-label={sheetMessages.moreActions()} />
                      }
                    />
                    <Menu.Popup align="start" finalFocus={scrollerRef}>
                      <Menu.Item onClick={() => props.onCopyChosen(column, 'column')}>{connectedTableMessages.copyColumn()}</Menu.Item>
                      <Menu.Item onClick={() => props.onCopyChosen(column, 'reference')}>{connectedTableMessages.copyNameForFormulas()}</Menu.Item>
                    </Menu.Popup>
                  </Menu.Root>
                )}
                <button
                  type="button"
                  disabled={!isPointedIn && !records.canBeFiltered}
                  className="sheet-records-name outline-none focus-visible:shadow-focus"
                  aria-label={isPointedIn ? void 0 : filterByColumnLabel({ kind: 'named', name: column.name }, column.isFiltered)}
                  aria-haspopup={isPointedIn ? void 0 : 'dialog'}
                  aria-expanded={isPointedIn ? void 0 : columnInUse === column.columnId}
                  onClick={({ currentTarget, shiftKey }) => props.onNamePressed(column.columnId, currentTarget, shiftKey)}
                >
                  <bdi id={`${namesId}${column.columnId}`}>{column.name}</bdi>
                  {!isPointedIn && column.sorted !== null && (
                    <span aria-hidden data-is-on>
                      {SORT_DIRECTION_ICONS[column.sorted]}
                    </span>
                  )}
                  {!isPointedIn && (column.sorted === null || column.isFiltered) && (
                    <span aria-hidden data-is-on={column.isFiltered || void 0}>
                      <Icon name="FilterLines" size="xs" />
                    </span>
                  )}
                </button>
                {!isPointedIn && !props.isViewOnly && (
                  <ResizeHandle
                    side="inline-end"
                    className="sheet-records-edge end-px"
                    aria-label={resizeColumnsLabel(1)}
                    aria-describedby={`${namesId}${column.columnId}`}
                    aria-valuenow={widthOf(column)}
                    aria-valuemin={MIN_RECORD_COLUMN_WIDTH}
                    aria-valuemax={MAX_COLUMN_WIDTH}
                    onResizeStart={() => {
                      let { columnId } = column,
                        width = sizingRef.current?.columnId === columnId ? sizingRef.current.width : widthOf(column);
                      sizingRef.current = {
                        columnId,
                        atPress: width,
                        width,
                        isByMouse: false,
                      };
                    }}
                    onMouseDown={({ button, currentTarget }) => {
                      if (button !== 0 || sizingRef.current === null) return;
                      ((sizingRef.current.isByMouse = true), currentTarget.focus({ preventScroll: true }));
                    }}
                    onResize={(by) => {
                      let [sizing, table] = [sizingRef.current, scrollerRef.current];
                      if (sizing === null || table === null) return;
                      let isRightToLeft = getComputedStyle(table).direction === 'rtl';
                      ((sizing.width = recordColumnWidth(sizing.atPress + (isRightToLeft ? -by : by) / zoom)), setWidths());
                    }}
                    onResizeEnd={(isSized) => {
                      if (sizingRef.current?.isByMouse === true) endSizingAndFocus(column, isSized ? 'size' : 'drop');
                    }}
                    onKeyDown={({ currentTarget }) => {
                      if (sizingRef.current?.isByMouse === true) endSizingAndFocus(column, 'drop');
                      else
                        currentTarget.scrollIntoView({
                          block: 'nearest',
                          inline: 'nearest',
                        });
                    }}
                    onKeyUp={() => {
                      if (sizingRef.current?.isByMouse === false) endSizing(column, 'size');
                    }}
                    onBlur={() => endSizing(column, 'drop')}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody style={{ height: recordCountShown * rowHeight }}>
          {Array.from({ length: Math.max(0, endLineDrawn - firstLineDrawn) }, (_, index) => firstLineDrawn + index).map((line) => (
            <tr key={line} aria-rowindex={line + 2} className="sheet-record" style={{ height: rowHeight, top: line * rowHeight }}>
              {records.textsOf(line).map((text, columnIndex) => (
                <td
                  key={columns[columnIndex]?.columnId}
                  id={isActive(line + 1, columns[columnIndex]?.columnId) ? activeId : void 0}
                  aria-selected={isSelected(line + 1, columnIndex)}
                  data-is-active={isActive(line + 1, columns[columnIndex]?.columnId) || void 0}
                  data-alignment={columns[columnIndex]?.alignment}
                  data-found={foundOf(line + 1, columns[columnIndex]?.columnId)}
                >
                  <bdi>{text}</bdi>
                </td>
              ))}
            </tr>
          ))}
          {records.areAllFilteredOut && (
            <tr className="sheet-records-none">
              <td>{connectedTableMessages.noRowsMatch()}</td>
            </tr>
          )}
        </tbody>
      </table>
    </ContentsBox>
  );
});
