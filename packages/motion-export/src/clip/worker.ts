/** The video worker: reads or converts the file it is sent, then answers once. */

import { convertVideoPart, readVideoFile } from './part.ts';
import type { VideoJob, VideoJobAnswer } from './jobs.ts';
import { VideoPartError } from './problem.ts';

/** The two parts of a dedicated worker's scope this file uses (the page's types see `self` as a window). */
interface VideoWorkerScope {
  onmessage: ((event: MessageEvent<VideoJob>) => void) | null;
  postMessage(message: VideoJobAnswer, options?: { transfer?: Transferable[] }): void;
}

const scope: VideoWorkerScope = self;

const answer = (message: VideoJobAnswer, transfer: Transferable[] = []): void => scope.postMessage(message, { transfer });

async function run(job: VideoJob): Promise<void> {
  try {
    if (job.job === 'read') {
      answer({ kind: 'read', facts: await readVideoFile(job.file) });
      return;
    }
    const part = await convertVideoPart(job.file, {
      start: job.start,
      end: job.end,
      facts: job.facts,
      onProgress: (value) => answer({ kind: 'progress', value }),
    });
    answer({ kind: 'converted', bytes: part.bytes, width: part.width, height: part.height }, [part.bytes.buffer]);
  } catch (error) {
    answer({ kind: 'failed', problem: error instanceof VideoPartError ? error.problem : 'failed' });
  }
}

scope.onmessage = (event) => void run(event.data);
