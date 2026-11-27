import {
  BIGQUERY_POLL_TOOL,
  CUT_WITHOUT_ROWS_MESSAGE,
  DATABRICKS_POLL_TOOL,
  QUERY_TIME_BUDGET_MS,
  READERS_BY_KIND,
  ResultReaderError,
  SYSTEM_CLOCK,
  createLoaderResultReaders,
  describeAnswerShape,
  getCachedStoredAt,
  getConnectorSqlTool,
  getKnownConnector,
  getLoaderAnswerError,
  getSourceConnectorSpec,
  getToolErrorText,
  hasCutWithoutRows,
  isPlainObject,
  isScalarRecord,
  isTablePayload,
  markTableTruncated,
  normalizeMcpError,
  normalizeTable,
  parseStoredQueryArgs,
  queryFailure,
  quotedQueryFailure,
  recordToolCall,
  summarizeToolAnswer,
  tokenizeSql,
  unwrapToolPayload,
  withResultMetadata,
  type CachePolicy,
  type CachedToolResult,
  type ConnectorAnswer,
  type DatasetLoader,
  type ExecutableQuery,
  type ExecuteQueryOptions,
  type LoadFailure,
  type LoadResult,
  type LoadSuccess,
  type LoadWording,
  type LoaderOutputEnvelope,
  type LoaderResultReaders,
  type LoaderToolCaller,
  type McpToolResult,
  type PollClock,
  type ReaderContext,
  type ReaderError,
  type ResultMetadata,
  type ResultReader,
  type SqlQuoteMode,
  type Table,
  type ToolCall,
  type ToolCallOptions,
  type ToolCaller,
  type UnknownRecord,
  type UnwrappedLoaderOutput,
  type WordedMessage,
} from '@open-artifact/data-core';
import type { McpToolClient } from './mcp.ts';
import { getToolCacheGcTime } from './tool-cache.ts';
import { cloneJsonData, errorToMessage, getErrorCode, isNonDataConnector, joinAlternatives, parseJsonOrText, stableStringify } from './util.ts';
import { RECENTLY_SHOWN_MS, isFlakyLoad, markFlaky } from './retry.ts';
import { isSharedCallError, sharedErrorToLoadFailure } from './shared-access.ts';

/** What a query runs with: the tool client, and the clock its waits and timings use. */
export interface QueryEnvironment {
  client: Pick<McpToolClient, 'call' | 'watch'>;
  clock?: PollClock;
  /** How long a query (its loader's calls and its polls) may take in all. */
  budgetMs?: number;
}

/** Why a query can't run from a dashboard: the English message and its wording. */
export interface QuerySourceRefusal {
  message: string;
  wording?: LoadWording;
}

/** An identical call from a loader waits this long after the previous one. */
export const MIN_LOADER_CALL_INTERVAL_MS = 1000;

export const FILE_LOADER_NO_CONNECTOR_MESSAGE =
  'an attached file has no connector, so its loader’s call and read can’t be used; its answer is the file’s text, JSON already parsed';

const LOADER_OUTPUT_KEYS = ['data', 'columns', 'truncated', 'cut', 'meta'];

export const QUERY_TIMED_OUT_FAILURE: ReaderError = { ...queryFailure('tookTooLong'), timedOut: true };

/** A loader's call failed (or ran out of time): its failure is a reader's, with the answer kept. */
export class LoaderCallError extends ResultReaderError {}

export function hasUnterminatedSqlQuote(sql: string, quotes: SqlQuoteMode = 'backslash'): boolean {
  return tokenizeSql(sql, quotes).some((token) => token.open === true);
}

export function connectorConsentRequired(connector: string): LoadFailure {
  return {
    ok: false,
    kind: 'connect',
    message: `This dashboard needs your permission to use ${connector}.`,
    wording: { code: 'unasked', connector },
  };
}

export function connectorConsentStillRequired(connector: string): LoadFailure {
  return {
    ...connectorConsentRequired(connector),
    again: {
      message: `${connector} still needs your permission. If no dialog opened, reload the whole page to be asked again.`,
      wording: { code: 'heldBack', connector },
    },
  };
}

