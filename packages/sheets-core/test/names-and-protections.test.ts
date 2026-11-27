import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AgentError,
  applyEdits,
  cellsChangedFromTheirDefaults,
  cellsOrLinesOf,
  cellsOrLinesText,
  defaultValuesEdit,
  type EditContext,
  type EngineMessage,
  namedRangeIdOf,
  namedRangesListing,
  protectionListing,
  readWorkbook,
  removeNamedRangeEdit,
  removeProtectionEdit,
  resetToDefaultValuesEdit,
  saveNamedRangeEdit,
  saveProtectionEdit,
  SheetView,
  sheetSettingsEdit,
  typedOrNone,
  type WorkbookContents,
} from '../src/index.ts';

const ME = 'u_0000000000000000000001';

/** Sheet1: ten rows r.0…r.9, five columns c.0…c.4; one protection and one named range. */
function workbook(): WorkbookContents {
  return {
    revision: 3,
    locale: 'en-US',
    sheets: [
      {
        sheetId: 's1',
        name: 'Sheet1',
        rows: [{ base: 'r', first: 0, count: 10 }],
        columns: [{ base: 'c', first: 0, count: 5 }],
        protections: [
          { protectionId: 'p1', protection: { protects: { kind: 'range', range: { kind: 'wholeColumns', first: 'c.0', last: 'c.1' } }, editors: [ME] } },
          {
            protectionId: 'p2',
            protection: {
              protects: { kind: 'sheet', openRanges: [{ kind: 'cells', topLeft: { r: 'r.1', c: 'c.1' }, bottomRight: { r: 'r.8', c: 'c.2' } }, { kind: 'wholeRows', first: 'gone', last: 'r.3' }] },
              editors: [],
            },
          },
        ],
      },
      { sheetId: 's2', name: 'Hidden', rows: [{ base: 'h', first: 0, count: 2 }], columns: [{ base: 'k', first: 0, count: 2 }], isHidden: true },
    ],
    namedRanges: [{ namedRangeId: 'n1', namedRange: { name: 'Prices' }, address: 'Sheet1!B2:B9' }],
  };
}

const sheet1 = (): SheetView => new SheetView(workbook().sheets[0]!);

function refusal(make: () => unknown): string {
  try {
    make();
  } catch (error) {
    if (error instanceof AgentError) return error.code;
    throw error;
  }
  return 'made';
}

test('ranges of cells, rows and columns, there and back', () => {
  const view = sheet1();
  assert.deepEqual(cellsOrLinesOf(view, 'B2:C9', 'range'), { kind: 'cells', topLeft: { r: 'r.1', c: 'c.1' }, bottomRight: { r: 'r.8', c: 'c.2' } });
  assert.deepEqual(cellsOrLinesOf(view, '5:3', 'range'), { kind: 'wholeRows', first: 'r.2', last: 'r.4' });
  assert.deepEqual(cellsOrLinesOf(view, 'D', 'range'), { kind: 'wholeColumns', first: 'c.3', last: 'c.3' });
  assert.equal(refusal(() => cellsOrLinesOf(view, '11:12', 'range')), 'outsideTheSheet');
  assert.equal(refusal(() => cellsOrLinesOf(view, 'Sheet1!A1', 'range')), 'rangeNotReadable');
  for (const text of ['B2:C9', '3:5', 'D:D', 'A1']) assert.equal(cellsOrLinesText(view, cellsOrLinesOf(view, text, 'range')), text);
  assert.equal(cellsOrLinesText(view, { kind: 'wholeColumns', first: 'c.9', last: 'c.1' }), null);
});

test('protections as readSheets lists them', () => {
  const view = sheet1();
  const [one, two] = view.contents.protections!;
  assert.deepEqual(protectionListing(view, one!.protectionId, one!.protection), { protectionId: 'p1', protects: 'A:B', editors: [ME] });
  // An open range whose rows are gone is left out of the list.
  assert.deepEqual(protectionListing(view, two!.protectionId, two!.protection), { protectionId: 'p2', protects: 'sheet', open: ['B2:C9'], editors: [] });
});

