import { withNoEffects } from '../state/transitions.ts';
import type { PageTransition } from '../state/transitions.ts';
import { isTooBusyForNotice } from '../export/xlsx-saved-notice.ts';
import { closeDropdownList } from '../chips/dropdowns.ts';
import type { PageState } from '../state/initial-state.ts';
import type { CallOfAConnectedTable, WorkbookReads } from '../model/workbook.ts';
import type { SheetId } from '@open-artifact/sheets-core';
import type { TableRefreshAnswer, TableRefreshRefusal } from './connected-table-host.ts';

/** The call of a connected table to refresh, with its digest. */
export interface CallToRefresh {
  call: CallOfAConnectedTable;
  callDigest: string;
}
/** A refresh under way, or the last one that was refused. */
export type RefreshOfTable =
  | { kind: 'asked'; sheetId: SheetId; askId: number; shown: CallToRefresh; snapshotIdBefore: string | null }
  | { kind: 'refused'; sheetId: SheetId; snapshotIdBefore: string | null; refusal: TableRefreshRefusal; callDigest: string | null };
/** A call that waits for the person to confirm it runs with their access. */
export interface CallToConfirm extends CallToRefresh {
  sheetId: SheetId;
  isMarkedReadOnly: boolean;
  nth: number;
}
/** Columns of a connected table, from the left one. */
export interface ColumnsOfTable {
  leftColumnIndex: number;
  columnCount: number;
}
/** The answer of a refresh, for the refresh asked as `askId`. */
export interface TableRefreshAnswered {
  askId: number;
  answer: TableRefreshAnswer;
}

