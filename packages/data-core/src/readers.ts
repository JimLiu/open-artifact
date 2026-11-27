import type {
  BigQueryAnswer,
  BigQueryJob,
  ConnectorAnswer,
  LoaderResultReaders,
  LoaderRows,
  PollAnswer,
  ReaderContext,
  ReaderKind,
  ResultReader,
  SchemaField,
  SchemaRow,
  SchemaRowReader,
} from './connector-types.ts';
import type { QueryFailureCode, ResultMetadata, Table, UnknownRecord } from './types.ts';
import { isPlainObject, sanitizeSingleLine } from './text.ts';
import { NUMERIC_TEXT_PATTERN, hasCutWithoutRows, markTableTruncated, normalizeColumnNames, normalizeTable } from './tables.ts';
import { queryFailure, quotedQueryFailure } from './model.ts';
import { createQueryPollGate } from './limiter.ts';
import {
  ResultReaderError,
  copyResultMetadata,
  getLoaderAnswerError,
  parseResultMetadata,
  withResultMetadata,
} from './answers.ts';

export const BIGQUERY_POLL_TOOL = 'get_query_results';
export const DATABRICKS_POLL_TOOL = 'poll_sql_result';

const XML_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const XML_ATTRIBUTE_PATTERNS = {
  name: /\sname="([^"]*)"/,
  type: /\stype="([^"]*)"/,
  null: /\snull="([^"]*)"/,
  total_rows: /\stotal_rows="([^"]*)"/,
  truncated: /\struncated="([^"]*)"/,
  bytes_processed: /\sbytes_processed="([^"]*)"/,
  level: /\slevel="([^"]*)"/,
  governed_projects: /\sgoverned_projects="([^"]*)"/,
} as const;
type XmlAttribute = keyof typeof XML_ATTRIBUTE_PATTERNS;
const BYTE_UNIT_NAMES = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte', 'petabyte'];
const BYTES_PER_UNIT = 1024;
const BYTE_DISPLAY_DECIMALS = 1;
const DATABRICKS_INTEGER_TYPES: ReadonlySet<string> = new Set(['BYTE', 'SHORT', 'INT', 'LONG', 'DECIMAL']);
const DATABRICKS_FAILURE_CODES: ReadonlyMap<string, QueryFailureCode> = new Map<string, QueryFailureCode>([
  ['FAILED', 'queryFailed'],
  ['CANCELED', 'queryCanceled'],
  ['CLOSED', 'resultNotKept'],
]);

function ownString(record: UnknownRecord, key: string): string {
  const value = Object.hasOwn(record, key) ? record[key] : undefined;
  return typeof value === 'string' ? value : '';
}

function nestedRecord(record: UnknownRecord, key: string): UnknownRecord | null {
  const value = Object.hasOwn(record, key) ? record[key] : undefined;
  return isPlainObject(value) ? value : null;
}

function nestedArray(record: UnknownRecord | null, key: string): unknown[] | null {
  const value = record !== null && Object.hasOwn(record, key) ? record[key] : undefined;
  return Array.isArray(value) ? value : null;
}

function parseFiniteFloat(text: string): number | string {
  return text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : text;
}

function parseBooleanText(text: string): boolean | string {
  return /^true$/i.test(text) ? true : /^false$/i.test(text) ? false : text;
}

