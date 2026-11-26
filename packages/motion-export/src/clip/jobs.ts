/** The messages between the page and the video worker: one job per worker, answered by progress and then one outcome. */

import type { VideoFileFacts, VideoPartProblem } from './problem.ts';

export type VideoJob =
  | { job: 'read'; file: Blob }
  | { job: 'convert'; file: Blob; start: number; end: number; facts: VideoFileFacts };

export type VideoJobAnswer =
  | { kind: 'progress'; value: number }
  | { kind: 'read'; facts: VideoFileFacts }
  | { kind: 'converted'; bytes: Uint8Array<ArrayBuffer>; width: number; height: number }
  | { kind: 'failed'; problem: VideoPartProblem };
