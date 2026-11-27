import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PRESSABLE_SELECTOR, controlTakesKey, dialogKeepsKey } from '../src/lib/dialog-keys.ts';

describe('keys in a dialog', () => {
  it('keeps the keys that press a control or delete, and lets shortcuts through', () => {
    for (const key of ['Enter', ' ', 'Delete', 'Backspace']) assert.equal(dialogKeepsKey(key), true, key);
    for (const key of ['z', 'ArrowLeft', 'Escape', 'Tab']) assert.equal(dialogKeepsKey(key), false, key);
  });
});

describe('keys on a focused control', () => {
  // A stand-in element: `closest` finds a match when the element is one of the given kinds.
  const element = (...kinds: string[]) => ({ closest: (selector: string) => (kinds.some((kind) => selector.split(', ').includes(kind)) ? {} : null) });

  it('leaves Enter and Space to a button, a menu item, a radio and a link', () => {
    for (const kind of ['button', '[role="button"]', '[role^="menuitem"]', '[role="radio"]', 'a[href]']) {
      assert.ok(PRESSABLE_SELECTOR.split(', ').includes(kind), kind);
      assert.equal(controlTakesKey('Enter', element(kind) as unknown as EventTarget), true, kind);
      assert.equal(controlTakesKey(' ', element(kind) as unknown as EventTarget), true, kind);
    }
  });

  it('keeps the other keys, and every key off a control, for the canvas', () => {
    assert.equal(controlTakesKey('Delete', element('button') as unknown as EventTarget), false);
    assert.equal(controlTakesKey('ArrowLeft', element('button') as unknown as EventTarget), false);
    assert.equal(controlTakesKey('Enter', element() as unknown as EventTarget), false);
    assert.equal(controlTakesKey('Enter', null), false);
    assert.equal(controlTakesKey(' ', {} as EventTarget), false);
  });

  it('leaves a key held with a modifier to the shortcuts', () => {
    assert.equal(controlTakesKey('Enter', element('button') as unknown as EventTarget, true), false);
    assert.equal(controlTakesKey(' ', element('button') as unknown as EventTarget, true), false);
  });
});
