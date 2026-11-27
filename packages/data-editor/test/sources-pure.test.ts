import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Dataset, DatasetRun, Table } from '@open-artifact/data-core';
import { getCertificationWords } from '../src/sources/certified.ts';
import { describeCalculationArguments, getFunctionParameterNames, splitCalculationCodeArguments } from '../src/sources/calc-args.ts';
import {
  datasetWithEditedArgs,
  getQueryArgumentViews,
  getRestorableArgumentValues,
  jsonArgumentsEqual,
  parseEditedArgument,
} from '../src/sources/args.ts';
import {
  DATA_FILE_FORMAT_LABELS,
  MAX_EDITABLE_FILE_BYTES,
  describeFileNote,
  findLostColumns,
  isEditableFile,
  parseEditedFileText,
  readDataFileText,
} from '../src/sources/files.ts';
import {
  appendLocalRunHistory,
  getSourceBackLabel,
  getSourceConnectionAction,
  getSourceFailureLabel,
  getSourceRowAccessibleLabel,
  getSourceRowCaption,
  getSettledRun,
  getSourceRowStatus,
  getUnavailableConnectors,
  groupSourcesByConnector,
  hasRefreshAction,
  isDatasetLoading,
  isLiveQueryFailure,
  pushSourceTrail,
  readLocalRunHistory,
} from '../src/sources/grouping.ts';
import {
  MAX_QUERY_HISTORY_BYTES,
  QUERY_HISTORY_RETENTION_MS,
  appendQueryHistoryEntries,
  describeHistoryArgumentDifference,
  diffTextLines,
  escapedJsonByteSize,
  formatQueryHistoryTime,
  isHistoryEntryRestorable,
  isHistoryEntrySameFormat,
  parseQueryHistory,
  queryHistoryDocument,
  queryHistoryEntryTitle,
  toQueryHistoryItems,
  trimQueryHistory,
} from '../src/sources/history.ts';
import { getUpdatesChoices, splitUpdatesMinutes, updatesLabel } from '../src/sources/refresh.ts';
import {
  copyableResultText,
  createCsvDownload,
  describeTableResult,
  formatResultFileSize,
  getNumericColumns,
  getResultHighlightTarget,
  getShownDatasetResult,
} from '../src/sources/result.ts';
import {
  formatCodeForDisplay,
  formatSqlLayout,
  getHighlightedPieces,
  getPlacedParameterNames,
  highlightParameterPlaceholders,
  splitCodePiecesByLengths,
  tokenizeHighlightedCode,
} from '../src/sources/sql.ts';

class MemoryStorage implements Storage {
  readonly items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);

function query(id: string, connector: string, args: Record<string, unknown> = { sql: 'select 1' }, extra: Partial<Dataset> = {}): Dataset {
  return {
    id,
    title: id,
    description: '',
    source: { kind: 'query', connector, tool: 'run_sql', args: JSON.stringify(args) },
    updated: null,
    schedule: '',
    staleAfterHours: null,
    ...extra,
  } as unknown as Dataset;
}

function file(id: string): Dataset {
  return {
    id,
    title: id,
    description: '',
    source: { kind: 'file', url: '/_blob/0123456789abcdef0123456789abcdef', name: `${id}.csv`, format: 'csv' },
    updated: { at: NOW - 3_600_000, by: 'Ada' },
    schedule: '',
    staleAfterHours: null,
  } as unknown as Dataset;
}

function calc(id: string): Dataset {
  return {
    id,
    title: id,
    description: '',
    source: { kind: 'calc', inputs: ['a'], description: '', status: 'ok', result: 3, error: null, at: NOW },
    updated: null,
    schedule: '',
    staleAfterHours: null,
  } as unknown as Dataset;
}

const table: Table = { columns: ['name', 'amount'], rows: [{ name: '=cmd()', amount: 3 }, { name: 'a,"b"', amount: '4' }] };
const ok: DatasetRun = { status: 'ok', at: NOW - 300_000, table } as DatasetRun;
const idle: DatasetRun = { status: 'idle' } as DatasetRun;
const failed: DatasetRun = { status: 'failed', at: NOW, message: 'boom' } as DatasetRun;
const reauth: DatasetRun = { status: 'reauth', at: NOW, message: 'Reconnect' } as DatasetRun;

