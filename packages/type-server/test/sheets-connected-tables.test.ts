import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { after, describe, it } from 'node:test';
import { type AgentRequest } from '@open-artifact/runtime/capabilities';
import { engineOf, isObject, type Json, SheetRefusalError, type SheetFrame, tableFileOf } from '@open-artifact/sheets-core';
import { sheetsEngine } from '@open-artifact/wasm-sheets/node';
import { runSheetsCommand } from '../src/sheets/cli.ts';
import { SHEET_DIR, SheetStore, type Viewer } from '../src/sheets/store.ts';

const folders: string[] = [];
const stores: SheetStore[] = [];
after(() => {
  for (const store of stores) store.close();
  for (const folder of folders) fs.rmSync(folder, { recursive: true, force: true });
});

const owner: Viewer = { id: 'owner', name: 'Owner', canEdit: true, isOwner: true };
const editor: Viewer = { id: 'editor', name: 'Editor', canEdit: true, isOwner: false };

const CALL = {
  title: 'All customers',
  connector: 'Shop',
  tool: 'list_customers',
  arguments: { limit: 100 },
  followUp: { tool: 'list_customers', arguments: { limit: 100, cursor: '{{cursor}}' } },
  transform: '({ answer }) => ({ records: JSON.parse(answer.content[0].text).customers })',
};
const COLUMNS = [
  { name: 'Id', field: 'id' },
  { name: 'Name', field: 'name' },
  { name: 'Active', field: 'active' },
];
const RECORDS = [
  { id: 1, name: 'Ann', active: true },
  { id: 2, name: 'Bob', active: false },
  { id: 3, name: 'Ann', active: null },
];

function storeWith(asked: AgentRequest[] = [], options: { agent?: boolean } = {}): { root: string; store: SheetStore } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sheets-tables-'));
  folders.push(root);
  const store = new SheetStore({
    root,
    log: () => {},
    ...(options.agent === false ? {} : { sendToAgent: (request: AgentRequest) => (asked.push(request), true) }),
  });
  stores.push(store);
  return { root, store };
}

/** A Sheet with a Customers table after Sheet1, not fetched yet. */
function withTable(asked: AgentRequest[] = [], options: { agent?: boolean } = {}): { root: string; store: SheetStore; callDigest: string; sheetId: string } {
  const made = storeWith(asked, options);
  const answer = made.store.agentUpdate({ kind: 'applyEdits', base: 0, edits: [{ kind: 'addConnectedTable', name: 'Customers', call: CALL, columns: COLUMNS }] });
  assert.equal(answer.revision, 2);
  const read = made.store.agentRead({ kind: 'readConnectedTable', sheet: 'Customers' });
  assert.equal(typeof read.callDigest, 'string');
  return { ...made, callDigest: read.callDigest as string, sheetId: sheetIdOf(made.store, 'Customers') };
}

/** A sheet's id, from the operation that made it. */
function sheetIdOf(store: SheetStore, name: string): string {
  const page = store.read({ kind: 'load' }, owner);
  assert.equal(page.kind, 'loadPage');
  const made = (page as unknown as { ops: { kind: string; name?: string; sheetId?: string }[] }).ops.find((op) => op.kind === 'insertSheet' && op.name === name);
  assert.ok(made?.sheetId);
  return made.sheetId;
}

function refusalOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    assert.ok(error instanceof SheetRefusalError, String(error));
    return String((error.body.data as { refusal: string }).refusal);
  }
  assert.fail('not refused');
}