export function connectorLoadFailureMessage(connector: string): WordedMessage {
  return { message: `Couldn’t load from ${connector}.`, wording: { code: 'couldnt', connector } };
}

export function connectorReauthenticationRequired(connector: string): LoadFailure {
  return { ok: false, kind: 'reauth', ...connectorLoadFailureMessage(connector) };
}

export function connectorMissing(connector: string): LoadFailure {
  return { ok: false, kind: 'absent', ...connectorLoadFailureMessage(connector) };
}

export function connectorUnchosen(connector: string): LoadFailure {
  return {
    ok: false,
    kind: 'unchosen',
    message: `${connector} is no longer available. Please choose a new connector.`,
    wording: { code: 'unchosen', connector },
    again: {
      message: `${connector} is no longer available. If no dialog opened, reload the whole page.`,
      wording: { code: 'stillUnchosen', connector },
    },
  };
}

export function connectorDeclined(connector: string): LoadFailure {
  return {
    ok: false,
    kind: 'declined',
    off: true,
    message: `${connector} is turned off for this dashboard.`,
    wording: { code: 'turnedOff', connector },
  };
}

export const LIVE_DATA_UNAVAILABLE_RESULT: LoadFailure = {
  ok: false,
  kind: 'declined',
  message: 'Live data isn’t available in this view.',
  wording: { code: 'noLiveData' },
};

export const ORG_APPROVAL_REQUIRED_RESULT: LoadFailure = {
  ok: false,
  kind: 'refused',
  message: 'Your organization requires approval for this query tool, which a dashboard can’t ask for yet.',
  wording: { code: 'orgApproval' },
};

export function toolUnavailableResult(connector: string): LoadFailure {
  return {
    ok: false,
    kind: 'failed',
    message: `This tool isn’t available on ${connector}.`,
    wording: { code: 'toolUnavailable', connector },
  };
}

export const RESULT_TOO_BIG_RESULT: LoadFailure = {
  ok: false,
  kind: 'refused',
  message: 'Its result is too large for a dashboard to load. Aggregate it in the query.',
  wording: { code: 'resultTooBig' },
};

export function refusedLoadResult(message: string, wording?: LoadWording): LoadFailure {
  return { ok: false, kind: 'refused', message, ...(wording === undefined ? {} : { wording }) };
}

/** The viewer turned this connector off for the page (or it isn't in the page's manifest). */
export function isConnectorNotGrantedError(error: unknown): boolean {
  return isPlainObject(error) && (error.code === 'not_in_manifest' || (error.code === 'not_granted' && typeof error.server === 'string'));
}

/** Each text item of a tool's answer, a JSON text parsed. */
export function toolResultItems(result: McpToolResult): unknown[] {
  return (result.content ?? []).flatMap((item) => (typeof item?.text === 'string' ? [parseJsonOrText(item.text)] : []));
}

export function isBarePayload(result: McpToolResult): boolean {
  return result.payload === undefined && result.structuredContent === undefined;
}

export function hasSeveralItems(result: McpToolResult): boolean {
  return isBarePayload(result) && (result.content?.length ?? 0) > 1;
}

/** The tool marked its failure retryable (`_meta.retryable`): a busy answer the store retries. */
export function isRetryableToolResult(result: McpToolResult): boolean {
  const meta = result._meta;
  return isPlainObject(meta) && meta.retryable === true;
}

function isRetryablePayload(error: unknown): boolean {
  return isPlainObject(error) && error.retryable === true;
}

function getRetryAfter(error: unknown): number | undefined {
  const value = isPlainObject(error) ? error.retryAfterMs : undefined;
  return typeof value === 'number' && value > 0 ? value : undefined;
}

function hasRetryAfter(error: unknown): boolean {
  return getRetryAfter(error) !== undefined;
}

/** A thrown value that isn't an `Error`, or one of the errors code makes by mistake: the page's own code failed. */
export function isPageCodeError(error: unknown): boolean {
  return (
    !(error instanceof Error) ||
    error instanceof TypeError ||
    error instanceof ReferenceError ||
    error instanceof RangeError ||
    error instanceof SyntaxError
  );
}

