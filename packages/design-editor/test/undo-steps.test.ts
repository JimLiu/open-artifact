import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { closeStep, joinSteps, noteBoard, noteCanvas, openStep, touchesBoard } from '../src/lib/undo-steps.ts';
import { boardNeedsWrite, isDirty, useDocument } from '../src/state/document.ts';
import { emptyCanvas } from '@open-artifact/design-core';

const state = (source: string) => ({ source, pending: [] });

describe('gathering an undo step', () => {
  it('takes the simplest scope without a key, and files with one', () => {
    const canvas = emptyCanvas();
    const later = { ...canvas, title: 'Later' };
    const step = openStep();
    noteBoard(step, 'a', state('a0'));
    noteBoard(step, 'a', state('a1'));
    const now = { canvas, board: (path: string) => (path === 'a' ? state('a2') : null) };
    assert.deepEqual(closeStep(step, now), { scope: 'board', path: 'a', before: state('a0'), after: state('a2') });
    noteCanvas(step, canvas);
    assert.equal(closeStep(step, { ...now, canvas: later })?.scope, 'files');
    assert.equal(closeStep(openStep(), now), null);
    assert.equal(closeStep(step, now, 'nudge')?.scope, 'files');
  });

  it('joins steps with one key while each picks up where the last left off', () => {
    const first = { scope: 'files' as const, canvas: null, changes: [{ scope: 'board' as const, path: 'a', before: state('0'), after: state('1') }], key: 'k' };
    const next = { scope: 'files' as const, canvas: null, changes: [{ scope: 'board' as const, path: 'a', before: state('1'), after: state('2') }, { scope: 'board' as const, path: 'b', before: state('x'), after: state('y') }], key: 'k' };
    const joined = joinSteps(first, next);
    assert.deepEqual(joined?.changes.map((change) => [change.path, change.before.source, change.after.source]), [['a', '0', '2'], ['b', 'x', 'y']]);
    assert.equal(joinSteps(first, { ...next, key: 'other' }), null);
    assert.equal(joinSteps(first, { ...next, changes: [{ scope: 'board', path: 'a', before: state('9'), after: state('2') }] }), null);
    assert.equal(touchesBoard(next, 'b'), true);
  });
});

describe('one undo step across files', () => {
  const load = () => {
    useDocument.getState().load({ title: 'Steps', readOnly: false, canvas: { text: '{}', hash: '1' }, boards: { a: { text: 'A', hash: 'a' }, b: { text: 'B', hash: 'b' } } });
    useDocument.setState({ undo: [], redo: [] });
  };

  it('undoes and redoes changes to the canvas and two artboards together', () => {
    load();
    const doc = useDocument.getState;
    const before = doc().undo.length;
    const title = doc().canvas.title;
    doc().transact(() => {
      doc().editBoard('a', { kind: 'source', text: 'A2' });
      doc().editBoard('b', { kind: 'source', text: 'B2' });
      doc().updateCanvas((canvas) => ({ ...canvas, title: 'Moved' }));
    });
    assert.equal(doc().undo.length, before + 1);
    doc().undoLast();
    assert.deepEqual([doc().boards.a!.source, doc().boards.b!.source, doc().canvas.title], ['A', 'B', title]);
    doc().redoLast();
    assert.deepEqual([doc().boards.a!.source, doc().boards.b!.source, doc().canvas.title], ['A2', 'B2', 'Moved']);
  });

  it('joins keyed steps that follow each other (a held arrow) and records nothing for no change', () => {
    load();
    const doc = useDocument.getState;
    const before = doc().undo.length;
    doc().transact(() => doc().editBoard('a', { kind: 'source', text: 'A1' }), { key: 'nudge' });
    doc().transact(() => {
      doc().editBoard('a', { kind: 'source', text: 'A2' });
      doc().editBoard('b', { kind: 'source', text: 'B2' });
    }, { key: 'nudge' });
    doc().transact(() => undefined);
    assert.equal(doc().undo.length, before + 1);
    doc().undoLast();
    assert.deepEqual([doc().boards.a!.source, doc().boards.b!.source], ['A', 'B']);
  });

  it('closes the step when the work throws', () => {
    load();
    const doc = useDocument.getState;
    assert.throws(() => doc().transact(() => {
      doc().editBoard('a', { kind: 'source', text: 'A3' });
      throw new Error('stop');
    }));
    doc().editBoard('b', { kind: 'source', text: 'B3' });
    assert.deepEqual(doc().undo.slice(-2).map((entry) => entry.scope), ['board', 'board']);
  });

  it('drops a step when someone else changes one of its artboards', () => {
    load();
    const doc = useDocument.getState;
    doc().transact(() => {
      doc().editBoard('a', { kind: 'source', text: 'A2' });
      doc().updateCanvas((canvas) => ({ ...canvas, title: 'T' }));
    });
    doc().editBoard('b', { kind: 'source', text: 'B2' });
    doc().remoteBoard('a', 'Theirs', 'z');
    assert.deepEqual(doc().undo.map((entry) => entry.scope), ['board']);
  });
});

