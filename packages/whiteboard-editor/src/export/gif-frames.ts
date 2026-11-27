/**
 * The frames of a flowing board's GIF. Every flowing line moves at the same
 * speed over the same dash period, so the whole board repeats after one
 * period (`ARROW_FLOW`): the GIF is the board at {@link FLOW_GIF_FRAMES}
 * even steps of it, looping for ever.
 */

import { ARROW_FLOW } from '@open-artifact/whiteboard-core';

/** Frames in one loop of the board's flow. */
export const FLOW_GIF_FRAMES = 10;
/** Longest edge of the GIF by default, pixels (256 colors gain nothing from more). */
export const FLOW_GIF_MAX_PX = 2048;

/** One frame of the GIF: how far the dashes have travelled (0 to 1 of a period) and how long it shows. */
export interface FlowGifFrame {
  phase: number;
  /** Hundredths of a second. */
  delayCs: number;
}

/** The GIF's frames: {@link FLOW_GIF_FRAMES} even phases of one period, together lasting `ARROW_FLOW.seconds`. */
export function flowGifFrames(): FlowGifFrame[] {
  const delayCs = Math.round((ARROW_FLOW.seconds * 100) / FLOW_GIF_FRAMES);
  return Array.from({ length: FLOW_GIF_FRAMES }, (_, k) => ({ phase: k / FLOW_GIF_FRAMES, delayCs }));
}
