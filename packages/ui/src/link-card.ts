/**
 * Rules behind the link cards: how a card shows an address, what it may
 * open, where it sits, and the timing of a card that shows while the
 * pointer rests on a link. Pure. What a typed address becomes is the
 * editor's own rule (see {@link LinkCard}).
 */

/* ------------------------------------------------------------------------ */
/* Timing                                                                   */
/* ------------------------------------------------------------------------ */

/** The card shows this long (ms) after the pointer rests on a link (or the caret in one). */
export const LINK_CARD_SHOW_MS = 300;
/** The card hides this long (ms) after the pointer leaves the link and the card. */
export const LINK_CARD_HIDE_MS = 300;
/** After a link opened, its card shows again only after this long (ms). */
export const LINK_CARD_COOLDOWN_MS = 700;
/** A card that just showed in a new place takes no clicks for this long (ms), so a click meant for what was there misses it. */
export const LINK_CARD_SETTLE_MS = 250;
/** How often (ms) a card that can't watch every frame checks that its link stayed put. */
export const LINK_CARD_WATCH_MS = 150;
/** How long "Link copied" stays (ms). */
export const LINK_COPIED_MS = 1500;
/** A touch counts as a tap when it lasts at most this long (ms)… */
export const TAP_MAX_MS = 400;
/** …and moves at most this far (screen pixels). */
export const TAP_MAX_MOVE_PX = 10;
/** A mouse or pen press becomes a drag past this distance (screen pixels). */
export const CLICK_MAX_MOVE_PX = 4;

/** How long to wait before showing a card, given when a link last opened (ms timestamps). */
export function linkCardShowDelay(now: number, lastOpened: number | null): number {
  if (lastOpened === null) return LINK_CARD_SHOW_MS;
  return Math.max(LINK_CARD_SHOW_MS, lastOpened + LINK_CARD_COOLDOWN_MS - now);
}

/* ------------------------------------------------------------------------ */
/* Clicks                                                                   */
/* ------------------------------------------------------------------------ */

/** What a click on a link does: open it now, the editor's own plain click, or nothing. */
export type LinkClickAction = 'now' | 'later' | 'none';

