/**
 * The card of a page link that leads away from the page, while the page is looked at (not edited, not commented on).
 *
 * - Resting the pointer on the link shows it after a moment (longer just after a link opened); it stays while the pointer is on the
 *   link or the card and goes {@link LINK_CARD_HIDE_MS} after it left both.
 * - A link reached from the keyboard shows it at once; Tab goes into the card and on past it to what follows the
 *   link, Shift+Tab from the card goes back to the link, Escape closes it.
 * - A tap shows it; a click follows the link as ever, and the card comes back after {@link LINK_CARD_COOLDOWN_MS}
 *   when the pointer is still on the link (or the click was a tap or a key). Mod-click opens without a card.
 * - It hides when the link moves or changes, on scroll, wheel or resize (a card opened from the keyboard follows a
 *   scroll instead), and when the window loses focus to a card the pointer opened.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { announce, isApplePlatform, writeClipboardText } from '@open-artifact/editor-kit';
import { isComposingKey, LinkDetailsCard, LINK_COPIED_MESSAGE, LINK_COPY_FAILED_MESSAGE, tabbableElements, toast } from '@open-artifact/ui';
import {
  LINK_CARD_COOLDOWN_MS,
  LINK_CARD_HIDE_MS,
  LINK_CARD_WATCH_MS,
  linkBoxMoved,
  linkCardShowDelay,
  linkClickAction,
  pressIsClick,
  type ScreenBox,
} from '@open-artifact/ui/link-card';
import { rectOf } from '../edit/geometry.ts';
import { mergeLineRects } from '../edit/layer.ts';
import { TAB_LIKE_SELECTOR } from '../edit/pieces.ts';
import { leavingLinkHref, linkLineBox, LINK_MOVED_PX } from './links.ts';
import { DASHBOARD_ROOT_ID } from './runtime.ts';

type OpenedBy = 'pointer' | 'touch' | 'key';

interface ShownCard {
  link: HTMLAnchorElement;
  href: string;
  anchor: ScreenBox;
  by: OpenedBy;
}

const CARD_SELECTOR = '[data-page-link-card]';
/** Menus, dialogs and popovers that keep link cards away while they are open. */
const OVERLAY_SELECTOR = '[role="menu"], [role="dialog"], [role="listbox"], [data-popup-open]';

const inCard = (node: EventTarget | null): boolean => node instanceof Element && node.closest(CARD_SELECTOR) !== null;

/** The page link at `node` that leads away from the page, with its address; null for any other. */
function leavingLinkAt(node: EventTarget | null): { link: HTMLAnchorElement; href: string } | null {
  if (!(node instanceof Element)) return null;
  const root = document.getElementById(DASHBOARD_ROOT_ID);
  const link = node.closest<HTMLAnchorElement>('a[href]');
  if (root === null || link === null || !root.contains(link) || link.closest(TAB_LIKE_SELECTOR) !== null) return null;
  const href = leavingLinkHref(link.getAttribute('href'), document.baseURI, location.origin);
  return href === null ? null : { link, href };
}

/** An open menu, dialog or popover of the editor's own; the page's markup never counts. */
function overlayOpen(): boolean {
  const root = document.getElementById(DASHBOARD_ROOT_ID);
  return [...document.querySelectorAll(OVERLAY_SELECTOR)].some((overlay) => !overlay.closest(CARD_SELECTOR) && root?.contains(overlay) !== true);
}

