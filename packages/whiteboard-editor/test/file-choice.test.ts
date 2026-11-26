/**
 * Picking a picture on a touch screen (`lib/file-choice.ts`): the panel
 * waits for the file picker, and taps that dismiss it are kept from the page.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KEPT_TAP_TAIL_MS, MAX_KEPT_TAPS, keepPressFromPage, waitForFileChoice, type FileChoiceWait } from '../src/lib/file-choice.ts';

/** A pointer-like event (Node has no PointerEvent). */
function press(type: string, pointerId: number, isPrimary = true, target?: EventTarget): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: isPrimary } });
  if (target) Object.defineProperty(event, 'target', { value: target });
  return event;
}

/** A mouse-like event with a click count. */
function mouse(type: string, detail = 1): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'detail', { value: detail });
  return event;
}

/**
 * A window: capture listeners hear an event before the page does, and
 * stopImmediatePropagation keeps it from the page (Node's EventTarget has
 * no phases, so this one models them).
 */
class Window implements EventTarget {
  private readonly listeners: { type: string; listener: EventListenerOrEventListenerObject; capture: boolean }[] = [];
  readonly heard: string[] = [];
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    if (listener) this.listeners.push({ type, listener, capture: captures(options) });
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    const at = this.listeners.findIndex((entry) => entry.type === type && entry.listener === listener && entry.capture === captures(options));
    if (at !== -1) this.listeners.splice(at, 1);
  }
  dispatchEvent(event: Event): boolean {
    let stopped = false;
    const stop = event.stopImmediatePropagation.bind(event);
    Object.defineProperty(event, 'stopImmediatePropagation', { value: () => ((stopped = true), stop()) });
    const phase = (capture: boolean) => this.listeners.filter((entry) => entry.type === event.type && entry.capture === capture).map((entry) => entry.listener);
    const call = (listener: EventListenerOrEventListenerObject) => (typeof listener === 'function' ? listener(event) : listener.handleEvent(event));
    for (const listener of phase(true)) if (!stopped) call(listener);
    if (!stopped) this.heard.push(event.type);
    for (const listener of phase(false)) if (!stopped) call(listener);
    return !event.defaultPrevented;
  }
}

const captures = (options: boolean | EventListenerOptions | undefined): boolean => (typeof options === 'boolean' ? options : options?.capture === true);

/** A window that records what reaches the page. */
function page(): { host: EventTarget; heard: string[] } {
  const host = new Window();
  return { host, heard: host.heard };
}

function manualLater(): { later: (run: () => void, ms: number) => void; flush: () => void; delays: number[] } {
  const queue: (() => void)[] = [];
  const delays: number[] = [];
  return {
    later: (run, ms) => {
      queue.push(run);
      delays.push(ms);
    },
    flush: () => queue.splice(0).forEach((run) => run()),
    delays,
  };
}

function waiting(tapsDismiss: boolean, inPanel = (target: EventTarget | null) => target === panel): { calls: string[]; stop: () => void; host: EventTarget; heard: string[]; input: EventTarget; flush: () => void } {
  const { host, heard } = page();
  const input = new EventTarget();
  const calls: string[] = [];
  const { later, flush } = manualLater();
  const wait: FileChoiceWait = { input, host, inPanel, tapsDismiss, close: () => calls.push('close'), over: () => calls.push('over'), later };
  return { calls, stop: waitForFileChoice(wait), host, heard, input, flush };
}
const panel = new EventTarget();
const board = new EventTarget();

