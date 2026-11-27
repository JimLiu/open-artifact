/**
 * The board as a short silent MP4 of its flowing arrows: the loop's frames
 * of `flow-frames.ts`, each painted once like the PNG (framing, color
 * scheme, painted looks), played `FLOW_VIDEO_LOOPS` times. The
 * video encoder loads only when a video is made or the browser is asked
 * whether it can make one.
 */

import { drawnImagePen } from './drawn-svg.ts';
import { exportFrameFor } from './frame.ts';
import { evenVideoFrame, FLOW_VIDEO_FPS, FLOW_VIDEO_FRAMES, FLOW_VIDEO_MAX_PX, flowLoopPhases, flowVideoFrameIndex } from './flow-frames.ts';
import { loadPictureAssets, RASTER_IMAGE_LOAD_TIMEOUT_MS, type ImageLoadTally } from './images.ts';
import { drawBoardCanvas } from './paint.ts';
import type { BoardPngInput } from './png.ts';

type FramesVideoModule = typeof import('@open-artifact/motion-export/frames');
type EncoderMemory = ReturnType<FramesVideoModule['newEncoderMemory']>;

let framesVideo: Promise<FramesVideoModule> | undefined;
/** The video encoder, loaded once. */
function loadFramesVideo(): Promise<FramesVideoModule> {
  framesVideo ??= import('@open-artifact/motion-export/frames').catch((error: unknown) => {
    framesVideo = undefined;
    throw error;
  });
  return framesVideo;
}

/** The size the browser is asked about: a full HD frame, the largest a board video is. */
const PROBE_SIZE = { width: FLOW_VIDEO_MAX_PX, height: 1080, fps: FLOW_VIDEO_FPS, frames: FLOW_VIDEO_FRAMES };

/** Whether this browser can encode a board video; false without a video encoder (then nothing is loaded). */
export async function canEncodeBoardVideo(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return false;
  try {
    const { canEncodeFramesVideo } = await loadFramesVideo();
    return (await canEncodeFramesVideo(PROBE_SIZE)) !== null;
  } catch {
    return false;
  }
}

/** What the encoder learned in this page's earlier videos. */
let memory: EncoderMemory | undefined;

/** A board video and what became of its pictures. */
export interface BoardMp4 {
  blob: Blob;
  tally: ImageLoadTally;
}

/** Paints and encodes the board video. Rejects for an empty board, or with the encoder's message when encoding fails. */
export async function exportBoardMp4(input: BoardPngInput): Promise<BoardMp4> {
  const found = exportFrameFor(input.elements, input.measures, input.maxPx ?? FLOW_VIDEO_MAX_PX);
  if (!found) throw new Error('The board is empty.');
  const frame = evenVideoFrame(found);
  const [module, assets] = await Promise.all([
    loadFramesVideo(),
    loadPictureAssets(input.elements, drawnImagePen(input.scheme), input.timeoutMs ?? RASTER_IMAGE_LOAD_TIMEOUT_MS, input.looks),
  ]);
  const pictures: ImageBitmap[] = [];
  try {
    for (const phase of flowLoopPhases()) {
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
      try {
        pictures.push(await createImageBitmap(canvas));
      } finally {
        canvas.width = 0;
      }
    }
    memory ??= module.newEncoderMemory();
    const made = await module.encodeFramesVideo({
      width: frame.width,
      height: frame.height,
      fps: FLOW_VIDEO_FPS,
      frames: FLOW_VIDEO_FRAMES,
      memory,
      // The encoder closes each picture it is handed, so every frame is a copy of its loop picture.
      frame: (t) => {
        const picture = pictures[flowVideoFrameIndex(t)];
        return picture ? createImageBitmap(picture) : Promise.reject(new Error('No frame to show.'));
      },
    });
    return { blob: new Blob([made.bytes], { type: 'video/mp4' }), tally: assets.tally };
  } finally {
    for (const picture of pictures) picture.close();
    assets.release();
  }
}