test('readSheets tells of hidden sheets, protections and named ranges', () => {
  const asked: EngineMessage[] = [];
  const answer = (request: EngineMessage): EngineMessage => {
    asked.push(request);
    if (request.kind === 'readNamedRanges') return { kind: 'namedRanges', namedRanges: [{ namedRange: { name: 'Prices' }, address: 'Sheet1!B2:B9' }, { namedRange: { name: 'Old' } }, 'junk'] };
    if (request.kind === 'readCellsChangedFromTheirDefaults') return { kind: 'cellsChanged', cells: [{ address: 'B2', held: 5, defaultValue: 0 }] };
    return { kind: 'refused' };
  };
  const context = { workbook: workbook(), answer, utility: answer, timeZone: null };
  const read = readWorkbook({ kind: 'readSheets' }, context);
  const sheets = read.sheets as EngineMessage[];
  assert.equal(sheets[0]!.isHidden, undefined);
  assert.equal(sheets[1]!.isHidden, true);
  assert.equal((sheets[0]!.protections as unknown[]).length, 2);
  assert.equal(sheets[1]!.protections, undefined);
  assert.deepEqual(read.namedRanges, [
    { name: 'Prices', address: 'Sheet1!B2:B9' },
    { name: 'Old', address: null },
  ]);
  assert.deepEqual(Object.keys(read).slice(0, 4), ['revision', 'sheets', 'namedRanges', 'locale']);
  assert.deepEqual(readWorkbook({ kind: 'readNamedRanges' }, context), { revision: 3, namedRanges: read.namedRanges });
  assert.deepEqual(readWorkbook({ kind: 'readCellsChangedFromTheirDefaults', sheet: 'sheet1' }, context), { revision: 3, sheet: 'Sheet1', cells: [{ cell: 'B2', holds: 5, defaultValue: 0 }] });
  assert.deepEqual(asked.at(-1), { kind: 'readCellsChangedFromTheirDefaults', sheetId: 's1' });
  assert.equal(refusal(() => readWorkbook({ kind: 'readNamedRanges', sheet: 'Sheet1' }, context)), 'unreadableRead');

  // A workbook with no named ranges is not asked for them, and lists none.
  const bare = { ...workbook(), namedRanges: [] };
  assert.deepEqual(namedRangesListing(bare, () => assert.fail('asked')), []);
  assert.equal('namedRanges' in readWorkbook({ kind: 'readSheets' }, { ...context, workbook: bare }), false);
  assert.deepEqual(cellsChangedFromTheirDefaults(sheet1(), () => ({ kind: 'refused' })), []);
});

test('saving and removing named ranges', () => {
  const view = sheet1();
  const book = workbook();
  assert.deepEqual(saveNamedRangeEdit({ kind: 'saveNamedRange', name: 'Tax', sheet: 'Sheet1', range: 'A:B' }, view, book), { kind: 'saveNamedRange', namedRangeId: null, name: 'Tax', sheetId: 's1', address: 'A:B' });
  assert.equal(saveNamedRangeEdit({ kind: 'saveNamedRange', name: 'Costs', sheet: 'Sheet1', range: 'C2:C9', inPlaceOf: ' prices ' }, view, book).namedRangeId, 'n1');
  assert.equal(refusal(() => saveNamedRangeEdit({ kind: 'saveNamedRange', name: ' ', sheet: 'Sheet1', range: 'A1' }, view, book)), 'nameOfNamedRangeNotAllowed');
  assert.equal(refusal(() => saveNamedRangeEdit({ kind: 'saveNamedRange', name: 'X', sheet: 'Sheet1', range: 3 }, view, book)), 'rangeNotReadable');
  assert.equal(refusal(() => saveNamedRangeEdit({ kind: 'saveNamedRange', name: 'X', sheet: 'Sheet1', range: 'A1', inPlaceOf: 'Nope' }, view, book)), 'namedRangeIsGone');
  assert.equal(refusal(() => saveNamedRangeEdit({ kind: 'saveNamedRange', name: 'X', sheet: 'Sheet1', range: 'A1', scope: 'all' }, view, book)), 'unreadableEdit');
  assert.deepEqual(removeNamedRangeEdit({ kind: 'removeNamedRange', name: 'PRICES' }, book), { kind: 'removeNamedRange', namedRangeId: 'n1' });
  assert.throws(() => namedRangeIdOf(book, 'Tax'), /the workbook names Prices/);
});

