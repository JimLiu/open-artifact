import type { CachedToolResult, McpError, McpToolResult, ReaderError, ToolCall, ToolCallGot } from './connector-types.ts';
import type { ResultCertification, ResultMetadata, Table, UnknownRecord } from './types.ts';
import { isPlainObject, normalizeCodeLanguage, sanitizeSingleLine } from './text.ts';
import { parseHttpsLink } from './links.ts';
import { normalizeTable } from './tables.ts';

/** The error codes a tool call through the host reports as they are; any other failure is "upstream_error". */
export const MCP_ERROR_CODES: ReadonlySet<string> = new Set([
  'not_declared',
  'not_granted',
  'consent_required',
  'capability_disabled',
  'capability_removed',
  'rate_limited',
  'upstream_error',
  'tool_error',
]);

export function isRecordArray(value: unknown): value is UnknownRecord[] {
  return Array.isArray(value) && value.every(isPlainObject);
}

/** A record whose values are all scalars (no objects or lists). */
export function isScalarRecord(record: UnknownRecord): boolean {
  return Object.values(record).every((value) => value === null || typeof value !== 'object');
}

/** A list of records, or a record holding one under `rows`. */
export function isTablePayload(value: unknown): boolean {
  return isRecordArray(value) || (isPlainObject(value) && isRecordArray(value.rows));
}

/** The table of a rows answer that has at least one row, else `null`. */
export function getNonemptyTable(value: unknown): Table | null {
  const table = isTablePayload(value) ? normalizeTable(value) : null;
  return table === null || table.rows.length === 0 ? null : table;
}

/** A list as a record keyed `"1"`, `"2"`, …. */
export function arrayToNumberedRecord(items: readonly unknown[]): UnknownRecord {
  return Object.fromEntries(items.map((item, index) => [String(index + 1), item]));
}

/** A sentence (with a leading space) saying what an answer was, for a failure message; empty when not text or an object. */
export function describeAnswerShape(answer: unknown): string {
  if (typeof answer === 'string') return ` The answer is text, ${answer.length.toLocaleString('en-US')} characters.`;
  if (!isPlainObject(answer)) return '';
  return ` The answer’s keys: ${Object.keys(answer).join(', ')}.`;
}

/** What error an answer reports: its `error` text, or `error.message`; empty when none. */
export function getLoaderAnswerError(answer: unknown): string {
  const error = isPlainObject(answer) ? answer.error : undefined;
  if (typeof error === 'string') return error;
  return isPlainObject(error) && typeof error.message === 'string' ? error.message : '';
}

function parseResultMetadataEntry(entry: unknown): ResultMetadata[] {
  if (!isPlainObject(entry) || entry.type === 'certified') return [];
  const { label, value, type, lang } = entry;
  if (typeof label !== 'string' || typeof value !== 'string' || label.trim() === '' || value.trim() === '') return [];
  if (type !== 'code') return [{ label, value, type: 'text' }];
  const language = normalizeCodeLanguage(lang);
  return [language === undefined ? { label, value, type } : { label, value, type, lang: language }];
}

/** A result's `meta` list: entries with a label and a value, typed "text" or "code" (with its language). */
export function parseResultMetadata(value: unknown): ResultMetadata[] {
  try {
    return Array.isArray(value) ? value.flatMap(parseResultMetadataEntry) : [];
  } catch {
    return [];
  }
}

const FORMAT_CHARACTER_PATTERN = /\p{Cf}/gu;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;
/** The most characters of `by` and `at` a certification keeps. */
export const MAX_CERTIFICATION_CHARACTERS = 80;

function cleanCertificationText(value: unknown): string {
  return sanitizeSingleLine(typeof value === 'string' ? value.replace(FORMAT_CHARACTER_PATTERN, '') : '', MAX_CERTIFICATION_CHARACTERS);
}

/** A certification's time: text starting with an ISO date (a bare date read at noon), else `undefined`. */
export function parseCertificationTime(value: unknown): number | undefined {
  const text = cleanCertificationText(value);
  if (!ISO_DATE_PATTERN.test(text)) return undefined;
  const time = Date.parse(text.includes('T') ? text : `${text.slice(0, 10)}T12:00`);
  return Number.isFinite(time) ? time : undefined;
}

/**
 * The tool's `{type: "certified", by?, at?, url?}` entry of a `meta` list (the first one), or `undefined`.
 * `by` is one line, `at` a time, and `url` is kept only when it is a link the page keeps.
 */
export function parseResultCertification(value: unknown): ResultCertification | undefined {
  try {
    const entry = Array.isArray(value) ? value.find((item) => isPlainObject(item) && item.type === 'certified') : undefined;
    if (!isPlainObject(entry)) return undefined;
    const by = cleanCertificationText(entry.by);
    const at = parseCertificationTime(entry.at);
    const url = parseHttpsLink(entry.url);
    return {
      ...(by === '' ? {} : { by }),
      ...(at === undefined ? {} : { at }),
      ...(url === undefined ? {} : { url }),
    };
  } catch {
    return undefined;
  }
}

export function withResultMetadata(table: Table, metadata: unknown): Table {
  const meta = parseResultMetadata(metadata);
  const certified = parseResultCertification(metadata);
  if (meta.length === 0 && certified === undefined) return table;
  return { ...table, ...(meta.length === 0 ? {} : { meta }), ...(certified === undefined ? {} : { certified }) };
}

