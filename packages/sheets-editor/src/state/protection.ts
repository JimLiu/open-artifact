/** Protected sheets and ranges, who may edit them, the protection pane. */
import type { SheetId } from '@open-artifact/sheets-core';
import type { ProtectedRange, Protection, ProtectionContents, Protects, SheetRead, WorkbookReads } from '../model/workbook.ts';
import type { CellArea, CellPosition } from '../selection/model.ts';
import type { PageState } from './initial-state.ts';
import type { PageTransition } from './transitions.ts';
import type { Person } from '../store/frames.ts';
import type { ProtectionDone, ProtectionPlace } from '../messages/protection.ts';
import { readsAsStored, areasOverlap } from '../model/workbook.ts';
import { selectionKindOf, activeAnchorCell, selectedArea } from '../selection/model.ts';
import { splitAreaAround } from '../selection/several-ranges.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { areasAsSeen, wholeAreaToA1AsStored, parseA1AreaAsSeen, rowLabelEnds, columnLabelEnds } from '../model/a1-references.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { IF_QUEUED_DEFAULTS, queueEdit } from '../model/edit-effects.ts';
import { withNoEffects } from './transitions.ts';

/** A range of lines a protection names, or the whole sheet. */
export type LineRangeOrSheet = ProtectedRange | 'sheet';
/** A protected area of a sheet as seen, and whether it is kept from the person viewing. */
export interface ProtectedArea {
  area: CellArea;
  isKeptFromViewer: boolean;
  isOfWholeSheet: boolean;
}
/** The protection the pane opens on: a new one of what it protects, or one already saved. */
export type ProtectionOpened = { protects: Protects } | { protectionId: string };
/** A protection the pane lists: where it is, who may edit it, and whether the person may change it. */
export interface ProtectionListed {
  protectionId: string | null;
  place: ProtectionPlace;
  editors: string[];
  mayBeChanged: boolean;
}
/** What the protection pane shows. */
export interface ProtectionPane {
  listed: ProtectionListed[];
  opensOn: string | null;
  staysAnEditor: string | null;
  viewerId: string | null;
  mostEditors: number;
  areOpenRanges(text: string): boolean;
}
/** What is done with a protection from the pane: saved with its editors (and open ranges of a sheet), or removed. */
export type ActionOnProtection =
  | { kind: 'save'; protectionId: string | null; editors: readonly string[]; open: string | null }
  | { kind: 'remove'; protectionId: string };
/** What was last done to a protection, with whether the store has it. */
export interface ProtectionDoneOnPage extends ProtectionDone {
  isSaved: boolean;
}

