/**
 * A silent MP4 from frames the caller draws: the video encoder of the
 * Motion exports (codec choice, bitrate, the set-ups tried in turn), with
 * no film and no sound. Other editors load it on its own
 * (`@open-artifact/motion-export/frames`) to turn something they paint
 * into a short video.
 */

import { EXPORT_SETTINGS } from '@open-artifact/motion-core';
import { chooseVideoBitrate } from './plan.ts';
import type { ExportDimensions, ExportFrame, ExportProgress, HeldFrames } from './types.ts';
import { newEncoderMemory } from './video/attempts.ts';
import type { EncoderMemory } from './video/attempts.ts';
import { encodeVideo } from './video/encode.ts';
import { chooseExportCodecs } from './video/format.ts';
import type { VideoFormat, VideoPlan } from './video/format.ts';

export type { ExportFrame, HeldFrames } from './types.ts';
export type { VideoFormat } from './video/format.ts';
export type { EncoderMemory } from './video/attempts.ts';
export { newEncoderMemory };

/** The video's size (even pixels), frame rate and number of frames. */
export interface FramesVideoSize extends ExportDimensions {
  fps: number;
  frames: number;
}

/** The plan for a video of that size; null when this browser encodes no video at that size. */
export async function planFramesVideo(size: FramesVideoSize): Promise<VideoPlan | null> {
  const videoBitrate = chooseVideoBitrate(size, size.fps);
  const format = await chooseExportCodecs(size, videoBitrate);
  return format === null ? null : { width: size.width, height: size.height, fps: size.fps, frames: size.frames, videoBitrate, format };
}

/**
 * Whether this browser can encode a video of that size: the codecs it would
 * use, or null when it has no video encoder or encodes none of them (also
 * when asking fails).
 */
export async function canEncodeFramesVideo(size: FramesVideoSize): Promise<VideoFormat | null> {
  try {
    return (await planFramesVideo(size))?.format ?? null;
  } catch {
    return null;
  }
}

export interface FramesVideoOptions extends FramesVideoSize {
  /** Frame at `t` seconds as a picture `width` × `height`; the encoder closes each picture it is given. */
  frame: ExportFrame;
  /** What the encoder learned in earlier videos of this page (default: nothing). */
  memory?: EncoderMemory;
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

export interface FramesVideo {
  bytes: Uint8Array<ArrayBuffer>;
  format: VideoFormat;
  /** Frames that could not be drawn, each replaced by the one before. */
  held: HeldFrames;
  ms: number;
}

/** Encodes the frames as a silent MP4. Rejects when the browser encodes no video at that size, or the encoder fails. */
export async function encodeFramesVideo(options: FramesVideoOptions): Promise<FramesVideo> {
  const plan = await planFramesVideo(options);
  if (plan === null) throw new Error('This browser cannot encode video at this size.');
  const made = await encodeVideo({
    plan,
    frame: options.frame,
    audio: null,
    firstPacketMs: EXPORT_SETTINGS.firstPacketS * 1000,
    nextOnBreak: EXPORT_SETTINGS.onBreak === 'next',
    rangeFromStream: EXPORT_SETTINGS.rangeLabel === 'stream',
    lastInSoftware: EXPORT_SETTINGS.lastTry === 'software',
    stalls: EXPORT_SETTINGS.stallsInView,
    memory: options.memory ?? newEncoderMemory(),
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  return { bytes: made.bytes, format: plan.format, held: made.held, ms: made.ms };
}