describe('result rows', () => {
  it('downloads rows as CSV named after the source, cells safe from spreadsheet formulas', () => {
    const download = createCsvDownload('sales', table);
    assert.equal(download.filename, 'sales.csv');
    const csv = download.text();
    assert.match(csv, /^﻿name,amount/);
    assert.ok(!csv.includes('\n=cmd()'), 'a formula cell is neutralised');
    assert.ok(csv.includes('"a,""b"""'), 'commas and quotes are escaped');
  });

  it('leaves the byte order mark off a CSV whose first cell is quoted', () => {
    const csv = createCsvDownload('pairs', { columns: ['a,b'], rows: [{ 'a,b': 1 }] } as Table).text();
    assert.match(csv, /^"a,b"/);
  });

  it('copies rows as TSV', () => {
    const text = copyableResultText(table);
    assert.equal(text.split('\n')[0], 'name\tamount');
    assert.equal(copyableResultText(null, 'plain'), 'plain');
  });

  it('describes rows and sizes', () => {
    assert.equal(describeTableResult(table), '2 rows');
    assert.equal(formatResultFileSize(512), '512 B');
    assert.equal(formatResultFileSize(12 * 1024), '12 KB');
    assert.equal(formatResultFileSize(1_572_864), '1.5 MB');
  });

  it('aligns numeric columns', () => {
    assert.deepEqual([...getNumericColumns(table)], ['amount']);
  });

  it('shows the last good rows and rings a picked cell', () => {
    const shown = getShownDatasetResult(query('q', 'pg'), ok);
    assert.ok(shown !== null && shown.table === table);
    assert.deepEqual(getResultHighlightTarget(shown, { row: 1, field: 'amount' }), { row: 1, field: 'amount' });
    assert.equal(getResultHighlightTarget(shown, { row: 9 }), 'body');
    assert.equal(getShownDatasetResult(query('q', 'pg'), idle), null);
  });
});

describe('source groups', () => {
  it('groups queries by connector, then files, the rest and calculations', () => {
    const groups = groupSourcesByConnector([query('a', 'pg'), file('f'), query('b', 'bq'), calc('c'), query('d', 'pg'), query('e', '')]);
    assert.deepEqual(
      groups.connectors.map((group) => [group.connector, group.rows.map((row) => row.id)]),
      [
        ['pg', ['a', 'd']],
        ['bq', ['b']],
      ],
    );
    assert.deepEqual(groups.files.map((row) => row.id), ['f']);
    assert.deepEqual(groups.rest.map((row) => row.id), ['e']);
    assert.deepEqual(groups.calcs.map((row) => row.id), ['c']);
  });

  it('keeps a trail of sources opened from one another', () => {
    assert.deepEqual(pushSourceTrail(['a', 'b'], 'c'), ['a', 'b', 'c']);
    assert.deepEqual(pushSourceTrail(['a', 'b', 'c'], 'a'), ['a']);
    assert.equal(getSourceBackLabel(['a'], (id) => id), 'Back to Sources');
    assert.equal(getSourceBackLabel(['a', 'b'], (id) => id.toUpperCase()), 'Back to A');
  });
});

