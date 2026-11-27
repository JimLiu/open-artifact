/** A source's result as the Sources panel shows it: rows, a value, its caption and freshness, and copies of it. */

import {
  arrayToNumberedRecord,
  cellToString,
  coerceCellNumber,
  isPlainObject,
  safeTextForSpreadsheet,
  stripColumnNamespace,
  tableToCsv,
  tableToTsv,
  type Cell,
  type Dataset,
  type DatasetRun,
  type Row,
  type Table,
  type UnknownRecord,
} from '@open-artifact/data-core';
import { formatPlainValue, getCalculationTable, humanizeIdentifier } from '../data/calculations.ts';
import { matchesPossiblyScaledNumber, parseDisplayedNumbers } from '../page/numbers.ts';
import { getLastSuccessfulRun } from '../data/query-store.ts';
import { describeTruncatedTable, formatTimeAgo, getDatasetUpdatedAt, isJustNow } from '../data/status.ts';
import { JUST_NOW_LABEL, LOADING_LABEL, REFRESHING_LABEL, formatResultRowCount, plural } from './words.ts';

/** What the Result section shows: rows, or a value and its text. */
export interface ShownDatasetResult {
  table: Table | null;
  data: unknown;
  text: string | null;
}

export interface ResultFreshness {
  text: string;
  /** The same words for a screen reader (times spelled out). */
  heard: string;
  /** The exact time, for a tooltip. */
  title?: string;
}

/** Which part of a result to ring: all of it, its value, one entry, or one cell of the rows. */
export type ResultHighlightTarget = 'body' | 'value' | { entry: string } | { row?: number; field?: string } | null;

/** Values longer than this, or with line breaks, aren't put in a table of short values. */
export const MAX_INLINE_VALUE_CHARACTERS = 160;
/** Nested records deeper than this are shown as JSON. */
export const MAX_RECORD_DEPTH = 4;

function isCalculationResultShown(dataset: Dataset, run: DatasetRun): boolean {
  return dataset.source.kind === 'calc' && dataset.source.result !== undefined && getLastSuccessfulRun(run) !== null;
}

function getShownResultTable(dataset: Dataset, run: DatasetRun): Table | null | undefined {
  const ok = getLastSuccessfulRun(run);
  if (ok === null) return undefined;
  if (dataset.source.kind !== 'calc') return ok.value === undefined ? ok.table : undefined;
  return isCalculationResultShown(dataset, run) ? (getCalculationTable(dataset.source.result) ?? undefined) : undefined;
}

/** The result to show: the last good run's rows, or its value (a calculation's result, a loader's data); `null` for none. */
export function getShownDatasetResult(dataset: Dataset, run: DatasetRun): ShownDatasetResult | null {
  const table = getShownResultTable(dataset, run);
  let data: unknown;
  if (table === undefined) {
    if (dataset.source.kind !== 'calc') data = getLastSuccessfulRun(run)?.value;
    else if (isCalculationResultShown(dataset, run)) data = dataset.source.result;
  }
  if (table === undefined && data === undefined) return null;
  return { table: table ?? null, data, text: data === undefined ? null : (formatPlainValue(data) ?? null) };
}

/** "12 rows", "12 rows (first 12 rows only)". */
export function describeTableResult(table: Table): string {
  const note = describeTruncatedTable(table);
  const rows = formatResultRowCount(table.rows.length);
  return note === '' ? rows : `${rows} (${note})`;
}

const oneDecimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });
const decimal = new Intl.NumberFormat('en-US');

/** "512 B", "12 KB", "1.5 MB". */
export function formatResultFileSize(bytes: number): string {
  if (bytes < 1024) return `${decimal.format(bytes)} B`;
  if (bytes < 1_048_576) return `${decimal.format(Math.round(bytes / 1024))} KB`;
  return `${oneDecimal.format(bytes / 1_048_576)} MB`;
}

/** The caption under a result: its rows, and a file's size. */
export function describeDatasetResult(dataset: Dataset, run: DatasetRun, shown: ShownDatasetResult): string {
  const bytes = dataset.source.kind === 'file' ? getLastSuccessfulRun(run)?.bytes : undefined;
  const rows = shown.table === null ? '' : describeTableResult(shown.table);
  const size = bytes === undefined ? '' : formatResultFileSize(bytes);
  return rows === '' || size === '' ? rows || size : `${rows} · ${size}`;
}

const shortDateTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function formatShortDateTime(at: number): string {
  return shortDateTime.format(new Date(at));
}