describe('tableFileOf', () => {
  it('keeps each field as its distinct values and where each record is in them', () => {
    const file = tableFileOf([{ id: 1, name: 'Ann' }, { id: 2, name: 'Ann', extra: 'x' }, { name: 'Bob' }]);
    assert.deepEqual(file.lines.map((line) => JSON.parse(line)), [
      { table: { version: 1, rowCount: 3, fields: ['id', 'name', 'extra'] } },
      { values: [1, 2, null] },
      { places: [0, 1, 2] },
      { values: ['Ann', 'Bob'] },
      { places: [0, 0, 1] },
      { values: [null, 'x'] },
      { places: [0, 1, 0] },
    ]);
    // Text is counted for each record that holds it: the engine keeps no rows past it.
    assert.equal(file.textInBytes, 10);
    assert.equal(file.isCutOff, false);
  });

  it('reads only a record\'s own fields: one without `constructor` or `toString` has none there', () => {
    const file = tableFileOf([{ constructor: 'a', toString: 'b' }, { other: 1 }]);
    assert.deepEqual(JSON.parse(file.lines[0]!).table.fields, ['constructor', 'toString', 'other']);
    assert.deepEqual(JSON.parse(file.lines[1]!), { values: ['a', null] });
  });

  it('tells text from a number of the same digits', () => {
    const file = tableFileOf([{ v: '1' }, { v: 1 }]);
    assert.deepEqual(JSON.parse(file.lines[1]!), { values: ['1', 1] });
  });

  it('refuses what no cell holds', () => {
    assert.throws(() => tableFileOf({}), { code: 'recordsNotReadable' });
    assert.throws(() => tableFileOf([1]), { code: 'recordsNotReadable' });
    assert.throws(() => tableFileOf([{ v: { a: 1 } }]), { code: 'valueThatNoCellHolds' });
    assert.throws(() => tableFileOf([{ v: [1] }]), { code: 'valueThatNoCellHolds' });
    assert.throws(() => tableFileOf([{ v: Number.NaN }]), { code: 'valueThatNoCellHolds' });
    assert.throws(() => tableFileOf([{ '': 1 }]), { code: 'fieldNotWellNamed' });
    assert.throws(() => tableFileOf([{ v: 'x'.repeat(50_001) }]), { code: 'textTooLongForACell' });
  });
});

