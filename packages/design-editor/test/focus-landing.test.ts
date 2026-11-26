import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LANDING_TRIES, LANDING_WINDOW_MS, landingDone, shouldLandFocus } from '../src/lib/focus-landing.ts';

describe('focus landing after a dismissal', () => {
  const base = { since: 1000, now: 1200, onBody: true, interacted: false };

  it('lands when focus fell to the body soon after', () => {
    assert.equal(shouldLandFocus(base), true);
    assert.equal(shouldLandFocus({ ...base, now: 1000 + LANDING_WINDOW_MS }), true);
  });

  it('leaves focus alone once the person acts, focus is elsewhere, or time is up', () => {
    assert.equal(shouldLandFocus({ ...base, interacted: true }), false);
    assert.equal(shouldLandFocus({ ...base, onBody: false }), false);
    assert.equal(shouldLandFocus({ ...base, now: 1001 + LANDING_WINDOW_MS }), false);
  });

  it('stops looking after enough tries', () => {
    assert.equal(landingDone(base, 1), false);
    assert.equal(landingDone(base, LANDING_TRIES), true);
    assert.equal(landingDone({ ...base, onBody: false }, 1), true);
    assert.equal(landingDone({ ...base, interacted: true }, 1), true);
  });
});
