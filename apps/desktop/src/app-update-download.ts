// Fetch with real byte progress, then hand only the verified ZIP to Squirrel over a private loopback endpoint.
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, rmSync } from 'node:fs';
import { mkdir, mkdtemp, open, rename } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import type { updateFeed } from './app-update-feed.ts';

export interface UpdateProgress { received: number; total: number; stage: 'download' | 'verify' }
export type UpdateZip = ReturnType<typeof updateFeed>['releases'][number]['updateTo'];
export interface VerifiedUpdate { directory: string; file: string; size: number; sha256: string }

export async function downloadUpdateZip(info: UpdateZip, options: {
  cache: string;
  signal: AbortSignal;
  fetch(url: string, init: RequestInit): Promise<Response>;
  progress(value: UpdateProgress): void;
}): Promise<VerifiedUpdate> {
  await mkdir(options.cache, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(options.cache, 'download-'));
  const part = join(directory, 'update.part');
  const file = join(directory, 'update.zip');
  const stalled = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => stalled.abort(new Error('Update download stalled')), 60_000); timer.unref(); };
  const signal = AbortSignal.any([options.signal, stalled.signal]);
  let body: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let output: Awaited<ReturnType<typeof open>> | undefined;
  let received = 0;
  let last = 0;
  const hash = createHash('sha256');
  try {
    arm();
    const response = await options.fetch(info.url, { signal, cache: 'no-store' });
    if (!response.ok || !response.body) throw new Error(`Update download HTTP ${response.status}`);
    body = response.body.getReader();
    output = await open(part, 'wx', 0o600);
    options.progress({ received, total: info.size, stage: 'download' });
    for (;;) {
      const { done, value } = await body.read();
      if (done) break;
      signal.throwIfAborted();
      arm();
      if (received + value.length > info.size) throw new Error('Update ZIP exceeds its declared size');
      for (let offset = 0; offset < value.length;) {
        const { bytesWritten } = await output.write(value, offset, value.length - offset, null);
        if (!bytesWritten) throw new Error('Could not write the update ZIP');
        offset += bytesWritten;
      }
      hash.update(value);
      received += value.length;
      if (Date.now() - last >= 100 || received === info.size) {
        options.progress({ received, total: info.size, stage: 'download' });
        last = Date.now();
      }
    }
    clearTimeout(timer);
    signal.throwIfAborted();
    options.progress({ received, total: info.size, stage: 'verify' });
    const digest = hash.digest('hex');
    if (received !== info.size) throw new Error(`Update ZIP size differs: received ${received}, expected ${info.size}`);
    if (digest !== info.sha256) throw new Error(`Update ZIP SHA-256 differs: received ${digest}, expected ${info.sha256}`);
    await output.close(); output = undefined;
    await rename(part, file);
    return { directory, file, size: received, sha256: digest };
  } catch (error) {
    await output?.close().catch(() => {}); output = undefined;
    rmSync(directory, { recursive: true, force: true });
    throw error;
  } finally {
    clearTimeout(timer);
    await body?.cancel().catch(() => {});
    body?.releaseLock();
  }
}

/** Neither the feed nor the ZIP is reachable without the per-download capability path. No filesystem paths are served. */
export async function nativeUpdateServer(archive: VerifiedUpdate, info: UpdateZip, signal: AbortSignal) {
  const token = randomBytes(32).toString('hex');
  let base = '';
  const server = createServer((request, response) => {
    if (request.headers.host !== new URL(base).host || !['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(403); response.end(); return;
    }
    const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
    if (request.url === `/${token}/feed.json`) {
      const body = Buffer.from(JSON.stringify({ currentRelease: info.version, releases: [{ version: info.version,
        updateTo: { ...info, url: `${base}/${token}/update.zip` } }] }));
      response.writeHead(200, { ...headers, 'Content-Type': 'application/json', 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } else if (request.url === `/${token}/update.zip`) {
      response.writeHead(200, { ...headers, 'Content-Type': 'application/zip', 'Content-Length': archive.size });
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(archive.file);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } else { response.writeHead(404); response.end(); }
  });
  const close = () => {
    server.closeAllConnections(); server.close();
    rmSync(archive.directory, { recursive: true, force: true });
    signal.removeEventListener('abort', close);
  };
  try {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not start the native update handoff');
    base = `http://127.0.0.1:${address.port}`;
    server.unref();
    signal.addEventListener('abort', close, { once: true });
    signal.throwIfAborted();
    return { url: `${base}/${token}/feed.json`, close };
  } catch (error) { close(); throw error; }
}
