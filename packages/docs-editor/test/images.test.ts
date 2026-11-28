import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type DocState, applyOps } from '@open-artifact/docs-core';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { schema } from '../src/editor/schema.ts';
import {
  ALT_MAX,
  FULL_CROP,
  MAX_IMAGE_BYTES,
  clampWidth,
  draggedWidth,
  widthForEdge,
  cleanAlt,
  dragCropEdge,
  judgeImageFile,
  placeholderBox,
  refusalMessage,
  sameCrop,
  sizeOf,
  storedCrop,
  widthAfterCrop,
} from '../src/images/geometry.ts';
import { addPending, pendingPlugin, pendingPos, removePending } from '../src/images/pending.ts';
import { dropPlace } from '../src/images/place.ts';
import { diffPage } from '../src/sync/diff.ts';
import { type PageNode, canonical, docToPage } from '../src/sync/page.ts';

describe('picture files', () => {
  it('takes pictures up to 20 MB and says why others are left out', () => {
    assert.equal(judgeImageFile({ type: 'image/png', size: 10 }), 'ok');
    assert.equal(judgeImageFile({ type: 'IMAGE/JPEG', size: MAX_IMAGE_BYTES }), 'ok');
    assert.equal(judgeImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 }), 'tooLarge');
    assert.equal(judgeImageFile({ type: 'application/pdf', size: 10 }), 'notImage');
    assert.equal(judgeImageFile({ type: 'image/png', size: 0 }), 'empty');
    assert.equal(refusalMessage(['ok']), null);
    assert.equal(refusalMessage(['tooLarge']), 'That image is over 20 MB.');
    assert.equal(refusalMessage(['notImage', 'notImage']), '2 files aren’t PNG, JPEG, GIF or WebP images.');
    assert.equal(judgeImageFile({ type: 'image/svg+xml', size: 10 }), 'notImage');
    assert.match(refusalMessage(['notImage', 'tooLarge'])!, /2 files couldn’t be added/);
    assert.equal(MAX_IMAGE_BYTES, 20 * 1024 * 1024);
    assert.equal(refusalMessage([], 3), 'Only 20 images can be added at once. The first 20 were added.');
  });

  it('sizes an upload’s box by the picture, no wider than the column', () => {
    assert.deepEqual(placeholderBox({ w: 1200, h: 600 }, 600), { w: 600, h: 300 });
    assert.deepEqual(placeholderBox({ w: 200, h: 100 }, 600), { w: 200, h: 100 });
    assert.deepEqual(placeholderBox(null, 640), { w: 320, h: 180 });
  });
});

describe('picture sizes and alt text', () => {
  it('knows the size names the doc keeps', () => {
    assert.equal(sizeOf('full'), 'full');
    assert.equal(sizeOf('extraLarge'), null);
    assert.equal(sizeOf(320), null);
  });

  it('keeps alt text on one line without invisible characters', () => {
    assert.equal(cleanAlt('  A cat\non a\tmat\u200B '), 'A cat on a mat');
    assert.equal(cleanAlt(' \n '), null);
    assert.equal(ALT_MAX, 2048);
  });

  it('keeps a dragged width between 40px and the room there is', () => {
    assert.equal(clampWidth(10, 600), 40);
    assert.equal(clampWidth(900, 600), 600);
    assert.equal(clampWidth(300.4, 600), 300);
  });

  it('widens a picture so the dragged edge stays under the pointer', () => {
    // 2026-11-27: a centered picture grows on both sides, so its handles moved half as far as the pointer.
    assert.equal(draggedWidth('e', 200, 30, 'left', 'ltr'), 230, 'left-aligned: the right edge moves with the width');
    assert.equal(draggedWidth('w', 200, -30, 'left', 'ltr'), 230, 'the left handle of a left-aligned picture changes it by as much');
    assert.equal(draggedWidth('e', 200, 30, 'center', 'ltr'), 260, 'centered: each edge moves half the change');
    assert.equal(draggedWidth('w', 200, -30, 'center', 'ltr'), 260);
    assert.equal(draggedWidth('w', 200, -30, 'right', 'ltr'), 230, 'right-aligned: the left edge moves with the width');
    assert.equal(draggedWidth('e', 200, 30, 'right', 'ltr'), 230, 'the right handle of a right-aligned picture changes it by as much');
    assert.equal(draggedWidth('w', 200, -30, 'start', 'rtl'), 230, 'start is the right in a right-to-left line');
    assert.equal(draggedWidth('e', 200, 30, 'end', 'ltr'), 230);
  });

  it('finds the width that puts the dragged edge under the pointer, however the cell moves it', () => {
    const clamp = (width: number) => clampWidth(width, 600);
    const solve = (edgeAt: (width: number) => number, target: number, guess: number) => widthForEdge(target, edgeAt, { width: 200, edge: edgeAt(200) }, guess, clamp);
    // Centered in a fixed column 400 wide from x = 100: the right edge is at 300 + w / 2.
    const fixed = (width: number) => 300 + width / 2;
    assert.equal(solve(fixed, 430, 260), 260, 'the guess from text-align lands at once');
    // Centered in a cell that grows with the picture: its left edge stays at 100, so the right edge moves with the width.
    const growing = (width: number) => 100 + width;
    assert.equal(solve(growing, 330, 260), 230, 'a cell that widens with the picture moves its edge one for one');
    // A column that starts growing once the picture is wider than 240.
    const both = (width: number) => (width <= 240 ? 300 + width / 2 : 420 + (width - 240));
    const width = solve(both, 470, 260)!;
    assert.ok(Math.abs(both(width) - 470) < 0.5, `the edge lands on the pointer: ${width} → ${both(width)}`);
    // The left edge of a left-aligned picture does not move: nothing to solve.
    assert.equal(solve(() => 100, 70, 230), null);
  });
});

