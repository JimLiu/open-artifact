import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { noteBounds, noteTextOf, staggeredSpot, textLines, textNoteSize } from '../src/lib/notes.ts';

describe('pasted text notes', () => {
  it('keeps one kind of line break and drops blank lines around the text', () => {
    assert.equal(noteTextOf('one\r\ntwo\rthree\n'), 'one\ntwo\nthree');
    assert.equal(noteTextOf('\n\n  indented\nnext  \n\n'), '  indented\nnext');
    assert.equal(noteTextOf(' \n \t'), '');
  });

  it('sizes the box by its widest line, up to a limit, and its lines', () => {
    const measure = (line: string) => line.length * 10;
    assert.deepEqual(textNoteSize('abc\nabcdef', 24, measure, 1200), { w: 60, h: Math.ceil(24 * 1.35 * 2) });
    assert.deepEqual(textNoteSize('x'.repeat(500), 24, measure, 1200), { w: 1200, h: Math.ceil(24 * 1.35) });
    assert.equal(textNoteSize('', 24, measure, 1200).w, 1, 'never zero wide');
  });

  it('steps aside from a note that starts at the same spot', () => {
    assert.deepEqual(staggeredSpot({ x: 100.4, y: 50 }, []), { x: 100, y: 50 });
    assert.deepEqual(staggeredSpot({ x: 100, y: 50 }, [{ x: 102, y: 49 }]), { x: 124, y: 74 });
    assert.deepEqual(staggeredSpot({ x: 100, y: 50 }, [{ x: 100, y: 50 }, { x: 124, y: 74 }]), { x: 148, y: 98 });
    assert.deepEqual(staggeredSpot({ x: 100, y: 50 }, [{ x: 300, y: 50 }]), { x: 100, y: 50 });
  });

  it('counts the lines of a title', () => {
    assert.equal(textLines(undefined), 1);
    assert.equal(textLines('a\nb\nc'), 3);
    assert.equal(noteBounds({ x: 0, y: 0, kind: 'title1', size: 'm', text: 'a\nb' }).h, 24 * 1.3 * 2);
  });
});
