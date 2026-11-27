import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTemplate, type TemplateModel } from '@open-artifact/dc';
import type { BoardEntry, CanvasNote, Rect } from '@open-artifact/design-core';
import {
  anchorDetail,
  anchorHighlight,
  anchorLabel,
  anchorLocation,
  areaAnchor,
  boardAnchor,
  boardsInArea,
  elementAnchor,
  findElement,
  keepRow,
  noteAnchor,
  onPage,
  parseAnchor,
  pinWorld,
  resolveAnchor,
  rowOf,
  serializeAnchor,
  spreadPins,
  toScreenPoint,
  type DesignAnchor,
  type PinContext,
} from '../src/lib/comment-anchors.ts';

const TEMPLATE = `<div class="page"><h1>Welcome</h1><p>Body text</p><button>Sign up</button></div>`;

const boards: Record<string, BoardEntry> = {
  'Home.dc.html': { x: 100, y: 200, w: 400, h: 300, title: 'Home' },
  'About.dc.html': { x: 600, y: 200, w: 400, h: 300 },
};
const notes: Record<string, CanvasNote> = { n1: { x: 0, y: 0, w: 100, h: 50, text: 'Remember the logo', kind: 'sticky' } };
const noteRect = (note: CanvasNote): Rect => ({ x: note.x, y: note.y, w: note.w ?? 0, h: note.h ?? 0 });

function doc(models: Record<string, TemplateModel | null>) {
  return { canvas: { boards, notes }, model: (board: string) => models[board] ?? null };
}

/** The anchor of the button, as comment mode makes it. */
function buttonAnchor(model: TemplateModel): Extract<DesignAnchor, { kind: 'element' }> {
  const tid = model.elements.findIndex((e) => e.tag === 'button');
  const anchor = elementAnchor({ page: 'p1', board: 'Home.dc.html', tid, path: [0, 2], model, box: { x: 20, y: 100, w: 80, h: 40 }, local: { x: 40, y: 110 } });
  assert.equal(anchor.kind, 'element');
  return anchor as Extract<DesignAnchor, { kind: 'element' }>;
}