describe('cropping', () => {
  it('drags each edge, never past the other and never narrower than 2%', () => {
    let rect = dragCropEdge(FULL_CROP, 'w', 0.25, 0, FULL_CROP);
    assert.deepEqual(rect, { x: 0.25, y: 0, w: 0.75, h: 1 });
    rect = dragCropEdge(rect, 'e', 0.1, 0, FULL_CROP);
    assert.ok(Math.abs(rect.w - 0.02) < 1e-9 && rect.x === 0.25);
    rect = dragCropEdge(rect, 'n', 0, 0.5, FULL_CROP);
    assert.equal(rect.y, 0.5);
    rect = dragCropEdge(rect, 's', 0, 0.995, FULL_CROP);
    assert.equal(rect.y + rect.h, 1);
  });

  it('snaps to the picture’s sides and to where the crop began', () => {
    const entry = { x: 0.2, y: 0.1, w: 0.6, h: 0.8 };
    assert.equal(dragCropEdge(entry, 'w', 0.005, 0, entry).x, 0);
    assert.equal(dragCropEdge(entry, 'w', 0.205, 0, entry).x, 0.2);
    assert.equal(dragCropEdge(entry, 'e', 0.996, 0, entry).w, 0.8);
  });

  it('stores a crop rounded, and no crop for the whole picture', () => {
    assert.equal(storedCrop(FULL_CROP), null);
    assert.deepEqual(storedCrop({ x: 0.123456, y: 0, w: 0.5, h: 1 }), { x: 0.1235, y: 0, w: 0.5, h: 1 });
    assert.ok(sameCrop(null, FULL_CROP));
    assert.ok(!sameCrop(null, { x: 0, y: 0, w: 0.5, h: 1 }));
  });

  it('keeps a size name, and otherwise the picture’s scale', () => {
    assert.equal(widthAfterCrop('medium', 600, { x: 0, y: 0, w: 0.5, h: 1 }), 'medium');
    assert.equal(widthAfterCrop(null, 600, { x: 0, y: 0, w: 0.5, h: 1 }), 300);
    assert.equal(widthAfterCrop(400, 800, null), 800);
    assert.equal(widthAfterCrop(null, 600, null), null);
  });
});

describe('upload boxes', () => {
  const paragraph = (text: string) => schema.nodes.paragraph!.create(null, text ? schema.text(text) : null);

  it('move with the text around them and go when it is deleted', () => {
    let state = EditorState.create({ doc: schema.nodes.doc!.create(null, [paragraph('hello world')]), plugins: [pendingPlugin()] });
    state = state.apply(addPending(state.tr, [{ id: 'a', pos: 6, box: { w: 10, h: 10 } }]));
    assert.equal(pendingPos(state, 'a'), 6);
    state = state.apply(state.tr.insertText('Oh, ', 1));
    assert.equal(pendingPos(state, 'a'), 10);
    // Deleting the character after the box leaves it in place.
    state = state.apply(state.tr.delete(10, 11));
    assert.equal(pendingPos(state, 'a'), 10);
    state = state.apply(state.tr.delete(1, state.doc.content.size - 1));
    assert.equal(pendingPos(state, 'a'), null);
  });

  it('dropped pictures never take the place of what is there', () => {
    const code = schema.nodes.codeBlock!.create(null, schema.text('let a = 1;'));
    const doc = schema.nodes.doc!.create(null, [paragraph('one'), code, paragraph('two')]);
    const texts = (node: typeof doc) => {
      const out: string[] = [];
      node.descendants(child => {
        if (child.isText) out.push(child.text!);
      });
      return out;
    };
    const between = 5; // after the first paragraph
    const inCode = 8;
    for (const [at, added] of [[2, 0], [between, 1], [inCode, 1]] as const) {
      // A block selected next to the drop is kept.
      const state = EditorState.create({ doc });
      const tr = state.tr.setSelection(NodeSelection.create(state.doc, between));
      const place = dropPlace(tr, at);
      assert.deepEqual(texts(tr.doc), ['one', 'let a = 1;', 'two'], `drop at ${at}`);
      assert.equal(tr.doc.childCount, doc.childCount + added, `drop at ${at}`);
      const $place = tr.doc.resolve(place);
      assert.ok($place.parent.inlineContent && $place.parent.type !== schema.nodes.codeBlock, `drop at ${at}`);
    }
  });

  it('keep their order, and a picture put in at a box pushes the next box after it', () => {
    let state = EditorState.create({ doc: schema.nodes.doc!.create(null, [paragraph('ab')]), plugins: [pendingPlugin()] });
    state = state.apply(addPending(state.tr.setSelection(TextSelection.create(state.doc, 2)), [
      { id: 'one', pos: 2, box: { w: 10, h: 10 } },
      { id: 'two', pos: 2, box: { w: 10, h: 10 } },
    ]));
    const media = schema.nodes.media!.create({ blob: 'blob/one' });
    state = state.apply(removePending(state.tr, ['one']).insert(pendingPos(state, 'one')!, media));
    assert.equal(pendingPos(state, 'one'), null);
    assert.equal(pendingPos(state, 'two'), 3);
  });
});