/** The area a range of lines (cells, whole rows, whole columns, or the sheet) covers, by stored positions. */
export function areaOfLineRange(reads: WorkbookReads, sheetId: SheetId, range: LineRangeOrSheet): CellArea | null {
  let lines = readsAsStored(reads).linesOf(sheetId);
  if (lines === null) return null;
  let { rows, columns } = lines;
  const isOfCells = range !== 'sheet' && range.kind === 'cells';
  let endsOfKind = (kind: 'wholeRows' | 'wholeColumns'): [string, string] | null =>
    range !== 'sheet' && range.kind !== 'cells' && range.kind === kind ? [range.first, range.last] : null;
  let indexesOf = (lineIndex: SheetRead['rows'], ends: [string, string] | null): number[] =>
    ends === null ? [0, lineIndex.count - 1] : ends.map((lineId) => lineIndex.indexOf(lineId) ?? -1);
  let [topRow = -1, bottomRow = -1] = indexesOf(
    rows,
    isOfCells ? [range.topLeft.r, range.bottomRight.r] : endsOfKind('wholeRows'),
  );
  let [leftColumn = -1, rightColumn = -1] = indexesOf(
    columns,
    isOfCells ? [range.topLeft.c, range.bottomRight.c] : endsOfKind('wholeColumns'),
  );
  if (topRow < 0 || leftColumn < 0 || bottomRow < topRow || rightColumn < leftColumn) return null;
  return {
    topRowIndex: topRow,
    leftColumnIndex: leftColumn,
    rowCount: bottomRow - topRow + 1,
    columnCount: rightColumn - leftColumn + 1,
  };
}
/** A stored area as a range of lines: whole columns, whole rows, or cells. */
export function lineRangeOfArea(reads: WorkbookReads, sheetId: SheetId, area: CellArea): ProtectedRange | null {
  let lines = readsAsStored(reads).linesOf(sheetId);
  if (lines === null) return null;
  let { rows, columns } = lines;
  let topRowId = rows.idAt(area.topRowIndex);
  let bottomRowId = rows.idAt(area.topRowIndex + area.rowCount - 1);
  let leftColumnId = columns.idAt(area.leftColumnIndex);
  let rightColumnId = columns.idAt(area.leftColumnIndex + area.columnCount - 1);
  if (topRowId === null || bottomRowId === null || leftColumnId === null || rightColumnId === null) return null;
  switch (
    selectionKindOf(area, {
      rowCount: rows.count,
      columnCount: columns.count,
    })
  ) {
    case 'columns':
      return {
        kind: 'wholeColumns',
        first: leftColumnId,
        last: rightColumnId,
      };
    case 'rows':
      return {
        kind: 'wholeRows',
        first: topRowId,
        last: bottomRowId,
      };
    case 'cells':
      return {
        kind: 'cells',
        topLeft: {
          r: topRowId,
          c: leftColumnId,
        },
        bottomRight: {
          r: bottomRowId,
          c: rightColumnId,
        },
      };
  }
}
/** The stored areas a protection keeps: its range, or the whole sheet but its open ranges. */
export function areasProtectedBy(reads: WorkbookReads, sheetId: SheetId, { protects }: Protection): CellArea[] {
  let rangeAreas = rangesNamedByProtects(protects).flatMap((range): CellArea | CellArea[] => areaOfLineRange(reads, sheetId, range) ?? []);
  if (protects.kind === 'range') return rangeAreas;
  let sheetArea = areaOfLineRange(reads, sheetId, 'sheet');
  return rangeAreas.reduce(
    (areas: CellArea[], openArea) => areas.flatMap((area) => splitAreaAround(area, openArea, 'rows')),
    sheetArea === null ? [] : [sheetArea],
  );
}
/** The protected areas of a sheet as seen, and whether each is kept from the person viewing. */
export function protectedAreasOf({ person }: Pick<PageState, 'person'>, reads: WorkbookReads, sheetId: SheetId): ProtectedArea[] {
  let protections = reads.protectionsIn(sheetId);
  let sheet = reads.sheetAsItStands(sheetId);
  if (protections.length === 0 || sheet === null) return NO_PROTECTED_AREAS;
  let cached = protectedAreasBySheet.get(sheet);
  if (cached?.person === person) return cached.areas;
  let ownRowOrder = ownRowOrderOfSheet(reads, sheetId);
  let areas = protections.flatMap(({ protection }) =>
    areasProtectedBy(reads, sheetId, protection)
      .flatMap((area) => areasAsSeen(area, ownRowOrder))
      .map(
        (area): ProtectedArea => ({
          area,
          isKeptFromViewer: isProtectionKeptFrom(protection, person),
          isOfWholeSheet: protection.protects.kind === 'sheet',
        }),
      ),
  );
  return (
    protectedAreasBySheet.set(sheet, {
      person,
      areas,
    }),
    areas
  );
}
export function isPositionKeptFromViewer(state: PageState, reads: WorkbookReads, { rowIndex, columnIndex }: CellPosition): boolean {
  let cellArea: CellArea = {
    topRowIndex: rowIndex,
    leftColumnIndex: columnIndex,
    rowCount: 1,
    columnCount: 1,
  };
  return protectedAreasOf(state, reads, state.sheetId).some(({ area, isKeptFromViewer }) => isKeptFromViewer && areasOverlap(area, cellArea));
}
export function isActiveCellKeptFromViewer(state: PageState, reads: WorkbookReads): boolean {
  if (reads.protectionsIn(state.sheetId).length === 0) return false;
  let position = reads.positionOfCell(activeAnchorCell(state, reads));
  return position !== null && isPositionKeptFromViewer(state, reads, position);
}
/** Typing into a protected cell: the entry closes with a refusal. */
export function refuseEntryInProtectedCell(state: PageState, result: PageTransition, reads: WorkbookReads): PageTransition {
  if (result.state.mode.kind !== 'editing' || state.mode.kind === 'editing') return result;
  return isActiveCellKeptFromViewer(result.state, reads)
    ? withNoEffects({
        ...state,
        notice: {
          kind: 'editRefused',
          why: 'cellsProtected',
          asked: 'entryInOneCell',
        },
      })
    : result;
}
export function protectionOfWholeSheet(reads: WorkbookReads, sheetId: SheetId): ProtectionOpened {
  let sheetProtection = reads.protectionsIn(sheetId).find(({ protection }) => protection.protects.kind === 'sheet');
  return sheetProtection === undefined
    ? {
        protects: WHOLE_SHEET_PROTECTS,
      }
    : {
        protectionId: sheetProtection.protectionId,
      };
}
/** The protection to open for the selection: one already over it, or a new one of its range. */
export function protectionOfSelection(state: PageState, reads: WorkbookReads): ProtectionOpened | null {
  let { sheetId } = state;
  let area = selectedArea(state, reads);
  let sheetArea = areaOfLineRange(reads, sheetId, 'sheet');
  if (area === null || sheetArea === null) return null;
  if (area.rowCount === sheetArea.rowCount && area.columnCount === sheetArea.columnCount) return protectionOfWholeSheet(reads, sheetId);
  let written = wholeAreaToA1AsStored(area, ownRowOrderOfSheet(reads, sheetId));
  let storedArea =
    written === null
      ? null
      : parseA1AreaAsSeen(written, {
          ...sheetArea,
          ownRowOrder: null,
        });
  let range = storedArea === null ? null : lineRangeOfArea(reads, sheetId, storedArea);
  if (storedArea === null || range === null) return null;
  let protections = reads.protectionsIn(sheetId);
  let over: ProtectionContents | undefined =
    protections.find(
      ({ protection }) =>
        isProtectionKeptFrom(protection, state.person) &&
        areasProtectedBy(reads, sheetId, protection).some((protectedArea) => areasOverlap(protectedArea, storedArea)),
    ) ??
    protections.find(
      ({ protection }) =>
        protection.protects.kind === 'range' &&
        areasProtectedBy(reads, sheetId, protection).some(
          (protectedArea) => splitAreaAround(storedArea, protectedArea, 'rows').length === 0,
        ),
    );
  return over === undefined
    ? {
        protects: {
          kind: 'range',
          range,
        },
      }
    : {
        protectionId: over.protectionId,
      };
}
export function lineRangeToA1(reads: WorkbookReads, sheetId: SheetId, range: ProtectedRange): string {
  let area = areaOfLineRange(reads, sheetId, range);
  if (area === null) return '';
  if (range.kind === 'cells') return areaToA1AsStored(area, null);
  let { first, last } = range.kind === 'wholeRows' ? rowLabelEnds(area, null) : columnLabelEnds(area);
  return `${first}:${last}`;
}
/** Where a protection is, as the pane writes it. */
export function placeOfProtects(reads: WorkbookReads, sheetId: SheetId, protects: Protects): ProtectionPlace {
  if (protects.kind === 'sheet')
    return {
      kind: 'sheet',
      open: protects.openRanges.map((range) => lineRangeToA1(reads, sheetId, range)).join(', '),
    };
  let written = lineRangeToA1(reads, sheetId, protects.range);
  if (protects.range.kind === 'cells')
    return {
      kind: 'cells',
      written,
    };
  let [first = '', last = ''] = written.split(':');
  return {
    kind: protects.range.kind === 'wholeRows' ? 'rows' : 'columns',
    lines: {
      first,
      last,
    },
  };
}
/** The ranges typed as open in a protected sheet; null when one is not a range or there are too many. */
export function openRangesFromText(reads: WorkbookReads, sheetId: SheetId, text: string): ProtectedRange[] | null {
  let sheetArea = areaOfLineRange(reads, sheetId, 'sheet');
  if (sheetArea === null) return null;
  let { first: firstColumn, last: lastColumn } = columnLabelEnds(sheetArea);
  let ranges = text
    .split(/[,;]/)
    .map((part) => part.trim().replace(/^(\d+):(\d+)$/, `${firstColumn}$1:${lastColumn}$2`))
    .filter((part) => part !== '')
    .map((part) =>
      parseA1AreaAsSeen(part, {
        ...sheetArea,
        ownRowOrder: null,
      }),
    )
    .map((area) => (area === null ? null : lineRangeOfArea(reads, sheetId, area)));
  return ranges.length <= reads.limitsOfProtections().mostOpenRangesInAProtection &&
    ranges.every((range): range is ProtectedRange => range !== null)
    ? ranges
    : null;
}
/** A protection the person had open was removed by someone else: the pane closes with a notice. */
export function closeProtectionThatIsGone(state: PageState, readsBefore: WorkbookReads, reads: WorkbookReads): PageState {
  if (protectionOfMenu(state.menu) === null) return state;
  let protectionIds = new Set(reads.protectionsIn(state.sheetId).map((protection) => protection.protectionId));
  return readsBefore.protectionsIn(state.sheetId).every((protection) => protectionIds.has(protection.protectionId))
    ? state
    : {
        ...state,
        menu: null,
        notice: {
          kind: 'editRefused',
          why: 'protectionIsGone',
          asked: 'otherEdit',
        },
      };
}
/** What the protection pane shows: the protections of the sheet, the one being made first. */
export function protectionPaneOf(state: PageState, reads: WorkbookReads): ProtectionPane | null {
  let opened = protectionOfMenu(state.menu);
  if (opened === null) return null;
  let { sheetId, person } = state;
  let userId = person?.kind === 'user' ? person.userId : null;
  let topLeftOf = ({ protection: { protects } }: ProtectionContents): [number, number] => {
    let area = protects.kind === 'range' ? areaOfLineRange(reads, sheetId, protects.range) : null;
    return area === null ? [-1, -1] : [area.topRowIndex, area.leftColumnIndex];
  };
  let protections = [...reads.protectionsIn(sheetId)];
  protections.sort((one, other) => {
    let [[oneRow, oneColumn], [otherRow, otherColumn]] = [topLeftOf(one), topLeftOf(other)];
    return oneRow === otherRow ? oneColumn - otherColumn : oneRow - otherRow;
  });
  let saved = protections.map(
    ({ protectionId, protection }): ProtectionListed => ({
      protectionId,
      place: placeOfProtects(reads, sheetId, protection.protects),
      editors: protection.editors,
      mayBeChanged: !isProtectionKeptFrom(protection, person),
    }),
  );
  let listed: ProtectionListed[] = [
    ...('protects' in opened
      ? [
          {
            protectionId: null,
            place: placeOfProtects(reads, sheetId, opened.protects),
            editors: userId === null ? [] : [userId],
            mayBeChanged: person?.kind !== 'unnamed',
          },
        ]
      : []),
    ...saved,
  ];
  let opensOn = 'protects' in opened ? null : opened.protectionId;
  let shown = listed.filter(({ protectionId }) => protectionId === opensOn);
  return {
    listed: shown[0]?.place.kind === 'sheet' ? listed : shown,
    opensOn,
    staysAnEditor: userId,
    viewerId: userId ?? state.viewerId,
    mostEditors: reads.limitsOfProtections().mostEditorsOfAProtection,
    areOpenRanges: (text) => openRangesFromText(reads, sheetId, text) !== null,
  };
}
/** Saving or removing a protection from the pane. */
export function actOnProtection(state: PageState, reads: WorkbookReads, opened: ProtectionOpened, action: ActionOnProtection): PageTransition {
  let { sheetId } = state;
  let { protectionId } = action;
  let saved = reads.protectionsIn(sheetId).find((protection) => protection.protectionId === protectionId);
  let protects = saved?.protection.protects ?? ('protects' in opened ? opened.protects : null);
  if (protects === null || (protectionId !== null && saved === undefined))
    return withNoEffects({
      ...state,
      notice: {
        kind: 'editRefused',
        why: 'protectionIsGone',
        asked: 'otherEdit',
      },
    });
  let sheetName = reads.listSheets().find((sheet) => sheet.sheetId === sheetId)?.name ?? '';
  let optionsOf = (what: ProtectionDone['what'], done: Protects) => ({
    ...IF_QUEUED_DEFAULTS,
    select: null,
    done: {
      what,
      place: placeOfProtects(reads, sheetId, done),
      sheetName,
      isSaved: false,
    },
  });
  if (action.kind === 'remove') {
    let edit = {
      kind: 'removeProtection',
      sheetId,
      protectionId: action.protectionId,
    } as const;
    return queueEdit(state, edit, optionsOf('protectionRemoved', protects));
  }
  let openText = protects.kind === 'sheet' ? action.open : null;
  let openRanges = openText === null ? [] : openRangesFromText(reads, sheetId, openText);
  if (openRanges === null) return withNoEffects(state);
  let protectsNow: Protects =
    openText === null
      ? protects
      : {
          kind: 'sheet',
          openRanges,
        };
  let protection: Protection = {
    protects: protectsNow,
    editors: [...action.editors],
  };
  return queueEdit(
    state,
    {
      kind: 'saveProtection',
      sheetId,
      protectionId,
      protection,
    },
    optionsOf(protectionId === null ? 'protectionMade' : 'protectionSaved', protectsNow),
  );
}
/** Whether a protection keeps the person out: everyone but the owner and its editors. */
export const isProtectionKeptFrom = ({ editors }: Protection, person: Person | null): boolean =>
  person !== null && person.kind !== 'owner' && (person.kind === 'unnamed' || !editors.includes(person.userId));
export const rangesNamedByProtects = (protects: Protects): ProtectedRange[] => (protects.kind === 'range' ? [protects.range] : protects.openRanges);
export const NO_PROTECTED_AREAS: ProtectedArea[] = [];
export const protectedAreasBySheet = new WeakMap<SheetRead, { person: Person | null; areas: ProtectedArea[] }>();
export const isWholeSheetProtected = (reads: WorkbookReads, sheetId: SheetId): boolean =>
  reads.protectionsIn(sheetId).some(({ protection }) => protection.protects.kind === 'sheet');
export const isProtectionRefusal = (refusal: string): boolean =>
  refusal === 'cellsProtected' || refusal === 'linesProtected' || refusal === 'sheetProtected';
export const WHOLE_SHEET_PROTECTS: Protects = {
  kind: 'sheet',
  openRanges: [],
};
export const protectionOfMenu = (menu: PageState['menu']): ProtectionOpened | null =>
  menu?.holds === 'protection' ? (menu.protection ?? null) : null;
