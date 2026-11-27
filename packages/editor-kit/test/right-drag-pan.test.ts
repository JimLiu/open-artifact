/** Tests of what a right press on a canvas does: pan once it travels, a right-click with its menu when it does not. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RIGHT_PAN_QUIET_MS, RIGHT_PAN_THRESHOLD, RIGHT_PRESS_IDLE, rightPressStep, type RightPress, type RightPressEffect, type RightPressInput } from '../src/right-drag-pan.ts';

/** Runs inputs from idle; the effects in order and the state at the end. */
function run(inputs: RightPressInput[], from: RightPress = RIGHT_PRESS_IDLE): { effects: RightPressEffect[]; state: RightPress } {
  let state = from;
  const effects: RightPressEffect[] = [];
  for (const input of inputs) {
    const step = rightPressStep(state, input);
    state = step.state;
    effects.push(step.effect);
  }
  return { effects, state };
}

const press = (time = 0): RightPressInput => ({ type: 'press', id: 1, x: 100, y: 100, time });
const move = (x: number, y: number, time = 10): RightPressInput => ({ type: 'move', id: 1, x, y, time });
const release = (x = 100, y = 100, time = 20): RightPressInput => ({ type: 'release', id: 1, x, y, time });
const menu = (time = 5): RightPressInput => ({ type: 'menu', time });

describe('rightPressStep', () => {
  it('holds the press back, and pans once it travels past the threshold', () => {
    const { effects, state } = run([press(), move(100 + RIGHT_PAN_THRESHOLD - 1, 100), move(110, 104), move(125, 90)]);
    assert.deepEqual(effects, [
      { do: 'stop' },
      { do: 'stop' },
      { do: 'pan', dx: 10, dy: 4, start: true },
      { do: 'pan', dx: 15, dy: -14, start: false },
    ]);
    assert.deepEqual(state, { phase: 'panning', id: 1, x: 125, y: 90 });
  });

  it('ends a pan on release, and stops the menu the browser asks for after it (Windows)', () => {
    const { effects, state } = run([press(), move(130, 100), release(130, 100, 20), menu(21)]);
    assert.deepEqual(effects.slice(2), [{ do: 'end' }, { do: 'stop' }]);
    assert.deepEqual(state, RIGHT_PRESS_IDLE);
  });

  it('stops the menu the browser asks for at the press (macOS, Linux), and opens no menu after a pan', () => {
    const { effects } = run([press(), menu(1), move(130, 100), release(130, 100)]);
    assert.deepEqual(effects, [{ do: 'stop' }, { do: 'stop' }, { do: 'pan', dx: 30, dy: 0, start: true }, { do: 'end' }]);
  });

  it('is a right-click without travel: the menu asked for at the press opens on release', () => {
    const { effects, state } = run([press(), menu(1), move(102, 101), release(102, 101)]);
    assert.deepEqual(effects, [{ do: 'stop' }, { do: 'stop' }, { do: 'stop' }, { do: 'click', menu: true }]);
    assert.deepEqual(state, RIGHT_PRESS_IDLE);
  });

  it('lets the menu asked for after a right-click through (Windows)', () => {
    const { effects } = run([press(), release(), menu(21)]);
    assert.deepEqual(effects, [{ do: 'stop' }, { do: 'click', menu: false }, { do: 'pass' }]);
  });

  it('lets a menu long after a pan through, and stops only one', () => {
    const late = run([press(), move(130, 100), release(130, 100, 20), menu(20 + RIGHT_PAN_QUIET_MS + 1)]);
    assert.deepEqual(late.effects.at(-1), { do: 'pass' });
    const twice = run([press(), move(130, 100), release(130, 100, 20), menu(21), menu(22)]);
    assert.deepEqual(twice.effects.slice(-2), [{ do: 'stop' }, { do: 'pass' }]);
  });

  it('opens no menu when the press is cancelled, and ends a pan that is', () => {
    const held = run([press(), menu(1), { type: 'cancel', id: 1, time: 5 }, release()]);
    assert.deepEqual(held.effects, [{ do: 'stop' }, { do: 'stop' }, { do: 'stop' }, { do: 'pass' }]);
    const panning = run([press(), move(130, 100), { type: 'cancel', id: 1, time: 15 }]);
    assert.deepEqual(panning.effects.at(-1), { do: 'end' });
  });

  it('lets other pointers and menus with no press through', () => {
    const other = run([press(), { type: 'move', id: 2, x: 300, y: 300, time: 5 }, { type: 'release', id: 2, x: 300, y: 300, time: 6 }]);
    assert.deepEqual(other.effects.slice(1), [{ do: 'pass' }, { do: 'pass' }]);
    assert.deepEqual(run([menu()]).effects, [{ do: 'pass' }]);
    assert.deepEqual(run([move(200, 200)]).effects, [{ do: 'pass' }]);
    // A second press while one is held is not taken over.
    assert.deepEqual(run([press(), { type: 'press', id: 2, x: 0, y: 0, time: 1 }]).effects, [{ do: 'stop' }, { do: 'pass' }]);
  });
});