describe('connected tables in the store', () => {
  it('makes a table with its call and columns, and reads them back in the same words', () => {
    const { store } = withTable();
    const read = store.agentRead({ kind: 'readConnectedTable', sheet: 'customers' });
    assert.equal(read.sheet, 'Customers');
    assert.deepEqual(read.call, CALL);
    assert.equal(read.freshness, 'notFetched');
    assert.deepEqual(read.rows, { kind: 'notFetched' });
    assert.deepEqual(read.columns, COLUMNS.map((c) => ({ ...c, reference: `Customers[${c.name}]` })));
    assert.equal(read.fetched, null);
    const sheets = store.agentRead({ kind: 'readSheets' });
    assert.equal((sheets.sheets as { name: string; isConnectedTable?: boolean }[]).find((s) => s.name === 'Customers')?.isConnectedTable, true);
  });

  it('changes the call and the columns by name', () => {
    const { store } = withTable();
    store.agentUpdate({
      kind: 'applyEdits',
      base: 2,
      edits: [
        { kind: 'setCallOfConnectedTable', sheet: 'Customers', call: { ...CALL, title: 'Active customers', followUp: null } },
        { kind: 'addColumnToConnectedTable', sheet: 'Customers', after: 'Id', column: { name: 'Email', field: 'email' } },
        { kind: 'changeColumnOfConnectedTable', sheet: 'Customers', column: 'active', to: { name: 'Is active', field: 'active' } },
      ],
    });
    const read = store.agentRead({ kind: 'readConnectedTable', sheet: 'Customers' });
    assert.equal((read.call as { title: string }).title, 'Active customers');
    assert.equal((read.call as { followUp: unknown }).followUp, null);
    assert.deepEqual((read.columns as { name: string }[]).map((c) => c.name), ['Id', 'Email', 'Name', 'Is active']);
  });

  it('refuses a call or a column that is not well formed, and a table edit on a sheet that is none', () => {
    const { store } = withTable();
    const update = (edit: Json) => () => store.agentUpdate({ kind: 'applyEdits', base: 2, edits: [edit] });
    assert.equal(refusalOf(update({ kind: 'addConnectedTable', name: 'More', call: { ...CALL, arguments: '[]' }, columns: COLUMNS })), 'callNotWellFormed');
    assert.equal(refusalOf(update({ kind: 'addConnectedTable', name: 'More', call: CALL, columns: [] })), 'columnNotDescribed');
    assert.equal(refusalOf(update({ kind: 'addConnectedTable', name: 'Customers', call: CALL, columns: COLUMNS })), 'sheetNameTaken');
    assert.equal(refusalOf(update({ kind: 'setCallOfConnectedTable', sheet: 'Sheet1', call: CALL })), 'notAConnectedTable');
    assert.equal(refusalOf(update({ kind: 'changeColumnOfConnectedTable', sheet: 'Customers', column: 'Nope', to: COLUMNS[0]! })), 'unknownColumnName');
    assert.equal(refusalOf(update({ kind: 'addColumnToConnectedTable', sheet: 'Customers', column: { name: 'Id', field: 'other' } })), 'nameOfColumnTaken');
    assert.equal(refusalOf(update({ kind: 'writeCells', sheet: 'Customers', topLeft: 'A2', rows: [[1]] })), 'sheetIsAConnectedTable');
  });

  it("keeps the agent's records as the table's snapshot: its cells, its file for the page, and xlsx", () => {
    const { root, store, callDigest, sheetId } = withTable();
    const frames: SheetFrame[] = [];
    store.open(owner, (frame) => frames.push(frame));
    const answer = store.agentRefresh({ sheet: 'Customers', callDigest, records: RECORDS });
    assert.deepEqual(answer, { revision: 3, sheet: 'Customers', rowCount: 3 });
    const edit = frames.find((f) => f.phase === 'edit');
    assert.ok(edit?.phase === 'edit' && edit.actor.isAgent);
    const op = edit.ops[0] as { kind: string; snapshots: { sheetId: string; snapshot: { snapshotId: string; rowCount: number; callDigest: string } }[] };
    assert.equal(op.kind, 'setSnapshots');
    assert.equal(op.snapshots[0]!.sheetId, sheetId);
    assert.equal(op.snapshots[0]!.snapshot.rowCount, 3);
    assert.equal(op.snapshots[0]!.snapshot.callDigest, callDigest);
    const { snapshotId } = op.snapshots[0]!.snapshot;
    assert.ok(fs.existsSync(path.join(root, SHEET_DIR, 'tables', `${snapshotId}.jsonl.gz`)));

    // A page open at the revision before hears the edit streamed, and reads it (written in a later format, it cannot).
    const page = engineOf(sheetsEngine()).session();
    try {
      const before = store.read({ kind: 'loadAtRevision', revision: 2 }, owner) as unknown as { revision: number; v: number; ops: Json[] };
      assert.equal(page.answer({ kind: 'receiveLoadPage', from: 0, revision: before.revision, v: before.v, ops: before.ops, next: null }).kind, 'syncState');
      const heard = page.answer({ kind: 'receiveStreamedEdit', revision: edit.revision, applied: { node: 'page', v: edit.v, base: edit.base, ops: edit.ops } }) as { fault?: string; confirmedRevision: number };
      assert.equal(heard.fault, undefined);
      assert.equal(heard.confirmedRevision, 3);
    } finally {
      page.free();
    }

    // The agent reads the rows as cells, under the columns' headings.
    const cells = store.agentRead({ kind: 'readCells', sheet: 'Customers', range: 'A1:C4' });
    assert.deepEqual(Object.values(cells.rows as Record<string, Json[]>), [
      ['Id', 'Name', 'Active'],
      [1, 'Ann', true],
      [2, 'Bob', false],
      [3, 'Ann', null],
    ]);
    const read = store.agentRead({ kind: 'readConnectedTable', sheet: 'Customers' });
    assert.equal(read.freshness, 'current');
    assert.deepEqual(read.rows, { kind: 'held', rowCount: 3, fields: ['id', 'name', 'active'] });
    assert.equal((read.fetched as { rowCount: number }).rowCount, 3);

    // The page reads the file in slices, gzip and base64.
    const slice = store.read({ kind: 'loadTableFile', snapshotId, from: 0 }, owner);
    assert.ok(slice.kind === 'tableFile' && !('isGone' in slice));
    const lines = gunzipSync(Buffer.from(slice.bytes, 'base64')).toString('utf8').trimEnd().split('\n');
    assert.deepEqual(JSON.parse(lines[0]!), { table: { version: 1, rowCount: 3, fields: ['id', 'name', 'active'] } });
    assert.equal(slice.byteCount, Buffer.from(slice.bytes, 'base64').length);
    assert.deepEqual(store.read({ kind: 'loadTableFile', snapshotId: 'f'.repeat(32), from: 0 }, owner), { kind: 'tableFile', isGone: true });
    // An id that is no snapshot's is never looked for on disk.
    assert.deepEqual(store.read({ kind: 'loadTableFile', snapshotId: '../x', from: 0 }, owner), { kind: 'tableFile', isGone: true });
    assert.equal(store.read({ kind: 'loadTableFile', snapshotId: 7 as unknown as string, from: 0 }, owner).kind, 'refused');

    // A store opened afresh (another process) reads the rows from the file too.
    const again = new SheetStore({ root, log: () => {} });
    stores.push(again);
    const csv = again.exportFile('csv', { sheet: 'Customers' });
    assert.match(Buffer.from(csv.bytes).toString('utf8'), /Ann/);
  });

  it('reads a table file of many slices back whole', () => {
    const { store, callDigest, sheetId } = withTable();
    const many = Array.from({ length: 20_000 }, (_, i) => ({ id: i, name: `name ${i} ${Math.random()}` }));
    store.agentRefresh({ sheet: 'Customers', callDigest, records: many });
    const workbook = store.read({ kind: 'load' }, owner);
    assert.equal(workbook.kind, 'loadPage');
    const snapshotId = JSON.stringify(workbook).match(new RegExp(`"sheetId":"${sheetId.replace('.', '\\.')}","snapshot":\\{"snapshotId":"([0-9a-f]{32})"`))?.[1];
    assert.ok(snapshotId);
    const parts: Buffer[] = [];
    for (let from = 0; ; ) {
      const slice = store.read({ kind: 'loadTableFile', snapshotId, from }, owner);
      assert.ok(slice.kind === 'tableFile' && !('isGone' in slice));
      parts.push(Buffer.from(slice.bytes, 'base64'));
      from += parts.at(-1)!.length;
      if (from >= slice.byteCount) break;
    }
    assert.ok(parts.length > 1);
    const lines = gunzipSync(Buffer.concat(parts)).toString('utf8').trimEnd().split('\n');
    assert.equal(JSON.parse(lines[0]!).table.rowCount, 20_000);
  });

  it('refuses records for a call that changed, and tells the agent the digest now', () => {
    const { store, callDigest } = withTable();
    store.agentUpdate({ kind: 'applyEdits', base: 2, edits: [{ kind: 'setCallOfConnectedTable', sheet: 'Customers', call: { ...CALL, arguments: { limit: 5 } } }] });
    assert.equal(refusalOf(() => store.agentRefresh({ sheet: 'Customers', callDigest, records: RECORDS })), 'callChanged');
    assert.equal(refusalOf(() => store.agentRefresh({ sheet: 'Sheet1', callDigest, records: RECORDS })), 'notAConnectedTable');
    assert.equal(refusalOf(() => store.agentRefresh({ sheet: 'Customers', callDigest, records: RECORDS, failed: { why: 'toolError' } })), 'unreadableRefresh');
  });

  it("asks the agent for the owner's refresh, and answers at once", async () => {
    const asked: AgentRequest[] = [];
    const { store, callDigest, sheetId } = withTable(asked);
    assert.equal(store.snapshotFor(owner).takesConnectedTables, true);
    assert.equal(store.snapshotFor(editor).takesConnectedTables, undefined);
    assert.deepEqual(await store.refreshConnectedTable({ kind: 'refreshConnectedTable', sheetId, callDigest }, owner), { kind: 'refreshAsked' });
    assert.equal(asked.length, 1);
    assert.deepEqual(asked[0]!.context, { pressed: 'Refresh', sheet: 'Customers', sheetNumber: 2, callDigest });
    // Another press while the agent works on it is turned away; the records end the wait.
    assert.deepEqual(await store.refreshConnectedTable({ kind: 'refreshConnectedTable', sheetId, callDigest }, owner), { kind: 'refused', refusal: 'refreshUnderWay' });
    store.agentRefresh({ sheet: 'Customers', callDigest, records: RECORDS });
    const newDigest = store.agentRead({ kind: 'readConnectedTable', sheet: 'Customers' }).callDigest as string;
    assert.equal(newDigest, callDigest);
    assert.deepEqual(await store.refreshConnectedTable({ kind: 'refreshConnectedTable', sheetId, callDigest }, owner), { kind: 'refreshAsked' });
    assert.equal(asked.length, 2);
  });

  it('asks the agent once when two presses arrive together', async () => {
    const asked: AgentRequest[] = [];
    const { store, callDigest, sheetId } = withTable(asked);
    const press = () => store.refreshConnectedTable({ kind: 'refreshConnectedTable', sheetId, callDigest }, owner);
    const answers = await Promise.all([press(), press()]);
    assert.deepEqual(answers, [{ kind: 'refreshAsked' }, { kind: 'refused', refusal: 'refreshUnderWay' }]);
    assert.equal(asked.length, 1);
  });

  it('turns away a refresh from anyone but the owner, of a call that changed, of a sheet that is no table, or with no agent', async () => {
    const { store, callDigest, sheetId } = withTable();
    const ask = (viewer: Viewer, request: { sheetId: string; callDigest: string }) => store.refreshConnectedTable({ kind: 'refreshConnectedTable', ...request }, viewer);
    assert.deepEqual(await ask(editor, { sheetId, callDigest }), { kind: 'refused', refusal: 'notOwner' });
    assert.deepEqual(await ask(owner, { sheetId, callDigest: 'other' }), { kind: 'refused', refusal: 'callChanged' });
    assert.deepEqual(await ask(owner, { sheetId: 'sht_nope.0', callDigest }), { kind: 'refused', refusal: 'notAConnectedTable' });
    const lone = withTable([], { agent: false });
    assert.equal(lone.store.snapshotFor(owner).takesConnectedTables, undefined);
    assert.deepEqual(await lone.store.refreshConnectedTable({ kind: 'refreshConnectedTable', sheetId: lone.sheetId, callDigest: lone.callDigest }, owner), { kind: 'refused', refusal: 'agentNotListening' });
    const refusing = storeWith();
    const taken = new SheetStore({ root: refusing.root, log: () => {}, sendToAgent: () => false });
    stores.push(taken);
    taken.agentUpdate({ kind: 'applyEdits', base: 0, edits: [{ kind: 'addConnectedTable', name: 'T', call: CALL, columns: COLUMNS }] });
    const digest = taken.agentRead({ kind: 'readConnectedTable', sheet: 'T' }).callDigest as string;
    const id = sheetIdOf(taken, 'T');
    assert.deepEqual(await taken.refreshConnectedTable({ kind: 'refreshConnectedTable', sheetId: id, callDigest: digest }, owner), { kind: 'refused', refusal: 'agentNotListening' });
    // An edit's send with the refresh's kind is not an edit.
    assert.deepEqual(store.send({ kind: 'refreshConnectedTable', sheetId, callDigest }, owner), { kind: 'refused', refusal: 'unreadableEdit' });
  });

  it("tells the owner's pages why a refresh brought no rows, from this process or another", async () => {
    const { root, store, callDigest, sheetId } = withTable();
    const ownerFrames: SheetFrame[] = [];
    const editorFrames: SheetFrame[] = [];
    store.open(owner, (frame) => ownerFrames.push(frame));
    store.open(editor, (frame) => editorFrames.push(frame));
    assert.deepEqual(store.agentRefresh({ sheet: 'Customers', callDigest, failed: { why: 'toolError', toolSaid: 'rate limited' } }), { sheet: 'Customers', told: 'toolError' });
    const told = ownerFrames.filter((f) => f.phase === 'tableRefresh');
    assert.deepEqual(told, [{ phase: 'tableRefresh', sheetId, callDigest, outcome: { state: 'refused', why: 'toolError', toolSaid: 'rate limited' } }]);
    assert.equal(editorFrames.filter((f) => f.phase === 'tableRefresh').length, 0);
    assert.equal(refusalOf(() => store.agentRefresh({ sheet: 'Customers', callDigest, failed: { why: 'whatever' } })), 'unreadableRefresh');

    // The agent's command line runs in another process: the store hears of it as it rescans.
    await runSheetsCommand(root, 'refresh', [JSON.stringify({ sheet: 'Customers', callDigest, failed: { why: 'notConnected' } })]);
    store.rescan();
    assert.deepEqual(
      ownerFrames.filter((f) => f.phase === 'tableRefresh').map((f) => (f.phase === 'tableRefresh' ? f.outcome.why : null)),
      ['toolError', 'notConnected'],
    );
    // A store opened later does not tell old refreshes again.
    const later = new SheetStore({ root, log: () => {} });
    stores.push(later);
    const laterFrames: SheetFrame[] = [];
    later.open(owner, (frame) => laterFrames.push(frame));
    later.rescan();
    assert.equal(laterFrames.filter((f) => f.phase === 'tableRefresh').length, 0);
  });

  it('takes records from the command line, as a file or inline', async () => {
    const { root, store, callDigest } = withTable();
    const file = path.join(root, 'records.json');
    fs.writeFileSync(file, JSON.stringify({ sheet: 'Customers', callDigest, records: RECORDS, isCutOff: true }));
    const answer = (await runSheetsCommand(root, 'refresh', [file])) as Record<string, unknown>;
    assert.deepEqual(answer, { revision: 3, sheet: 'Customers', rowCount: 3, isCutOff: true });
    store.rescan();
    const read = store.agentRead({ kind: 'readConnectedTable', sheet: 'Customers' });
    assert.equal((read.fetched as { isCutOff: boolean }).isCutOff, true);
    const missing = (await runSheetsCommand(root, 'refresh', [JSON.stringify({ sheet: 'Customers', callDigest, records: [{ id: 9 }] })])) as Record<string, unknown>;
    assert.deepEqual(missing.fieldsNoRecordHas, ['name', 'active']);
    await assert.rejects(runSheetsCommand(root, 'refresh', []), { code: 'MISSING_PAYLOAD' });
    assert.ok(isObject(answer));
  });
});
