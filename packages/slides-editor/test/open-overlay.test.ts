import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { anyOverlayOpen, type OverlayElement } from '../src/lib/open-overlay.ts';

/** An element that matches the selectors listed in `is`. */
const el = (...is: string[]): OverlayElement => ({ matches: (selector) => selector.split(',').some((part) => is.includes(part.trim())) });
const nowhere = (): boolean => false;

describe('open overlay', () => {
  it('sees an open menu, popover or dialog', () => {
    assert.equal(anyOverlayOpen([], nowhere), false);
    assert.equal(anyOverlayOpen([el()], nowhere), true);
  });

  it('skips a popup on its way out or hidden', () => {
    assert.equal(anyOverlayOpen([el('[data-ending-style]')], nowhere), false);
    assert.equal(anyOverlayOpen([el('[data-closed]')], nowhere), false);
    assert.equal(anyOverlayOpen([el('[hidden]'), el()], nowhere), true);
  });

  it('counts the link card only while the focus is in it', () => {
    const card = el('[data-link-card]');
    assert.equal(anyOverlayOpen([card], nowhere), false);
    assert.equal(anyOverlayOpen([card], (e) => e === card), true);
  });
});