describe('waiting for a file choice', () => {
  it('ends when the picker is turned away, leaving the panel open', () => {
    const run = waiting(false);
    run.input.dispatchEvent(new Event('cancel'));
    assert.deepEqual(run.calls, ['over']);
    run.input.dispatchEvent(new Event('cancel'));
    assert.deepEqual(run.calls, ['over'], 'listeners are gone');
  });

  it('ends on a key, on focus coming back, or on any press where taps do not dismiss the picker', () => {
    for (const [target, event] of [['host', new Event('keydown')], ['host', new Event('focus')], ['host', press('pointerdown', 1, true, board)]] as const) {
      const run = waiting(false);
      run.host.dispatchEvent(event);
      assert.deepEqual(run.calls, ['over'], `${target} ${event.type}`);
      assert.ok(run.heard.includes(event.type) || event.type === 'focus', 'the page still hears it');
    }
  });

  it('stops quietly once a file is chosen', () => {
    const run = waiting(true);
    run.stop();
    run.input.dispatchEvent(new Event('cancel'));
    run.host.dispatchEvent(new Event('keydown'));
    assert.deepEqual(run.calls, []);
  });

  it('keeps a dismissing tap from the page and closes the panel when the tap was outside it', () => {
    const run = waiting(true);
    run.host.dispatchEvent(new Event('focus'));
    assert.deepEqual(run.calls, [], 'focus coming back is the tap itself');
    run.host.dispatchEvent(press('pointerdown', 7, true, board));
    run.host.dispatchEvent(press('pointerup', 7));
    run.host.dispatchEvent(mouse('click'));
    assert.deepEqual(run.heard, ['focus'], 'the tap never reaches the page');
    run.input.dispatchEvent(new Event('cancel'));
    assert.deepEqual(run.calls, ['close']);
  });

  it('leaves the panel open when the dismissing tap landed on it', () => {
    const run = waiting(true);
    run.host.dispatchEvent(press('pointerdown', 3, true, panel));
    run.input.dispatchEvent(new Event('cancel'));
    assert.deepEqual(run.calls, ['over']);
  });

  it(`keeps at most ${MAX_KEPT_TAPS} taps, then gives presses back to the page`, () => {
    const run = waiting(true);
    for (let tap = 1; tap <= MAX_KEPT_TAPS; tap++) {
      run.host.dispatchEvent(press('pointerdown', tap, true, board));
      run.host.dispatchEvent(press('pointerup', tap));
      run.flush();
    }
    assert.deepEqual(run.heard, []);
    run.host.dispatchEvent(press('pointerdown', 9, true, board));
    assert.deepEqual(run.calls, ['over']);
    assert.deepEqual(run.heard, ['pointerdown']);
  });
});

describe('keeping a tap from the page', () => {
  it('keeps the press until every finger is up and a little longer', () => {
    const { host, heard } = page();
    const { later, flush, delays } = manualLater();
    keepPressFromPage(host, 1, later);
    host.dispatchEvent(press('pointerdown', 2, false));
    host.dispatchEvent(press('pointerup', 1));
    assert.deepEqual(delays, [], 'a second finger is still down');
    host.dispatchEvent(press('pointerup', 2));
    assert.deepEqual(delays, [KEPT_TAP_TAIL_MS]);
    host.dispatchEvent(mouse('mousedown'));
    host.dispatchEvent(mouse('click'));
    assert.deepEqual(heard, []);
    flush();
    host.dispatchEvent(mouse('click'));
    assert.deepEqual(heard, ['click']);
  });

  it('lets other pointers, keyboard clicks and a new primary press through', () => {
    const { host, heard } = page();
    keepPressFromPage(host, 1, () => undefined);
    host.dispatchEvent(press('pointermove', 5));
    host.dispatchEvent(mouse('click', 0));
    assert.deepEqual(heard, ['pointermove', 'click']);
    host.dispatchEvent(press('pointerdown', 6, true));
    host.dispatchEvent(press('pointerup', 1));
    assert.deepEqual(heard, ['pointermove', 'click', 'pointerdown', 'pointerup']);
  });

  it('gives the page its events back on a key', () => {
    const { host, heard } = page();
    keepPressFromPage(host, 1, () => undefined);
    host.dispatchEvent(new Event('keydown'));
    host.dispatchEvent(press('pointerup', 1));
    assert.deepEqual(heard, ['keydown', 'pointerup']);
  });
});
