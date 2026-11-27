import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { after, describe, it } from 'node:test';
import { type Engine, engineOf, isObject, type Json, type JsonObject, type SheetFrame } from '@open-artifact/sheets-core';
import { sheetsEngine } from '@open-artifact/wasm-sheets/node';
import { EARLIER_STOCK_CHART_PROGRAMS, STOCK_CHART_PROGRAMS } from '@open-artifact/sheets-core/stock-charts';
import { runSheetsCommand } from '../src/sheets/cli.ts';
import { EDITS_FILE, readEdits, SHEET_DIR, SheetStore, type Viewer } from '../src/sheets/store.ts';

const folders: string[] = [];
const stores: SheetStore[] = [];
after(() => {
  for (const store of stores) store.close();
  for (const folder of folders) fs.rmSync(folder, { recursive: true, force: true });
});

function folder(): string {
  const made = fs.mkdtempSync(path.join(os.tmpdir(), 'sheets-store-'));
  folders.push(made);
  return made;
}

function storeIn(root: string, title?: string): SheetStore {
  const store = new SheetStore({ root, log: () => {}, ...(title !== undefined ? { title } : {}) });
  stores.push(store);
  return store;
}

const owner: Viewer = { id: 'owner', name: 'Owner', canEdit: true, isOwner: true };
const reader: Viewer = { id: 'reader', name: 'Reader', canEdit: false, isOwner: false };

const BUDGET = [
  ['Item', 'Cost'],
  ['Rent', 1200],
  ['Food', 300],
  ['Total', '=SUM(B2:B3)'],
];