/** A number text within the safe integer range as a number; anything else as it was. */
export function parseSafeDecimal(text: string): number | string {
  const trimmed = text.trim();
  const value = NUMERIC_TEXT_PATTERN.test(trimmed) ? Number(trimmed) : Number.NaN;
  return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : text;
}

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]+);/gi, (whole: string, entity: string) => {
    if (entity[0] !== '#') {
      const name = entity.toLowerCase();
      return Object.hasOwn(XML_ENTITIES, name) ? (XML_ENTITIES[name] as string) : whole;
    }
    const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

function readXmlAttribute(tag: string, name: XmlAttribute): string {
  return decodeXmlEntities(XML_ATTRIBUTE_PATTERNS[name].exec(tag)?.[1] ?? '');
}

function findXmlOpenTag(text: string, name: string, from = 0): { end: number; tag: string } | null {
  for (let index = text.indexOf(`<${name}`, from); index >= 0; index = text.indexOf(`<${name}`, index + 1)) {
    if (/\w/.test(text.charAt(index + name.length + 1))) continue;
    const end = text.indexOf('>', index);
    return end < 0 ? null : { end, tag: text.slice(index, end + 1) };
  }
  return null;
}

function readXmlElement(text: string, name: string, from = 0): { tag: string; body: string; next: number } | null {
  const open = findXmlOpenTag(text, name, from);
  const close = open === null ? -1 : text.indexOf(`</${name}>`, open.end + 1);
  return open === null || close < 0 ? null : { tag: open.tag, body: text.slice(open.end + 1, close), next: close + name.length + 3 };
}

function readXmlTagText(text: string, name: string): string {
  const element = readXmlElement(text, name);
  return element === null ? '' : decodeXmlEntities(element.body).trim();
}

function hasEmptyXmlElement(text: string, name: string): boolean {
  for (let open = findXmlOpenTag(text, name); open !== null; open = findXmlOpenTag(text, name, open.end + 1))
    if (open.tag.endsWith('/>')) return true;
  return false;
}

function readXmlFields(text: string): UnknownRecord {
  const fields: UnknownRecord = Object.create(null);
  const lastClose = text.lastIndexOf('</field>');
  for (let open = findXmlOpenTag(text, 'field'); open !== null; ) {
    const empty = open.tag.endsWith('/>');
    const close = empty || open.end > lastClose ? -1 : text.indexOf('</field>', open.end + 1);
    if (empty || close >= 0) {
      const attributes = open.tag.slice(6, empty ? -2 : -1);
      fields[readXmlAttribute(attributes, 'name')] =
        readXmlAttribute(attributes, 'null') === 'true' ? null : decodeXmlEntities(empty ? '' : text.slice(open.end + 1, close));
    }
    open = findXmlOpenTag(text, 'field', empty || close < 0 ? open.end + 1 : close + 8);
  }
  return fields;
}

/** A byte count for people: "512 bytes", "1.5 MB" (1024 per unit, one decimal). */
export function formatScannedBytes(text: string): string {
  let value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isSafeInteger(value)) return '';
  let unit = 0;
  while (Number(value.toFixed(BYTE_DISPLAY_DECIMALS)) >= BYTES_PER_UNIT && unit < BYTE_UNIT_NAMES.length - 1) {
    value /= BYTES_PER_UNIT;
    unit++;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'unit',
    unit: BYTE_UNIT_NAMES[unit] as string,
    unitDisplay: unit === 0 ? 'long' : 'short',
    maximumFractionDigits: BYTE_DISPLAY_DECIMALS,
  }).format(value);
}

/** A BigQuery field's value by its type: integers and floats as numbers, booleans, a timestamp as ISO text. */
export function coerceBigQueryField(type: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const upper = type.toUpperCase();
  if (upper === 'INTEGER' || upper === 'INT64')
    return Number.isSafeInteger(Number(value)) && value.trim() !== '' ? Number(value) : value;
  if (upper === 'FLOAT' || upper === 'FLOAT64') return parseFiniteFloat(value);
  if (upper === 'BOOLEAN' || upper === 'BOOL') return parseBooleanText(value);
  if (upper === 'TIMESTAMP' && /^-?[0-9.]+(E[0-9]+)?$/i.test(value)) {
    const ms = Number(value) * 1000;
    return Number.isFinite(ms) && Math.abs(ms) < 8.64e15 ? new Date(ms).toISOString() : value;
  }
  return value;
}

/** Rows read by a schema; `null` when a row can't be read. Columns keep the schema's order. */
export function normalizeBigQueryRows(fields: SchemaField[], readRow: SchemaRowReader, rows: unknown[]): Table | null {
  const usable = fields
    .map((field, at) => ({ ...field, at }))
    .filter((field) => field.name !== '' && sanitizeSingleLine(field.name) === field.name);
  const records: UnknownRecord[] = [];
  for (const raw of rows) {
    const row = readRow(raw);
    if (row === null) return null;
    const record: UnknownRecord = Object.create(null);
    for (const field of usable) {
      const value = Array.isArray(row) ? row[field.at] : Object.hasOwn(row, field.name) ? row[field.name] : null;
      record[field.name] = coerceBigQueryField(field.type, value ?? null);
    }
    records.push(record);
  }
  const table = records.length === 0 ? { columns: [], rows: [] } : normalizeTable(records);
  if (table === null) return null;
  return { ...table, columns: [...new Set(usable.map((field) => field.name))] };
}

