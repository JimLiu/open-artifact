import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sheetsEngine } from '@open-artifact/wasm-sheets/node';
import {
  EngineClient,
  NEWEST_FORMAT_VERSION,
  type CallOfAConnectedTable,
  type CellAt,
  type ColumnId,
  type Edit,
  type IdRun,
  type Protection,
  type RecordedEdit,
  type RowId,
  type SheetId,
  type SyncState,
} from '../src/engine/index.ts';

/** Narrows an answer to one kind, failing the test (with the answer) otherwise. */
function expectKind<A extends { kind: string }, K extends A['kind']>(answer: A, kind: K): Extract<A, { kind: K }> {
  assert.equal(answer.kind, kind, `expected ${kind}, got ${JSON.stringify(answer)}`);
  return answer as Extract<A, { kind: K }>;
}

/** The ids of a run, in order. */
function idsOf(runs: IdRun[]): string[] {
  return runs.flatMap((run) => Array.from({ length: run.count }, (_, i) => `${run.base}.${run.first + i}`));
}

/** A synced session with two sheets, and helpers to queue edits and send them. */
function openWorkbook() {
  const engine = sheetsEngine();
  const client = new EngineClient(engine.session());
  let revision = 0;
  let count = 0;

  /** Sends what the state says to send until nothing is left; the first edit sent is returned. */
  const sendAll = (state: SyncState): RecordedEdit | null => {
    let first: RecordedEdit | null = null;
    while (state.nextStep?.kind === 'sendEdit') {
      const { opId, recordedEdit } = state.nextStep;
      first ??= recordedEdit;
      revision += 1;
      state = expectKind(
        client.request({ kind: 'receiveSendOutcome', opId, outcome: { kind: 'saved', revision } }),
        'syncState',
      );
    }
    return first;
  };
  const queue = (edit: Edit) => {
    count += 1;
    return client.request({
      kind: 'queueEdit',
      opId: `op-${count}`,
      newIdCode: `code${String(count).padStart(4, '0')}aa`,
      edit,
    });
  };
  /** Queues an edit that must be taken, sends it, and returns what was queued and the edit as recorded. */
  const take = (edit: Edit) => {
    const queued = expectKind(queue(edit), 'editQueued');
    const recorded = sendAll(queued.syncState);
    assert.ok(recorded, 'the edit was sent');
    return { queued, recorded };
  };
  /** Queues an edit that must be refused, and returns why. */
  const refuse = (edit: Edit) => expectKind(queue(edit), 'refused').refusal;

  expectKind(client.request({ kind: 'answerBeforeCalculating' }), 'syncState');
  expectKind(client.request({ kind: 'receiveServerRevision', revision: 0 }), 'syncState');
  const first = take({ kind: 'addSheet', afterSheet: null, nameStem: 'Sheet' }).queued.placeChanged;
  assert.ok(first);
  const sheetId: SheetId = first.sheetId;
  const second = take({ kind: 'addSheet', afterSheet: sheetId, nameStem: 'Sheet' }).queued.placeChanged;
  assert.ok(second);
  const otherSheetId: SheetId = second.sheetId;

  const layout = expectKind(client.request({ kind: 'readSheetLayout', sheetId }), 'sheetLayout');
  const rows: RowId[] = idsOf(layout.rows);
  const columns: ColumnId[] = idsOf(layout.columns);
  const at = (r: number, c: number): CellAt => ({ r: rows[r]!, c: columns[c]! });
  const enter = (cell: CellAt, text: string): Edit => ({ kind: 'enter', sheetId, cell, entry: { kind: 'text', text } });

  return { client, sheetId, otherSheetId, rows, columns, at, enter, take, refuse };
}