describe('comment anchors', () => {
  it('round-trips through the stored string and rejects garbage', () => {
    const model = parseTemplate(TEMPLATE);
    const anchors: DesignAnchor[] = [
      buttonAnchor(model),
      boardAnchor('p1', 'Home.dc.html', { x: 10.4, y: 20.6 }),
      noteAnchor(null, 'n1', { x: 0, y: 0, w: 100, h: 50 }, { x: 50, y: 25 }),
      { kind: 'point', page: null, x: 5, y: 6 },
      areaAnchor('p2', { x: 50, y: 60 }, { x: 10, y: 20 }),
      { kind: 'canvas' },
    ];
    for (const anchor of anchors) assert.deepEqual(parseAnchor(serializeAnchor(anchor)), anchor);
    assert.deepEqual(parseAnchor('not json'), { kind: 'canvas' });
    assert.deepEqual(parseAnchor('{"kind":"element","board":"A.dc.html","tid":"x","path":[0]}'), { kind: 'canvas' });
    assert.deepEqual(parseAnchor('{"kind":"area","x":0,"y":0,"w":-5,"h":3}'), { kind: 'canvas' });
    // Fractions are clamped.
    assert.deepEqual(parseAnchor('{"kind":"note","note":"n1","fx":4,"fy":-1}'), { kind: 'note', page: null, note: 'n1', fx: 1, fy: 0 });
  });

  it('makes element anchors with a fingerprint and the press as a fraction of the box', () => {
    const model = parseTemplate(TEMPLATE);
    const anchor = buttonAnchor(model);
    assert.equal(anchor.tag, 'button');
    assert.equal(anchor.text, 'Sign up');
    assert.deepEqual(anchor.path, [0, 2]);
    assert.equal(anchor.fx, 0.25);
    assert.equal(anchor.fy, 0.25);
    assert.deepEqual(anchor.rect, { x: 20, y: 100, w: 80, h: 40 });
    // The corner the drag ended at (1 = right, 2 = bottom) is where the pin goes.
    assert.deepEqual(areaAnchor(null, { x: 50, y: 60 }, { x: 10, y: 20 }), { kind: 'area', page: null, x: 10, y: 20, w: 40, h: 40, corner: 0 });
    assert.deepEqual(areaAnchor(null, { x: 10, y: 20 }, { x: 50, y: 60 }), { kind: 'area', page: null, x: 10, y: 20, w: 40, h: 40, corner: 3 });
  });

  it('resolves an element that is still where it was', () => {
    const model = parseTemplate(TEMPLATE);
    const anchor = buttonAnchor(model);
    const resolved = resolveAnchor(anchor, doc({ 'Home.dc.html': model }));
    assert.equal(resolved.state, 'ok');
    assert.deepEqual(resolved.element, { tid: anchor.tid, path: [0, 2] });
  });

  it('finds an element again after an edit moved it', () => {
    const anchor = buttonAnchor(parseTemplate(TEMPLATE));
    // A new paragraph before the button shifts both its tid and its path.
    const edited = parseTemplate(`<div class="page"><h1>Welcome</h1><p>Body text</p><p>New</p><button>Sign up</button></div>`);
    const resolved = resolveAnchor(anchor, doc({ 'Home.dc.html': edited }));
    assert.equal(resolved.state, 'moved');
    assert.deepEqual(resolved.element?.path, [0, 3]);
    assert.equal(edited.elements[resolved.element!.tid]!.tag, 'button');
    // Wrapped in another element: found by its fingerprint anywhere.
    const wrapped = parseTemplate(`<div class="page"><h1>Welcome</h1><p>Body text</p><footer><button>Sign up</button></footer></div>`);
    const found = findElement(wrapped, anchor);
    assert.deepEqual(found?.path, [0, 2, 0]);
    assert.equal(found?.exact, false);
  });

  it('does not take a different element at the same address', () => {
    const anchor = buttonAnchor(parseTemplate(TEMPLATE));
    // The button was replaced by a link: same tid and path, different element.
    const replaced = parseTemplate(`<div class="page"><h1>Welcome</h1><p>Body text</p><a>Log in</a></div>`);
    assert.equal(resolveAnchor(anchor, doc({ 'Home.dc.html': replaced })).state, 'detached');
    // Two identical candidates elsewhere are ambiguous.
    const twice = parseTemplate(`<section><button>Sign up</button><button>Sign up</button></section>`);
    assert.equal(findElement(twice, { ...anchor, path: [5, 5], tid: 99 }), null);
  });

  it('trusts the address while the artboard has not loaded, and orphans what was deleted', () => {
    const anchor = buttonAnchor(parseTemplate(TEMPLATE));
    assert.equal(resolveAnchor(anchor, doc({})).state, 'ok');
    assert.equal(resolveAnchor({ ...anchor, board: 'Gone.dc.html' }, doc({})).state, 'orphaned');
    assert.equal(resolveAnchor({ kind: 'board', page: null, board: 'Gone.dc.html' }, doc({})).state, 'orphaned');
    assert.equal(resolveAnchor({ kind: 'note', page: null, note: 'n9' }, doc({})).state, 'orphaned');
    assert.equal(resolveAnchor({ kind: 'note', page: null, note: 'n1' }, doc({})).state, 'ok');
  });

  it('shows pins on their own page only (no page = the first page)', () => {
    assert.equal(onPage({ kind: 'point', page: 'p1', x: 0, y: 0 }, 'p1', 'p1'), true);
    assert.equal(onPage({ kind: 'point', page: null, x: 0, y: 0 }, 'p1', 'p1'), true);
    assert.equal(onPage({ kind: 'point', page: 'p2', x: 0, y: 0 }, 'p1', 'p1'), false);
    assert.equal(onPage({ kind: 'canvas' }, 'p1', 'p1'), false);
    assert.equal(onPage({ kind: 'point', page: null, x: 0, y: 0 }, null, null), true);
  });

  it('labels anchors and describes their location for the agent', () => {
    const model = parseTemplate(TEMPLATE);
    const canvas = { boards, notes };
    assert.equal(anchorLabel(buttonAnchor(model), canvas), 'Home › button "Sign up"');
    assert.equal(anchorLabel({ kind: 'board', page: null, board: 'About.dc.html' }, canvas), 'About');
    assert.equal(anchorLabel({ kind: 'board', page: null, board: 'Gone.dc.html' }, canvas), 'Deleted artboard (Gone)');
    assert.equal(anchorLabel({ kind: 'note', page: null, note: 'n1' }, canvas), 'Sticky "Remember the logo"');
    assert.equal(anchorLabel({ kind: 'canvas' }, canvas), 'Whole design');
    const location = anchorLocation(buttonAnchor(model), (board, tid, path) => `${board}#${tid}:${path.join('/')}`);
    assert.deepEqual(location, { kind: 'element', page: 'p1', artboard: 'Home.dc.html', element: `Home.dc.html#3:0/2` });
    assert.deepEqual(boardsInArea({ x: 450, y: 250, w: 200, h: 10 }, boards, ['Home.dc.html', 'About.dc.html']), ['Home.dc.html', 'About.dc.html']);
    assert.deepEqual(boardsInArea({ x: 520, y: 250, w: 50, h: 10 }, boards, ['Home.dc.html', 'About.dc.html']), []);
  });
});

