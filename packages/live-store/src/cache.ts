import type { LiveCache } from './engine.ts';
import type { SyncDocument } from './transport.ts';

/** The largest saved copy kept (UTF-16 characters); a larger one is dropped rather than kept stale. */
export const SAVED_COPY_MAX_CHARS = 4_000_000;

function isSyncDocument(item: unknown): item is SyncDocument {
  if (typeof item !== 'object' || item === null) return false;
  const document = item as Partial<SyncDocument>;
  return typeof document.path === 'string' && typeof document.data === 'object' && document.data !== null;
}

/**
 * A saved copy in local storage under `key`. Storage that is unavailable
 * (private windows, blocked site data) or full just means no copy.
 */
export function localStorageCache(key: string, maxChars = SAVED_COPY_MAX_CHARS, legacyKey?: string): LiveCache & { isCurrent(): boolean } {
  const generationKey = key + ':generation';
  let generation: string | null | undefined;
  try {
    generation = globalThis.localStorage.getItem(generationKey);
    if (legacyKey) {
      const previous = globalThis.localStorage.getItem(legacyKey);
      if (previous !== null) {
        if (generation === null && previous.length <= maxChars && globalThis.localStorage.getItem(key) === null)
          globalThis.localStorage.setItem(key, previous);
        globalThis.localStorage.removeItem(legacyKey);
      }
    }
  } catch {
    // The page can still own edits in memory when storage is unavailable.
  }
  const copyKey = generation == null ? key : key + ':' + generation;
  const current = () => globalThis.localStorage.getItem(generationKey) === (generation ?? null);
  return {
    isCurrent() {
      try { return current(); } catch { return generation === undefined; }
    },
    read() {
      try {
        if (!current()) return undefined;
        const value: unknown = JSON.parse(globalThis.localStorage.getItem(copyKey) ?? 'null');
        if (!Array.isArray(value)) return undefined;
        const documents = value.filter(isSyncDocument);
        return documents.length > 0 && current() ? documents : undefined;
      } catch {
        return undefined;
      }
    },
    write(documents) {
      try {
        if (!current()) return;
        const json = JSON.stringify(documents);
        if (json.length > maxChars || !documents.length) globalThis.localStorage.removeItem(copyKey);
        else {
          globalThis.localStorage.setItem(copyKey, json);
          if (!current()) globalThis.localStorage.removeItem(copyKey);
        }
      } catch {
        // No room or no storage: no saved copy.
      }
    },
    clear() {
      try {
        if (!current()) return;
        // New readers use a distinct key even if another tab is midway through an old write.
        globalThis.localStorage.setItem(generationKey, crypto.getRandomValues(new Uint32Array(4)).join('-'));
      } finally {
        globalThis.localStorage.removeItem(copyKey);
      }
    },
  };
}
