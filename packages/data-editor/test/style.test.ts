import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepChangedTweaks, mergeStyleTweaks, previewLook, shownStyleTweaks, styleAfterSave } from '../src/page/look.ts';

test('a style change keeps only what differs from the stored tweaks', () => {
  const stored = { palette: 'Ocean', corners: 4 };
  assert.deepEqual(keepChangedTweaks({ palette: 'Ocean', font: 'Serif' }, stored), { font: 'Serif' });
  assert.equal(keepChangedTweaks({ font: null }, stored), null);
  assert.deepEqual(keepChangedTweaks({ palette: null, page: null, corners: null, font: null, size: null }, stored), { palette: null, corners: null });
});

test('the page previews the unsaved tweaks over the stored ones', () => {
  const look = { system: { name: 'Ocean' }, tweaks: { palette: 'Ocean', corners: 4 } };
  assert.deepEqual(previewLook(look, { palette: null, size: 'large' }), { system: { name: 'Ocean' }, tweaks: { corners: 4, size: 'large' } });
  assert.equal(previewLook(look, null), look);
  assert.deepEqual(shownStyleTweaks(undefined, { page: 'white' }), { page: 'white' });
  assert.deepEqual(mergeStyleTweaks({ palette: 'Clay' }, { palette: null }), {});
});

test('a change made while a style save runs stays unsaved after it', () => {
  const before = { palette: 'Ocean', corners: 4 };
  // Corners went to 8 while the save of the font ran.
  assert.deepEqual(styleAfterSave({ font: 'Serif', corners: 8 }, { font: 'Serif' }, before, true), { corners: 8 });
  assert.equal(styleAfterSave({ font: 'Serif' }, { font: 'Serif' }, before, true), null);
  assert.equal(styleAfterSave(null, { font: 'Serif' }, before, true), null);
  // A failed save gives its change back, under what changed since.
  assert.deepEqual(styleAfterSave({ corners: 8 }, { font: 'Serif', corners: 6 }, before, false), { font: 'Serif', corners: 8 });
  assert.deepEqual(styleAfterSave(null, { font: 'Serif' }, before, false), { font: 'Serif' });
});
