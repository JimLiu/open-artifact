import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertVideoPart, readVideoFile, runVideoJob, type VideoWorkerPort } from '../src/clip/in-worker.ts';
import type { VideoJob, VideoJobAnswer } from '../src/clip/jobs.ts';
import { VideoPartError } from '../src/clip/problem.ts';

const FACTS = { duration: 4, width: 640, height: 360, fps: 30, hasSound: true };
const mp4Head = (): Blob => new Blob([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])]);

/** A worker that answers each job with the answers `reply` gives, one turn apart. */
function fakeWorker(reply: (job: VideoJob) => VideoJobAnswer[]): { start: () => VideoWorkerPort; jobs: VideoJob[]; terminated: () => number } {
  const jobs: VideoJob[] = [];
  let terminated = 0;
  const start = (): VideoWorkerPort => {
    let stopped = false;
    const port: VideoWorkerPort = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage(job) {
        jobs.push(job);
        let delay = 0;
        for (const answer of reply(job)) {
          delay += 1;
          setTimeout(() => {
            if (!stopped) port.onmessage?.(new MessageEvent('message', { data: answer }));
          }, delay);
        }
      },
      terminate() {
        stopped = true;
        terminated += 1;
      },
    };
    return port;
  };
  return { start, jobs, terminated: () => terminated };
}

const problemOf = (problem: string) => (error: unknown) => error instanceof VideoPartError && error.problem === problem;

test('a file that does not start like a video is refused before any worker starts', async () => {
  const worker = fakeWorker(() => []);
  await assert.rejects(readVideoFile(new Blob([new Uint8Array(16)]), worker.start), problemOf('not-video'));
  assert.equal(worker.jobs.length, 0);
});

test('reading a video asks a worker of its own and stops it after the answer', async () => {
  const worker = fakeWorker(() => [{ kind: 'read', facts: FACTS }]);
  assert.deepEqual(await readVideoFile(mp4Head(), worker.start), FACTS);
  assert.equal(worker.jobs[0]?.job, 'read');
  assert.equal(worker.terminated(), 1);
});

test('converting passes progress through and hands back the bytes', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const worker = fakeWorker(() => [
    { kind: 'progress', value: 0.25 },
    { kind: 'progress', value: 0.75 },
    { kind: 'converted', bytes, width: 640, height: 360 },
  ]);
  const seen: number[] = [];
  const part = await convertVideoPart(mp4Head(), { start: 1, end: 3, facts: FACTS, onProgress: (value) => seen.push(value), startWorker: worker.start });
  assert.deepEqual(seen, [0.25, 0.75]);
  assert.deepEqual([...part.bytes], [1, 2, 3]);
  assert.deepEqual(worker.jobs[0], { job: 'convert', file: worker.jobs[0]?.file, start: 1, end: 3, facts: FACTS });
  assert.equal(worker.terminated(), 1);
});

test("the worker's problem reaches the page as the same problem", async () => {
  const worker = fakeWorker(() => [{ kind: 'failed', problem: 'too-large' }]);
  await assert.rejects(convertVideoPart(mp4Head(), { start: 0, end: 4, facts: FACTS, startWorker: worker.start }), problemOf('too-large'));
  assert.equal(worker.terminated(), 1);
});

test('cancelling stops the worker and rejects with the reason', async () => {
  const worker = fakeWorker(() => [{ kind: 'progress', value: 0.1 }]);
  const controller = new AbortController();
  const running = convertVideoPart(mp4Head(), { start: 0, end: 4, facts: FACTS, signal: controller.signal, startWorker: worker.start });
  controller.abort(new Error('closed'));
  await assert.rejects(running, /closed/);
  assert.equal(worker.terminated(), 1);
});

test('a worker that goes quiet is stopped', async () => {
  const worker = fakeWorker(() => []);
  await assert.rejects(runVideoJob({ job: 'read', file: mp4Head() }, 'unreadable', { quietMs: 5, start: worker.start }), problemOf('failed'));
  assert.equal(worker.terminated(), 1);
});

test("a worker that cannot start fails with the job's own problem", async () => {
  const start = (): VideoWorkerPort => {
    throw new Error('no workers here');
  };
  await assert.rejects(convertVideoPart(mp4Head(), { start: 0, end: 4, facts: FACTS, startWorker: start }), problemOf('no-encoder'));
});
