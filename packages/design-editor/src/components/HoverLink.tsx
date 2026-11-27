/**
 * A small card under a hovered element that sits in a link: its address
 * and, for web and mail links, a button that opens it in a new tab. It
 * shows without selecting anything, and stays while the pointer moves
 * onto it. While the keyboard focus is in it, it stays put: the pointer
 * leaving does not hide it and another hovered link does not replace it.
 */

import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Rect } from '@open-artifact/design-core';
import { openableLink, shownLink } from '../lib/hover-link.ts';
import { projectBox } from '../lib/overlay.ts';
import { useLiveCamera } from '../services/camera-frame.ts';

/** How long the card stays after the pointer leaves the element. */
const LINGER_MS = 400;

export interface HoverLinkProps {
  /** The hovered link and the element's world box, or `null`. */
  link: { href: string; rect: Rect } | null;
}

export function HoverLink({ link }: HoverLinkProps) {
  const [shown, setShown] = useState(link);
  const camera = useLiveCamera(shown !== null);
  const over = useRef(false);
  const focused = useRef(false);
  const latest = useRef(link);
  latest.current = link;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (focused.current) return;
    clearTimeout(timer.current);
    if (link) setShown(link);
    else if (!over.current) timer.current = setTimeout(() => !over.current && !focused.current && setShown(null), LINGER_MS);
  }, [link]);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!shown) return null;
  const opens = openableLink(shown.href);
  const box = projectBox(camera, shown.rect);
  return (
    <div
      data-hover-link=""
      className="pointer-events-auto absolute left-0 top-0 z-10 flex max-w-[280px] items-center gap-1 rounded-[10px] bg-chrome py-1 pl-2.5 pr-1 text-[12px] font-control text-chrome-fg shadow-chrome-popup"
      style={{ transform: `translate3d(${Math.max(8, box.left)}px, ${box.top + box.height + 6}px, 0)` }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerEnter={() => {
        over.current = true;
        clearTimeout(timer.current);
      }}
      onPointerLeave={() => {
        over.current = false;
        // Back on the element: the card stays for it.
        if (!focused.current) timer.current = setTimeout(() => !latest.current && !focused.current && setShown(null), LINGER_MS);
      }}
      onFocus={() => {
        focused.current = true;
        clearTimeout(timer.current);
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        focused.current = false;
        // Back to following the pointer.
        if (latest.current) setShown(latest.current);
        else if (!over.current) setShown(null);
      }}
    >
      <span className="min-w-0 flex-1 truncate" title={shown.href}>
        {shownLink(shown.href)}
      </span>
      {opens ? (
        <button
          type="button"
          aria-label={`Open ${shown.href}`}
          title="Open in a new tab"
          className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-chrome-muted outline-none hover:bg-chrome-hover hover:text-chrome-fg focus-visible:bg-chrome-hover"
          onClick={() => window.open(opens, '_blank', 'noopener,noreferrer')}
        >
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}