/** A Sheet with a header, two rows and a total. */
function budget(): { root: string; store: SheetStore } {
  const root = folder();
  const store = storeIn(root, 'Budget');
  const answer = store.agentUpdate({ kind: 'applyEdits', base: 0, edits: [{ kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A1', rows: BUDGET }] });
  assert.deepEqual(answer, { revision: 2 });
  return { root, store };
}

function cells(store: SheetStore, range: string, atRevision?: number): Json[][] {
  const read = store.agentRead({ kind: 'readCells', sheet: 'Sheet1', range }, atRevision);
  assert.ok(isObject(read.rows), JSON.stringify(read));
  return Object.values(read.rows as Record<string, Json[]>);
}

/** The text of each part of a zip file whose path matches, by path. */
function zippedTexts(bytes: Uint8Array, matching: RegExp): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const texts = new Map<string, string>();
  for (let at = 0; at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50; ) {
    const [size, nameLength, extraLength] = [view.getUint32(at + 18, true), view.getUint16(at + 26, true), view.getUint16(at + 28, true)];
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extraLength;
    if (matching.test(name)) texts.set(name, new TextDecoder().decode(inflateRawSync(bytes.subarray(start, start + size))));
    at = start + size;
  }
  return texts;
}

/** The ids of Sheet1 and of its cell at (row, column), from the setCells the log holds. */
function idsOf(root: string): { sheetId: string; r: (row: number) => string; c: (column: number) => string; v: number } {
  const { edits } = readEdits(path.join(root, SHEET_DIR));
  const insert = edits[0]!.ops.find((op) => isObject(op) && op.kind === 'insertSheet') as JsonObject;
  const rows = edits[0]!.ops.find((op) => isObject(op) && op.kind === 'insertRows') as JsonObject;
  const columns = edits[0]!.ops.find((op) => isObject(op) && op.kind === 'insertColumns') as JsonObject;
  const rowBase = (rows.rows as JsonObject).base as string;
  const columnBase = (columns.columns as JsonObject).base as string;
  return { sheetId: insert.sheetId as string, r: (row) => `${rowBase}.${row}`, c: (column) => `${columnBase}.${column}`, v: edits.at(-1)!.v };
}

function setCell(root: string, row: number, column: number, value: Json): Json[] {
  const ids = idsOf(root);
  const input = typeof value === 'number' ? { kind: 'number', value } : { kind: 'text', value };
  return [{ kind: 'setCells', sheetId: ids.sheetId, cells: [{ r: ids.r(row), c: ids.c(column), input }] }];
}

describe('SheetStore', () => {
  it('starts a new Sheet: its meta, an empty log, a snapshot and the clock', () => {
    const root = folder();
    const store = storeIn(root, 'Plans');
    const meta = JSON.parse(fs.readFileSync(path.join(root, SHEET_DIR, 'sheet.json'), 'utf8'));
    assert.match(meta.id, /^[0-9a-f-]{36}$/);
    assert.equal(meta.title, 'Plans');
    assert.equal(store.revision, 0);
    assert.equal(store.info().title, 'Plans');
    store.setTitle('Plans for May');
    assert.equal(storeIn(root).info().title, 'Plans for May');

    const frames: SheetFrame[] = [];
    const close = store.open(owner, (frame) => frames.push(frame));
    close();
    assert.deepEqual(frames.map((f) => f.phase), ['snapshot', 'clock']);
    assert.deepEqual(store.read({ kind: 'snapshot' }, owner), frames[0]);
    const page = store.read({ kind: 'load', from: 0 }, owner);
    assert.deepEqual(page, { kind: 'loadPage', from: 0, revision: 0, v: (frames[0] as { newestFormatVersion: number }).newestFormatVersion, ops: [], next: null });
  });

  it('makes the agent\'s update one revision on a new Sheet\'s first sheet, and reads the formulas worked out', () => {
    const { root, store } = budget();
    assert.deepEqual(cells(store, 'A1:B4'), [['Item', 'Cost'], ['Rent', 1200], ['Food', 300], ['Total', { formula: '=SUM(B2:B3)', value: 1500 }]]);
    const { edits } = readEdits(path.join(root, SHEET_DIR));
    assert.deepEqual(edits.map((e) => [e.revision, e.base, e.by]), [[1, 0, 'agent'], [2, 1, 'agent']]);
    // A read at revision 1 is the blank first sheet.
    assert.deepEqual(cells(store, 'A1:B1', 1), []);
    // An update on an old base is refused, as the agent's refusals are worded.
    assert.throws(
      () => store.agentUpdate({ kind: 'applyEdits', base: 1, edits: [{ kind: 'writeCells', sheet: 'Sheet1', topLeft: 'C1', rows: [['x']] }] }),
      (error: { body?: { data?: { refusal?: string } } }) => error.body?.data?.refusal === 'baseIsNotTheRevision',
    );
  });

  it('saves a page\'s edit built on an earlier revision, and refuses one that no longer applies', () => {
    const { root, store } = budget();
    const { v } = idsOf(root);
    const frames: SheetFrame[] = [];
    const close = store.open(owner, (frame) => frames.push(frame));
    // Built on revision 1: the edits since do not stop it.
    assert.deepEqual(store.send({ opId: 'op-1', v, base: 1, ops: setCell(root, 2, 1, 900) }, owner), { kind: 'saved', revision: 3 });
    assert.deepEqual(store.send({ opId: 'op-1', v, base: 1, ops: setCell(root, 2, 1, 900) }, owner), { kind: 'saved', revision: 3 });
    assert.equal(cells(store, 'B3')[0]?.[0], 900);
    const edit = frames.find((f) => f.phase === 'edit');
    assert.ok(edit && edit.phase === 'edit');
    assert.equal(edit.revision, 3);
    assert.equal(edit.actor.isAgent, false);
    close();

    const nowhere: Json[] = [{ kind: 'setCells', sheetId: 'sht_nowhere.0', cells: [{ r: 'row_nowhere.0', c: 'col_nowhere.0', input: { kind: 'text', value: 'x' } }] }];
    assert.deepEqual(store.send({ opId: 'op-2', v, base: 1, ops: nowhere }, owner), { kind: 'refused', refusal: 'changedSince' });
    assert.deepEqual(store.send({ opId: 'op-3', v, base: 3, ops: setCell(root, 0, 2, 'x') }, reader), { kind: 'refused', refusal: 'notWriter' });
    assert.deepEqual(store.send({ opId: 'op-4', v, base: 9, ops: setCell(root, 0, 2, 'x') }, owner), { kind: 'refused', refusal: 'pageIsBehind' });
    assert.equal(store.revision, 3);
  });

  it('picks up a line another process appended, and sends it to the pages', () => {
    const { root, store } = budget();
    const frames: SheetFrame[] = [];
    const close = store.open(owner, (frame) => frames.push(frame));
    const line = { revision: 3, v: idsOf(root).v, base: 2, ops: setCell(root, 2, 1, 50), by: 'agent', at: new Date().toISOString() };
    fs.appendFileSync(path.join(root, SHEET_DIR, EDITS_FILE), `${JSON.stringify(line)}\n`);
    // A torn line (still being written) waits until it is whole.
    fs.appendFileSync(path.join(root, SHEET_DIR, EDITS_FILE), '{"revision": 4, "v"');
    store.rescan();
    close();
    assert.equal(store.revision, 3);
    assert.deepEqual(frames.filter((f) => f.phase === 'edit').map((f) => f.phase === 'edit' && [f.revision, f.actor.isAgent]), [[3, true]]);
    assert.deepEqual(cells(store, 'B3:B4'), [[50], [{ formula: '=SUM(B2:B3)', value: 1250 }]]);
  });

  it('groups edits into versions by their pauses', () => {
    const { root, store } = budget();
    const { v } = idsOf(root);
    store.send({ opId: 'later', v, base: 2, ops: setCell(root, 1, 1, 1300) }, owner);
    const versions = store.read({ kind: 'versions' }, owner);
    assert.ok(versions.kind === 'versions');
    assert.deepEqual(versions.rows.map((r) => [r.firstRevision, r.revision]), [[1, 3]]);

    // The same log with an hour between the agent's edits and the page's.
    const file = path.join(root, SHEET_DIR, EDITS_FILE);
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as JsonObject);
    fs.writeFileSync(file, lines.map((l, i) => `${JSON.stringify(i < 2 ? { ...l, at: hourAgo } : l)}\n`).join(''));
    const again = storeIn(root).read({ kind: 'versions' }, owner);
    assert.ok(again.kind === 'versions');
    assert.deepEqual(again.rows.map((r) => [r.firstRevision, r.revision, r.authors.map((a) => a.isAgent)]), [[3, 3, [false]], [1, 2, [true]]]);
  });

  it('names a version, which then ends where it was named', () => {
    const { root, store } = budget();
    const { v } = idsOf(root);
    assert.deepEqual(store.send({ kind: 'setVersionName', revision: 2, name: '  First\n\tdraft ' }, owner), { kind: 'versionNamed', revision: 2, name: 'First draft' });
    assert.deepEqual(store.send({ opId: 'later', v, base: 2, ops: setCell(root, 1, 1, 1300) }, owner), { kind: 'saved', revision: 3 });
    const versions = store.read({ kind: 'versions' }, owner);
    assert.ok(versions.kind === 'versions');
    assert.deepEqual(versions.rows.map((r) => [r.firstRevision, r.revision, r.name ?? null]), [[3, 3, null], [1, 2, 'First draft']]);
    assert.deepEqual(versions.rows.map((r) => r.firstSeq), [3, 1]);
    const withChanges = store.read({ kind: 'versionsWithChanges' }, owner);
    assert.ok(withChanges.kind === 'versionsWithChanges');
    assert.deepEqual(withChanges.rows.map(({ content: _content, ...row }) => row), versions.rows);
    assert.deepEqual(withChanges.rows[0]?.content, { acts: [{ kind: 'setCells', sheet: 'Sheet1', count: 1 }] });
    assert.ok(withChanges.rows[1]?.content.acts.some((act) => act.kind === 'setCells' && act.sheet === 'Sheet1' && act.count > 1));
    // The next page starts before the first edit of the oldest version listed.
    const older = store.read({ kind: 'versions', before: 3, beforeSeq: 3 }, owner);
    assert.ok(older.kind === 'versions');
    assert.deepEqual(older.rows.map((r) => [r.firstRevision, r.revision, r.firstSeq, r.name ?? null]), [[1, 2, 1, 'First draft']]);
    const olderWithChanges = store.read({ kind: 'versionsWithChanges', beforeSeq: 3 }, owner);
    assert.ok(olderWithChanges.kind === 'versionsWithChanges');
    assert.deepEqual(olderWithChanges.rows.map((r) => r.revision), [2]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, SHEET_DIR, 'version-names.json'), 'utf8')), { 2: 'First draft' });

    // An empty name takes it away; the versions run together again.
    assert.deepEqual(store.send({ kind: 'setVersionName', revision: 2, name: ' ' }, owner), { kind: 'versionNamed', revision: 2, name: null });
    const merged = store.read({ kind: 'versions' }, owner);
    assert.ok(merged.kind === 'versions');
    assert.deepEqual(merged.rows.map((r) => [r.firstRevision, r.revision, r.name ?? null]), [[1, 3, null]]);
  });

  it('refuses version names it cannot keep', () => {
    const { store } = budget();
    const refusal = (request: Parameters<SheetStore['send']>[0], viewer = owner) => {
      const answer = store.send(request, viewer);
      return answer.kind === 'refused' ? answer.refusal : answer.kind;
    };
    assert.equal(refusal({ kind: 'setVersionName', revision: 2, name: 'x' }, reader), 'notWriter');
    assert.equal(refusal({ kind: 'setVersionName', revision: 3, name: 'x' }), 'unknownRevision');
    assert.equal(refusal({ kind: 'setVersionName', revision: 0, name: 'x' }), 'unknownRevision');
    assert.equal(refusal(JSON.parse('{"kind": "setVersionName", "revision": 1, "name": 7}')), 'unreadableVersionName');
    assert.equal(refusal({ kind: 'setVersionName', revision: 1, name: '名'.repeat(101) }), 'versionNameNotAllowed');
    assert.equal(refusal({ kind: 'setVersionName', revision: 1, name: '名'.repeat(100) }), 'versionNamed');
  });

  it('keeps at most a hundred version names, and reads none past the log', () => {
    const { root, store } = budget();
    const { v } = idsOf(root);
    for (let i = 0; i < 100; i++) store.send({ opId: `edit-${i}`, v, base: store.revision, ops: setCell(root, 1, 1, i) }, owner);
    assert.equal(store.revision, 102);
    const file = path.join(root, SHEET_DIR, 'version-names.json');
    fs.writeFileSync(file, JSON.stringify({ ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [String(i + 1), `v${i + 1}`])), 200: 'past the log' }));
    assert.equal(store.versionNames().size, 100);
    assert.equal(store.versionNames().has(200), false);
    // A new name would be the 101st; a name already given may still change.
    assert.deepEqual(store.send({ kind: 'setVersionName', revision: 101, name: 'new' }, owner), { kind: 'refused', refusal: 'tooManyVersionNames' });
    assert.deepEqual(store.send({ kind: 'setVersionName', revision: 1, name: 'changed' }, owner), { kind: 'versionNamed', revision: 1, name: 'changed' });
    const versions = store.read({ kind: 'versions', limit: 200 }, owner);
    assert.ok(versions.kind === 'versions');
    // Each named revision ends a version of its own: 1 to 100 one each, then 101 to 102 together.
    assert.equal(versions.rows.length, 101);
    assert.deepEqual(versions.rows.at(-1), { ...versions.rows.at(-1)!, firstRevision: 1, revision: 1, name: 'changed' });
  });

  it('makes the agent\'s edits as the owner, by the id the owner\'s page has', () => {
    // The engine, with every person a session is told of written down.
    const real = engineOf(sheetsEngine());
    const told: unknown[] = [];
    const engine: Engine = {
      utility: (request) => real.utility(request),
      session() {
        const session = real.session();
        return {
          answer: (request) => {
            if (request.kind === 'receivePerson') told.push(request.person);
            return session.answer(request);
          },
          free: () => session.free(),
        };
      },
    };
    const store = new SheetStore({ root: folder(), engine, ownerId: 'owner-7', log: () => {} });
    stores.push(store);
    store.agentUpdate({ kind: 'applyEdits', base: 0, edits: [{ kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A1', rows: [['x']] }] });
    const ownerPage = store.snapshotFor({ id: 'owner-7', name: 'Owner', canEdit: true, isOwner: true });
    assert.ok(told.length > 0);
    assert.deepEqual(new Set(told.map((person) => JSON.stringify(person))), new Set([JSON.stringify({ kind: 'user', userId: ownerPage.viewer.personId })]));
  });

  it('keeps a protection, a named range and default values, reads them back, and tells a page whether its person owns the Sheet', () => {
    const { store } = budget();
    assert.deepEqual(store.agentUpdate({ kind: 'applyEdits', base: 2, edits: [
      { kind: 'saveProtection', sheet: 'Sheet1', range: 'B2:B3' },
      { kind: 'saveNamedRange', name: 'Costs', sheet: 'Sheet1', range: 'B2:B3' },
      { kind: 'setDefaultValues', sheet: 'Sheet1', range: 'B2', defaultValue: 1000 },
    ] }), { revision: 3 });
    const ownerPage = store.snapshotFor(owner);
    assert.equal(ownerPage.viewer.isOwner, true);
    assert.equal(store.snapshotFor(reader).viewer.isOwner, false);

    const sheets = store.agentRead({ kind: 'readSheets' });
    assert.ok(Array.isArray(sheets.sheets) && isObject(sheets.sheets[0]), JSON.stringify(sheets));
    const protections = sheets.sheets[0].protections;
    assert.ok(Array.isArray(protections) && protections.length === 1 && isObject(protections[0]), JSON.stringify(sheets));
    const { protectionId, ...protection } = protections[0];
    assert.equal(typeof protectionId, 'string');
    // The agent's protection names the owner, the person its edits are made for, as the one who may edit there.
    assert.deepEqual(protection, { protects: 'B2:B3', editors: [ownerPage.viewer.personId] });
    assert.deepEqual(sheets.namedRanges, [{ name: 'Costs', address: 'Sheet1!B2:B3' }]);
    assert.deepEqual(store.agentRead({ kind: 'readNamedRanges' }), { revision: 3, namedRanges: [{ name: 'Costs', address: 'Sheet1!B2:B3' }] });

    // Rent holds 1200, not its default of 1000; Food has no default.
    assert.deepEqual(store.agentRead({ kind: 'readCellsChangedFromTheirDefaults', sheet: 'Sheet1' }), {
      revision: 3,
      sheet: 'Sheet1',
      cells: [{ cell: 'B2', holds: '1200', defaultValue: '1000' }],
    });
    store.agentUpdate({ kind: 'applyEdits', base: 3, edits: [{ kind: 'resetToDefaultValues', sheet: 'Sheet1', range: 'B2' }] });
    assert.deepEqual(cells(store, 'B2:B4'), [[1000], [300], [{ formula: '=SUM(B2:B3)', value: 1300 }]]);
    assert.deepEqual(store.agentRead({ kind: 'readCellsChangedFromTheirDefaults', sheet: 'Sheet1' }), { revision: 4, sheet: 'Sheet1', cells: [] });
  });

  it('answers that a connected table\'s file is gone', () => {
    const { store } = budget();
    assert.deepEqual(store.read({ kind: 'loadTableFile', snapshotId: 'snap', from: 0 }, owner), { kind: 'tableFile', isGone: true });
  });

  it('gives the edits that restore a version, and a cell\'s history', () => {
    const { root, store } = budget();
    const { v, sheetId, r, c } = idsOf(root);
    store.send({ opId: 'change', v, base: 2, ops: setCell(root, 1, 1, 1500) }, owner);
    assert.equal(cells(store, 'B2')[0]?.[0], 1500);

    const restore = store.read({ kind: 'editsThatRestore', revision: 2 }, owner);
    assert.ok(restore.kind === 'editsToTakeBack', JSON.stringify(restore));
    assert.equal(restore.edits.length, 1);
    const back = restore.edits[0]!;
    assert.equal(back.base, 3);
    const saved = store.send({ opId: 'restore', v: typeof back.v === 'number' ? back.v : v, base: 3, ops: back.ops as Json[] }, owner);
    assert.deepEqual(saved, { kind: 'saved', revision: 4 });
    assert.equal(cells(store, 'B2')[0]?.[0], 1200);
    assert.deepEqual(store.read({ kind: 'editsThatRestore', revision: 4 }, owner), { kind: 'editsToTakeBack', revision: 4, edits: [] });

    const history = store.read({ kind: 'cellHistory', sheetId, r: r(1), c: c(1) }, owner);
    assert.ok(history.kind === 'cellHistory', JSON.stringify(history));
    assert.ok(history.rows.length >= 3, JSON.stringify(history.rows));
    assert.deepEqual(history.rows.map((row) => row.revision), [4, 3, 2]);
    assert.equal(history.rows[1]!.actor.isAgent, false);
    assert.equal(history.rows[2]!.actor.isAgent, true);
  });

  it('makes a chart: a widget, then a batch whose addChart names a widget made under a $lid', () => {
    const { store } = budget();
    const code = "export default () => <sheet.Visualize data-component='bars' sources={{rows: {kind: 'ref', ref: 'input/rows', adapter: {kind: 'cells'}}}}>{({rows}) => <svg width='480' height='280' role='img' aria-label='Costs'>{rows.slice(1).map((row, j) => <rect key={j} x={16 + j * 40} y={40} width={20} height={20} />)}</svg>}</sheet.Visualize>;\n";
    const made = store.widget({ verb: 'create', opId: 'w-1', code }, owner);
    assert.ok(made.kind === 'widget', JSON.stringify(made));
    assert.equal(made.widget.pub, 1);
    assert.deepEqual(store.widget({ verb: 'create', opId: 'w-1', code }, owner), made);
    const projection = store.widget({ verb: 'projection', id: made.widget.id }, owner);
    assert.ok(projection.kind === 'projection');
    assert.match(projection.module, /export function init\(sheet, React, hooks, ds\)/);

    const chart = { name: 'Costs', caption: '', widget: '$lid:w', inputs: [{ name: 'rows', cells: { sheet: 'Sheet1', range: 'A1:B3' } }], sheet: 'Sheet1', topLeft: 'D1', widthInPixels: 480, heightInPixels: 280 };
    const answer = store.agentBatch([
      { $lid: 'w', verb: 'create', payload: { code } },
      { verb: 'update', payload: { kind: 'applyEdits', base: 2, edits: [{ kind: 'addChart', chart }] } },
    ]);
    const lids = answer.lids as Record<string, string>;
    assert.ok(typeof lids.w === 'string');
    assert.deepEqual((answer.acks as JsonObject[]).map((ack) => ack.outcome), ['published', 'applied']);
    const charts = store.agentRead({ kind: 'readCharts', sheet: 'Sheet1' });
    assert.equal((charts.charts as JsonObject[]).length, 1);
    assert.deepEqual((charts.charts as JsonObject[])[0]!.chart, { ...chart, widget: lids.w });

    // A widget a chart draws with stays; one no chart uses is deleted.
    assert.equal(store.widget({ verb: 'delete', id: lids.w }, owner).kind, 'refused');
    assert.deepEqual(store.widget({ verb: 'delete', id: made.widget.id }, owner), { kind: 'deleted' });

    // A refused applyEdits takes back the widgets the batch made.
    const before = store.widgets.list().length;
    assert.throws(() => store.agentBatch([
      { $lid: 'x', verb: 'create', payload: { code } },
      { verb: 'update', payload: { kind: 'applyEdits', base: 1, edits: [{ kind: 'addChart', chart: { ...chart, widget: '$lid:x' } }] } },
    ]), (error: { body?: { data?: { refusal?: string; committed?: boolean } } }) => error.body?.data?.refusal === 'baseIsNotTheRevision' && error.body.data.committed === false);
    assert.equal(store.widgets.list().length, before);
  });

  it('answers a new Sheet\'s reads, widgets and imports before any edit', async () => {
    const store = storeIn(folder());
    assert.deepEqual(store.agentWidget({ action: 'list' }), { widgets: [] });
    assert.deepEqual(store.read({ kind: 'xlsxCharts', charts: [] }, owner), { kind: 'xlsxCharts', descriptions: [] });
    assert.deepEqual(store.read({ kind: 'versions' }, owner), { kind: 'versions', rows: [] });
    assert.equal(new TextDecoder().decode(store.exportFile('csv').bytes), '');
    assert.throws(() => store.exportFile('xlsx'), (error: { body?: { data?: { refusal?: string } } }) => error.body?.data?.refusal === 'noSheetToWrite');
    await assert.rejects(store.importFile('notes.xlsx', new Uint8Array([1, 2, 3])), (error: { body?: { data?: { refusal?: string } } }) => error.body?.data?.refusal === 'notAnXlsxFile');
    assert.equal(store.revision, 0);
  });

  it('writes the stock area, horizontal bar and 100% stacked bar charts into the .xlsx file, and leaves a scatter out', () => {
    const store = storeIn(folder(), 'Kinds');
    const rows = [['Month', 'Online', 'Stores'], ['Jan', 120, 80], ['Feb', 150, 95], ['Mar', 170, 90]];
    const points = [['Price', 'Sold'], [10, 300], [12, 260], [15, 210]];
    assert.deepEqual(store.agentUpdate({ kind: 'applyEdits', base: 0, edits: [
      { kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A1', rows },
      { kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A10', rows: points },
    ] }), { revision: 2 });
    const add = (kind: 'area' | 'horizontalBar' | 'stackedBar100' | 'scatter', range: string, topLeft: string, base: number) => {
      const chart = { name: kind, caption: '', widget: `$lid:${kind}`, inputs: [{ name: 'rows', cells: { sheet: 'Sheet1', range } }], sheet: 'Sheet1', topLeft, widthInPixels: 480, heightInPixels: 280 };
      const answer = store.agentBatch([
        { $lid: kind, verb: 'create', payload: { code: STOCK_CHART_PROGRAMS[kind] } },
        { verb: 'update', payload: { kind: 'applyEdits', base, edits: [{ kind: 'addChart', chart }] } },
      ]);
      assert.deepEqual((answer.acks as JsonObject[]).map((ack) => ack.outcome), ['published', 'applied'], kind);
    };
    const charts = [['area', 'A1:C4', 'E1'], ['horizontalBar', 'A1:C4', 'E20'], ['stackedBar100', 'A1:C4', 'E40']] as const;
    charts.forEach(([kind, range, topLeft], k) => add(kind, range, topLeft, 2 + k));
    const xlsx = store.exportFile('xlsx');
    assert.equal(xlsx.notCarriedOver.some((what) => /charts aren’t included/.test(what)), false, JSON.stringify(xlsx.notCarriedOver));
    const written = [...zippedTexts(xlsx.bytes, /^xl\/charts\/chart\d+\.xml$/).values()].join('\n');
    assert.match(written, /<c:areaChart>/);
    assert.match(written, /<c:barDir val="bar"\/>/);
    assert.match(written, /<c:grouping val="percentStacked"\/>/);
    add('scatter', 'A10:B13', 'E60', 5);
    const withScatter = store.exportFile('xlsx');
    assert.equal(withScatter.notCarriedOver.some((what) => /charts aren’t included/.test(what)), true, JSON.stringify(withScatter.notCarriedOver));
    assert.doesNotMatch([...zippedTexts(withScatter.bytes, /^xl\/charts\/chart\d+\.xml$/).values()].join('\n'), /<c:scatterChart>/);
  });

  it('still writes the charts of the earlier area, horizontal bar and scatter programs into the .xlsx file', () => {
    const store = storeIn(folder(), 'Earlier');
    const rows = [['Month', 'Online', 'Stores'], ['Jan', 120, 80], ['Feb', 150, 95], ['Mar', 170, 90]];
    const points = [['Price', 'Sold'], [10, 300], [12, 260], [15, 210]];
    assert.deepEqual(store.agentUpdate({ kind: 'applyEdits', base: 0, edits: [
      { kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A1', rows },
      { kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A10', rows: points },
    ] }), { revision: 2 });
    const charts = [['area', 'A1:C4', 'E1'], ['horizontalBar', 'A1:C4', 'E20'], ['scatter', 'A10:B13', 'E40']] as const;
    charts.forEach(([kind, range, topLeft], k) => {
      const [code] = EARLIER_STOCK_CHART_PROGRAMS[kind] ?? [];
      assert.ok(code, kind);
      const chart = { name: kind, caption: '', widget: `$lid:${kind}`, inputs: [{ name: 'rows', cells: { sheet: 'Sheet1', range } }], sheet: 'Sheet1', topLeft, widthInPixels: 480, heightInPixels: 280 };
      const answer = store.agentBatch([
        { $lid: kind, verb: 'create', payload: { code } },
        { verb: 'update', payload: { kind: 'applyEdits', base: 2 + k, edits: [{ kind: 'addChart', chart }] } },
      ]);
      assert.deepEqual((answer.acks as JsonObject[]).map((ack) => ack.outcome), ['published', 'applied'], kind);
    });
    const xlsx = store.exportFile('xlsx');
    assert.equal(xlsx.notCarriedOver.some((what) => /charts aren’t included/.test(what)), false, JSON.stringify(xlsx.notCarriedOver));
    const written = [...zippedTexts(xlsx.bytes, /^xl\/charts\/chart\d+\.xml$/).values()].join('\n');
    assert.match(written, /<c:areaChart>/);
    assert.match(written, /<c:barDir val="bar"\/>/);
    assert.match(written, /<c:scatterChart>/);
  });

  it('exports the workbook as an .xlsx file and a sheet as CSV', async () => {
    const { root, store } = budget();
    const xlsx = store.exportFile('xlsx');
    assert.equal(xlsx.filename, 'Budget.xlsx');
    assert.deepEqual([...xlsx.bytes.slice(0, 2)], [0x50, 0x4b]);
    const csv = store.exportFile('csv');
    assert.equal(new TextDecoder().decode(csv.bytes), 'Item,Cost\r\nRent,1200\r\nFood,300\r\nTotal,1500\r\n');

    // The same through the commands, into the folder's exports/.
    const exported = (await runSheetsCommand(root, 'export', [])) as JsonObject;
    assert.equal(exported.file, path.join(root, 'exports', 'Budget.xlsx'));
    assert.equal(fs.readFileSync(exported.file as string).subarray(0, 2).toString(), 'PK');
    const info = (await runSheetsCommand(root, 'info', [])) as JsonObject;
    assert.equal(info.revision, 2);

    // An .xlsx file chosen with Import from Excel is kept for the agent, which gets a request naming it.
    const asked: string[] = [];
    const importing = new SheetStore({ root, log: () => {}, sendToAgent: (request) => asked.push(request.text) > 0 });
    stores.push(importing);
    assert.deepEqual(await importing.importFile('Costs.xlsx', xlsx.bytes), { path: 'sheet/imports/Costs.xlsx', sentToAgent: true });
    assert.deepEqual((await importing.importFile('Costs.xlsx', xlsx.bytes)).path, 'sheet/imports/Costs-2.xlsx');
    const refused = new SheetStore({ root, log: () => {}, sendToAgent: async () => false });
    stores.push(refused);
    const reply = await refused.importFile('Costs.xlsx', xlsx.bytes);
    assert.equal(reply.sentToAgent, false);
    assert.equal(fs.existsSync(path.join(root, reply.path)), false);
    assert.equal(fs.existsSync(path.join(root, 'sheet/imports/Costs-2.xlsx')), true);
    assert.match(asked[0]!, /Import this Excel file into the Sheet, as new sheets: sheet\/imports\/Costs.xlsx/);
  });
});

describe('runSheetsCommand', () => {
  it('starts a Sheet with an update, reads it, and words a refusal', async () => {
    const root = folder();
    await assert.rejects(runSheetsCommand(root, 'read', []), /has no sheet\/sheet.json/);
    await assert.rejects(runSheetsCommand(root, 'widget', ['list']), /has no sheet\/sheet.json/);
    await assert.rejects(runSheetsCommand(root, 'widget', ['read']), /Give the widget's id/);
    assert.equal(fs.existsSync(path.join(root, SHEET_DIR)), false);
    assert.deepEqual(await runSheetsCommand(root, 'update', [JSON.stringify({ base: 0, edits: [{ kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A1', rows: BUDGET }] })]), { revision: 2 });
    const read = (await runSheetsCommand(root, 'read', [JSON.stringify({ kind: 'readCells', sheet: 'Sheet1', range: 'B4' })])) as JsonObject;
    assert.deepEqual(Object.values(read.rows as JsonObject), [[{ formula: '=SUM(B2:B3)', value: 1500 }]]);
    await assert.rejects(
      runSheetsCommand(root, 'update', [JSON.stringify({ base: 2, edits: [{ kind: 'writeCells', sheet: 'Nowhere', topLeft: 'A1', rows: [['x']] }] })]),
      (error: { body?: { data?: { refusal?: string } } }) => error.body?.data?.refusal === 'unknownSheetName',
    );
    const listed = (await runSheetsCommand(root, 'widget', ['list'])) as JsonObject;
    assert.deepEqual(listed.widgets, []);
  });
});
