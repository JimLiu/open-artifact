import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dialogKeepsKey } from '../src/lib/dialog-keys.ts';

describe('keys in a dialog', () => {
  it('keeps the keys that press a control or delete, and lets shortcuts through', () => {
    for (const key of ['Enter', ' ', 'Delete', 'Backspace']) assert.equal(dialogKeepsKey(key), true, key);
    for (const key of ['z', 'ArrowLeft', 'Escape', 'Tab']) assert.equal(dialogKeepsKey(key), false, key);
  });
});