function isLoaderOutputEnvelope(value: unknown): value is LoaderOutputEnvelope {
  return (
    isPlainObject(value) &&
    Object.hasOwn(value, 'data') &&
    Object.keys(value).length > 1 &&
    Object.keys(value).every((key) => LOADER_OUTPUT_KEYS.includes(key))
  );
}

/** A poll tool only waits on a running query (BigQuery's job results, Databricks' statement). */
export function isLoaderPollTool(tool: string): boolean {
  return tool === BIGQUERY_POLL_TOOL || tool === DATABRICKS_POLL_TOOL;
}

function getLoaderPollOption(options: unknown): boolean | undefined {
  return isPlainObject(options) && typeof options.poll === 'boolean' ? options.poll : undefined;
}

function isThrownMcpError(error: unknown): boolean {
  return !(error instanceof Error) && isPlainObject(error) && typeof error.code === 'string';
}

/** A tool's error answer: its first text, quoted; a tool that said nothing gets the generic failure. */
function toolFailureResult(result: McpToolResult): LoadResult {
  const text = result.content?.find((item) => typeof item?.text === 'string')?.text ?? '';
  return finalizeQueryResult(
    { ...quotedQueryFailure(typeof text === 'string' ? text : ''), ...(isRetryableToolResult(result) ? { busy: true } : {}) },
    0,
  );
}

/** A load that succeeded on an answer of several text items beside a payload says how many items there were. */
function withItemCount(result: LoadResult, raw: McpToolResult): LoadResult {
  const count = (raw.content ?? []).filter((item) => typeof item?.text === 'string').length;
  return result.ok && count > 1 && raw.payload !== undefined && raw.structuredContent === undefined ? { ...result, items: count } : result;
}

/** A record's own `result` field (else the value itself), a JSON text parsed. */
function unwrapResultField(value: unknown): unknown {
  const inner = isPlainObject(value) && Object.hasOwn(value, 'result') ? value.result : value;
  return typeof inner === 'string' ? parseJsonOrText(inner) : inner;
}

/** The answer a loader gets: each text item when there are several, else the payload (a lone `result` field unwrapped). */
export function unwrapLoaderAnswer(result: McpToolResult): unknown {
  if (hasSeveralItems(result)) return toolResultItems(result);
  const payload = unwrapToolPayload(result);
  return isPlainObject(payload) && Object.keys(payload).length > 1 ? payload : unwrapResultField(payload);
}

function normalizePlainAnswer(answer: unknown): ConnectorAnswer {
  const value = cloneJsonData(answer);
  if (value !== undefined) return { value };
  return {
    error: `This answer isn’t rows or plain data. Add a loader (dash.loader) to turn it into rows.${describeAnswerShape(answer)}`,
    answer,
  };
}

/**
 * A tool's answer as rows or plain data: the connector's reader first, then the answer's error, then a table
 * (the answer, else its text items when they are rows), else the plain answer.
 */
export async function readConnectorToolResult(
  raw: McpToolResult,
  reader: ResultReader | undefined,
  context: ReaderContext,
): Promise<ConnectorAnswer> {
  const payload = unwrapToolPayload(raw);
  const unwrapped = !hasSeveralItems(raw) && isPlainObject(payload) && ['string', 'object'].includes(typeof payload.result);
  const value = unwrapped || !isPlainObject(payload) ? unwrapResultField(payload) : payload;
  const read = await reader?.(value, { unwrapped, ...context });
  if (read != null) return read;
  const error = hasSeveralItems(raw) ? '' : getLoaderAnswerError(value);
  if (error !== '') return { error, quoted: true };
  const items = toolResultItems(raw).filter((item) => item !== null);
  const itemsAreRows =
    isBarePayload(raw) &&
    !unwrapped &&
    items.every(isPlainObject) &&
    (hasSeveralItems(raw) || reader !== undefined || items.every((item) => isScalarRecord(item as UnknownRecord)));
  const table = normalizeTable(value) ?? (itemsAreRows ? normalizeTable(items) : null);
  return table === null ? normalizePlainAnswer(unwrapLoaderAnswer(raw)) : { table };
}

