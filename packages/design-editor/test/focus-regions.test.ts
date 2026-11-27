import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeGoesHome, nextRegion, regionStepOf, type RegionId } from '../src/lib/focus-regions.ts';

const press = (key: string, extra: Partial<{ meta: boolean; shift: boolean; alt: boolean; repeat: boolean }> = {}) => ({ key, meta: false, shift: false, alt: false, ...extra });

describe('F6 regions', () => {
  it('F6 steps forward, ⇧F6 back; Alt does not matter, a held key and ⌘F6 do nothing', () => {
    assert.equal(regionStepOf(press('F6')), 'forward');
    assert.equal(regionStepOf(press('F6', { shift: true })), 'back');
    assert.equal(regionStepOf(press('F6', { alt: true })), 'forward');
    assert.equal(regionStepOf(press('F6', { repeat: true })), null);
    assert.equal(regionStepOf(press('F6', { meta: true })), null);
    assert.equal(regionStepOf(press('F5')), null);
  });

  it('skips regions not showing and wraps around', () => {
    const showing = new Set<RegionId>(['top', 'tools', 'canvas', 'selection', 'panel']);
    assert.equal(nextRegion(showing, 'canvas', 'forward'), 'selection');
    assert.equal(nextRegion(showing, 'selection', 'forward'), 'panel');
    assert.equal(nextRegion(showing, 'panel', 'forward'), 'top');
    assert.equal(nextRegion(showing, 'top', 'back'), 'panel');
    assert.equal(nextRegion(showing, 'canvas', 'back'), 'tools');
    // From outside every region: as if from the canvas.
    assert.equal(nextRegion(showing, null, 'forward'), 'selection');
    assert.equal(nextRegion(new Set<RegionId>(['canvas']), 'canvas', 'forward'), null);
  });

  it('a bare Escape in the selection bar goes home, not from a field or an open list', () => {
    const at = { region: 'selection' as RegionId, inField: false, expanded: false };
    assert.equal(escapeGoesHome(press('Escape'), at), true);
    assert.equal(escapeGoesHome(press('Escape', { shift: true }), at), false);
    assert.equal(escapeGoesHome(press('Escape'), { ...at, inField: true }), false);
    assert.equal(escapeGoesHome(press('Escape'), { ...at, expanded: true }), false);
    assert.equal(escapeGoesHome(press('Escape'), { ...at, region: 'panel' }), false);
  });
});
