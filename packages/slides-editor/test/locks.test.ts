import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileSlide, type Slide } from '@open-artifact/slides-core';
import {
  ALL_LOCKED_REFUSAL,
  allLocked,
  editablePart,
  GENERATED_REFUSAL,
  isLockShortcut,
  refusedWhenLocked,
  LOCKED_REFUSAL,
  lockAnnouncement,
  lockMenuRow,
  lockRefusal,
  refusalGate,
  selectAllRefusal,
  settledSelection,
  sweepTargets,
} from '../src/lib/locks.ts';

const slide = (): Slide =>
  compileSlide(
    `<section id="locks">
  <h1 data-locked style="position:absolute;left:100px;top:100px;width:800px">Title</h1>
  <p style="position:absolute;left:100px;top:300px;width:800px">Body</p>
  <div data-group data-locked style="position:absolute;left:100px;top:500px;width:400px;height:200px">
    <p style="position:absolute;left:0;top:0;width:200px">Inside</p>
  </div>
  <div data-group style="position:absolute;left:600px;top:500px;width:400px;height:200px">
    <p style="position:absolute;left:0;top:0;width:200px">Loose</p>
  </div>
</section>`,
    { id: 'locks', lints: false },
  ).slide;

const key = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}, code?: string) => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('commands on locked selections', () => {
  it('refuses edits only when everything selected is locked', () => {
    assert.equal(lockRefusal(slide(), [[0]], 'edit'), LOCKED_REFUSAL);
    assert.equal(lockRefusal(slide(), [[0], [2, 0]], 'edit'), LOCKED_REFUSAL);
    assert.equal(lockRefusal(slide(), [[0], [1]], 'edit'), null);
    assert.equal(lockRefusal(slide(), [], 'edit'), null);
  });

  it('applies an edit of a mixed selection to its unlocked part', () => {
    assert.deepEqual(editablePart(slide(), [[0], [1]]), [[1]]);
    assert.deepEqual(editablePart(slide(), [[0]]), []);
    assert.equal(allLocked(slide(), [[0], [2]]), true);
    assert.equal(allLocked(slide(), []), false);
  });

  it('duplicates a locked element but nothing inside a locked container', () => {
    assert.equal(lockRefusal(slide(), [[0]], 'duplicate'), null);
    assert.equal(lockRefusal(slide(), [[2]], 'duplicate'), null);
    assert.equal(lockRefusal(slide(), [[2, 0]], 'duplicate'), LOCKED_REFUSAL);
    assert.equal(lockRefusal(slide(), [[3, 0]], 'duplicate'), null);
  });

  it('keeps a locked group together', () => {
    assert.equal(lockRefusal(slide(), [[2]], 'ungroup'), LOCKED_REFUSAL);
    assert.equal(lockRefusal(slide(), [[2], [3]], 'ungroup'), LOCKED_REFUSAL);
    assert.equal(lockRefusal(slide(), [[3]], 'ungroup'), null);
    assert.equal(lockRefusal(slide(), [[0], [3]], 'ungroup'), null);
  });
});

describe('selections and sweeps', () => {
  it('drops the locked part of a mixed selection while the slide can be edited', () => {
    assert.deepEqual(settledSelection(slide(), [[0], [1], [3]], true), [[1], [3]]);
    assert.equal(settledSelection(slide(), [[0], [2]], true), null);
    assert.equal(settledSelection(slide(), [[1]], true), null);
    assert.equal(settledSelection(slide(), [[0], [1]], false), null);
  });

  it('sweeps past locked elements only while the slide can be edited', () => {
    assert.deepEqual(sweepTargets(slide(), [[0], [1], [2], [3]], true), [[1], [3]]);
    assert.deepEqual(sweepTargets(slide(), [[0], [1]], false), [[0], [1]]);
  });

  it('says why Select all finds nothing to take', () => {
    assert.equal(selectAllRefusal(slide(), [[0], [2]], true), ALL_LOCKED_REFUSAL);
    assert.equal(selectAllRefusal(slide(), [[0], [2]], false), null);
    assert.equal(selectAllRefusal(slide(), [[0], [1]], true), null);
    assert.equal(selectAllRefusal(slide(), [], true), null);
  });
});

