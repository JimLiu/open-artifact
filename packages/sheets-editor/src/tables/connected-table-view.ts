import { cleanTextForAgent } from '../agent/prompt-text.ts';
import { splitSeenAndUnseen } from '../clipboard/paste-that-waits.ts';
import type { PieceOfPastedText } from '../clipboard/paste-that-waits.ts';
import { escapeClipboardCellText } from '../clipboard/text-escaping.ts';
import { isNonNullObject } from '../utils/objects.ts';
import { sqlCodePieces } from './sql-code.ts';
import type { PieceOfCode } from './sql-code.ts';
import { isTableRefreshAsked } from './connected-table-refresh.ts';
import type { CallToConfirm } from './connected-table-refresh.ts';
import type { ConnectedTableRefusalWhy } from './connected-table-host.ts';
import type { PageState } from '../state/initial-state.ts';
import type { CallOfAConnectedTable, ConnectedTableRead, WorkbookReads } from '../model/workbook.ts';

/** How a connected table stands, as its bar says it. */
export type ConnectedTableStands =
  | { kind: 'refreshing' }
  | { kind: 'refused'; why: ConnectedTableRefusalWhy; toolSaid: string | null }
  | { kind: 'notFetched' }
  | { kind: 'loadingRows' }
  | { kind: 'rowsNotKept' }
  | { kind: 'stale' }
  | { kind: 'current'; rowCount: number; isCutOff: boolean; fetchedAtMs: number };
/** What the bar offers after a refusal: open the connectors, or ask the agent to fix the call. */
export type WayOutOfRefusal = 'openConnectors' | 'askAgent';
export interface ConnectedTableBarShown {
  connector: string | null;
  stands: ConnectedTableStands;
  isLoading: boolean;
  isAmiss: boolean;
  hasBeenFetched: boolean;
  isRefreshUnderWay: boolean;
  isPaneOpen: boolean;
  wayOut: WayOutOfRefusal | null;
}
/** A piece of code as shown: its pieces, and its text to copy. */
export interface CodeShown {
  written: PieceOfCode[];
  toCopy: string;
}
export interface ArgumentShown {
  /** `null` when the arguments are shown as one code. */
  name: { written: PieceOfPastedText[]; said: string | null } | null;
  value: CodeShown;
}
export interface CallShown {
  title: PieceOfPastedText[];
  connector: PieceOfPastedText[];
  requests: { tool: PieceOfPastedText[]; argumentsOfTool: ArgumentShown[] }[];
  transform: CodeShown;
}
export interface CallToConfirmShown {
  nth: number;
  isMarkedReadOnly: boolean;
  call: CallShown;
}

