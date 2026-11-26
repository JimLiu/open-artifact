import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  accessibleNodeLabel,
  compileSlide,
  isGenerated,
  isLocked,
  lockToggle,
  lockedLabel,
  nodeAt,
  selectionLocks,
  serializeSlide,
  setLocked,
  sweepUnlocked,
  unlockedCopy,
  type BoxNode,
  type Slide,
} from '../src/index.ts';

const slide = (): Slide =>
  compileSlide(
    `<section id="rules">
  <h1 data-locked style="position:absolute;left:100px;top:100px;width:800px">Locked title</h1>
  <p style="position:absolute;left:100px;top:300px;width:800px">Free line</p>
  <div data-locked style="position:relative;width:600px;height:400px;background:#eee">
    <p style="position:absolute;left:20px;top:20px;width:200px">Layer</p>
    <div style="position:absolute;left:20px;top:200px;width:300px;height:100px;background:#ddd">
      <p>Deep</p>
    </div>
  </div>
  <div style="width:600px;background:#fafafa">
    <p data-locked>Inner locked</p>
    <p>Inner free</p>
  </div>
</section>`,
    { id: 'rules', lints: false },
  ).slide;

describe('which nodes are locked', () => {
  it('counts a node locked when it or an element holding it carries the lock', () => {
    const s = slide();
    assert.equal(isLocked(s, [0]), true);
    assert.equal(isLocked(s, [1]), false);
    assert.equal(isLocked(s, [2]), true);
    assert.equal(isLocked(s, [2, 0]), true);
    assert.equal(isLocked(s, [2, 1, 0]), true);
    assert.equal(isLocked(s, [3, 0]), true);
  });

  it('does not count a box locked because something inside it is', () => {
    const s = slide();
    assert.equal(isLocked(s, [3]), false);
    assert.equal(isLocked(s, [3, 1]), false);
  });

  it('does not count paths that lead nowhere', () => {
    const s = slide();
    assert.equal(isLocked(s, [9]), false);
    assert.equal(isLocked(s, [2, 7]), false);
    assert.equal(isLocked(s, []), false);
  });
});

describe('locking and unlocking', () => {
  it('locks a layered box together with its layers', () => {
    const s = setLocked(slide(), [[3]], true);
    assert.equal(nodeAt(s, [3])?.locked, true);
    assert.equal(isLocked(s, [3, 1]), true);
    assert.equal(nodeAt(s, [3, 1])?.locked, undefined);
  });

  it('unlocks a node by clearing the locks of the elements holding it too', () => {
    const s = setLocked(slide(), [[2, 1, 0]], false);
    assert.equal(isLocked(s, [2, 1, 0]), false);
    assert.equal(nodeAt(s, [2])?.locked, undefined);
    assert.equal(isLocked(s, [2, 0]), false);
  });

  it('leaves no trace of a cleared lock, and leaves the slide alone when nothing changes', () => {
    const before = slide();
    const unlocked = setLocked(before, [[0]], false);
    assert.equal('locked' in unlocked.children[0]!, false);
    assert.deepEqual(setLocked(unlocked, [[0]], true), before);
    assert.equal(setLocked(before, [[0]], true), before);
    assert.equal(setLocked(before, [[9], []], true), before);
  });

  it('writes the lock it sets to the file', () => {
    const out = serializeSlide(setLocked(slide(), [[1]], true));
    assert.match(out, /<p data-locked style="position:absolute;left:100px;top:300px;width:800px">Free line<\/p>/);
  });
});

describe('selections and locks', () => {
  it('keeps only the unlocked part of a mixed selection', () => {
    assert.deepEqual(selectionLocks(slide(), [[0], [1], [2, 0]]), { kind: 'free', paths: [[1]] });
    assert.deepEqual(selectionLocks(slide(), [[1], [3, 1]]), { kind: 'free', paths: [[1], [3, 1]] });
  });

  it('tells a selection that is locked through and through', () => {
    assert.deepEqual(selectionLocks(slide(), [[0], [2, 1]]), { kind: 'locked', paths: [[0], [2, 1]] });
    assert.deepEqual(selectionLocks(slide(), []), { kind: 'empty' });
  });

  it('sweeps past locked elements and says when every one was locked', () => {
    assert.deepEqual(sweepUnlocked(slide(), [[0], [1], [2], [3]]), { paths: [[1], [3]], allLocked: false });
    assert.deepEqual(sweepUnlocked(slide(), [[0], [2]]), { paths: [], allLocked: true });
    assert.deepEqual(sweepUnlocked(slide(), []), { paths: [], allLocked: false });
  });
});

describe('copies of locked elements', () => {
  it('copies a subtree with every lock cleared and leaves the node it copied locked', () => {
    const s = setLocked(slide(), [[2, 1]], true);
    const box = nodeAt(s, [2]) as BoxNode;
    const copy = unlockedCopy(box);
    assert.equal(copy.locked, undefined);
    assert.equal(copy.children[1]!.locked, undefined);
    assert.equal(box.locked, true);
    assert.equal(box.children[1]!.locked, true);
    assert.doesNotMatch(JSON.stringify(copy), /locked/);
  });
});

describe('read-out names', () => {
  it('marks locked elements after their usual label', () => {
    const s = slide();
    assert.equal(accessibleNodeLabel(s, [0]), 'Locked title (locked)');
    assert.equal(accessibleNodeLabel(s, [2, 0]), 'Layer (locked)');
    assert.equal(accessibleNodeLabel(s, [1]), 'Free line');
    assert.equal(accessibleNodeLabel(s, [9]), undefined);
  });

  it('keeps the mark when the label is cut short', () => {
    assert.equal(accessibleNodeLabel(slide(), [0], 8), 'Locked … (locked)');
    assert.equal(lockedLabel('Image'), 'Image (locked)');
  });
});

describe('the lock command', () => {
  it('locks while anything selected is free, and unlocks what is locked through and through', () => {
    assert.deepEqual(lockToggle(slide(), [[0], [1]]), { kind: 'lock', paths: [[0], [1]] });
    assert.deepEqual(lockToggle(slide(), [[0], [2, 1]]), { kind: 'unlock', paths: [[0], [2, 1]] });
    assert.deepEqual(lockToggle(slide(), []), { kind: 'empty' });
    assert.deepEqual(lockToggle(slide(), [[9]]), { kind: 'empty' });
  });

  it('leaves out what a stylesheet made', () => {
    const s = slide();
    const made: Slide = { ...s, children: [...s.children, { ...s.children[1]!, origin: -1 }] };
    assert.equal(isGenerated(made.children[4]!), true);
    assert.equal(isGenerated(made.children[1]!), false);
    assert.deepEqual(lockToggle(made, [[4]]), { kind: 'generated' });
    assert.deepEqual(lockToggle(made, [[1], [4]]), { kind: 'lock', paths: [[1]] });
    assert.deepEqual(lockToggle(made, [[0], [4]]), { kind: 'unlock', paths: [[0]] });
  });
});
