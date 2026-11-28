/**
 * Named ranges, default values and protections, as the agent reads and edits them. A name stands for cells in
 * formulas (=SUM(Prices)); a default value is what "Reset to default" puts back in a cell, and its limits the least and
 * most number the cell takes; a protection keeps a range, or a whole sheet but its open ranges, to its editors.
 *
 * The agent writes ranges in A1 ("B2:C9", rows "3:5", columns "A:C"); the engine keeps them by row and column ids, so
 * a protection follows its cells when rows move. Each edit here is checked against the sheet and made into one engine
 * edit; the engine refuses the rest (a name already taken, a default value outside its limits, a protection that
 * would leave out whoever sets it).
 */

import { blockA1, columnLetters } from './addresses.ts';
import { type EngineMessage, isObject } from './engine.ts';
import { AgentError } from './errors.ts';
import { type CellsOrLines, checkKeys, type SheetProtection, type SheetView, type WorkbookContents } from './workbook.ts';

/** The most open ranges one protection lists. */
const MOST_OPEN_RANGES = 1000;
const WHOLE_ROWS = /^[1-9][0-9]*(?::[1-9][0-9]*)?$/;
const WHOLE_COLUMNS = /^[A-Z]{1,3}(?::[A-Z]{1,3})?$/;

// ---------- ranges ----------

/** Cells ("B2:C9", "B2"), whole rows ("3:5", "3") or whole columns ("A:C", "A") of a sheet, by their ids. */
export function cellsOrLinesOf(view: SheetView, text: unknown, key: string): CellsOrLines {
  if (typeof text === 'string' && WHOLE_ROWS.test(text)) {
    const [first, last] = view.rows(text, key);
    return { kind: 'wholeRows', first: view.rowIds[first]!, last: view.rowIds[last]! };
  }
  if (typeof text === 'string' && WHOLE_COLUMNS.test(text)) {
    const [first, last] = view.columns(text, key);
    return { kind: 'wholeColumns', first: view.columnIds[first]!, last: view.columnIds[last]! };
  }
  const block = view.range(text, key);
  return {
    kind: 'cells',
    topLeft: { r: view.rowIds[block.top]!, c: view.columnIds[block.left]! },
    bottomRight: { r: view.rowIds[block.bottom]!, c: view.columnIds[block.right]! },
  };
}

/** The A1 text of cells or lines; null once a row or column at either end is deleted. */
export function cellsOrLinesText(view: SheetView, range: CellsOrLines): string | null {
  if (range.kind === 'cells') {
    const top = view.rowIndex(range.topLeft.r);
    const left = view.columnIndex(range.topLeft.c);
    const bottom = view.rowIndex(range.bottomRight.r);
    const right = view.columnIndex(range.bottomRight.c);
    if (top === undefined || left === undefined || bottom === undefined || right === undefined) return null;
    return blockA1({ top, left, bottom, right });
  }
  const rows = range.kind === 'wholeRows';
  const first = rows ? view.rowIndex(range.first) : view.columnIndex(range.first);
  const last = rows ? view.rowIndex(range.last) : view.columnIndex(range.last);
  if (first === undefined || last === undefined) return null;
  const name = rows ? (i: number) => String(i + 1) : columnLetters;
  return `${name(first)}:${name(last)}`;
}

// ---------- reads ----------

/**
 * A protection as readSheets lists it. A whole sheet: `protects: "sheet"` and the ranges left `open` to everyone. One
 * range: `protects` is its A1 text (null once its cells are gone). Either way `editors`, the person ids who may edit.
 */
export function protectionListing(view: SheetView, protectionId: string, protection: SheetProtection): EngineMessage {
  const { protects, editors } = protection;
  if (protects.kind === 'range') return { protectionId, protects: cellsOrLinesText(view, protects.range), editors };
  const open = protects.openRanges.flatMap((range) => {
    const text = cellsOrLinesText(view, range);
    return text === null ? [] : [text];
  });
  return { protectionId, protects: 'sheet', open, editors };
}

/**
 * The named ranges by name and the address each names now ("Sheet1!A2:A9", null once its cells are gone), as the
 * session reads them. A workbook with none is not asked.
 */
export function namedRangesListing(workbook: WorkbookContents, answer: (request: EngineMessage) => EngineMessage): EngineMessage[] {
  if (!workbook.namedRanges?.length) return [];
  const read = answer({ kind: 'readNamedRanges' });
  const listed: unknown[] = Array.isArray(read.namedRanges) ? read.namedRanges : [];
  const out: EngineMessage[] = [];
  for (const entry of listed) {
    if (!isObject(entry) || !isObject(entry.namedRange) || typeof entry.namedRange.name !== 'string') continue;
    // The engine reads a name whose cells are gone as `#REF!` with no live cells: that is no address.
    const isGone = entry.liveCells === null || entry.address === '#REF!';
    out.push({ name: entry.namedRange.name, address: typeof entry.address === 'string' && !isGone ? entry.address : null });
  }
  return out;
}

/**
 * readSheets' answer with what this module keeps added: each sheet's `isHidden` and `protections` (`listed` holds the
 * sheets in the order of `views`), and the workbook's `namedRanges` after its sheets, each only when there is any.
 */
