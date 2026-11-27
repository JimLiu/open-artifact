import type { PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { LineSizes } from '../model/line-sizes.ts';
import type { CellArea } from '../selection/model.ts';
import type { CellsHeld } from '../charts/cells-held.ts';
import type { TableForChart } from '../charts/chart-code-ask.ts';
import { selectedArea, isSameArea } from '../selection/model.ts';
import { layoutOfView } from '../grid/layout.ts';
import { isRangeInSight, cellsAreaHeight, cellsAreaWidth } from '../grid/geometry.ts';
import { roomForChartIn, placeChartForArea, DEFAULT_CHART_SIZE } from '../charts/placement.ts';
import { heightOfAddedChartCard, scrollToPlacedView } from '../charts/placed-views.ts';
import { areaToChart, selectableTablesInSight, fullAreaOfTable, isTinyArea, areasByNearness } from '../selection/table-select.ts';
import { placedTablesOfSheet } from '../tables/finding.ts';
import { hasFilteredRowsIn } from '../tables/filtered-rows.ts';
import { heldAreaOf, sampleOfAreaForChart } from '../charts/cells-held.ts';
import { CHART_ASK_FIRST_ROWS, CHART_ASK_MAX_COLUMNS, MAX_TABLES_TOLD_FOR_CHART } from '../charts/chart-code-ask.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';

// Where a chart the agent adds goes, near where the person is, and the tables told to the agent for it.

/** The cell a new chart is anchored at. */
export interface PlaceForChart {
  rowIndex: number;
  columnIndex: number;
}
/** The tables told to the agent for a new chart, and the cells held for each one a chart can be drawn from here. */
export interface TablesForChartNearPerson {
  tables: TableForChart[];
  heldOf(id: string): CellsHeld | null;
}
/** A table in sight: its whole area and its headings. */
interface TableInSight {
  area: CellArea;
  headings: (string | null)[];
}
/** A table told to the agent, with the cells held for it. */
interface TableTold {
  held: CellsHeld | null;
  table: TableForChart;
}
export function shownLinesWithin(edges: LineSizes, offset: number, length: number, lineCount: number): number[] {
  let [first, last] = [edges.indexAt(offset), Math.min(edges.indexAt(offset + length), lineCount - 1)];
  return Array.from(
    {
      length: Math.max(0, last - first + 1),
    },
    (_value, index) => first + index,
  ).filter((line) => edges.sizeOf(line) > 0);
}
export function placeForChartNearPerson(state: PageState, reads: ReadsWithTextMeasurer): PlaceForChart | null {
  let [selected, layout] = [selectedArea(state, reads), layoutOfView(state, reads)];
  let room = roomForChartIn(reads, state.sheetId, layout);
  if (selected === null || room === null) return null;
  let { topRowIndex, leftColumnIndex } = selected;
  if (
    !isRangeInSight(
      {
        topRowIndex,
        leftColumnIndex,
        rowCount: 1,
        columnCount: 1,
      },
      state,
      layout,
      state,
    )
  )
    return null;
  let { rowEdges, columnEdges } = layout;
  let activeRow = reads.positionOfCell(state.activeCell)?.rowIndex ?? topRowIndex;
  let [activeRowTop, heightAboveFloats] = [rowEdges.startOf(activeRow) - state.scrollTop, cellsAreaHeight(state) - state.heightUnderWhatFloats];
  let viewKeepingActiveRow =
    activeRowTop < heightAboveFloats && activeRowTop + rowEdges.sizeOf(activeRow) > heightAboveFloats - heightOfAddedChartCard(state)
      ? {
          ...state,
          heightUnderWhatFloats: cellsAreaHeight(state) - activeRowTop,
        }
      : state;
  let isPlaceInSightAsIs = (rowIndex: number, columnIndex: number): boolean => {
    let scrolled = scrollToPlacedView(
      viewKeepingActiveRow,
      reads,
      {
        rowIndex,
        columnIndex,
        offsetFromAnchorCell: {
          xInPixels: 0,
          yInPixels: 0,
        },
        ...DEFAULT_CHART_SIZE,
      },
      heightOfAddedChartCard(state),
    );
    return scrolled.scrollTop === state.scrollTop && scrolled.scrollLeft === state.scrollLeft;
  };
  let rowsShown = shownLinesWithin(rowEdges, state.scrollTop, cellsAreaHeight(state) - DEFAULT_CHART_SIZE.heightInPixels, layout.rowCount);
  let columnsShown = shownLinesWithin(columnEdges, state.scrollLeft, cellsAreaWidth(state) - DEFAULT_CHART_SIZE.widthInPixels, layout.columnCount);
  let isSelectionBlank = reads.areaOnShowIn(state.sheetId, selected) === null;
  let charted = isSelectionBlank ? selected : (areaToChart(state, reads) ?? selected);
  let [firstRow, firstColumn] = [Math.max(charted.topRowIndex, room.firstRow), Math.max(charted.leftColumnIndex, room.firstColumn)];
  let startingPlaces: [number, number][] = isSelectionBlank
    ? [[firstRow, firstColumn]]
    : [
        [firstRow, charted.leftColumnIndex + charted.columnCount + 1],
        [charted.topRowIndex + charted.rowCount + 1, firstColumn],
      ];
  let farFromStart = (rowIndex: number, columnIndex: number): number =>
    Math.min(
      ...startingPlaces.map(
        ([startRow, startColumn]) =>
          Math.abs(rowEdges.startOf(startRow) - rowEdges.startOf(rowIndex)) +
          Math.abs(columnEdges.startOf(startColumn) - columnEdges.startOf(columnIndex)),
      ),
    );
  let place = rowsShown
    .flatMap((rowIndex) =>
      columnsShown.map((columnIndex) => ({
        rowIndex,
        columnIndex,
        far: farFromStart(rowIndex, columnIndex),
      })),
    )
    .toSorted((a, b) => a.far - b.far)
    .slice(0, MAX_CHART_PLACES_TRIED)
    .find(({ rowIndex, columnIndex, far }) => isPlaceInSightAsIs(rowIndex, columnIndex) && room.isRoomAt(rowIndex, columnIndex, !(isSelectionBlank && far === 0)));
  return place === void 0
    ? null
    : {
        rowIndex: place.rowIndex,
        columnIndex: place.columnIndex,
      };
}
export function tablesForChartNearPerson(state: PageState, reads: ReadsWithTextMeasurer): TablesForChartNearPerson | null {
  let { sheetId } = state;
  let [selected, charted] = [selectedArea(state, reads), areaToChart(state, reads)];
  if (selected === null) return null;
  let tablesInSight: TableInSight[] = selectableTablesInSight(state, reads, placedTablesOfSheet(state, reads, sheetId).all)
    .map((table) => ({
      area: fullAreaOfTable(table),
      headings: table.table.columns.map(({ name }) => name),
    }))
    .filter(({ area }) => !isTinyArea(area));
  let ofSelection: TableInSight | null =
    tablesInSight.find(({ area }) => charted !== null && isSameArea(area, charted)) ??
    (charted === null
      ? null
      : {
          area: charted,
          headings: [],
        });
  let told: TableTold[] = [];
  for (let candidate of [
    ...(ofSelection === null ? [] : [ofSelection]),
    ...areasByNearness(selected, tablesInSight, ({ area }) => area).filter((table) => table !== ofSelection),
  ]) {
    let { area, headings } = candidate;
    if (hasFilteredRowsIn(state, reads, area)) continue;
    let held = placeChartForArea(reads, sheetId, area) !== null ? heldAreaOf(reads, sheetId, area) : null;
    let sample =
      held === null
        ? {
            rowCount: area.rowCount,
            headings,
          }
        : sampleOfAreaForChart(reads, sheetId, area, [CHART_ASK_FIRST_ROWS, CHART_ASK_MAX_COLUMNS]);
    if (sample === null) continue;
    let range = areaToA1AsStored(area, ownRowOrderOfSheet(reads, sheetId));
    told.push({
      held,
      table: {
        id: `T${told.length + 1}`,
        range,
        isOfSelection: candidate === ofSelection,
        told: sample,
      },
    });
    if (told.length === MAX_TABLES_TOLD_FOR_CHART) break;
  }
  return told.every(({ held }) => held === null)
    ? null
    : {
        tables: told.map(({ table }) => table),
        heldOf: (id) => told.find(({ table }) => table.id === id)?.held ?? null,
      };
}
export const MAX_CHART_PLACES_TRIED = 600;
