import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clearedLine, exportWarning, warningSpeech } from '../src/services/export/warning.ts';

describe('the download warning', () => {
  it('is empty when nothing will be missing', () => {
    assert.deepEqual(exportWarning({ writing: null, held: [] }), []);
  });

  it('warns while the deck is still being written', () => {
    const [part, ...rest] = exportWarning({ writing: { written: 3, planned: 8 }, held: [] });
    assert.equal(rest.length, 0);
    assert.equal(part!.kind, 'writing');
    assert.equal(part!.line, 'Only 3 of 8 slides are written so far. The download will have just those.');
  });

  it('names the slides with errors, which are left out', () => {
    assert.equal(exportWarning({ writing: null, held: [4] })[0]!.line, 'Slide 4 has errors and will be left out.');
    const many = exportWarning({ writing: null, held: [7, 2, 7] })[0]!;
    assert.equal(many.line, 'Slides 2 and 7 have errors and will be left out.');
    assert.equal(many.say, '2 slides will be left out.');
  });

  it('puts both together, writing first', () => {
    const parts = exportWarning({ writing: { written: 1, planned: 2 }, held: [1] });
    assert.deepEqual(
      parts.map((part) => part.kind),
      ['writing', 'held'],
    );
  });
});

describe('reading the warning out', () => {
  const writing = exportWarning({ writing: { written: 3, planned: 8 }, held: [] });
  const moreWritten = exportWarning({ writing: { written: 5, planned: 8 }, held: [] });
  const held = exportWarning({ writing: null, held: [4] });
  const both = exportWarning({ writing: { written: 3, planned: 8 }, held: [4] });

  it('says a warning that appears', () => {
    assert.equal(warningSpeech([], held), '1 slide will be left out.');
  });

  it('stays quiet while only the counts of a writing deck change', () => {
    assert.equal(warningSpeech(writing, moreWritten), null);
    assert.equal(warningSpeech(held, held), null);
  });

  it('says a part that changes what it says', () => {
    assert.equal(warningSpeech(held, exportWarning({ writing: null, held: [4, 6] })), '2 slides will be left out.');
  });

  it('says what cleared, one part or both', () => {
    assert.equal(warningSpeech(writing, []), 'Every slide is written now.');
    assert.equal(warningSpeech(both, held), 'Every slide is written now.');
    assert.equal(warningSpeech(both, []), 'Every slide is written now. Every slide can be included now.');
  });

  it('says what appeared before what cleared', () => {
    assert.equal(warningSpeech(writing, held), '1 slide will be left out. Every slide is written now.');
  });

  it('shows what cleared once nothing is left', () => {
    assert.equal(clearedLine(both), 'Every slide is written now. Every slide can be included now.');
    assert.equal(clearedLine([]), null);
  });
});
