/**
 * The rules behind board links and their hover card: when a click opens a
 * link, why a link does not open, and the hint for an item with several
 * links. The card's shared rules (timing, address, placement) come from
 * `@open-artifact/ui`. Pure; `services/link-card.ts` runs them.
 */

export {
  CLICK_MAX_MOVE_PX,
  LINK_CARD_COOLDOWN_MS,
  LINK_CARD_GAP_PX,
  LINK_CARD_HIDE_MS,
  LINK_CARD_MARGIN_PX,
  LINK_CARD_SHOW_MS,
  LINK_COPIED_MS,
  MAX_SHOWN_ADDRESS_CHARS,
  TAP_MAX_MOVE_PX,
  TAP_MAX_MS,
  linkAddressParts,
  linkBoxMoved,
  linkCardPlace,
  linkCardShowDelay,
  linkClickAction,
  pressIsClick,
  type ClickModifiers,
  type LinkAddressParts,
  type LinkCardPlace,
  type LinkClickAction,
  type PressSpan,
  type ScreenBox,
} from '@open-artifact/ui/link-card';

/** A plain click opens its link after this long (ms), unless a double click follows. */
export const LINK_OPEN_DELAY_MS = 250;

/** Why a link on the board does not open. */
export type LinkBlock = 'credentials' | 'unsupported';

/** True when an address carries a user name or password (`user:pass@host`). */
export function hasLinkCredentials(href: string): boolean {
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(href.trim());
  return scheme?.[1]?.includes('@') ?? false;
}

/** Why a link does not open (`undefined` when it does), given what the board would open. */
export function linkBlock(href: string, target: string | undefined): LinkBlock | undefined {
  if (hasLinkCredentials(href)) return 'credentials';
  return target === undefined ? 'unsupported' : undefined;
}

/** Told when the selected item holds several links (the controls offer one). */
export function severalLinksMessage(touch: boolean): string {
  return `Several links: open one with a ${touch ? 'tap' : 'click'}`;
}