test('default values and their limits', () => {
  const view = sheet1();
  const block = { sheetId: 's1', rows: [{ base: 'r', first: 1, count: 3 }], oneColumn: 'c.1', otherColumn: 'c.1' };
  assert.deepEqual(defaultValuesEdit({ kind: 'setDefaultValues', sheet: 'Sheet1', range: 'B2:B4', defaultValue: 0 }, view), { kind: 'setDefaultValuesAndLimits', cells: block, defaultValue: { kind: 'typed', text: '0' } });
  assert.deepEqual(defaultValuesEdit({ kind: 'setDefaultValues', sheet: 'Sheet1', range: 'B2:B4', defaultValue: null, limits: { minimum: 1 } }, view), {
    kind: 'setDefaultValuesAndLimits',
    cells: block,
    defaultValue: { kind: 'none' },
    limits: { typedIn: { r: 'r.1', c: 'c.1' }, minimum: '1', maximum: '' },
  });
  assert.deepEqual(defaultValuesEdit({ kind: 'setDefaultValues', sheet: 'Sheet1', range: 'B2:B4', limits: null }, view).limits, { typedIn: { r: 'r.1', c: 'c.1' }, minimum: '', maximum: '' });
  assert.equal(refusal(() => defaultValuesEdit({ kind: 'setDefaultValues', sheet: 'Sheet1', range: 'B2' }, view)), 'unreadableEdit');
  assert.equal(refusal(() => defaultValuesEdit({ kind: 'setDefaultValues', sheet: 'Sheet1', range: 'B2', limits: [1, 2] }, view)), 'unreadableEdit');
  assert.equal(refusal(() => defaultValuesEdit({ kind: 'setDefaultValues', sheet: 'Sheet1', range: 'B2', limits: { least: 1 } }, view)), 'unreadableEdit');
  assert.equal(refusal(() => defaultValuesEdit({ kind: 'setDefaultValues', sheet: 'Sheet1', range: 'B2', defaultValue: true }, view)), 'unreadableEdit');
  assert.equal(typedOrNone('5%', 'defaultValue'), '5%');
  assert.equal(typedOrNone(null, 'defaultValue'), '');
  assert.equal(refusal(() => typedOrNone(Number.POSITIVE_INFINITY, 'maximum')), 'unreadableEdit');
  assert.deepEqual(resetToDefaultValuesEdit({ kind: 'resetToDefaultValues', sheet: 'Sheet1' }, view), { kind: 'resetSheetsToDefaultValues', sheetIds: ['s1'] });
  assert.deepEqual(resetToDefaultValuesEdit({ kind: 'resetToDefaultValues', sheet: 'Sheet1', range: 'B2:B4' }, view), { kind: 'resetCellsToDefaultValues', cells: block });
});

test('saving and removing protections', () => {
  const view = sheet1();
  // No editors named: whoever makes the edits.
  assert.deepEqual(saveProtectionEdit({ kind: 'saveProtection', sheet: 'Sheet1', range: '1:1' }, view, ME), {
    kind: 'saveProtection',
    sheetId: 's1',
    protectionId: null,
    protection: { protects: { kind: 'range', range: { kind: 'wholeRows', first: 'r.0', last: 'r.0' } }, editors: [ME] },
  });
  assert.deepEqual(saveProtectionEdit({ kind: 'saveProtection', sheet: 'Sheet1', protectionId: 'p2', open: ['B2'], editors: [] }, view, ME), {
    kind: 'saveProtection',
    sheetId: 's1',
    protectionId: 'p2',
    protection: { protects: { kind: 'sheet', openRanges: [{ kind: 'cells', topLeft: { r: 'r.1', c: 'c.1' }, bottomRight: { r: 'r.1', c: 'c.1' } }] }, editors: [] },
  });
  assert.deepEqual((saveProtectionEdit({ kind: 'saveProtection', sheet: 'Sheet1' }, view, undefined).protection as EngineMessage).editors, []);
  assert.equal(refusal(() => saveProtectionEdit({ kind: 'saveProtection', sheet: 'Sheet1', range: 'A1', open: [] }, view, ME)), 'unreadableEdit');
  assert.equal(refusal(() => saveProtectionEdit({ kind: 'saveProtection', sheet: 'Sheet1', open: 'A1' }, view, ME)), 'unreadableEdit');
  assert.equal(refusal(() => saveProtectionEdit({ kind: 'saveProtection', sheet: 'Sheet1', editors: [7] }, view, ME)), 'unreadableEdit');
  assert.equal(refusal(() => saveProtectionEdit({ kind: 'saveProtection', sheet: 'Sheet1', protectionId: 'p9' }, view, ME)), 'protectionIsGone');
  assert.deepEqual(removeProtectionEdit({ kind: 'removeProtection', sheet: 'Sheet1', protectionId: 'p1' }, view), { kind: 'removeProtection', sheetId: 's1', protectionId: 'p1' });
  assert.equal(refusal(() => removeProtectionEdit({ kind: 'removeProtection', sheet: 'Sheet1', protectionId: 'p9' }, view)), 'protectionIsGone');
});

