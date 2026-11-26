/** Keys an input method is using are kept from the page (`lib/composing-keys.ts`). */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { guardComposingKeys, isInputMethodKey } from '../src/lib/composing-keys.ts';

const editor = new EventTarget();
const field = new EventTarget();
const ownsComposition = (target: EventTarget | null) => target === editor;

/** A key event as a browser sends it (Node has no KeyboardEvent). */
function keyEvent(key: string, isComposing: boolean, keyCode: number, target: EventTarget): Event {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperties(event, { key: { value: key }, isComposing: { value: isComposing }, keyCode: { value: keyCode }, target: { value: target } });
  return event;
}

describe('input method keys', () => {
  it('are Enter, Escape and Tab while composing, or with key code 229', () => {
    assert.equal(isInputMethodKey({ key: 'Enter', isComposing: true, keyCode: 13, target: field }, ownsComposition), true);
    assert.equal(isInputMethodKey({ key: 'Escape', isComposing: false, keyCode: 229, target: field }, ownsComposition), true, 'Safari ends a composition so');
    assert.equal(isInputMethodKey({ key: 'Tab', isComposing: true, keyCode: 9, target: field }, ownsComposition), true);
    assert.equal(isInputMethodKey({ key: 'a', isComposing: true, keyCode: 229, target: field }, ownsComposition), false);
    assert.equal(isInputMethodKey({ key: 'Enter', isComposing: false, keyCode: 13, target: field }, ownsComposition), false);
    assert.equal(isInputMethodKey({ key: 'Enter', isComposing: true, keyCode: 229, target: editor }, ownsComposition), false, 'the board text editor reads them itself');
  });

  it('never reach the page, which still hears every other key', () => {
    const host = new EventTarget();
    const stop = guardComposingKeys(host, ownsComposition);
    const heard: string[] = [];
    host.addEventListener('keydown', (event) => heard.push('key' in event ? String(event.key) : ''), true);
    host.dispatchEvent(keyEvent('Escape', true, 229, field));
    host.dispatchEvent(keyEvent('Enter', true, 229, editor));
    host.dispatchEvent(keyEvent('Escape', false, 27, field));
    assert.deepEqual(heard, ['Enter', 'Escape']);
    stop();
    host.dispatchEvent(keyEvent('Escape', true, 229, field));
    assert.deepEqual(heard, ['Enter', 'Escape', 'Escape']);
  });
});
