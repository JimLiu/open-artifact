import { useSyncExternalStore } from 'react';
import type { Camera } from '../state/view.ts';
import { cameraFrame, onCameraFrame } from './engine.ts';

const inactive = () => () => {};

/** Screen-space overlays project their world geometry with the camera drawn this frame. */
export function useLiveCamera(enabled = true): Camera {
  return useSyncExternalStore(enabled ? onCameraFrame : inactive, cameraFrame);
}
