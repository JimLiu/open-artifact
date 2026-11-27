import type { Rect } from '@open-artifact/design-core';
import { toScreen, type Camera } from '../state/view.ts';

export function projectBox(camera: Camera, { x, y, w, h }: Rect) {
  const point = toScreen(camera, x, y);
  return { left: point.x, top: point.y, width: w * camera.zoom, height: h * camera.zoom };
}

/** Keep chrome for artboards within 240 screen pixels of the viewport. */
export function boardChromeBox(camera: Camera, rect: Rect, viewport: { width: number; height: number }) {
  const box = projectBox(camera, rect);
  const margin = 240;
  if (box.width < 24 || box.left > viewport.width + margin || box.top > viewport.height + margin || box.left + box.width < -margin || box.top + box.height < -margin) return null;
  return { ...box, compact: box.width < 64 };
}