/** Rows read by a schema with each value coerced by its type; columns named after the schema. */
export function normalizeSchemaRows(
  fields: SchemaField[],
  readRow: (row: unknown) => unknown[] | null,
  rows: unknown[],
  coerce: (type: string, value: unknown) => unknown,
): Table | null {
  const columns = normalizeColumnNames(fields.map((field) => field.name));
  const records: UnknownRecord[] = [];
  for (const raw of rows) {
    const row = readRow(raw);
    if (row === null) return null;
    records.push(
      Object.fromEntries(columns.map((column, index) => [column, coerce(fields[index]?.type ?? '', row[index] ?? null)])),
    );
  }
  const table = normalizeTable({ columns, rows: records });
  return table === null ? null : { ...table, columns };
}

/** The governed connector's details of a result: its SQL, job, confidence, docs and data scanned. */
export function parseGovernedQueryMetadata(text: string): ResultMetadata[] {
  const confidence = findXmlOpenTag(text, 'confidence')?.tag ?? '';
  const results = findXmlOpenTag(text, 'results')?.tag ?? '';
  return parseResultMetadata([
    { label: 'SQL', value: readXmlTagText(text, 'compiled_sql'), type: 'code', lang: 'sql' },
    { label: 'Job', value: readXmlTagText(text, 'job_url') },
    {
      label: 'Confidence',
      value: [readXmlAttribute(confidence, 'level'), readXmlAttribute(confidence, 'governed_projects')]
        .filter((part) => part !== '')
        .join(' · '),
    },
    { label: 'Docs', value: readXmlTagText(text, 'dki_pages') },
    { label: 'Data scanned', value: formatScannedBytes(readXmlAttribute(results, 'bytes_processed')) },
  ]);
}

function attachReaderMetadata(answer: ConnectorAnswer, meta: ResultMetadata[]): ConnectorAnswer {
  if (meta.length === 0 || 'value' in answer) return answer;
  return 'table' in answer ? { table: { ...answer.table, meta } } : { ...answer, meta };
}

/** The governed connector's `<query_result>` XML: its rows, or its error (busy when `retryable="true"`). */
export function parseGovernedQueryXml(text: string): ConnectorAnswer | null {
  const start = text.indexOf('<query_result');
  const end = text.indexOf('</query_result>', start);
  if (start < 0 || end < 0) return null;
  const body = text.slice(start, end);
  const errorStart = body.indexOf('<error>');
  const errorEnd = errorStart < 0 ? -1 : body.indexOf('</error>', errorStart + 7);
  if (errorEnd >= 0) {
    const failure = quotedQueryFailure(decodeXmlEntities(body.slice(errorStart + 7, errorEnd)).trim());
    return /^<query_result\b[^>]*\sretryable="true"/.test(body) ? { ...failure, busy: true } : failure;
  }
  const results = readXmlElement(body, 'results');
  if (results === null) return hasEmptyXmlElement(body, 'results') ? { table: { columns: [], rows: [] } } : null;
  const columns: SchemaField[] = [];
  for (let column = findXmlOpenTag(results.body, 'column'); column !== null; column = findXmlOpenTag(results.body, 'column', column.end + 1))
    columns.push({ name: readXmlAttribute(column.tag, 'name'), type: readXmlAttribute(column.tag, 'type') });
  const rows: UnknownRecord[] = [];
  for (let row = readXmlElement(results.body, 'row'); row !== null; row = readXmlElement(results.body, 'row', row.next))
    rows.push(readXmlFields(row.body));
  const table = normalizeBigQueryRows(columns, (row) => row as SchemaRow, rows);
  if (table === null) return null;
  const resultsTag = findXmlOpenTag(body, 'results')?.tag ?? '';
  const cut =
    readXmlAttribute(resultsTag, 'truncated') === 'true' || Number(readXmlAttribute(resultsTag, 'total_rows')) > table.rows.length;
  return { table: cut ? markTableTruncated(table) : table };
}

function parseBigQueryJobMetadata(answer: UnknownRecord): ResultMetadata[] {
  const job = nestedRecord(answer, 'jobReference') ?? {};
  const project = ownString(job, 'projectId');
  const location = ownString(job, 'location');
  const jobId = ownString(job, 'jobId');
  return [
    {
      label: 'Job',
      value: jobId === '' ? '' : `${project === '' ? '' : `${project}:`}${location === '' ? '' : `${location}.`}${jobId}`,
    },
  ];
}

