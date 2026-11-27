/** The side pane listing cells changed from their defaults across shown sheets. */
import type { Edit } from '@open-artifact/sheets-core';
import type { CellId, SheetSummary, WorkbookReads } from '../model/workbook.ts';
import type { PageState } from './initial-state.ts';
import type { PageTransition } from './transitions.ts';
import type { ReadsWithTextMeasurer } from './controller.ts';
import type { ChangedCell } from './defaults-and-limits.ts';
import { areaRefBetween } from '../model/workbook.ts';
import { cellBlockOfCorners } from '../model/cell-blocks.ts';
import { mergedAreaOrCellOf, areaOfPosition } from '../selection/model.ts';
import { goToCells } from '../selection/go-to-cells.ts';
import { sheetPrefixForFormula } from '../formulas/references.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { queueEdit } from '../model/edit-effects.ts';
import { withNoEffects } from './transitions.ts';
import { showSheet } from './sheet-tabs.ts';
import { DEFAULTS_EDIT_OPTIONS, cellsChangedFromDefaults, isChangedCellKeptFromViewer } from './defaults-and-limits.ts';

/** What is done from the changed cells pane: reset every shown sheet, reset one cell, or go to it. */
export type ActionOnChangedCells = { kind: 'resetAll' } | { kind: 'reset'; cellId: CellId } | { kind: 'goTo'; cellId: CellId };
/** A changed cell as the pane lists it. */
export interface ChangedCellListed {
  cellId: CellId;
  held: string;
  defaultValue: string;
  address: string;
  mayBeReset: boolean;
}
/** What the changed cells pane shows. */
export interface ChangedCellsPane {
  listed: ChangedCellListed[];
  countNotListed: number;
  mayAnyBeReset: boolean;
}

export function showChangedCellsPane(state: PageState): PageState {
  let isShown = state.sidePane?.kind === 'changedCells';
  return {
    ...state,
    menu: null,
    dropdown: null,
    timesSidePaneAsked: state.timesSidePaneAsked + (isShown ? 1 : 0),
    sidePane: isShown
      ? state.sidePane
      : {
          kind: 'changedCells',
        },
  };
}
/** Resetting every shown sheet, one cell, or going to a changed cell from the pane. */
export function actOnChangedCells(state: PageState, reads: ReadsWithTextMeasurer, action: ActionOnChangedCells): PageTransition {
  if (state.sidePane?.kind !== 'changedCells') return withNoEffects(state);
  let queueReset = (edit: Edit, count: number): PageTransition =>
    queueEdit(
      {
        ...state,
        lastDone: null,
        notice: null,
      },
      edit,
      {
        ...DEFAULTS_EDIT_OPTIONS,
        done: {
          what: 'defaultsReset',
          count,
        },
      },
    );
  if (action.kind === 'resetAll') {
    let sheetIds = shownSheetsOf(reads).map(({ sheetId }) => sheetId);
    let resettable = sheetIds
      .flatMap((sheetId) => cellsChangedFromDefaults(reads, sheetId))
      .filter((cell) => !isChangedCellKeptFromViewer(state, reads, cell));
    return queueReset(
      {
        kind: 'resetSheetsToDefaultValues',
        sheetIds,
      },
      resettable.length,
    );
  }
  let { cellId } = action;
  if (action.kind === 'reset') {
    let cells = cellBlockOfCorners(reads, areaRefBetween(cellId, cellId));
    return cells === null
      ? withNoEffects(state)
      : queueReset(
          {
            kind: 'resetCellsToDefaultValues',
            cells,
          },
          1,
        );
  }
  let area = mergedAreaOrCellOf(reads, cellId);
  return area === null ? withNoEffects(state) : withNoEffects(goToCells(showSheet(state, reads, cellId.sheetId), reads, area));
}
/** What the pane lists: at most MOST_CHANGED_CELLS_LISTED cells, kept while the person and sheets stay the same. */
export function changedCellsPaneOf(state: PageState, reads: WorkbookReads): ChangedCellsPane | null {
  if (state.sidePane?.kind !== 'changedCells') return null;
  let sheets = shownSheetsOf(reads);
  let madeOf: unknown[] = [state.person, ...sheets.map(({ sheetId }) => reads.sheetAsItStands(sheetId))];
  let last = lastChangedCellsPane;
  if (last?.madeOf.length === madeOf.length && last.madeOf.every((part, index) => part === madeOf[index])) return last.drawn;
  let changed = sheets.flatMap(({ sheetId, name }) =>
    cellsChangedFromDefaults(reads, sheetId).map((cell): { changed: ChangedCell; name: string } => ({
      changed: cell,
      name,
    })),
  );
  let listed = changed.slice(0, MOST_CHANGED_CELLS_LISTED).map(({ changed: cell, name }): ChangedCellListed => {
    let { cellId, area, held, defaultValue } = cell;
    let topLeft = areaOfPosition({
      rowIndex: area.topRowIndex,
      columnIndex: area.leftColumnIndex,
    });
    let prefix = sheets.length === 1 ? '' : sheetPrefixForFormula(name);
    return {
      cellId,
      held,
      defaultValue,
      address: prefix + areaToA1AsStored(topLeft, ownRowOrderOfSheet(reads, cellId.sheetId)),
      mayBeReset: !isChangedCellKeptFromViewer(state, reads, cell),
    };
  });
  let drawn: ChangedCellsPane = {
    listed,
    countNotListed: changed.length - listed.length,
    mayAnyBeReset: changed.some(({ changed: cell }) => !isChangedCellKeptFromViewer(state, reads, cell)),
  };
  return (
    (lastChangedCellsPane = {
      madeOf,
      drawn,
    }),
    drawn
  );
}
export const MOST_CHANGED_CELLS_LISTED = 200;
export const shownSheetsOf = (reads: WorkbookReads): SheetSummary[] => reads.listSheets().filter(({ isHidden }) => !isHidden);
let lastChangedCellsPane: { madeOf: unknown[]; drawn: ChangedCellsPane } | null = null;
