import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptySlide, newDeckIndex } from '@open-artifact/slides-core';
import { playableSlides } from '../src/services/present.ts';
import { type SlideEntry, useDeck } from '../src/state/deck.ts';

function entry(id: string, extra: Partial<SlideEntry> = {}): SlideEntry {
  const slide = emptySlide(id);
  return { slide, saved: slide, savedText: '', hash: 'h', diagnostics: [], ...extra };
}

describe('playableSlides', () => {
  it('skips hidden, held and conflicted slides', () => {
    const before = useDeck.getState();
    const hidden = emptySlide('b');
    hidden.hidden = true;
    try {
      useDeck.setState({
        index: { ...newDeckIndex(), order: ['a', 'b', 'c', 'd'] },
        slides: {
          a: entry('a'),
          b: { ...entry('b'), slide: hidden, saved: hidden },
          c: entry('c', { held: 'errors' }),
          d: entry('d', { conflict: { theirsText: '<section id="d"></section>', theirsHash: 't', theirsSlide: emptySlide('d'), reason: 'changed' } }),
        },
      });
      assert.deepEqual(playableSlides(), ['a']);
    } finally {
      useDeck.setState({ index: before.index, slides: before.slides });
    }
  });
});