function unwrapLoaderOutput(output: unknown): UnwrappedLoaderOutput {
  if (!isLoaderOutputEnvelope(output))
    return { result: output, meta: isPlainObject(output) && isTablePayload(output) ? output.meta : undefined };
  const { data, columns, truncated, cut, meta } = output;
  return { result: Array.isArray(data) && isTablePayload(data) ? { rows: data, columns, truncated, cut } : data, meta };
}

/** What a loader returned, as rows or plain data; `null` when it returned nothing the page can hold. */
export function normalizeLoaderOutput(output: unknown): ConnectorAnswer | null {
  const { result, meta } = unwrapLoaderOutput(output);
  if (result === undefined || result === null) return null;
  const table = isTablePayload(result) ? normalizeTable(result) : null;
  if (table !== null)
    return {
      table: withResultMetadata(isPlainObject(result) && (result.cut ?? result.truncated) === true ? markTableTruncated(table) : table, meta),
    };
  const value = cloneJsonData(result);
  return value === undefined ? null : { value, meta };
}

async function runDatasetLoader(
  answer: unknown,
  items: () => unknown[],
  loader: DatasetLoader,
  call: LoaderToolCaller,
  read: LoaderResultReaders,
  args: UnknownRecord,
): Promise<ConnectorAnswer> {
  if (answer === undefined) return { table: { columns: [], rows: [] } };
  const answerError = getLoaderAnswerError(answer);
  if (answerError !== '') return { error: answerError, quoted: true };
  return runLoaderFunction(answer, items, loader, call, read, args);
}

/** Runs a loader on an answer (a query's, or an attached file's text); a reader's or a call's failure keeps its wording. */
async function runLoaderFunction(
  answer: unknown,
  items: () => unknown[],
  loader: DatasetLoader,
  call: LoaderToolCaller,
  read: LoaderResultReaders,
  args: UnknownRecord,
): Promise<ConnectorAnswer> {
  let output: unknown;
  try {
    output = await loader.fn({
      answer,
      get items() {
        return items();
      },
      call,
      args,
      read,
    });
  } catch (error) {
    if (error instanceof ResultReaderError)
      return { ...error.failure, error: error.message, ...(error instanceof LoaderCallError ? { answer } : {}) };
    if (isThrownMcpError(error)) throw error;
    return {
      error: `This source’s loader stopped: ${errorToMessage(error)}.${describeAnswerShape(answer)}`,
      ...(isPageCodeError(error) ? { pageCode: true } : {}),
      answer,
    };
  }
  return (
    normalizeLoaderOutput(output) ?? {
      error: `This source’s loader returned nothing the page can hold (plain data: rows, a record, a list, a text or number).${describeAnswerShape(answer)}`,
      pageCode: true,
      answer,
    }
  );
}

function toolExceptionToResult(error: unknown): McpToolResult | null {
  if (!isPlainObject(error) || error.code !== 'tool_error') return null;
  const result = isPlainObject(error.result) ? error.result : {};
  return {
    isError: true,
    content: typeof error.message === 'string' ? [{ type: 'text', text: error.message }] : [],
    ...(isPlainObject(result._meta) ? { _meta: result._meta } : {}),
  };
}

/**
 * A loader's `call`: one call at a time, within the query's time budget; an identical call waits a second after the
 * last. `{items: true}` answers with each text item of the result; `{poll}` says whether the call only waits on a query.
 */
export function createLoaderToolCaller(
  caller: ToolCaller,
  isStale: () => boolean,
  clock: PollClock = SYSTEM_CLOCK,
  budgetMs: number = QUERY_TIME_BUDGET_MS,
): LoaderToolCaller {
  const deadline = clock.now() + budgetMs;
  let lastCall: { asked: string; began: number } | undefined;
  let previous: Promise<unknown> = Promise.resolve();
  const callThrottled = async (tool: string, options: unknown, poll: boolean, asItems: boolean): Promise<unknown> => {
    const args: UnknownRecord = isPlainObject(options) ? options : {};
    const asked = stableStringify([tool, args]) ?? '';
    const stopped = (): boolean => isStale() || clock.now() > deadline;
    const wait = lastCall?.asked === asked ? MIN_LOADER_CALL_INTERVAL_MS - (clock.now() - lastCall.began) : 0;
    if (!stopped() && wait > 0) await clock.sleep(wait);
    if (stopped()) throw new LoaderCallError(QUERY_TIMED_OUT_FAILURE);
    const began = clock.now();
    const result = await caller.call(tool, args, undefined, poll);
    if (getCachedStoredAt(result) === null) lastCall = { asked, began };
    if (result.isError === true) throw new LoaderCallError({ error: getToolErrorText(result) });
    return asItems ? toolResultItems(result) : unwrapLoaderAnswer(result);
  };
  return (tool, options, callOptions) => {
    const next = previous.then(() =>
      callThrottled(tool, options, getLoaderPollOption(callOptions) ?? isLoaderPollTool(tool), isPlainObject(callOptions) && callOptions.items === true),
    );
    previous = next.catch(() => undefined);
    return next;
  };
}

