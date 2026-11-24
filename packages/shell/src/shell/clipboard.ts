/**
 * Writes the clipboard for the framed page (`clipboard_write` /
 * `clipboard_data`, answered with `clipboard_done`).
 *
 * Some browsers keep the clipboard from framed pages whatever the frame's
 * `allow` says, yet let the top window write it right after a press in the
 * frame. The page then sends `clipboard_write` at once on the press, and the
 * content (an image may take a while to draw) in `clipboard_data`. The write
 * starts here when `clipboard_write` arrives, with the content still to come,
 * so it runs while the press still counts. Pure (the browser is `env`).
 */

import { CLIPBOARD_ID, CLIPBOARD_TYPES, MAX_CLIPBOARD_BYTES } from '@open-artifact/protocol';
import { t } from '../lib/i18n.ts';

/** The browser's clipboard. */
export interface ClipboardEnv {
  /** Writes one item whose formats may still be coming. */
  write(items: Record<string, Promise<Blob>>): Promise<void>;
  /** The browser can write this format. */
  supports(type: string): boolean;
}

/** A relay made by {@link createClipboardRelay}. */
export interface ClipboardRelay {
  /** `clipboard_write`: starts the write. */
  start(id: unknown, types: unknown): void;
  /** `clipboard_data`: the content of a started write, or why there is none. */
  data(id: unknown, items: unknown, error: unknown): void;
  /** The page went away (the frame loaded again): drops the writes waiting for content. */
  clear(): void;
}

/** Most writes waiting for their content at once. */
const MAX_PENDING = 4;

/** `answer(id, error?)` sends `clipboard_done`. */
export function createClipboardRelay(env: ClipboardEnv, answer: (id: string, error?: string) => void, timeoutMs = 3 * 60_000): ClipboardRelay {
  const pending = new Map<string, { types: string[]; settle: (items: Record<string, Blob> | null, error?: string) => void }>();

  function start(id: unknown, types: unknown): void {
    if (typeof id !== 'string' || !CLIPBOARD_ID.test(id) || pending.has(id)) return;
    const asked = Array.isArray(types) ? types.filter((type): type is string => typeof type === 'string') : [];
    const wanted = [...new Set(asked)].filter((type) => CLIPBOARD_TYPES.includes(type) && env.supports(type));
    if (!wanted.length) return answer(id, t('clipboardUnsupported'));
    if (pending.size >= MAX_PENDING) return answer(id, t('clipboardPending'));

    let settle!: (items: Record<string, Blob> | null, error?: string) => void;
    const content = new Promise<Record<string, Blob>>((resolve, reject) => {
      settle = (items, error) => {
        clearTimeout(timer);
        pending.delete(id);
        if (items) resolve(items);
        else reject(new Error(error || t('clipboardEmpty')));
      };
    });
    const timer = setTimeout(() => settle(null, t('clipboardNoData')), timeoutMs);
    pending.set(id, { types: wanted, settle });

    const items = Object.fromEntries(wanted.map((type) => {
      const blob = content.then((all) => all[type]!);
      // The browser may stop reading before the content comes (a refused write).
      blob.catch(() => undefined);
      return [type, blob];
    }));
    env.write(items).then(
      () => answer(id),
      (error: unknown) => {
        pending.get(id)?.settle(null, t('clipboardFailed'));
        answer(id, error instanceof Error ? error.message : String(error));
      },
    );
  }

  function data(id: unknown, items: unknown, error: unknown): void {
    const write = typeof id === 'string' ? pending.get(id) : undefined;
    if (!write) return;
    if (typeof error === 'string') return write.settle(null, error);
    if (!items || typeof items !== 'object') return write.settle(null, t('clipboardEmpty'));
    const blobs: Record<string, Blob> = {};
    let size = 0;
    for (const type of write.types) {
      const blob = (items as Record<string, unknown>)[type];
      if (!(blob instanceof Blob)) return write.settle(null, t('clipboardNoType', { type }));
      size += blob.size;
      // The type the browser checks is the one the item is filed under.
      blobs[type] = blob.type === type ? blob : new Blob([blob], { type });
    }
    if (size > MAX_CLIPBOARD_BYTES) return write.settle(null, t('clipboardTooLarge'));
    write.settle(blobs);
  }

  function clear(): void {
    for (const write of [...pending.values()]) write.settle(null, t('clipboardPageGone'));
  }

  return { start, data, clear };
}

/** The browser's own clipboard, or `null` where it cannot write formats. */
export function browserClipboard(): ClipboardEnv | null {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return null;
  return {
    write: (items) => navigator.clipboard.write([new ClipboardItem(items)]),
    // Without `supports` (older browsers), SVG is the format left out.
    supports: (type) => (typeof ClipboardItem.supports === 'function' ? ClipboardItem.supports(type) : type !== 'image/svg+xml'),
  };
}