describe('the lock command', () => {
  it('offers Unlock only when everything selected is locked', () => {
    assert.deepEqual(lockMenuRow(slide(), [[0], [2]]), { label: 'Unlock', refusal: null });
    assert.deepEqual(lockMenuRow(slide(), [[0], [1]]), { label: 'Lock', refusal: null });
  });

  it('greys the row out for content a stylesheet made', () => {
    const s = slide();
    const made: Slide = { ...s, children: [...s.children, { ...s.children[1]!, origin: -1 }] };
    assert.deepEqual(lockMenuRow(made, [[4]]), { label: 'Lock', refusal: GENERATED_REFUSAL });
  });

  it('reads out what changed', () => {
    assert.equal(lockAnnouncement(true, 1), 'Element locked');
    assert.equal(lockAnnouncement(false, 3), '3 elements unlocked');
  });

  it('takes ⇧⌘L and Ctrl+Shift+L, on any layout, and nothing else', () => {
    assert.equal(isLockShortcut(key('L', { metaKey: true, shiftKey: true }, 'KeyL')), true);
    assert.equal(isLockShortcut(key('L', { ctrlKey: true, shiftKey: true }, 'KeyL')), true);
    assert.equal(isLockShortcut(key('Д', { metaKey: true, shiftKey: true }, 'KeyL')), true);
    assert.equal(isLockShortcut(key('l', { metaKey: true }, 'KeyL')), false);
    assert.equal(isLockShortcut(key('L', { shiftKey: true }, 'KeyL')), false);
    assert.equal(isLockShortcut(key('¬', { metaKey: true, shiftKey: true, altKey: true }, 'KeyL')), false);
  });
});

describe('held keys', () => {
  it('knows the keys a locked selection refuses', () => {
    for (const k of ['Delete', 'Backspace', 'ArrowLeft', 'ArrowDown', '[', ']']) assert.equal(refusedWhenLocked(key(k), true), true, k);
    assert.equal(refusedWhenLocked(key('ArrowUp', { shiftKey: true }), true), true);
    assert.equal(refusedWhenLocked(key('g', { metaKey: true }, 'KeyG'), true), true);
    assert.equal(refusedWhenLocked(key('G', { ctrlKey: true, shiftKey: true }, 'KeyG'), true), true);
    assert.equal(refusedWhenLocked(key(']', { metaKey: true }), true), true);
    assert.equal(refusedWhenLocked(key('‘', { metaKey: true, altKey: true }, 'BracketRight'), true), true);
  });

  it('refuses the Ctrl+Shift stacking keys off Apple platforms only', () => {
    const toFront = key('}', { ctrlKey: true, shiftKey: true }, 'BracketRight');
    assert.equal(refusedWhenLocked(toFront, false), true);
    assert.equal(refusedWhenLocked(toFront, true), false);
    assert.equal(refusedWhenLocked(key('[', { ctrlKey: true, altKey: true }, 'BracketLeft'), false), false);
  });

  it('leaves other keys alone', () => {
    for (const k of ['Enter', 'Tab', 'Escape', 't', 'k']) assert.equal(refusedWhenLocked(key(k), true), false, k);
    assert.equal(refusedWhenLocked(key('z', { metaKey: true }, 'KeyZ'), true), false);
    assert.equal(refusedWhenLocked(key('©', { metaKey: true, altKey: true }, 'KeyG'), true), false);
  });
});

describe('refusal notices', () => {
  it('shows one notice per burst', () => {
    let t = 0;
    const gate = refusalGate(3000, () => t);
    assert.equal(gate(), true);
    t = 1000;
    assert.equal(gate(), false);
    t = 2900;
    assert.equal(gate(), false);
    t = 3000;
    assert.equal(gate(), true);
  });
});
