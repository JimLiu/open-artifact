import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEscapeHandoff, handEscapeToPopup, noteKeyForPopup, type HandoffKey, type HandoffPopup } from '../src/escape-to-popup.ts';

/** A popup with the nodes it contains; Escape sent to it closes it unless `keepsOpen`. */
function fakePopup(options: { keepsOpen?: boolean } = {}) {
  const timers: (() => void)[] = [];
  const inside = new Set<unknown>(['popup-field']);
  const got: { key: string }[] = [];
  let open = true;
  const popup: HandoffPopup & { got: typeof got; tick(): void; close(): void } = {
    hasAttribute: (name) => name === 'data-open' && open,
    contains: (node) => inside.has(node),
    dispatchEvent(event) {
      got.push(event as { key: string });
      if (!options.keepsOpen) open = false;
      return true;
    },
    ownerDocument: {
      addEventListener() {},
      removeEventListener() {},
      defaultView: {
        KeyboardEvent: class {
          key: string;
          constructor(_type: 'keydown', init: KeyboardEventInit) {
            this.key = init.key ?? '';
          }
        },
        setTimeout: (run) => timers.push(run),
      },
    },
    got,
    tick: () => timers.splice(0).forEach((run) => run()),
    close: () => void (open = false),
  };
  return popup;
}

const escape = (target: unknown, more: Partial<HandoffKey> = {}): HandoffKey & { prevented: boolean } => {
  const event = { key: 'Escape', target, prevented: false, preventDefault() { event.prevented = true; }, ...more };
  return event;
};

const closing = (event: object) => {
  const details = { reason: 'escape-key', event: event as Event, cancelled: false, cancel() { details.cancelled = true; } };
  return details;
};

describe('Escape in a dialog with a popup open', () => {
  it('typed outside the popup goes to the popup, and the dialog stays open', () => {
    const handoff = createEscapeHandoff();
    const popup = fakePopup();
    const key = escape('dialog-field');
    noteKeyForPopup(handoff, popup, key);
    const details = closing(key);
    assert.equal(handEscapeToPopup(handoff, details), true);
    assert.equal(details.cancelled, true);
    assert.equal(key.prevented, true);
    assert.deepEqual(popup.got.map((event) => event.key), ['Escape']);
    // The Escape sent on reaches the dialog too: it closes nothing more.
    const again = closing(popup.got[0]);
    assert.equal(handEscapeToPopup(handoff, again), true);
    assert.equal(again.cancelled, true);
  });

  it('typed inside the popup is the popup’s own', () => {
    const handoff = createEscapeHandoff();
    const popup = fakePopup();
    const key = escape('popup-field');
    noteKeyForPopup(handoff, popup, key);
    assert.equal(handEscapeToPopup(handoff, closing(key)), false);
    assert.equal(popup.got.length, 0);
  });

  it('closes the dialog when no popup is open, for other reasons, and for an Escape something already handled', () => {
    const handoff = createEscapeHandoff();
    const popup = fakePopup();
    popup.close();
    const key = escape('dialog-field');
    noteKeyForPopup(handoff, popup, key);
    assert.equal(handEscapeToPopup(handoff, closing(key)), false);
    const open = fakePopup();
    const other = escape('dialog-field');
    noteKeyForPopup(handoff, open, other);
    assert.equal(handEscapeToPopup(handoff, { reason: 'close-press', event: other as unknown as Event, cancel() {} }), false);
    const handled = escape('dialog-field', { defaultPrevented: true });
    noteKeyForPopup(handoff, open, handled);
    assert.equal(handEscapeToPopup(handoff, closing(handled)), false);
  });

  it('leaves an Escape that ends an input method’s composition alone', () => {
    const handoff = createEscapeHandoff();
    const popup = fakePopup();
    const key = escape('dialog-field', { keyCode: 229 });
    noteKeyForPopup(handoff, popup, key);
    assert.equal(handEscapeToPopup(handoff, closing(key)), false);
  });

  it('passes over a popup that stayed open, until it closes', () => {
    const handoff = createEscapeHandoff();
    const popup = fakePopup({ keepsOpen: true });
    const first = escape('dialog-field');
    noteKeyForPopup(handoff, popup, first);
    assert.equal(handEscapeToPopup(handoff, closing(first)), true);
    popup.tick();
    const second = escape('dialog-field');
    noteKeyForPopup(handoff, popup, second);
    assert.equal(handEscapeToPopup(handoff, closing(second)), false, 'the next Escape closes the dialog');
    popup.close();
    noteKeyForPopup(handoff, popup, { key: 'a', target: null });
    assert.equal(handoff.passedOver.has(popup), false);
  });
});
