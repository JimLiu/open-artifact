import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepsSpace, spacePressesTarget } from '../src/space-press.ts';

test('a tap of Space on a focused control is the control’s; held and dragged, it is the pan’s', () => {
  const tap = { repeat: false, onControl: true, panned: false };
  assert.equal(keepsSpace({ ...tap, down: true }), false);
  assert.equal(keepsSpace({ ...tap, down: false }), false);
  assert.equal(keepsSpace({ ...tap, down: false, panned: true }), true);
  assert.equal(keepsSpace({ ...tap, down: true, repeat: true }), true);
  for (const down of [true, false]) assert.equal(keepsSpace({ down, repeat: false, onControl: false, panned: false }), true);
});

test('the controls Space presses, unless marked disabled', () => {
  const element = (tag: string, role?: string, disabled = false) => ({
    tagName: tag.toUpperCase(),
    getAttribute: (name: string) => (name === 'role' ? (role ?? null) : name === 'aria-disabled' && disabled ? 'true' : null),
  });
  for (const [tag, role] of [['button'], ['summary'], ['div', 'button'], ['div', 'switch'], ['div', 'tab'], ['div', 'menuitemradio'], ['div', 'option'], ['button', 'menuitem']] as const)
    assert.equal(spacePressesTarget(element(tag, role) as unknown as EventTarget), true, `${tag} ${role ?? ''}`);
  assert.equal(spacePressesTarget(element('div', 'button', true) as unknown as EventTarget), false);
  assert.equal(spacePressesTarget(element('button', undefined, true) as unknown as EventTarget), false);
  assert.equal(spacePressesTarget(element('canvas') as unknown as EventTarget), false);
  assert.equal(spacePressesTarget(element('div', 'textbox') as unknown as EventTarget), false);
  assert.equal(spacePressesTarget(null), false);
});
