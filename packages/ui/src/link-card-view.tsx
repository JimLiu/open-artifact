/**
 * The link cards.
 *
 * - {@link LinkCard}: the card at a link in rich text being edited. It
 *   shows the address, and Open, Copy link, Edit and Remove. Editing the
 *   address saves on Enter and puts it back on Escape; Escape on the card
 *   gives the focus back to the text. The editor brings what differs: what
 *   a typed address becomes (`normalize`), how it is copied and how the
 *   link changes.
 * - {@link LinkDetailsCard}: the read-only card that shows while the
 *   pointer rests on a link in a page being viewed: the address (itself a
 *   link that opens in a new tab) and Copy link.
 */

import { Check, Copy, ExternalLink, Pencil, Unlink } from 'lucide-react';
import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type MouseEvent } from 'react';
import { IconButton } from './button.tsx';
import { cn } from './cn.ts';
import { INPUT_CLASS } from './fields.tsx';
import { isComposingKey } from './keys.ts';
import {
  canOpenLink,
  LINK_COPIED_MS,
  LINK_CARD_SETTLE_MS,
  linkAddressParts,
  linkCardPlace,
  MAX_SHOWN_ADDRESS_CHARS,
  placeLinkCard,
  screenBox,
  shownLink,
  type LinkCardPlace,
  type ScreenBox,
} from './link-card.ts';
import { Tooltip } from './tooltip.tsx';

/** Said once the address is on the clipboard. */
export const LINK_COPIED_MESSAGE = 'Link copied';
/** Said when copying the address failed. */
export const LINK_COPY_FAILED_MESSAGE = 'The link couldn’t be copied. Try again.';
/** Under an address the card can't open. */
export const LINK_BLOCKED_MESSAGE = 'This link can’t be opened from here.';
/** What the address link does, for screen readers. */
export const LINK_OPENS_NEW_TAB = 'Opens in a new tab';
/** The size a card is taken to have before it is measured. */
export const LINK_CARD_ESTIMATE = { w: 500, h: 44 } as const;
/** The card starts this far left of the link (screen pixels), so its address lines up with the link's text. */
export const LINK_CARD_SHIFT_X_PX = -8;

/** Props of {@link LinkCard}. */
export interface LinkCardProps {
  /** The link in the text; the card sits under it. */
  link: HTMLElement;
  /** The address as the document writes it: shown, copied and edited. */
  target: string;
  /** The address resolved, which Open goes to. */
  href: string;
  /** What a typed address becomes, or null when it cannot be one. */
  normalize(typed: string): string | null;
  /** Shown under an address `normalize` refused. */
  invalidMessage?: string;
  onCopy(target: string): void;
  /** Writes a new address into the link; returns false when it could not. */
  onEdit(target: string): boolean;
  onRemove(): void;
  /** Gives focus back to the text, with the caret in the link. */
  onReturn(): void;
  /**
   * Sit above the link, clear of `avoid`, and below it only when that does
   * not fit (by default the card sits below the link).
   */
  above?: boolean;
  /** With `above`: a bar the card must not cover, as it is now. */
  avoid?: () => ScreenBox | null;
  /** Open on the address input rather than the address (the card asked for to change the link). */
  editOnOpen?: boolean;
  className?: string;
}

const keepTextFocus = (event: MouseEvent): void => event.preventDefault();

