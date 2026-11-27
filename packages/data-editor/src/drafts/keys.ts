import { useEffect, useRef } from 'react';
import { isComposingKey, shortcutLetter } from '@open-artifact/ui/keys';

export type EditKey = 'save' | 'undo' | 'redo';

/**
 * The edit key a keydown names: Cmd/Ctrl+S, Z or Shift+Z (Ctrl+Y redoes too), or `null`. The letter is read as the
 * layout means it, so a non-Latin layout (Russian, Greek) saves with the physical S key.
 */
export function editKeyOf(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'> & { code?: string },
): EditKey | null {
  if (event.altKey || !(event.metaKey || event.ctrlKey)) return null;
  const key = shortcutLetter(event);
  if (key === 's') return 'save';
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && event.ctrlKey && !event.metaKey) return 'redo';
  return null;
}

/** Form controls keep their own keys; the page being edited (contenteditable) does not. */
function isFormControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.matches('input, textarea, select');
}

function hasOpenOverlay(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null;
}

/**
 * Cmd/Ctrl+S, Z and Shift+Z for the edit bar while `enabled`: trusted keys
 * outside form controls and open overlays go to `handler` (with whether the
 * key repeats); a key the handler takes (returns true) has its default
 * prevented.
 */
export function useEditKeys(enabled: boolean, handler: (key: EditKey, repeat: boolean) => boolean): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent): void => {
      if (!event.isTrusted || event.defaultPrevented || typeof event.key !== 'string' || isComposingKey(event)) return;
      const key = editKeyOf(event);
      if (key === null || isFormControl(event.target) || hasOpenOverlay()) return;
      if (latest.current(key, event.repeat)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled]);
}
