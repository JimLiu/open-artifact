import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileNamePart, fileNameStemOf, MOST_FILE_NAME_BYTES, MOST_FILE_NAME_CHARACTERS, xlsxFileName } from '../src/index.ts';

test('an .xlsx file is named for the title, else the first sheet, else Sheet', () => {
  assert.equal(xlsxFileName('Budget 2026', 'Sheet1'), 'Budget 2026.xlsx');
  assert.equal(xlsxFileName(null, 'Costs'), 'Costs.xlsx');
  assert.equal(xlsxFileName('  ..  ', 'Costs'), 'Costs.xlsx');
  assert.equal(xlsxFileName('', ' / '), 'Sheet.xlsx');
});

test('a file name drops what no one sees and turns what a file system reads into a space', () => {
  assert.equal(fileNamePart('Q1​/Q2:\tplan?'), 'Q1 Q2 plan');
  assert.equal(fileNamePart('a­b  %  c.'), 'ab c');
  assert.equal(xlsxFileName('..Report..', 'Sheet1'), 'Report.xlsx');
});

test('a long title is cut between graphemes, by characters and by bytes', () => {
  const long = 'a'.repeat(200);
  assert.equal(fileNameStemOf(long, '.xlsx'), 'a'.repeat(MOST_FILE_NAME_CHARACTERS));
  // A family emoji is seven code points: it is kept whole or left out, never cut.
  const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
  const stem = fileNameStemOf(family.repeat(30), '.xlsx') ?? '';
  assert.equal(Array.from(stem).length % 7, 0);
  assert.ok(Array.from(stem).length <= MOST_FILE_NAME_CHARACTERS);
  // Each CJK letter is three bytes: the bytes run out before the characters do.
  const cjk = fileNameStemOf('表'.repeat(120), '.xlsx') ?? '';
  assert.ok(new TextEncoder().encode(`${cjk}.xlsx`).length <= MOST_FILE_NAME_BYTES);
  assert.equal(cjk.length, Math.floor((MOST_FILE_NAME_BYTES - '.xlsx'.length) / 3));
  // An accent stays with its letter.
  const accented = fileNameStemOf(`${'a'.repeat(MOST_FILE_NAME_CHARACTERS - 1)}é`, '.xlsx');
  assert.equal(accented, 'a'.repeat(MOST_FILE_NAME_CHARACTERS - 1));
  assert.equal(fileNameStemOf('...', '.xlsx'), null);
});