test('a named range is saved by its trimmed name, read with its address, and named by formulas', () => {
  const { client, sheetId, at, enter, take, refuse } = openWorkbook();
  try {
    const saved = take({ kind: 'saveNamedRange', namedRangeId: null, name: ' Prices ', sheetId, address: 'A1:A3' });
    assert.equal(saved.recorded.v, 51);
    const op = saved.recorded.ops[0];
    assert.equal(op?.kind, 'setNamedRanges');

    const read = expectKind(client.request({ kind: 'readNamedRanges' }), 'namedRanges');
    assert.equal(read.namedRanges.length, 1);
    const [range] = read.namedRanges;
    assert.equal(range?.namedRange.name, 'Prices');
    assert.equal(range?.address, 'Sheet1!A1:A3');
    assert.deepEqual(range?.liveCells, { sheetId, cells: { topLeft: at(0, 0), bottomRight: at(2, 0) } });
    const namedRangeId = range!.namedRangeId;

    // Names are compared without regard to case, and must name cells and not be a cell's address.
    assert.equal(refuse({ kind: 'saveNamedRange', namedRangeId: null, name: 'PRICES', sheetId, address: 'B1' }), 'nameOfNamedRangeTaken');
    assert.equal(refuse({ kind: 'saveNamedRange', namedRangeId: null, name: 'Other', sheetId, address: '1+2' }), 'addressOfNamedRangeNamesNoCells');
    assert.equal(refuse({ kind: 'saveNamedRange', namedRangeId: null, name: 'A1', sheetId, address: 'B1' }), 'nameOfNamedRangeNotAllowed');

    take(enter(at(0, 0), '2'));
    take(enter(at(1, 0), '3'));
    take(enter(at(0, 2), '=SUM(prices)'));
    expectKind(client.request({ kind: 'calculate' }), 'syncState');
    const [sum] = expectKind(client.request({ kind: 'readCells', sheetId, cells: [at(0, 2)] }), 'cellsContents').cells;
    assert.equal(sum?.formulaText, '=SUM(Prices)', 'the formula reads the name as it is saved');
    assert.deepEqual(sum?.value, { kind: 'number', value: 5 });
    assert.equal(sum?.input.kind, 'formula');
    if (sum?.input.kind === 'formula') {
      assert.deepEqual(sum.input.formula.references, [{ kind: 'namedRange', namedRangeId }]);
    }
    assert.equal(
      expectKind(client.request({ kind: 'readTextToEdit', sheetId, cell: at(0, 2) }), 'textToEdit').text,
      '=SUM(Prices)',
    );
    const workbook = expectKind(client.request({ kind: 'readWorkbook' }), 'workbookContents');
    assert.deepEqual(workbook.namedRanges?.map((entry) => entry.namedRangeId), [namedRangeId]);

    // Removed, the formula names cells that are gone.
    take({ kind: 'removeNamedRange', namedRangeId });
    expectKind(client.request({ kind: 'calculate' }), 'syncState');
    const [after] = expectKind(client.request({ kind: 'readCells', sheetId, cells: [at(0, 2)] }), 'cellsContents').cells;
    assert.equal(after?.formulaText, '=SUM(#REF!)');
    assert.deepEqual(after?.value, { kind: 'error', value: '#REF!' });
    assert.equal(refuse({ kind: 'removeNamedRange', namedRangeId }), 'unknownNamedRange');
  } finally {
    client.free();
  }
});

test('a sheet is hidden while another stays shown', () => {
  const { client, sheetId, otherSheetId, take, refuse } = openWorkbook();
  try {
    const hidden = take({ kind: 'setSheetSettings', sheetId: otherSheetId, settings: { isHidden: true } });
    assert.equal(hidden.recorded.v, 50);
    assert.equal(hidden.recorded.ops[0]?.kind, 'setSheetSettings');
    assert.equal(refuse({ kind: 'setSheetSettings', sheetId, settings: { isHidden: true } }), 'noShownSheetLeft');
    const workbook = expectKind(client.request({ kind: 'readWorkbook' }), 'workbookContents');
    assert.deepEqual(
      workbook.sheets.map((sheet) => [sheet.name, sheet.isHidden ?? false]),
      [['Sheet1', false], ['Sheet2', true]],
    );
  } finally {
    client.free();
  }
});