describe('row status', () => {
  it('marks loading, connection fixes, failures and nothing', () => {
    assert.deepEqual(getSourceRowStatus(query('q', 'pg'), idle, NOW, true), { kind: 'loading' });
    assert.equal(getSourceRowStatus(query('q', 'pg'), reauth, NOW, false)?.kind, 'warn');
    assert.equal(getSourceRowStatus(query('q', 'pg'), failed, NOW, false)?.kind, 'problem');
    assert.equal(getSourceRowStatus(query('q', 'pg'), ok, NOW, false), null);
  });

  it('counts a query or file not yet loaded as loading, unless nothing asked for it', () => {
    assert.equal(isDatasetLoading(query('q', 'pg'), idle), true);
    assert.equal(isDatasetLoading(query('q', 'pg'), idle, true), false);
    assert.equal(isDatasetLoading(calc('c'), idle), false);
  });

  it('labels failures and offers Retry for a failed query or file', () => {
    assert.equal(getSourceFailureLabel(calc('c')), 'Didn’t run');
    assert.equal(getSourceFailureLabel(query('q', 'pg')), 'Didn’t load');
    assert.equal(isLiveQueryFailure(query('q', 'pg'), failed), true);
    assert.equal(isLiveQueryFailure(query('q', 'pg'), reauth), false);
    assert.equal(isLiveQueryFailure(file('f'), failed), true);
  });

  it('captions a row with its connector and age', () => {
    assert.equal(getSourceRowCaption(query('q', 'pg'), ok, NOW, null), 'pg · 5m ago');
    assert.match(getSourceRowAccessibleLabel('Sales', query('q', 'pg'), ok, NOW, null), /^Sales, pg · 5 minutes ago$/);
  });

  it('says when a failed query last loaded in this browser', () => {
    const storage = new MemoryStorage();
    appendLocalRunHistory('q', { at: NOW - 120_000, ok: true }, storage);
    appendLocalRunHistory('q', { at: NOW - 120_000, ok: true }, storage);
    appendLocalRunHistory('q', { at: NOW, ok: false }, storage);
    assert.equal(readLocalRunHistory('q', storage).length, 2);
    assert.match(getSourceRowAccessibleLabel('Sales', query('q', 'pg'), failed, NOW, storage), /last loaded 2 minutes ago$/);
  });

  it('offers a connector’s fix to its waiting queries', () => {
    const datasets = [query('a', 'pg'), query('b', 'pg')];
    const runs: Record<string, DatasetRun> = { a: reauth, b: idle };
    const down = getUnavailableConnectors(datasets, (id) => runs[id] ?? idle);
    assert.equal(down.get('pg'), 'reconnect');
    assert.deepEqual(getSourceConnectionAction(query('b', 'pg'), idle, down), { connector: 'pg', fix: 'reconnect' });
    assert.equal(getSourceConnectionAction(query('b', 'pg'), ok, down), null);
  });

  it('offers Refresh after a failure, or for a query alone', () => {
    assert.equal(hasRefreshAction(query('q', 'pg'), failed), true);
    assert.equal(hasRefreshAction(query('q', 'pg'), ok), false);
    assert.equal(hasRefreshAction(query('q', 'pg'), ok, true), true);
    assert.equal(hasRefreshAction(calc('c'), failed, true), false);
  });
});

