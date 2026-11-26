/**
 * How tall a toast's text may grow so the whole column of toasts stays on
 * screen. Short toasts keep their full height; the room they leave is
 * shared out evenly among the long ones, whose text then scrolls.
 */

/** Room kept free between the top toast and the top of the window, px. */
export const TOAST_TOP_GAP_PX = 8;
/** The smallest height a toast's text is held to, px (3rem). */
export const TOAST_BODY_FLOOR_PX = 48;

/** One toast in the column, px. */
export interface ToastExtent {
  /** The card around the text: padding and border. */
  chrome: number;
  /** The full height of the text, unscrolled. */
  content: number;
}

/**
 * The height every toast's text is held to, px, or null when the column
 * fits within `room` as it is. `between` is the space between two toasts.
 */
export function toastBodyLimit(toasts: readonly ToastExtent[], room: number, between: number, floor = TOAST_BODY_FLOOR_PX): number | null {
  if (toasts.length === 0) return null;
  let left = room - between * (toasts.length - 1);
  for (const toast of toasts) left -= toast.chrome;
  const contents = toasts.map((toast) => toast.content).sort((a, b) => a - b);
  let uncapped = contents.length;
  for (const content of contents) {
    const share = left / uncapped;
    if (content > share) return Math.max(floor, Math.floor(share));
    left -= content;
    uncapped -= 1;
  }
  return null;
}
