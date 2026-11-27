import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SUBMENU_AIM_MOVE_GAP_MS,
  aimDecision,
  countAimMoves,
  dropsSubmenuOpenChange,
  isPointerClick,
  rectCenterInside,
  type AimRect,
} from '../src/kit/menu-aim.ts';

const rect = (left: number, top: number, right: number, bottom: number): AimRect => ({
  left,
  top,
  right,
  bottom,
  width: right - left,
  height: bottom - top,
});

const row = rect(0, 0, 100, 20);
const submenuOnRight = rect(100, 0, 200, 200);

test('a pointer between the row and the submenu waits, one heading into the submenu rests, one heading away releases', () => {
  assert.equal(aimDecision(100, 10, 100.3, 10, row, submenuOnRight), 'wait');
  assert.equal(aimDecision(100, 10, 100.4, 60, row, submenuOnRight), 'rest');
  assert.equal(aimDecision(100, 10, 50, 100, row, submenuOnRight), 'release');
});

test('a submenu overlapping its row, or a pointer leaving the far side of the row, gives no aim', () => {
  assert.equal(aimDecision(50, 10, 60, 10, row, rect(50, 0, 150, 200)), 'release');
  assert.equal(aimDecision(0, 10, 150, 50, row, submenuOnRight), 'release');
});

test('a submenu that opens to the left aims the other way', () => {
  const submenuOnLeft = rect(-100, 0, 0, 200);
  assert.equal(aimDecision(0, 10, -0.4, 60, row, submenuOnLeft), 'rest');
  assert.equal(aimDecision(0, 10, 50, 60, row, submenuOnLeft), 'release');
});

test('a row whose center sits inside the held row is left taking the pointer', () => {
  assert.ok(rectCenterInside(rect(10, 5, 30, 15), row));
  assert.ok(!rectCenterInside(rect(0, 20, 100, 40), row));
  assert.ok(!rectCenterInside(rect(-40, 0, 10, 20), row));
});

test('pointer moves close together add up into one run; a pause starts a new one', () => {
  const run = { moves: 0, lastAt: -Infinity };
  assert.equal(countAimMoves(run, 0, 0, 1), 1);
  assert.equal(countAimMoves(run, 16, 16, 2), 3);
  assert.equal(countAimMoves(run, 16 + SUBMENU_AIM_MOVE_GAP_MS + 1, 16 + SUBMENU_AIM_MOVE_GAP_MS + 1, 1), 1);
});

test('only a click with a press count is a pointer click', () => {
  assert.ok(isPointerClick(new CustomEvent('click', { detail: 1 })));
  assert.ok(!isPointerClick(new CustomEvent('click', { detail: 0 })));
  assert.ok(!isPointerClick(new CustomEvent('mousedown', { detail: 1 })));
  assert.ok(!isPointerClick(undefined));
});

test('an open submenu drops a pointer click or, after a click opened it, a hover asking it to open again', () => {
  const click = new CustomEvent('click', { detail: 1 });
  const hover = new Event('mousemove');
  const shown = { open: true, pressHidden: false, clickOpened: false };
  assert.ok(dropsSubmenuOpenChange(true, { reason: 'trigger-press', event: click }, shown));
  assert.ok(!dropsSubmenuOpenChange(true, { reason: 'trigger-hover', event: hover }, shown));
  assert.ok(dropsSubmenuOpenChange(true, { reason: 'trigger-hover', event: hover }, { ...shown, clickOpened: true }));
  assert.ok(!dropsSubmenuOpenChange(false, { reason: 'trigger-press', event: click }, shown));
  assert.ok(!dropsSubmenuOpenChange(true, { reason: 'trigger-press', event: click }, { ...shown, open: false }));
});

test('a mouse press on a row that opens on hover does not open its submenu', () => {
  const press = new Event('mousedown');
  assert.ok(dropsSubmenuOpenChange(true, { reason: 'trigger-press', event: press }, { open: false, pressHidden: true, clickOpened: false }));
  assert.ok(!dropsSubmenuOpenChange(true, { reason: 'trigger-press', event: press }, { open: false, pressHidden: false, clickOpened: false }));
});
