/**
 * The camera store: where this tab looks. Panning and zooming update it many
 * times a second, so the board layer subscribes imperatively and writes its
 * transform straight to the DOM; React components select only what they
 * render (usually the zoom).
 */

import { create } from 'zustand';
import { DEFAULT_CAMERA, MAX_ZOOM, MIN_COMPACT_ZOOM, MIN_ZOOM, centerOn, clampZoom, sameCamera, type Camera, type Point } from '../lib/camera.ts';

/** Viewport width at or under which the compact layout applies. */
export const COMPACT_MAX_WIDTH = 900;

/** Screen space taken by floating chrome, so fitting avoids it. */
export interface ViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CameraState {
  camera: Camera;
  /** Viewport size in CSS pixels. */
  width: number;
  height: number;
  /** Narrow viewport or coarse pointer: compact layout, larger minimum zoom. */
  compact: boolean;
  /** Chrome over the viewport edges. */
  insets: ViewportInsets;
  /** Last pointer position over the board, screen pixels (for paste and cursor chat). */
  pointer: Point | null;
  /** Sets the camera (clamped to the zoom range). */
  setCamera(camera: Camera): void;
  setViewport(width: number, height: number, coarse: boolean): void;
  setInsets(insets: ViewportInsets): void;
  setPointer(pointer: Point | null): void;
}

/** The zoom range of the current layout. */
export function zoomRange(state: Pick<CameraState, 'compact'> = useCamera.getState()): { min: number; max: number } {
  return { min: state.compact ? MIN_COMPACT_ZOOM : MIN_ZOOM, max: MAX_ZOOM };
}

export const useCamera = create<CameraState>()((set, get) => ({
  camera: DEFAULT_CAMERA,
  width: 1,
  height: 1,
  compact: false,
  insets: { top: 56, right: 16, bottom: 88, left: 16 },
  pointer: null,
  setCamera(camera) {
    const { min, max } = zoomRange(get());
    const next = { ...camera, zoom: clampZoom(camera.zoom, min, max) };
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || sameCamera(next, get().camera)) return;
    set({ camera: next });
  },
  setViewport(width, height, coarse) {
    const compact = width <= COMPACT_MAX_WIDTH || coarse;
    if (width === get().width && height === get().height && compact === get().compact) return;
    const camera = get().camera;
    const { min, max } = zoomRange({ compact });
    const zoom = clampZoom(camera.zoom, min, max);
    if (zoom === camera.zoom) {
      set({ width, height, compact });
      return;
    }
    // The layout's zoom range moved past the camera (a camera kept from a wider window): zoom about the middle of
    // the viewport, so what was in view stays in the middle.
    const middle = { x: camera.x + width / 2 / camera.zoom, y: camera.y + height / 2 / camera.zoom };
    set({ width, height, compact, camera: centerOn(middle, zoom, width, height) });
  },
  setInsets(insets) {
    set({ insets });
  },
  setPointer(pointer) {
    set({ pointer });
  },
}));
