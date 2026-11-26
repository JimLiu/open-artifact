/**
 * A part of a video file the person picked, read and converted so it can be stored with a film: an H.264 MP4 with AAC
 * sound, small enough for the upload limit (`videoEncodePlan` sizes it; a file still too large is made again smaller).
 * The page runs these in a worker (`./worker.ts`), so the file's demuxers stay out of the page.
 */

import { ALL_FORMATS, BlobSource, Conversion, Input, canEncodeAudio, canEncodeVideo } from 'mediabunny';
import { MAX_VIDEO_UPLOAD_BYTES, looksLikeVideoFile, videoEncodePlan, type VideoEncodePlan } from '@open-artifact/motion-core';
import { createMp4Output, withoutResizableArrayBuffers } from '../video/output.ts';
import { VideoPartError, type VideoFileFacts, type VideoPart } from './problem.ts';

const HEAD_BYTES = 16;

/** Reads a file's length and frame; throws a {@link VideoPartError} for one that is not a video this browser reads. */
export async function readVideoFile(file: Blob): Promise<VideoFileFacts> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  if (!looksLikeVideoFile(head)) throw new VideoPartError('not-video');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (video === null) throw new VideoPartError('not-video');
    if (!(await video.canDecode())) throw new VideoPartError('unreadable');
    const duration = await input.computeDuration();
    const stats = await video.computePacketStats(60).catch(() => null);
    const audio = await input.getPrimaryAudioTrack();
    if (!(duration > 0) || !(video.displayWidth > 0 && video.displayHeight > 0)) throw new VideoPartError('unreadable');
    return {
      duration,
      width: video.displayWidth,
      height: video.displayHeight,
      fps: stats !== null && stats.averagePacketRate > 0 ? stats.averagePacketRate : null,
      hasSound: audio !== null && (await audio.canDecode()),
    };
  } catch (error) {
    throw error instanceof VideoPartError ? error : new VideoPartError('unreadable', error);
  } finally {
    input.dispose();
  }
}

/** Whether this browser can write the picture a part is converted to (without sound it is stored silent). */
export async function canConvertVideo(plan: VideoEncodePlan): Promise<boolean> {
  try {
    return await canEncodeVideo('avc', { width: plan.width, height: plan.height, bitrate: plan.bitrate, frameRate: plan.fps });
  } catch {
    return false;
  }
}

export interface VideoPartOptions {
  /** The part, in the file's seconds. */
  start: number;
  end: number;
  facts: VideoFileFacts;
  /** 0–1 through the conversion; a smaller try starts again from 0. */
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

async function convertOnce(file: Blob, options: VideoPartOptions, plan: VideoEncodePlan, report: (progress: number) => void): Promise<VideoPart> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const mp4 = createMp4Output();
  try {
    const audioOk = options.facts.hasSound && (await canEncodeAudio('aac', { bitrate: plan.audioBitrate }).catch(() => false));
    const conversion = await withoutResizableArrayBuffers(() =>
      Conversion.init({
        input,
        output: mp4.output,
        tracks: 'primary',
        trim: { start: options.start, end: options.end },
        video: { codec: 'avc', width: plan.width, height: plan.height, fit: 'contain', bitrate: plan.bitrate, frameRate: plan.fps, forceTranscode: true },
        audio: audioOk ? { codec: 'aac', bitrate: plan.audioBitrate, forceTranscode: true } : { discard: true },
        showWarnings: false,
      }),
    );
    if (!conversion.isValid || !conversion.utilizedTracks.some((track) => track.isVideoTrack())) throw new VideoPartError('no-encoder');
    conversion.onProgress = (progress) => report(progress);
    const abort = (): void => void conversion.cancel();
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      await conversion.execute();
    } finally {
      options.signal?.removeEventListener('abort', abort);
    }
    options.signal?.throwIfAborted();
    const bytes = mp4.file();
    if (bytes === null) throw new VideoPartError('failed');
    return { bytes, width: plan.width, height: plan.height };
  } finally {
    input.dispose();
  }
}

/**
 * Converts the part `start`–`end` of `file`: smaller at each try while the result is over the upload limit. Throws a
 * {@link VideoPartError}, or the abort reason once `signal` aborts.
 */
export async function convertVideoPart(file: Blob, options: VideoPartOptions): Promise<VideoPart> {
  const seconds = options.end - options.start;
  for (let attempt = 0; ; attempt++) {
    const plan = videoEncodePlan(options.facts, seconds, attempt);
    if (plan === null) throw new VideoPartError('too-large');
    if (attempt === 0 && !(await canConvertVideo(plan))) throw new VideoPartError('no-encoder');
    let part: VideoPart;
    try {
      part = await convertOnce(file, options, plan, (progress) => options.onProgress?.(progress));
    } catch (error) {
      options.signal?.throwIfAborted();
      throw error instanceof VideoPartError ? error : new VideoPartError('failed', error);
    }
    if (part.bytes.byteLength <= MAX_VIDEO_UPLOAD_BYTES) {
      options.onProgress?.(1);
      return part;
    }
  }
}
