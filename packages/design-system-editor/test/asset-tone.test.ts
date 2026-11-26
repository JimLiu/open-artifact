import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canSampleTone, toneFromName, toneFromPixels } from '../src/lib/asset-tone.ts';

/** `count` pixels of one RGBA color. */
const fill = (count: number, [r, g, b, a]: [number, number, number, number]): number[] =>
  Array.from({ length: count }, () => [r, g, b, a]).flat();

describe('asset tone from the name', () => {
  it('reads white and knocked-out marks as needing a dark backdrop', () => {
    for (const name of ['logo-white.svg', 'Logo_Reversed.png', 'mark inverse.svg', 'wordmark-knockout.svg', 'icon.inverted.png']) {
      assert.equal(toneFromName(name), 'dark', name);
    }
  });

  it('reads the backdrop a file says it was made for', () => {
    assert.equal(toneFromName('logo-on-dark.svg'), 'dark');
    assert.equal(toneFromName('logo_for_black.png'), 'dark');
    assert.equal(toneFromName('logo-on-light.svg'), 'light');
    assert.equal(toneFromName('logo for white.png'), 'light', 'the backdrop wins over the bare word white');
  });

  it('says nothing for other names or words inside longer ones', () => {
    assert.equal(toneFromName('logo.svg'), null);
    assert.equal(toneFromName('whitepaper.pdf'), null);
    assert.equal(toneFromName('darkroom.png'), null);
  });

  it('samples only formats that can be transparent', () => {
    assert.equal(canSampleTone('photo.JPG'), false);
    assert.equal(canSampleTone('photo.jpeg'), false);
    assert.equal(canSampleTone('logo.png'), true);
    assert.equal(canSampleTone('logo.svg'), true);
  });
});

describe('asset tone from pixels', () => {
  it('puts a white mark on transparency on a dark backdrop', () => {
    assert.equal(toneFromPixels([...fill(30, [255, 255, 255, 255]), ...fill(70, [0, 0, 0, 0])]), 'dark');
  });

  it('puts a dark mark on transparency on a light backdrop', () => {
    assert.equal(toneFromPixels([...fill(30, [20, 20, 30, 255]), ...fill(70, [0, 0, 0, 0])]), 'light');
  });

  it('leaves opaque pictures and mid-tone marks alone', () => {
    assert.equal(toneFromPixels(fill(100, [255, 255, 255, 255])), null, 'opaque: brings its own background');
    assert.equal(toneFromPixels([...fill(30, [200, 60, 60, 255]), ...fill(70, [0, 0, 0, 0])]), null);
    assert.equal(toneFromPixels(fill(100, [0, 0, 0, 0])), null, 'nothing drawn');
    assert.equal(toneFromPixels([]), null);
  });
});
