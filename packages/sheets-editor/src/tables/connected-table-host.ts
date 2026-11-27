import type { AgentStatus, SheetCapability } from '@open-artifact/runtime/capabilities';
import type { SheetFrame, SheetSendResponse } from '@open-artifact/runtime/sheet-api';
import type { CallOfAConnectedTable } from '../model/workbook.ts';

/**
 * Why a connected table was not refreshed, as its bar tells it. The host
 * that refreshes it answers some; the page finds the others itself.
 */
export type ConnectedTableRefusalWhy =
  | 'notJustNow'
  | 'noRowInTime'
  | 'callChanged'
  | 'callNotWellFormed'
  | 'answerNotRead'
  | 'answerTooLarge'
  | 'toolError'
  | 'callFailed'
  | 'connectorNotServed'
  | 'notConnected'
  | 'reconnect'
  | 'severalConnectorsHaveTheName'
  | 'toolNotAllowedHere'
  | 'toolAsksFirst'
  | 'toolNotAskedFor'
  | 'notServed'
  | 'signInLapsed'
  | 'noRoomInWorkbook'
  | 'notAllowed'
  | 'unconfirmed'
  | 'failed';
export interface TableRefreshRefusal {
  kind: 'refused';
  why: ConnectedTableRefusalWhy;
  /** What the tool said when it failed (`why` is `toolError`). */
  toolSaid?: string;
  /** Tools the person must allow before the refresh can run. */
  toolsToAllow?: string[];
}
/** How a refresh of a connected table ended. */
export type TableRefreshAnswer = { kind: 'refreshed' } | TableRefreshRefusal | { kind: 'toBeConfirmed'; isMarkedReadOnly: boolean };
/** A refresh the page asks for. */
export interface TableRefreshAsked {
  sheetId: string;
  call: CallOfAConnectedTable;
  callDigest: string;
  viewerId: string | null;
  /** The person confirmed the call just now. */
  isConfirmedNow: boolean;
}
export interface TableRefreshes {
  refresh: (asked: TableRefreshAsked) => Promise<TableRefreshAnswer>;
}
/** What refreshes hear of while they wait: the frames of the Sheet's stream, the agent's status, the workbook's changes. */
export interface TableRefreshesHeard extends TableRefreshes {
  heard(frame: SheetFrame): void;
  agentStatusChanged(status: AgentStatus): void;
  workbookChanged(): void;
}
export interface TableNow {
  snapshotId: string | null;
  callDigest: string | null;
}
export interface TableRefreshesDeps {
  /** The Sheet's server, which hands the call to the agent; `null` while there is none. */
  sheet: () => Pick<SheetCapability, 'send'> | null;
  /**
   * What the page's own workbook holds of a connected table now: the snapshot of its rows and the digest of its call
   * (each `null` when it has none); `null` while no workbook is open to tell.
   */
  tableNow: (sheetId: string) => TableNow | null;
  findStorage: () => Storage;
  /** Timers, for tests. */
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export function confirmedCallKeys(findStorage: () => Storage): string[] {
  try {
    let keys: unknown = JSON.parse(findStorage().getItem('sheets-calls-confirmed') ?? '[]');
    return Array.isArray(keys) ? keys : [];
  } catch {
    return [];
  }
}
export function rememberCallConfirmed(asked: TableRefreshAsked, findStorage: () => Storage): void {
  if (asked.viewerId === null) return;
  let others = confirmedCallKeys(findStorage).filter((key) => key !== confirmedCallKey(asked));
  try {
    findStorage().setItem('sheets-calls-confirmed', JSON.stringify([...others, confirmedCallKey(asked)].slice(-200)));
  } catch {}
}

/** The longest a refresh is waited for once the agent was asked. */
export const MOST_REFRESH_WAIT_MS = 15 * 60_000;
/** How long after the agent stopped working the rows may still be on their way. */
export const ROWS_AFTER_AGENT_STOPPED_MS = 10_000;
/** How often the workbook is looked at while a refresh is waited for. */
const LOOK_EVERY_MS = 1_000;

/** The page's refusal for the server's refusal of a refresh request. */
export function refusalOfSend(refusal: string): TableRefreshRefusal {
  return refreshRefusal(SEND_REFUSALS.get(refusal) ?? 'failed');
}
/** The page's refusal for why the agent said the rows did not come. */
export function refusalOfAgent(why: string, toolSaid?: string): TableRefreshRefusal {
  let known = REFRESH_REFUSALS_BY_REASON.get(why) ?? (REFUSALS_OF_AGENT.has(why) ? (why as ConnectedTableRefusalWhy) : 'failed');
  return known === 'toolError' && typeof toolSaid === 'string' && toolSaid !== '' ? { kind: 'refused', why: known, toolSaid } : refreshRefusal(known);
}

/**
 * Refreshes through the Sheet's server: the page asks it to refresh a table, it hands the call to the agent, and the
 * agent sends the rows back as a new snapshot of the table, or tells why there are none. The request answers at once;
 * the refresh is done when the table's snapshot changes, and refused when the server sends why or the agent stops
 * without rows.
 */
export function createTableRefreshes({
  sheet,
  tableNow,
  findStorage,
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}: TableRefreshesDeps): TableRefreshesHeard {
  type Waiting = {
    callDigest: string;
    snapshotIdBefore: string | null;
    settle: (answer: TableRefreshAnswer) => void;
    timers: unknown[];
    sawAgentWork: boolean;
  };
  let waiting = new Map<string, Waiting>();
  let looking: unknown = null;
  let lookAgain = (): void => {
    looking = null;
    look();
    if (waiting.size > 0) looking = setTimer(lookAgain, LOOK_EVERY_MS);
  };
  function look(): void {
    for (let [sheetId, wait] of waiting) {
      let now = tableNow(sheetId);
      if (now === null) continue;
      if (now.snapshotId !== wait.snapshotIdBefore) wait.settle({ kind: 'refreshed' });
      else if (now.callDigest !== wait.callDigest) wait.settle(refreshRefusal('callChanged'));
    }
  }
  function waitForRows(sheetId: string, callDigest: string): Promise<TableRefreshAnswer> {
    return new Promise((resolve) => {
      let wait: Waiting = {
        callDigest,
        snapshotIdBefore: tableNow(sheetId)?.snapshotId ?? null,
        timers: [],
        sawAgentWork: false,
        settle(answer) {
          if (waiting.get(sheetId) !== wait) return;
          waiting.delete(sheetId);
          for (let timer of wait.timers) clearTimer(timer);
          if (waiting.size === 0 && looking !== null) {
            clearTimer(looking);
            looking = null;
          }
          resolve(answer);
        },
      };
      waiting.get(sheetId)?.settle(refreshRefusal('notJustNow'));
      waiting.set(sheetId, wait);
      wait.timers.push(setTimer(() => wait.settle(refreshRefusal('noRowInTime')), MOST_REFRESH_WAIT_MS));
      if (looking === null) looking = setTimer(lookAgain, LOOK_EVERY_MS);
    });
  }
  async function refresh(asked: TableRefreshAsked): Promise<TableRefreshAnswer> {
    let { sheetId, callDigest, isConfirmedNow } = asked,
      server = sheet();
    if (server === null) return refreshRefusal('notServed');
    if (isConfirmedNow) rememberCallConfirmed(asked, findStorage);
    // Whether the tools only read cannot be told here, so the call is confirmed as one that may change things.
    else if (!isCallConfirmed(asked, findStorage)) return { kind: 'toBeConfirmed', isMarkedReadOnly: false };
    let rows = waitForRows(sheetId, callDigest),
      answer: SheetSendResponse | null = await server.send({ kind: 'refreshConnectedTable', sheetId, callDigest }).catch(() => null);
    if (answer?.kind !== 'refreshAsked') waiting.get(sheetId)?.settle(answer?.kind === 'refused' ? refusalOfSend(answer.refusal) : refreshRefusal('notJustNow'));
    return rows;
  }
  return {
    refresh,
    heard(frame) {
      if (frame.phase === 'tableRefresh') {
        let wait = waiting.get(frame.sheetId);
        if (wait !== undefined && wait.callDigest === frame.callDigest) wait.settle(refusalOfAgent(frame.outcome.why, frame.outcome.toolSaid));
      } else if (frame.phase === 'edit' || frame.phase === 'snapshot') look();
    },
    agentStatusChanged(status) {
      for (let wait of waiting.values()) {
        if (status.busy) wait.sawAgentWork = true;
        else if (wait.sawAgentWork) {
          // The agent stopped: the rows it sent may still be on their way to the page.
          wait.sawAgentWork = false;
          wait.timers.push(setTimer(() => (wait.sawAgentWork ? undefined : wait.settle(refreshRefusal('noRowInTime'))), ROWS_AFTER_AGENT_STOPPED_MS));
        }
      }
    },
    workbookChanged: look,
  };
}
export const confirmedCallKey = ({ viewerId, callDigest }: Pick<TableRefreshAsked, 'viewerId' | 'callDigest'>): string => `${viewerId} ${callDigest}`;
export const isCallConfirmed = (asked: TableRefreshAsked, findStorage: () => Storage): boolean => confirmedCallKeys(findStorage).includes(confirmedCallKey(asked));
export const refreshRefusal = (why: ConnectedTableRefusalWhy): TableRefreshRefusal => ({ kind: 'refused', why });
export const NO_TABLE_REFRESHES: TableRefreshes = {
  refresh: () => Promise.resolve(refreshRefusal('notServed')),
};
/** The server's refusals of a refresh request, as the bar tells them. */
export const SEND_REFUSALS = new Map<string, ConnectedTableRefusalWhy>([
  ['notOwner', 'notAllowed'],
  ['notWriter', 'notAllowed'],
  ['notAConnectedTable', 'callChanged'],
  ['callChanged', 'callChanged'],
  ['agentNotListening', 'notServed'],
  ['refreshUnderWay', 'notJustNow'],
]);
/** What the agent may say of a refresh that brought no rows, as the bar tells it. */
export const REFUSALS_OF_AGENT: ReadonlySet<string> = new Set<ConnectedTableRefusalWhy>([
  'noRowInTime',
  'callNotWellFormed',
  'answerNotRead',
  'answerTooLarge',
  'toolError',
  'callFailed',
  'connectorNotServed',
  'notConnected',
  'reconnect',
  'severalConnectorsHaveTheName',
  'toolNotAllowedHere',
  'toolAsksFirst',
  'signInLapsed',
  'notAllowed',
  'unconfirmed',
  'failed',
]);
export const REFRESH_REFUSALS_BY_REASON = new Map<string, ConnectedTableRefusalWhy>([
  ['busy', 'notJustNow'],
  ['sheetNotReadable', 'notJustNow'],
  ['callChanged', 'callChanged'],
  ['notAConnectedTable', 'callChanged'],
  ['callNotWellFormed', 'callNotWellFormed'],
  ['cursorRefused', 'callNotWellFormed'],
  ['cursorTooLong', 'callNotWellFormed'],
  ['followUpNotDeclared', 'callNotWellFormed'],
  ['transformFailed', 'answerNotRead'],
  ['transformReturnedAnotherShape', 'answerNotRead'],
  ['valueThatNoCellHolds', 'answerNotRead'],
  ['textTooLongForACell', 'answerNotRead'],
  ['tooManyFields', 'answerNotRead'],
  ['fieldNotWellNamed', 'answerNotRead'],
  ['answerTooLarge', 'answerTooLarge'],
  ['fileTooLarge', 'answerTooLarge'],
  ['callsNotServed', 'notServed'],
  ['refreshNotFromThePage', 'notServed'],
  ['switchedOff', 'notServed'],
  ['connectedTablesSwitchedOff', 'notServed'],
  ['noPlaceForTheFile', 'notServed'],
  ['noRoomForARow', 'noRoomInWorkbook'],
  ['noRoomInTheHistory', 'noRoomInWorkbook'],
  ['pointerNotSaved', 'unconfirmed'],
  ['noRowInTime', 'noRowInTime'],
  ['toolError', 'toolError'],
  ['callFailed', 'callFailed'],
  ['connectorNotServed', 'connectorNotServed'],
  ['notConnected', 'notConnected'],
  ['reconnect', 'reconnect'],
  ['severalConnectorsHaveTheName', 'severalConnectorsHaveTheName'],
  ['toolNotAllowedHere', 'toolNotAllowedHere'],
  ['toolAsksFirst', 'toolAsksFirst'],
  ['signInLapsed', 'signInLapsed'],
]);