/** A BigQuery jobs answer: its rows, or the job still running (`pending`); `null` when it isn't one. */
export function parseBigQueryResult(answer: UnknownRecord): BigQueryAnswer | null {
  if (Object.hasOwn(answer, 'jobComplete') && answer.jobComplete === false) {
    const job = nestedRecord(answer, 'jobReference') ?? {};
    return {
      pending: {
        jobId: ownString(answer, 'jobId') || ownString(job, 'jobId'),
        location: ownString(answer, 'location') || ownString(job, 'location'),
      },
    };
  }
  const schema = nestedRecord(answer, 'schema');
  const fields = nestedArray(schema, 'fields');
  if (fields === null) return null;
  const schemaFields = fields.map((field) =>
    isPlainObject(field) ? { name: ownString(field, 'name'), type: ownString(field, 'type') } : { name: '', type: '' },
  );
  const table = normalizeBigQueryRows(
    schemaFields,
    (row) => {
      if (Array.isArray(row)) return row;
      if (!isPlainObject(row)) return null;
      const cells = Object.hasOwn(row, 'f') ? row.f : undefined;
      return Array.isArray(cells)
        ? cells.map((cell: unknown) => (isPlainObject(cell) && Object.hasOwn(cell, 'v') ? cell.v : null))
        : row;
    },
    nestedArray(answer, 'rows') ?? [],
  );
  if (table === null) return null;
  const total = typeof answer.totalRows === 'number' ? answer.totalRows : Number(ownString(answer, 'totalRows'));
  const cut = ownString(answer, 'pageToken') !== '' || (Number.isFinite(total) && total > table.rows.length);
  return { table: withResultMetadata(cut ? markTableTruncated(table) : table, parseBigQueryJobMetadata(answer)) };
}

/** Reads the governed connector's XML text; unwrapped text that isn't its XML is the service's own failure. */
export const readGovernedBigQueryResult: ResultReader = (input, { unwrapped }) => {
  if (typeof input !== 'string') return null;
  const answer = parseGovernedQueryXml(input);
  if (answer !== null) return attachReaderMetadata(answer, parseGovernedQueryMetadata(input));
  return unwrapped ? quotedQueryFailure(input) : null;
};

/** Reads a BigQuery jobs answer, polling `get_query_results` while the job runs. */
export const readBigQueryResult: ResultReader = async (answer, { args, call, stale, clock }) => {
  const parse = (input: unknown, polled: boolean): BigQueryAnswer | null => {
    const parsed = isPlainObject(input) ? parseBigQueryResult(input) : null;
    if (parsed !== null) return parsed;
    const error = getLoaderAnswerError(input);
    if (error !== '') return { error, quoted: true };
    return polled || (isPlainObject(input) && Object.hasOwn(input, 'jobComplete')) ? queryFailure('notRows') : null;
  };
  let result = parse(answer, false);
  if (result === null) return null;
  const gate = createQueryPollGate(stale, clock);
  let job: BigQueryJob | null = null;
  while ('pending' in result) {
    if (result.pending.jobId !== '') job = result.pending;
    if (job === null) return { ...queryFailure('noJob'), timedOut: true };
    if (!(await gate())) return { ...queryFailure('stillRunning'), timedOut: true };
    const polled: PollAnswer = await call(BIGQUERY_POLL_TOOL, {
      projectId: args.projectId,
      jobId: job.jobId,
      ...(job.location !== '' ? { location: job.location } : {}),
      timeoutMs: 20000,
    });
    if ('error' in polled) return polled;
    result = parse(polled.value, true) ?? queryFailure('notRows');
  }
  return result;
};

function coerceSnowflakeField(type: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const lower = type.toLowerCase();
  if (lower === 'text') return value;
  if (value === '') return null;
  if (lower === 'fixed') return parseSafeDecimal(value);
  if (lower === 'real') return parseFiniteFloat(value);
  return lower === 'boolean' ? parseBooleanText(value) : value;
}

/** Reads a Snowflake statement answer (`result_set` with `resultSetMetaData.rowType` and `data`). */
export const readSnowflakeResult: ResultReader = (input) => {
  if (!isPlainObject(input)) return null;
  const resultSet = nestedRecord(input, 'result_set');
  const metadata = resultSet === null ? null : nestedRecord(resultSet, 'resultSetMetaData');
  const rowType = nestedArray(metadata, 'rowType');
  if (resultSet === null || metadata === null || rowType === null) return null;
  const fields = rowType.map((field) =>
    isPlainObject(field) ? { name: ownString(field, 'name'), type: ownString(field, 'type') } : { name: '', type: '' },
  );
  const table = normalizeSchemaRows(
    fields,
    (row) => (Array.isArray(row) ? row : null),
    nestedArray(resultSet, 'data') ?? [],
    coerceSnowflakeField,
  );
  if (table === null) return null;
  const cut = Number(metadata.numRows) > table.rows.length;
  return {
    table: withResultMetadata(cut ? markTableTruncated(table) : table, [
      { label: 'Query ID', value: ownString(input, 'query_id') || ownString(resultSet, 'statementHandle') },
    ]),
  };
};

