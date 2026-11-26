// `node:crypto` for the browser bundles: what the Docs host and Sheets store call, synchronously. SHA-256/SHA-1 from
// @noble/hashes (WebCrypto's digest is async only), random bytes and UUIDs from `crypto.getRandomValues`.
import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha256';
import { sha1 } from '@noble/hashes/sha1';
import { sha512 } from '@noble/hashes/sha512';

const ALGORITHMS = { sha256, sha1, sha512 };

class Hash {
  constructor(algorithm) {
    const fn = ALGORITHMS[String(algorithm).toLowerCase()];
    if (!fn) throw new Error(`crypto shim: no hash ${algorithm}`);
    this.state = fn.create();
  }
  update(data, encoding) {
    this.state.update(typeof data === 'string' ? Buffer.from(data, encoding ?? 'utf8') : new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength ?? data.length));
    return this;
  }
  digest(encoding) {
    const out = Buffer.from(this.state.digest());
    return encoding ? out.toString(encoding) : out;
  }
}

export const createHash = (algorithm) => new Hash(algorithm);
export function randomBytes(size, callback) {
  const out = Buffer.alloc(size);
  for (let at = 0; at < size; at += 65536) globalThis.crypto.getRandomValues(out.subarray(at, Math.min(size, at + 65536)));
  if (callback) queueMicrotask(() => callback(null, out));
  return out;
}
export function randomUUID() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function randomInt(min, max) {
  if (max === undefined) [min, max] = [0, min];
  return min + Math.floor((globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * (max - min));
}
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
export const webcrypto = globalThis.crypto;
export default { createHash, randomBytes, randomUUID, randomInt, timingSafeEqual, webcrypto };
