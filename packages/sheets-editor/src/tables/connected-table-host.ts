import { isNonNullObject } from '../utils/objects.ts';
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
/** One request of a connected table's call: a tool of the connector and its arguments. */
export interface RequestOfCall {
  tool: string;
  argumentsAsJson: string;
}
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
/** The connectors the page calls the refresh through. */
export interface RefreshMcp {
  callTool: (server: string, tool: string, args: Record<string, unknown>, options?: { cache?: boolean }) => Promise<unknown>;
  describeTool?: (server: string, tool: string) => Promise<unknown>;
}
/** What gives the page its capabilities: `use(name)` resolves to the capability or `null`. */
export interface CapabilitiesOfAgent {
  use?: (name: string) => Promise<unknown>;
}
/** Where the workbook is kept, so the host can find it. */
export interface WhereWorkbookIsKept {
  artifactId: string;
  nodeId: string;
}
export interface TableRefreshesDeps {
  findAgent: () => CapabilitiesOfAgent | null | undefined;
  whereWorkbookIsKept: () => WhereWorkbookIsKept | null;
  findStorage: () => Storage;
}

export async function getAgentCapability<Capability>(
  agent: CapabilitiesOfAgent | null | undefined,
  capabilityName: string,
  isExpectedShape: (capability: unknown) => capability is Capability,
): Promise<Capability | null> {
  if (!isNonNullObject(agent)) return null;
  let { use } = agent;
  if (typeof use !== 'function') return null;
  let capability = await use.call(agent, capabilityName);
  return isExpectedShape(capability) ? capability : null;
}
export const errorCodeOf = (error: unknown): unknown => (isNonNullObject(error) ? error.code : null);
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
export function refreshAnswerOfToolResult(result: unknown): TableRefreshAnswer {
  let content = isNonNullObject(result) ? result.content : null,
    lastPart: unknown = Array.isArray(content) ? content.at(-1) : null,
    text = isNonNullObject(lastPart) ? lastPart.text : null,
    said: unknown = null;
  try {
    said = JSON.parse(String(text).split('\n', 1)[0] ?? '');
  } catch {
    return refreshRefusal('unconfirmed');
  }
  let { verdict, reason, data } = isNonNullObject(said) ? said : {},
    { state: stateOfRefresh, why, refusal, toolsToAllow, toolSaid } = isNonNullObject(data) ? data : {};
  if (stateOfRefresh === 'done') return { kind: 'refreshed' };
  if (stateOfRefresh !== 'refused' && verdict !== 'deny') return refreshRefusal('unconfirmed');
  if (why === 'toolError' && typeof toolSaid === 'string') return { kind: 'refused', why, toolSaid };
  let otherwise: ConnectedTableRefusalWhy = reason === 'access' ? 'notAllowed' : 'failed',
    answer = refreshRefusal(REFRESH_REFUSALS_BY_REASON.get((why ?? refusal) as string) ?? otherwise);
  return Array.isArray(toolsToAllow) && toolsToAllow.length > 0 ? { ...answer, toolsToAllow } : answer;
}
export async function callToBeConfirmed(mcp: RefreshMcp, call: CallOfAConnectedTable): Promise<TableRefreshAnswer> {
  let isReadOnly = async ({ tool }: RequestOfCall): Promise<boolean> => {
    let described: unknown = await mcp.describeTool?.(call.connector, tool).catch(() => null),
      annotations = isNonNullObject(described) ? described.annotations : null;
    return isNonNullObject(annotations) && annotations.readOnlyHint === true;
  };
  return {
    kind: 'toBeConfirmed',
    isMarkedReadOnly: (await Promise.all(requestsOfCall(call).map(isReadOnly))).every(Boolean),
  };
}
export async function allowToolsOfCall(mcp: RefreshMcp, call: CallOfAConnectedTable, toolsToAllow: string[]): Promise<ConnectedTableRefusalWhy | null> {
  if (call.connector.startsWith('host:') || [CONNECTED_TABLE_REFRESH_CONNECTOR].includes(call.connector)) return 'connectorNotServed';
  for (let { tool, argumentsAsJson } of requestsOfCall(call))
    try {
      if (!toolsToAllow.includes(tool)) continue;
      await mcp.callTool(call.connector, tool, JSON.parse(argumentsAsJson), {
        cache: false,
      });
    } catch (error) {
      if (errorCodeOf(error) !== 'tool_error') return TOOL_REFUSALS_BY_ERROR_CODE.get(String(errorCodeOf(error))) ?? 'toolNotAskedFor';
    }
  return null;
}
export function createTableRefreshes({ findAgent, whereWorkbookIsKept, findStorage }: TableRefreshesDeps): TableRefreshes {
  let digestsAllowedAgain = new Set<string>();
  async function refresh(asked: TableRefreshAsked): Promise<TableRefreshAnswer> {
    let { sheetId, call, callDigest, isConfirmedNow } = asked,
      mcp = await getAgentCapability(findAgent(), 'mcp', isRefreshMcpCapability).catch(() => null),
      kept = whereWorkbookIsKept();
    if (mcp === null || kept === null) return refreshRefusal('notServed');
    if (isConfirmedNow) rememberCallConfirmed(asked, findStorage);
    else if (!isCallConfirmed(asked, findStorage)) return callToBeConfirmed(mcp, call);
    let request = {
        container: { kind: 'project', id: kept.artifactId },
        ref: { object: 'node', id: kept.nodeId },
        payload: {
          kind: 'refreshConnectedTable',
          sheetId,
          callDigest,
        },
      },
      askHost = (): Promise<TableRefreshAnswer & { toolsToAllow?: string[] }> =>
        mcp
          .callTool(CONNECTED_TABLE_REFRESH_CONNECTOR, REFRESH_CONNECTED_TABLE_TOOL, request, { cache: false })
          .then(refreshAnswerOfToolResult, refreshAnswerOfToolError),
      { toolsToAllow, ...answer } = await askHost();
    if (toolsToAllow === void 0 || digestsAllowedAgain.has(callDigest)) return answer;
    if (!isConfirmedNow) return callToBeConfirmed(mcp, call);
    let refusedWhy = await allowToolsOfCall(mcp, call, toolsToAllow);
    if (refusedWhy !== null) return refreshRefusal(refusedWhy);
    let { toolsToAllow: toolsStillToAllow, ...answerAfter } = await askHost();
    if (toolsStillToAllow !== void 0) digestsAllowedAgain.add(callDigest);
    return answerAfter;
  }
  return { refresh };
}
export const confirmedCallKey = ({ viewerId, callDigest }: Pick<TableRefreshAsked, 'viewerId' | 'callDigest'>): string => `${viewerId} ${callDigest}`;
export const isCallConfirmed = (asked: TableRefreshAsked, findStorage: () => Storage): boolean => confirmedCallKeys(findStorage).includes(confirmedCallKey(asked));
export const CONNECTED_TABLE_REFRESH_CONNECTOR = 'open-artifact';
export const REFRESH_CONNECTED_TABLE_TOOL = 'refresh_connected_table';
export const refreshRefusal = (why: ConnectedTableRefusalWhy): TableRefreshRefusal => ({ kind: 'refused', why });
export const NO_TABLE_REFRESHES: TableRefreshes = {
  refresh: () => Promise.resolve(refreshRefusal('notServed')),
};
export const isRefreshMcpCapability = (capability: unknown): capability is RefreshMcp =>
  isNonNullObject(capability) && capability.available !== false && typeof capability.callTool === 'function';
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
export const REFRESH_REFUSALS_BY_ERROR_CODE = new Map<string, ConnectedTableRefusalWhy>([
  ['not_in_manifest', 'notAllowed'],
  ['not_granted', 'notAllowed'],
  ['consent_denied', 'notAllowed'],
  ['consent_required', 'notAllowed'],
  ['self_only', 'notAllowed'],
  ['org_mcp_disabled', 'notAllowed'],
  ['approval_required', 'notAllowed'],
  ['blocked_by_policy', 'notServed'],
  ['server_not_connected', 'notServed'],
  ['server_not_found', 'notServed'],
  ['selection_required', 'notServed'],
  ['capability_disabled', 'notServed'],
  ['capability_removed', 'notServed'],
  ['needs_reauth', 'signInLapsed'],
  ['rate_limited', 'notJustNow'],
  ['user_changed', 'notJustNow'],
  ['consent_unavailable', 'notJustNow'],
  ['unavailable', 'notJustNow'],
  ['bad_request', 'failed'],
  ['transform_error', 'failed'],
]);
export const TOOL_REFUSALS_BY_ERROR_CODE = new Map<string, ConnectedTableRefusalWhy>([
  ['not_in_manifest', 'toolNotAllowedHere'],
  ['not_granted', 'toolNotAllowedHere'],
  ['consent_denied', 'toolNotAllowedHere'],
  ['consent_required', 'toolNotAllowedHere'],
  ['blocked_by_policy', 'toolNotAllowedHere'],
  ['org_mcp_disabled', 'toolNotAllowedHere'],
  ['approval_required', 'toolAsksFirst'],
  ['server_not_connected', 'notConnected'],
  ['server_not_found', 'notConnected'],
  ['needs_reauth', 'reconnect'],
  ['selection_required', 'severalConnectorsHaveTheName'],
  ['server_unavailable', 'callFailed'],
  ['rate_limited', 'notJustNow'],
  ['user_changed', 'notJustNow'],
  ['consent_unavailable', 'notJustNow'],
  ['unavailable', 'notJustNow'],
]);
export const refreshAnswerOfToolError = (error: unknown): TableRefreshAnswer =>
  isNonNullObject(error) && error.code === 'tool_error'
    ? refreshAnswerOfToolResult(error.result)
    : refreshRefusal(REFRESH_REFUSALS_BY_ERROR_CODE.get(String(errorCodeOf(error))) ?? 'unconfirmed');
export const requestsOfCall = (call: CallOfAConnectedTable): RequestOfCall[] => (call.followUp === null || call.followUp.tool === call.tool ? [call] : [call, call.followUp]);
