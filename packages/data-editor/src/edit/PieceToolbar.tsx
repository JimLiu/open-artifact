/**
 * The floating toolbar beside the picked piece: Bold / Italic / Link for
 * words being typed in (Cmd/Ctrl+K opens the link input), Ask the agent, and
 * for a card the More menu (move earlier / later, delete). It takes a side of
 * the piece's box that fits and covers neither the pointer nor other words.
 */

import { ArrowUpRight, Bold, EllipsisVertical, Italic, Link, MessagesSquare, Trash2, X } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { announce, isApplePlatform, MOD } from '@open-artifact/editor-kit';
import { Card, ChromeButton, ChromeDivider, ChromeMenu, ChromeMenuItem, Tip } from '@open-artifact/editor-kit/react';
import { cn, isComposingKey } from '@open-artifact/ui';
import { shortcutLetter } from '@open-artifact/ui/keys';
import { ASK_AGENT_LABEL } from '../drafts/words.ts';
import { DASHBOARD_ROOT_ID } from '../page/runtime.ts';
import { rectOf, type Box, type Edges } from './geometry.ts';
import {
  BOLD_LABEL,
  CANCEL_LINK_LABEL,
  CANCEL_LINK_TIP,
  ITALIC_LABEL,
  LINK_LABEL,
  LINK_URL_HINT,
  LINK_URL_LABEL,
  MORE_ACTIONS,
  OPEN_LINK_LABEL,
  REMOVE_LINK_LABEL,
  REMOVE_LINK_TIP,
  SELECTION_ACTIONS,
  withShortcut,
} from './labels.ts';
import type { PagePiece } from './pieces.ts';
import { normalizeLinkHref } from './runs.ts';
import type { WordsCell, WordsPoint, WordsVisit } from './words.ts';
import {
  PIECE_TOOLBAR_GAP,
  choosePieceToolbarSide,
  pieceToolbarInset,
  placePieceToolbar,
  type PieceToolbarLayout,
  type PieceToolbarSide,
} from './toolbar-place.ts';

/** One row of the More menu. */
export interface PieceToolbarRow {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onPick(): void;
}

export interface PieceToolbarProps {
  piece: PagePiece;
  box: Box;
  room: Box;
  /** The words session on the piece, or null when it is not being typed in. */
  visit: WordsVisit | null;
  onAsk: (() => void) | null;
  /** Where the click that picked the piece landed. */
  pressed: WordsPoint | null;
  rows: readonly PieceToolbarRow[];
}

interface Placement {
  el: Element;
  side: PieceToolbarSide;
  inset: number;
}

interface LinkDraft {
  of: WordsVisit;
  url: string;
  bad: boolean;
  had: boolean;
  back(): void;
}

const LINK_MODE_ATTRIBUTE = 'data-link-mode';

/** The text and controls near a piece that the toolbar should not cover. */
function collectNearbyWordRects(element: Element, top: number, bottom: number): Edges[] {
  const root = element.closest(`#${DASHBOARD_ROOT_ID}`);
  if (root === null) return [];
  const inBand = (rect: Edges): boolean => rect.right > rect.left && rect.bottom >= top && rect.top <= bottom;
  const rects: Edges[] = [...root.querySelectorAll('input, select, textarea, button')]
    .filter((control) => !control.contains(element) && !element.contains(control))
    .map((control) => control.getBoundingClientRect());
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent === null || (node.nodeValue ?? '').trim() === '' || element.contains(node) || !inBand(parent.getBoundingClientRect()) || parent.closest('style, script') !== null) continue;
    range.selectNodeContents(node);
    rects.push(...range.getClientRects());
  }
  return rects.filter(inBand);
}

