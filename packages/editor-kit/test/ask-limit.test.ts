/**
 * `askTooLong`: an editor's Ask takes as many UTF-8 bytes as the Shell's and claude.ai's, and says so the same way.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_ASK_BYTES, utf8Bytes } from '@open-artifact/protocol';
import { ASK_TEXT_BYTES, ASK_TOO_LONG, askTooLong } from '../src/agent.ts';

test('the same limit as the Shell Ask (MAX_ASK_BYTES), counted in UTF-8 bytes of the trimmed words', () => {
  assert.equal(ASK_TEXT_BYTES, MAX_ASK_BYTES);
  // Exactly the limit: the emoji is 2 UTF-16 units and 4 bytes.
  const words = 'Make it blue 🎨'.padStart(ASK_TEXT_BYTES - 2, 'x');
  assert.equal(utf8Bytes(words), ASK_TEXT_BYTES);
  assert.equal(askTooLong(words), false);
  assert.equal(askTooLong(`  ${words}\n`), false, 'spaces around the words do not count');
  assert.equal(askTooLong(`${words}!`), true);
  // Chinese is 3 bytes a character: 2667 characters are over, though far under 8000 UTF-16 units.
  assert.equal(askTooLong('改'.repeat(2666)), false);
  assert.equal(askTooLong('改'.repeat(2667)), true);
});

test('the Shell’s words for it', () => {
  assert.equal(ASK_TOO_LONG, 'That’s too long to send.');
});
