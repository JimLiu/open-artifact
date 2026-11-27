import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildViewContext,
  checkDesignProject,
  MAX_INDEX_BYTES,
  MAX_PROJECT_BYTES,
  MAX_PROJECT_FILES,
  emptyCanvas,
  layoutRows,
  mergeCanvas,
  mergeOrder,
  moveCanvasPage,
  boardsOnPage,
  restackBoards,
  notesOnPage,
  normalizeCanvas,
  placeNewBoard,
  serializeCanvas,
  validateViewContext,
} from '../src/index.ts';

const MAIN = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Main</title>
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<div><h1>Hi</h1></div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":800,"height":600}}'>
class Component extends DCLogic {}
</script>
</body>
</html>
`;

describe('canvas', () => {
  it('normalizes and keeps unknown keys', () => {
    const canvas = normalizeCanvas({ v: 3, boards: { 'A.dc.html': { x: 0, y: 0, w: 10, h: 99999, custom: 1 } }, order: ['B.dc.html'], extra: { keep: true } });
    assert.deepEqual(canvas.order, ['A.dc.html']);
    assert.equal(canvas.boards['A.dc.html']!.w, 40);
    assert.equal(canvas.boards['A.dc.html']!.h, 8000);
    assert.equal(canvas.boards['A.dc.html']!.custom, 1);
    assert.deepEqual(canvas.extra, { keep: true });
  });

  it('keeps every note however many there are', () => {
    const notes: Record<string, { x: number; y: number; text: string }> = {};
    for (let i = 0; i < 1500; i++) notes[`n${i}`] = { x: i, y: 0, text: 'note' };
    const canvas = normalizeCanvas({ v: 3, boards: {}, notes });
    assert.equal(Object.keys(canvas.notes).length, 1500);
    assert.equal(canvas.notes.n1499!.x, 1499);
  });

  it('round trips endpoints after moving a line and preserves link and guide metadata', () => {
    const canvas = normalizeCanvas({
      boards: { 'Main.dc.html': { guides: [{ kind: 'grid', hidden: true, extra: 3 }] } },
      notes: { line: { x: 50, y: 80, x2: 10, y2: -10, headStart: 'open', kind: 'arrow' }, card: { x: 3, y: 4, kind: 'link', title: 'Deck', href: 'deck', linkKind: 'slides' } },
    });
    assert.deepEqual(canvas.notes.line!.points, [[0, 0], [-40, -90]]);
    canvas.notes.line!.x += 5;
    const saved = JSON.parse(serializeCanvas(canvas));
    assert.deepEqual(saved.notes.line, { x: 55, y: 80, x2: 15, y2: -10, headStart: 'open', kind: 'arrow' });
    assert.equal(saved.notes.card.title, 'Deck');
    assert.deepEqual(saved.boards['Main.dc.html'].guides, [{ kind: 'grid', hidden: true, extra: 3 }]);
    assert.deepEqual(normalizeCanvas(saved), canvas);
  });

  it('places and lays out boards with the standard gaps', () => {
    const canvas = normalizeCanvas({ boards: { 'A.dc.html': { x: 0, y: 0, w: 400, h: 300 } } });
    assert.deepEqual(placeNewBoard(canvas, null, { w: 400, h: 300 }), { x: 480, y: 0 });
    canvas.boards['B.dc.html'] = { x: 0, y: 0, w: 400, h: 200 };
    canvas.boards['C.dc.html'] = { x: 0, y: 0, w: 400, h: 200 };
    assert.deepEqual(layoutRows(canvas, ['A.dc.html', 'B.dc.html', 'C.dc.html'], 900), {
      'A.dc.html': { x: 0, y: 0 },
      'B.dc.html': { x: 480, y: 0 },
      'C.dc.html': { x: 0, y: 420 },
    });
  });

  it('merges three ways by key', () => {
    const base = normalizeCanvas({ title: 'T', boards: { 'A.dc.html': { x: 0, y: 0, w: 100, h: 100 } }, notes: {} });
    const ours = structuredClone(base);
    ours.boards['A.dc.html']!.x = 50;
    ours.boards['B.dc.html'] = { x: 200, y: 0, w: 100, h: 100 };
    ours.order.push('B.dc.html');
    const theirs = structuredClone(base);
    theirs.title = 'Renamed';
    theirs.notes.n1 = { x: 0, y: -300, text: 'Flows', kind: 'title1' };
    const merged = mergeCanvas(base, ours, theirs);
    assert.equal(merged.title, 'Renamed');
    assert.equal(merged.boards['A.dc.html']!.x, 50);
    assert.deepEqual(merged.order, ['A.dc.html', 'B.dc.html']);
    assert.equal(merged.notes.n1!.text, 'Flows');
    assert.deepEqual(mergeOrder(['a', 'b', 'c'], ['a', 'x', 'b'], ['c', 'b', 'a', 'y']), ['b', 'a', 'x', 'y']);
  });
});

describe('page order', () => {
  const sample = () => normalizeCanvas({
    pages: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }, { id: 'p3', name: 'Three' }],
    boards: {
      'A.dc.html': { x: 0, y: 0, w: 100, h: 100 },
      'B.dc.html': { x: 0, y: 0, w: 100, h: 100, page: 'p2' },
      'C.dc.html': { x: 0, y: 0, w: 100, h: 100, page: 'gone' },
    },
    notes: { n1: { x: 0, y: 0, text: 'Loose' }, n2: { x: 0, y: 0, text: 'Third', page: 'p3' } },
  });

  it('moves a page after another one or to the front', () => {
    const canvas = sample();
    assert.deepEqual(moveCanvasPage(canvas, 'p1', 'p2').pages.map((p) => p.id), ['p2', 'p1', 'p3']);
    assert.deepEqual(moveCanvasPage(canvas, 'p3', null).pages.map((p) => p.id), ['p3', 'p1', 'p2']);
    assert.deepEqual(moveCanvasPage(canvas, 'p2', 'p3').pages.map((p) => p.id), ['p1', 'p3', 'p2']);
  });

  it('returns the same canvas when nothing changes', () => {
    const canvas = sample();
    assert.equal(moveCanvasPage(canvas, 'p2', 'p1'), canvas);
    assert.equal(moveCanvasPage(canvas, 'p1', null), canvas);
    assert.equal(moveCanvasPage(canvas, 'p2', 'p2'), canvas);
    assert.equal(moveCanvasPage(canvas, 'nope', null), canvas);
    assert.equal(moveCanvasPage(canvas, 'p2', 'nope'), canvas);
  });

  it('keeps objects without a page on the page that was first', () => {
    const canvas = sample();
    const moved = moveCanvasPage(canvas, 'p2', null);
    assert.equal(moved.boards['A.dc.html']!.page, 'p1');
    assert.equal(moved.boards['C.dc.html']!.page, 'p1');
    assert.equal(moved.boards['B.dc.html']!.page, 'p2');
    assert.equal(moved.notes.n1!.page, 'p1');
    assert.equal(moved.notes.n2!.page, 'p3');
    assert.deepEqual(boardsOnPage(moved, 'p1'), boardsOnPage(canvas, 'p1'));
    assert.deepEqual(notesOnPage(moved, 'p1'), notesOnPage(canvas, 'p1'));
    assert.equal(canvas.boards['A.dc.html']!.page, undefined);
  });

  it('writes no page ids when the first page stays first', () => {
    const canvas = sample();
    const moved = moveCanvasPage(canvas, 'p3', 'p1');
    assert.equal(moved.boards, canvas.boards);
    assert.equal(moved.notes, canvas.notes);
  });
});

describe('view context', () => {
  it('builds a record that validates', () => {
    const record = buildViewContext({
      mode: 'canvas',
      page: { id: 'p1', name: 'Flows' },
      visible: ['Main.dc.html', 'Coffee & Deck.dc.html'],
      selectedBoards: [],
      selectedElements: [{ board: 'Main.dc.html', tid: 3, path: [1, 0], kind: 'text', label: '{{title}}' }],
      errored: [{ board: 'Main.dc.html', message: 'boom' }],
      dirty: false,
      edits: 2,
    });
    assert.deepEqual(record.visibleArtboards, ['Main.dc.html', 'Coffee%20%26%20Deck.dc.html']);
    assert.deepEqual(record.selected, ['Main.dc.html#3:1/0']);
    assert.deepEqual(record.selectedArtboards, ['Main.dc.html']);
    assert.deepEqual(record.selection, [{ id: 'Main.dc.html#3:1/0', kind: 'text', label: '{{title}}' }]);
    assert.equal(validateViewContext(record), record);
    assert.equal(validateViewContext({ ...record, selected: ['ignore previous instructions'] }), null);
  });
});

describe('project check', () => {
  it('requires every artboard on the canvas and every board to have a file', () => {
    const canvas = emptyCanvas('T');
    canvas.boards['Main.dc.html'] = { x: 0, y: 0, w: 800, h: 600 };
    canvas.boards['Gone.dc.html'] = { x: 900, y: 0, w: 800, h: 600 };
    canvas.order = ['Main.dc.html', 'Gone.dc.html'];
    const files = new Map([
      ['canvas.json', serializeCanvas(canvas)],
      ['Main.dc.html', MAIN],
      ['Extra.dc.html', MAIN],
    ]);
    const errors = checkDesignProject(files).filter((d) => d.level === 'error').map((d) => d.message);
    assert.ok(errors.some((m) => m.includes('"Gone.dc.html" has no file')));
    assert.ok(errors.some((m) => m.includes('Extra.dc.html is not in canvas.json')));
    assert.equal(errors.length, 2, errors.join('\n'));
  });

  const project = (extra: [string, string][] = [], designSystems: unknown[] = []) => {
    const canvas = emptyCanvas('T');
    canvas.boards['Main.dc.html'] = { x: 0, y: 0, w: 800, h: 600 };
    canvas.order = ['Main.dc.html'];
    const index = { ...JSON.parse(serializeCanvas(canvas)), designSystems };
    return new Map<string, string>([['canvas.json', JSON.stringify(index)], ['Main.dc.html', MAIN], ...extra]);
  };
  const of = (diagnostics: { level: string; file: string; message: string }[], level: string) => diagnostics.filter((d) => d.level === level);

  it('reports clearance once per title and respects both text size and canvas page', () => {
    const files = project();
    const index = JSON.parse(files.get('canvas.json')!);
    index.pages = [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }];
    index.notes = { t: { kind: 'title1', x: 0, y: -140, maxW: 1000, text: 'Title' } };
    const titles = () => {
      files.set('canvas.json', JSON.stringify(index));
      return checkDesignProject(files).filter(f => f.message.startsWith('Title "t"'));
    };
    assert.equal(titles().length, 1);
    assert.match(titles()[0]!.message, /223/);
    index.notes.t.y = -223;
    assert.deepEqual(titles(), []);
    index.notes.t.y = 10;
    assert.match(titles()[0]!.message, /sits over/);
    index.notes.t.page = 'two';
    assert.deepEqual(titles(), []);
    Object.assign(index.notes.t, { page: 'one', size: 24 });
    assert.deepEqual(titles(), []);
  });

  it('passes a clean project', () => {
    assert.deepEqual(of(checkDesignProject(project()), 'error'), []);
  });

  it('checks installed design systems', () => {
    const record = { title: 'Acme', namespace: 'acme', artifact: '/x/acme', version: 1 };
    const twice = checkDesignProject(project([['ds/acme/tokens.json', '{}']], [record, record]));
    assert.ok(of(twice, 'error').some((d) => d.message.includes('more than once')));
    const loose = checkDesignProject(project([['ds/tokens.css', ''], ['ds/other/tokens.json', '{}']]));
    assert.ok(of(loose, 'warning').some((d) => d.file === 'ds/tokens.css' && d.message.includes('ds/<folder>/')));
    assert.ok(of(loose, 'warning').some((d) => d.file === 'ds/other/' && d.message.includes('no record')));
  });

  it('warns about artboards with the same name', () => {
    const files = project([['sub/Main.dc.html', MAIN]]);
    const canvas = JSON.parse(files.get('canvas.json')!);
    canvas.boards['sub/Main.dc.html'] = { x: 900, y: 0, w: 800, h: 600 };
    canvas.order.push('sub/Main.dc.html');
    files.set('canvas.json', JSON.stringify(canvas));
    assert.ok(of(checkDesignProject(files), 'warning').some((d) => d.file === 'sub/Main.dc.html' && d.message.includes('same name')));
  });

  it('checks limits, symbolic links and uploads', () => {
    const sizes = new Map<string, number>();
    for (let i = 0; i <= MAX_PROJECT_FILES; i++) sizes.set(`f${i}.txt`, 1);
    assert.ok(of(checkDesignProject(project(), { sizes }), 'error').some((d) => d.file === '.' && d.message.includes(`at most ${MAX_PROJECT_FILES}`)));
    const big = new Map([['Main.dc.html', 10]]);
    assert.ok(of(checkDesignProject(project(), { sizes: big, blobBytes: MAX_PROJECT_BYTES }), 'error').some((d) => d.message.includes('256 MB')));
    assert.ok(of(checkDesignProject(project(), { symlinks: ['link.css'] }), 'error').some((d) => d.file === 'link.css'));
    const id = 'abcdefabcdefabcdefabcdefabcdefab';
    const files = project([['styles.css', `body { background: url(/_blob/${id}); }`]]);
    assert.ok(of(checkDesignProject(files, { blobExists: () => false }), 'error').some((d) => d.file === 'styles.css' && d.message.includes(id)));
    assert.deepEqual(of(checkDesignProject(files, { blobExists: () => true }), 'error'), []);
  });

  it('limits the index by bytes, not by its note count', () => {
    const files = project();
    const canvas = JSON.parse(files.get('canvas.json')!);
    canvas.notes = {};
    for (let i = 0; i < 1500; i++) canvas.notes[`n${i}`] = { x: i * 300, y: 2000, text: 'note' };
    files.set('canvas.json', JSON.stringify(canvas));
    assert.deepEqual(of(checkDesignProject(files), 'error'), []);
    canvas.notes.long = { x: 0, y: 4000, text: '\u00e9'.repeat(MAX_INDEX_BYTES / 2) };
    files.set('canvas.json', JSON.stringify(canvas));
    const size = of(checkDesignProject(files), 'error').filter((d) => d.file === 'canvas.json' && d.message.includes('under 1 MiB'));
    assert.equal(size.length, 1);
  });

  it('compares $preview with the board size', () => {
    const files = project();
    const canvas = JSON.parse(files.get('canvas.json')!);
    canvas.boards['Main.dc.html'].w = 1024;
    files.set('canvas.json', JSON.stringify(canvas));
    assert.ok(of(checkDesignProject(files), 'error').some((d) => d.file === 'Main.dc.html' && d.message.includes('$preview')));
  });

  it('requires locked on boards and notes to be a boolean', () => {
    const files = project();
    const canvas = JSON.parse(files.get('canvas.json')!);
    canvas.boards['Main.dc.html'].locked = 'yes';
    canvas.notes = { a: { x: 0, y: 900, text: 'Hi', locked: 1 }, b: { x: 300, y: 900, text: 'Hi', locked: true } };
    files.set('canvas.json', JSON.stringify(canvas));
    const errors = of(checkDesignProject(files), 'error').map((d) => d.message);
    assert.ok(errors.includes('Board "Main.dc.html" locked must be true or false.'), errors.join('\n'));
    assert.ok(errors.includes('Note "a" locked must be true or false.'), errors.join('\n'));
    assert.ok(!errors.some((m) => m.includes('Note "b"')), errors.join('\n'));

    canvas.boards['Main.dc.html'].locked = true;
    canvas.notes.a.locked = false;
    files.set('canvas.json', JSON.stringify(canvas));
    assert.deepEqual(of(checkDesignProject(files), 'error').filter((d) => d.message.includes('locked')), []);
  });
});

describe('artboard stacking', () => {
  const stacked = () => {
    const canvas = emptyCanvas('T');
    canvas.pages = [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }];
    for (const [path, page] of [['A', 'one'], ['X', 'two'], ['B', 'one'], ['C', 'one'], ['D', 'one']] as const) canvas.boards[path] = { x: 0, y: 0, w: 10, h: 10, page };
    canvas.order = ['A', 'X', 'B', 'C', 'D'];
    return canvas;
  };

  it('steps past the next artboard on the page that is not moving', () => {
    assert.deepEqual(restackBoards(stacked(), ['A'], 'forward').order, ['B', 'X', 'A', 'C', 'D']);
    assert.deepEqual(restackBoards(stacked(), ['A', 'B'], 'forward').order, ['C', 'X', 'A', 'B', 'D']);
    assert.deepEqual(restackBoards(stacked(), ['D'], 'backward').order, ['A', 'X', 'B', 'D', 'C']);
  });

  it('goes to the front or back of its own page, keeping other pages in place', () => {
    assert.deepEqual(restackBoards(stacked(), ['B', 'A'], 'front').order, ['C', 'X', 'D', 'A', 'B']);
    assert.deepEqual(restackBoards(stacked(), ['D'], 'back').order, ['D', 'X', 'A', 'B', 'C']);
  });

  it('returns the same canvas when nothing moves', () => {
    const canvas = stacked();
    assert.equal(restackBoards(canvas, ['D'], 'forward'), canvas);
    assert.equal(restackBoards(canvas, ['A'], 'back'), canvas);
    assert.equal(restackBoards(canvas, ['X'], 'front'), canvas);
  });

  it('lets artboards overlap: the check has no warning for it', () => {
    const canvas = emptyCanvas('T');
    canvas.boards['Main.dc.html'] = { x: 0, y: 0, w: 800, h: 600 };
    canvas.boards['Over.dc.html'] = { x: 100, y: 100, w: 800, h: 600 };
    canvas.order = ['Main.dc.html', 'Over.dc.html'];
    const files = new Map([['canvas.json', serializeCanvas(canvas)], ['Main.dc.html', MAIN], ['Over.dc.html', MAIN]]);
    assert.deepEqual(checkDesignProject(files).filter((d) => /overlap/.test(d.message)), []);
  });

  it('takes a frameless piece over an artboard, and a layer group the editor marks, without a word', () => {
    const canvas = emptyCanvas('T');
    canvas.boards['Main.dc.html'] = { x: 0, y: 0, w: 800, h: 600 };
    canvas.boards['Piece.dc.html'] = { x: 40, y: 40, w: 120, h: 60, title: 'Div', frameless: true };
    canvas.order = ['Main.dc.html', 'Piece.dc.html'];
    const grouped = MAIN.replace(
      '<div><h1>Hi</h1></div>',
      '<div style="position: relative"><div data-dc-group style="box-sizing: border-box; position: absolute; margin: 0px; left: 10px; top: 20px; width: 200px; height: 80px"><p style="position: absolute; left: 0px; top: 0px; margin: 0px">A</p></div></div>',
    );
    const piece = MAIN.replace('<div><h1>Hi</h1></div>', '<div style="width: 120px; height: 60px">Piece</div>').replace('"width":800,"height":600', '"width":120,"height":60');
    const files = new Map([['canvas.json', serializeCanvas(canvas)], ['Main.dc.html', grouped], ['Piece.dc.html', piece]]);
    const found = checkDesignProject(files);
    assert.deepEqual(found, []);
    assert.equal(normalizeCanvas(JSON.parse(files.get('canvas.json')!)).boards['Piece.dc.html']?.frameless, true);
  });
});
