/**
 * Connected tables, as the agent works with them: a sheet whose rows are the records a call to one of the agent's
 * connectors returns. The agent makes the table and its call with edits, reads it back with readConnectedTable, and,
 * when the page asks for a refresh, makes the call itself and hands the records over; they are kept as the table's
 * file (its fields, each a list of distinct values and where each row's value is in it), which a snapshot names.
 */

import type { AgentRequest } from '@open-artifact/runtime/capabilities';
import { type EngineMessage, isObject } from './engine.ts';
import { AgentError } from './errors.ts';
import { PAGE_REQUEST_PRESSED } from './page-requests.ts';
import { checkKeys, pickSheet, type SheetView } from './workbook.ts';

/** The most records a refresh keeps; more are cut off. */
export const MAX_RECORDS = 100_000;
/** The most fields a record has. */
export const MAX_FIELDS = 200;
/** The longest text one value of a record is. */
export const MAX_VALUE_LENGTH = 50_000;
/** The most text a refresh's records hold in all, in UTF-8 bytes. */
export const MAX_RECORDS_TEXT_BYTES = 64 * 1024 * 1024;
/** The longest a transform's code is. */
const MAX_TRANSFORM_LENGTH = 100_000;
const MAX_ARGUMENTS_LENGTH = 100_000;

/** Why the agent may say a refresh brought no rows (the page tells each in its own words). */
export const REFRESH_FAILURES = [
  'toolError',
  'callFailed',
  'noRowInTime',
  'answerTooLarge',
  'answerNotRead',
  'callNotWellFormed',
  'notConnected',
  'reconnect',
  'connectorNotServed',
  'toolNotAllowedHere',
  'notAllowed',
  'failed',
] as const;
export type RefreshFailure = (typeof REFRESH_FAILURES)[number];

export const CONNECTED_TABLE_EDIT_KINDS = ['addConnectedTable', 'setCallOfConnectedTable', 'addColumnToConnectedTable', 'changeColumnOfConnectedTable'];

/** How the agent writes a call: its arguments as an object, its transform as the code's text. */
export interface CallAsWritten {
  title: string;
  connector: string;
  tool: string;
  arguments: Record<string, unknown>;
  followUp?: { tool: string; arguments: Record<string, unknown> } | null;
  transform: string;
}

/** A column as the agent writes it: its name and the field it shows. */
export interface ColumnAsWritten {
  name: string;
  field: string;
  reading?: EngineMessage | null;
  horizontalAlignment?: string;
}

/** A connected table's call in the engine's words, from the agent's. */
export function engineCall(given: unknown, key = 'call'): EngineMessage {
  if (!isObject(given)) throw new AgentError('callNotWellFormed', `${key} is {"title", "connector", "tool", "arguments": {…}, "followUp"?: {"tool", "arguments"}, "transform": "<code>"}.`);
  checkKeys(given, ['title', 'connector', 'tool', 'arguments', 'transform'], ['followUp']);
  const text = (value: unknown, name: string, most = 200): string => {
    if (typeof value !== 'string' || value.trim() === '' || value.length > most) throw new AgentError('callNotWellFormed', `${key}.${name} is text of 1 to ${most} characters.`);
    return value;
  };
  const argumentsAsJson = (value: unknown, name: string): string => {
    if (!isObject(value)) throw new AgentError('callNotWellFormed', `${key}.${name} is a JSON object: the tool's arguments.`);
    const json = JSON.stringify(value);
    if (json.length > MAX_ARGUMENTS_LENGTH) throw new AgentError('callNotWellFormed', `${key}.${name} is at most ${MAX_ARGUMENTS_LENGTH} characters as JSON.`);
    return json;
  };
  let followUp: EngineMessage | null = null;
  if (given.followUp !== undefined && given.followUp !== null) {
    if (!isObject(given.followUp)) throw new AgentError('callNotWellFormed', `${key}.followUp is {"tool", "arguments"}, with "{{cursor}}" where the cursor goes, or null.`);
    checkKeys(given.followUp, ['tool', 'arguments']);
    followUp = { tool: text(given.followUp.tool, 'followUp.tool'), argumentsAsJson: argumentsAsJson(given.followUp.arguments, 'followUp.arguments') };
  }
  return {
    title: text(given.title, 'title'),
    connector: text(given.connector, 'connector'),
    tool: text(given.tool, 'tool'),
    argumentsAsJson: argumentsAsJson(given.arguments, 'arguments'),
    followUp,
    transform: { kind: 'code', source: text(given.transform, 'transform', MAX_TRANSFORM_LENGTH) },
  };
}