function toolCallMetadata(calls: ToolCall[]): { calls?: ToolCall[] } {
  return calls.length > 1 || (calls[0]?.n ?? 0) > 1 ? { calls } : {};
}

function cutWithoutRowsAnswer(answer: unknown, meta?: ResultMetadata[]): ConnectorAnswer {
  return {
    error: CUT_WITHOUT_ROWS_MESSAGE + describeAnswerShape(answer),
    pageCode: true,
    answer,
    ...(meta === undefined || meta.length === 0 ? {} : { meta }),
  };
}

/** A load's result from its answer; a failure keeps all its marks (its wording among them). */
export function finalizeQueryResult(answer: ConnectorAnswer, durationMs: number, calls: ToolCall[] = []): LoadResult {
  if ('error' in answer) {
    const { error, answer: raw, meta = [], ...rest } = answer;
    const cloned = cloneJsonData(raw);
    return {
      ok: false,
      kind: 'failed',
      message: error,
      ...rest,
      ...toolCallMetadata(calls),
      ...(cloned === undefined ? {} : { answer: cloned }),
      ...(meta.length === 0 ? {} : { meta }),
    };
  }
  if ('value' in answer)
    return {
      ok: true,
      table: withResultMetadata({ columns: [], rows: [] }, answer.meta),
      value: answer.value,
      ms: durationMs,
      ...toolCallMetadata(calls),
    };
  return { ok: true, table: answer.table, ms: durationMs, ...toolCallMetadata(calls) };
}

function finalizeToolAnswer(
  parsed: ConnectorAnswer,
  durationMs: number,
  calls: ToolCall[],
  cutAnswer?: { answer: unknown },
): LoadResult {
  const answer =
    cutAnswer !== undefined && 'table' in parsed && parsed.table.rows.length === 0 ? cutWithoutRowsAnswer(cutAnswer.answer, parsed.table.meta) : parsed;
  return finalizeQueryResult(answer, Math.round(durationMs), calls);
}

/**
 * Runs an attached file's loader on the file's answer (its text; a JSON file's parsed value). A file has no connector,
 * so its `call` and `read` reject; any failure is the page's code. Its one item is the answer.
 */
export function runFileLoader(answer: unknown, loader: DatasetLoader): Promise<ConnectorAnswer> {
  const refuse = (): Promise<never> => {
    const rejected = Promise.reject<never>(new RangeError(FILE_LOADER_NO_CONNECTOR_MESSAGE));
    rejected.catch(() => undefined);
    return rejected;
  };
  const pageCodeFailure = (error: string, meta?: ResultMetadata[]): ConnectorAnswer => ({
    error,
    pageCode: true,
    ...(meta === undefined ? {} : { meta }),
  });
  return runLoaderFunction(
    answer,
    () => [answer],
    loader,
    refuse,
    Object.freeze({ bigquery: refuse, governed: refuse, snowflake: refuse, databricks: refuse, sheet: refuse }),
    {},
  ).then(
    (result) => ('error' in result ? pageCodeFailure(result.error, result.meta) : result),
    (error: unknown) => pageCodeFailure(`This source’s loader stopped: ${errorToMessage(error)}.${describeAnswerShape(answer)}`),
  );
}

function getSourceResultReader(query: ExecutableQuery): ResultReader | undefined {
  const reads = getKnownConnector(query.connector)?.reads;
  return reads === undefined ? undefined : READERS_BY_KIND[reads];
}

