/**
 * Video notes share a few play slots per page. A note that wants to play
 * takes a free slot, or waits in line; when a playing note lets go of its
 * slot (paused, deleted, out of view) the first in line takes it.
 */

/** How many video notes play at once on a page. */
export const PLAY_SLOTS = 4;

export interface PlaySlots {
  /** Notes playing, in the order they started. */
  playing: readonly string[];
  /** Notes waiting for a slot, first come first served. */
  waiting: readonly string[];
}

export const NO_SLOTS: PlaySlots = { playing: [], waiting: [] };

/** The slots after `id` asks to play: playing if a slot is free, else waiting. */
export function claimSlot(slots: PlaySlots, id: string, limit = PLAY_SLOTS): PlaySlots {
  if (slots.playing.includes(id) || slots.waiting.includes(id)) return slots;
  if (slots.playing.length < limit) return { ...slots, playing: [...slots.playing, id] };
  return { ...slots, waiting: [...slots.waiting, id] };
}

/** The slots after `id` stops wanting to play: its slot, if it had one, goes to the first in line. */
export function releaseSlot(slots: PlaySlots, id: string, limit = PLAY_SLOTS): PlaySlots {
  if (!slots.playing.includes(id) && !slots.waiting.includes(id)) return slots;
  const playing = slots.playing.filter((other) => other !== id);
  const waiting = slots.waiting.filter((other) => other !== id);
  const moving = waiting.slice(0, Math.max(0, limit - playing.length));
  return { playing: [...playing, ...moving], waiting: waiting.slice(moving.length) };
}

/** Why a video waits for a slot. */
export function slotLimitMessage(limit = PLAY_SLOTS): string {
  return limit === 1
    ? 'Only 1 video plays at once on a page. This one starts when another is deleted or leaves view.'
    : `Only ${limit} videos play at once on a page. This one starts when another is deleted or leaves view.`;
}

/** What a screen reader hears when a video starts, pauses or stops. */
export function playAnnouncement(change: 'Playing' | 'Paused' | 'Stopped', name: string | undefined): string {
  return name?.trim() ? `${change} ${name.trim()}.` : `${change} video.`;
}
