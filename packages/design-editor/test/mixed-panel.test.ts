import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { changedBy, mixedRoles, noteRoles, positionBlocked, radiiAfter, radiusSaid, sharedGuides, sharedValue, typedChange } from '../src/lib/mixed-panel.ts';
import { noteFilled } from '../src/lib/paint.ts';

describe('rows for several members', () => {
  it('shows the one value, Mixed, or nothing', () => {
    assert.equal(sharedValue([4, 4]), '4');
    assert.equal(sharedValue([4, 8]), 'Mixed');
    assert.equal(sharedValue([]), '');
    assert.equal(sharedValue([undefined, 0], (value) => String(value ?? 0)), '0');
  });

  it('gives a note the rows it has in its own panel', () => {
    assert.deepEqual(noteRoles({ kind: 'rect' }), ['fill']);
    assert.deepEqual(noteRoles({ kind: 'oval' }), ['fill']);
    assert.deepEqual(noteRoles({}), []);
    assert.deepEqual(noteRoles({ kind: 'title1' }), []);
  });

  it('keeps only the color rows every member has', () => {
    assert.deepEqual(mixedRoles(['box', 'box'], [], 0), ['fill', 'stroke']);
    assert.deepEqual(mixedRoles(['box', 'text'], [], 0), []);
    assert.deepEqual(mixedRoles(['box', 'shape'], [{ kind: 'rect' }], 0), ['fill']);
    assert.deepEqual(mixedRoles(['box'], [{ kind: 'rect' }, {}], 0), []);
    assert.deepEqual(mixedRoles([], [{ kind: 'rect' }, { kind: 'oval' }], 0), ['fill']);
    // Artboards have no fill or stroke.
    assert.deepEqual(mixedRoles(['box'], [], 1), []);
  });

  it('turns Position off with canvas objects or pieces in the selection', () => {
    assert.equal(positionBlocked({ objects: 0, pieces: 0 }), false);
    assert.equal(positionBlocked({ objects: 1, pieces: 0 }), true);
    assert.equal(positionBlocked({ objects: 0, pieces: 1 }), true);
  });
});

describe('numbers typed for several artboards', () => {
  it('reads a plain number as a value and a signed one as a change', () => {
    assert.deepEqual(typedChange('12'), { set: 12 });
    assert.deepEqual(typedChange(' 12px '), { set: 12 });
    assert.deepEqual(typedChange('+4'), { by: 4 });
    assert.deepEqual(typedChange('-2.5'), { by: -2.5 });
    assert.equal(typedChange('Mixed'), null);
    assert.equal(typedChange(''), null);
  });

  it('changes each artboard from its own value, whole and not below the least', () => {
    assert.equal(changedBy(10, { by: 4 }), 14);
    assert.equal(changedBy(10, { set: 3 }), 3);
    assert.equal(changedBy(2, { by: -5 }), 0);
    assert.equal(changedBy(2, { by: -5 }, 1), 1);
    assert.equal(changedBy(1.4, { by: 0 }), 1);
  });

  it('gives each artboard its own radius and says what changed', () => {
    assert.deepEqual(radiiAfter([undefined, 8], { by: 4 }), [4, 12]);
    assert.deepEqual(radiiAfter([4, 8], { set: 0 }), [undefined, undefined]);
    assert.equal(radiusSaid([4, 12]), 'Corner radius changed on 2 artboards');
    assert.equal(radiusSaid([6, 6]), 'Corner radius 6px on 2 artboards');
    assert.equal(radiusSaid([undefined, undefined]), 'Corner radius 0px on 2 artboards');
  });

  it('edits guides together only when every artboard has the same ones', () => {
    const grid = { kind: 'grid' as const, size: 8 };
    assert.deepEqual(sharedGuides([{}, { guides: [] }]), []);
    assert.deepEqual(sharedGuides([{ guides: [grid] }, { guides: [grid] }]), [grid]);
    assert.equal(sharedGuides([{ guides: [grid] }, {}]), null);
  });
});

describe('a shape note in a merged Fill row', () => {
  it('takes the color as its background, over a palette fill and an older background', () => {
    const next = noteFilled({ kind: 'rect', x: 0, y: 0, text: '', fill: 'yellow', css: { background: 'linear-gradient(red, blue)', 'border-width': '2px' } } as never, '#ff0000');
    assert.deepEqual(next?.css, { 'border-width': '2px', 'background-color': '#ff0000' });
    assert.equal(next?.fill, 'yellow');
  });

  it('goes back to its palette fill when the color is cleared, and leaves other notes alone', () => {
    const next = noteFilled({ kind: 'oval', x: 0, y: 0, text: '', css: { 'background-color': '#000' } } as never, null);
    assert.equal(next?.css, undefined);
    assert.equal(noteFilled({ x: 0, y: 0, text: '' } as never, '#fff'), null);
  });
});
