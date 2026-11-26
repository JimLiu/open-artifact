/**
 * Whether the main pointer is a finger. Touch-first devices get a few extra
 * buttons (undo and redo, Delete on the selection bar) for what a keyboard
 * would otherwise do.
 */

import { useSyncExternalStore } from 'react';

const QUERY = '(pointer: coarse)';

/** True when the main pointer is coarse (a finger) right now. */
export function isCoarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia(QUERY).matches;
}

function subscribe(listener: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const list = matchMedia(QUERY);
  list.addEventListener('change', listener);
  return () => list.removeEventListener('change', listener);
}

/** {@link isCoarsePointer}, re-rendering when it changes. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, isCoarsePointer, () => false);
}
