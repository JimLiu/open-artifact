import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { before, describe, it } from 'node:test';
import { readUploadFiles } from '../src/lib/upload-reader.ts';

// The export's toasts come from the ui package, whose components the test runner can't load: a stub keeps them.
const stub = new URL('./toast-stub.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@open-artifact/ui') return { url: stub, shortCircuit: true };
    return next(specifier, context);
  },
});

let budgetedRequest: typeof import('../src/services/export.ts').budgetedRequest;

before(async () => {
  ({ budgetedRequest } = await import('../src/services/export.ts'));
});

/** A host serving uploads by name, in chunks of 10 bytes; it notes how many bytes each one sent. */
function host(uploads: Record<string, { size: number; length?: boolean }>) {
  const sent = new Map<string, number>();
  const request = (async (input: string | URL | Request) => {
    const name = String(input);
    const { size, length = true } = uploads[name]!;
    let at = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= size) return controller.close();
        const chunk = new Uint8Array(Math.min(10, size - at));
        at += chunk.length;
        sent.set(name, at);
        controller.enqueue(chunk);
      },
    }, { highWaterMark: 0 });
    const headers: Record<string, string> = { 'content-type': 'image/png' };
    if (length) headers['content-length'] = String(size);
    return new Response(body, { headers });
  }) as typeof fetch;
  return { request, sent };
}

describe('reading uploads for the entire-project zip', () => {
  it('leaves out an upload larger than what is left before downloading it', async () => {
    const { request, sent } = host({ a: { size: 30 }, big: { size: 500 }, b: { size: 40 } });
    const overLimit = new Map<string, string | null>();
    const read = await readUploadFiles(['a', 'big', 'b'], { request: budgetedRequest(100, overLimit, request), concurrency: 1 });
    assert.deepEqual([...read.found.keys()], ['a', 'b']);
    assert.deepEqual([...overLimit], [['big', 'image/png']]);
    assert.equal(sent.get('big') ?? 0, 0, 'its body was never read');
  });

  it('cuts off an upload of unknown size once it passes what is left, and counts only uploads read whole', async () => {
    const { request, sent } = host({ a: { size: 60, length: false }, big: { size: 500, length: false }, b: { size: 40, length: false }, c: { size: 10, length: false } });
    const overLimit = new Map<string, string | null>();
    const read = await readUploadFiles(['a', 'big', 'b', 'c'], { request: budgetedRequest(100, overLimit, request), concurrency: 1 });
    assert.deepEqual([...read.found.keys()], ['a', 'b']);
    assert.deepEqual([...overLimit.keys()], ['big', 'c']);
    assert.ok((sent.get('big') ?? 0) <= 50, 'it stopped right after passing the 40 bytes left');
    assert.equal(read.found.get('a')!.data.length, 60);
  });
});
