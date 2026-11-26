import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { scrollStanding, scrollsOverflow } from '../src/focusables.ts';
import {
  blocksEarlyPress,
  createLateEnterTracker,
  EARLY_PRESS_MAX_MS,
  EARLY_PRESS_SETTLE_MS,
  earlyPressEnds,
  guardHeldActivation,
  HELD_KEY_GUARD_MAX_MS,
  HELD_KEY_SETTLE_MS,
  isComposingKey,
  isRepeatedActivation,
  isSafariLateEnter,
  isTextField,
  preventRepeatedActivation,
  SAFARI_LATE_ENTER_MS,
  shortcutLetter,
  shouldYieldWindowShortcut,
  withRepeatGuard,
  type KeyGuardEvent,
  type KeyGuardWindow,
} from '../src/keys.ts';

/** A keydown-like event that records what was prevented. */
function keyEvent(key: string, init: { repeat?: boolean; type?: string; target?: unknown; currentTarget?: unknown } = {}) {
  const event = {
    key,
    repeat: init.repeat ?? false,
    type: init.type ?? 'keydown',
    target: init.target ?? 'row',
    currentTarget: init.currentTarget ?? init.target ?? 'row',
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopImmediatePropagation() {
      event.stopped = true;
    },
  };
  return event;
}

/** A window stand-in with real listeners and Node's (mocked) timers. */
function fakeWindow() {
  const listeners = new Set<{ type: string; listener: (event: KeyGuardEvent) => void }>();
  const win: KeyGuardWindow & { dispatch(event: KeyGuardEvent): void; count(): number } = {
    addEventListener(type, listener) {
      listeners.add({ type, listener });
    },
    removeEventListener(type, listener) {
      for (const entry of listeners) if (entry.type === type && entry.listener === listener) listeners.delete(entry);
    },
    setTimeout: (callback, ms) => setTimeout(callback, ms) as unknown as number,
    clearTimeout: (id) => clearTimeout(id),
    dispatch(event) {
      for (const entry of [...listeners]) if (entry.type === event.type) entry.listener(event);
    },
    count: () => listeners.size,
  };
  return win;
}

describe('repeat guard', () => {
  it('knows a held Enter or Space', () => {
    assert.equal(isRepeatedActivation({ key: 'Enter', repeat: true }), true);
    assert.equal(isRepeatedActivation({ key: ' ', repeat: true }), true);
    assert.equal(isRepeatedActivation({ key: 'Enter', repeat: false }), false);
    assert.equal(isRepeatedActivation({ key: 'ArrowDown', repeat: true }), false);
  });

  it('prevents only repeats on the control itself', () => {
    const first = keyEvent('Enter');
    preventRepeatedActivation(first);
    assert.equal(first.defaultPrevented, false);
    const repeat = keyEvent('Enter', { repeat: true });
    preventRepeatedActivation(repeat);
    assert.equal(repeat.defaultPrevented, true);
    const fromChild = keyEvent('Enter', { repeat: true, target: 'field', currentTarget: 'row' });
    preventRepeatedActivation(fromChild);
    assert.equal(fromChild.defaultPrevented, false);
  });

  it('still runs the wrapped handler', () => {
    const seen: boolean[] = [];
    const handler = withRepeatGuard((event: ReturnType<typeof keyEvent>) => seen.push(event.defaultPrevented));
    handler(keyEvent('Enter'));
    handler(keyEvent('Enter', { repeat: true }));
    assert.deepEqual(seen, [false, true]);
  });
});

describe('guardHeldActivation', () => {
  const inside = (target: unknown) => target === 'toast';

  it('swallows Enter outside until the key is released and settles', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const win = fakeWindow();
      guardHeldActivation(win, 'Enter', inside);
      const repeat = keyEvent('Enter', { repeat: true, target: 'delete-button' });
      win.dispatch(repeat);
      assert.equal(repeat.defaultPrevented, true);
      assert.equal(repeat.stopped, true);
      const letter = keyEvent('a', { target: 'delete-button' });
      win.dispatch(letter);
      assert.equal(letter.defaultPrevented, false);
      const inToast = keyEvent('Enter', { repeat: true, target: 'toast' });
      win.dispatch(inToast);
      assert.equal(inToast.defaultPrevented, false);
      win.dispatch(keyEvent('Enter', { type: 'keyup', target: 'delete-button' }));
      assert.equal(win.count(), 2);
      mock.timers.tick(HELD_KEY_SETTLE_MS);
      assert.equal(win.count(), 0);
      const later = keyEvent('Enter', { target: 'delete-button' });
      win.dispatch(later);
      assert.equal(later.defaultPrevented, false);
    } finally {
      mock.timers.reset();
    }
  });

  it('cancels a Space keyup outside, which would press a native button', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const win = fakeWindow();
      guardHeldActivation(win, ' ', inside);
      const up = keyEvent(' ', { type: 'keyup', target: 'delete-button' });
      win.dispatch(up);
      assert.equal(up.defaultPrevented, true);
    } finally {
      mock.timers.reset();
    }
  });

  it('ends on its own after the limit, or when asked', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const win = fakeWindow();
      guardHeldActivation(win, 'Enter', inside);
      mock.timers.tick(HELD_KEY_GUARD_MAX_MS);
      assert.equal(win.count(), 0);
      const end = guardHeldActivation(win, 'Enter', inside);
      assert.equal(win.count(), 2);
      end();
      assert.equal(win.count(), 0);
    } finally {
      mock.timers.reset();
    }
  });
});