test('cells get a default value and limits, refuse values outside them, and go back to their defaults', () => {
  const { client, sheetId, rows, columns, at, enter, take, refuse } = openWorkbook();
  try {
    const [base, first] = rows[4]!.split('.');
    const cells = { sheetId, rows: [{ base: base!, first: Number(first), count: 2 }], oneColumn: columns[1]!, otherColumn: columns[1]! };
    const limits = (minimum: string, maximum: string) => ({ typedIn: at(4, 1), minimum, maximum });

    const set = take({ kind: 'setDefaultValuesAndLimits', cells, defaultValue: { kind: 'typed', text: '5' }, limits: limits('1', '10') });
    assert.equal(set.recorded.v, 54);
    assert.deepEqual(
      expectKind(client.request({ kind: 'readDefaultValueAndLimits', sheetId, cell: at(4, 1) }), 'defaultValueAndLimits'),
      {
        kind: 'defaultValueAndLimits',
        defaultValue: { shown: '5', textToEdit: '5' },
        minimum: { shown: '1', textToEdit: '1' },
        maximum: { shown: '10', textToEdit: '10' },
      },
    );

    assert.equal(refuse({ kind: 'setDefaultValuesAndLimits', cells, defaultValue: { kind: 'typed', text: '50' } }), 'defaultValueOutsideLimits');
    assert.equal(refuse({ kind: 'setDefaultValuesAndLimits', cells, limits: limits('9', '2') }), 'minimumAboveMaximum');
    assert.equal(refuse({ kind: 'setDefaultValuesAndLimits', cells, limits: limits('x', '2') }), 'limitIsNoNumber');
    assert.equal(refuse(enter(at(4, 1), '42')), 'valueOutsideLimits');
    take(enter(at(4, 1), '7'));

    const changed = expectKind(client.request({ kind: 'readCellsChangedFromTheirDefaults', sheetId }), 'cellsChangedFromTheirDefaults');
    assert.deepEqual(
      changed.cells.map(({ address, held, defaultValue }) => ({ address, held, defaultValue })),
      [
        { address: 'B5', held: '7', defaultValue: '5' },
        { address: 'B6', held: '', defaultValue: '5' },
      ],
    );
    take({ kind: 'resetSheetsToDefaultValues', sheetIds: [sheetId] });
    assert.deepEqual(
      expectKind(client.request({ kind: 'readCellsChangedFromTheirDefaults', sheetId }), 'cellsChangedFromTheirDefaults').cells,
      [],
    );

    const workbook = expectKind(client.request({ kind: 'readWorkbook' }), 'workbookContents');
    const formats = workbook.sheets[0]?.cellFormats?.map((entry) => entry.format);
    assert.deepEqual(formats, [{ defaultValue: { kind: 'number', value: 5 }, valueLimits: { minimum: 1, maximum: 10 } }]);
  } finally {
    client.free();
  }
});

