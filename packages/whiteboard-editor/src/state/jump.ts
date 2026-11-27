/**
 * Going to elements of the board, per viewer (never saved, never shared):
 *
 * - `back`: the views the viewer went from, newest last; Back returns to
 *   the newest and drops it;
 * - `flash`: the element the view just went to, which shows a brief ring
 *   so the eye finds it. `serial` changes with every arrival, so going to
 *   the same element again shows the ring again.
 */

import { create } from 'zustand';
import type { ElementId } from '@open-artifact/whiteboard-core';
import type { Camera } from '../lib/camera.ts';

/** Most views Back remembers. */
export const MAX_JUMP_BACK = 20;

/** The going-to state (see the module comment). */
export interface JumpState {
  back: readonly Camera[];
  flash: { id: ElementId; serial: number } | null;
}

/** The going-to state. */
export const useJump = create<JumpState>()(() => ({ back: [], flash: null }));
