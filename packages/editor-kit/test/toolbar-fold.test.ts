import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arrowStep, firstInCard, focusExit, foldItems, placeCard, scrollToShow, shownRuns, takesEscape, type FoldRole } from '../src/toolbar-fold.ts';

/** A strip of named controls with widths; moving one to the card takes its width off the strip. */
function strip(items: { name: string; width: number; role?: FoldRole }[], limit: number) {
  let width = items.reduce((sum, item) => sum + item.width, 0);
  const card: string[] = [];
  const moves: string[] = [];
  const folded = foldItems(
    items,
    (item) => item.role ?? 'loose',
    () => width > limit,
    (item, to) => {
      width -= item.width;
      moves.push(`${item.name}>${to}`);
      if (to === 'front') card.unshift(item.name);
      else card.push(item.name);
    },
  );
  return { card, moves, folded: folded.map((item) => item.name), width };
}

describe('folding a toolbar', () => {
  it('moves the more button first, then items from the end, keeping the strip order in the card', () => {
    const result = strip(
      [
        { name: 'size', width: 60 },
        { name: 'color', width: 30 },
        { name: 'bold', width: 30 },
        { name: 'italic', width: 30 },
        { name: 'align', width: 40 },
        { name: 'ask', width: 30, role: 'pinned' },
        { name: 'properties', width: 30, role: 'more' },
      ],
      170,
    );
    assert.deepEqual(result.moves, ['properties>end', 'align>front', 'italic>front']);
    assert.deepEqual(result.card, ['italic', 'align', 'properties']);
    assert.deepEqual(result.folded, result.card);
    assert.ok(result.width <= 170);
  });

  it('never moves the tail group or a kept control, even when the strip still does not fit', () => {
    const result = strip(
      [
        { name: 'bold', width: 30 },
        { name: 'link', width: 30, role: 'pinned' },
        { name: 'delete', width: 30, role: 'pinned' },
      ],
      40,
    );
    assert.deepEqual(result.card, ['bold']);
    assert.equal(result.width, 60);
  });

  it('folds nothing when nothing may move', () => {
    assert.deepEqual(strip([{ name: 'ask', width: 300, role: 'pinned' }], 100).card, []);
  });

  it('moves the more button even when the strip fits without it', () => {
    const result = strip(
      [
        { name: 'bold', width: 30 },
        { name: 'properties', width: 30, role: 'more' },
      ],
      50,
    );
    assert.deepEqual(result.card, ['properties']);
  });

  it('keeps one divider between groups and none at the ends or next to an empty group', () => {
    assert.deepEqual(shownRuns(['group', 'divider', 'group']), [true, true, true]);
    assert.deepEqual(shownRuns(['divider', 'group', 'divider']), [false, true, false]);
    assert.deepEqual(shownRuns(['group', 'divider', 'empty', 'divider', 'group']), [true, true, false, false, true]);
    assert.deepEqual(shownRuns(['empty', 'divider', 'group', 'divider', 'empty']), [false, false, true, false, false]);
    assert.deepEqual(shownRuns(['group', 'group']), [true, true]);
  });
});

describe('placing the card', () => {
  const band = { top: 0, bottom: 800 };
  it('opens on the strip’s side when there is room', () => {
    assert.deepEqual(placeCard({ top: 300, bottom: 340, right: 600 }, { width: 200, height: 40 }, 'above', band), { side: 'above', shift: 0 });
    assert.deepEqual(placeCard({ top: 300, bottom: 340, right: 600 }, { width: 200, height: 40 }, 'below', band), { side: 'below', shift: 0 });
  });

  it('flips when its side is short and the other side has more room', () => {
    assert.equal(placeCard({ top: 30, bottom: 70, right: 600 }, { width: 200, height: 40 }, 'above', band).side, 'below');
    assert.equal(placeCard({ top: 740, bottom: 780, right: 600 }, { width: 200, height: 40 }, 'below', band).side, 'above');
  });

  it('stays on its side when the other side has no more room', () => {
    assert.equal(placeCard({ top: 30, bottom: 70, right: 600 }, { width: 200, height: 40 }, 'above', { top: 0, bottom: 90 }).side, 'above');
  });

  it('keeps inside the band it is given', () => {
    assert.equal(placeCard({ top: 100, bottom: 140, right: 600 }, { width: 200, height: 40 }, 'above', { top: 80, bottom: 800 }).side, 'below');
  });

  it('moves right to stay 8px from the viewport’s left edge', () => {
    assert.equal(placeCard({ top: 300, bottom: 340, right: 150 }, { width: 200, height: 40 }, 'above', band).shift, 58);
  });
});