function coerceDatabricksField(type: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const upper = type.toUpperCase();
  if (DATABRICKS_INTEGER_TYPES.has(upper)) return parseSafeDecimal(value);
  if (upper === 'FLOAT' || upper === 'DOUBLE') return parseFiniteFloat(value);
  return upper === 'BOOLEAN' ? parseBooleanText(value) : value;
}

function parseDatabricksTypedValue(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  if (Object.hasOwn(value, 'value')) return value.value;
  const keys = Object.keys(value).filter((key) => value[key] !== null && value[key] !== undefined);
  if (keys.length === 0 || keys.includes('null_value')) return null;
  return keys.length === 1 ? value[keys[0] as string] : value;
}

function parseDatabricksTypedRow(row: unknown): unknown[] | null {
  if (Array.isArray(row)) return row.map(parseDatabricksTypedValue);
  const values = isPlainObject(row) ? nestedArray(row, 'values') : null;
  return values === null ? null : values.map(parseDatabricksTypedValue);
}

function getDatabricksResultRows(result: UnknownRecord | null): unknown[] {
  const rows = nestedArray(result, 'data_array');
  if (rows !== null && rows.length > 0) return rows;
  return nestedArray(result, 'data_typed_array') ?? rows ?? [];
}

function getDatabricksState(answer: UnknownRecord): string {
  return ownString(nestedRecord(answer, 'status') ?? {}, 'state');
}

function parseDatabricksResult(answer: UnknownRecord, meta: ResultMetadata[]): ConnectorAnswer {
  const state = getDatabricksState(answer);
  if (state !== 'SUCCEEDED')
    return {
      ...quotedQueryFailure(
        ownString(nestedRecord(nestedRecord(answer, 'status') ?? {}, 'error') ?? {}, 'message'),
        DATABRICKS_FAILURE_CODES.get(state) ?? 'didntFinish',
      ),
      meta,
    };
  const manifest = nestedRecord(answer, 'manifest');
  const columns = nestedArray(manifest === null ? null : nestedRecord(manifest, 'schema'), 'columns');
  if (manifest === null || columns === null) return { ...queryFailure('notRows'), meta };
  const fields = columns.map((column) =>
    isPlainObject(column) ? { name: ownString(column, 'name'), type: ownString(column, 'type_name') } : { name: '', type: '' },
  );
  const table = normalizeSchemaRows(
    fields,
    parseDatabricksTypedRow,
    getDatabricksResultRows(nestedRecord(answer, 'result')),
    coerceDatabricksField,
  );
  if (table === null) return { ...queryFailure('notRows'), meta };
  const cut = manifest.truncated === true || Number(manifest.total_row_count) > table.rows.length;
  return { table: withResultMetadata(cut ? markTableTruncated(table) : table, meta) };
}

/** Reads a Databricks statement answer, polling `poll_sql_result` while it is pending or running. */
export const readDatabricksResult: ResultReader = async (answer, { call, stale, clock }) => {
  if (!isPlainObject(answer) || getDatabricksState(answer) === '') return null;
  const statementId = ownString(answer, 'statement_id');
  const meta: ResultMetadata[] = statementId === '' ? [] : [{ label: 'Statement', value: statementId, type: 'text' }];
  const gate = createQueryPollGate(stale, clock);
  let current = answer;
  while (getDatabricksState(current) === 'PENDING' || getDatabricksState(current) === 'RUNNING') {
    if (statementId === '') return { ...queryFailure('noStatement'), timedOut: true };
    if (!(await gate())) return { ...queryFailure('stillRunning'), timedOut: true, meta };
    const polled = await call(DATABRICKS_POLL_TOOL, { statement_id: statementId });
    if ('error' in polled) return { ...polled, meta };
    if (!isPlainObject(polled.value) || getDatabricksState(polled.value) === '') return { ...queryFailure('notRows'), meta };
    current = polled.value;
  }
  return parseDatabricksResult(current, meta);
};