function lineOf(link: Element, pointer: { x: number; y: number } | null): ScreenBox {
  const lines = mergeLineRects([...link.getClientRects()].map((rect) => rectOf(rect)));
  const box = linkLineBox(
    lines.map((line) => ({ x: line.left, y: line.top, w: line.width, h: line.height })),
    pointer,
  );
  if (box !== null) return box;
  const rect = link.getBoundingClientRect();
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

/** What follows `link` in Tab order, outside the card. */
function afterLink(link: HTMLElement): HTMLElement | null {
  const order = tabbableElements(document.body).filter((element) => !inCard(element));
  const at = order.indexOf(link);
  return at < 0 ? null : (order[at + 1] ?? null);
}

export interface PageLinksProps {
  /** Editing or commenting: no cards. */
  off: boolean;
}

export function PageLinks({ off }: PageLinksProps): ReactNode {
  const [card, setCard] = useState<ShownCard | null>(null);
  const cardRef = useRef<ShownCard | null>(null);
  cardRef.current = card;
  /** A link the focus goes back to from its card: that focus doesn't open the card again. */
  const quietRef = useRef<HTMLElement | null>(null);
  const hide = useCallback(() => setCard(null), []);

  useEffect(() => {
    if (off) {
      setCard(null);
      return;
    }
    const controller = new AbortController();
    const listen = { signal: controller.signal };
    const capture = { capture: true, signal: controller.signal };
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let reshowTimer: ReturnType<typeof setTimeout> | undefined;
    let hovered: HTMLAnchorElement | null = null;
    let pointer: { x: number; y: number } | null = null;
    let lastOpened: number | null = null;
    let press: { link: HTMLAnchorElement; type: string; x: number; y: number; at: number } | null = null;

    const show = (link: HTMLAnchorElement, href: string, by: OpenedBy): void => {
      if (!link.isConnected || overlayOpen()) return;
      clearTimeout(hideTimer);
      hideTimer = undefined;
      setCard({ link, href, anchor: lineOf(link, by === 'key' ? null : pointer), by });
    };
    const cancelShow = (): void => {
      clearTimeout(showTimer);
      showTimer = undefined;
    };
    const keep = (): void => {
      clearTimeout(hideTimer);
      hideTimer = undefined;
    };
    const hideSoon = (): void => {
      if (hideTimer !== undefined || cardRef.current === null) return;
      hideTimer = setTimeout(() => {
        hideTimer = undefined;
        if (cardRef.current?.by !== 'key') setCard(null);
      }, LINK_CARD_HIDE_MS);
    };

    const onMove = (event: PointerEvent): void => {
      if (event.pointerType === 'touch' || event.buttons !== 0) return;
      pointer = { x: event.clientX, y: event.clientY };
      if (inCard(event.target)) return keep();
      const found = leavingLinkAt(event.target);
      const link = found?.link ?? null;
      const shown = cardRef.current;
      if (link !== hovered) {
        hovered = link;
        cancelShow();
        if (found !== null && found.link !== shown?.link)
          showTimer = setTimeout(
            () => {
              showTimer = undefined;
              if (hovered === found.link) show(found.link, found.href, 'pointer');
            },
            linkCardShowDelay(performance.now(), lastOpened),
          );
      }
      if (link !== null && link === shown?.link) keep();
      else if (shown !== null && shown.by !== 'key') hideSoon();
    };
    const onLeave = (): void => {
      hovered = null;
      pointer = null;
      cancelShow();
      if (cardRef.current?.by !== 'key') hideSoon();
    };
    const onDown = (event: PointerEvent): void => {
      if (inCard(event.target)) return;
      const found = leavingLinkAt(event.target);
      press = found === null ? null : { link: found.link, type: event.pointerType, x: event.clientX, y: event.clientY, at: event.timeStamp };
      if (found === null || found.link !== cardRef.current?.link) {
        cancelShow();
        // A press anywhere else puts the card away, the one a tap opened too.
        if (cardRef.current !== null) setCard(null);
      }
    };
    const onClick = (event: MouseEvent): void => {
      const found = leavingLinkAt(event.target);
      if (found === null || event.button !== 0) return;
      const pressed = press;
      press = null;
      const touch = pressed !== null && pressed.link === found.link && (pressed.type === 'touch' || pressed.type === 'pen');
      if (touch) {
        const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
        if (pressIsClick({ pointerType: 'touch', ms: event.timeStamp - pressed.at, moved })) {
          // A tap shows where the link goes; the card's address opens it.
          event.preventDefault();
          show(found.link, found.href, 'touch');
        }
        return;
      }
      const action = linkClickAction(event, isApplePlatform());
      if (action === 'none') return;
      cancelShow();
      setCard(null);
      lastOpened = performance.now();
      if (action === 'now') return;
      // From the keyboard (Enter) the click has no pointer: the card comes back for the link that keeps the focus.
      const by: OpenedBy = event.detail === 0 ? 'key' : 'pointer';
      clearTimeout(reshowTimer);
      reshowTimer = setTimeout(() => {
        const visible = document.visibilityState === 'visible' && document.hasFocus();
        if (!visible) return;
        if (by === 'key' ? document.activeElement === found.link : hovered === found.link) show(found.link, found.href, by);
      }, LINK_CARD_COOLDOWN_MS);
    };
    const onFocusIn = (event: FocusEvent): void => {
      if (quietRef.current !== null && event.target === quietRef.current) {
        quietRef.current = null;
        return;
      }
      quietRef.current = null;
      const found = leavingLinkAt(event.target);
      if (found !== null && found.link.matches(':focus-visible')) {
        cancelShow();
        show(found.link, found.href, 'key');
        return;
      }
      const shown = cardRef.current;
      if (shown?.by === 'key' && !inCard(event.target) && event.target !== shown.link) setCard(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isComposingKey(event)) return;
      const shown = cardRef.current;
      if (shown === null || event.target !== shown.link) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setCard(null);
      } else if (event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
        const first = document.querySelector(CARD_SELECTOR)?.querySelector<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]');
        if (first === null || first === undefined) return;
        event.preventDefault();
        first.focus();
      }
    };
    const onScroll = (event: Event): void => {
      if (inCard(event.target)) return;
      const shown = cardRef.current;
      cancelShow();
      if (shown === null) return;
      if (shown.by === 'key' && event.type === 'scroll' && shown.link.isConnected) setCard({ ...shown, anchor: lineOf(shown.link, null) });
      else setCard(null);
    };
    const onBlur = (): void => {
      cancelShow();
      if (cardRef.current?.by === 'pointer') setCard(null);
    };

    document.addEventListener('pointermove', onMove, capture);
    document.documentElement.addEventListener('pointerleave', onLeave, listen);
    document.addEventListener('pointerdown', onDown, capture);
    document.addEventListener('click', onClick, capture);
    document.addEventListener('focusin', onFocusIn, capture);
    document.addEventListener('keydown', onKeyDown, capture);
    window.addEventListener('scroll', onScroll, capture);
    window.addEventListener('wheel', onScroll, { passive: true, capture: true, signal: controller.signal });
    window.addEventListener('resize', onScroll, listen);
    window.addEventListener('blur', onBlur, listen);
    return () => {
      controller.abort();
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      clearTimeout(reshowTimer);
    };
  }, [off]);

  // The link moved, went away or changed: its card goes with it.
  useEffect(() => {
    if (card === null) return;
    const { link, anchor, by } = card;
    const timer = setInterval(() => {
      if (!link.isConnected) return setCard(null);
      if (by !== 'key' && linkBoxMoved(anchor, lineOf(link, { x: anchor.x, y: anchor.y + anchor.h / 2 }), LINK_MOVED_PX)) setCard(null);
    }, LINK_CARD_WATCH_MS);
    const changes = new MutationObserver(() => setCard(null));
    changes.observe(link, { attributes: true, attributeFilter: ['href'], characterData: true, childList: true, subtree: true });
    return () => {
      clearInterval(timer);
      changes.disconnect();
    };
  }, [card]);

  if (card === null) return null;
  const copy = async (href: string): Promise<boolean> => {
    try {
      await writeClipboardText(href);
      announce(LINK_COPIED_MESSAGE);
      return true;
    } catch {
      toast.add({ title: LINK_COPY_FAILED_MESSAGE });
      return false;
    }
  };
  return createPortal(
    <LinkDetailsCard
      key={card.href}
      data-page-link-card=""
      data-mc-chrome=""
      data-uncommentable=""
      href={card.href}
      anchor={card.anchor}
      onCopy={copy}
      onClose={() => {
        const link = card.link;
        hide();
        if (card.link.contains(document.activeElement) || inCard(document.activeElement)) {
          quietRef.current = link;
          link.focus({ preventScroll: true });
        }
      }}
      onTabOut={(backwards) => {
        const target = backwards ? card.link : afterLink(card.link);
        if (target === null) return false;
        target.focus();
        if (!backwards) hide();
        return true;
      }}
    />,
    document.body,
  );
}
