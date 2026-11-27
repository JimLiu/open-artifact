/**
 * The notice an export shows when artboards that fill the window are taller
 * than what they show: their frame is exported whole, so the file ends with
 * blank space.
 */

/** Blank space below the content, px, from which an export mentions it. */
export const BLANK_TAIL_NOTICE = 400;

/** An artboard exported with blank space below its content. */
export interface BlankTail {
  name: string;
  /** px of frame below the content. */
  tail: number;
}

/** Whether an artboard's export would end with blank space worth a notice. */
export function blankTail(frameHeight: number, contentBottom: number): number | null {
  const tail = frameHeight - contentBottom;
  return contentBottom > 0 && tail >= BLANK_TAIL_NOTICE ? tail : null;
}

/** A length rounded to the nearest 10 px. */
const about = (px: number): number => Math.round(px / 10) * 10;

/** The notice for artboards that end with blank space; `null` when none does. */
export function blankTailNotice(tails: readonly BlankTail[]): string | null {
  if (!tails.length) return null;
  if (tails.length === 1) return `“${tails[0]!.name}”’s frame is about ${about(tails[0]!.tail)} px taller than its content, so the file ends with that much blank space.`;
  const px = about(Math.max(...tails.map((item) => item.tail)));
  const who = tails.length > 3 ? `${tails.length} artboards` : new Intl.ListFormat('en', { style: 'narrow', type: 'conjunction' }).format(tails.map((item) => `“${item.name}”`));
  return `${who} have frames taller than their content (by up to about ${px} px), so each ends with blank space in the file.`;
}
