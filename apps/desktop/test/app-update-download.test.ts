import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { downloadUpdateZip, nativeUpdateServer, type UpdateProgress } from '../src/app-update-download.ts';
import { updateFeed } from '../src/app-update-feed.ts';

const bytes = Buffer.from('A signed update ZIP fixture, delivered in chunks.');
const info = updateFeed('0.17.0', bytes.length, createHash('sha256').update(bytes).digest('hex')).releases[0].updateTo;
const cache = () => mkdtempSync(join(tmpdir(), 'oa-update-download-'));
const response = () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
  controller.enqueue(bytes.subarray(0, 8)); controller.enqueue(bytes.subarray(8)); controller.close();
} }));

test('download progress counts actual written bytes; only a complete matching ZIP is returned', async () => {
  const dir = cache();
  const progress: UpdateProgress[] = [];
  try {
    const archive = await downloadUpdateZip(info, { cache: dir, signal: new AbortController().signal,
      fetch: async url => { assert.equal(url, info.url); return response(); }, progress: value => progress.push(value) });
    assert.deepEqual(readFileSync(archive.file), bytes);
    assert.equal(archive.sha256, info.sha256);
    assert.deepEqual(progress[0], { received: 0, total: bytes.length, stage: 'download' });
    assert.deepEqual(progress.at(-1), { received: bytes.length, total: bytes.length, stage: 'verify' });
    assert.ok(progress.every(p => p.received <= p.total));
    assert.equal(existsSync(join(archive.directory, 'update.part')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bad SHA-256, truncated and oversized archives are rejected and leave no partial files', async () => {
  for (const changed of [{ ...info, sha256: '0'.repeat(64) }, { ...info, size: info.size + 1 }, { ...info, size: info.size - 1 }]) {
    const dir = cache();
    try {
      await assert.rejects(downloadUpdateZip(changed, { cache: dir, signal: new AbortController().signal,
        fetch: async () => response(), progress: () => {} }), /SHA-256|size/);
      assert.deepEqual(readdirSync(dir), []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('canceling the request aborts a live transfer and removes the partial ZIP', async () => {
  const dir = cache(); const abort = new AbortController();
  try {
    await assert.rejects(downloadUpdateZip(info, { cache: dir, signal: abort.signal,
      fetch: async (_url, init) => new Response(new ReadableStream({ start(controller) {
        init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason)); controller.enqueue(bytes.subarray(0, 8));
      } })), progress: p => { if (p.received > 0) abort.abort(); } }), /abort/i);
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the native handoff serves only the capability feed and verified ZIP, then closes and removes its files', async () => {
  const dir = cache(); const abort = new AbortController();
  try {
    const archive = await downloadUpdateZip(info, { cache: dir, signal: abort.signal, fetch: async () => response(), progress: () => {} });
    const server = await nativeUpdateServer(archive, info, abort.signal);
    const feed = await (await fetch(server.url)).json() as ReturnType<typeof updateFeed>;
    const native = feed.releases[0].updateTo;
    assert.equal(feed.currentRelease, info.version);
    assert.equal(native.sha256, info.sha256);
    assert.equal(native.size, info.size);
    assert.match(native.url, /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/update\.zip$/);
    assert.deepEqual(Buffer.from(await (await fetch(native.url)).arrayBuffer()), bytes);
    assert.equal((await fetch(new URL('/update.zip', server.url))).status, 404);
    assert.equal((await fetch(server.url, { method: 'POST' })).status, 403);
    abort.abort();
    assert.equal(existsSync(archive.directory), false);
    await assert.rejects(fetch(server.url));
  } finally { abort.abort(); rmSync(dir, { recursive: true, force: true }); }
});