export function LinkCard({ link, target, href, normalize, invalidMessage = 'Not a link address', onCopy, onEdit, onRemove, onReturn, above = false, avoid, editOnOpen = false, className }: LinkCardProps) {
  const card = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(editOnOpen);
  const [draft, setDraft] = useState(editOnOpen ? target : '');
  const [invalid, setInvalid] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const shown = shownLink(target);
  const openable = canOpenLink(href);

  useLayoutEffect(() => {
    const measure = () => {
      if (!card.current || !link.isConnected) return;
      const box = card.current.getBoundingClientRect();
      if (above) {
        const place = linkCardPlace(screenBox(link.getBoundingClientRect()), { w: box.width, h: box.height }, { w: window.innerWidth, h: window.innerHeight }, avoid?.() ?? null);
        setPlace({ top: place.y, left: place.x });
        return;
      }
      setPlace(placeLinkCard(link.getBoundingClientRect(), box, { width: window.innerWidth, height: window.innerHeight }));
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, editing, above]);

  const startEdit = () => {
    setDraft(target);
    setInvalid(false);
    setEditing(true);
  };
  const save = () => {
    const next = normalize(draft);
    if (next === null) {
      setInvalid(true);
      return;
    }
    if (next !== target && !onEdit(next)) return;
    setEditing(false);
    if (next === target) onReturn();
  };

  return (
    <div
      ref={card}
      role="dialog"
      aria-label="Link"
      data-link-card=""
      className={cn('fixed z-50 flex max-w-[min(420px,calc(100vw-12px))] items-center gap-1 rounded-control border border-line bg-surface p-1 text-[12px] shadow-lg', className)}
      style={place ? { top: place.top, left: place.left } : { top: -9999, left: -9999 }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !isComposingKey(event.nativeEvent)) {
          event.preventDefault();
          event.stopPropagation();
          if (editing) setEditing(false);
          onReturn();
        }
      }}
    >
      {editing ? (
        <>
          <input
            autoFocus
            aria-label="Link address"
            aria-invalid={invalid || undefined}
            value={draft}
            spellCheck={false}
            className={cn(INPUT_CLASS, 'h-7 w-72 font-mono text-[12px]', invalid && 'border-danger')}
            onChange={(event) => {
              setDraft(event.target.value);
              setInvalid(false);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || isComposingKey(event.nativeEvent)) return;
              event.preventDefault();
              save();
            }}
          />
          {invalid ? <span role="alert" className="px-1 text-danger">{invalidMessage}</span> : null}
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate px-1.5" title={target}>
            <span className="text-fg">{shown.site}</span>
            <span className="text-fg-subtle">{shown.rest}</span>
          </span>
          {openable ? (
            <IconButton size="sm" label="Open link" icon={<ExternalLink className="size-3.5" />} onMouseDown={keepTextFocus} onClick={() => window.open(href, '_blank', 'noopener,noreferrer')} />
          ) : null}
          <IconButton size="sm" label="Copy link" icon={<Copy className="size-3.5" />} onMouseDown={keepTextFocus} onClick={() => onCopy(target)} />
          <IconButton size="sm" label="Edit link" icon={<Pencil className="size-3.5" />} onClick={startEdit} />
          <IconButton size="sm" label="Remove link" icon={<Unlink className="size-3.5" />} onMouseDown={keepTextFocus} onClick={onRemove} />
        </>
      )}
    </div>
  );
}

/** Props of {@link LinkDetailsCard}. */
export interface LinkDetailsCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onCopy' | 'children'> {
  /** The resolved address: shown, opened and copied. */
  href: string;
  /** The link's box on screen; for a link over several lines, the line the card belongs to. */
  anchor: ScreenBox;
  /** A box the card keeps clear of (a toolbar over the link). */
  avoid?: ScreenBox | null;
  /** Whether the address may be opened from here (default: a web or mail address). */
  openable?: boolean;
  /** Opens the address instead of the browser: the address becomes a button that calls it. */
  onOpen?: (href: string) => void;
  /**
   * Copies the address; resolves to whether it did. The button shows a check
   * mark for {@link LINK_COPIED_MS} after a copy; saying {@link LINK_COPIED_MESSAGE} or
   * {@link LINK_COPY_FAILED_MESSAGE} is the caller's.
   */
  onCopy: (href: string) => boolean | Promise<boolean>;
  /** Escape on the card (not while an input method composes). */
  onClose?: () => void;
  /**
   * Tab past the card's last control, or Shift+Tab before its first. The
   * card is usually rendered away from its link, so the caller puts focus
   * back next to the link; return false to let the browser move it.
   */
  onTabOut?: (backwards: boolean) => boolean;
}

/** The card's controls, in Tab order. */
function cardStops(card: HTMLElement): HTMLElement[] {
  return [...card.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]')];
}

/**
 * The read-only link card: a group named "Link details" with the address on
 * one line (the site in full, the path after it lighter and cut from its
 * end; a site too long for the card is cut from its start), and Copy link.
 * The address is a link that opens in a new tab; one that can't be opened
 * from here is greyed out and says so under it. It sits above the link,
 * 6px away, or below it when above does not fit, and
 * takes no clicks for {@link LINK_CARD_SETTLE_MS} after it lands somewhere.
 */
