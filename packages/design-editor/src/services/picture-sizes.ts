/**
 * The natural size of each picture an image or video note has shown, by
 * address: whoever decodes it first records it (the DOM picture, the GPU
 * scene's texture loader, a cover just uploaded). A cropped note draws its
 * crop only once its picture is known (until then it draws uncropped), and
 * cropping needs the size to place the picture, so the Crop button and the
 * cropped frame follow it.
 */

import { create } from 'zustand';
import type { Size } from '../lib/note-crop.ts';

export const usePictureSizes = create<{ sizes: Record<string, Size> }>(() => ({ sizes: {} }));

export function pictureSize(src: string | undefined): Size | undefined {
  return src ? usePictureSizes.getState().sizes[src] : undefined;
}

/** The picture's size, redrawing the caller when it becomes known. */
export function usePictureSize(src: string | undefined): Size | undefined {
  return usePictureSizes((s) => (src ? s.sizes[src] : undefined));
}

export function rememberPictureSize(src: string, w: number, h: number): void {
  if (!(w > 0 && h > 0)) return;
  const known = pictureSize(src);
  if (known && known.w === w && known.h === h) return;
  usePictureSizes.setState((s) => ({ sizes: { ...s.sizes, [src]: { w, h } } }));
}
