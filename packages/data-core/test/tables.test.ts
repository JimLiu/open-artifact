import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cellToString,
  coerceCellNumber,
  escapeSpreadsheetFormula,
  hasCutWithoutRows,
  inferDataFileFormat,
  inferDataFileFormatOrCsv,
  markTableTruncated,
  normalizeColumnNames,
  normalizeTable,
  parseDataFileTable,
  parseDelimitedRows,
  parseDelimitedTable,
  parseFileAnswer,
  stripColumnNamespace,
  tableToCsv,
  tableToTsv,
} from '../src/index.ts';

const plain = (rows: object[]): object[] => rows.map((row) => ({ ...row }));

describe('delimited text', () => {
  it('reads quoted fields with commas, doubled quotes and line breaks', () => {
    assert.deepEqual(parseDelimitedRows('a,b\n1,"x, ""y"""\n2,"two\nlines"\n', ','), [
      ['a', 'b'],
      ['1', 'x, "y"'],
      ['2', 'two\nlines'],
    ]);
  });

  it('makes a table, an empty field as null', () => {
    const table = parseDelimitedTable('a,b\r\n1,"x, ""y"""\r\n2,\r\n', ',');
    assert.ok(table !== null);
    assert.deepEqual(table.columns, ['a', 'b']);
    assert.deepEqual(plain(table.rows), [
      { a: '1', b: 'x, "y"' },
      { a: '2', b: null },
    ]);
  });

  it('reads TSV', () => {
    const table = parseDataFileTable('name\tvalue\nA\t1\n', 'tsv');
    assert.deepEqual(table?.columns, ['name', 'value']);
    assert.deepEqual(plain(table?.rows ?? []), [{ name: 'A', value: '1' }]);
  });

  it('infers a format from a file name', () => {
    assert.equal(inferDataFileFormat('sales.TSV'), 'tsv');
    assert.equal(inferDataFileFormat('data.json'), 'json');
    assert.equal(inferDataFileFormat('notes'), null);
    assert.equal(inferDataFileFormatOrCsv('notes'), 'csv');
  });

  it('reads a JSON file as rows, or as a value', () => {
    const rows = parseFileAnswer('[{"a":1},{"a":2}]', 'json');
    assert.ok(rows !== null && 'table' in rows);
    assert.deepEqual(rows.table.columns, ['a']);
    const value = parseFileAnswer('{"total": 3}', 'json');
    assert.deepEqual(value, { value: { total: 3 } });
  });
});

describe('writing tables', () => {
  it('quotes CSV fields and guards spreadsheet formulas', () => {
    const table = normalizeTable([{ a: 'x, y', b: 'say "hi"' }, { a: '=SUM(A1)', b: null }]);
    assert.ok(table !== null);
    assert.equal(tableToCsv(table), 'a,b\n"x, y","say ""hi"""\n\'=SUM(A1),');
    assert.equal(tableToTsv(table), "a\tb\nx, y\t\"say \"\"hi\"\"\"\n'=SUM(A1)\t");
    assert.equal(escapeSpreadsheetFormula('+1'), '+1');
    assert.equal(escapeSpreadsheetFormula('+A1'), "'+A1");
    assert.equal(escapeSpreadsheetFormula('plain'), 'plain');
  });

  it('looks past leading spaces and folds the first character before guarding a formula', () => {
    assert.equal(escapeSpreadsheetFormula(' =A1'), "' =A1");
    assert.equal(escapeSpreadsheetFormula('\u3000@SUM(A1)'), "'\u3000@SUM(A1)");
    assert.equal(escapeSpreadsheetFormula('＝A1'), "'＝A1");
    assert.equal(escapeSpreadsheetFormula('﹢A1'), "'﹢A1");
    assert.equal(escapeSpreadsheetFormula('\t=A1'), "'\t=A1");
    assert.equal(escapeSpreadsheetFormula('\rplain'), "'\rplain");
    assert.equal(escapeSpreadsheetFormula('-5'), '-5');
    assert.equal(escapeSpreadsheetFormula(' +1.5'), ' +1.5');
    assert.equal(escapeSpreadsheetFormula('  plain'), '  plain');
    assert.equal(escapeSpreadsheetFormula(''), '');
    assert.equal(escapeSpreadsheetFormula('   '), '   ');
  });
});

describe('normalizeTable', () => {
  it('takes rows from a list, or from rows/data/results, in the declared column order', () => {
    assert.deepEqual(normalizeTable([{ b: 1, a: 2 }])?.columns, ['b', 'a']);
    const table = normalizeTable({ columns: ['a', 'b', 'missing'], rows: [{ b: 1, a: 2 }, { c: 3 }] });
    assert.deepEqual(table?.columns, ['a', 'b', 'c']);
    assert.deepEqual(plain(table?.rows ?? []), [
      { a: 2, b: 1, c: null },
      { a: null, b: null, c: 3 },
    ]);
    assert.deepEqual(normalizeTable({ results: [{ x: 1 }] })?.columns, ['x']);
    assert.equal(normalizeTable({ nothing: true }), null);
    assert.equal(normalizeTable('text'), null);
  });

  it('keeps nested values as JSON text and skips rows that are not records', () => {
    const table = normalizeTable([{ a: { b: 1 } }, 'x', [1]]);
    assert.equal(table?.rows.length, 1);
    assert.equal(typeof table?.rows[0]?.a, 'string');
    assert.deepEqual(JSON.parse(String(table?.rows[0]?.a)), { b: 1 });
  });

  it('gives empty and repeated column names their own names', () => {
    const names = normalizeColumnNames(['a', 'a', '']);
    assert.equal(new Set(names).size, 3);
    assert.equal(names[0], 'a');
  });

  it('marks a table cut', () => {
    const cut = markTableTruncated({ columns: ['a'], rows: [] });
    assert.equal(cut.cut, 'rows');
    assert.equal(hasCutWithoutRows(cut), true);
  });

  it('reads cells as numbers and text', () => {
    assert.equal(coerceCellNumber('1,234.5'), null);
    assert.equal(coerceCellNumber('12.5'), 12.5);
    assert.equal(coerceCellNumber(null), null);
    assert.equal(cellToString(null), '');
    assert.equal(stripColumnNamespace('sales__region'), 'region');
    assert.equal(stripColumnNamespace('region'), 'region');
  });
});
