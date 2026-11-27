import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { linkPromptBox } from '../src/lib/link-prompt.ts';

const view = { width: 1000, height: 800 };

describe('where the link field opened by the link key sits', () => {
  it('is the selected text’s box when it is in view', () => {
    assert.deepEqual(linkPromptBox({ x: 200, y: 300, width: 120, height: 20 }, view), { x: 200, y: 300, width: 120, height: 20 });
  });

  it('cuts a selection running past an edge to the part in view', () => {
    assert.deepEqual(linkPromptBox({ x: 900, y: -40, width: 300, height: 60 }, view), { x: 900, y: 8, width: 92, height: 12 });
  });

  it('pins a selection scrolled out of view to the nearest edge', () => {
    assert.deepEqual(linkPromptBox({ x: 100, y: 900, width: 50, height: 20 }, view), { x: 100, y: 792, width: 50, height: 0 });
    assert.deepEqual(linkPromptBox({ x: -300, y: 100, width: 50, height: 20 }, view), { x: 8, y: 100, width: 0, height: 20 });
  });
});