/** How fresh a source's data is: loading, refreshing, "Just now", "5m ago", "Uploaded 2d ago". */
export function getResultFreshness(dataset: Dataset, run: DatasetRun, now: number, quiet = false): ResultFreshness {
  if (run.status === 'running' && getLastSuccessfulRun(run) === null) return { text: LOADING_LABEL, heard: LOADING_LABEL };
  if (run.status === 'running' && !quiet) return { text: REFRESHING_LABEL, heard: REFRESHING_LABEL };
  const updatedAt = getDatasetUpdatedAt(dataset, run);
  if (updatedAt === null) return { text: '', heard: '' };
  const when = formatShortDateTime(updatedAt);
  if (dataset.source.kind !== 'file') {
    return isJustNow(updatedAt, now)
      ? { text: JUST_NOW_LABEL, heard: JUST_NOW_LABEL, title: when }
      : { text: formatTimeAgo(updatedAt, now), heard: formatTimeAgo(updatedAt, now, true), title: when };
  }
  const title = dataset.updated === null ? when : dataset.updated.by !== '' ? `${when}, by ${dataset.updated.by}` : `${when}, by someone`;
  return isJustNow(updatedAt, now)
    ? { text: 'Uploaded now', heard: 'Uploaded now', title }
    : { text: `Uploaded ${formatTimeAgo(updatedAt, now)}`, heard: `Uploaded ${formatTimeAgo(updatedAt, now, true)}`, title };
}

/** A one-row table as a record of its columns, in column order. */
export function getSingleRowRecord(table: Table | null): Row | null {
  const row = table !== null && table.rows.length === 1 ? table.rows[0] : undefined;
  return table === null || row === undefined ? null : Object.fromEntries(table.columns.map((column) => [column, row[column] ?? null]));
}

/** The namespace every column shares (`orders__`), unless it is a column's whole name. */
export function getCommonColumnPrefix(columns: readonly string[]): string {
  const [first = '', ...rest] = columns;
  if (rest.length === 0) return '';
  let common = first;
  for (const column of rest) while (!column.startsWith(common)) common = common.slice(0, -1);
  const prefix = common.includes('__') ? common.slice(0, common.lastIndexOf('__') + 2) : '';
  return columns.includes(prefix) ? '' : prefix;
}

/** A value shown as a record: an object as it is, a list numbered from 1. */
export function asDisplayedRecord(value: unknown): UnknownRecord | null {
  if (isPlainObject(value)) return value;
  return Array.isArray(value) ? arrayToNumberedRecord(value) : null;
}

function isDisplayScalar(value: unknown): boolean {
  return value === null || typeof value !== 'object';
}

/** A scalar's text: "—" when empty. */
export function displayScalarText(value: unknown): string {
  return cellToString(value) || '—';
}

export function hasLineBreak(text: string): boolean {
  return text.trimEnd().includes('\n');
}

export function isShortSingleLineValue(text: string): boolean {
  return text.length <= MAX_INLINE_VALUE_CHARACTERS && !hasLineBreak(text);
}

/** A value shown on one line (a scalar, or a list of scalars), or `null` for one that needs expanding. */
export function getInlineValueText(value: unknown): string | null {
  if (isDisplayScalar(value)) return displayScalarText(value);
  return Array.isArray(value) && value.length > 0 && value.every(isDisplayScalar) ? value.map(displayScalarText).join(', ') : null;
}

/** "12 rows", "3 items", "4 keys": what an expandable entry holds. */
export function summarizeNestedValue(value: object, table: Table | null): string {
  if (table !== null) return plural(table.rows.length, 'row', 'rows');
  if (Array.isArray(value)) return plural(value.length, 'item', 'items');
  return plural(Object.keys(value).length, 'key', 'keys');
}

/** The result as text to copy: rows as TSV, a value as text a spreadsheet won't run. */
export function copyableResultText(table: Table | null, text?: string | null): string {
  return table !== null ? tableToTsv(table) : safeTextForSpreadsheet(text ?? '');
}

const UTF8_BYTE_ORDER_MARK = '﻿';

/**
 * The CSV download of a source's rows: `<id>.csv`, its cells safe from spreadsheet formulas. It starts with a byte
 * order mark so spreadsheets open it as UTF-8, except when the first cell is quoted: some read a mark before a quote
 * as part of the cell.
 */
export function createCsvDownload(id: string, table: Table): { filename: string; text: () => string } {
  return {
    filename: `${id}.csv`,
    text: () => {
      const csv = tableToCsv(table);
      return csv.startsWith('"') ? csv : UTF8_BYTE_ORDER_MARK + csv;
    },
  };
}

/** The scroll offset that centres an item of a viewport. */
export function centeredScrollOffset(position: number, size: number, viewportPosition: number, viewportSize: number): number {
  return position - viewportPosition - Math.max(viewportSize - size, 0) / 2;
}