describe('pin placement', () => {
  const ctx = (elementRect?: PinContext['elementRect']): PinContext => ({ boards, notes, noteRect, ...(elementRect ? { elementRect } : {}) });

  it('puts an element pin at the pressed spot of its live box, following the artboard', () => {
    const model = parseTemplate(TEMPLATE);
    const anchor = buttonAnchor(model);
    const resolved = resolveAnchor(anchor, doc({ 'Home.dc.html': model }));
    // Live box moved within the artboard: the pin keeps its place on the element (25% / 25%).
    assert.deepEqual(pinWorld(resolved, ctx(() => ({ x: 200, y: 0, w: 100, h: 20 }))), { x: 100 + 225, y: 200 + 5 });
    // Not rendered live: the box saved with the anchor.
    assert.deepEqual(pinWorld(resolved, ctx()), { x: 100 + 40, y: 200 + 110 });
    // The artboard moved on the canvas: the pin moves with it.
    const moved = { ...ctx(), boards: { ...boards, 'Home.dc.html': { ...boards['Home.dc.html']!, x: -50, y: 0 } } };
    assert.deepEqual(pinWorld(resolved, moved), { x: -50 + 40, y: 0 + 110 });
  });

  it('clamps element and board pins into their artboard', () => {
    const model = parseTemplate(TEMPLATE);
    const resolved = resolveAnchor(buttonAnchor(model), doc({ 'Home.dc.html': model }));
    // An element scrolled out of the artboard: the pin stays on its edge.
    assert.deepEqual(pinWorld(resolved, ctx(() => ({ x: 380, y: 290, w: 400, h: 400 }))), { x: 100 + 400, y: 200 + 300 });
    const board = resolveAnchor({ kind: 'board', page: null, board: 'Home.dc.html', x: 900, y: -20 }, doc({}));
    assert.deepEqual(pinWorld(board, ctx()), { x: 500, y: 200 });
    // No point: the top-right corner.
    assert.deepEqual(pinWorld(resolveAnchor({ kind: 'board', page: null, board: 'About.dc.html' }, doc({})), ctx()), { x: 1000, y: 200 });
  });

  it('falls back to the artboard corner when the element is gone, and has no pin when the artboard is', () => {
    const anchor = buttonAnchor(parseTemplate(TEMPLATE));
    const gone = resolveAnchor({ ...anchor, rect: undefined }, doc({ 'Home.dc.html': parseTemplate('<div></div>') }));
    assert.equal(gone.state, 'detached');
    assert.deepEqual(pinWorld(gone, ctx(() => ({ x: 0, y: 0, w: 1, h: 1 }))), { x: 500, y: 200 });
    assert.equal(anchorHighlight(gone, ctx()), null);
    assert.equal(pinWorld(resolveAnchor({ ...anchor, board: 'Gone.dc.html' }, doc({})), ctx()), null);
    assert.equal(pinWorld(resolveAnchor({ kind: 'canvas' }, doc({})), ctx()), null);
  });

  it('places note, point and area pins', () => {
    assert.deepEqual(pinWorld(resolveAnchor({ kind: 'note', page: null, note: 'n1', fx: 0.5, fy: 1 }, doc({})), ctx()), { x: 50, y: 50 });
    assert.deepEqual(pinWorld(resolveAnchor({ kind: 'note', page: null, note: 'n1' }, doc({})), ctx()), { x: 100, y: 0 });
    assert.deepEqual(pinWorld(resolveAnchor({ kind: 'point', page: null, x: -7, y: 9 }, doc({})), ctx()), { x: -7, y: 9 });
    const area = resolveAnchor({ kind: 'area', page: null, x: 10, y: 20, w: 30, h: 40 }, doc({}));
    assert.deepEqual(pinWorld(area, ctx()), { x: 40, y: 20 });
    assert.deepEqual(anchorHighlight(area, ctx()), { x: 10, y: 20, w: 30, h: 40 });
  });

  it('maps world points to the screen through the camera', () => {
    assert.deepEqual(toScreenPoint({ x: 10, y: -20, zoom: 2 }, { x: 100, y: 50 }), { x: 210, y: 80 });
    assert.deepEqual(toScreenPoint({ x: 0, y: 0, zoom: 0.5 }, { x: 100, y: 50 }), { x: 50, y: 25 });
  });

  it('fans out pins that would overlap', () => {
    const out = spreadPins([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }, { x: 100, y: 100 }], 20);
    assert.deepEqual(out, [
      { x: 0, y: 0 },
      { x: 25, y: 5 },
      { x: 50, y: 0 },
      { x: 100, y: 100 },
    ]);
  });
});

