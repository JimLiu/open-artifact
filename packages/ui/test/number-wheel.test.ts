import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { holdNumberTextOnWheel, NUMBER_WHEELING_ATTR, type WheelNumberInput } from '../src/number-wheel.ts';

/** A number input whose text slides by `slide` while the spin buttons are hidden; frames run when `flush` is called. */
function fakeInput(options: { type?: string; focused?: boolean; vendor?: string; slide?: number } = {}) {
  const frames: (() => void)[] = [];
  const attrs = new Set<string>();
  let scroll = 10;
  const input: WheelNumberInput & { flush(): void; attrs: Set<string> } = {
    type: options.type ?? 'number',
    get scrollLeft() {
      return attrs.has(NUMBER_WHEELING_ATTR) ? scroll + (options.slide ?? 6) : scroll;
    },
    set scrollLeft(value: number) {
      scroll = value;
    },
    matches: (selector) => selector === ':focus' && (options.focused ?? true),
    hasAttribute: (name) => attrs.has(name),
    setAttribute: (name) => void attrs.add(name),
    removeAttribute: (name) => void attrs.delete(name),
    ownerDocument: { defaultView: { requestAnimationFrame: (run) => frames.push(run), navigator: { vendor: options.vendor ?? 'Google Inc.' } } },
    flush: () => frames.splice(0).forEach((run) => run()),
    attrs,
  };
  return input;
}

describe('a wheel over a number input', () => {
  it('marks the input until the next frame, then puts the text back by what it slid', () => {
    const input = fakeInput({ slide: 6 });
    holdNumberTextOnWheel(input);
    assert.ok(input.attrs.has(NUMBER_WHEELING_ATTR));
    input.flush();
    assert.ok(!input.attrs.has(NUMBER_WHEELING_ATTR));
    assert.equal(input.scrollLeft, 4);
  });

  it('waits for one frame however many turns come in it', () => {
    const input = fakeInput();
    holdNumberTextOnWheel(input);
    holdNumberTextOnWheel(input);
    input.flush();
    assert.equal(input.scrollLeft, 4);
  });

  it('leaves alone a text input, an input without the focus, and Safari, where the wheel steps nothing', () => {
    for (const input of [fakeInput({ type: 'text' }), fakeInput({ focused: false }), fakeInput({ vendor: 'Apple Computer, Inc.' })]) {
      holdNumberTextOnWheel(input);
      assert.equal(input.attrs.size, 0);
      input.flush();
      assert.equal(input.scrollLeft, 10);
    }
  });
});
