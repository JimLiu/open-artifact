/**
 * Raw deflate data inflated with the platform's `DecompressionStream`
 * (pages and Node alike), stopping as soon as the output passes a limit,
 * so a small input that would inflate to something huge costs no more than
 * the limit.
 */

/** What inflating gave: the bytes, or why not. */
export type Inflated = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'too_large' | 'damaged' };

/** Inflates raw deflate `data`, refusing (as `too_large`) once more than `max` bytes come out. */
export async function inflateRawLimited(data: Uint8Array, max: number): Promise<Inflated> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')) as ReadableStream<Uint8Array>;
    reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        void reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
    return { ok: true, bytes: joinBytes(chunks, total) };
  } catch {
    void reader?.cancel().catch(() => undefined);
    return { ok: false, reason: 'damaged' };
  }
}

/** Chunks joined into one array of `total` bytes. */
export function joinBytes(chunks: readonly Uint8Array[], total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}
