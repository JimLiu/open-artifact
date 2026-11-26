import type { PlaySeconds } from './units.ts';

/**
 * A video clip's own sound (`kit.video(name, {sound})`): the stage says which clips sound and where, on the play
 * clock; the host decodes their files and plays them with the score lowered underneath.
 */

/** `kit.video`'s `speed`, the clip's seconds per second of the film, is held to this range. */
export const CLIP_SPEED_RANGE: readonly [number, number] = [0.25, 4];
/** A clip's sound is heard only at these speeds; faster or slower it plays silent and the score stays up. */
export const CLIP_HEARD_SPEEDS: readonly [number, number] = [0.5, 2];
/** The most clips with sound one film reports. */
export const MAX_SOUNDING_CLIPS = 48;
/** The most captions one film's clips show. */
export const MAX_CLIP_CAPTIONS = 200;
/** Characters of a clip caption's words. */
export const MAX_CLIP_CAPTION_CHARS = 500;
/** A video upload of a motion film is refused over this: the agent cuts and converts it first. */
export const MAX_VIDEO_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * A stretch of play time in which a clip's file sounds: from play second `at`, for `dur` play seconds, starting at
 * the file's second `second` and moving `rate` file seconds per play second. `level` is 0–1. A looping clip goes back
 * to the file's first second at its end; one that does not loop stops there.
 */
export interface ClipSoundUse {
  name: string;
  level: number;
  loop: boolean;
  at: PlaySeconds;
  dur: number;
  second: number;
  rate: number;
}

/** A speed as kit.video takes it: 1 when not a number above 0, otherwise held to {@link CLIP_SPEED_RANGE}. */
export function clipSpeed(value: unknown): number {
  const speed = Number(value);
  if (value === undefined || value === null || !(speed > 0) || !Number.isFinite(speed)) return 1;
  return Math.min(CLIP_SPEED_RANGE[1], Math.max(CLIP_SPEED_RANGE[0], speed));
}

/** Whether a clip at `speed` is heard. */
export const heardAtSpeed = (speed: number): boolean => speed >= CLIP_HEARD_SPEEDS[0] && speed <= CLIP_HEARD_SPEEDS[1];