export function askToRefreshConnectedTable(
  state: PageState,
  reads: WorkbookReads,
  sheetId: SheetId,
  shown: CallToRefresh,
  isConfirmedNow: boolean,
): PageTransition {
  let askId = state.refreshAskCount + 1,
    snapshotIdBefore = connectedTableSnapshotId(reads, sheetId);
  return {
    state: {
      ...state,
      refreshAskCount: askId,
      refreshOfTable: {
        kind: 'asked',
        sheetId,
        askId,
        shown,
        snapshotIdBefore,
      },
    },
    effects: [
      {
        kind: 'refreshConnectedTable',
        askId,
        asked: {
          ...shown,
          sheetId,
          viewerId: state.viewerId,
          isConfirmedNow,
        },
      },
    ],
  };
}
export function refreshConnectedTableAsked(state: PageState, reads: WorkbookReads): PageTransition {
  let { call = null, callDigest = null } = reads.connectedTableIn(state.sheetId) ?? {};
  return isTableRefreshAsked(state) || call === null || callDigest === null
    ? withNoEffects(state)
    : askToRefreshConnectedTable(state, reads, state.sheetId, { call, callDigest }, false);
}
export function connectedTableCallConfirmed(
  state: PageState,
  reads: WorkbookReads,
  { nth, isToRun }: { nth?: number; isToRun?: boolean } = {},
): PageTransition {
  let toConfirm = state.callToConfirm;
  if (toConfirm?.nth !== nth) return withNoEffects(state);
  // The asked call is there whenever its number matches.
  let { sheetId, call, callDigest } = toConfirm!,
    withoutCall = { ...state, callToConfirm: null };
  return isToRun ? askToRefreshConnectedTable(withoutCall, reads, sheetId, { call, callDigest }, true) : withNoEffects(withoutCall);
}
export function connectedTableRefreshAnswered(
  state: PageState,
  reads: WorkbookReads,
  { askId, answer }: TableRefreshAnswered = {} as TableRefreshAnswered,
  canConfirm: boolean,
): PageState {
  let refresh = state.refreshOfTable;
  if (refresh?.kind !== 'asked' || refresh.askId !== askId) return state;
  let { sheetId, shown, snapshotIdBefore } = refresh;
  switch (answer.kind) {
    case 'refreshed':
      return { ...state, refreshOfTable: null };
    case 'refused':
      return {
        ...state,
        refreshOfTable: {
          kind: 'refused',
          sheetId,
          snapshotIdBefore,
          refusal: answer,
          callDigest: connectedTableCallDigest(reads, sheetId),
        },
      };
    case 'toBeConfirmed': {
      let isAskedHere = canConfirm && sheetId === state.sheetId && !isTooBusyForNotice(state),
        { isMarkedReadOnly } = answer;
      return {
        ...state,
        refreshOfTable: null,
        callToConfirm: isAskedHere
          ? {
              ...shown,
              sheetId,
              isMarkedReadOnly,
              nth: askId,
            }
          : null,
      };
    }
  }
}
export function withoutOutdatedTableRefusal(state: PageState, reads: WorkbookReads): PageState {
  let refresh = state.refreshOfTable;
  if (refresh?.kind !== 'refused') return state;
  let { sheetId, callDigest, snapshotIdBefore } = refresh;
  return connectedTableCallDigest(reads, sheetId) !== callDigest || connectedTableSnapshotId(reads, sheetId) !== snapshotIdBefore
    ? { ...state, refreshOfTable: null }
    : state;
}
export function connectedTableColumnsName(
  reads: WorkbookReads,
  sheetId: SheetId,
  { leftColumnIndex, columnCount }: ColumnsOfTable = {} as ColumnsOfTable,
): string | null {
  let columns = reads.connectedTableIn(sheetId)?.columns;
  if (columns === void 0) return null;
  let [firstName = '', lastName = ''] = [leftColumnIndex, leftColumnIndex + columnCount - 1].map((index) => columns[index]?.column.name);
  return columnCount === 1 ? firstName : `${firstName}:${lastName}`;
}
export const isTableRefreshAsked = ({ refreshOfTable }: Pick<PageState, 'refreshOfTable'>): boolean => refreshOfTable?.kind === 'asked';
export const connectedTableSnapshotId = (reads: WorkbookReads, sheetId: SheetId): string | null => reads.connectedTableIn(sheetId)?.snapshot?.snapshotId ?? null;
export const connectedTableCallDigest = (reads: WorkbookReads, sheetId: SheetId): string | null => reads.connectedTableIn(sheetId)?.callDigest ?? null;
export const withoutTableRefusal = (state: PageState): PageState => (state.refreshOfTable?.kind === 'refused' ? { ...state, refreshOfTable: null } : state);
export const withSourceOfTableToggled = (state: PageState): PageState =>
  state.sidePane?.kind === 'sourceOfTable'
    ? { ...state, sidePane: null }
    : {
        ...closeDropdownList(state),
        menu: null,
        sidePane: { kind: 'sourceOfTable' },
        timesSidePaneAsked: state.timesSidePaneAsked + 1,
      };
export const withoutSourceOfTablePaneIfNoCall = (state: PageState, reads: WorkbookReads): PageState =>
  state.sidePane?.kind === 'sourceOfTable' && (reads.connectedTableIn(state.sheetId)?.call ?? null) === null ? { ...state, sidePane: null } : state;
export const withConnectedTableEditRefused = (state: PageState): PageState => ({
  ...state,
  notice:
    state.notice?.kind === 'entriesNotKept'
      ? state.notice
      : {
          kind: 'editRefused',
          why: 'sheetIsAConnectedTable',
          asked: 'otherEdit',
        },
});
export const withoutEditingConnectedTable = (before: PageState, after: PageTransition, reads: WorkbookReads): PageTransition =>
  before.mode.kind === 'navigating' && after.state.mode.kind === 'editing' && reads.connectedTableIn(after.state.sheetId) !== null
    ? withNoEffects({
        ...withConnectedTableEditRefused(before),
        heldUntilAnswered: after.state.heldUntilAnswered === null ? null : before.heldUntilAnswered,
      })
    : after;
