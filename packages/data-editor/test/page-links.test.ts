import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { leavingLinkHref, linkLineBox } from '../src/page/links.ts';

describe('page links that lead away', () => {
  const base = 'https://dash.example/view/1';
  const origin = 'https://dash.example';

  it('are web addresses on another origin', () => {
    assert.equal(leavingLinkHref('https://www.example.com/a?b=1', base, origin), 'https://www.example.com/a?b=1');
    assert.equal(leavingLinkHref('  http://example.org  ', base, origin), 'http://example.org/');
    assert.equal(leavingLinkHref('//example.org/x', base, origin), 'https://example.org/x');
  });

  it('leave out fragments, this origin, other schemes and what doesn’t parse', () => {
    assert.equal(leavingLinkHref('#totals', base, origin), null);
    assert.equal(leavingLinkHref(' #totals', base, origin), null);
    assert.equal(leavingLinkHref('/other', base, origin), null);
    assert.equal(leavingLinkHref('https://dash.example/x', base, origin), null);
    assert.equal(leavingLinkHref('mailto:someone@example.com', base, origin), null);
    assert.equal(leavingLinkHref('javascript:void 0', base, origin), null);
    assert.equal(leavingLinkHref('https://[nope', base, origin), null);
    assert.equal(leavingLinkHref('', base, origin), null);
    assert.equal(leavingLinkHref(null, base, origin), null);
  });
});

describe('the line a link card belongs to', () => {
  const lines = [
    { x: 300, y: 100, w: 200, h: 20 },
    { x: 0, y: 124, w: 120, h: 20 },
  ];

  it('is the line under the pointer, the nearest between lines', () => {
    assert.deepEqual(linkLineBox(lines, { x: 40, y: 130 }), lines[1]);
    assert.deepEqual(linkLineBox(lines, { x: 400, y: 110 }), lines[0]);
    assert.deepEqual(linkLineBox(lines, { x: 40, y: 123 }), lines[1]);
  });

  it('is the first line from the keyboard, and none for a link that draws nothing', () => {
    assert.deepEqual(linkLineBox(lines, null), lines[0]);
    assert.equal(linkLineBox([{ x: 0, y: 0, w: 0, h: 0 }], null), null);
  });
});
