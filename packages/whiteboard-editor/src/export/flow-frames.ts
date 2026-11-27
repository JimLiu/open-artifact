/**
 * The frames of a flowing board's GIF and MP4. Every flowing line moves at
 * the same speed over the same dash period, so the whole board repeats
 * after one period (`ARROW_FLOW`): one loop is the board at
 * {@link FLOW_LOOP_FRAMES} even steps of it. The GIF is one loop that
 * repeats for ever; the video plays {@link FLOW_VIDEO_LOOPS} loops.
 */

import { ARROW_FLOW } from '@open-artifact/whiteboard-core';
import type { ExportFrame } from './frame.ts';

/** Frames in one loop of the board's flow. */
export const FLOW_LOOP_FRAMES = 10;
/** Longest edge of the GIF by default, pixels (256 colors gain nothing from more). */
export const FLOW_GIF_MAX_PX = 2048;
/** Frames a second of the video: one loop's frames in one loop's time. */
export const FLOW_VIDEO_FPS = FLOW_LOOP_FRAMES / ARROW_FLOW.seconds;
/** Loops in the video. */
export const FLOW_VIDEO_LOOPS = 12;
/** Frames in the video. */
export const FLOW_VIDEO_FRAMES = FLOW_LOOP_FRAMES * FLOW_VIDEO_LOOPS;
/** Longest edge of the video, pixels. */
export const FLOW_VIDEO_MAX_PX = 1920;

/** The phases of one loop: how far the dashes have travelled, 0 to 1 of a period. */
export function flowLoopPhases(): number[] {
  return Array.from({ length: FLOW_LOOP_FRAMES }, (_, k) => k / FLOW_LOOP_FRAMES);
}

/** One frame of the GIF: how far the dashes have travelled (0 to 1 of a period) and how long it shows. */
export interface FlowGifFrame {
  phase: number;
  /** Hundredths of a second. */
  delayCs: number;
}

/** The GIF's frames: one loop, together lasting `ARROW_FLOW.seconds`. */
export function flowGifFrames(): FlowGifFrame[] {
  const delayCs = Math.round((ARROW_FLOW.seconds * 100) / FLOW_LOOP_FRAMES);
  return flowLoopPhases().map((phase) => ({ phase, delayCs }));
}

/** Which of the loop's frames the video shows at `t` seconds. */
export function flowVideoFrameIndex(t: number): number {
  const index = Math.round(t * FLOW_VIDEO_FPS) % FLOW_LOOP_FRAMES;
  return index < 0 ? index + FLOW_LOOP_FRAMES : index;
}

/** Largest even number of pixels not above `value` (at least 2). */
const evenFloor = (value: number): number => Math.max(2, Math.floor(value / 2) * 2);

/**
 * The frame at even pixel sizes, as video encoders need: the picture
 * shrinks by under a pixel each way and the board is scaled down to fit
 * it, so nothing is cut off.
 */
export function evenVideoFrame(frame: ExportFrame): ExportFrame {
  const width = evenFloor(frame.width);
  const height = evenFloor(frame.height);
  if (width === frame.width && height === frame.height) return frame;
  const scale = Math.min(frame.scale, width / frame.board.w, (height - frame.titleBar) / frame.board.h);
  return { ...frame, width, height, scale };
}
