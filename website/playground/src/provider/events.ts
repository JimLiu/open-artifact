/** A small typed event channel, the in-page stand-in for the type server's event stream. */

export interface Channel<T> {
  emit(value: T): void;
  on(listener: (value: T) => void): () => void;
  /** Listeners now attached. */
  readonly size: number;
}

export function channel<T>(): Channel<T> {
  const listeners = new Set<(value: T) => void>();
  return {
    emit(value) {
      for (const listener of [...listeners]) {
        try {
          listener(value);
        } catch (error) {
          console.error('[playground] listener failed', error);
        }
      }
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get size() {
      return listeners.size;
    },
  };
}

/** Lowercase hex SHA-256 of `bytes` (what the type server calls a file's or document's hash). */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A random id of `bytes` random bytes, as hex. */
export function randomId(bytes = 8): string {
  const out = new Uint8Array(bytes);
  crypto.getRandomValues(out);
  return Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Base64 of `bytes`, in chunks (spreading a large array into one call overflows the stack). */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
