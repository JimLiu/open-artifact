import type { IdRun, InputOfAWidget, MadeBy, Reference, SheetId } from '@open-artifact/sheets-core';
import type { CellId, SheetSummary, WorkbookReads } from '../model/workbook.ts';
import type { CellArea, CellSelection, RangeWalked } from '../selection/model.ts';
import type { PageState, SavedPlace } from './initial-state.ts';
import type { InteractiveWrote, PageEvent, PlaceAreaChanged, UndoOrRedoAnswered } from './event-reducer.ts';
import type { OfSitting } from '../store/workbook-sync.ts';
import type { PageTransition } from './transitions.ts';
import type { ChartOfView } from '../charts/placed-views.ts';
import { findSheetById } from '../grid/layout.ts';
import { cachedChartOfView } from '../charts/placed-views.ts';
import { withNoEffects } from './transitions.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { leadingRunCount, collapsedIndexRuns } from '../grid/line-runs.ts';
import { selectionAtCell, isSameCell, selectionAreaAndKind } from '../selection/model.ts';
import { readsAsStored } from '../model/workbook.ts';
import { columnLetters } from '../model/a1-references.ts';
import { formulaSpilledOverCell } from '../grid/entry-hints.ts';
import { editTextOfCell } from '../editor/start-entry.ts';
/** Where the page stands on a sheet: the selection and how far the grid is scrolled. */
export interface Place {
  sheetId: SheetId;
  activeCell: CellId;
  selectionCorner: CellId;
  rangeWalked?: RangeWalked | null;
  scrollLeft: number;
  scrollTop: number;
}
/** A place with the whole selection told, as a sheet opens on it. */
export type PlaceAtCell = Place & CellSelection;
/** A place kept as it was left, without the fingerprint of the lines its selection took. */
export type PlaceRestored = Place | Omit<SavedPlace, 'lines'>;
/** How many formulas of other sheets read a sheet, and the names of those sheets. */
export interface FormulasReadingSheet {
  count: number;
  sheetNames: [string, ...string[]];
}
/** How many formulas of the other sheets read what `readsIt` accepts, and the names of those sheets. */
export function formulasReadingFromOtherSheets(
  workbook: WorkbookReads,
  readsIt: (reference: Reference) => boolean,
  sheetIdLeftOut: SheetId | null,
): FormulasReadingSheet | null {
  let formulaCount: number = 0;
  let sheetNames: string[] = [];
  for (let { sheetId: otherSheetId, name: otherSheetName } of workbook.listSheets()) {
    if (otherSheetId === sheetIdLeftOut) continue;
    let countBefore = formulaCount;
    for (let row of workbook.cellsHeldByRow(otherSheetId).values())
      for (let columnId of row.columnsWithAFormula()) {
        let input = row.get(columnId)?.input;
        if (input?.kind === 'formula' && input.formula.references.some(readsIt)) formulaCount += 1;
      }
    if (formulaCount > countBefore) sheetNames.push(otherSheetName);
  }
  let [firstName, ...otherNames] = sheetNames;
  return firstName === undefined
    ? null
    : {
        count: formulaCount,
        sheetNames: [firstName, ...otherNames],
      };
}
/** Formulas of other sheets reading a sheet, directly or through a named range on it. */
export function formulasReadingSheet(workbook: WorkbookReads, sheetId: SheetId): FormulasReadingSheet | null {
  let namedRangeIds = new Set(
    workbook
      .namedRanges()
      .filter(({ liveCells }) => liveCells?.sheetId === sheetId)
      .map(({ namedRangeId }) => namedRangeId),
  );
  return formulasReadingFromOtherSheets(
    workbook,
    (reference) =>
      reference.kind === 'namedRange'
        ? namedRangeIds.has(reference.namedRangeId)
        : reference.sheetId === sheetId &&
          (reference.kind !== 'cell' ||
            (workbook.rowIndexOf(sheetId, reference.cell.r) !== null && workbook.columnIndexOf(sheetId, reference.cell.c) !== null)),
    sheetId,
  );
}
export const formulasReadingNamedRange = (workbook: WorkbookReads, namedRangeId: string): FormulasReadingSheet | null =>
  formulasReadingFromOtherSheets(workbook, (reference) => reference.kind === 'namedRange' && reference.namedRangeId === namedRangeId, null);
