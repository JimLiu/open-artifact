import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canOpenLink,
  LINK_CARD_COOLDOWN_MS,
  LINK_CARD_GAP_PX,
  LINK_CARD_MARGIN_PX,
  LINK_CARD_SHOW_MS,
  linkAddressParts,
  linkBoxMoved,
  linkCardPlace,
  linkCardShowDelay,
  linkClickAction,
  placeLinkCard,
  pressIsClick,
  shownLink,
  TAP_MAX_MOVE_PX,
  TAP_MAX_MS,
} from '../src/link-card.ts';

describe('link card', () => {
  it('shows the site first and opens only web and mail addresses', () => {
    assert.deepEqual(shownLink('https://www.example.com/docs?q=1'), { site: 'example.com', rest: '/docs?q=1' });
    assert.deepEqual(shownLink('https://example.com/'), { site: 'example.com', rest: '' });
    assert.deepEqual(shownLink('mailto:a%40b@example.com'), { site: 'a@b@example.com', rest: '' });
    assert.deepEqual(shownLink('components/Button/README.md'), { site: 'components/Button/README.md', rest: '' });
    assert.deepEqual(shownLink('mailto:%E0%A4%A'), { site: '%E0%A4%A', rest: '' });
    assert.ok(canOpenLink('http://127.0.0.1:4000/project/README.md'));
    assert.ok(canOpenLink('mailto:a@example.com'));
    assert.ok(!canOpenLink('javascript:alert(1)'));
    assert.ok(!canOpenLink('README.md'));
  });

  it('places the card below the link, or above when the window ends', () => {
    const card = { width: 200, height: 40 };
    assert.deepEqual(placeLinkCard({ top: 100, bottom: 120, left: 50 }, card, { width: 800, height: 600 }), { top: 126, left: 50 });
    assert.deepEqual(placeLinkCard({ top: 560, bottom: 580, left: 700 }, card, { width: 800, height: 600 }), { top: 514, left: 594 });
    assert.deepEqual(placeLinkCard({ top: 10, bottom: 30, left: 0 }, card, { width: 800, height: 60 }), { top: 36, left: 6 });
  });
});

describe('read-only link card rules', () => {
  it('can leave www. and control characters out of the address', () => {
    assert.deepEqual(linkAddressParts('https://www.example.com/a?q=1', { trimWww: true, dropControls: true }), { host: 'example.com', path: '/a?q=1', full: 'https://www.example.com/a?q=1' });
    assert.deepEqual(linkAddressParts('not a url\u0007', { dropControls: true }), { host: 'not a url', path: '', full: 'not a url' });
    assert.equal(linkAddressParts('not a url\u0007').full, 'not a url�');
  });

  it('prefers the space above the link, shifted and clear of a bar', () => {
    const viewport = { w: 1000, h: 800 };
    const card = { w: 300, h: 44 };
    assert.deepEqual(linkCardPlace({ x: 100, y: 200, w: 80, h: 20 }, card, viewport, null, -8), { x: 92, y: 200 - LINK_CARD_GAP_PX - 44, side: 'above' });
    const bar = { x: 50, y: 150, w: 400, h: 40 };
    assert.equal(linkCardPlace({ x: 100, y: 200, w: 80, h: 20 }, card, viewport, bar).side, 'below');
    assert.equal(linkCardPlace({ x: 2, y: 200, w: 80, h: 20 }, card, viewport, null, -8).x, LINK_CARD_MARGIN_PX);
  });

  it('goes past the bar on the side that fits when both sides are blocked', () => {
    const viewport = { w: 1000, h: 800 };
    const card = { w: 300, h: 44 };
    const bar = { x: 50, y: 700, w: 400, h: 44 };
    assert.deepEqual(linkCardPlace({ x: 100, y: 760, w: 80, h: 20 }, card, viewport, bar), { x: 100, y: 700 - LINK_CARD_GAP_PX - 44, side: 'above' });
  });

  it('can ignore small moves of the link', () => {
    const box = { x: 10, y: 10, w: 50, h: 20 };
    assert.equal(linkBoxMoved(box, { ...box, y: 11.5 }, 2), false);
    assert.equal(linkBoxMoved(box, { ...box, y: 12.5 }, 2), true);
  });

  it('opens with Mod at once and leaves other modifiers alone', () => {
    const click = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    assert.equal(linkClickAction({ ...click, metaKey: true }, true), 'now');
    assert.equal(linkClickAction(click, false), 'later');
    assert.equal(linkClickAction({ ...click, ctrlKey: true }, true), 'none');
    assert.equal(pressIsClick({ pointerType: 'touch', ms: 400, moved: TAP_MAX_MOVE_PX }), true);
    assert.equal(pressIsClick({ pointerType: 'touch', ms: TAP_MAX_MS + 1, moved: 0 }), false);
  });

  it('waits out the pause after a link opened', () => {
    assert.equal(linkCardShowDelay(1000, null), LINK_CARD_SHOW_MS);
    assert.equal(linkCardShowDelay(1000, 900), LINK_CARD_COOLDOWN_MS - 100);
  });
});