describe('query history', () => {
  const day = 86_400_000;

  it('keeps 90 days, oldest first, and drops the oldest past the size limit', () => {
    const entries = [
      { at: NOW - QUERY_HISTORY_RETENTION_MS - 1, args: '{}' },
      { at: NOW - day, args: '{"a":1}' },
      { at: NOW - 2 * day, args: '{"a":2}' },
    ];
    assert.deepEqual(
      trimQueryHistory(entries, NOW).map((entry) => entry.at),
      [NOW - 2 * day, NOW - day],
    );
    const big = 'x'.repeat(MAX_QUERY_HISTORY_BYTES / 2);
    const large = [1, 2, 3].map((n) => ({ at: NOW - n, args: JSON.stringify({ big }) }));
    const kept = trimQueryHistory(large, NOW);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.at, NOW - 1);
  });

  it('counts the escapes a store adds', () => {
    assert.equal(escapedJsonByteSize('<'), 3 + 5);
  });

  it('parses the stored document and skips bad entries', () => {
    const parsed = parseQueryHistory({ entries: [{ at: NOW - 1, args: '{"a":1}', call: true }, { at: 'x', args: '{}' }, { at: NOW - 2, args: 'nope' }] }, NOW);
    assert.deepEqual(parsed, [{ at: NOW - 1, args: '{"a":1}', call: true }]);
    assert.deepEqual(parseQueryHistory(null, NOW), []);
  });

  it('appends versions after the last, skipping repeats', () => {
    const stored = [{ at: NOW - 10, args: '{"a":1,"b":2}' }];
    assert.equal(appendQueryHistoryEntries(stored, [{ at: NOW - 20, args: '{"b":2,"a":1}' }]), null);
    const next = appendQueryHistoryEntries(stored, [
      { at: NOW - 20, args: '{"b":2,"a":1}' },
      { at: NOW - 30, args: '{"a":3}' },
    ]);
    assert.deepEqual(next?.map((entry) => entry.at), [NOW - 10, NOW - 9]);
    assert.deepEqual(queryHistoryDocument(next ?? [], NOW).entries.map((entry) => entry.args), ['{"a":3}', '{"a":1,"b":2}']);
  });

  it('lists newest first, the oldest as the original query', () => {
    const items = toQueryHistoryItems([
      { at: 1, args: '{}' },
      { at: 2, args: '{}' },
    ]);
    assert.deepEqual(items.map((item) => item.id), ['e1', 'e0']);
    assert.equal(queryHistoryEntryTitle('e0', 'e0'), 'Original query');
    assert.equal(queryHistoryEntryTitle('e1', 'e0'), 'You edited the query');
  });

  it('restores only into a query written the same way and when something differs', () => {
    const source = query('q', 'pg', { sql: 'select 2', region: '{{region}}' }).source;
    assert.equal(source.kind, 'query');
    if (source.kind !== 'query') return;
    const item = { id: 'e0', at: 1, entry: { at: 1, args: '{"sql":"select 1","region":"EU"}' } };
    assert.equal(isHistoryEntrySameFormat(item, source), true);
    assert.equal(isHistoryEntrySameFormat({ ...item, entry: { ...item.entry, call: true } }, source), false);
    assert.equal(isHistoryEntryRestorable(item, source), true);
    assert.equal(isHistoryEntryRestorable({ ...item, entry: { at: 1, args: '{"sql":"select 2"}' } }, source), false);
  });

  it('formats times as today, yesterday or a date', () => {
    const now = new Date(2026, 10, 17, 15, 0).getTime();
    assert.match(formatQueryHistoryTime(new Date(2026, 10, 17, 9, 5).getTime(), now), /^9:05\sAM$/);
    assert.match(formatQueryHistoryTime(new Date(2026, 10, 16, 9, 5).getTime(), now), /^Yesterday 9:05\sAM$/);
    assert.equal(formatQueryHistoryTime(new Date(2026, 10, 3, 9, 5).getTime(), now), 'Nov 3');
  });

  it('diffs lines and says how an argument differs', () => {
    assert.deepEqual(diffTextLines('a\nb\nc', 'a\nx\nc'), [
      { mark: '', text: 'a' },
      { mark: '−', text: 'b' },
      { mark: '+', text: 'x' },
      { mark: '', text: 'c' },
    ]);
    const view = { name: 'sql', text: 'a\nb', isText: true, long: true, param: null, lang: 'sql' };
    assert.equal(describeHistoryArgumentDifference(view), 'Not in the query now');
    assert.equal(describeHistoryArgumentDifference(view, view), '');
    assert.equal(describeHistoryArgumentDifference(view, { ...view, text: '{{region}}', param: 'region' }), 'Now set by the page: region');
    assert.equal(describeHistoryArgumentDifference({ ...view, text: '{{r}}', param: 'r' }, view), 'Now typed in the query');
    assert.equal(describeHistoryArgumentDifference({ ...view, long: false }, { ...view, text: 'x', long: false }), 'Now x');
    assert.equal(describeHistoryArgumentDifference(view, { ...view, text: 'a\nc\nd' }), '2 lines differ from the query now');
    assert.equal(describeHistoryArgumentDifference(view, { ...view, text: 'a\nc' }), '1 line differs from the query now');
  });
});

describe('query arguments', () => {
  it('shows each argument with its language, length and filter', () => {
    const dataset = query('q', 'pg', { sql: 'select 1', region: '{{region}}', limit: 5, filter: { a: 1 } });
    const source = dataset.source;
    if (source.kind !== 'query') throw new Error('not a query');
    const views = getQueryArgumentViews(source, { region: 'text' });
    const byName = Object.fromEntries(views.map((view) => [view.name, view]));
    assert.equal(byName.region?.param, 'region');
    assert.equal(byName.limit?.lang, 'json');
    assert.equal(byName.limit?.text, '5');
    assert.equal(byName.filter?.long, true);
    assert.equal(byName.region?.lang, 'text');
  });

  it('parses typed arguments: text as it is, anything else as JSON', () => {
    assert.deepEqual(parseEditedArgument('x', 'select 2'), { value: 'select 2' });
    assert.deepEqual(parseEditedArgument(5, '6'), { value: 6 });
    const bad = parseEditedArgument(5, '{');
    assert.ok('invalid' in bad && bad.invalid.startsWith('Not valid JSON: '));
  });

  it('compares JSON arguments in any key order', () => {
    assert.equal(jsonArgumentsEqual('{"a":1,"b":2}', '{"b":2,"a":1}'), true);
    assert.equal(jsonArgumentsEqual('{"a":1}', 'nope'), false);
  });

  it('restores only arguments the query still has and no filter sets', () => {
    assert.deepEqual(getRestorableArgumentValues('{"sql":"select 1","region":"EU","gone":1}', { sql: 'select 2', region: '{{region}}' }), {
      sql: 'select 1',
    });
    assert.equal(getRestorableArgumentValues('{"sql":"select 2"}', { sql: 'select 2' }), null);
  });

  it('fills the page’s filters, or says which one nothing sets', () => {
    const dataset = query('q', 'pg', { sql: 'select 1' });
    assert.equal(datasetWithEditedArgs(dataset, { sql: 'select {{missing}}' }, {}), 'Nothing in this artifact sets {{missing}}.');
    const edited = datasetWithEditedArgs(dataset, { sql: 'select 2' }, {});
    assert.ok(typeof edited !== 'string' && edited.source.kind === 'query');
    assert.equal(datasetWithEditedArgs(file('f'), {}, {}), 'Only a query’s arguments can be edited.');
  });
});