/** The bar over an interactive sheet: its view, the sheet's name, its code, and what it may reset, save as defaults or undo. */
export interface InteractiveSheet {
  viewId: string;
  name: string;
  code: ChartOfView;
  countOfCellsToReset: number;
  hasDefaultsToSave: boolean;
  hasChangesToUndo: boolean;
  hasBar: boolean;
}
/** What was done last to an interactive as a whole. */
export interface InteractiveDone {
  what: 'interactiveReset' | 'interactiveDefaultsSaved' | 'interactiveChangesUndone';
}
/** What made an edit of an interactive: the person's sitting at it, and their press in it. */
export type { MadeBy } from '@open-artifact/sheets-core';
/** The presses in one interactive sheet close together, undone together. */
export interface SittingInInteractive {
  viewId: string;
  id: string;
  press: number;
  editsAsked: number;
  pressesToUndo: number[];
  pressesToRedo: number[];
  /** The interactive's own number of the press last asked, or null when the page pressed (a reset). */
  pressInFrame: number | null;
  lastAskedAtMs: number;
}
/** When a press of an interactive came, and the id its sitting takes should it start one. */
export interface SittingTiming {
  atMs: number;
  idIfSittingStarts: string;
}
/** The place last written from an interactive sheet: its input and the row and column in it. */
export interface PlaceInInteractive {
  viewId: string;
  input: string;
  row: number;
  column: number;
}
/** The cell under the place last written from an interactive sheet, and what it holds. */
export interface CellOfInteractivePlace {
  sheetId: SheetId;
  sheetName: string;
  address: string;
  text: string;
}
/** The bar over an interactive sheet: reset, save defaults, undo in the sitting. */
export function interactiveBarOf(
  { sheetId, sittingInInteractive: sitting }: Pick<PageState, 'sheetId' | 'sittingInInteractive'>,
  workbook: WorkbookReads,
): InteractiveSheet | null {
  let sheet = findSheetById(workbook, sheetId);
  if (sheet === undefined || sheet.interactive === null) return null;
  let view = workbook.viewAsItStands(sheet.interactive);
  let countOfCellsToReset = view?.countOfCellsToReset ?? 0;
  let hasDefaultsToSave = view?.hasDefaultsToSave === true;
  let hasChangesToUndo = (sitting?.pressesToUndo.length ?? 0) > 0;
  return {
    viewId: sheet.interactive,
    name: sheet.name,
    code: cachedChartOfView(view),
    countOfCellsToReset,
    hasDefaultsToSave,
    hasChangesToUndo,
    hasBar: countOfCellsToReset > 0 || hasDefaultsToSave || hasChangesToUndo,
  };
}
/** The index `offset` lines into a span of two ends; null past its end. */
export function indexInSpan(offset: number, [one, other]: (number | null)[]): number | null {
  if (typeof one !== 'number' || typeof other !== 'number') return null;
  return offset > Math.abs(one - other) ? null : Math.min(one, other) + offset;
}
/** The cell under the place last written from the interactive sheet, and what it holds. */
export function cellOfInteractivePlace(
  { sheetId, placeInInteractive: place }: Pick<PageState, 'sheetId' | 'placeInInteractive'>,
  workbook: WorkbookReads,
): CellOfInteractivePlace | null {
  if (place === null || place.viewId !== interactiveOfSheet(workbook, sheetId)) return null;
  let stored = readsAsStored(workbook);
  let range = stored
    .viewAsItStands(place.viewId)
    ?.view.elements.flatMap((element): InputOfAWidget[] => element.inputs)
    ?.find(({ name }) => name === place.input)?.range;
  if (range === undefined) return null;
  let { sheetId: inputSheetId, topLeft, bottomRight } = range;
  let corners = [topLeft, bottomRight];
  let rowIndex = indexInSpan(
    place.row,
    corners.map(({ r: rowId }) => stored.rowIndexOf(inputSheetId, rowId)),
  );
  let columnIndex = indexInSpan(
    place.column,
    corners.map(({ c: columnId }) => stored.columnIndexOf(inputSheetId, columnId)),
  );
  if (rowIndex === null || columnIndex === null) return null;
  let cellId = stored.cellIdAt(inputSheetId, rowIndex, columnIndex);
  let sheetName = findSheetById(stored, inputSheetId)?.name;
  if (cellId === null || sheetName === undefined) return null;
  return {
    sheetId: inputSheetId,
    sheetName,
    address: `${columnLetters(columnIndex)}${rowIndex + 1}`,
    text: formulaSpilledOverCell(stored, cellId) ?? editTextOfCell(stored, cellId),
  };
}
export function isAreaReadByInteractive(state: PageState, workbook: WorkbookReads, { sheetId, area }: Partial<PlaceAreaChanged> = {}): boolean {
  let viewId = interactiveOfSheet(workbook, state.sheetId);
  if (viewId === null || area === null) return false;
  return (workbook.viewAsItStands(viewId)?.view.elements.flatMap((element): InputOfAWidget[] => element.inputs) ?? []).some(
    ({ range: { sheetId: inputSheetId, topLeft, bottomRight } }) => {
      let corners = [topLeft, bottomRight];
      // A place with no sheet reads no input, so `sheetId` and `area` are there past the first test.
      return (
        inputSheetId === sheetId &&
        spanReachesIndexes(
          area!.topRowIndex,
          area!.rowCount,
          corners.map(({ r: rowId }) => workbook.rowIndexOf(sheetId!, rowId)),
        ) &&
        spanReachesIndexes(
          area!.leftColumnIndex,
          area!.columnCount,
          corners.map(({ c: columnId }) => workbook.columnIndexOf(sheetId!, columnId)),
        )
      );
    },
  );
}
/** A sitting: the presses in one interactive sheet close together, undone together. */
export function sittingAfterPress(
  { sittingInInteractive: sitting }: Pick<PageState, 'sittingInInteractive'>,
  viewId: string,
  pressInFrame: number | null,
  { atMs, idIfSittingStarts }: SittingTiming,
): SittingInInteractive {
  let asked = {
    pressInFrame,
    lastAskedAtMs: atMs,
  };
  if (!(sitting?.viewId === viewId && atMs - sitting.lastAskedAtMs < SITTING_LASTS_MS && sitting.editsAsked < MOST_EDITS_IN_A_SITTING))
    return {
      viewId,
      id: idIfSittingStarts,
      ...{
        press: 0,
        editsAsked: 1,
        pressesToUndo: [],
        pressesToRedo: [],
      },
      ...asked,
    };
  let press = pressInFrame !== null && pressInFrame === sitting.pressInFrame ? sitting.press : sitting.press + 1;
  return {
    ...sitting,
    ...asked,
    press,
    editsAsked: sitting.editsAsked + 1,
  };
}
/** The interactive sheet wrote cells: the edit carries the sitting and press it belongs to. */
export function writeFromInteractivePress(state: PageState, workbook: WorkbookReads, event: InteractiveWrote): PageTransition {
  let { viewId, cells, press } = event;
  if (!workbook.listSheets().some(({ interactive }) => interactive === viewId)) return withNoEffects(state);
  let sitting = sittingAfterPress(state, viewId, press, event);
  let [firstCell] = cells;
  let placeInInteractive: PlaceInInteractive | null =
    firstCell === undefined
      ? state.placeInInteractive
      : {
          viewId,
          input: firstCell.input,
          row: firstCell.row,
          column: firstCell.column,
        };
  return queueEdit(
    {
      ...state,
      placeInInteractive,
      sittingInInteractive: sitting,
    },
    {
      kind: 'writeFromInteractive',
      viewId,
      cells: [...cells],
      madeBy: madeByOfSitting(sitting),
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: null,
    },
  );
}
/** Resetting the interactive sheet of the shown sheet, as one press of the sitting. */
export function editInteractiveOfSheet(state: PageState, workbook: WorkbookReads, timing: SittingTiming): PageTransition {
  let viewId = interactiveOfSheet(workbook, state.sheetId);
  if (viewId === null) return withNoEffects(state);
  let sitting = sittingAfterPress(state, viewId, null, timing);
  return queueEdit(
    {
      ...state,
      sittingInInteractive: sitting,
    },
    {
      kind: 'resetInteractive',
      viewId,
      madeBy: madeByOfSitting(sitting),
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: {
        what: 'interactiveReset',
      },
    },
  );
}
export function saveDefaultsOfInteractive(state: PageState, workbook: WorkbookReads): PageTransition {
  let viewId = interactiveOfSheet(workbook, state.sheetId);
  if (viewId === null) return withNoEffects(state);
  return queueEdit(
    state,
    {
      kind: 'saveDefaultsOfInteractive',
      viewId,
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: {
        what: 'interactiveDefaultsSaved',
      },
    },
  );
}
/** What may be undone or redone inside a sitting; 'undoOfAll' takes back every press of it. */
export type ReversalInInteractive = 'undoOfAPress' | 'undoOfAll' | 'redo';
/** Undo or redo inside the sitting; "undoOfAll" takes back every press of it. */
export function undoInInteractive(state: PageState, asked: ReversalInInteractive): PageTransition {
  let direction: 'undo' | 'redo' = asked === 'redo' ? 'redo' : 'undo';
  let sitting = state.sittingInInteractive;
  if (sitting === null)
    return withNoEffects({
      ...state,
      lastDone: {
        what: direction === 'undo' ? 'nothingToUndo' : 'nothingToRedo',
      },
    });
  let ofSitting: OfSitting = {
    sitting: sitting.id,
    isOfAll: asked === 'undoOfAll',
  };
  return {
    state,
    effects: [
      {
        kind: 'undoOrRedo',
        direction,
        ofSitting,
      },
    ],
  };
}
/** The presses left to undo and redo after the store answered an undo or redo of the sitting. */
export function sittingAfterUndoOrRedo(
  sitting: SittingInInteractive,
  { direction, outcome, ofSitting }: UndoOrRedoAnswered,
): SittingInInteractive | null {
  if (outcome.kind === 'refused' && ofSitting?.isOfAll !== true) return sitting;
  let [from, to] = direction === 'undo' ? [sitting.pressesToUndo, sitting.pressesToRedo] : [sitting.pressesToRedo, sitting.pressesToUndo];
  let press = from.at(-1);
  if (press === undefined) return outcome.kind === 'made' ? null : sitting;
  let isOfAll = ofSitting?.isOfAll === true;
  let fromNow = outcome.kind === 'refused' ? [press] : isOfAll || outcome.kind === 'nothingLeft' ? [] : from.slice(0, -1);
  let toNow = outcome.kind === 'made' ? [...to, press] : to;
  let [pressesToUndo, pressesToRedo] = direction === 'undo' ? [fromNow, toNow] : [toNow, fromNow];
  return {
    ...sitting,
    pressInFrame: null,
    pressesToUndo,
    pressesToRedo,
  };
}
/** The sitting after an event; null once it ends (another sheet, edits dropped, a workbook undo). */
export function sittingAfterEvent(state: PageState, event: PageEvent, workbook: WorkbookReads): SittingInInteractive | null {
  let sitting = state.sittingInInteractive;
  if (sitting === null || interactiveOfSheet(workbook, state.sheetId) !== sitting.viewId) return null;
  if (event.kind === 'editsDropped') return null;
  if (event.kind === 'takeBackAnswered') return event.outcome.kind === 'made' ? null : sitting;
  if (event.kind === 'undoOrRedoAnswered') return sittingAfterUndoOrRedo(sitting, event);
  if (event.kind !== 'editAnswered' || event.outcome.kind !== 'editQueued') return sitting;
  let madeBy = 'madeBy' in event.edit ? event.edit.madeBy : undefined;
  if (madeBy?.sitting !== sitting.id) return null;
  let pressesBefore = sitting.pressesToUndo.filter((press) => press !== madeBy.press);
  return {
    ...sitting,
    pressesToUndo: [...pressesBefore, madeBy.press],
    pressesToRedo: [],
  };
}
export function firstPlaceInSheet(workbook: WorkbookReads, sheetId: SheetId): PlaceAtCell | null {
  let sheet = findSheetById(workbook, sheetId);
  let firstCell = workbook.cellIdAt(
    sheetId,
    leadingRunCount(collapsedIndexRuns(sheet?.rowGroups ?? [])),
    leadingRunCount(collapsedIndexRuns(sheet?.columnGroups ?? [])),
  );
  return firstCell === null
    ? null
    : {
        sheetId,
        ...selectionAtCell(firstCell),
        scrollLeft: 0,
        scrollTop: 0,
      };
}
/** The first place to open on: the first shown sheet not as new, else the first shown, else any. */
export function firstPlaceInWorkbook(workbook: WorkbookReads): PlaceAtCell | null {
  let withPlace = workbook.listSheets().filter(({ sheetId }) => firstPlaceInSheet(workbook, sheetId) !== null);
  let shown = withPlace.filter(({ isHidden }) => !isHidden);
  let sheet = shown.find(({ sheetId }) => !workbook.isSheetAsNew(sheetId)) ?? shown[0] ?? withPlace[0];
  return sheet === undefined ? null : firstPlaceInSheet(workbook, sheet.sheetId);
}
export function fingerprintLineRuns(runs: readonly IdRun[]): string {
  let merged: IdRun[] = [];
  for (let run of runs) {
    let lastRun = merged.at(-1);
    if (lastRun !== undefined && lastRun.base === run.base && lastRun.first + lastRun.count === run.first)
      merged[merged.length - 1] = {
        ...lastRun,
        count: lastRun.count + run.count,
      };
    else merged.push(run);
  }
  let [hash, lineCount]: [number, number] = [2166136261, 0];
  for (let { base, first, count } of merged) {
    lineCount += count;
    let key = `${base}.${first}+${count};`;
    for (let index: number = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  return `${lineCount}:${(hash >>> 0).toString(36)}`;
}
export function selectionLinesFingerprint(selectionState: Pick<CellSelection, 'activeCell' | 'selectionCorner'>, workbook: WorkbookReads): string | null {
  if (isSameCell(selectionState.activeCell, selectionState.selectionCorner)) return null;
  let area: CellArea | undefined = selectionAreaAndKind(selectionState, workbook)?.area;
  let lines = workbook.linesOf(selectionState.activeCell.sheetId);
  if (area === undefined || lines === null) return null;
  let rowRuns = lines.rows.runsIn({
    firstIndex: area.topRowIndex,
    count: area.rowCount,
  });
  let columnRuns = lines.columns.runsIn({
    firstIndex: area.leftColumnIndex,
    count: area.columnCount,
  });
  return `${fingerprintLineRuns(rowRuns)} ${fingerprintLineRuns(columnRuns)}`;
}
export function restoredPlace(workbook: WorkbookReads, place: SavedPlace | null): PlaceRestored | null {
  if (place === null) return firstPlaceInWorkbook(workbook);
  let { lines, ...placeWithoutLines } = place;
  if (workbook.positionOfCell(placeWithoutLines.activeCell) === null)
    return firstPlaceInSheet(workbook, placeWithoutLines.sheetId) ?? firstPlaceInWorkbook(workbook);
  return lines !== null && lines === selectionLinesFingerprint(placeWithoutLines, workbook)
    ? placeWithoutLines
    : {
        ...placeWithoutLines,
        ...selectionAtCell(placeWithoutLines.activeCell),
      };
}
export const interactiveOfSheet = (workbook: WorkbookReads, sheetId: SheetId): string | null =>
  findSheetById(workbook, sheetId)?.interactive ?? null;
/** Whether the run of `count` lines from `firstIndex` reaches the span between the indexes, when every index is known. */
export const spanReachesIndexes = (firstIndex: number, count: number, indexes: (number | null)[]): boolean =>
  indexes.every((index): index is number => index !== null) &&
  firstIndex <= Math.max(...indexes) &&
  firstIndex + count > Math.min(...indexes);
export const SITTING_LASTS_MS = 600000;
export const MOST_EDITS_IN_A_SITTING = 400;
export const madeByOfSitting = ({ id, press }: SittingInInteractive): MadeBy => ({
  sitting: id,
  press,
});
/** A hidden sheet still has its tab while it is shown, pointed in or being renamed. */
export const isSheetTabShown = (
  { sheetId, sheetPointedIn, sheetBeingRenamed }: Pick<PageState, 'sheetId' | 'sheetPointedIn' | 'sheetBeingRenamed'>,
  sheet: Pick<SheetSummary, 'sheetId' | 'isHidden'>,
): boolean => !sheet.isHidden || [sheetId, sheetPointedIn, sheetBeingRenamed?.sheetId].includes(sheet.sheetId);
export const shownSheetTabs = (state: Pick<PageState, 'sheetId' | 'sheetPointedIn' | 'sheetBeingRenamed'>, workbook: WorkbookReads): SheetSummary[] =>
  workbook.listSheets().filter((sheet) => isSheetTabShown(state, sheet));
