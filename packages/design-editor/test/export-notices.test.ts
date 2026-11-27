import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BLANK_TAIL_NOTICE, blankTail, blankTailNotice } from '../src/lib/export-notices.ts';

describe('blank space below an artboard’s content', () => {
  it(`is worth a notice from ${BLANK_TAIL_NOTICE} px`, () => {
    assert.equal(blankTail(1080, 300), 780);
    assert.equal(blankTail(1080, 1080 - BLANK_TAIL_NOTICE), BLANK_TAIL_NOTICE);
    assert.equal(blankTail(1080, 1080 - BLANK_TAIL_NOTICE + 1), null);
    assert.equal(blankTail(1080, 0), null, 'nothing measured');
  });

  it('names one artboard with the blank space rounded to 10 px', () => {
    assert.equal(blankTailNotice([]), null);
    assert.equal(blankTailNotice([{ name: 'Home', tail: 784 }]), '“Home”’s frame is about 780 px taller than its content, so the file ends with that much blank space.');
  });

  it('names up to three artboards and counts more, with the largest blank space', () => {
    assert.equal(
      blankTailNotice([
        { name: 'Home', tail: 450 },
        { name: 'About', tail: 916 },
      ]),
      '“Home”, “About” have frames taller than their content (by up to about 920 px), so each ends with blank space in the file.',
    );
    assert.equal(
      blankTailNotice([
        { name: 'A', tail: 400 },
        { name: 'B', tail: 500 },
        { name: 'C', tail: 600 },
      ]),
      '“A”, “B”, “C” have frames taller than their content (by up to about 600 px), so each ends with blank space in the file.',
    );
    assert.equal(
      blankTailNotice(['A', 'B', 'C', 'D'].map((name, i) => ({ name, tail: 400 + i * 101 }))),
      '4 artboards have frames taller than their content (by up to about 700 px), so each ends with blank space in the file.',
    );
  });
});