export function cleanTextToSay(text: string, maxLength?: number): string | null {
  let cleaned = cleanTextForAgent(text, maxLength)
    .replaceAll(/["\p{Pi}\p{Pf}″‶＂ʺ〝〞〟]/gu, "'")
    .replaceAll(/\p{M}{5,}/gu, '')
    .trim();
  return cleaned === '' ? null : cleaned;
}
export function connectedTableStands(
  { refreshOfTable, sheetId }: Pick<PageState, 'refreshOfTable' | 'sheetId'>,
  { snapshot, rows, freshness }: ConnectedTableRead,
): ConnectedTableStands {
  if (refreshOfTable?.sheetId === sheetId) {
    if (refreshOfTable.kind === 'asked') return { kind: 'refreshing' };
    let { why, toolSaid = '' } = refreshOfTable.refusal;
    return {
      kind: 'refused',
      why,
      toolSaid: cleanTextToSay(toolSaid, MAX_TOOL_SAID_LENGTH),
    };
  }
  if (snapshot === null) return { kind: 'notFetched' };
  if (rows.kind === 'notHeld') return { kind: 'loadingRows' };
  if (rows.kind !== 'held') return { kind: 'rowsNotKept' };
  if (freshness === 'stale') return { kind: 'stale' };
  let [{ rowCount }, fetchedAtMs] = [rows, snapshot.fetchedAtInSecondsSince1970 * 1000],
    isCutOff = snapshot.isCutOff || rowCount < snapshot.rowCount;
  return {
    kind: 'current',
    rowCount,
    isCutOff,
    fetchedAtMs,
  };
}
export function connectedTableBarOf(state: PageState, reads: WorkbookReads): ConnectedTableBarShown | null {
  let table = reads.connectedTableIn(state.sheetId);
  if (table === null) return null;
  let stands = connectedTableStands(state, table),
    isLoading = stands.kind === 'refreshing' || stands.kind === 'loadingRows',
    bar: ConnectedTableBarShown = {
      connector: table.call === null ? null : cleanTextForAgent(table.call.connector),
      stands,
      isLoading,
      isAmiss: stands.kind === 'current' ? stands.isCutOff : !isLoading && stands.kind !== 'notFetched',
      hasBeenFetched: table.snapshot !== null,
      isRefreshUnderWay: isTableRefreshAsked(state),
      isPaneOpen: state.sidePane?.kind === 'sourceOfTable',
      wayOut: stands.kind === 'refused' ? (WAY_OUT_OF_REFUSAL[stands.why] ?? null) : null,
    },
    asText = JSON.stringify(bar);
  if (connectedTableBarShown?.asText !== asText) connectedTableBarShown = { asText, shown: bar };
  return connectedTableBarShown.shown;
}
export function parseJsonOrNothing(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return;
  }
}
export function argumentsAsOneCode(argumentsAsJson: string): ArgumentShown[] {
  let parsed = parseJsonOrNothing(argumentsAsJson);
  return [
    {
      name: null,
      value: codeToShow(parsed === void 0 ? argumentsAsJson : JSON.stringify(parsed, null, 2)),
    },
  ];
}
export function argumentsByName(argumentsAsJson: string): ArgumentShown[] {
  let parsed = parseJsonOrNothing(argumentsAsJson);
  if (!isNonNullObject(parsed)) return argumentsAsOneCode(argumentsAsJson);
  return Object.entries(parsed).map(([name, value]) => ({
    name: {
      written: splitSeenAndUnseen(name),
      said: cleanTextToSay(name, MAX_ARGUMENT_NAME_LENGTH),
    },
    value: typeof value === 'string' ? codeToShow(value, sqlCodePieces(value)) : codeToShow(JSON.stringify(value, null, 2)),
  }));
}
export function sourceOfTableShown(state: PageState, reads: WorkbookReads): CallShown | null {
  if (state.sidePane?.kind !== 'sourceOfTable') return null;
  let call = reads.connectedTableIn(state.sheetId)?.call ?? null;
  if (call === null) return null;
  let shown = CALLS_SHOWN.get(call) ?? callToShow(call, argumentsByName);
  return (CALLS_SHOWN.set(call, shown), shown);
}
export function callToConfirmShown({ callToConfirm }: Pick<PageState, 'callToConfirm'>): CallToConfirmShown | null {
  if (callToConfirm === null) return null;
  let { nth, isMarkedReadOnly, call } = callToConfirm,
    shown = CALLS_TO_CONFIRM_SHOWN.get(callToConfirm) ?? {
      nth,
      isMarkedReadOnly,
      call: callToShow(call, argumentsAsOneCode),
    };
  return (CALLS_TO_CONFIRM_SHOWN.set(callToConfirm, shown), shown);
}
export const WAY_OUT_OF_REFUSAL: Partial<Record<ConnectedTableRefusalWhy, WayOutOfRefusal>> = {
  notConnected: 'openConnectors',
  reconnect: 'openConnectors',
  severalConnectorsHaveTheName: 'openConnectors',
  callNotWellFormed: 'askAgent',
  answerNotRead: 'askAgent',
  answerTooLarge: 'askAgent',
  toolError: 'askAgent',
  noRowInTime: 'askAgent',
};
export const MAX_TOOL_SAID_LENGTH = 601;
export let connectedTableBarShown: { asText: string; shown: ConnectedTableBarShown } | null = null;
export const codeToShow = (text: string, written: PieceOfCode[] | null = null): CodeShown => ({
  written: written ?? splitSeenAndUnseen(text),
  toCopy: escapeClipboardCellText(text),
});
export const MAX_ARGUMENT_NAME_LENGTH = 60;
export const callToShow = (call: CallOfAConnectedTable, argumentsOf: (argumentsAsJson: string) => ArgumentShown[]): CallShown => ({
  title: splitSeenAndUnseen(call.title),
  connector: splitSeenAndUnseen(call.connector),
  requests: [call, ...(call.followUp === null ? [] : [call.followUp])].map((request) => ({
    tool: splitSeenAndUnseen(request.tool),
    argumentsOfTool: argumentsOf(request.argumentsAsJson),
  })),
  transform: codeToShow(call.transform.source),
});
export const CALLS_SHOWN = new WeakMap<CallOfAConnectedTable, CallShown>();
export const CALLS_TO_CONFIRM_SHOWN = new WeakMap<CallToConfirm, CallToConfirmShown>();