describe('repeated rows', () => {
  const model = parseTemplate(TEMPLATE);
  const canvas = { boards, notes: {} };
  const rowAnchor = (): DesignAnchor =>
    elementAnchor({
      page: null,
      board: 'Home.dc.html',
      tid: model.elements.findIndex((e) => e.tag === 'button'),
      path: [0, 2],
      model,
      box: null,
      row: rowOf([
        { tid: 1, at: 2, of: 5, text: '  Ada   Lovelace ' },
        { tid: 2, at: 1, of: 3, text: 'Edit' },
      ]),
    });

  it('keeps the innermost three layers, outermost first, and the innermost words', () => {
    const row = rowOf([
      { tid: 1, at: 1, of: 2, text: 'a' },
      { tid: 2, at: 2, of: 5, text: 'b' },
      { tid: 3, at: 1, of: 3, text: 'c' },
      { tid: 4, at: 4, of: 20000, text: '  Last   one ' },
    ]);
    assert.deepEqual(row, { layers: [{ at: 2, of: 5, tid: 2 }, { at: 1, of: 3, tid: 3 }, { at: 4, of: 9999, tid: 4 }], text: 'Last one' });
    assert.equal(rowOf([]), undefined);
  });

  it('round-trips through the stored form and drops invalid rows', () => {
    const anchor = rowAnchor();
    assert.deepEqual(parseAnchor(serializeAnchor(anchor)), anchor);
    const stored = JSON.parse(serializeAnchor(anchor));
    for (const row of [{ layers: [] }, { layers: [{ at: 0, of: 5, tid: 1 }] }, { layers: [{ at: 2, of: 1, tid: 1 }] }, { layers: [{ at: 2, of: 10000, tid: 1 }] }, { layers: [1, 2, 3, 4].map((tid) => ({ at: 1, of: 2, tid })) }, 'row']) {
      const parsed = parseAnchor(JSON.stringify({ ...stored, row }));
      assert.equal(parsed.kind, 'element');
      assert.equal('row' in parsed, false);
    }
  });

  it('says the row in the label, the detail and the location', () => {
    const anchor = rowAnchor();
    assert.equal(anchorLabel(anchor, canvas), 'Home › row 2 of 5 › item 1 of 3 › button "Sign up"');
    assert.equal(anchorDetail(anchor), 'button "Sign up", row 2 of 5, item 1 of 3, shown as "Edit"');
    assert.equal(anchorLocation(anchor, () => null).row, 'row 2 of 5, item 1 of 3');
    assert.equal(anchorDetail(buttonAnchor(model)), undefined);
  });

  it('drops the row once a layer is no longer repeated', () => {
    const anchor = rowAnchor();
    assert.equal(keepRow(anchor, () => true), anchor);
    const plain = keepRow(anchor, (tid) => tid !== 2);
    assert.equal('row' in plain, false);
    assert.equal(anchorLabel(plain, canvas), 'Home › button "Sign up"');
  });
});
