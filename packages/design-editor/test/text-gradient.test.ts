import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { patchStyle, styleMap } from '@open-artifact/dc';
import { firstStopOf, GRADIENT_ACCENT, GRADIENT_DARK, initialGradient, mixColors, paintsText, solidTextPatch, textGradientOf, textGradientPatch } from '../src/lib/text-gradient.ts';

describe('gradient text', () => {
  it('reads the clip from the inline style, else the computed one (either name)', () => {
    assert.equal(paintsText(styleMap('-webkit-background-clip: text')), true);
    assert.equal(paintsText({}, { '-webkit-background-clip': 'text' }), true);
    assert.equal(paintsText({}, { 'background-clip': 'text' }), true);
    assert.equal(paintsText(styleMap('background-clip: border-box'), { '-webkit-background-clip': 'text' }), false);
    assert.equal(paintsText({}, { 'background-clip': 'border-box' }), false);
    const inline = styleMap('background: linear-gradient(90deg, red, blue); background-clip: text');
    assert.equal(textGradientOf(inline), 'linear-gradient(90deg, red, blue)');
    assert.equal(textGradientOf(styleMap('background: linear-gradient(red, blue)')), null);
  });

  it('starts from the current color, moved 60% toward the accent', () => {
    assert.equal(initialGradient({ inline: '#ff0000' }), `linear-gradient(180deg, #ff0000 0%, ${mixColors('#ff0000', GRADIENT_ACCENT, 0.6)} 100%)`);
    // A clear written color falls back to the computed one, then a variable's fallback, then the accent.
    assert.match(initialGradient({ inline: 'transparent', computed: 'rgb(0, 128, 0)' }), /^linear-gradient\(180deg, #008000 0%/);
    assert.match(initialGradient({ inline: 'var(--ink, #123456)', computed: 'rgba(0, 0, 0, 0)' }), /#123456 0%/);
    // The accent itself moves toward white.
    assert.equal(initialGradient({}), `linear-gradient(180deg, ${GRADIENT_ACCENT} 0%, ${mixColors(GRADIENT_ACCENT, '#ffffff', 0.6)} 100%)`);
    assert.equal(initialGradient({ inline: '#ff0000' }, false), `linear-gradient(180deg, #ff0000 0%, ${GRADIENT_DARK} 100%)`);
    assert.equal(mixColors('#000000', '#ffffff', 0.5), '#808080');
  });

  it('starts from the gradient the element had before going solid', () => {
    assert.equal(initialGradient({ inline: '#ff0000' }, true, 'radial-gradient(circle, red, blue)'), 'radial-gradient(circle, red, blue)');
    assert.match(initialGradient({ inline: '#ff0000' }, true, '#00ff00'), /^linear-gradient\(180deg, #ff0000/);
  });

  it('writes the four declarations and takes them away again', () => {
    const style = 'color: #222; background-image: url(a.png)';
    const painted = patchStyle(style, textGradientPatch(styleMap(style), 'linear-gradient(red, blue)'));
    const inline = styleMap(painted);
    assert.equal(inline.background, 'linear-gradient(red, blue)');
    assert.equal(inline['background-clip'], 'text');
    assert.equal(inline['-webkit-background-clip'], 'text');
    assert.equal(inline['-webkit-text-fill-color'], 'transparent');
    assert.equal(inline['background-image'], undefined);
    const solid = styleMap(patchStyle(painted, solidTextPatch(inline, '#ff0000')));
    assert.deepEqual(solid, { color: '#ff0000' });
    assert.equal(firstStopOf('linear-gradient(180deg, #ff0000 0%, rgb(1, 2, 3) 100%)'), '#ff0000');
    assert.equal(firstStopOf('linear-gradient(rgb(1, 2, 3), #fff)'), 'rgb(1, 2, 3)');
  });

  it('overrides a clip that comes from a stylesheet when going solid', () => {
    const solid = styleMap(patchStyle('font-weight: 700', solidTextPatch(styleMap('font-weight: 700'), '#123456')));
    assert.deepEqual(solid, { 'font-weight': '700', background: 'none', '-webkit-text-fill-color': 'currentcolor', color: '#123456' });
    // Clipped inline over a class's gradient: the clip goes, the class's layer is turned off.
    const own = styleMap(patchStyle('-webkit-background-clip: text; -webkit-text-fill-color: transparent', solidTextPatch(styleMap('-webkit-background-clip: text; -webkit-text-fill-color: transparent'), '#123456')));
    assert.deepEqual(own, { background: 'none', color: '#123456' });
  });
});