/** The columns whose cells are all numbers (or empty), to align right. */
export function getNumericColumns(table: Table): Set<string> {
  const numeric = new Set<string>();
  for (const column of table.columns) {
    let any = false;
    const all = table.rows.every((row) => {
      const cell: Cell | undefined = row[column];
      if (cell === null || cell === undefined || cell === '') return true;
      any = true;
      return typeof cell === 'number' || coerceCellNumber(cell) !== null;
    });
    if (all && any) numeric.add(column);
  }
  return numeric;
}

/** What to ring in a result, from the picked mark's row and column. */
export function getResultHighlightTarget(shown: ShownDatasetResult, pick: { row?: number; field?: string } | null): ResultHighlightTarget {
  if (pick === null) return null;
  const { row, field } = pick;
  if (shown.table !== null) {
    if (shown.table.rows.length === 1) return field !== undefined && shown.table.columns.includes(field) ? { entry: field } : 'body';
    if (row === undefined && field === undefined) return 'body';
    const inRows = row === undefined || (row >= 0 && row < shown.table.rows.length);
    const inColumns = field === undefined || shown.table.columns.includes(field);
    return inRows && inColumns ? { ...(row === undefined ? {} : { row }), ...(field === undefined ? {} : { field }) } : 'body';
  }
  const { data } = shown;
  if (isPlainObject(data)) return field !== undefined && Object.hasOwn(data, field) ? { entry: field } : 'body';
  if (!Array.isArray(data)) return 'value';
  return row !== undefined && row >= 0 && row < data.length ? { entry: String(row + 1) } : 'body';
}

/** A picked number: what it is (the column and the row it names), the number as the page shows it, and its exact value when that differs. */
export interface FocusedNumber {
  name: string;
  value: string;
  exact: string | null;
}

/** What a page pick says about the number it shows. */
export interface FocusedPick {
  row?: number;
  field?: string;
  where?: readonly string[];
  shown?: string;
  scaled?: boolean;
}

const isPresentScalar = (value: unknown): boolean => value !== undefined && value !== null && typeof value !== 'object';
const normalizeNumericDigits = (text: string): string => text.replace(/\D/g, '').replace(/^0+|0+$/g, '');
const formatExactResultValue = (value: unknown): string | undefined => formatPlainValue(typeof value === 'number' ? Number(value.toPrecision(15)) : value);

function groupExactNumber(text: string | undefined): string | undefined {
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(text ?? '');
  return match === null ? text : (match[1] ?? '') + (match[2] ?? '').replace(/\B(?=(\d{3})+$)/g, ',') + (match[3] ?? '');
}

/** The part of the shown text that is the value (the closest match), and whether it is the whole value unscaled. */
function findDisplayedNumberText(text: string, value: unknown, scaled: boolean): { said: string; whole: boolean } | null {
  const number = typeof value === 'boolean' ? null : coerceCellNumber(value);
  if (number === null) return null;
  let best: { said: string; whole: boolean; step: number } | null = null;
  for (const said of [text, ...text.split(' ')])
    for (const shown of parseDisplayedNumbers(said)) {
      if (!matchesPossiblyScaledNumber(shown, number, scaled) || (!shown.signed && number < 0)) continue;
      const step = shown.step / (shown.percent ? 100 : 1);
      if (best === null || step < best.step) best = { said, whole: matchesPossiblyScaledNumber(shown, number), step };
    }
  return best;
}

/** The picked cell's value as the page shows it, named by its column and row, when the pick names one cell. */
export function getFocusedNumber(shown: ShownDatasetResult | null, pick: FocusedPick | null): FocusedNumber | null {
  if (shown === null || shown.table === null || pick === null || pick.field === undefined) return null;
  const { table } = shown;
  const rowIndex = pick.row ?? (table.rows.length === 1 ? 0 : undefined);
  const row = rowIndex === undefined ? undefined : table.rows[rowIndex];
  if (row === undefined || !table.columns.includes(pick.field)) return null;
  const cell = row[pick.field];
  if (!isPresentScalar(cell)) return null;
  const exact = formatExactResultValue(cell);
  if (exact === undefined) return null;
  const name = [humanizeIdentifier(stripColumnNamespace(pick.field)), ...(pick.where ?? [])].join(', ');
  const said = findDisplayedNumberText((pick.shown ?? '').replace(/\s+/g, ' ').trim(), cell, pick.scaled === true);
  if (said === null) return { name, value: exact, exact: null };
  const grouped = groupExactNumber(exact) ?? exact;
  return { name, value: said.said, exact: said.whole && normalizeNumericDigits(said.said) === normalizeNumericDigits(grouped) ? null : grouped };
}
