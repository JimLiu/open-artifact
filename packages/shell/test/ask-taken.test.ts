/**
 * The Ask pane after the owner session took what waited in its inbox (`wake/state` with `via: "taken"`): every message
 * of this tab that was waiting is delivered now, kept that way across a reload; delivered, drafted and failed ones stay
 * as they were. Before, a message that went to the inbox showed "waiting for the session" for as long as the tab lived.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSent, takenSent, type SentMessage } from '../src/shell/model.ts';

test('taken: waiting messages become delivered, the others stay', () => {
  const list: SentMessage[] = [
    { text: 'a', at: '1', delivery: 'inbox' },
    { text: 'b', at: '2', delivery: 'delivered' },
    { text: 'c', at: '3', delivery: 'failed' },
    { text: 'd', at: '4', delivery: 'drafted' },
    { text: 'e', at: '5', delivery: 'inbox' },
  ];
  const next = takenSent(list);
  assert.deepEqual(next.map((m) => m.delivery), ['delivered', 'delivered', 'failed', 'drafted', 'delivered']);
  assert.deepEqual(parseSent(JSON.stringify(next)), next, 'kept across a reload');
});

test('taken with nothing waiting returns the same list (no store update)', () => {
  const list: SentMessage[] = [{ text: 'b', at: '2', delivery: 'delivered' }];
  assert.equal(takenSent(list), list);
});
