/** The named ranges side pane, its form, saving, removing and going to a named range. */
import type { LimitsOfNamedRanges, NamedRangeRead, WorkbookReads } from '../model/workbook.ts';
import type { CellArea } from '../selection/model.ts';
import type { NamedRangeFormRefusal } from '../messages/named-ranges.ts';
import type { PageState } from './initial-state.ts';
import type { IfQueued, PageEvent } from './event-reducer.ts';
import type { PageTransition } from './transitions.ts';
import type { ReadsWithTextMeasurer } from './controller.ts';
import { selectedArea, selectionKindOf } from '../selection/model.ts';
import { layoutOfView } from '../grid/layout.ts';
import { columnLabelEnds, wholeAreaToA1AsStored, areaAsSeen } from '../model/a1-references.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { sheetPrefixForFormula } from '../formulas/references.ts';
import { goToCells } from '../selection/go-to-cells.ts';
import { IF_QUEUED_DEFAULTS, queueEdit } from '../model/edit-effects.ts';
import { withNoEffects } from './transitions.ts';
import { showSheet } from './sheet-tabs.ts';
import { formulasReadingNamedRange } from './places.ts';

/** The form of the named ranges pane: a new named range, or one being changed. */
export interface NamedRangeForm {
  /** The named range changed, or null for a new one. */
  over: string | null;
  name: string;
  /** The address typed, or null while the saved range's own address stands. */
  address: string | null;
  isChanged: boolean;
  refused: NamedRangeFormRefusal | null;
}
/** What the named ranges pane holds. */
export interface NamedRangesInPane {
  form: NamedRangeForm | null;
}
/** A field of the named range form. */
export type NamedRangeField = 'name' | 'address';
/** What is done in the named ranges pane. */
export type ActionOnNamedRanges =
  | { kind: 'add' }
  | { kind: 'edit'; namedRangeId: string }
  | { kind: 'type'; field: NamedRangeField; text: string }
  | { kind: 'useSelection' }
  | { kind: 'giveUp' }
  | { kind: 'save' }
  | { kind: 'delete'; namedRangeId: string }
  | { kind: 'goTo'; namedRangeId: string };
/** A named range saved, told by its name. */
export interface NamedRangeSavedDone {
  what: 'namedRangeSaved';
  name: string;
}
/** The offer to undo the delete of a named range, with the formulas that read it. */
export interface NamedRangeDeletedUndoOffer {
  kind: 'namedRangeDeleted';
  name: string;
  isSaved: boolean;
  formulas: ReturnType<typeof formulasReadingNamedRange>;
}
/** What the pane shows: the form with its address written, the named ranges and their limits. */
export interface NamedRangesPaneShown {
  form: (NamedRangeForm & { address: string }) | null;
  namedRanges: NamedRangeRead[];
  limits: LimitsOfNamedRanges;
}

