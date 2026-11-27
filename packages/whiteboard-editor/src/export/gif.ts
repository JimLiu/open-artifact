/**
 * The board as an animated GIF of its flowing arrows: the board painted at
 * each frame of `gif-frames.ts`, framed like the PNG. Pictures, icon art
 * and the font load once; the encoder (WebAssembly, in a Worker) loads
 * only when a GIF is made.
 */

import { drawnImagePen } from './drawn-svg.ts';
import { exportFrameFor } from './frame.ts';
import { FLOW_GIF_MAX_PX, flowGifFrames } from './gif-frames.ts';
import { loadPictureAssets, RASTER_IMAGE_LOAD_TIMEOUT_MS, type ImageLoadTally } from './images.ts';
import { drawBoardCanvas } from './paint.ts';
import type { BoardPngInput } from './png.ts';

/** What a board GIF is made from: a picture's input, plus a size cap. */
export interface BoardGifInput extends BoardPngInput {
  /** Largest file, bytes: past it the GIF is given up (`blob` undefined). */
  maxBytes?: number;
}

/** A board GIF (none when it passed `maxBytes`) and what became of its pictures. */
export interface BoardGif {
  blob: Blob | undefined;
  tally: ImageLoadTally;
}

/** Paints and encodes the board GIF. Rejects for an empty board or when encoding fails. */
export async function exportBoardGif(input: BoardGifInput): Promise<BoardGif> {
  const frame = exportFrameFor(input.elements, input.measures, input.maxPx ?? FLOW_GIF_MAX_PX);
  if (!frame) throw new Error('The board is empty.');
  const [{ openGifSession }, assets] = await Promise.all([
    import('@open-artifact/wasm-motion'),
    loadPictureAssets(input.elements, drawnImagePen(input.scheme), input.timeoutMs ?? RASTER_IMAGE_LOAD_TIMEOUT_MS, input.looks),
  ]);
  const session = openGifSession({ width: frame.width, height: frame.height, repeat: 0 });
  let finished = false;
  try {
    for (const { phase, delayCs } of flowGifFrames()) {
      const canvas = drawBoardCanvas({
        elements: input.elements,
        title: input.title,
        ...(input.measures ? { measures: input.measures } : {}),
        frame,
        scheme: input.scheme,
        images: assets.images,
        imageSources: assets.imageSources,
        icons: assets.icons,
        showAuthors: input.showAuthors,
        faceName: input.faceName,
        flowPhase: phase,
      });
      let pixels: Uint8ClampedArray;
      try {
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('This browser cannot draw the board picture.');
        pixels = ctx.getImageData(0, 0, frame.width, frame.height).data;
      } finally {
        canvas.width = 0;
      }
      const size = await session.add(pixels, delayCs);
      if (input.maxBytes !== undefined && size > input.maxBytes) return { blob: undefined, tally: assets.tally };
    }
    const bytes = await session.finish();
    finished = true;
    return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/gif' }), tally: assets.tally };
  } finally {
    if (!finished) session.close();
    assets.release();
  }
}