/** The link address field of the toolbar, with Open, Remove and Cancel. */
export function LinkInput({
  value,
  invalid,
  onChange,
  onKeyDown,
  onBlur,
  onCancel,
  onRemove,
  onOpen,
}: {
  value: string;
  invalid: boolean;
  onChange(value: string): void;
  onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void;
  onBlur?(event: ReactFocusEvent<HTMLInputElement>): void;
  onCancel(): void;
  onRemove?(): void;
  onOpen?(): void;
}): ReactNode {
  return (
    <span
      className="flex items-center gap-1"
      {...{ [LINK_MODE_ATTRIBUTE]: '' }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || isComposingKey(event.nativeEvent)) return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <span aria-hidden="true" className="inline-flex size-7 items-center justify-center text-chrome-muted">
        <Link className="size-4" />
      </span>
      <input
        autoFocus
        aria-label={LINK_URL_LABEL}
        placeholder="https://…"
        value={value}
        aria-invalid={invalid || undefined}
        title={invalid ? LINK_URL_HINT : undefined}
        onChange={(event) => onChange(event.target.value)}
        onPointerDown={(event) => event.stopPropagation()}
        onBlur={onBlur}
        onKeyDown={(event) => {
          event.stopPropagation();
          onKeyDown(event);
        }}
        className={cn(
          'h-7 w-72 rounded-[8px] bg-chrome-hover px-2 text-[13px] text-chrome-fg outline-none placeholder:text-chrome-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-chrome-focus',
          invalid && 'outline-2 outline-offset-[-2px] outline-danger',
        )}
      />
      {onOpen !== undefined ? (
        <Tip label={OPEN_LINK_LABEL}>
          <ChromeButton square aria-label={OPEN_LINK_LABEL} onClick={onOpen}>
            <ArrowUpRight className="size-4" />
          </ChromeButton>
        </Tip>
      ) : null}
      {onRemove !== undefined ? (
        <Tip label={REMOVE_LINK_TIP}>
          <ChromeButton square aria-label={REMOVE_LINK_LABEL} onClick={onRemove}>
            <Trash2 className="size-4" />
          </ChromeButton>
        </Tip>
      ) : null}
      <Tip label={CANCEL_LINK_TIP}>
        <ChromeButton square aria-label={CANCEL_LINK_LABEL} onClick={onCancel}>
          <X className="size-4" />
        </ChromeButton>
      </Tip>
    </span>
  );
}

/** ⌘K (Ctrl+K elsewhere), the physical K on a non-Latin layout. */
export const isModK = (event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): boolean =>
  (event.metaKey || (event.ctrlKey && !isApplePlatform())) && !event.shiftKey && !event.altKey && shortcutLetter(event) === 'k';