export function copyResultMetadata(from?: { meta?: ResultMetadata[] }): ResultMetadata[] {
  return (from?.meta ?? []).map((entry) => ({ ...entry }));
}

/** A reader's failure as an error a loader can throw; the whole failure travels with it. */
export class ResultReaderError extends Error {
  readonly failure: ReaderError;
  readonly meta: ResultMetadata[];
  readonly quoted: boolean;
  constructor(failure: ReaderError) {
    super(failure.error);
    this.name = 'ResultReaderError';
    this.failure = failure;
    this.meta = failure.meta ?? [];
    this.quoted = failure.quoted === true;
  }
}

/** A tool call's failure: its own code when the host reports a known one, else "upstream_error". */
export function normalizeMcpError(error: unknown): McpError {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code, message } = error as UnknownRecord;
    const text = typeof message === 'string' ? message : String(code);
    if (typeof code === 'string' && MCP_ERROR_CODES.has(code)) return { code, message: text };
  }
  return { code: 'upstream_error', message: error instanceof Error ? error.message : 'mcp call failed' };
}

/** When the host's tool cache stored this answer, or `null` for a fresh call. */
export function getCachedStoredAt(result: McpToolResult): number | null {
  const storedAt = result.cache?.storedAt;
  return typeof storedAt === 'number' && Number.isFinite(storedAt) ? storedAt : null;
}

/** A cached answer the host pushed (`{type: "data", result}` with a stored time), or `null`. */
export function parseCachedToolResult(value: unknown): CachedToolResult | null {
  if (!isPlainObject(value) || value.type !== 'data') return null;
  const result = value.result;
  if (!isPlainObject(result)) return null;
  const at = getCachedStoredAt(result as McpToolResult);
  return at === null ? null : { result: result as McpToolResult, at };
}

/** The text of a failed tool call. */
export function getToolErrorText(result: McpToolResult): string {
  return (result.content?.find((item) => typeof item?.text === 'string')?.text as string | undefined) ?? 'tool call failed';
}

/** A tool's answer: its payload, its structured content, or its first text item (parsed when it is JSON). */
export function unwrapToolPayload(result: McpToolResult): unknown {
  if (result.payload !== undefined) return result.payload;
  if (result.structuredContent !== undefined) return result.structuredContent;
  const first = result.content?.[0];
  if (first && typeof first.text === 'string')
    try {
      return JSON.parse(first.text);
    } catch {
      return first.text;
    }
  return undefined;
}

/** What a call got back, in short. */
export function summarizeToolAnswer(answer: unknown): ToolCallGot {
  if (Array.isArray(answer)) return { kind: 'rows', n: answer.length };
  if (typeof answer === 'string') return { kind: 'text' };
  if (typeof answer !== 'object' || answer === null)
    return answer === undefined ? { kind: 'nothing' } : { kind: 'plain', type: typeof answer };
  return { kind: 'keys', keys: Object.keys(answer) };
}

/** Adds a call to a source's chain; a repeat of the last tool (a poll apart from other calls) is counted on it. */
export function recordToolCall(
  calls: ToolCall[],
  tool: string,
  ms: number,
  ok: boolean,
  got: ToolCallGot,
  poll = false,
): void {
  const last = calls.at(-1);
  if (last === undefined || last.tool !== tool || (last.poll === true) !== poll) {
    calls.push({ tool, n: 1, ms: Math.round(ms), ok, got, ...(poll ? { poll: true as const } : {}) });
    return;
  }
  last.n += 1;
  last.ms += Math.round(ms);
  last.ok = ok;
  last.got = got;
}

const decimal = new Intl.NumberFormat('en-US');

/** One call of a source's chain: "tool ×2 · 1.5 s", "… · failed". */
export function describeToolCall(call: ToolCall): string {
  const name = call.n > 1 ? `${call.tool} ×${decimal.format(call.n)}` : call.tool;
  const time =
    call.ms < 1000
      ? `${decimal.format(call.ms)} ms`
      : `${Number((call.ms / 1000).toFixed(1)).toLocaleString('en-US', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
          useGrouping: false,
        })} s`;
  return call.ok ? `${name} · ${time}` : `${name} · ${time} · failed`;
}

/** What a call got back: "12 rows", "text", "keys: a, b". */
export function describeToolCallGot(got: ToolCallGot): string {
  switch (got.kind) {
    case 'rows':
      return got.n === 1 ? `${decimal.format(got.n)} row` : `${decimal.format(got.n)} rows`;
    case 'keys':
      return `keys: ${got.keys.join(', ')}`;
    case 'text':
    case 'nothing':
    case 'failed':
      return got.kind;
    case 'plain':
      return got.type;
  }
}

/** A source's calls in one line ("a · 120 ms → b ×3 · 6.0 s"), at most 160 characters. */
export function summarizeToolCallChain(calls?: readonly ToolCall[]): string {
  if (calls === undefined || calls.length === 0) return '';
  const text = calls.map(describeToolCall).join(' → ');
  return text.length <= 160 ? text : `${text.slice(0, 159)}…`;
}
