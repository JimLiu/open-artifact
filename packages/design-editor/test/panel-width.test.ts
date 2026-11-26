import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isFixedPreset, nextPanelWidth } from '../src/lib/panel-width.ts';

describe('panel width presets', () => {
  const widths = { default: 336, min: 285, max: 560, custom: null };
  it('steps default, widest, narrowest', () => {
    assert.equal(nextPanelWidth(336, widths), 560);
    assert.equal(nextPanelWidth(560, widths), 285);
    assert.equal(nextPanelWidth(285, widths), 336);
  });
  it('takes the dragged width in turn, and sends any other width to the widest', () => {
    assert.equal(nextPanelWidth(285, { ...widths, custom: 400 }), 400);
    assert.equal(nextPanelWidth(400, { ...widths, custom: 400 }), 336);
    assert.equal(nextPanelWidth(410, widths), 560);
  });
  it('clamps presets to a narrow window', () => {
    assert.equal(nextPanelWidth(336, { ...widths, max: 300 }), 300);
    assert.ok(isFixedPreset(285, widths));
    assert.ok(!isFixedPreset(300, widths));
  });
});
