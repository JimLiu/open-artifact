/** What reading and converting a picked video can end in, shared by the page and the worker that does the work. */

/** Why a video part could not be had: not a video, one this browser cannot read or write, or too large even when made smaller. */
export type VideoPartProblem = 'not-video' | 'unreadable' | 'no-encoder' | 'too-large' | 'failed';

export const VIDEO_PART_PROBLEMS: readonly VideoPartProblem[] = ['not-video', 'unreadable', 'no-encoder', 'too-large', 'failed'];

export class VideoPartError extends Error {
  readonly problem: VideoPartProblem;
  constructor(problem: VideoPartProblem, cause?: unknown) {
    super(`video part: ${problem}`, cause === undefined ? undefined : { cause });
    this.name = 'VideoPartError';
    this.problem = problem;
  }
}

/** What reading a video file found. */
export interface VideoFileFacts {
  duration: number;
  width: number;
  height: number;
  /** Frames a second, when the file says. */
  fps: number | null;
  hasSound: boolean;
}

/** The converted part. */
export interface VideoPart {
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
}