test('protected cells take edits only from the people who may edit them', () => {
  const { client, sheetId, at, enter, take, refuse } = openWorkbook();
  try {
    const protection: Protection = {
      protects: { kind: 'range', range: { kind: 'cells', topLeft: at(0, 0), bottomRight: at(1, 1) } },
      editors: [],
    };
    const saved = take({ kind: 'saveProtection', sheetId, protectionId: null, protection });
    assert.equal(saved.recorded.v, 52);
    assert.equal(saved.recorded.ops[0]?.kind, 'setProtections');

    // Until the session is told who is editing, it is the owner's.
    take(enter(at(0, 0), '9'));
    const user = 'u_aaaaaaaaaaaaaaaaaaaaaa';
    expectKind(client.request({ kind: 'receivePerson', person: { kind: 'user', userId: user } }), 'syncState');
    assert.equal(refuse(enter(at(0, 0), '10')), 'cellsProtected');
    take(enter(at(3, 3), '10'));

    const workbook = expectKind(client.request({ kind: 'readWorkbook' }), 'workbookContents');
    const protections = workbook.sheets[0]?.protections ?? [];
    assert.equal(protections.length, 1);
    assert.deepEqual(protections[0]?.protection, protection);
    const protectionId = protections[0]!.protectionId;

    assert.equal(refuse({ kind: 'removeProtection', sheetId, protectionId }), 'protectionNotTheirsToChange');
    assert.equal(refuse({ kind: 'saveProtection', sheetId, protectionId: null, protection }), 'protectionLeavesOutWhoeverSetsIt');
    assert.equal(
      expectKind(client.request({ kind: 'receivePerson', person: { kind: 'user', userId: 'nope' } }), 'refused').refusal,
      'unreadableRequest',
    );

    expectKind(client.request({ kind: 'receivePerson', person: { kind: 'owner' } }), 'syncState');
    take({ kind: 'removeProtection', sheetId, protectionId });
  } finally {
    client.free();
  }
});

test('a sitting with nothing done has nothing to take back', () => {
  const { client } = openWorkbook();
  try {
    const answer = client.request({ kind: 'queueReversalInASitting', opId: 'reverse-1', sitting: 's1', reversal: 'undoOfAll' });
    assert.equal(answer.kind, 'nothingToReverse');
  } finally {
    client.free();
  }
});

test('a connected table is a sheet of its own, with its call, its columns and no rows until fetched', () => {
  const { client, sheetId, take, refuse } = openWorkbook();
  try {
    const call: CallOfAConnectedTable = {
      title: 'Customers',
      connector: 'crm',
      tool: 'list',
      argumentsAsJson: '{}',
      followUp: null,
      transform: { kind: 'code', source: 'return answer' },
    };
    const column = { name: 'Id', from: { kind: 'field' as const, field: 'id', reading: null } };
    const added = take({ kind: 'addConnectedTable', afterSheet: null, name: 'Customers', call, columns: [column] });
    assert.equal(added.recorded.v, 48);
    const tableSheetId = added.queued.placeChanged?.sheetId;
    assert.ok(tableSheetId);

    const read = expectKind(client.request({ kind: 'readConnectedTable', sheetId: tableSheetId }), 'connectedTable');
    assert.equal(read.freshness, 'notFetched');
    assert.deepEqual(read.rows, { kind: 'notFetched' });
    assert.equal(read.references.length, 1);
    assert.equal(read.references[0]?.text, 'Customers[Id]');
    assert.equal(
      expectKind(client.request({ kind: 'readConnectedTable', sheetId }), 'refused').refusal,
      'notAConnectedTable',
    );
    assert.deepEqual(expectKind(client.request({ kind: 'readSnapshotsNotHeld' }), 'snapshotsNotHeld').snapshotIds, []);

    const workbook = expectKind(client.request({ kind: 'readWorkbook' }), 'workbookContents');
    const table = workbook.sheets.find((sheet) => sheet.sheetId === tableSheetId)?.connectedTable;
    assert.deepEqual(table?.call, call);
    assert.deepEqual(table?.columns.map((entry) => entry.column), [column]);
    assert.equal(table?.snapshot, null);

    assert.equal(
      refuse({ kind: 'setCallOfConnectedTable', sheetId: tableSheetId, call: { ...call, argumentsAsJson: '[1]' } }),
      'argumentsNotAJsonObject',
    );
  } finally {
    client.free();
  }
});

test('the newest format version is the one connected tables, named ranges and defaults are written in', () => {
  // 48 connected tables, 50 hidden sheets, 51 named ranges, 52 protections, 54 defaults and limits.
  assert.equal(NEWEST_FORMAT_VERSION, 55);
});