describe('file editor checks', () => {
  it('reads UTF-8 and refuses anything else', async () => {
    assert.deepEqual(await readDataFileText(new Blob(['a,b\n1,2'])), { text: 'a,b\n1,2' });
    assert.deepEqual(await readDataFileText(new Blob([new Uint8Array([0xff, 0xfe, 0x41])])), { problem: 'notUtf8' });
  });

  it('parses the edited text, or says it has no rows', () => {
    const parsed = parseEditedFileText('a,b\n1,2', 'csv', false);
    assert.ok('table' in parsed && parsed.table.columns.join() === 'a,b');
    assert.ok('problem' in parseEditedFileText('', 'json', false));
    const loaded = parseEditedFileText('anything', 'text', true);
    assert.ok('table' in loaded && loaded.table.rows.length === 0);
  });

  it('finds the columns a replacement loses', () => {
    const table2: Table = { columns: ['a'], rows: [{ a: 1 }] };
    assert.deepEqual(findLostColumns({ text: 'a,b,c\n1,2,3', format: 'csv' }, table2), ['b', 'c']);
  });

  it('notes the file and whether it can be edited', () => {
    assert.equal(DATA_FILE_FORMAT_LABELS.tsv, 'TSV');
    assert.equal(describeFileNote('sales.csv', 'csv', 2048, true), 'sales.csv · CSV · 2 KB · not saved');
    assert.equal(describeFileNote('sales.csv', 'csv', null, false), 'sales.csv · CSV');
    assert.equal(isEditableFile({ bytes: MAX_EDITABLE_FILE_BYTES }), true);
    assert.equal(isEditableFile({ bytes: MAX_EDITABLE_FILE_BYTES + 1 }), false);
    assert.equal(isEditableFile(null), false);
  });
});

describe('refresh data', () => {
  it('labels presets and custom intervals', () => {
    assert.equal(updatesLabel('viewed'), 'On each visit');
    assert.equal(updatesLabel('hour'), 'After an hour');
    assert.deepEqual(splitUpdatesMinutes(2880), { n: 2, unit: 'day' });
    assert.equal(updatesLabel(2880), 'After 2 days');
    assert.equal(updatesLabel(120), 'After 2 hours');
    assert.equal(updatesLabel(1), 'After 1 minute');
    assert.equal(updatesLabel(90), 'After 90 minutes');
  });

  it('puts a custom interval in its place among the presets', () => {
    assert.deepEqual(getUpdatesChoices('day'), ['viewed', '5min', 'hour', 'day', 'week']);
    assert.deepEqual(getUpdatesChoices(120), ['viewed', '5min', 'hour', 120, 'day', 'week']);
  });
});

