import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkDesignProject, cleanCrop, cropApplies, emptyCanvas, normalizeCanvas, serializeCanvas, videoOptions } from '../src/index.ts';

const BLOB = '/_blob/0123456789abcdef0123456789abcdef';

function read(note: Record<string, unknown>) {
  const raw = JSON.parse(serializeCanvas(emptyCanvas('T')));
  raw.notes = { n: { x: 0, y: 0, w: 200, h: 100, kind: 'image', src: BLOB, ...note } };
  return { note: normalizeCanvas(raw).notes.n!, warnings: checkDesignProject(new Map([['canvas.json', JSON.stringify(raw)]])).filter((d) => d.level === 'warning').map((d) => d.message) };
}

describe('an image note’s crop', () => {
  it('pulls values back into range and rounds them', () => {
    assert.deepEqual(cleanCrop({ zoom: 80, x: -1, y: 2 }), { zoom: 50, x: 0, y: 1 });
    assert.deepEqual(cleanCrop({ zoom: 1.234567, x: 0.1234567, y: 0.5 }), { zoom: 1.2346, x: 0.12346, y: 0.5 });
    assert.deepEqual(cleanCrop({ zoom: 0.2, x: 0.3, y: 0.5 }), { zoom: 1, x: 0.3, y: 0.5 });
  });

  it('reads a value that is not a number as its default, and drops a crop that changes nothing', () => {
    assert.deepEqual(cleanCrop({ zoom: '2', x: 0.2, y: null }), { zoom: 1, x: 0.2, y: 0.5 });
    assert.equal(cleanCrop({ zoom: 1, x: 0.5, y: 0.5 }), undefined);
    assert.equal(cleanCrop({}), undefined);
    assert.equal(cleanCrop('zoom'), undefined);
    assert.equal(read({ crop: { zoom: 1, x: 0.5, y: 0.5 } }).note.crop, undefined);
  });

  it('is kept only while the picture covers the note', () => {
    assert.equal(cropApplies({ 'object-fit': 'cover' }), true);
    for (const css of [undefined, {}, { 'object-fit': 'fill' }, { 'object-fit': 'contain' }, { 'object-fit': 'bogus' }]) assert.equal(cropApplies(css), false, JSON.stringify(css));
    // Without a fit the picture fills the note (the default), so a crop there is dropped too.
    const unset = read({ crop: { zoom: 2, x: 0.25, y: 1 } });
    assert.equal(unset.note.crop, undefined);
    assert.ok(unset.warnings.includes('Note "n" crop is ignored: object-fit is not cover.'), unset.warnings.join('\n'));
    assert.deepEqual(read({ crop: { zoom: 2, x: 0.25, y: 1 }, css: { 'object-fit': 'cover' } }).note.crop, { zoom: 2, x: 0.25, y: 1 });
    const contained = read({ crop: { zoom: 2, x: 0.25, y: 1 }, css: { 'object-fit': 'contain' } });
    assert.equal(contained.note.crop, undefined);
    assert.ok(contained.warnings.includes('Note "n" crop is ignored: object-fit is not cover.'), contained.warnings.join('\n'));
  });

  it('is left alone on notes that are not images', () => {
    const raw = JSON.parse(serializeCanvas(emptyCanvas('T')));
    raw.notes = { r: { x: 0, y: 0, kind: 'rect', crop: { zoom: 2, x: 0, y: 0 } } };
    assert.deepEqual(normalizeCanvas(raw).notes.r!.crop, { zoom: 2, x: 0, y: 0 });
  });
});

describe('a video note', () => {
  it('turns its three play settings into how it plays', () => {
    assert.deepEqual(videoOptions({}), { autoplay: true, loop: true, sound: false });
    assert.deepEqual(videoOptions({ videoStart: 'click' }), { autoplay: false, loop: true, sound: false });
    assert.deepEqual(videoOptions({ videoStart: 'click', videoLoop: 'off', videoSound: 'on' }), { autoplay: false, loop: false, sound: true });
    assert.deepEqual(videoOptions({ videoLoop: 'off' }), { autoplay: true, loop: false, sound: false });
  });

  it('plays without sound when it starts on its own', () => {
    assert.equal(videoOptions({ videoSound: 'on' }).sound, false);
    assert.equal(videoOptions({ videoStart: 'yes', videoSound: 'on' }).sound, false);
  });

  it('keeps only an uploaded video, and becomes a plain image without one', () => {
    const outside = read({ video: 'https://example.com/a.mp4', videoStart: 'click' });
    assert.equal(outside.note.video, undefined);
    assert.equal(outside.note.videoStart, undefined);
    assert.ok(outside.warnings.includes('Note "n" video must be an uploaded /_blob/ address; it is ignored.'), outside.warnings.join('\n'));
    assert.equal(read({ video: 'clip.mp4' }).note.video, undefined);
    assert.equal(read({ video: BLOB }).note.video, BLOB);
  });

  it('drops a setting that is not the one value it takes', () => {
    const { note, warnings } = read({ video: BLOB, videoCover: 'yes', videoStart: 'click', videoLoop: false, videoSound: 'on' });
    assert.equal(note.videoCover, undefined);
    assert.equal(note.videoLoop, undefined);
    assert.equal(note.videoStart, 'click');
    assert.equal(note.videoSound, 'on');
    assert.ok(warnings.includes('Note "n" videoCover "yes" is not a value it takes; it is ignored.'), warnings.join('\n'));
    assert.ok(warnings.includes('Note "n" videoLoop "false" is not a value it takes; it is ignored.'), warnings.join('\n'));
    assert.ok(!warnings.some((m) => m.includes('videoStart') || m.includes('videoSound')));
  });
});