describe('keys and focus', () => {
  const press = (key: string, mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({ key, altKey: false, ctrlKey: false, metaKey: false, ...mods });

  it('moves along the controls with the arrows, wrapping at the ends', () => {
    assert.equal(arrowStep(press('ArrowRight'), 0, 4), 1);
    assert.equal(arrowStep(press('ArrowDown'), 3, 4), 0);
    assert.equal(arrowStep(press('ArrowLeft'), 0, 4), 3);
    assert.equal(arrowStep(press('ArrowUp'), 2, 4), 1);
    assert.equal(arrowStep(press('Home'), 2, 4), 0);
    assert.equal(arrowStep(press('End'), 0, 4), 3);
    assert.equal(arrowStep(press('ArrowRight'), -1, 4), 0);
  });

  it('leaves other keys, modified arrows and an empty strip alone', () => {
    assert.equal(arrowStep(press('Enter'), 0, 4), null);
    assert.equal(arrowStep(press('ArrowRight', { metaKey: true }), 0, 4), null);
    assert.equal(arrowStep(press('ArrowRight', { altKey: true }), 0, 4), null);
    assert.equal(arrowStep(press('ArrowRight'), 0, 0), null);
  });

  it('scrolls a control into view with a margin', () => {
    assert.equal(scrollToShow({ left: 10, right: 40 }, { left: 0, right: 200 }, 48), -38);
    assert.equal(scrollToShow({ left: 180, right: 210 }, { left: 0, right: 200 }, 8), 18);
    assert.equal(scrollToShow({ left: 60, right: 90 }, { left: 0, right: 200 }, 8), 0);
  });

  it('takes Escape for the open card, except from a text field or with a popup of the strip open', () => {
    const escape = { key: 'Escape', defaultPrevented: false, ownedHere: true, popupOpen: false, inTextField: false };
    assert.equal(takesEscape(escape), true);
    assert.equal(takesEscape({ ...escape, inTextField: true }), false);
    assert.equal(takesEscape({ ...escape, popupOpen: true }), false);
    assert.equal(takesEscape({ ...escape, ownedHere: false }), false);
    assert.equal(takesEscape({ ...escape, defaultPrevented: true }), false);
    assert.equal(takesEscape({ ...escape, key: 'Enter' }), false);
  });

  it('closes the card when Tab leaves the strip, or later when it leaves the focus nowhere', () => {
    const exit = { tabbing: true, byFocusKey: false, popupOpen: false, toToast: false };
    assert.equal(focusExit({ ...exit, into: 'outside' }), 'close');
    assert.equal(focusExit({ ...exit, into: 'nowhere' }), 'close-unless-back');
    assert.equal(focusExit({ ...exit, into: 'strip' }), 'stay');
  });

  it('closes the card when F6 or Escape moves the focus out, unless a popup is open or a toast took it', () => {
    const exit = { into: 'outside' as const, tabbing: false, byFocusKey: true, popupOpen: false, toToast: false };
    assert.equal(focusExit(exit), 'close');
    assert.equal(focusExit({ ...exit, popupOpen: true }), 'stay');
    assert.equal(focusExit({ ...exit, toToast: true }), 'stay');
    assert.equal(focusExit({ ...exit, into: 'nowhere' }), 'stay');
    assert.equal(focusExit({ ...exit, byFocusKey: false }), 'stay');
  });

  it('focuses the card’s first button when opened from the keyboard, else its first field', () => {
    assert.equal(firstInCard(['bold', 'italic'], ['size']), 'bold');
    assert.equal(firstInCard([], ['size', 'weight']), 'size');
    assert.equal(firstInCard([], []), null);
  });
});
