/**
 * A Sheets request to the agent, with what the person typed and what it is about (`wake.request.parts`): `userText`
 * only for typed words (never a pressed or canned sentence), and a snapshot of the cells, chart, rule or blank sheet.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentRequestOf } from '../src/host/agent-request.ts';

test('typed words about cells: userText, and the range as the snapshot', () => {
  const request = agentRequestOf({ label: 'Sheet1!B2:C4', request: '  Sum these\nby month ', sheetNumber: 1, range: 'B2:C4', activeCell: 'B2', revision: 3 })!;
  assert.equal(request.text, 'Sum these\nby month');
  assert.equal(request.userText, 'Sum these\nby month');
  assert.deepEqual(request.selectionSnapshot, { kind: 'cells', label: 'B2:C4', count: 1, items: [{ id: 'B2:C4', kind: 'range' }], where: 'Sheet 1' });
});

test('a press with no words: no userText, the snapshot still', () => {
  const request = agentRequestOf({ label: 'Fix errors', pressed: 'Fix the errors in these cells.', sheetNumber: 2, range: 'A1', activeCell: 'A1', revision: 1 })!;
  assert.equal(request.text, 'Fix the errors in these cells.');
  assert.equal(request.userText, undefined);
  assert.equal(request.selectionSnapshot?.label, 'A1');
  assert.equal(request.selectionSnapshot?.where, 'Sheet 2');
});

test('a chart, a rule, a blank sheet', () => {
  const chart = agentRequestOf({ label: 'Revenue chart', chartId: 'ch_1', sheetNumber: 1, request: 'Make it a line' })!;
  assert.equal(chart.userText, 'Make it a line');
  assert.deepEqual(chart.selectionSnapshot, { kind: 'chart', label: 'Revenue chart', count: 1, items: [{ id: 'ch_1', kind: 'chart' }], where: 'Sheet 1' });
  const rule = agentRequestOf({ label: '', ruleNumber: 2, ruleCount: 3, sheetNumber: 1 })!;
  assert.equal(rule.text, 'About this conditional formatting rule.');
  assert.equal(rule.userText, undefined);
  assert.equal(rule.selectionSnapshot?.label, 'Conditional formatting rule 2');
  const blank = agentRequestOf({ label: '', isSheetBlank: true, sheetNumber: 3 })!;
  assert.deepEqual(blank.selectionSnapshot, { kind: 'sheet', label: 'Sheet 3', count: 1 });
});

test('a connected table that did not refresh: why, as context, with the sheet as the snapshot', () => {
  const refresh = agentRequestOf({ label: 'Connected table', whyNotRefreshed: 'answerTooLarge', sheetNumber: 2 })!;
  assert.equal(refresh.text, 'About why this connected table did not refresh.');
  assert.equal(refresh.userText, undefined);
  assert.deepEqual(refresh.context, { whyNotRefreshed: 'answerTooLarge', sheetNumber: 2 });
  assert.deepEqual(refresh.selectionSnapshot, { kind: 'sheet', label: 'Connected table', count: 1, where: 'Sheet 2' });
});
