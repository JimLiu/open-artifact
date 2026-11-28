import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  coverFrameTime,
  coverSize,
  isMp4Container,
  meanLuminance,
  uploadRefusal,
  VIDEO_MESSAGES,
  videoKindOf,
  videoNoteSize,
  videoRefusalMessage,
  videoRow,
  videoTitle,
} from '../src/lib/video-files.ts';

const bytes = (text: string) => new Uint8Array([0, 0, 0, 24, ...Array.from(text, (c) => c.charCodeAt(0))]);

describe('video files', () => {
  it('takes .mp4, .webm and .mov by name or type', () => {
    assert.equal(videoKindOf({ name: 'a.MP4', type: '' }), 'mp4');
    assert.equal(videoKindOf({ name: 'clip', type: 'video/webm' }), 'webm');
    assert.equal(videoKindOf({ name: 'old.mov', type: 'video/quicktime' }), 'mov');
    assert.equal(videoKindOf({ name: 'a.avi', type: 'video/x-msvideo' }), null);
  });

  it('reads a .mov with an ftyp box as MP4, any other as old QuickTime', () => {
    assert.equal(isMp4Container(bytes('ftypqt  ')), true);
    assert.equal(isMp4Container(bytes('moov')), false);
    assert.equal(isMp4Container(new Uint8Array([0, 0, 0])), false);
  });

  it('names the note after the file, at most 60 characters, else "Video"', () => {
    assert.equal(videoTitle('Product demo.mp4'), 'Product demo');
    assert.equal(videoTitle(`${'a'.repeat(80)}.webm`), 'a'.repeat(60));
    assert.equal(videoTitle('.mp4'), 'Video');
    assert.equal(videoTitle('   '), 'Video');
  });

  it('sizes the note from the video, within 48–1200 wide and 8000 tall', () => {
    assert.deepEqual(videoNoteSize(1920, 1080), { w: 1200, h: 675 });
    assert.deepEqual(videoNoteSize(640, 360), { w: 640, h: 360 });
    assert.deepEqual(videoNoteSize(20, 10), { w: 48, h: 24 });
    assert.deepEqual(videoNoteSize(100, 20000), { w: 40, h: 8000 });
    assert.deepEqual(videoNoteSize(0, 0), { w: 640, h: 360 });
  });

  it('centres the first on the point and lines the rest up to its right, 80 apart', () => {
    assert.deepEqual(videoRow([{ w: 200, h: 100 }, { w: 100, h: 50 }, { w: 40, h: 40 }], { x: 500, y: 300 }), [
      { x: 400, y: 250 },
      { x: 680, y: 275 },
      { x: 860, y: 280 },
    ]);
  });

  it('takes the cover early, later after a dark frame, never past half the video', () => {
    assert.equal(coverFrameTime(10), 0.1);
    assert.equal(coverFrameTime(10, true), 1);
    assert.equal(coverFrameTime(0.1), 0.05);
    assert.equal(coverFrameTime(1, true), 0.5);
    assert.equal(coverFrameTime(Number.POSITIVE_INFINITY), 0.1);
    assert.ok(Math.abs(meanLuminance([255, 255, 255, 255, 0, 0, 0, 255]) - 127.5) < 0.01);
    assert.deepEqual(coverSize(3840, 2160), { w: 1920, h: 1080 });
    assert.deepEqual(coverSize(640, 360), { w: 640, h: 360 });
  });

  it('says why a video was refused', () => {
    assert.equal(videoRefusalMessage('quicktime'), 'This .mov is in an older QuickTime format that can’t be added. Convert it to .mp4 (H.264) first.');
    assert.equal(videoRefusalMessage('quicktime', true), 'This .mov is in an older QuickTime format that can’t be used. Convert it to .mp4 (H.264) first.');
    assert.equal(videoRefusalMessage('size'), 'Videos over 20 MB can’t be added. Trim or compress it first.');
    assert.equal(uploadRefusal(new Error('ENOSPC: no space left on device')), 'storage');
    assert.equal(uploadRefusal(new Error('HTTP 500')), 'upload');
    assert.equal(VIDEO_MESSAGES.tooMany(4), 'Adding the first 4 videos. Add the rest separately.');
    assert.equal(VIDEO_MESSAGES.noCover('pasted'), 'Couldn’t store a cover image for the pasted video, so it wasn’t added. Try again.');
  });
});