describe('code', () => {
  it('lays SQL out one clause per line', () => {
    assert.equal(formatSqlLayout('select a, b from t where a = 1 limit 5'), 'select\n  a,\n  b\nfrom t\nwhere a = 1\nlimit 5');
    assert.equal(formatCodeForDisplay('{"a":1}', { lang: 'json' }), '{"a":1}');
  });

  it('colours SQL keywords, strings and placeholders', () => {
    const pieces = tokenizeHighlightedCode("select 'x' from t where r = {{region}}", 'sql');
    assert.equal(pieces.map((piece) => piece.text).join(''), "select 'x' from t where r = {{region}}");
    assert.ok(pieces.some((piece) => piece.kind === 'keyword' && piece.text.toLowerCase() === 'select'));
    assert.ok(pieces.some((piece) => piece.kind === 'string' && piece.text === "'x'"));
    assert.ok(pieces.some((piece) => piece.kind === 'placeholder' && piece.text === '{{region}}'));
  });

  it('colours GraphQL and JSON and marks placeholders on their own', () => {
    const graphql = getHighlightedPieces('query { orders(region: "{{region}}") { id } }', { lang: 'graphql' }, { placeholders: true });
    assert.ok(graphql !== null);
    assert.equal(graphql.map((piece) => piece.text).join(''), 'query { orders(region: "{{region}}") { id } }');
    assert.ok(graphql.some((piece) => piece.kind === 'placeholder' && piece.text === '{{region}}'));
    assert.ok(graphql.some((piece) => piece.kind === 'keyword'));
    const json = getHighlightedPieces('{"n": 1}', { lang: 'json' });
    assert.ok(json?.some((piece) => piece.kind === 'number' && piece.text === '1'));
    assert.equal(getHighlightedPieces('plain', { lang: null }), null);
  });

  it('splits pieces into runs and finds placed filters', () => {
    assert.deepEqual(splitCodePiecesByLengths([{ text: 'abcd', kind: 'string' }, { text: 'ef' }], [3, 3]), [
      [{ text: 'abc', kind: 'string' }],
      [{ text: 'd', kind: 'string' }, { text: 'ef' }],
    ]);
    assert.deepEqual(highlightParameterPlaceholders([{ text: 'a {{' }, { text: 'b}} c' }]), [
      { text: 'a ' },
      { text: '{{b}}', kind: 'placeholder' },
      { text: ' c' },
    ]);
    assert.deepEqual(getPlacedParameterNames("where a = {{x}} and b = '{{y}}' and c = {{x}}", { lang: 'sql' }), ['x', 'y']);
    assert.deepEqual(getPlacedParameterNames('{{x}} {{y}}', { lang: null }), ['x', 'y']);
  });
});

describe('calculation formula', () => {
  it('names each input and marks where the formula uses it', () => {
    const code = '(orders, rates) => orders.map((row) => row.total * rates.eur)';
    assert.deepEqual(getFunctionParameterNames(code), ['orders', 'rates']);
    const args = describeCalculationArguments(code, ['sales', 'fx']);
    assert.deepEqual(
      args.map((arg) => [arg.name, arg.input, arg.tinted]),
      [
        ['orders', 'sales', true],
        ['rates', 'fx', true],
      ],
    );
    const pieces = splitCalculationCodeArguments(code, args);
    assert.equal(pieces.map((piece) => piece.text).join(''), code);
    assert.deepEqual(
      pieces.filter((piece) => piece.arg !== undefined).map((piece) => [piece.text, piece.arg]),
      [
        ['orders', 0],
        ['rates', 1],
        ['orders', 0],
        ['rates', 1],
      ],
    );
  });

  it('leaves a shadowed or destructured input unmarked', () => {
    const args = describeCalculationArguments('({ a }, b) => { const b2 = 1; return [1].map((b) => b); }', ['x', 'y']);
    assert.deepEqual(
      args.map((arg) => [arg.name, arg.tinted]),
      [
        [null, false],
        ['b', false],
      ],
    );
  });
});

describe('source detail', () => {
  it('describes the run before while a source loads again', () => {
    assert.equal(getSettledRun({ status: 'running', startedAt: NOW, prev: failed } as DatasetRun), failed);
    const first = { status: 'running', startedAt: NOW, prev: null } as DatasetRun;
    assert.equal(getSettledRun(first), first);
    assert.equal(getSettledRun(ok), ok);
  });

  it('words a certified answer of a query', () => {
    const at = NOW - 2 * 86_400_000;
    const certified = (fields: Record<string, unknown>): DatasetRun => ({ ...ok, table: { ...table, certified: fields } }) as DatasetRun;
    const full = getCertificationWords(query('q', 'Sales'), certified({ by: 'Ada', at, url: 'https://docs.example.com/x' }), NOW);
    assert.ok(full !== null);
    assert.equal(full.words, 'Certified in Sales');
    assert.match(full.tip, /^Certified by Ada · /);
    assert.match(full.detail ?? '', /^By Ada · /);
    assert.deepEqual(full.link, { href: 'https://docs.example.com/x', host: 'docs.example.com', label: 'Open in Sales' });
    const bare = getCertificationWords(query('q', 'Sales'), certified({}), NOW);
    assert.deepEqual(bare, { words: 'Certified in Sales', tip: 'Certified in Sales', detail: null, link: null });
    assert.equal(getCertificationWords(query('q', ''), certified({}), NOW), null);
    assert.equal(getCertificationWords(file('f'), certified({}), NOW), null);
    assert.equal(getCertificationWords(query('q', 'Sales'), ok, NOW), null);
  });
});
