/**
 * One look painting job, as the look worker (or the page, without workers)
 * runs it: parse the vetted drawing, flatten it to a paint plan, paint the
 * look on an offscreen canvas and encode it as PNG.
 */

import { drawingPaintPlan, type ColorScheme } from '@open-artifact/whiteboard-core';
import { parseRestylableDrawnSvg } from '../export/drawn-svg.ts';
import type { RasterLook } from '../lib/drawing-looks.ts';
import { canvasReadsBackFaithfully, paintDrawingLook, planPaintsAnything } from '../lib/look-raster.ts';

/** A drawing to paint in a look. */
export interface LookJob {
  id: number;
  /** The vetted SVG source. */
  svg: string;
  look: RasterLook;
  scheme: ColorScheme;
  width: number;
  height: number;
}

/** A painted look (`null` when the drawing could not be painted). */
export interface LookJobResult {
  id: number;
  blob: Blob | null;
}

let faithfulCanvas: boolean | undefined;

/** Whether this thread's canvases give pixels back as written (checked once). */
function canvasIsFaithful(): boolean {
  if (faithfulCanvas === undefined) {
    const ctx = new OffscreenCanvas(8, 8).getContext('2d', { willReadFrequently: true });
    faithfulCanvas = ctx !== null && canvasReadsBackFaithfully(ctx);
  }
  return faithfulCanvas;
}

/**
 * Paints a job; `null` when the drawing cannot be painted, there is no
 * offscreen canvas or the canvas adds noise (the drawing then shows unpainted).
 */
export async function paintLookJob(job: LookJob): Promise<Blob | null> {
  try {
    if (typeof OffscreenCanvas === 'undefined' || !canvasIsFaithful()) return null;
    const drawing = parseRestylableDrawnSvg(job.svg);
    const plan = drawing === undefined ? undefined : drawingPaintPlan(drawing.root, drawing.shut);
    if (plan === undefined || !planPaintsAnything(plan)) return null;
    const canvas = new OffscreenCanvas(job.width, job.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    paintDrawingLook(ctx, plan, job.look, job.scheme, job.width, job.height, `${String(plan.width)}x${String(plan.height)}|${String(plan.parts.length)}`);
    return await canvas.convertToBlob({ type: 'image/png' });
  } catch {
    return null;
  }
}