/** A call in the agent's words, from the engine's. */
export function callAsWritten(call: EngineMessage): EngineMessage {
  const parsed = (json: unknown): unknown => {
    try {
      return JSON.parse(String(json));
    } catch {
      return json;
    }
  };
  const followUp = isObject(call.followUp) ? { tool: call.followUp.tool, arguments: parsed(call.followUp.argumentsAsJson) } : null;
  return {
    title: call.title,
    connector: call.connector,
    tool: call.tool,
    arguments: parsed(call.argumentsAsJson),
    followUp,
    transform: isObject(call.transform) ? call.transform.source : null,
  };
}

/** A column in the engine's words, from the agent's. */
export function engineColumn(given: unknown, key = 'column'): EngineMessage {
  if (!isObject(given)) throw new AgentError('columnNotDescribed', `${key} is {"name", "field", "reading"?, "horizontalAlignment"?}.`);
  checkKeys(given, ['name', 'field'], ['reading', 'horizontalAlignment']);
  if (typeof given.name !== 'string' || given.name.trim() === '' || given.name.length > 255) throw new AgentError('nameOfColumnNotAllowed', `${key}.name is the column's heading, 1 to 255 characters.`);
  if (typeof given.field !== 'string' || given.field === '' || given.field.length > 255) throw new AgentError('nameOfFieldNotAllowed', `${key}.field is the name of a field of the records.`);
  if (given.reading !== undefined && given.reading !== null && !isObject(given.reading)) throw new AgentError('columnNotDescribed', `${key}.reading is how the field's texts are read ({"kind": "text"}, {"kind": "number", …}), or null.`);
  const column: EngineMessage = { name: given.name, from: { kind: 'field', field: given.field, reading: (given.reading as EngineMessage | undefined) ?? null } };
  if (given.horizontalAlignment !== undefined) {
    if (!['left', 'center', 'right'].includes(String(given.horizontalAlignment))) throw new AgentError('columnNotDescribed', `${key}.horizontalAlignment is left, center or right.`);
    column.horizontalAlignment = given.horizontalAlignment;
  }
  return column;
}

/** A column in the agent's words, from the engine's. */
function columnAsWritten(column: EngineMessage): EngineMessage {
  const from = isObject(column.from) ? column.from : {};
  return {
    name: column.name,
    field: from.field ?? null,
    ...(from.reading ? { reading: from.reading } : {}),
    ...(column.horizontalAlignment ? { horizontalAlignment: column.horizontalAlignment } : {}),
  };
}

type ConnectedTableOfSheet = NonNullable<SheetView['contents']['connectedTable']>;

/** The connected table a sheet is; refused `notAConnectedTable` when it is none. */
export function connectedTableOf(view: SheetView): ConnectedTableOfSheet {
  const table = view.contents.connectedTable;
  if (!table) throw new AgentError('notAConnectedTable', `Sheet "${view.name}" is no connected table.`, { sheetName: view.name });
  return table;
}

/** The column of a connected table named `name`, capitals aside. */
function columnNamed(view: SheetView, name: unknown, key: string): string {
  const { columns } = connectedTableOf(view);
  if (typeof name !== 'string') throw new AgentError('unreadableEdit', `${key} is the name of a column of "${view.name}".`);
  const found = columns.find(({ column }) => column.name === name) ?? columns.find(({ column }) => String(column.name).toLowerCase() === name.toLowerCase());
  if (!found) throw new AgentError('unknownColumnName', `"${view.name}" has no column named "${name}". Its columns: ${columns.map(({ column }) => `"${column.name}"`).join(', ')}.`);
  return found.c;
}

/**
 * The engine edit of a connected-table edit, or null when the edit is of another kind. `afterSheet`, a column's
 * `after` and the column of `changeColumnOfConnectedTable` are named as the agent sees them.
 */