/** The selection written as a named range address: whole columns as A:B, whole rows as 1:2. */
export function selectionAddressForName(state: PageState, reads: ReadsWithTextMeasurer): string {
  let area = selectedArea(state, reads);
  if (area === null || state.otherRanges.length > 0) return '';
  let kind = selectionKindOf(area, layoutOfView(state, reads));
  if (kind === 'columns') {
    let { first, last } = columnLabelEnds(area);
    return `${first}:${last}`;
  }
  let written = wholeAreaToA1AsStored(area, ownRowOrderOfSheet(reads, state.sheetId)) ?? '';
  return kind === 'rows' && written.includes(':') ? written.replaceAll(/[A-Z]/g, '') : written;
}
export function selectionAddressWithSheet(state: PageState, reads: ReadsWithTextMeasurer): string {
  let address = selectionAddressForName(state, reads);
  let sheet = reads.listSheets().find(({ sheetId }) => sheetId === state.sheetId);
  return address === '' || sheet === undefined ? '' : `${sheetPrefixForFormula(sheet.name)}${address}`;
}
/** Opening the pane; a form with unsaved changes stays as it is. */
export function showNamedRangesPane(state: PageState, reads: ReadsWithTextMeasurer, opensNewForm: boolean): PageState {
  let pane = namedRangesOfSidePane(state);
  let timesSidePaneAsked = state.timesSidePaneAsked + (pane === null ? 0 : 1);
  let shown: PageState = {
    ...state,
    menu: null,
    dropdown: null,
    timesSidePaneAsked,
  };
  if (isNamedRangeFormChanged(state)) return withNamedRangeForm(shown, pane?.form ?? null);
  return withNamedRangeForm(shown, opensNewForm ? newNamedRangeForm(state, reads) : null);
}
/** The area a named range covers as seen, from its live cells. */
export function areaOfNamedRange(reads: WorkbookReads, { liveCells }: Pick<NamedRangeRead, 'liveCells'>): CellArea | null {
  if (liveCells === null) return null;
  let { sheetId, cells } = liveCells;
  let stored = reads.asStored() ?? reads;
  let [topLeft, bottomRight] = [cells.topLeft, cells.bottomRight].map(({ r, c }) =>
    stored.positionOfCell({
      sheetId,
      rowId: r,
      columnId: c,
    }),
  );
  if (topLeft === null || topLeft === undefined || bottomRight === null || bottomRight === undefined) return null;
  let area: CellArea = {
    topRowIndex: topLeft.rowIndex,
    leftColumnIndex: topLeft.columnIndex,
    rowCount: bottomRight.rowIndex - topLeft.rowIndex + 1,
    columnCount: bottomRight.columnIndex - topLeft.columnIndex + 1,
  };
  return areaAsSeen(area, ownRowOrderOfSheet(reads, sheetId));
}
export function actOnNamedRanges(state: PageState, reads: ReadsWithTextMeasurer, action: ActionOnNamedRanges): PageTransition {
  let pane = namedRangesOfSidePane(state);
  if (pane === null) return withNoEffects(state);
  let { form } = pane;
  let saved = 'namedRangeId' in action ? reads.namedRanges().find(({ namedRangeId }) => namedRangeId === action.namedRangeId) : undefined;
  let withFormChanged = (change: Partial<NamedRangeForm>): PageState =>
    form === null
      ? state
      : withNamedRangeForm(state, {
          ...form,
          ...change,
          isChanged: true,
          refused: null,
        });
  switch (action.kind) {
    case 'add':
      return withNoEffects(withNamedRangeForm(state, newNamedRangeForm(state, reads)));
    case 'edit': {
      if (saved === undefined || form?.isChanged === true) return withNoEffects(state);
      let { namedRangeId, namedRange } = saved;
      let unchanged = {
        address: null,
        isChanged: false,
        refused: null,
      };
      return withNoEffects(
        withNamedRangeForm(state, {
          over: namedRangeId,
          name: namedRange.name,
          ...unchanged,
        }),
      );
    }
    case 'type':
      return withNoEffects(
        withFormChanged({
          [action.field]: action.text,
        }),
      );
    case 'useSelection': {
      let address = selectionAddressWithSheet(state, reads);
      return withNoEffects(
        address === ''
          ? state
          : withFormChanged({
              address,
            }),
      );
    }
    case 'giveUp':
      return withNoEffects(withNamedRangeForm(state, null));
    case 'save': {
      if (form === null) return withNoEffects(state);
      let { over, name } = form;
      let address = addressOfNamedRangeForm(form, reads);
      return queueEdit(
        {
          ...state,
          notice: null,
        },
        {
          kind: 'saveNamedRange',
          namedRangeId: over,
          name,
          sheetId: state.sheetId,
          address,
        },
        {
          ...NAMED_RANGE_EDIT_OPTIONS,
          done: {
            what: 'namedRangeSaved',
            name: name.trim(),
          },
        },
      );
    }
    case 'delete': {
      if (saved === undefined) return withNoEffects(state);
      let { namedRangeId, namedRange } = saved;
      let formulas = formulasReadingNamedRange(reads, namedRangeId);
      return queueEdit(
        {
          ...(form?.over === namedRangeId ? withNamedRangeForm(state, null) : state),
          notice: null,
        },
        {
          kind: 'removeNamedRange',
          namedRangeId,
        },
        {
          ...NAMED_RANGE_EDIT_OPTIONS,
          undoOffer: {
            kind: 'namedRangeDeleted',
            name: namedRange.name,
            isSaved: false,
            formulas,
          },
        },
      );
    }
    case 'goTo': {
      let area = saved === undefined ? null : areaOfNamedRange(reads, saved);
      let sheetId = saved?.liveCells?.sheetId;
      if (area === null || sheetId === undefined || state.mode.kind !== 'navigating') return withNoEffects(state);
      return withNoEffects(goToCells(showSheet(state, reads, sheetId), reads, area));
    }
  }
}
/** Why a name was not allowed, by the first rule it breaks. */
export function whyNameIsNotAllowed(name: string): NamedRangeFormRefusal {
  if (!/^[\p{Alphabetic}_]/u.test(name)) return 'nameStartsWrong';
  if (!/^[\p{Alphabetic}\p{N}_.]*$/u.test(name)) return 'nameHoldsOtherSigns';
  if (/^(?:true|false)$/i.test(name)) return 'nameIsTrueOrFalse';
  return /^_xl/i.test(name) ? 'nameKeptForFiles' : 'nameLooksLikeACell';
}
/** The form's own word for a refusal; null when the form does not show it. */
export function namedRangeRefusalOf(refusal: string, name: string): NamedRangeFormRefusal | null {
  if (refusal === 'nameOfNamedRangeNotAllowed') return whyNameIsNotAllowed(name.trim());
  if (refusal === 'nameOfNamedRangeTaken') return 'nameTaken';
  if (refusal === 'tooManyNamedRanges') return 'tooMany';
  if (refusal === 'unknownNamedRange') return 'isGone';
  return refusal === 'addressOfNamedRangeNamesNoCells' || refusal === 'connectedTableNamedByAddress' ? 'addressNamesNoCells' : null;
}
export function noteNamedRangeRefused(state: PageState, refusal: string): PageState | null {
  let form = namedRangesOfSidePane(state)?.form ?? null;
  let refused = form === null ? null : namedRangeRefusalOf(refusal, form.name);
  return form === null || refused === null
    ? null
    : withNamedRangeForm(state, {
        ...form,
        refused,
      });
}
/** A saved named range closes the form. */
export function closeNamedRangeFormWhenSaved(state: PageState, event: PageEvent): PageState {
  return event.kind === 'editAnswered' &&
    event.edit.kind === 'saveNamedRange' &&
    (event.outcome.kind === 'editQueued' || event.outcome.kind === 'nothingToChange') &&
    namedRangesOfSidePane(state) !== null
    ? withNamedRangeForm(state, null)
    : state;
}
/** What the pane shows, kept while the side pane and the named ranges stay the same. */
export function namedRangesPaneOf(state: PageState, reads: WorkbookReads): NamedRangesPaneShown | null {
  let pane = namedRangesOfSidePane(state);
  if (pane === null) return null;
  let cached = namedRangesPaneBySidePane.get(pane);
  if (cached?.namedRanges === reads.namedRanges()) return cached;
  let drawn: NamedRangesPaneShown = {
    form:
      pane.form === null
        ? null
        : {
            ...pane.form,
            address: addressOfNamedRangeForm(pane.form, reads),
          },
    namedRanges: reads.namedRanges(),
    limits: reads.limitsOfNamedRanges(),
  };
  return (namedRangesPaneBySidePane.set(pane, drawn), drawn);
}
export const namedRangesOfSidePane = ({ sidePane }: Pick<PageState, 'sidePane'>): NamedRangesInPane | null =>
  sidePane?.kind === 'namedRanges' ? sidePane.namedRanges : null;
