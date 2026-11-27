/** Default values and value limits of cells, cells changed from their defaults, resetting them. */
import type { CellBlock, Edit, SheetId } from '@open-artifact/sheets-core';
import type { CellId, SheetRead, WorkbookReads } from '../model/workbook.ts';
import type { CellArea, CellSelection } from '../selection/model.ts';
import type { PageState } from './initial-state.ts';
import type { IfQueued, PageEvent } from './event-reducer.ts';
import type { PageTransition } from './transitions.ts';
import type { DefaultsDone, WrittenValueLimits } from '../messages/defaults-and-limits.ts';
import type { DefaultAndLimitsChosen, DefaultAndLimitsShown, DefaultOrLimitField } from '../ui/defaults-and-limits-dialog.tsx';
import type { ShownAndEdited } from '@open-artifact/sheets-core';
import { mergedAreaOrCellOf, activeAnchorCell, isSameCell, selectedArea } from '../selection/model.ts';
import { areasOfAllRanges, someAreaHasCell, hasOtherRanges, allRangesOf, actOnEveryRange } from '../selection/several-ranges.ts';
import { sharedFormatOfAllRanges } from '../selection/shared-format.ts';
import { selectionOfShownPieces } from '../tables/filtered-rows.ts';
import { areasToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { cellRefOf, areasOverlap } from '../model/workbook.ts';
import { isDefaultsDialogRefusal } from '../model/refusals.ts';
import { IF_QUEUED_DEFAULTS, queueEdit } from '../model/edit-effects.ts';
import { cellBlockOfSelection } from '../model/cell-blocks.ts';
import { withNoEffects } from './transitions.ts';
import { protectedAreasOf } from './protection.ts';

/** A cell that holds something other than its default value, with the area it covers. */
export interface ChangedCell {
  cellId: CellId;
  area: CellArea;
  held: string;
  defaultValue: string;
}
/** The cells of a sheet that hold something other than their default value, top to bottom. */
export function cellsChangedFromDefaults(reads: WorkbookReads, sheetId: SheetId): ChangedCell[] {
  let changed = reads.cellsChangedFromDefaultsIn(sheetId);
  let sheet = reads.sheetAsItStands(sheetId);
  if (changed.length === 0 || sheet === null) return NO_CHANGED_CELLS;
  let cached = changedCellsBySheet.get(sheet);
  if (cached !== undefined) return cached;
  let cells = changed.flatMap(({ r, c, held, defaultValue }): ChangedCell[] => {
    let cellId: CellId = {
      sheetId,
      rowId: r,
      columnId: c,
    };
    let area = mergedAreaOrCellOf(reads, cellId);
    return area === null
      ? []
      : [
          {
            cellId,
            area,
            held,
            defaultValue,
          },
        ];
  });
  return (
    cells.sort(({ area: one }, { area: other }) =>
      one.topRowIndex === other.topRowIndex ? one.leftColumnIndex - other.leftColumnIndex : one.topRowIndex - other.topRowIndex,
    ),
    changedCellsBySheet.set(sheet, cells),
    cells
  );
}
export function defaultValueOfActiveCell(state: PageState, reads: WorkbookReads): string | null {
  let changed = cellsChangedFromDefaults(reads, state.activeCell.sheetId);
  if (changed.length === 0) return null;
  let anchor = activeAnchorCell(state, reads);
  return changed.find((cell) => isSameCell(cell.cellId, anchor))?.defaultValue ?? null;
}
/** The changed cells in the selection that the person may reset: shown, and not protected from them. */
export function changedCellsInSelection(state: PageState, reads: WorkbookReads): ChangedCell[] {
  let { sheetId } = state.activeCell;
  let changed = cellsChangedFromDefaults(reads, sheetId);
  if (changed.length === 0) return NO_CHANGED_CELLS;
  let areas = areasOfAllRanges(state, reads);
  let rowsOutOfView = state.rowsOutOfViewByOwnFilters.get(sheetId);
  return changed.filter(
    (cell) =>
      someAreaHasCell(areas, cell.area.topRowIndex, cell.area.leftColumnIndex) &&
      rowsOutOfView?.has(cell.cellId.rowId) !== true &&
      !isChangedCellKeptFromViewer(state, reads, cell),
  );
}
/** What "reset to default" would do for the selection: the value it goes back to, when one cell changed. */
export interface ResetOfSelection {
  to: string | null;
}
/** What "reset to default" would do for the selection; null when nothing in it changed. */
export function resetOfSelection(state: PageState, reads: WorkbookReads): ResetOfSelection | null {
  let [first, second] = changedCellsInSelection(state, reads);
  if (first === undefined) return null;
  return {
    to: second === undefined ? first.defaultValue : null,
  };
}
export function rangeHoldsDefaultableValue(reads: WorkbookReads, state: CellSelection): boolean {
  let area = selectedArea(state, reads);
  return (area === null ? [] : reads.filledCellsIn(state.activeCell.sheetId, area)).some((cellId) =>
    INPUT_KINDS_KEPT_AS_DEFAULTS.has(reads.cellOf(cellId)?.input.kind ?? ''),
  );
}
/** What each selected cell holds becomes its default value; ranges holding nothing are left out. */
export function saveHeldValuesAsDefaults(state: PageState, reads: WorkbookReads): PageTransition {
  let skipsEmptyRanges = hasOtherRanges(state) && allRangesOf(state).some((range) => rangeHoldsDefaultableValue(reads, range));
  return queueDefaultsEditOnEveryRange(
    {
      ...state,
      menu: null,
    },
    reads,
    (cells) => ({
      kind: 'setDefaultValuesAndLimits',
      cells,
      defaultValue: {
        kind: 'whatEachCellHolds',
      },
    }),
    {
      what: 'defaultsSaved',
    },
    (range) => skipsEmptyRanges && !rangeHoldsDefaultableValue(reads, range),
  );
}
/** A field of the default-and-limits form: mixed across the selection, none, blank, or text. */
export function fieldOfDefaultOrLimit(isShared: boolean, value: ShownAndEdited | null): DefaultOrLimitField {
  if (!isShared)
    return {
      kind: 'mixed',
    };
  if (value === null)
    return {
      kind: 'none',
    };
  let { textToEdit } = value;
  return textToEdit === ''
    ? {
        kind: 'blank',
      }
    : {
        kind: 'text',
        text: textToEdit,
      };
}
export function defaultAndLimitsFormOf(state: PageState, reads: WorkbookReads): DefaultAndLimitsShown | null {
  let ofActiveCell = reads.defaultValueAndLimitsOf(activeAnchorCell(state, reads));
  let shared = sharedFormatOfAllRanges(selectionOfShownPieces(state, reads, 'theFirstParts'), reads);
  if (ofActiveCell === null || shared === null) return null;
  return {
    cells: areasToA1AsStored(areasOfAllRanges(state, reads), ownRowOrderOfSheet(reads, state.sheetId)),
    defaultValue: fieldOfDefaultOrLimit(shared.defaultValue !== null, ofActiveCell.defaultValue),
    minimum: fieldOfDefaultOrLimit(shared.valueLimits !== null, ofActiveCell.minimum),
    maximum: fieldOfDefaultOrLimit(shared.valueLimits !== null, ofActiveCell.maximum),
    takesLimits: shared.cellControl === null || shared.cellControl.kind === 'none',
    isOfCheckboxes: shared.cellControl?.kind === 'checkbox',
    longestDefault: reads.limitsOfDefaultValues().longestDefaultValueInCharacters,
    refused: null,
  };
}
/** Saving the form: a blank default removes it; limits are read as typed in the active cell. */
export function saveDefaultAndLimits(state: PageState, reads: WorkbookReads, { defaultValue, limits }: DefaultAndLimitsChosen): PageTransition {
  if (defaultValue === null && limits === null)
    return withNoEffects({
      ...state,
      menu: null,
    });
  let typedIn = cellRefOf(activeAnchorCell(state, reads));
  return queueDefaultsEditOnEveryRange(
    state,
    reads,
    (cells) => ({
      kind: 'setDefaultValuesAndLimits',
      cells,
      ...(defaultValue !== null && {
        defaultValue:
          defaultValue.trim() === ''
            ? {
                kind: 'none',
              }
            : {
                kind: 'typed',
                text: defaultValue,
              },
      }),
      ...(limits !== null && {
        limits: {
          typedIn,
          ...limits,
        },
      }),
    }),
    {
      what: 'defaultAndLimitsSaved',
    },
  );
}
/** The form stays open on a refusal it shows itself; any other answer closes it. */
export function closeDefaultsMenuWhenAnswered(state: PageState, event: PageEvent): PageState {
  if (event.kind !== 'editAnswered' || event.edit.kind !== 'setDefaultValuesAndLimits') return state;
  return (event.outcome.kind === 'refused' && isDefaultsDialogRefusal(event.outcome.refusal)) || defaultAndLimitsOfMenu(state.menu) === null
    ? state
    : {
        ...state,
        menu: null,
      };
}
/** A refusal the form shows: null when the form is not open or the refusal is not one of its own. */
export function noteDefaultsRefused(state: PageState, refusal: string): PageState | null {
  let { menu } = state;
  let form = defaultAndLimitsOfMenu(menu);
  return menu === null || form === null || !isDefaultsDialogRefusal(refusal)
    ? null
    : {
        ...state,
        menu: {
          ...menu,
          defaultAndLimits: {
            ...form,
            refused: {
              why: refusal,
            },
          },
        },
      };
}
export function hasValueLimits(reads: WorkbookReads, cellId: CellId): boolean {
  let limits = reads.sharedFormatBetween(cellId, cellId)?.valueLimits ?? null;
  return limits !== null && (limits.minimum !== null || limits.maximum !== null);
}
/** The limits of a cell an entry was refused for, written in the cell's number format. */
export function valueLimitsOfEntry(reads: WorkbookReads, edit: Edit): WrittenValueLimits | null {
  if (edit.kind !== 'enter') return null;
  let cellId: CellId = {
    sheetId: edit.sheetId,
    rowId: edit.cell.r,
    columnId: edit.cell.c,
  };
  let limits = reads.sharedFormatBetween(cellId, cellId)?.valueLimits ?? null;
  if (limits === null || !hasValueLimits(reads, cellId)) return null;
  let { pattern } = reads.formatOf(cellId).numberFormat;
  let written = (value: number | null): string | null =>
    value === null
      ? null
      : (reads.shownWithRoomForAll(
          {
            kind: 'number',
            value,
          },
          pattern,
        ) ?? String(value));
  return {
    minimum: written(limits.minimum),
    maximum: written(limits.maximum),
  };
}
export const NO_CHANGED_CELLS: ChangedCell[] = [];
export const changedCellsBySheet = new WeakMap<SheetRead, ChangedCell[]>();
export const isChangedCellKeptFromViewer = (state: PageState, reads: WorkbookReads, { cellId, area }: Pick<ChangedCell, 'cellId' | 'area'>): boolean =>
  protectedAreasOf(state, reads, cellId.sheetId).some(
    (protectedArea) => protectedArea.isKeptFromViewer && areasOverlap(protectedArea.area, area),
  );
export const DEFAULTS_EDIT_OPTIONS = {
  ...IF_QUEUED_DEFAULTS,
  select: null,
} satisfies Omit<IfQueued, 'done'>;
/** One defaults edit for each selected range, made from the range's cell block. */
export const queueDefaultsEditOnEveryRange = (
  state: PageState,
  reads: WorkbookReads,
  editOf: (cells: CellBlock) => Edit,
  done: DefaultsDone,
  skips: (range: PageState) => boolean = () => false,
): PageTransition =>
  actOnEveryRange(
    {
      ...state,
      lastDone: null,
      notice: null,
    },
    (range) => {
      let cells = skips(range) ? null : cellBlockOfSelection(range, reads, range);
      return cells === null
        ? withNoEffects(range)
        : queueEdit(range, editOf(cells), {
            ...DEFAULTS_EDIT_OPTIONS,
            done,
          });
    },
  );
export const INPUT_KINDS_KEPT_AS_DEFAULTS = new Set<string>(['number', 'text', 'boolean', 'dropdownOption']);
export const resetSelectionToDefaults = (state: PageState, reads: WorkbookReads): PageTransition =>
  queueDefaultsEditOnEveryRange(
    {
      ...state,
      menu: null,
    },
    reads,
    (cells) => ({
      kind: 'resetCellsToDefaultValues',
      cells,
    }),
    {
      what: 'defaultsReset',
      count: changedCellsInSelection(state, reads).length,
    },
  );
export const defaultAndLimitsOfMenu = (menu: PageState['menu']): DefaultAndLimitsShown | null =>
  menu?.holds === 'defaultAndLimits' ? (menu.defaultAndLimits ?? null) : null;