export function connectedTableEdit(edit: EngineMessage, sheets: SheetView[]): EngineMessage | null {
  switch (edit.kind) {
    case 'addConnectedTable': {
      checkKeys(edit, ['name', 'call', 'columns'], ['afterSheet']);
      if (typeof edit.name !== 'string' || edit.name.trim() === '' || edit.name.length > 100 || /[\u0000-\u001f]/.test(edit.name)) throw new AgentError('sheetNameNotAllowed', 'name is a sheet name of 1 to 100 characters, with no line breaks.');
      const name = edit.name;
      if (sheets.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new AgentError('sheetNameTaken', `A sheet is named "${name}" already.`);
      if (!Array.isArray(edit.columns) || edit.columns.length === 0) throw new AgentError('columnNotDescribed', 'columns is a list of 1 or more columns: [{"name": "Id", "field": "id"}, …].');
      const after = edit.afterSheet === undefined ? (sheets.at(-1) ?? null) : edit.afterSheet === null ? null : pickSheet(sheets, edit.afterSheet, 'afterSheet');
      return { kind: 'addConnectedTable', afterSheet: after?.sheetId ?? null, name, call: engineCall(edit.call), columns: edit.columns.map((c, i) => engineColumn(c, `columns[${i}]`)) };
    }
    case 'setCallOfConnectedTable': {
      checkKeys(edit, ['sheet', 'call']);
      const view = pickSheet(sheets, edit.sheet);
      connectedTableOf(view);
      return { kind: 'setCallOfConnectedTable', sheetId: view.sheetId, call: engineCall(edit.call) };
    }
    case 'addColumnToConnectedTable': {
      checkKeys(edit, ['sheet', 'column'], ['after']);
      const view = pickSheet(sheets, edit.sheet);
      const { columns } = connectedTableOf(view);
      const after = edit.after === undefined ? (columns.at(-1)?.c ?? null) : edit.after === null ? null : columnNamed(view, edit.after, 'after');
      return { kind: 'addColumnToConnectedTable', sheetId: view.sheetId, after, column: engineColumn(edit.column) };
    }
    case 'changeColumnOfConnectedTable': {
      checkKeys(edit, ['sheet', 'column', 'to']);
      const view = pickSheet(sheets, edit.sheet);
      return { kind: 'changeColumnOfConnectedTable', sheetId: view.sheetId, c: columnNamed(view, edit.column, 'column'), column: engineColumn(edit.to, 'to') };
    }
    default:
      return null;
  }
}

/** readConnectedTable: the table's call and columns in the agent's words, what was fetched last, and how to name each column in a formula. */
export function readConnectedTable(view: SheetView, answer: (request: EngineMessage) => EngineMessage): EngineMessage {
  const table = connectedTableOf(view);
  const read = answer({ kind: 'readConnectedTable', sheetId: view.sheetId });
  if (read.kind !== 'connectedTable') throw new AgentError('notAConnectedTable', `Sheet "${view.name}" is no connected table.`);
  const references = new Map(Array.isArray(read.references) ? read.references.flatMap((r) => (isObject(r) ? [[r.c, r.text] as const] : [])) : []);
  const snapshot = table.snapshot;
  return {
    sheet: view.name,
    call: callAsWritten(table.call),
    callDigest: read.callDigest,
    freshness: read.freshness,
    columns: table.columns.map(({ c, column }) => ({ ...columnAsWritten(column), reference: references.get(c) ?? null })),
    rows: read.rows,
    fetched: snapshot
      ? { at: new Date(Number(snapshot.fetchedAtInSecondsSince1970) * 1000).toISOString(), rowCount: snapshot.rowCount, isCutOff: snapshot.isCutOff }
      : null,
  };
}

/** A value a record's field may hold. */
export type RecordValue = string | number | boolean | null;

/** A table file's lines, from the records the agent hands over, and what its snapshot tells of them. */
export interface TableFile {
  lines: string[];
  rowCount: number;
  fieldCount: number;
  textInBytes: number;
  isCutOff: boolean;
}

/**
 * The table file of a refresh's records: each a JSON object of fields whose values are text, numbers, true, false or
 * null (a field a record lacks is null). Its fields are those of the records, in the order first seen. Records past
 * {@link MAX_RECORDS} are cut off.
 */
export function tableFileOf(records: unknown, isCutOffBefore = false): TableFile {
  if (!Array.isArray(records)) throw new AgentError('recordsNotReadable', 'records is a list of objects, one per row: [{"id": 1, "name": "Ann"}, …].');
  const isCutOff = isCutOffBefore || records.length > MAX_RECORDS;
  const kept = records.slice(0, MAX_RECORDS);
  const fields: string[] = [];
  const fieldIndex = new Map<string, number>();
  kept.forEach((record, i) => {
    if (!isObject(record)) throw new AgentError('recordsNotReadable', `records[${i}] is not an object: each record is {"field": value, …}.`, { recordIndex: i });
    for (const field of Object.keys(record)) {
      if (fieldIndex.has(field)) continue;
      if (field === '' || field.length > 255 || /[\u0000-\u001f]/.test(field)) throw new AgentError('fieldNotWellNamed', `records[${i}] has a field named ${JSON.stringify(field)}: a field's name is 1 to 255 characters, with no line breaks.`, { recordIndex: i });
      if (fields.length === MAX_FIELDS) throw new AgentError('tooManyFields', `The records have more than ${MAX_FIELDS} fields: keep the fields the columns show.`);
      fieldIndex.set(field, fields.length);
      fields.push(field);
    }
  });
  let textInBytes = 0;
  const encoder = new TextEncoder();
  const lines = [JSON.stringify({ table: { version: 1, rowCount: kept.length, fields } })];
  for (const field of fields) {
    const values: RecordValue[] = [];
    const placeOf = new Map<string, number>();
    const textBytes = new Map<number, number>();
    const places = kept.map((record, i) => {
      // Its own fields only: a record without `constructor` or `toString` lacks them, not holds a function.
      const value = Object.hasOwn(record as object, field) ? ((record as Record<string, unknown>)[field] ?? null) : null;
      if (typeof value === 'number' && !Number.isFinite(value)) throw new AgentError('valueThatNoCellHolds', `records[${i}].${field} is not a finite number.`, { recordIndex: i, field });
      if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) throw new AgentError('textTooLongForACell', `records[${i}].${field} is longer than ${MAX_VALUE_LENGTH} characters.`, { recordIndex: i, field });
      if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new AgentError('valueThatNoCellHolds', `records[${i}].${field} is ${Array.isArray(value) ? 'a list' : 'an object'}: a value is text, a number, true, false or null. Make it text, or a field of its own.`, { recordIndex: i, field });
      const key = typeof value === 'string' ? `s${value}` : JSON.stringify(value);
      let place = placeOf.get(key);
      if (place === undefined) {
        place = values.length;
        placeOf.set(key, place);
        values.push(value as RecordValue);
        if (typeof value === 'string') textBytes.set(place, encoder.encode(value).length);
      }
      // The snapshot's text is counted row by row: the engine keeps no more rows than it says.
      textInBytes += textBytes.get(place) ?? 0;
      return place;
    });
    lines.push(JSON.stringify({ values }), JSON.stringify({ places }));
  }
  if (textInBytes > MAX_RECORDS_TEXT_BYTES) throw new AgentError('answerTooLarge', `The records hold more than ${MAX_RECORDS_TEXT_BYTES / 1024 / 1024} MB of text: narrow the call, or keep fewer fields.`);
  return { lines, rowCount: kept.length, fieldCount: fields.length, textInBytes, isCutOff };
}