export const LinkDetailsCard = forwardRef<HTMLDivElement, LinkDetailsCardProps>(function LinkDetailsCard(
  { href, anchor, avoid = null, openable = canOpenLink(href), onOpen, onCopy, onClose, onTabOut, className, style, onKeyDown, ...rest },
  ref,
) {
  const root = useRef<HTMLDivElement | null>(null);
  const address = useRef<HTMLElement | null>(null);
  const [place, setPlace] = useState<LinkCardPlace>(() =>
    linkCardPlace(anchor, LINK_CARD_ESTIMATE, { w: window.innerWidth, h: window.innerHeight }, avoid, LINK_CARD_SHIFT_X_PX),
  );
  const [settling, setSettling] = useState(true);
  const [copied, setCopied] = useState(false);
  const [cut, setCut] = useState(false);
  const parts = linkAddressParts(href, { trimWww: true, dropControls: true });
  const fullText = href.replace(/[\p{Cc}\p{Cf}]/gu, '');

  useLayoutEffect(() => {
    const card = root.current;
    if (!card) return;
    setPlace(linkCardPlace(anchor, { w: card.offsetWidth, h: card.offsetHeight }, { w: window.innerWidth, h: window.innerHeight }, avoid, LINK_CARD_SHIFT_X_PX));
    const shown = address.current;
    setCut([...fullText].length > MAX_SHOWN_ADDRESS_CHARS || (shown !== null && [...shown.querySelectorAll<HTMLElement>('[data-link-part]')].some((part) => part.scrollWidth > part.clientWidth)));
  }, [anchor.x, anchor.y, anchor.w, anchor.h, avoid?.x, avoid?.y, avoid?.w, avoid?.h, href]);

  // A card that just landed somewhere takes no clicks for a moment.
  useEffect(() => {
    setSettling(true);
    const timer = setTimeout(() => setSettling(false), LINK_CARD_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [place.x, place.y]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), LINK_COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || isComposingKey(event.nativeEvent)) return;
    if (event.key === 'Escape' && onClose) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab' && onTabOut && root.current) {
      const stops = cardStops(root.current);
      const at = stops.findIndex((stop) => stop === event.target || stop.contains(event.target as Node));
      const leaving = event.shiftKey ? at <= 0 : at === stops.length - 1;
      if (leaving && onTabOut(event.shiftKey)) event.preventDefault();
    }
  };

  const copy = async () => {
    if (await onCopy(href)) setCopied(true);
  };

  const site = (
    <span data-link-part="" dir="rtl" className="min-w-0 shrink truncate text-left font-medium text-fg">
      <bdi dir="ltr">{parts.host}</bdi>
    </span>
  );
  const path = parts.path !== '' ? (
    <span data-link-part="" className="min-w-[1.3em] truncate text-fg-subtle" style={{ flex: '0 1000 auto' }}>
      {parts.path}
    </span>
  ) : null;
  const addressClass = 'flex min-w-0 flex-1 items-baseline rounded-control px-1.5 py-0.5 text-[13px] leading-5 outline-none focus-visible:outline-2 focus-visible:outline-accent';
  const row = !openable ? (
    <span ref={address} role="link" aria-disabled="true" tabIndex={0} aria-label={fullText} className={cn(addressClass, 'opacity-50')}>
      {site}
      {path}
    </span>
  ) : onOpen ? (
    <button ref={(node) => { address.current = node; }} type="button" aria-label={fullText} aria-description={LINK_OPENS_NEW_TAB} className={cn(addressClass, 'text-left hover:bg-hover')} onClick={() => onOpen(href)}>
      {site}
      {path}
    </button>
  ) : (
    <a ref={(node) => { address.current = node; }} href={href} target="_blank" rel="noopener noreferrer" aria-label={fullText} aria-description={LINK_OPENS_NEW_TAB} className={cn(addressClass, 'hover:bg-hover')}>
      {site}
      {path}
    </a>
  );

  const cardStyle: CSSProperties = { ...style, top: place.y, left: place.x, pointerEvents: settling ? 'none' : style?.pointerEvents };
  return (
    <div
      ref={(node) => {
        root.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      role="group"
      aria-label="Link details"
      data-link-details=""
      data-side={place.side}
      className={cn('fixed z-50 flex max-w-[min(500px,calc(100vw-16px))] flex-col rounded-control border border-line bg-surface p-1 shadow-lg', className)}
      style={cardStyle}
      onKeyDown={keyDown}
      {...rest}
    >
      <div className="flex min-w-0 items-center gap-1">
        {cut ? <Tooltip label={fullText}>{row}</Tooltip> : row}
        <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-line" />
        <IconButton size="sm" label="Copy link" icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} onClick={() => void copy()} />
      </div>
      {!openable ? <p className="px-1.5 pb-0.5 text-[12px] text-fg-subtle">{LINK_BLOCKED_MESSAGE}</p> : null}
    </div>
  );
});
