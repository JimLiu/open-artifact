/**
 * Video notes playing on the canvas: who holds a play slot, what the viewer
 * chose for each (play or pause), which are on screen and which failed to
 * load. The `<video>` elements register here so the Inspector can scrub them.
 */

import { create } from 'zustand';
import { claimSlot, NO_SLOTS, releaseSlot, type PlaySlots } from '../lib/play-slots.ts';

export interface VideoState {
  slots: PlaySlots;
  /** The viewer's choice per note: true plays, false pauses; unset follows the note's autoplay (when not editing). */
  chosen: Record<string, boolean>;
  /** Notes in view. */
  visible: Record<string, boolean>;
  /** Notes whose video could not be loaded. */
  failed: Record<string, boolean>;
  claim(id: string): void;
  release(id: string): void;
  choose(id: string, play: boolean | null): void;
  setVisible(id: string, visible: boolean): void;
  setFailed(id: string, failed: boolean): void;
}

function without<T>(record: Record<string, T>, id: string): Record<string, T> {
  const { [id]: _, ...rest } = record;
  return rest;
}

export const useVideo = create<VideoState>((set, get) => ({
  slots: NO_SLOTS,
  chosen: {},
  visible: {},
  failed: {},
  claim(id) {
    const slots = claimSlot(get().slots, id);
    if (slots !== get().slots) set({ slots });
  },
  release(id) {
    const slots = releaseSlot(get().slots, id);
    if (slots !== get().slots) set({ slots });
  },
  choose(id, play) {
    if (get().chosen[id] === (play ?? undefined)) return;
    set({ chosen: play === null ? without(get().chosen, id) : { ...get().chosen, [id]: play } });
  },
  setVisible(id, visible) {
    if (Boolean(get().visible[id]) === visible) return;
    set({ visible: visible ? { ...get().visible, [id]: true } : without(get().visible, id) });
  },
  setFailed(id, failed) {
    if (Boolean(get().failed[id]) === failed) return;
    set({ failed: failed ? { ...get().failed, [id]: true } : without(get().failed, id) });
  },
}));

/** The `<video>` element of each note that has one mounted. */
export const videoElements = new Map<string, HTMLVideoElement>();
