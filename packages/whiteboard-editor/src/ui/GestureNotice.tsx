/**
 * A short line at the top of the board saying what a touch gesture just
 * did (“Last change undone”). Screen readers already hear the change from
 * the history's own announcement, so the line is hidden from them, and it
 * never catches a pointer.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { useCamera } from '../state/camera.ts';

/** How long a notice stays, ms. */
export const GESTURE_NOTICE_MS = 2500;

interface GestureNoticeState {
  /** The line shown, or `null`. */
  text: string | null;
  /** Bumped by every notice, so the same line shown again restarts its timer. */
  serial: number;
}

export const useGestureNotice = create<GestureNoticeState>()(() => ({ text: null, serial: 0 }));

/** Shows `text` at the top of the board for {@link GESTURE_NOTICE_MS}. */
export function showGestureNotice(text: string): void {
  useGestureNotice.setState((state) => ({ text, serial: state.serial + 1 }));
}

/** The notice line, when one is showing. */
export function GestureNotice() {
  const text = useGestureNotice((state) => state.text);
  const serial = useGestureNotice((state) => state.serial);
  const top = useCamera((state) => state.insets.top);
  useEffect(() => {
    if (text === null) return;
    const timer = setTimeout(() => useGestureNotice.setState({ text: null }), GESTURE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [text, serial]);
  if (text === null) return null;
  return (
    <div
      aria-hidden="true"
      data-wb-gesture-notice=""
      className="pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 rounded-full border border-chrome-line bg-chrome px-3 py-1.5 text-[13px] text-chrome-fg shadow-md"
      style={{ top }}
    >
      {text}
    </div>
  );
}