/** The request the agent gets when the page asks for a connected table's rows to be fetched again. */
export function refreshRequest(sheet: string, sheetNumber: number, callDigest: string): AgentRequest {
  return {
    text: `Refresh the connected table "${sheet}": make its call, and send its records with the refresh command.`,
    title: PAGE_REQUEST_PRESSED.refresh,
    context: { pressed: PAGE_REQUEST_PRESSED.refresh, sheet, sheetNumber, callDigest },
  };
}

/** Why the agent says a refresh brought no rows, checked. */
export function refreshFailure(given: unknown): { why: RefreshFailure; toolSaid?: string } {
  if (!isObject(given) || !(REFRESH_FAILURES as readonly unknown[]).includes(given.why)) throw new AgentError('unreadableRefresh', `failed is {"why": one of ${REFRESH_FAILURES.join(', ')}, "toolSaid"?: "<what the tool said>"}.`);
  checkKeys(given, ['why'], ['toolSaid']);
  if (given.toolSaid !== undefined && typeof given.toolSaid !== 'string') throw new AgentError('unreadableRefresh', 'failed.toolSaid is text: what the tool said.');
  const toolSaid = typeof given.toolSaid === 'string' ? given.toolSaid.slice(0, 1000) : undefined;
  return { why: given.why as RefreshFailure, ...(toolSaid ? { toolSaid } : {}) };
}
