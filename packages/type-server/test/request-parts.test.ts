/**
 * A page's "Send to agent" with the person's words and selection (`wake.request.parts`): the type server keeps
 * `userText` only when the request's text starts with it, after the text is cleaned and clamped, and checks the
 * snapshot before it queues the request.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeRequest } from '../src/agent.ts';

const snapshot = { kind: 'elements', label: '3 selected elements', count: 3, items: [{ id: 'a', kind: 'text', label: 'Hi' }] };

test('normalizeRequest keeps userText that starts the text, and the snapshot', () => {
  const queued = normalizeRequest({ text: 'Bigger\ntitle\n\n<selected elements>a</selected elements>', userText: 'Bigger\ntitle', selectionSnapshot: snapshot }, 'send');
  assert.equal(queued.userText, 'Bigger\ntitle');
  assert.deepEqual(queued.selectionSnapshot, snapshot);
});

test('normalizeRequest drops words the agent would not read first, and a malformed snapshot', () => {
  const queued = normalizeRequest({ text: 'The page wrote this', userText: 'something else', selectionSnapshot: { kind: 'x', label: 'y', count: 0 } }, 'send');
  assert.equal(queued.userText, undefined);
  assert.equal(queued.selectionSnapshot, undefined);
});

test('normalizeRequest: words cut off with the text at its limit are left out', () => {
  const words = 'w'.repeat(9000);
  const queued = normalizeRequest({ text: words, userText: words }, 'send');
  assert.ok(queued.text.endsWith("…"), "the text is cut");
  assert.equal(queued.userText, undefined);
});
