import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canMark, hasMark, lineListOf, setLineList, toggleMark } from '../src/lib/note-typing.ts';
import { inlineRuns } from '../src/lib/notes.ts';

/** The words a selection covers, read back from an edit. */
const picked = (edit: { text: string; start: number; end: number }) => edit.text.slice(edit.start, edit.end);

describe('toggleMark', () => {
  it('wraps the selected words and keeps them selected', () => {
    const text = 'make it bold now';
    const edit = toggleMark(text, 5, 12, 'bold');
    assert.equal(edit.text, 'make **it bold** now');
    assert.equal(picked(edit), 'it bold');
    assert.equal(hasMark(edit.text, edit.start, edit.end, 'bold'), true);
  });

  it('takes the mark off when every selected word has it', () => {
    const edit = toggleMark('make **it bold** now', 7, 14, 'bold');
    assert.equal(edit.text, 'make it bold now');
    assert.equal(picked(edit), 'it bold');
  });

  it('reads a selection that takes in the marks as marked', () => {
    assert.equal(hasMark('make **it** now', 5, 11, 'bold'), true);
    assert.equal(toggleMark('make **it** now', 5, 11, 'bold').text, 'make it now');
  });

  it('marks the rest when part of the selection already has it', () => {
    const edit = toggleMark('a **b** c', 0, 9, 'bold');
    assert.equal(edit.text, '**a b c**');
    assert.equal(picked(edit), 'a b c');
  });

  it('takes the mark off part of a marked run', () => {
    const edit = toggleMark('**abc def**', 2, 5, 'bold');
    assert.equal(edit.text, 'abc** def**');
    assert.equal(picked(edit), 'abc');
  });

  it('adds italic to bold words as both, and reads both back', () => {
    const edit = toggleMark('**word**', 2, 6, 'italic');
    assert.equal(edit.text, '***word***');
    assert.deepEqual(inlineRuns(edit.text), [{ text: 'word', bold: true, italic: true }]);
    assert.equal(hasMark(edit.text, edit.start, edit.end, 'bold'), true);
    assert.equal(hasMark(edit.text, edit.start, edit.end, 'italic'), true);
    assert.equal(toggleMark(edit.text, edit.start, edit.end, 'bold').text, '*word*');
  });

  it('with nothing selected, acts on the word at the caret and keeps the caret in it', () => {
    const edit = toggleMark('one two three', 5, 5, 'italic');
    assert.equal(edit.text, 'one *two* three');
    assert.equal(edit.start, edit.end);
    assert.equal(edit.text.slice(0, edit.start), 'one *t');
    assert.equal(canMark('one  two', 4, 4), false, 'a caret between two spaces has no word');
    assert.deepEqual(toggleMark('one  two', 4, 4, 'bold'), { text: 'one  two', start: 4, end: 4 });
  });

  it('marks each selected line on its own and leaves spaces at the ends out', () => {
    const edit = toggleMark(' one\ntwo ', 0, 9, 'bold');
    assert.equal(edit.text, ' **one**\n**two** ');
  });

  it('leaves code and links as they are', () => {
    const edit = toggleMark('see `x` here', 0, 12, 'bold');
    assert.equal(edit.text, '**see **`x`** here**');
    assert.equal(hasMark('see `x` here', 4, 7, 'bold'), false);
    assert.equal(canMark('see `x` here', 4, 7), false, 'a code span takes no marks');
  });

  it('moves a selection on a later line by what the earlier line gained', () => {
    const text = 'aa bb\ncc';
    const edit = toggleMark(text, 0, 2, 'bold');
    assert.equal(edit.text, '**aa** bb\ncc');
  });
});

describe('line lists', () => {
  it('reads the kind of list the selected lines make', () => {
    const text = '- one\n- two\n3. three\nplain';
    assert.equal(lineListOf(text, 0, 0), 'bullet');
    assert.equal(lineListOf(text, 0, 9), 'bullet');
    assert.equal(lineListOf(text, 12, 12), 'number');
    assert.equal(lineListOf(text, 0, 15), 'none', 'mixed lines are no one list');
    assert.equal(lineListOf(text, 25, 25), 'none');
  });

  it('leaves out the line a selection only reaches the start of', () => {
    assert.equal(lineListOf('- one\ntwo', 0, 6), 'bullet');
  });

  it('turns lines into a bulleted list and keeps the caret on its words', () => {
    const edit = setLineList('one\ntwo', 0, 7, 'bullet');
    assert.equal(edit.text, '- one\n- two');
    assert.equal(picked(edit), 'one\n- two');
  });

  it('swaps bullets for numbers from 1, and back to plain lines', () => {
    const numbered = setLineList('- one\n- two', 0, 11, 'number');
    assert.equal(numbered.text, '1. one\n2. two');
    const plain = setLineList(numbered.text, numbered.start, numbered.end, 'none');
    assert.equal(plain.text, 'one\ntwo');
  });

  it('keeps an indent and leaves other lines alone', () => {
    const edit = setLineList('top\n  - inner\nlast', 6, 6, 'number');
    assert.equal(edit.text, 'top\n  1. inner\nlast');
    assert.equal(edit.start, 9, 'a caret in the old marker goes to the end of the new one');
  });

  it('moves a caret after the marker with the words', () => {
    const edit = setLineList('- one', 3, 3, 'number');
    assert.equal(edit.text, '1. one');
    assert.equal(edit.text.slice(edit.start), 'ne');
  });
});