describe('scrollsOverflow', () => {
  const box = { scrollWidth: 100, clientWidth: 100, scrollHeight: 400, clientHeight: 200, overflowX: 'auto', overflowY: 'auto' };

  it('is true when content overflows a scrolling axis', () => {
    assert.equal(scrollsOverflow(box), true);
    assert.equal(scrollsOverflow({ ...box, overflowY: 'scroll' }), true);
  });

  it('is false for hidden, clipped or visible overflow, and for a pixel of rounding', () => {
    assert.equal(scrollsOverflow({ ...box, overflowY: 'hidden' }), false);
    assert.equal(scrollsOverflow({ ...box, overflowY: 'clip' }), false);
    assert.equal(scrollsOverflow({ ...box, overflowY: 'visible' }), false);
    assert.equal(scrollsOverflow({ ...box, scrollHeight: 201 }), false);
  });
});

describe('scrollStanding', () => {
  const box = { scrollWidth: 100, clientWidth: 100, scrollHeight: 400, clientHeight: 200, overflowX: 'hidden', overflowY: 'auto', scrollTop: 0 };

  it('tells a box that fits from one with more below and one scrolled to its end', () => {
    assert.equal(scrollStanding({ ...box, scrollHeight: 200 }), 'none');
    assert.equal(scrollStanding(box), 'more');
    assert.equal(scrollStanding({ ...box, scrollTop: 199.5 }), 'end');
    assert.equal(scrollStanding({ ...box, overflowY: 'hidden' }), 'none');
  });
});

describe('isComposingKey', () => {
  it('is true while an input method composes, including the 229 key code Safari sends at its end', () => {
    assert.equal(isComposingKey({ isComposing: true, keyCode: 13 }), true);
    assert.equal(isComposingKey({ isComposing: false, keyCode: 229 }), true);
    assert.equal(isComposingKey({ isComposing: false, keyCode: 13 }), false);
    assert.equal(isComposingKey({}), false);
  });
});

describe('shortcutLetter', () => {
  it('takes a Latin letter as typed, whatever key makes it', () => {
    assert.equal(shortcutLetter({ key: 'S', code: 'KeyS' }), 's');
    assert.equal(shortcutLetter({ key: 'o', code: 'KeyS' }), 'o', 'Dvorak keeps its own letters');
  });

  it('falls back to the physical key for other characters', () => {
    assert.equal(shortcutLetter({ key: 'ы', code: 'KeyS' }), 's');
    assert.equal(shortcutLetter({ key: 'ß', code: 'KeyS' }), 's', 'an Option-made symbol');
    assert.equal(shortcutLetter({ key: 'я' }), 'я', 'no code to go by');
  });

  it('lower-cases named keys', () => {
    assert.equal(shortcutLetter({ key: 'Escape', code: 'Escape' }), 'escape');
    assert.equal(shortcutLetter({ key: 'Enter', code: 'KeyE' }), 'enter');
  });
});

describe('early press guard', () => {
  const enter = { key: 'Enter', repeat: false, isTrusted: true };
  const space = { key: ' ', repeat: false, isTrusted: true };

  it('blocks Enter and Space until the dialog has been fully shown for a moment', () => {
    const times = { opened: 1000, shown: null };
    assert.equal(blocksEarlyPress(times, 1000, enter), true);
    assert.equal(blocksEarlyPress(times, 2500, space), true, 'still appearing');
    const shown = { opened: 1000, shown: 1150 };
    assert.equal(earlyPressEnds(shown), 1150 + EARLY_PRESS_SETTLE_MS);
    assert.equal(blocksEarlyPress(shown, 1150 + EARLY_PRESS_SETTLE_MS - 1, enter), true);
    assert.equal(blocksEarlyPress(shown, 1150 + EARLY_PRESS_SETTLE_MS, enter), false);
  });

  it('counts from opening when there is no transition, and never runs past the limit', () => {
    assert.equal(earlyPressEnds({ opened: 500, shown: 500 }), 500 + EARLY_PRESS_SETTLE_MS);
    assert.equal(earlyPressEnds({ opened: 500, shown: null }), 500 + EARLY_PRESS_MAX_MS);
    assert.equal(earlyPressEnds({ opened: 500, shown: 500 + EARLY_PRESS_MAX_MS }), 500 + EARLY_PRESS_MAX_MS);
  });

  it('lets other keys and synthetic presses through, and always stops repeats', () => {
    const times = { opened: 0, shown: 0 };
    assert.equal(blocksEarlyPress(times, 10, { key: 'Escape', repeat: false, isTrusted: true }), false);
    assert.equal(blocksEarlyPress(times, 10, { key: 'Tab', repeat: false, isTrusted: true }), false);
    assert.equal(blocksEarlyPress(times, 10, { ...enter, isTrusted: false }), false);
    assert.equal(blocksEarlyPress(times, 10_000, { ...enter, repeat: true }), true);
    assert.equal(blocksEarlyPress(times, 10_000, enter), false);
  });
});

