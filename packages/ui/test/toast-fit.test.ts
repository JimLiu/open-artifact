import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TOAST_BODY_FLOOR_PX, toastBodyLimit } from '../src/toast-fit.ts';

describe('toast height limit', () => {
  it('leaves the column alone while it fits', () => {
    assert.equal(toastBodyLimit([], 800, 8), null);
    assert.equal(toastBodyLimit([{ chrome: 24, content: 40 }], 800, 8), null);
    assert.equal(toastBodyLimit([{ chrome: 24, content: 360 }, { chrome: 24, content: 384 }], 800, 8), null);
  });

  it('holds a single long toast to the room above it', () => {
    assert.equal(toastBodyLimit([{ chrome: 24, content: 2000 }], 800, 8), 776);
  });

  it('keeps short toasts whole and gives a long one what they leave', () => {
    const limit = toastBodyLimit(
      [
        { chrome: 24, content: 40 },
        { chrome: 24, content: 3000 },
        { chrome: 24, content: 60 },
      ],
      800,
      8,
    );
    assert.equal(limit, 800 - 16 - 72 - 40 - 60);
  });

  it('shares the room evenly between long toasts', () => {
    const toasts = [
      { chrome: 24, content: 900 },
      { chrome: 24, content: 40 },
      { chrome: 24, content: 1500 },
    ];
    const limit = toastBodyLimit(toasts, 800, 8);
    assert.equal(limit, Math.floor((800 - 16 - 72 - 40) / 2));
    const height = toasts.reduce((sum, t) => sum + t.chrome + Math.min(t.content, limit!), 0) + 16;
    assert.ok(height <= 800);
  });

  it('gives the same answer for the same toasts in any order', () => {
    const a = [{ chrome: 24, content: 700 }, { chrome: 30, content: 120 }, { chrome: 24, content: 500 }];
    assert.equal(toastBodyLimit(a, 600, 8), toastBodyLimit([...a].reverse(), 600, 8));
  });

  it('never holds text below the floor, even when the column cannot fit', () => {
    const many = Array.from({ length: 12 }, () => ({ chrome: 24, content: 400 }));
    assert.equal(toastBodyLimit(many, 300, 8), TOAST_BODY_FLOOR_PX);
  });
});
