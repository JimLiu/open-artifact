import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CanvasNote } from '@open-artifact/design-core';
import { clockTime, coverName, heightForVideo, MEDIA_MESSAGES, scrubRefusal, UPLOADED_VIDEO, videoName, videoSettingPatch } from '../src/lib/video-settings.ts';

const video: CanvasNote = { kind: 'image', x: 0, y: 0, w: 320, h: 180, src: '/_blob/c', video: '/_blob/v' };

test('Autoplay on removes videoStart and Sound; off writes click', () => {
  assert.deepEqual(videoSettingPatch({ ...video, videoStart: 'click', videoSound: 'on' }, 'autoplay', true), { videoStart: undefined, videoSound: undefined });
  assert.deepEqual(videoSettingPatch(video, 'autoplay', false), { videoStart: 'click' });
});

test('Loop off writes off; on removes it', () => {
  assert.deepEqual(videoSettingPatch(video, 'loop', false), { videoLoop: 'off' });
  assert.deepEqual(videoSettingPatch({ ...video, videoLoop: 'off' }, 'loop', true), { videoLoop: undefined });
});

test('Sound is written only when the video does not autoplay', () => {
  assert.equal(videoSettingPatch(video, 'sound', true), null);
  assert.deepEqual(videoSettingPatch({ ...video, videoStart: 'click' }, 'sound', true), { videoSound: 'on' });
  assert.deepEqual(videoSettingPatch({ ...video, videoStart: 'click', videoSound: 'on' }, 'sound', false), { videoSound: undefined });
});

test('row names: alt or a generic name; custom cover or a frame', () => {
  assert.equal(videoName(video), UPLOADED_VIDEO);
  assert.equal(videoName({ ...video, alt: ' Launch ' }), 'Launch');
  assert.equal(coverName(video), 'Video frame');
  assert.equal(coverName({ ...video, videoCover: 'custom' }), 'Custom cover image');
});

test('scrubber refusals, in order', () => {
  const ok = { mounted: true, waiting: false, loaded: true, duration: 4 };
  assert.equal(scrubRefusal(ok), null);
  assert.match(scrubRefusal({ ...ok, waiting: true })!, /^Only 4 videos play at once/);
  assert.match(scrubRefusal({ ...ok, mounted: false })!, /isn’t playing here right now/);
  assert.equal(scrubRefusal({ ...ok, loaded: false }), 'The video hasn’t loaded yet.');
  assert.match(scrubRefusal({ ...ok, duration: Infinity })!, /doesn’t say how long it is/);
});

test('clock time and the height a replaced video gives', () => {
  assert.equal(clockTime(0), '0:00');
  assert.equal(clockTime(75.9), '1:15');
  assert.equal(clockTime(Number.NaN), '0:00');
  assert.equal(heightForVideo(320, { w: 400, h: 200 }, 90), 160);
  assert.equal(heightForVideo(320, { w: 0, h: 0 }, 90), 90, 'an unknown size keeps the height');
  assert.equal(heightForVideo(320, { w: 4000, h: 10 }, 90), 16, 'at least 16');
  assert.equal(heightForVideo(320, { w: 10, h: 4000 }, 90), 8000, 'at most 8000');
});

test('replace messages drop the reason’s closing period', () => {
  assert.equal(MEDIA_MESSAGES.notReplaced('Videos over 20 MB can’t be added. Trim or compress it first.'), 'The video was not replaced: Videos over 20 MB can’t be added. Trim or compress it first.');
  assert.equal(MEDIA_MESSAGES.coverNotSet('storage may be full'), 'Couldn’t set the cover image: storage may be full.');
});