export function withHiddenProtectedAndNamed(
  listed: EngineMessage,
  views: readonly SheetView[],
  workbook: WorkbookContents,
  answer: (request: EngineMessage) => EngineMessage,
): EngineMessage {
  const entries: unknown[] = Array.isArray(listed.sheets) ? listed.sheets : [];
  const sheets = entries.map((entry, i) => {
    const view = views[i];
    if (!isObject(entry) || view === undefined) return entry;
    const { isHidden, protections = [] } = view.contents;
    return {
      ...entry,
      ...(isHidden ? { isHidden: true } : {}),
      ...(protections.length > 0 ? { protections: protections.map((kept) => protectionListing(view, kept.protectionId, kept.protection)) } : {}),
    };
  });
  const namedRanges = namedRangesListing(workbook, answer);
  const { revision, sheets: _replaced, ...rest } = listed;
  return { revision, sheets, ...(namedRanges.length > 0 ? { namedRanges } : {}), ...rest };
}

/** The cells of a sheet that hold something else than their default value: each cell, what it holds, its default. */
export function cellsChangedFromTheirDefaults(view: SheetView, answer: (request: EngineMessage) => EngineMessage): EngineMessage[] {
  const read = answer({ kind: 'readCellsChangedFromTheirDefaults', sheetId: view.sheetId });
  const listed: unknown[] = Array.isArray(read.cells) ? read.cells : [];
  return listed.flatMap((cell) => (isObject(cell) ? [{ cell: cell.address, holds: cell.held, defaultValue: cell.defaultValue }] : []));
}

// ---------- edits ----------

/** The id of the range named `name`, capitals and the spaces around it aside; namedRangeIsGone when none is. */
export function namedRangeIdOf(workbook: WorkbookContents, name: unknown): string {
  const named = workbook.namedRanges ?? [];
  const wanted = typeof name === 'string' ? name.trim().toLowerCase() : null;
  const found = wanted === null ? undefined : named.find((entry) => entry.namedRange.name.toLowerCase() === wanted);
  if (found) return found.namedRangeId;
  const names = named.map((entry) => entry.namedRange.name);
  throw new AgentError('namedRangeIsGone', `No range has the name ${JSON.stringify(name)}${names.length ? `; the workbook names ${names.join(', ')}` : ''}.`);
}

/** saveNamedRange {name, sheet, range, inPlaceOf?}: a new name, or (inPlaceOf) a name moved to other cells or renamed. */
export function saveNamedRangeEdit(edit: EngineMessage, view: SheetView, workbook: WorkbookContents): EngineMessage {
  checkKeys(edit, ['name', 'sheet', 'range'], ['inPlaceOf']);
  const { name, range } = edit;
  if (typeof name !== 'string' || name.trim() === '') throw new AgentError('nameOfNamedRangeNotAllowed', 'name is what the cells are called in formulas, such as "Prices".');
  if (typeof range !== 'string') throw new AgentError('rangeNotReadable', 'range is the cells the name stands for, without a sheet name: "A2:A9", columns "A:B" or rows "2:3".');
  cellsOrLinesOf(view, range, 'range');
  const replaced = edit.inPlaceOf === undefined ? null : namedRangeIdOf(workbook, edit.inPlaceOf);
  return { kind: 'saveNamedRange', namedRangeId: replaced, name, sheetId: view.sheetId, address: range };
}

/** removeNamedRange {name}. */
export function removeNamedRangeEdit(edit: EngineMessage, workbook: WorkbookContents): EngineMessage {
  checkKeys(edit, ['name']);
  return { kind: 'removeNamedRange', namedRangeId: namedRangeIdOf(workbook, edit.name) };
}

/** A default value or a limit as the engine takes it: the text typed in a cell, "" for none. */
export function typedOrNone(given: unknown, key: string): string {
  if (given === null || given === '') return '';
  if (typeof given === 'string') return given;
  if (typeof given === 'number' && Number.isFinite(given)) return String(given);
  throw new AgentError('unreadableEdit', `${key} is a number, or text as one would type it in the cell; null for none.`);
}

/**
 * setDefaultValues {sheet, range, defaultValue?, limits?}: what the cells go back to on a reset, and the least and
 * most number they take ({minimum, maximum}, either null). Only what is given changes; null takes it away.
 */