const APPLE = 'Apple Computer, Inc.';

describe('isTextField', () => {
  it('is true for input, textarea, select and contentEditable', () => {
    assert.equal(isTextField({ tagName: 'INPUT', isContentEditable: false }), true);
    assert.equal(isTextField({ tagName: 'TEXTAREA', isContentEditable: false }), true);
    assert.equal(isTextField({ tagName: 'SELECT', isContentEditable: false }), true);
    assert.equal(isTextField({ tagName: 'DIV', isContentEditable: true }), true);
  });

  it('is false for a button, a plain div and a missing target', () => {
    assert.equal(isTextField({ tagName: 'BUTTON', isContentEditable: false }), false);
    assert.equal(isTextField({ tagName: 'DIV', isContentEditable: false }), false);
    assert.equal(isTextField(null), false);
  });
});

describe('Safari late Enter', () => {
  it('matches an Apple confirming Enter inside the window and only once', () => {
    const tracker = createLateEnterTracker();
    tracker.compositionEnded({ timeStamp: 1_000 });
    assert.equal(tracker.isLateEnter({ key: 'Enter', timeStamp: 1_000 + SAFARI_LATE_ENTER_MS - 1 }, APPLE), true);
    assert.equal(tracker.isLateEnter({ key: 'Enter', timeStamp: 1_010 }, APPLE), false);
  });

  it('does not match at the window boundary, off Apple, or for a modified Enter', () => {
    assert.equal(isSafariLateEnter(SAFARI_LATE_ENTER_MS, APPLE), false);
    assert.equal(isSafariLateEnter(0, 'Google Inc.'), false);
    const tracker = createLateEnterTracker();
    tracker.compositionEnded({ timeStamp: 1_000 });
    assert.equal(tracker.isLateEnter({ key: 'Enter', timeStamp: 1_000 }, 'Google Inc.'), false);
    tracker.compositionEnded({ timeStamp: 2_000 });
    assert.equal(tracker.isLateEnter({ key: 'Enter', timeStamp: 2_000 + SAFARI_LATE_ENTER_MS }, APPLE), false);
    tracker.compositionEnded({ timeStamp: 3_000 });
    assert.equal(tracker.isLateEnter({ key: 'Enter', timeStamp: 3_010, metaKey: true }, APPLE), false);
    assert.equal(tracker.isLateEnter({ key: 'Enter', timeStamp: 3_020, ctrlKey: true }, APPLE), false);
    // Cmd/Ctrl+Enter never entered the tracker, so the confirming Enter is still there.
    assert.equal(tracker.isLateEnter({ key: 'Enter', timeStamp: 3_030 }, APPLE), true);
  });

  it('records compositionend once: a replayed key does not move the end time', () => {
    const tracker = createLateEnterTracker();
    tracker.compositionEnded({ timeStamp: 1_000 });
    tracker.compositionEnded({ timeStamp: 9_000, isReplayed: true });
    assert.equal(tracker.isLateEnter({ key: 'Enter', timeStamp: 1_200, isReplayed: true }, APPLE), false);
    assert.equal(tracker.isLateEnter({ key: 'Enter', timeStamp: 1_200 }, APPLE), true);
  });

  it('honours a shorter window when one is passed', () => {
    const tracker = createLateEnterTracker(50);
    tracker.compositionEnded({ timeStamp: 100 });
    assert.equal(tracker.isLateEnter({ key: 'Enter', timeStamp: 140 }, APPLE), true);
    tracker.compositionEnded({ timeStamp: 100 });
    assert.equal(tracker.isLateEnter({ key: 'Enter', timeStamp: 160 }, APPLE), false);
  });
});

describe('shouldYieldWindowShortcut', () => {
  const blank = { tagName: 'DIV', isContentEditable: false, closest: () => null };

  it('yields on a text field, while composing, when already handled, and inside a menu or dialog', () => {
    assert.equal(shouldYieldWindowShortcut({ defaultPrevented: false, target: { tagName: 'INPUT', isContentEditable: false, closest: () => null } }), true);
    assert.equal(shouldYieldWindowShortcut({ defaultPrevented: false, isComposing: true, target: blank }), true);
    assert.equal(shouldYieldWindowShortcut({ defaultPrevented: false, keyCode: 229, target: blank }), true);
    assert.equal(shouldYieldWindowShortcut({ defaultPrevented: true, target: blank }), true);
    assert.equal(shouldYieldWindowShortcut({ defaultPrevented: false, target: { tagName: 'DIV', isContentEditable: false, closest: () => ({}) } }), true);
  });

  it('does not yield for Escape on the shell background', () => {
    assert.equal(shouldYieldWindowShortcut({ defaultPrevented: false, target: blank }), false);
    assert.equal(shouldYieldWindowShortcut({ defaultPrevented: false, target: null }), false);
  });
});
