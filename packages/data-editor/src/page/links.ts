/** Which page links lead away from the page, and where their card belongs (pure). */

import type { ScreenBox } from '@open-artifact/ui/link-card';

/** How far (px) a link may move before its card hides. */
export const LINK_MOVED_PX = 2;

/**
 * The resolved address of a link that leads away from the page: a web address (http or https) on another origin.
 * Null for a fragment (`#…`), a relative address on this origin, another scheme or an address that doesn't parse.
 */
export function leavingLinkHref(href: string | null, base: string, origin: string): string | null {
  const written = href?.trim() ?? '';
  if (written === '' || written.startsWith('#')) return null;
  let url: URL;
  try {
    url = new URL(written, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.origin === origin ? null : url.href;
}

/**
 * The line of a link the card belongs to: the line under the pointer (the nearest one when the pointer is between
 * lines), the first line without a pointer (opened from the keyboard). Null when the link draws no line.
 */
export function linkLineBox(lines: readonly ScreenBox[], pointer: { x: number; y: number } | null): ScreenBox | null {
  const drawn = lines.filter((line) => line.w > 0 && line.h > 0);
  const first = drawn[0];
  if (first === undefined) return null;
  if (pointer === null) return first;
  let best = first;
  let bestApart = Number.POSITIVE_INFINITY;
  for (const line of drawn) {
    const apart = pointer.y < line.y ? line.y - pointer.y : pointer.y > line.y + line.h ? pointer.y - line.y - line.h : 0;
    if (apart < bestApart) {
      best = line;
      bestApart = apart;
    }
  }
  return best;
}