/** The modifier keys of a click. */
export interface ClickModifiers {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * What a click on a link does: Mod (⌘ on Apple platforms, Ctrl elsewhere)
 * without Shift or Alt opens at once (`now`); a click without any modifier
 * is a plain click (`later`: the editor follows it, or waits out a double
 * click first); anything else (Shift picks, Alt copies, Ctrl on a Mac opens
 * the context menu) leaves it (`none`).
 */
export function linkClickAction(click: ClickModifiers, apple: boolean): LinkClickAction {
  const mod = apple ? click.metaKey : click.ctrlKey;
  const other = apple ? click.ctrlKey : click.metaKey;
  if (click.shiftKey || click.altKey || other) return 'none';
  return mod ? 'now' : 'later';
}

/** One press, from going down to coming up. */
export interface PressSpan {
  pointerType: string;
  /** How long it lasted, ms. */
  ms: number;
  /** How far it got from where it went down, screen pixels. */
  moved: number;
}

/** Whether a press counts as a click: a short, still tap on touch (or with a stylus on a touch screen, `touch-pen`); a press that never became a drag otherwise. */
export function pressIsClick(press: PressSpan): boolean {
  if (press.pointerType === 'touch' || press.pointerType === 'touch-pen') return press.ms <= TAP_MAX_MS && press.moved <= TAP_MAX_MOVE_PX;
  return press.moved <= CLICK_MAX_MOVE_PX;
}

/* ------------------------------------------------------------------------ */
/* The address                                                              */
/* ------------------------------------------------------------------------ */

/** The longest address a card shows; longer ones are cut. */
export const MAX_SHOWN_ADDRESS_CHARS = 300;

/** The address split for display: the site in front, the rest after it. */
export function shownLink(target: string): { site: string; rest: string } {
  const web = /^https?:\/\/([^/?#]+)(.*)$/i.exec(target);
  if (web) return { site: web[1]!.replace(/^www\./i, ''), rest: web[2] === '/' ? '' : web[2]! };
  const mail = /^mailto:(.*)$/i.exec(target);
  if (mail) {
    try {
      return { site: decodeURIComponent(mail[1]!), rest: '' };
    } catch {
      return { site: mail[1]!, rest: '' };
    }
  }
  return { site: target, rest: '' };
}

/** Whether a resolved address may be opened from the card. */
export function canOpenLink(resolved: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(resolved).protocol);
  } catch {
    return false;
  }
}

/** An address as the card shows it. */
export interface LinkAddressParts {
  /** The site: the host of a web address, else the whole address. */
  host: string;
  /** The rest (path, query and fragment), `''` when there is none. */
  path: string;
  /** The whole address, cut at {@link MAX_SHOWN_ADDRESS_CHARS}. */
  full: string;
}

/** How {@link linkAddressParts} writes an address. */
export interface LinkAddressOptions {
  /** Leave `www.` off the site. */
  trimWww?: boolean;
  /** Leave control and format characters out (by default they show as the replacement character). */
  dropControls?: boolean;
}

/** Cuts text at `max` characters (whole code points), ending it with an ellipsis. */
function capChars(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

const CONTROL_CHARS = /[\p{Cc}\p{Cf}]/gu;

/** The site and the path of an address, for the card. Credentials never show. */
export function linkAddressParts(href: string, options: LinkAddressOptions = {}): LinkAddressParts {
  const visible = (text: string) => text.replace(CONTROL_CHARS, options.dropControls ? '' : '�');
  const full = capChars(visible(href), MAX_SHOWN_ADDRESS_CHARS);
  try {
    const url = new URL(href);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const rest = `${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`;
      const host = options.trimWww ? url.host.replace(/^www\./i, '') : url.host;
      return { host, path: capChars(visible(rest), MAX_SHOWN_ADDRESS_CHARS), full: capChars(visible(`${url.protocol}//${url.host}${rest}`), MAX_SHOWN_ADDRESS_CHARS) };
    }
  } catch {
    /* Not a URL: shown whole. */
  }
  return { host: full, path: '', full };
}

/* ------------------------------------------------------------------------ */
/* Where the card sits                                                      */
/* ------------------------------------------------------------------------ */

/** Room between the link and its card (screen pixels). */
export const LINK_CARD_GAP_PX = 6;
/** Closest the card comes to the viewport's edges (screen pixels). */
export const LINK_CARD_MARGIN_PX = 8;

/** A box on screen (viewport pixels). */
export interface ScreenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the card goes. */
export interface LinkCardPlace {
  x: number;
  y: number;
  side: 'above' | 'below';
}

/** A `DOMRect`-like box as a {@link ScreenBox}. */
export function screenBox(rect: { left: number; top: number; width: number; height: number }): ScreenBox {
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

function overlaps(a: ScreenBox, b: ScreenBox): boolean {
  const separated = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
  return !separated;
}

/**
 * Where a card of `card` size sits for a link at `link`: above it when it
 * fits there (inside the viewport and clear of `avoid`, a bar the card must
 * not cover), else below it, {@link LINK_CARD_GAP_PX} away, starting at the
 * link's left edge moved by `shiftX` and kept inside the viewport. Below,
 * it moves past `avoid` when the two would overlap; when that runs off the
 * bottom of the viewport, it sits above `avoid` instead.
 */
export function linkCardPlace(link: ScreenBox, card: { w: number; h: number }, viewport: { w: number; h: number }, avoid: ScreenBox | null = null, shiftX = 0): LinkCardPlace {
  const margin = LINK_CARD_MARGIN_PX;
  const x = Math.max(margin, Math.min(link.x + shiftX, viewport.w - card.w - margin));
  const aboveY = link.y - LINK_CARD_GAP_PX - card.h;
  const above = { x, y: aboveY, w: card.w, h: card.h };
  if (aboveY >= margin && (avoid === null || !overlaps(above, avoid))) return { x, y: aboveY, side: 'above' };
  let y = link.y + link.h + LINK_CARD_GAP_PX;
  if (avoid !== null && overlaps({ x, y, w: card.w, h: card.h }, avoid)) y = avoid.y + avoid.h + LINK_CARD_GAP_PX;
  if (avoid !== null && y + card.h > viewport.h - margin) {
    const overY = Math.min(aboveY, avoid.y - LINK_CARD_GAP_PX - card.h);
    if (overY >= margin) return { x, y: overY, side: 'above' };
  }
  return { x, y: Math.max(margin, y), side: 'below' };
}

/** Where the card goes: below the link, or above it when below would leave the window. */
export function placeLinkCard(link: { top: number; bottom: number; left: number }, card: { width: number; height: number }, window: { width: number; height: number }, gap = 6): { top: number; left: number } {
  const below = link.bottom + gap;
  const above = link.top - gap - card.height;
  const top = below + card.height <= window.height - gap || above < gap ? below : above;
  const left = Math.max(gap, Math.min(link.left, window.width - card.width - gap));
  return { top, left };
}

/** True when a link's box moved or resized by more than `tolerance` pixels (default half a pixel). */
export function linkBoxMoved(before: ScreenBox, after: ScreenBox, tolerance = 0.5): boolean {
  return Math.abs(before.x - after.x) > tolerance || Math.abs(before.y - after.y) > tolerance || Math.abs(before.w - after.w) > tolerance || Math.abs(before.h - after.h) > tolerance;
}
