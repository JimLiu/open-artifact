/**
 * Reading and converting a picked video on the page's behalf: each job gets a worker of its own, which is stopped once
 * it answers, when the job is cancelled, or when it goes quiet for too long.
 */

import { looksLikeVideoFile } from '@open-artifact/motion-core';
import type { VideoJob, VideoJobAnswer } from './jobs.ts';
import { VIDEO_PART_PROBLEMS, VideoPartError, type VideoFileFacts, type VideoPart } from './problem.ts';

/** How long a worker may stay silent: reading answers once; converting reports progress as it goes. */
export const READ_QUIET_MS = 8_000;
export const CONVERT_QUIET_MS = 90_000;

const HEAD_BYTES = 16;

/** What a job needs of a worker (tests give their own). */
export interface VideoWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: VideoJob): void;
  terminate(): void;
}

export type StartVideoWorker = () => VideoWorkerPort;

const startBundledWorker: StartVideoWorker = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'open-artifact-video' });

/** Whether this browser can run the video worker at all: workers and a video encoder. */
export function videoWorkerAvailable(): boolean {
  return typeof Worker === 'function' && typeof VideoEncoder !== 'undefined';
}

interface JobOptions {
  quietMs: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  start?: StartVideoWorker;
}

const isAnswer = (data: unknown): data is VideoJobAnswer => typeof data === 'object' && data !== null && 'kind' in data && typeof data.kind === 'string';

/** Sends one job to a new worker and settles with its outcome; `unable` is the problem when no worker can do it. */
export function runVideoJob(job: VideoJob, unable: VideoPartError['problem'], options: JobOptions): Promise<Exclude<VideoJobAnswer, { kind: 'progress' | 'failed' }>> {
  return new Promise((resolve, reject) => {
    options.signal?.throwIfAborted();
    let worker: VideoWorkerPort;
    try {
      worker = (options.start ?? startBundledWorker)();
    } catch (error) {
      reject(new VideoPartError(unable, error));
      return;
    }
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      clearTimeout(quiet);
      options.signal?.removeEventListener('abort', cancel);
      worker.terminate();
    };
    const fail = (error: unknown): void => {
      finish();
      reject(error);
    };
    const cancel = (): void => fail(options.signal?.reason);
    const awake = (): void => {
      clearTimeout(quiet);
      quiet = setTimeout(() => fail(new VideoPartError('failed', new Error('the video worker stopped answering'))), options.quietMs);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new VideoPartError(unable, new Error(event.message)));
    };
    worker.onmessageerror = () => fail(new VideoPartError('failed'));
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const answer = event.data;
      if (!isAnswer(answer)) return fail(new VideoPartError('failed'));
      if (answer.kind === 'progress') {
        awake();
        options.onProgress?.(answer.value);
        return;
      }
      if (answer.kind === 'failed') return fail(new VideoPartError(VIDEO_PART_PROBLEMS.includes(answer.problem) ? answer.problem : 'failed'));
      finish();
      resolve(answer);
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    awake();
    worker.postMessage(job);
  });
}

/** Reads a file's length and frame in a worker; throws a {@link VideoPartError} for one that is not a video this browser reads. */
export async function readVideoFile(file: Blob, start?: StartVideoWorker): Promise<VideoFileFacts> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  if (!looksLikeVideoFile(head)) throw new VideoPartError('not-video');
  if (start === undefined && !videoWorkerAvailable()) throw new VideoPartError('unreadable');
  const answer = await runVideoJob({ job: 'read', file }, 'unreadable', { quietMs: READ_QUIET_MS, ...(start ? { start } : {}) });
  if (answer.kind !== 'read') throw new VideoPartError('failed');
  return answer.facts;
}

export interface VideoPartOptions {
  /** The part, in the file's seconds. */
  start: number;
  end: number;
  facts: VideoFileFacts;
  /** 0–1 through the conversion; a smaller try starts again from 0. */
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
  /** Starts the worker (tests give their own). */
  startWorker?: StartVideoWorker;
}

/**
 * Converts the part `start`–`end` of `file` in a worker, smaller at each try while the result is over the upload
 * limit. Throws a {@link VideoPartError}, or the abort reason once `signal` aborts.
 */
export async function convertVideoPart(file: Blob, options: VideoPartOptions): Promise<VideoPart> {
  if (options.startWorker === undefined && !videoWorkerAvailable()) throw new VideoPartError('no-encoder');
  const answer = await runVideoJob({ job: 'convert', file, start: options.start, end: options.end, facts: options.facts }, 'no-encoder', {
    quietMs: CONVERT_QUIET_MS,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.startWorker ? { start: options.startWorker } : {}),
  });
  if (answer.kind !== 'converted') throw new VideoPartError('failed');
  return { bytes: answer.bytes, width: answer.width, height: answer.height };
}