describe('artboard files through undo', () => {
  it('deletes a made artboard’s file again when its making is undone, and keeps it when redone', () => {
    useDocument.getState().load({ title: 'Steps', readOnly: false, canvas: { text: '{}', hash: '1' }, boards: {} });
    useDocument.setState({ undo: [], redo: [] });
    const doc = useDocument.getState;
    doc().createBoard('Piece.dc.html', '<div></div>', { x: 0, y: 0, w: 10, h: 10, frameless: true });
    // Saved: the server has it now.
    useDocument.setState({ boards: { 'Piece.dc.html': { ...doc().boards['Piece.dc.html']!, saved: '<div></div>', hash: 'h' } } });
    doc().undoLast();
    assert.deepEqual(doc().trash, ['Piece.dc.html']);
    doc().redoLast();
    assert.deepEqual(doc().trash, []);
    assert.ok('Piece.dc.html' in doc().canvas.boards);
  });

  it('brings back an artboard deleted in a step with other changes', () => {
    useDocument.getState().load({ title: 'Steps', readOnly: false, canvas: { text: JSON.stringify({ boards: { 'p.dc.html': { x: 0, y: 0, w: 5, h: 5 } }, order: ['p.dc.html'] }), hash: '1' }, boards: { 'p.dc.html': { text: '<i></i>', hash: 'p' }, a: { text: 'A', hash: 'a' } } });
    useDocument.setState({ undo: [], redo: [] });
    const doc = useDocument.getState;
    doc().transact(() => {
      doc().editBoard('a', { kind: 'source', text: 'A2' });
      doc().deleteBoards(['p.dc.html']);
    });
    assert.deepEqual(doc().trash, ['p.dc.html']);
    doc().undoLast();
    assert.deepEqual([doc().trash, doc().boards.a!.source, 'p.dc.html' in doc().canvas.boards], [[], 'A', true]);
  });
});

describe('a deleted artboard once its deleting is saved', () => {
  it('is not written back by the next save, and is written again once undo puts it back', () => {
    useDocument.getState().load({ title: 'Steps', readOnly: false, canvas: { text: JSON.stringify({ boards: { 'p.dc.html': { x: 0, y: 0, w: 5, h: 5 } }, order: ['p.dc.html'] }), hash: '1' }, boards: { 'p.dc.html': { text: '<i></i>', hash: 'p' } } });
    useDocument.setState({ undo: [], redo: [] });
    const doc = useDocument.getState;
    doc().editBoard('p.dc.html', { kind: 'source', text: '<b></b>' });
    doc().deleteBoards(['p.dc.html']);
    // The save deleted the file (and wrote the canvas).
    doc().acknowledge({ canvas: { canvas: doc().canvas, text: '' }, boards: {}, deleted: ['p.dc.html'] }, { 'canvas.json': '2' });
    // Before, it left the trash with its source unsaved, so the next save wrote the file again.
    assert.equal(boardNeedsWrite(doc(), 'p.dc.html', doc().boards['p.dc.html']!), false);
    assert.equal(isDirty(doc()), false);
    doc().undoLast();
    assert.ok('p.dc.html' in doc().canvas.boards);
    assert.equal(boardNeedsWrite(doc(), 'p.dc.html', doc().boards['p.dc.html']!), true);
  });

  it('leaves the trash when someone writes its file again, so no save deletes their file', () => {
    useDocument.getState().load({ title: 'Steps', readOnly: false, canvas: { text: JSON.stringify({ boards: { 'p.dc.html': { x: 0, y: 0, w: 5, h: 5 } }, order: ['p.dc.html'] }), hash: '1' }, boards: { 'p.dc.html': { text: '<i></i>', hash: 'p' } } });
    const doc = useDocument.getState;
    doc().deleteBoards(['p.dc.html']);
    doc().acknowledge({ canvas: { canvas: doc().canvas, text: '' }, boards: {}, deleted: ['p.dc.html'] }, { 'canvas.json': '2' });
    assert.ok(doc().trash.includes('p.dc.html'));
    doc().remoteBoard('p.dc.html', '<u></u>', 'q');
    assert.equal(doc().trash.includes('p.dc.html'), false);
  });
});

describe('cancelling a step', () => {
  it('takes back what the step changed and records nothing', () => {
    useDocument.getState().load({ title: 'Steps', readOnly: false, canvas: { text: '{}', hash: '1' }, boards: { a: { text: 'A', hash: 'a' }, b: { text: 'B', hash: 'b' } } });
    useDocument.setState({ undo: [], redo: [] });
    const doc = useDocument.getState;
    const value = doc().transact((cancel) => {
      doc().editBoard('a', { kind: 'source', text: 'A2' });
      doc().editBoard('b', { kind: 'source', text: 'B2' });
      cancel();
      return 'kept';
    });
    assert.equal(value, 'kept');
    assert.deepEqual([doc().boards.a!.source, doc().boards.b!.source, doc().undo.length], ['A', 'B', 0]);
  });
});