test('the edits go to the engine as queued, with who makes them and hidden sheets', () => {
  const queued: EngineMessage[] = [];
  const context: EditContext = {
    read: workbook,
    queue: (edit) => {
      queued.push(edit);
      return { kind: 'editQueued' };
    },
    apply: () => assert.fail('nothing is applied as operations'),
    answer: () => ({ kind: 'refused' }),
    utility: () => ({ kind: 'refused' }),
    deletedSheets: () => [],
    person: ME,
  };
  applyEdits(
    [
      { kind: 'saveProtection', sheet: 'Sheet1', range: 'C3' },
      { kind: 'removeNamedRange', name: 'Prices' },
      { kind: 'setSheetSettings', sheet: 'Hidden', settings: { isHidden: false } },
    ],
    context,
  );
  assert.deepEqual(queued.map((edit) => edit.kind), ['saveProtection', 'removeNamedRange', 'setSheetSettings']);
  assert.deepEqual((queued[0]!.protection as EngineMessage).editors, [ME]);
  assert.deepEqual(queued[2], { kind: 'setSheetSettings', sheetId: 's2', settings: { isHidden: false } });
  assert.equal(refusal(() => applyEdits([{ kind: 'setSheetSettings', sheet: 'Sheet1', settings: { isHidden: 'yes' } }], context)), 'unreadableEdit');
});

test('sheet settings: rows and columns become ids, flags stay true or false, and nothing else is taken', () => {
  const view = sheet1();
  const of = () => view;
  assert.deepEqual(sheetSettingsEdit({ kind: 'setSheetSettings', sheet: 'Sheet1', settings: { lastFrozenRow: 2, lastFrozenColumn: 'B', areGridlinesHidden: true, isHidden: false } }, of), {
    kind: 'setSheetSettings',
    sheetId: 's1',
    settings: { lastFrozenRow: 'r.1', lastFrozenColumn: 'c.1', areGridlinesHidden: true, isHidden: false },
  });
  assert.deepEqual(sheetSettingsEdit({ kind: 'setSheetSettings', sheet: 'Sheet1', settings: { lastFrozenRow: null, lastFrozenColumn: null } }, of).settings, { lastFrozenRow: null, lastFrozenColumn: null });
  for (const settings of [{}, { lastFrozenRow: 0 }, { lastFrozenRow: 11 }, { lastFrozenRow: 1.5 }, { isHidden: 1 }, { toString: true }, { constructor: true }, { zoom: 2 }]) {
    assert.equal(refusal(() => sheetSettingsEdit({ kind: 'setSheetSettings', sheet: 'Sheet1', settings }, of)), 'unreadableEdit', JSON.stringify(settings));
  }
  assert.equal(refusal(() => sheetSettingsEdit({ kind: 'setSheetSettings', sheet: 'Sheet1', settings: [] }, of)), 'unreadableEdit');
  // The keys are checked before the sheet is picked.
  assert.equal(refusal(() => sheetSettingsEdit({ kind: 'setSheetSettings', sheet: 'Nowhere', settings: {}, more: 1 }, () => { throw new AgentError('sheetNotFound', 'no'); })), 'unreadableEdit');
});