export const withNamedRangeForm = (state: PageState, form: NamedRangeForm | null): PageState => ({
  ...state,
  sidePane: {
    kind: 'namedRanges',
    namedRanges: {
      form,
    },
  },
});
export const newNamedRangeForm = (state: PageState, reads: ReadsWithTextMeasurer): NamedRangeForm => ({
  over: null,
  name: '',
  address: selectionAddressWithSheet(state, reads),
  isChanged: false,
  refused: null,
});
/** The address typed in the form, or the saved range's own address while none is typed. */
export const addressOfNamedRangeForm = ({ over, address }: Pick<NamedRangeForm, 'over' | 'address'>, reads: WorkbookReads): string =>
  address ?? reads.namedRanges().find(({ namedRangeId }) => namedRangeId === over)?.address ?? '';
export const isNamedRangeFormChanged = (state: Pick<PageState, 'sidePane'>): boolean => namedRangesOfSidePane(state)?.form?.isChanged === true;
export const NAMED_RANGE_EDIT_OPTIONS: IfQueued = {
  ...IF_QUEUED_DEFAULTS,
  select: null,
  leavesEntryOpen: true,
  done: null,
};
export const namedRangesPaneBySidePane = new WeakMap<NamedRangesInPane, NamedRangesPaneShown>();