export function defaultValuesEdit(edit: EngineMessage, view: SheetView): EngineMessage {
  checkKeys(edit, ['sheet', 'range'], ['defaultValue', 'limits']);
  const hasDefault = 'defaultValue' in edit;
  const hasLimits = 'limits' in edit;
  if (!hasDefault && !hasLimits) throw new AgentError('unreadableEdit', 'setDefaultValues changes defaultValue, limits, or both: give at least one.');
  const block = view.range(edit.range);
  const request: EngineMessage = { kind: 'setDefaultValuesAndLimits', cells: view.engineBlock(block) };
  if (hasDefault) {
    const text = typedOrNone(edit.defaultValue, 'defaultValue');
    request.defaultValue = text === '' ? { kind: 'none' } : { kind: 'typed', text };
  }
  if (hasLimits) {
    const { limits } = edit;
    if (limits !== null && !isObject(limits)) throw new AgentError('unreadableEdit', 'limits is {"minimum": 0, "maximum": 100}, either of them null, or null for no limits.');
    const given: EngineMessage = limits ?? {};
    checkKeys({ ...given, kind: 'limits' }, [], ['minimum', 'maximum']);
    // The limits are read as typed in the range's top-left cell (a date, a percent, in its format).
    request.limits = {
      typedIn: { r: view.rowIds[block.top], c: view.columnIds[block.left] },
      minimum: typedOrNone(given.minimum ?? null, 'minimum'),
      maximum: typedOrNone(given.maximum ?? null, 'maximum'),
    };
  }
  return request;
}

/** resetToDefaultValues {sheet, range?}: the cells, or every cell of the sheet, back to their default values. */
export function resetToDefaultValuesEdit(edit: EngineMessage, view: SheetView): EngineMessage {
  checkKeys(edit, ['sheet'], ['range']);
  if (edit.range === undefined) return { kind: 'resetSheetsToDefaultValues', sheetIds: [view.sheetId] };
  return { kind: 'resetCellsToDefaultValues', cells: view.engineBlock(view.range(edit.range)) };
}

function existingProtection(view: SheetView, protectionId: unknown): string {
  const kept = view.contents.protections ?? [];
  if (typeof protectionId === 'string' && kept.some((entry) => entry.protectionId === protectionId)) return protectionId;
  throw new AgentError('protectionIsGone', `Sheet "${view.name}" has no protection ${JSON.stringify(protectionId)}; readSheets lists its protections.`);
}

/**
 * saveProtection {sheet, protectionId?, range?, open?, editors?}: `range` alone, or the whole sheet but its `open`
 * ranges; only `editors` (person ids) may edit there, whoever makes the edits when none are named. With protectionId,
 * that protection is changed.
 */
export function saveProtectionEdit(edit: EngineMessage, view: SheetView, person: string | undefined): EngineMessage {
  checkKeys(edit, ['sheet'], ['protectionId', 'range', 'open', 'editors']);
  const { range, open } = edit;
  if (range !== undefined && open !== undefined) throw new AgentError('unreadableEdit', 'A protection keeps one range, or the whole sheet with some ranges left open: give range or open, not both.');
  if (open !== undefined && (!Array.isArray(open) || open.length > MOST_OPEN_RANGES)) throw new AgentError('unreadableEdit', `open lists the ranges anyone may still edit, at most ${MOST_OPEN_RANGES}: ["B2:C9", "5:6"].`);
  const editors = edit.editors ?? (person === undefined ? [] : [person]);
  if (!Array.isArray(editors) || editors.some((editor) => typeof editor !== 'string')) throw new AgentError('unreadableEdit', 'editors lists person ids, as readSheets gives them.');
  const protectionId = edit.protectionId === undefined ? null : existingProtection(view, edit.protectionId);
  const protects =
    range === undefined
      ? { kind: 'sheet', openRanges: (Array.isArray(open) ? open : []).map((each) => cellsOrLinesOf(view, each, 'each of open')) }
      : { kind: 'range', range: cellsOrLinesOf(view, range, 'range') };
  return { kind: 'saveProtection', sheetId: view.sheetId, protectionId, protection: { protects, editors } };
}

/** removeProtection {sheet, protectionId}. */
export function removeProtectionEdit(edit: EngineMessage, view: SheetView): EngineMessage {
  checkKeys(edit, ['sheet', 'protectionId']);
  return { kind: 'removeProtection', sheetId: view.sheetId, protectionId: existingProtection(view, edit.protectionId) };
}

/** What an edit of this module needs of the edit it is in: its sheet, the workbook now, and who edits. */
export interface KeptEditContext {
  sheet: () => SheetView;
  workbook: () => WorkbookContents;
  person: string | undefined;
}

const KEPT_EDITS: Readonly<Record<string, (edit: EngineMessage, context: KeptEditContext) => EngineMessage>> = {
  saveNamedRange: (edit, { sheet, workbook }) => saveNamedRangeEdit(edit, sheet(), workbook()),
  removeNamedRange: (edit, { workbook }) => removeNamedRangeEdit(edit, workbook()),
  setDefaultValues: (edit, { sheet }) => defaultValuesEdit(edit, sheet()),
  resetToDefaultValues: (edit, { sheet }) => resetToDefaultValuesEdit(edit, sheet()),
  saveProtection: (edit, { sheet, person }) => saveProtectionEdit(edit, sheet(), person),
  removeProtection: (edit, { sheet }) => removeProtectionEdit(edit, sheet()),
};

/** The engine edit for one of the agent's named range, default value or protection edits; null for any other kind. */
export function namesAndProtectionsEdit(edit: EngineMessage, context: KeptEditContext): EngineMessage | null {
  const make = typeof edit.kind === 'string' && Object.hasOwn(KEPT_EDITS, edit.kind) ? KEPT_EDITS[edit.kind] : undefined;
  return make ? make(edit, context) : null;
}
