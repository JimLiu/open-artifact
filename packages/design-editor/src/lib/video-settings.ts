/**
 * A video note's settings in the Properties panel: the three play toggles
 * (stored only when they differ from the defaults), what the scrubber says
 * when it can't move, the names its rows show, and what is said when a
 * video or cover is replaced.
 */

import { videoOptions, type CanvasNote } from '@open-artifact/design-core';
import { PLAY_SLOTS } from './play-slots.ts';

export type VideoToggle = 'autoplay' | 'loop' | 'sound';

/** The keys a toggle writes; `undefined` removes a key (its default). */
export type VideoSettingsPatch = Partial<Pick<CanvasNote, 'videoStart' | 'videoLoop' | 'videoSound'>>;

/**
 * Turning a toggle on or off. Autoplay on removes `videoStart` (the
 * default) and Sound (a video that starts on its own is muted); Loop on
 * removes `videoLoop`; Sound on writes `videoSound`, and only when the
 * video doesn't autoplay.
 */
export function videoSettingPatch(note: CanvasNote, toggle: VideoToggle, on: boolean): VideoSettingsPatch | null {
  switch (toggle) {
    case 'autoplay':
      return on ? { videoStart: undefined, videoSound: undefined } : { videoStart: 'click' };
    case 'loop':
      return { videoLoop: on ? undefined : 'off' };
    case 'sound':
      if (on && videoOptions(note).autoplay) return null;
      return { videoSound: on ? 'on' : undefined };
  }
}

export const VIDEO_TIPS = {
  autoplay: 'Automatically starts the video, without sound.',
  soundUnderAutoplay: 'Turn off Autoplay to play with sound.',
} as const;

/** The Video row's name for a video with no alt text. */
export const UPLOADED_VIDEO = 'Uploaded video';

/** The name a video note's Video row shows. */
export function videoName(note: CanvasNote): string {
  return note.alt?.trim() || UPLOADED_VIDEO;
}

/** The Cover image row's name. */
export function coverName(note: CanvasNote): string {
  return note.videoCover === 'custom' ? 'Custom cover image' : 'Video frame';
}

/** What the scrubber knows about the note's video. */
export interface ScrubState {
  /** A `<video>` is on the canvas for the note. */
  mounted: boolean;
  /** It waits for a play slot. */
  waiting: boolean;
  /** Its length is known (has metadata). */
  loaded: boolean;
  duration: number;
}

/** Why the scrubber can't move, or null when it can. */
export function scrubRefusal(state: ScrubState): string | null {
  if (state.waiting) return `Only ${PLAY_SLOTS} videos play at once on a page. This one starts when another is deleted or leaves view.`;
  if (!state.mounted) return 'This video isn’t playing here right now. Scroll it into view to play it.';
  if (!state.loaded) return 'The video hasn’t loaded yet.';
  if (!Number.isFinite(state.duration) || state.duration <= 0) {
    return 'This video doesn’t say how long it is (a screen recording often doesn’t), so it can be played and paused but not scrubbed.';
  }
  return null;
}

/** A time as m:ss. */
export function clockTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The height a note of width `w` takes for a video of `natural` size, between 16 and 8000; `fallback` when the size is unknown. */
export function heightForVideo(w: number, natural: { w: number; h: number }, fallback: number): number {
  if (!(natural.w > 0) || !(natural.h > 0)) return fallback;
  return Math.min(8000, Math.max(16, Math.round((w * natural.h) / natural.w)));
}

/** A refusal's text inside a sentence: without its closing period. */
const clause = (text: string) => text.replace(/\.$/, '');

export const MEDIA_MESSAGES = {
  videoReplaced: 'Video replaced',
  notReplaced: (reason: string) => `The video was not replaced: ${clause(reason)}.`,
  replaceFailed: 'Couldn’t replace the video here. Try again.',
  pickVideo: 'Pick a video file here. To set a cover image, use Cover image in Properties.',
  pictureReplaced: 'Picture replaced',
  coverSet: 'Cover image set',
  coverReset: 'Cover image reset',
  coverNotSet: (why: string) => `Couldn’t set the cover image: ${clause(why)}.`,
  coverNotReset: 'Couldn’t reset the cover image. The video couldn’t be read. Try again.',
} as const;

/** Undo labels ("… undone." / "… redone."). */
export const MEDIA_UNDO = {
  settings: 'Video settings',
  cover: 'Cover image change',
  video: 'Video replace',
  picture: 'Picture replace',
} as const;
