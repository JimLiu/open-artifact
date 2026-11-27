import type { Cell, DataFileFormat, JsonValue, Row, Table, UnknownRecord } from './types.ts';
import { isPlainObject, sanitizeSingleLine, sanitizeText } from './text.ts';

export const NUMERIC_TEXT_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export const CUT_WITHOUT_ROWS_MESSAGE = 'The answer reports rows, but none of them could be read.';
export const DATA_FILE_FORMATS: readonly DataFileFormat[] = ['csv', 'tsv', 'json', 'text'];
export const DATA_FILE_MIME_TYPES: Readonly<Record<DataFileFormat, string>> = {
  csv: 'text/csv',
  tsv: 'text/plain',
  json: 'application/json',
  text: 'text/plain',
};
export const EMPTY_TABLE: Table = Object.freeze({ columns: [], rows: [] }) as Table;

/** Column names made unique and never blank (`column_N`, a repeat gets `_` added). */
export function normalizeColumnNames(names: readonly unknown[]): string[] {
  const columns: string[] = [];
  names.forEach((name, index) => {
    let column =
      sanitizeSingleLine(typeof name === 'number' || typeof name === 'boolean' ? String(name) : name) ||
      `column_${index + 1}`;
    while (columns.includes(column)) column += '_';
    columns.push(column);
  });
  return columns;
}

export function normalizeCellValue(value: unknown): Cell {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'boolean') return value;
  return null;
}