describe('a picture’s size and crop in the doc', () => {
  it('reach the page and come back unchanged', () => {
    const session = { sess: 's1', next: 1 };
    let doc: DocState = { rev: 0, blocks: [{ id: 's0.0', type: 'paragraph', inline: [] }] };
    const block = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'See ' },
        { type: 'media', attrs: { blob: 'blob/abc', alt: 'A chart', width: 'full', crop: { x: 0.1, y: 0, w: 0.5, h: 1 }, dims: { w: 800, h: 600 }, mime: 'image/png' } },
        { type: 'media', attrs: { blob: 'blob/def', width: 320 } },
      ],
    };
    doc = applyOps(doc, [{ op: 'insert', target: { kind: 'root' }, side: 'end', with: { as: 'blocks', from: { kind: 'blocks', content: [block] } } }], session).doc;
    const page = docToPage(doc);
    const node = schema.nodeFromJSON(page);
    node.check();
    const pictures: Array<Record<string, unknown>> = [];
    node.descendants(child => {
      if (child.type === schema.nodes.media) pictures.push(child.attrs);
    });
    assert.equal(pictures[0]!.width, 'full');
    assert.deepEqual(pictures[0]!.crop, { x: 0.1, y: 0, w: 0.5, h: 1 });
    assert.deepEqual(pictures[0]!.dims, { w: 800, h: 600 });
    assert.equal(pictures[1]!.width, 320);
    assert.deepEqual(canonical(node.toJSON() as PageNode), canonical(page));
  });

  it('changed in the editor (size, crop, alt, a new picture) are written to the doc', () => {
    const session = { sess: 's1', next: 1 };
    let shadow: DocState = { rev: 0, blocks: [{ id: 's0.0', type: 'paragraph', inline: [] }] };
    const block = { type: 'paragraph', content: [{ type: 'text', text: 'A ' }, { type: 'media', attrs: { blob: 'blob/abc', dims: { w: 800, h: 600 } } }] };
    shadow = applyOps(shadow, [{ op: 'replace', target: { kind: 'blocks', ids: ['s0.0'] }, with: { as: 'blocks', from: { kind: 'blocks', content: [block] } } }], session).doc;
    const edits: Array<Record<string, unknown>> = [
      { width: 'full' },
      { crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }, width: 300 },
      { alt: 'A chart' },
      { blob: 'blob/def', mime: 'image/png', crop: null, alt: null },
    ];
    for (const change of edits) {
      const node = schema.nodeFromJSON(docToPage(shadow));
      let pos = -1;
      node.descendants((child, at) => {
        if (child.type === schema.nodes.media) pos = at;
      });
      const state = EditorState.create({ doc: node });
      const next = state.apply(state.tr.setNodeMarkup(pos, undefined, { ...state.doc.nodeAt(pos)!.attrs, ...change })).doc;
      const result = diffPage(shadow, next.toJSON() as PageNode, { sess: 'p1', next: 0 });
      assert.ok(result.ops.length > 0, `an op for ${JSON.stringify(change)}`);
      shadow = applyOps(shadow, result.ops, { sess: 'p1', next: 0 }).doc;
      const landed = schema.nodeFromJSON(docToPage(shadow));
      let attrs: Record<string, unknown> = {};
      landed.descendants(child => {
        if (child.type === schema.nodes.media) attrs = child.attrs;
      });
      for (const [key, value] of Object.entries(change)) assert.deepEqual(attrs[key], value, key);
    }
  });
});
