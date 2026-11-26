/**
 * The Sheets Ask fields (insert a chart, change a placed chart, ask for a conditional formatting rule) follow the
 * rule every editor uses: the person's words are refused over `ASK_TEXT_BYTES` UTF-8 bytes, with `ASK_TOO_LONG`
 * said and the words kept, and are never cut on their way to the agent.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASK_TEXT_BYTES, ASK_TOO_LONG, askTooLong } from '@open-artifact/editor-kit';
import { cleanAskWords, MAX_ASK_WORDS_LENGTH, tooLongNoteOf } from '../src/agent/ask-words.ts';
import { agentRequestOf, MAX_REQUEST_TEXT } from '../src/host/agent-request.ts';
import { askWordsOfKind, makeThisChartKindPrompt, mostAskedUnitsWithKind } from '../src/charts/chart-words.ts';
import { chartEditRequest, newChartRequest } from '../src/charts/chart-code-ask.ts';
import { STOCK_CHART_PROGRAMS, STOCK_KINDS } from '@open-artifact/sheets-core/stock-charts';

const ASCII_AT_LIMIT = 'a'.repeat(ASK_TEXT_BYTES);
// 2666 characters of three bytes, and two of one: 8000 bytes.
const CJK_AT_LIMIT = `${'表'.repeat(2666)}ab`;
const CJK_OVER_LIMIT = '表'.repeat(2667);

test('the typing stop of an Ask field never cuts words within the byte limit', () => {
  assert.equal(MAX_ASK_WORDS_LENGTH, ASK_TEXT_BYTES);
  for (const words of [ASCII_AT_LIMIT, CJK_AT_LIMIT]) {
    assert.ok(!askTooLong(words));
    assert.ok(words.length <= MAX_ASK_WORDS_LENGTH);
  }
});

test('words over the byte limit are refused, though they fit the typing stop', () => {
  assert.ok(askTooLong(`${ASCII_AT_LIMIT}a`));
  assert.ok(askTooLong(CJK_OVER_LIMIT));
  assert.ok(CJK_OVER_LIMIT.length <= MAX_ASK_WORDS_LENGTH);
  // Spaces around the words do not count.
  assert.ok(!askTooLong(`  ${ASCII_AT_LIMIT}\n`));
});

test('a refused Ask says it is too long while its words stay in the field, and no more once they change', () => {
  assert.equal(tooLongNoteOf(CJK_OVER_LIMIT, CJK_OVER_LIMIT), ASK_TOO_LONG);
  assert.equal(tooLongNoteOf(CJK_OVER_LIMIT.slice(1), CJK_OVER_LIMIT), null);
  assert.equal(tooLongNoteOf('Make it a pie', null), null);
});

test('cleanAskWords no longer cuts the words, and still collapses spaces and drops unshown characters', () => {
  assert.equal(cleanAskWords(ASCII_AT_LIMIT), ASCII_AT_LIMIT);
  assert.equal(cleanAskWords(CJK_AT_LIMIT), CJK_AT_LIMIT);
  assert.equal(cleanAskWords('  Sum\n\tby  month​ '), 'Sum by month');
});

test('a chart ask written in the page takes the whole words, with the kind’s sentence before them', () => {
  const most = mostAskedUnitsWithKind();
  for (const kind of STOCK_KINDS) assert.ok(most >= MAX_ASK_WORDS_LENGTH + 1 + makeThisChartKindPrompt(kind).length);
  const inputs = { rows: [[{ value: 'Month', text: 'Month' }], [{ value: 1, text: '1' }]] };
  for (const words of [ASCII_AT_LIMIT, CJK_AT_LIMIT]) {
    const asked = askWordsOfKind('line', words);
    const edit = chartEditRequest({ code: 'export default () => null', inputs }, asked, most);
    assert.ok(edit?.words.endsWith(`The person asks: ${JSON.stringify(asked)}`));
    const cells = { rowCount: 2, firstRows: [['Month'], ['1']], lastRows: [], rowsWithGaps: [] };
    const made = newChartRequest({ program: STOCK_CHART_PROGRAMS.bar, ...cells }, words, most);
    assert.ok(made?.words.endsWith(`The person asks: ${JSON.stringify(words)}`));
  }
});

test('a request to the agent keeps its text and userText whole up to the type server’s limit', () => {
  assert.equal(MAX_REQUEST_TEXT, 24_000);
  const chart = agentRequestOf({ label: 'Revenue chart', chartId: 'ch_1', sheetNumber: 1, request: askWordsOfKind('bar', CJK_AT_LIMIT) })!;
  assert.equal(chart.text, askWordsOfKind('bar', CJK_AT_LIMIT));
  assert.equal(chart.userText, chart.text);
  const atMost = 'b'.repeat(MAX_REQUEST_TEXT);
  const whole = agentRequestOf({ label: 'A1', request: atMost, sheetNumber: 1, range: 'A1' })!;
  assert.equal(whole.text, atMost);
  assert.equal(whole.userText, atMost);
});