export function PieceToolbar({ piece, box, room, visit, onAsk, pressed, rows }: PieceToolbarProps): ReactNode {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
  const link = linkDraft !== null && linkDraft.of === visit ? linkDraft : null;
  const openLink = (): void => {
    const cell = visit?.cells().link;
    if (visit === null || cell === undefined || cell === null) return;
    if (cell.why !== null) {
      announce(cell.why);
      return;
    }
    setLinkDraft({ of: visit, url: cell.href ?? '', bad: false, had: cell.href !== null, back: visit.park() });
  };
  const closeLink = (): void => {
    link?.back();
    setLinkDraft(null);
  };
  const openLinkRef = useRef(openLink);
  openLinkRef.current = openLink;
  const closeLinkRef = useRef(closeLink);
  closeLinkRef.current = closeLink;
  const linkOpen = link !== null;

  // Going back to the piece's text (a click in it) drops the address being typed.
  useEffect(() => {
    if (!linkOpen || visit === null) return;
    const onFocusIn = (event: FocusEvent): void => {
      if (event.target instanceof Node && visit.el.contains(event.target)) closeLinkRef.current();
    };
    window.addEventListener('focusin', onFocusIn, true);
    return () => window.removeEventListener('focusin', onFocusIn, true);
  }, [linkOpen, visit]);

  useEffect(() => {
    if (visit === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.isTrusted || !isModK(event) || !(event.target instanceof Node) || !visit.el.contains(event.target)) return;
      event.preventDefault();
      openLinkRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [visit]);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (toolbar === null) return;
    const kept = placement !== null && placement.el === piece.el ? placement : null;
    const width = toolbar.offsetWidth;
    const height = toolbar.offsetHeight;
    const pieceBox = rectOf(box);
    const inset = kept?.inset ?? (piece.kind === 'words' ? pieceToolbarInset(pressed?.x ?? null, pieceBox, width) : 0);
    const layout: PieceToolbarLayout = { box: pieceBox, room, width, height, line: parseFloat(getComputedStyle(piece.el).lineHeight) || pieceBox.height, inset };
    const side = choosePieceToolbarSide(layout, kept?.side ?? null, piece.kind === 'words', pressed, () =>
      collectNearbyWordRects(piece.el, pieceBox.top - PIECE_TOOLBAR_GAP - height, pieceBox.bottom + PIECE_TOOLBAR_GAP + height),
    );
    if (side !== kept?.side) setPlacement({ el: piece.el, side, inset });
    const point = placePieceToolbar(side, layout);
    toolbar.style.left = `${Math.round(point.left)}px`;
    toolbar.style.top = `${Math.round(point.top)}px`;
  });

  const formatButton = (label: string, icon: ReactNode, key: string, cell: WordsCell | null | undefined, onClick: () => void): ReactNode[] =>
    cell == null
      ? []
      : [
          <Tip key={label} label={cell.why ?? withShortcut(label, `${MOD}${key}`)}>
            <span className="inline-flex">
              <ChromeButton
                square
                aria-label={label}
                pressed={cell.why === null ? cell.on : undefined}
                disabled={cell.why !== null}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onClick}
              >
                {icon}
              </ChromeButton>
            </span>
          </Tip>,
        ];
  const cells = visit?.cells();
  const strip = [
    ...formatButton(BOLD_LABEL, <Bold className="size-4" />, 'B', cells?.bold, () => visit?.format('bold')),
    ...formatButton(ITALIC_LABEL, <Italic className="size-4" />, 'I', cells?.italic, () => visit?.format('italic')),
    ...formatButton(LINK_LABEL, <Link className="size-4" />, 'K', cells?.link, openLink),
  ];
  const groups: [string, ReactNode][] = [];
  if (strip.length > 0) groups.push(['strip', <span className="flex flex-wrap items-center gap-0.5">{strip}</span>]);
  if (onAsk !== null)
    groups.push([
      'ask',
      <ChromeButton onMouseDown={(event) => event.preventDefault()} onClick={onAsk}>
        <MessagesSquare className="size-4" />
        {ASK_AGENT_LABEL}
      </ChromeButton>,
    ]);
  if (rows.length > 0)
    groups.push([
      'more',
      <ChromeMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        mark="data-mc-chrome"
        tip={{ label: MORE_ACTIONS }}
        trigger={
          <ChromeButton square aria-label={MORE_ACTIONS} data-mc-more="">
            <EllipsisVertical className="size-4" />
          </ChromeButton>
        }
      >
        {rows.map((row) => (
          <ChromeMenuItem key={row.label} disabled={row.disabled} danger={row.danger} onSelect={row.onPick}>
            {row.label}
          </ChromeMenuItem>
        ))}
      </ChromeMenu>,
    ]);
  if (groups.length === 0) return null;
  return (
    <div ref={toolbarRef} className="dash-edit-toolbar fixed z-[900] w-max" data-uncommentable="" data-mc-chrome="">
      <Card role="toolbar" aria-label={SELECTION_ACTIONS} className="p-1" data-placed={placement?.side.startsWith('above') === true ? 'above' : 'below'}>
        {link !== null && visit !== null ? (
          <LinkInput
            value={link.url}
            invalid={link.bad}
            onChange={(url) => setLinkDraft({ ...link, url, bad: false })}
            onBlur={(event) => {
              if (document.activeElement === event.currentTarget) return;
              if ((event.relatedTarget instanceof Element && event.relatedTarget.closest(`[${LINK_MODE_ATTRIBUTE}]`) !== null) || !document.hasFocus()) return;
              closeLink();
            }}
            onCancel={closeLink}
            onRemove={
              link.had
                ? () => {
                    closeLink();
                    visit.link(null);
                  }
                : undefined
            }
            onKeyDown={(event) => {
              if ((event.key !== 'Enter' && event.key !== 'Escape') || isComposingKey(event.nativeEvent)) return;
              event.preventDefault();
              if (event.key === 'Escape') {
                closeLink();
                return;
              }
              if (normalizeLinkHref(link.url) === null) {
                announce(LINK_URL_HINT);
                setLinkDraft({ ...link, bad: true });
                return;
              }
              closeLink();
              visit.link(link.url);
            }}
          />
        ) : (
          groups.map(([name, group], index) => (
            <Fragment key={name}>
              {index > 0 ? <ChromeDivider /> : null}
              {group}
            </Fragment>
          ))
        )}
      </Card>
    </div>
  );
}