/** A JSON cell: a `{value}` wrapper is unwrapped, other objects become their JSON text. */
export function normalizeJsonCell(value: unknown): Cell {
  if (typeof value !== 'object' || value === null) return normalizeCellValue(value);
  if (!Array.isArray(value) && Object.hasOwn(value, 'value') && typeof (value as UnknownRecord).value !== 'object')
    return normalizeCellValue((value as UnknownRecord).value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/** Rows from a list of records, or one under `rows`, `data` or `results` (declared `columns` first); else `null`. */
export function normalizeTable(payload: unknown): Table | null {
  let rawRows: unknown = payload;
  let declared: string[] = [];
  if (isPlainObject(payload)) {
    rawRows = ['rows', 'data', 'results']
      .map((key) => (Object.hasOwn(payload, key) ? payload[key] : undefined))
      .find(Array.isArray);
    const columns = Object.hasOwn(payload, 'columns') ? payload.columns : undefined;
    if (Array.isArray(columns)) declared = columns.filter((column): column is string => typeof column === 'string');
  }
  if (!Array.isArray(rawRows)) return null;
  const records = rawRows.filter(isPlainObject);
  const found = new Set<string>();
  for (const record of records) for (const key of Object.keys(record)) found.add(key);
  const ordered = [...new Set(declared)].filter((column) => found.has(column));
  const original = [...ordered, ...[...found].filter((column) => !ordered.includes(column))];
  const columns = normalizeColumnNames(original);
  const rows = records.map((record) => {
    const row: Row = Object.create(null);
    columns.forEach((column, index) => {
      const key = original[index] as string;
      row[column] = Object.hasOwn(record, key) ? normalizeJsonCell(record[key]) : null;
    });
    return row;
  });
  return { columns, rows };
}

/** The table, marked as cut (the service sent only part of its rows). */
export function markTableTruncated(table: Table): Table {
  return { ...table, cut: 'rows' };
}

/** A table the connector said was cut, with no rows left: its rows could not be read. */
export function hasCutWithoutRows(table: Table): boolean {
  return table.cut !== undefined && table.rows.length === 0;
}

export function coerceCellNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function cellToString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

const FORMULA_START_CHARACTERS: ReadonlySet<string> = new Set(['=', '+', '-', '@']);

/**
 * Text a spreadsheet would run as a formula gets a leading `'`: text starting with a tab or CR, and text whose first
 * character past any other leading space is (or folds, under NFKC, to) `=`, `+`, `-` or `@`, unless it is a number.
 */
export function escapeSpreadsheetFormula(text: string): string {
  if (text.startsWith('\t') || text.startsWith('\r')) return `'${text}`;
  const first = /^[^\S\t\r]*(.)/su.exec(text)?.[1];
  if (first === undefined || !FORMULA_START_CHARACTERS.has(first.normalize('NFKC').charAt(0))) return text;
  return NUMERIC_TEXT_PATTERN.test(text.trim()) ? text : `'${text}`;
}

/** Like `escapeSpreadsheetFormula`, and text starting with a quote too. */
export function escapeSpreadsheetText(text: string): string {
  return text.startsWith('"') ? `'${text}` : escapeSpreadsheetFormula(text);
}

function serializeDelimitedTable(table: Table, formatCell: (text: string) => string, separator: string): string {
  return [
    table.columns.map(formatCell).join(separator),
    ...table.rows.map((row) => table.columns.map((column) => formatCell(cellToString(row[column]))).join(separator)),
  ].join('\n');
}

export function tableToCsv(table: Table): string {
  return serializeDelimitedTable(
    table,
    (text) => {
      const cell = escapeSpreadsheetFormula(text);
      return /[",\n\r\t]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
    },
    ',',
  );
}

export function tableToTsv(table: Table): string {
  return serializeDelimitedTable(
    table,
    (text) => {
      const cell = escapeSpreadsheetFormula(text.replace(/[\t\r\n]+/g, ' ').trimStart());
      return cell.includes('"') ? `"${cell.replaceAll('"', '""')}"` : cell;
    },
    '\t',
  );
}

export function isJsonContainerText(text: string): boolean {
  if (!/^[[{]/.test(text)) return false;
  try {
    return typeof JSON.parse(text) === 'object';
  } catch {
    return false;
  }
}

/** Text safe to paste into a spreadsheet: each line that would run as a formula gets a leading `'`. */
export function safeTextForSpreadsheet(text: string): string {
  if (isJsonContainerText(text)) return text;
  return text
    .split(/\r?\n|\r/)
    .map((line) => {
      const spaced = line.replace(/\t+/g, ' ');
      const trimmed = spaced.trimStart();
      return escapeSpreadsheetText(trimmed) === trimmed ? spaced : `'${spaced}`;
    })
    .join('\n');
}

/** The rows of delimited text: quotes open only at the start of a cell, `""` inside quotes is one quote. */
export function parseDelimitedRows(text: string, separator: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index] as string;
    if (quoted) {
      if (char !== '"') cell += char;
      else if (input[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = false;
      continue;
    }
    if (char === '"' && cell === '') quoted = true;
    else if (char === separator) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** A delimited text's table: the first row names the columns, cells are trimmed, a blank cell is `null`. */
export function parseDelimitedTable(text: string, separator: string): Table | null {
  const parsed = parseDelimitedRows(text, separator).filter((cells) => !(cells.length === 1 && (cells[0] ?? '').trim() === ''));
  const header = parsed[0];
  if (header === undefined) return null;
  const columns = normalizeColumnNames(header);
  const rows = parsed.slice(1).map((cells) => {
    const row: Row = Object.create(null);
    columns.forEach((column, index) => {
      row[column] = normalizeCellValue((cells[index] ?? '').trim()) || null;
    });
    return row;
  });
  return { columns, rows };
}

/** A JSON text's value, or `undefined` when it isn't JSON. */
export function parseFileJson(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

/** A file's rows by its format (CSV split at commas, TSV at tabs); a "text" file has none of its own. */
export function parseDataFileText(text: string, format: DataFileFormat): Table | null {
  if (format === 'text') return null;
  return format === 'json' ? normalizeTable(parseFileJson(text)) : parseDelimitedTable(text, format === 'tsv' ? '\t' : ',');
}

/** A data file's rows, or `null` when it has none this dashboard can read. */
export function parseDataFileTable(text: string, format: DataFileFormat): Table | null {
  const table = parseDataFileText(text, format);
  return table === null || table.columns.length === 0 ? null : table;
}

/** Whether a JSON value holds rows: a list of records, or one under `rows`, `data` or `results`. */
export function isRowsAnswer(value: unknown): boolean {
  const rows = Array.isArray(value)
    ? value
    : isPlainObject(value)
      ? ['rows', 'data', 'results'].map((key) => value[key]).find(Array.isArray)
      : undefined;
  return rows !== undefined && rows.every(isPlainObject);
}

/** What a file's loader gets as its answer: the file's text, a JSON file's value already parsed. */
export function fileLoaderAnswer(text: string, format: DataFileFormat): unknown {
  const value = format === 'json' ? parseFileJson(text) : undefined;
  return value === undefined ? text : value;
}

/** A file's answer with no loader: text for "text", a table for rows, other JSON as its value; `null` when unreadable. */
export function parseFileAnswer(text: string, format: DataFileFormat): { table: Table } | { value: JsonValue } | null {
  if (format === 'text') return { value: text };
  const table = parseDataFileTable(text, format);
  if (table !== null) return { table };
  const value = format === 'json' ? parseFileJson(text) : undefined;
  if (value === undefined) return null;
  return isRowsAnswer(value) ? { table: normalizeTable(value) ?? EMPTY_TABLE } : { value };
}

/** The format a data file's name says (`.csv`, `.tsv`/`.tab`, `.json`/`.geojson`), or `null`. */
export function inferDataFileFormat(name: string): DataFileFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.tsv') || lower.endsWith('.tab')) return 'tsv';
  return lower.endsWith('.json') || lower.endsWith('.geojson') ? 'json' : null;
}

export function inferDataFileFormatOrCsv(name: string): DataFileFormat {
  return inferDataFileFormat(name) ?? 'csv';
}

/** A column name without its `namespace__` prefix. */
export function stripColumnNamespace(column: string): string {
  const rest = column.slice(column.lastIndexOf('__') + 2);
  return column.includes('__') && rest !== '' ? rest : column;
}