/**
 * Why this query can't run from a dashboard, or `null` when it can. With `withValued` off, a `{{filter}}` that is only
 * unfilled because of the viewer's value doesn't count. Of the SQL itself only an unterminated quote is refused.
 */
export function describeQuerySourceRefusal(query: ExecutableQuery, withValued = true): QuerySourceRefusal | null {
  const { connector, tool } = query;
  if (connector === '') return { message: 'This dataset names no connector.', wording: { code: 'noConnector' } };
  if (isNonDataConnector(connector))
    return { message: `A dashboard can’t query ${connector}: it isn’t a data connector.`, wording: { code: 'notData', connector } };
  if (tool === '') return { message: 'This dataset names no tool to call.', wording: { code: 'noTool' } };
  if (query.unfilled !== undefined && (withValued || query.unfilledAs?.valued !== true)) {
    const unfilledAs = query.unfilledAs;
    return {
      message: query.unfilled,
      ...(unfilledAs === undefined
        ? {}
        : {
            wording: {
              code: unfilledAs.code,
              filter: unfilledAs.filter,
              ...(unfilledAs.char === undefined ? {} : { char: unfilledAs.char }),
            } as LoadWording,
          }),
    };
  }
  const spec = getSourceConnectorSpec(query);
  if (spec === null) return null;
  if (!Object.hasOwn(spec.query, tool)) {
    const tools = Object.keys(spec.query);
    return {
      message: `On ${connector} a dashboard can call ${joinAlternatives(tools)}, not “${tool}”.`,
      wording: { code: 'wrongTool', connector, tools, tool },
    };
  }
  const sqlTool = getConnectorSqlTool(spec, tool);
  if (sqlTool === undefined) return null;
  const sql = parseStoredQueryArgs(query)[sqlTool.sqlArg];
  if (typeof sql !== 'string' || sql.trim() === '') return { message: 'This dataset has no query yet.', wording: { code: 'noQuery' } };
  return hasUnterminatedSqlQuote(sql, sqlTool.quotes)
    ? { message: 'This query can’t run from a dashboard: it has an unterminated quote.', wording: { code: 'sqlOpenQuote' } }
    : null;
}

export function getQuerySourceRefusal(query: ExecutableQuery): string | null {
  return describeQuerySourceRefusal(query)?.message ?? null;
}

/** As {@link getQuerySourceRefusal}, ignoring a filter left unfilled only by the viewer's value. */
export function getQueryRefusalIgnoringValues(query: ExecutableQuery): string | null {
  return describeQuerySourceRefusal(query, false)?.message ?? null;
}

/** A tool call failure as a load's failure: the connection to fix, the view's limits, or the connector's own words. */
export function mcpErrorToLoadFailure(connector: string, error: unknown): LoadFailure {
  if (isSharedCallError(error)) return sharedErrorToLoadFailure(error);
  const code = getErrorCode(error);
  if (code === 'needs_reauth') return connectorReauthenticationRequired(connector);
  if (code === 'server_not_connected') return connectorMissing(connector);
  if (isConnectorNotGrantedError(error)) return connectorDeclined(connector);
  if (code === 'approval_required') return ORG_APPROVAL_REQUIRED_RESULT;
  if (code === 'blocked_by_policy') return toolUnavailableResult(connector);
  if (code === 'response_too_large') return RESULT_TOO_BIG_RESULT;
  if (code === 'selection_required') return connectorUnchosen(connector);
  const normalized = normalizeMcpError(error);
  if (normalized.code === 'consent_required') return connectorConsentRequired(connector);
  if (['not_granted', 'not_declared', 'capability_disabled', 'capability_removed'].includes(normalized.code)) return LIVE_DATA_UNAVAILABLE_RESULT;
  const message = (isPlainObject(error) && typeof error.message === 'string' ? error.message : '') || normalized.message;
  // A retryable error that asks for no long wait is likely passing; a rate limit is waited out as a busy answer.
  const wait = getRetryAfter(error);
  const passing = (failure: LoadFailure): LoadFailure =>
    isRetryablePayload(error) && code !== 'rate_limited' && (wait ?? 0) <= RECENTLY_SHOWN_MS ? markFlaky(failure, wait) : failure;
  if (code === 'upstream_error')
    return passing({ ok: false, kind: 'failed', message: normalized.message, ...(isRetryablePayload(error) ? { crowded: true as const } : {}) });
  const failure: LoadFailure = { ok: false, kind: 'failed', message };
  if (code === 'server_unavailable') return passing({ ...failure, unanswered: true, ...(hasRetryAfter(error) ? { crowded: true as const } : {}) });
  return code === 'rate_limited' ? { ...failure, unanswered: true, crowded: true } : passing(failure);
}