/** The typed fields a sheet cell may carry, tried in this order when it has no `value` and no markdown. */
const SHEET_TYPED_FIELDS = ['number', 'date', 'time', 'dateTime', 'name', 'error'] as const;

/** A sheet cell's plain value: a list joins its parts, a typed cell gives its first typed field. */
function sheetCellPlain(cell: unknown): unknown {
  if (Array.isArray(cell)) return cell.map((part) => sheetCellPlain(part)).join(', ');
  if (!isPlainObject(cell)) return cell;
  if (Object.hasOwn(cell, 'value')) return sheetCellPlain(cell.value);
  const field = SHEET_TYPED_FIELDS.find((key) => Object.hasOwn(cell, key));
  return field === undefined ? cell : cell[field];
}

/** A sheet cell as the table shows it: text (and markdown) drop the apostrophe that marks it as typed text. */
function sheetCellShown(cell: unknown): unknown {
  const text = typeof cell === 'string' ? cell : isPlainObject(cell) && typeof cell.markdown === 'string' ? cell.markdown : null;
  return text === null ? sheetCellPlain(cell) : text.replace(/^'/, '');
}

function isBlankSheetRow(cells: readonly unknown[]): boolean {
  return cells.every((cell) => cell === null || cell === undefined || cell === '');
}

/**
 * Reads a sheet's `readCells` answer: `rows` maps row numbers to cell lists, either at the top or under
 * `value`. The first row with anything in it names the columns; empty rows are skipped.
 */
export const readSheetResult: ResultReader = (input) => {
  if (!isPlainObject(input)) return null;
  const inner = nestedRecord(input, 'value');
  const answer = inner !== null && nestedRecord(inner, 'rows') !== null ? inner : input;
  const byNumber = nestedRecord(answer, 'rows');
  if (byNumber === null) return null;
  if (answer.calculationTookTooLong === true) return { ...queryFailure('tookTooLong'), timedOut: true };
  const lines: unknown[][] = [];
  for (const line of Object.values(byNumber)) {
    if (!Array.isArray(line)) return null;
    const cells = line.map(sheetCellShown);
    if (!isBlankSheetRow(cells)) lines.push(cells);
  }
  const [header = [], ...body] = lines;
  const columns = normalizeColumnNames(header);
  const rows = body.map((cells) => Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? null])));
  const table = normalizeTable({ columns, rows });
  return table === null ? null : { table };
};

export const READERS_BY_KIND: Readonly<Record<ReaderKind, ResultReader>> = {
  bigquery: readBigQueryResult,
  governed: readGovernedBigQueryResult,
  snowflake: readSnowflakeResult,
  databricks: readDatabricksResult,
  sheet: readSheetResult,
};

/**
 * The `read` helpers a loader gets: each reads an answer of its kind into rows (`{data, columns, truncated,
 * meta}`), or throws (a `ResultReaderError` with the whole failure). `onAnswer` hears the last answer when
 * rows were reported but none could be read.
 */
export function createLoaderResultReaders(
  context: ReaderContext,
  onAnswer: (answer: unknown) => void = () => undefined,
): LoaderResultReaders {
  const wrap =
    (reader: ResultReader) =>
    async (input: unknown): Promise<LoaderRows> => {
      let last: unknown = input;
      const answer = await reader(input, {
        unwrapped: true,
        ...context,
        call: async (tool, args) => {
          const polled = await context.call(tool, args);
          if ('value' in polled) last = polled.value;
          return polled;
        },
      });
      if (answer === null || 'value' in answer) throw new Error(queryFailure('notRows').error);
      if ('error' in answer) throw new ResultReaderError(answer);
      if (hasCutWithoutRows(answer.table)) onAnswer(last);
      const { columns, rows: data, cut } = answer.table;
      const rows = { data, columns, truncated: cut !== undefined, meta: copyResultMetadata(answer.table) };
      return Object.defineProperty(rows, 'cut', {
        get: () => rows.truncated,
        set: (value: boolean) => {
          rows.truncated = value;
        },
      }) as LoaderRows;
    };
  return Object.freeze({
    bigquery: wrap(READERS_BY_KIND.bigquery),
    governed: wrap(READERS_BY_KIND.governed),
    snowflake: wrap(READERS_BY_KIND.snowflake),
    databricks: wrap(READERS_BY_KIND.databricks),
    sheet: wrap(READERS_BY_KIND.sheet),
  });
}
