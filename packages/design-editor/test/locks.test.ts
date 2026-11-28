import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDcDocument, parseTemplate, type HtmlElement, type TemplateModel } from '@open-artifact/dc';
import { applyOp, type Address } from '../src/lib/ops.ts';
import {
  deleteLockReason,
  isElementLocked,
  isLockKey,
  isLockable,
  isPlacementAttribute,
  lockedTids,
  isPlacementProperty,
  lockMark,
  lockVerdict,
  nextLockState,
  withoutLocks,
  withoutPlacement,
} from '../src/lib/locks.ts';

const board = (template: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test</title>
  <script src="./support.js"></script>
</head>
<body>
<x-dc>${template}</x-dc>
<script type="text/x-dc" data-dc-script data-props='{}'>
class Component extends DCLogic {}
</script>
</body>
</html>
`;

const templateOf = (source: string) => parseDcDocument(source).template!.text;
const byTag = (model: TemplateModel, tag: string, nth = 0): HtmlElement => model.elements.filter((el) => el.tag === tag)[nth]!;
const at = (model: TemplateModel, element: HtmlElement): Address => {
  const path: number[] = [];
  for (let node: HtmlElement | null = element; node; node = node.parent) {
    const siblings = (node.parent ? node.parent.children : model.nodes).filter((child) => child.type === 'element');
    path.unshift(siblings.indexOf(node));
  }
  return { tid: model.tidOf.get(element)!, path };
};

describe('element locks', () => {
  it('reads `true` and a bare attribute as locked, other values as fixed', () => {
    const model = parseTemplate('<div><p data-locked="true">A</p><p data-locked>B</p><p data-locked="false">C</p><p>D</p><dc-import name="x" data-locked="true"></dc-import></div>');
    assert.deepEqual(model.elements.slice(1).map(lockMark), ['locked', 'locked', 'fixed', 'unlocked', 'fixed']);
    assert.deepEqual(model.elements.slice(1).map(isLockable), [true, true, false, true, false]);
    assert.equal(isElementLocked(byTag(model, 'dc-import')), false);
  });

  it('locks shapes through the svg they are drawn in', () => {
    const model = parseTemplate('<div><svg data-locked="true"><g><path d="M0 0"/></g><foreignObject><p>Hi</p></foreignObject></svg><svg><rect/></svg></div>');
    assert.equal(isElementLocked(byTag(model, 'path')), true);
    assert.equal(isElementLocked(byTag(model, 'g')), true);
    assert.equal(isElementLocked(byTag(model, 'p')), false);
    assert.equal(isElementLocked(byTag(model, 'rect')), false);
    assert.deepEqual(lockedTids(model).map((tid) => model.elements[tid]!.tag), ['svg', 'g', 'path', 'foreignobject']);
  });

  it('decides the toggle: lock unless everything is locked', () => {
    assert.equal(nextLockState([]), null);
    assert.equal(nextLockState([true, false]), true);
    assert.equal(nextLockState([false]), true);
    assert.equal(nextLockState([true, true]), false);
  });
});

describe('the lock edit', () => {
  it('writes data-locked="true" and removes it to unlock, as one edit', () => {
    const source = board('<div><p>One</p><p data-locked="false">Two</p><span>Three</span></div>');
    const model = parseTemplate(templateOf(source));
    const targets = [at(model, byTag(model, 'p')), at(model, byTag(model, 'p', 1)), at(model, byTag(model, 'span'))];
    const locked = applyOp(source, { kind: 'lock', targets, locked: true });
    assert.ok(locked);
    assert.equal(templateOf(locked.source), '<div><p data-locked="true">One</p><p data-locked="false">Two</p><span data-locked="true">Three</span></div>');
    assert.deepEqual(locked.created, []);
    const unlocked = applyOp(locked.source, { kind: 'lock', targets, locked: false });
    assert.equal(templateOf(unlocked!.source), '<div><p>One</p><p data-locked="false">Two</p><span>Three</span></div>');
  });

  it('unlocks an svg with everything inside it, even with a shape of it selected too', () => {
    const source = board('<div><svg data-locked="true"><path data-locked d="M0 0"/><rect data-locked="true"/></svg></div>');
    const model = parseTemplate(templateOf(source));
    const svg = byTag(model, 'svg');
    const result = applyOp(source, { kind: 'lock', targets: [at(model, svg), at(model, byTag(model, 'path'))], locked: false });
    assert.ok(result);
    assert.equal(templateOf(result.source), '<div><svg><path d="M0 0"/><rect/></svg></div>');
  });

  it('unlocks a shape by unlocking the svg that locks it', () => {
    const source = board('<div><svg data-locked="true"><rect/></svg></div>');
    const model = parseTemplate(templateOf(source));
    const result = applyOp(source, { kind: 'lock', targets: [at(model, byTag(model, 'rect'))], locked: false });
    assert.equal(templateOf(result!.source), '<div><svg><rect/></svg></div>');
  });

  it('duplicates and pastes without locks', () => {
    const source = board('<div><section data-locked="true"><p data-locked>Hi</p></section></div>');
    const model = parseTemplate(templateOf(source));
    const copied = applyOp(source, { kind: 'duplicate', targets: [at(model, byTag(model, 'section'))] });
    assert.equal(templateOf(copied!.source), '<div><section data-locked="true"><p data-locked>Hi</p></section><section><p>Hi</p></section></div>');
    const pasted = applyOp(source, { kind: 'insert', target: null, position: 'last-child', html: '<b data-locked="true">x</b>' });
    assert.ok(!templateOf(pasted!.source).includes('<b data-locked'));
  });

  it('strips lock markers from markup and leaves other values', () => {
    assert.equal(withoutLocks('<p data-locked="true">A</p><i data-locked="false">B</i>'), '<p>A</p><i data-locked="false">B</i>');
    const plain = '<p>A</p>';
    assert.equal(withoutLocks(plain), plain);
  });
});

describe('placement', () => {
  it('knows what places or sizes an element', () => {
    for (const name of ['left', 'margin-top', 'min-width', 'max-height', 'transform-origin', 'grid-row-start', 'flex', 'flex-basis', '-webkit-transform', 'inset-inline', 'z-index', 'object-fit'])
      assert.equal(isPlacementProperty(name), true, name);
    for (const name of ['color', 'background', 'padding', 'border-radius', 'flex-direction', 'gap', 'font-size', 'leftover'])
      assert.equal(isPlacementProperty(name), false, name);
    assert.equal(isPlacementAttribute('viewBox'), true);
    assert.equal(isPlacementAttribute('d'), true);
    assert.equal(isPlacementAttribute('fill'), false);
  });

  it('drops placement from a patch', () => {
    assert.deepEqual(withoutPlacement({ left: '4px', color: 'red', width: null }), { patch: { color: 'red' }, dropped: ['left', 'width'] });
  });
});

describe('lockVerdict', () => {
  const model = parseTemplate('<div><p data-locked="true">A</p><p>B</p><section data-locked="true"></section><svg data-locked="true"><rect/></svg></div>');
  const [, locked, open, box] = model.elements;
  const rect = byTag(model, 'rect');
  const L = at(model, locked!);
  const O = at(model, open!);

  it('keeps everything but placement on locked elements', () => {
    assert.deepEqual(lockVerdict(model, { kind: 'style', targets: [O], patch: { left: '1px' } }), { kind: 'free' });
    assert.deepEqual(lockVerdict(model, { kind: 'style', targets: [L], patch: { color: 'red' } }), { kind: 'free' });
    assert.deepEqual(lockVerdict(model, { kind: 'style', targets: [L], patch: { left: '1px' } }), { kind: 'refused' });
    assert.deepEqual(lockVerdict(model, { kind: 'style', targets: [L, O], patch: { left: '1px', color: 'red' } }), {
      kind: 'trimmed',
      op: { kind: 'styles', edits: [{ target: L, patch: { color: 'red' } }, { target: O, patch: { left: '1px', color: 'red' } }] },
    });
    assert.deepEqual(lockVerdict(model, { kind: 'attr', target: at(model, rect), name: 'x', value: '3' }), { kind: 'refused' });
    assert.deepEqual(lockVerdict(model, { kind: 'attr', target: at(model, rect), name: 'fill', value: 'red' }), { kind: 'free' });
  });

  it('keeps the placement of a locked element when its whole style is rewritten', () => {
    const styled = parseTemplate('<div><p data-locked="true" style="left: 4px; color: red">A</p></div>');
    const target = at(styled, byTag(styled, 'p'));
    const style = (value: string) => ({ kind: 'attr' as const, target, name: 'style', value });
    assert.deepEqual(lockVerdict(styled, style('left: 4px; color: blue')), { kind: 'free' });
    assert.deepEqual(lockVerdict(styled, style('left: 9px; color: red')), { kind: 'refused' });
    assert.deepEqual(lockVerdict(styled, style('left: 9px; color: blue')), { kind: 'trimmed', op: style('color: blue; left: 4px') });
  });

  it('refuses removing, moving and wrapping locked elements, and lets others go into them', () => {
    assert.deepEqual(lockVerdict(model, { kind: 'remove', targets: [O, L] }), { kind: 'refused' });
    assert.deepEqual(lockVerdict(model, { kind: 'remove', targets: [O] }), { kind: 'free' });
    assert.deepEqual(lockVerdict(model, { kind: 'move', targets: [L], target: O, position: 'after' }), { kind: 'refused' });
    // The lock pins the element itself, not what it holds.
    assert.deepEqual(lockVerdict(model, { kind: 'move', targets: [O], target: at(model, box!), position: 'last-child' }), { kind: 'free' });
    assert.deepEqual(lockVerdict(model, { kind: 'move', targets: [O], target: L, position: 'before' }), { kind: 'free' });
    assert.deepEqual(lockVerdict(model, { kind: 'wrap', targets: [L], open: '<div>', close: '</div>' }), { kind: 'refused' });
    assert.deepEqual(lockVerdict(model, { kind: 'unwrap', target: L }), { kind: 'refused' });
    assert.deepEqual(lockVerdict(model, { kind: 'insert', target: at(model, box!), position: 'first-child', html: '<b></b>' }), { kind: 'free' });
    assert.deepEqual(lockVerdict(model, { kind: 'duplicate', targets: [L] }), { kind: 'free' });
    assert.deepEqual(lockVerdict(model, { kind: 'text', target: L, text: 'New' }), { kind: 'free' });
  });
});

describe('the lock key', () => {
  it('is ⌘L or ⇧⌘L, by letter or by the physical key on non-Latin layouts, not with Alt or repeated', () => {
    assert.equal(isLockKey({ key: 'l', code: 'KeyL', meta: true, alt: false }), true);
    assert.equal(isLockKey({ key: 'L', code: 'KeyL', meta: true, alt: false }), true);
    assert.equal(isLockKey({ key: 'д', code: 'KeyL', meta: true, alt: false }), true);
    assert.equal(isLockKey({ key: 'l', meta: true, alt: false }), true);
    assert.equal(isLockKey({ key: 'l', code: 'KeyL', meta: false, alt: false }), false);
    assert.equal(isLockKey({ key: '¬', code: 'KeyL', meta: true, alt: true }), false);
    assert.equal(isLockKey({ key: 'l', code: 'KeyL', meta: true, alt: false, repeat: true }), false);
    assert.equal(isLockKey({ key: 'n', code: 'KeyN', meta: true, alt: false }), false);
    assert.equal(isLockKey({ key: 'l', code: 'KeyP', meta: true, alt: false }), true);
    assert.equal(isLockKey({ key: 'n', code: 'KeyL', meta: true, alt: false }), false);
  });
});

describe('delete and locks', () => {
  it('blocks deleting canvas objects only when all are locked', () => {
    assert.equal(deleteLockReason('objects', { lockable: 3, locked: 0 }), null);
    assert.equal(deleteLockReason('objects', { lockable: 3, locked: 2 }), null);
    assert.equal(deleteLockReason('objects', { lockable: 3, locked: 3 }), 'Locked: unlock first');
  });

  it('blocks deleting elements when any is locked', () => {
    assert.equal(deleteLockReason('elements', { lockable: 3, locked: 0 }), null);
    assert.equal(deleteLockReason('elements', { lockable: 3, locked: 1 }), 'Locked: unlock first');
  });

  it('in a mixed selection, leaves locked members behind and blocks only when all are locked', () => {
    assert.equal(deleteLockReason('mixed', { lockable: 3, locked: 1 }), null);
    assert.equal(deleteLockReason('mixed', { lockable: 2, locked: 2 }), 'Locked: unlock first');
  });
});