/** A first call that failed soon after the load began, asking for no wait, is likely passing. */
function markFirstCallFailure(failure: LoadFailure, error: unknown, elapsed: number): LoadFailure {
  if (failure.kind !== 'failed' || failure.crowded === true || isFlakyLoad(failure)) return failure;
  if (elapsed >= RECENTLY_SHOWN_MS || hasRetryAfter(error)) return failure;
  return markFlaky(failure);
}

/**
 * Runs a dataset's query: refuses what can't run, calls the tool (reading a cached answer when `options.reuse` allows),
 * reads the answer with the connector's reader or the dataset's loader, and maps every failure to a worded result.
 */
export async function executeDatasetQuery(
  env: QueryEnvironment,
  query: ExecutableQuery,
  isStale: () => boolean = () => false,
  loader?: DatasetLoader,
  options?: ExecuteQueryOptions,
): Promise<LoadResult> {
  const clock = env.clock ?? SYSTEM_CLOCK;
  const budgetMs = env.budgetMs ?? QUERY_TIME_BUDGET_MS;
  const { connector, tool } = query;
  const refusal = describeQuerySourceRefusal(query);
  if (refusal !== null) return refusedLoadResult(refusal.message, refusal.wording);
  const args = parseStoredQueryArgs(query);
  const startedAt = clock.now();

  const processAnswer = async (input: McpToolResult, loaderCaller: ToolCaller, calls: ToolCall[]): Promise<LoadResult> => {
    if (input.isError === true) return toolFailureResult(input);
    let lastPolled: unknown;
    const pollCall: ReaderContext['call'] = async (pollTool, pollArgs) => {
      const polled = await loaderCaller.call(pollTool, pollArgs, undefined, true);
      if (polled.isError === true) return { error: getToolErrorText(polled) };
      lastPolled = unwrapLoaderAnswer(polled);
      return { value: lastPolled };
    };
    if (loader !== undefined) {
      let finished = false;
      const stopped = (): boolean => finished || isStale();
      const hold = <T,>(promise: Promise<T>): Promise<T> => {
        const held = promise.catch((error: unknown): Promise<T> => (finished ? new Promise<T>(() => undefined) : Promise.reject(error)));
        held.catch(() => undefined);
        return held;
      };
      const loaderToolCaller = createLoaderToolCaller(loaderCaller, stopped, clock, budgetMs);
      let cutAnswer: { answer: unknown } | undefined;
      const readers = createLoaderResultReaders({ args, call: pollCall, stale: stopped, clock }, (answer) => {
        cutAnswer = { answer };
      });
      const heldReaders: LoaderResultReaders = Object.freeze({
        bigquery: (value: unknown) => hold(readers.bigquery(value)),
        governed: (value: unknown) => hold(readers.governed(value)),
        snowflake: (value: unknown) => hold(readers.snowflake(value)),
        databricks: (value: unknown) => hold(readers.databricks(value)),
        sheet: (value: unknown) => hold(readers.sheet(value)),
      });
      let readItems = false;
      const loaded = await runDatasetLoader(
        unwrapLoaderAnswer(input),
        () => {
          readItems = true;
          return toolResultItems(input);
        },
        loader,
        (callTool, callArgs, callOptions) => hold(loaderToolCaller(callTool, callArgs, callOptions)),
        heldReaders,
        args,
      ).finally(() => {
        finished = true;
      });
      const result = finalizeToolAnswer(loaded, clock.now() - startedAt, calls, cutAnswer);
      return readItems ? result : withItemCount(result, input);
    }
    const read = await readConnectorToolResult(input, getSourceResultReader(query), { args, call: pollCall, stale: isStale, clock });
    return withItemCount(
      finalizeToolAnswer(
        read,
        clock.now() - startedAt,
        calls,
        'table' in read && hasCutWithoutRows(read.table) ? { answer: lastPolled ?? unwrapLoaderAnswer(input) } : undefined,
      ),
      input,
    );
  };

  const processStoredAnswer = async (input: CachedToolResult): Promise<LoadSuccess | null> => {
    let madeCall = false;
    const storedCaller: ToolCaller = {
      call: async () => {
        madeCall = true;
        throw new Error('A cached answer makes no call.');
      },
    };
    const value = await processAnswer(input.result, storedCaller, []).catch(() => null);
    if (madeCall) return null;
    return value !== null && value.ok ? { ...value, ms: 0 } : null;
  };

  let stopCacheWatch: () => void = () => undefined;
  let answered = false;
  try {
    const calls: ToolCall[] = [];
    let fetched = false;
    const live: ToolCaller = {
      call: async (callTool, callArgs, callOptions, poll) => {
        const began = clock.now();
        const result = await env.client.call(connector, callTool, callArgs, callOptions).catch((error: unknown): McpToolResult => {
          const asResult = toolExceptionToResult(error);
          if (asResult === null) throw error;
          return asResult;
        });
        if (getCachedStoredAt(result) !== null) return result;
        const failed = result.isError === true;
        fetched ||= !failed;
        recordToolCall(
          calls,
          callTool,
          clock.now() - began,
          !failed,
          failed ? { kind: 'failed' } : summarizeToolAnswer(unwrapLoaderAnswer(result)),
          poll === true,
        );
        return result;
      },
    };
    const reuse = options?.reuse;
    const cachePolicy: CachePolicy = {
      gcTime: getToolCacheGcTime(reuse?.ms ?? 0),
      ...(reuse?.refresh === false ? { staleTime: reuse.ms } : {}),
    };
    const pending = live.call(
      tool,
      args,
      options !== undefined ? { cache: { ...cachePolicy, ...(reuse?.refresh === true ? { refresh: true as const } : {}) } } : undefined,
    );
    const onCached = reuse?.refresh !== true ? options?.onCached : undefined;
    if (onCached !== undefined)
      stopCacheWatch = env.client.watch(connector, tool, args, cachePolicy, (cached) => {
        processStoredAnswer(cached)
          .then((result) => {
            if (result !== null) onCached(result, cached.at);
          })
          .catch(() => undefined);
      });
    const answer = await pending;
    answered = true;
    const storedAt = reuse?.refresh === false ? getCachedStoredAt(answer) : null;
    if (storedAt === null || reuse === undefined) {
      const later: ToolCallOptions | undefined = reuse === undefined ? undefined : { cache: { gcTime: cachePolicy.gcTime } };
      return await processAnswer(answer, { call: (callTool, callArgs, _options, poll) => live.call(callTool, callArgs, later, poll) }, calls);
    }
    const seenCalls = new Set<string>();
    const result = await processAnswer(
      answer,
      {
        call: (callTool, callArgs, _options, poll) => {
          const key = stableStringify([callTool, callArgs]) ?? '';
          const first = !seenCalls.has(key);
          seenCalls.add(key);
          return live.call(callTool, callArgs, { cache: first ? cachePolicy : { gcTime: cachePolicy.gcTime } }, poll);
        },
      },
      calls,
    ).catch((error: unknown): null => {
      if (isThrownMcpError(error)) throw error;
      return null;
    });
    if (result !== null && result.ok)
      return { ...result, at: storedAt, ...(fetched ? { fetched: true as const, calls } : { ms: 0 }) };
    const settled = result !== null && seenCalls.size === 0 && result.pageCode === true;
    if (isStale() || settled) return result ?? finalizeQueryResult(QUERY_TIMED_OUT_FAILURE, 0);
    return await executeDatasetQuery(env, query, isStale, loader, { reuse: { ...reuse, refresh: true } });
  } catch (error) {
    const failure = mcpErrorToLoadFailure(connector, error);
    return answered ? failure : markFirstCallFailure(failure, error, clock.now() - startedAt);
  } finally {
    stopCacheWatch();
  }
}
