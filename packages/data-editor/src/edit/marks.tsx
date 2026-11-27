/**
 * What edit mode and the source marks draw over the page: the mark around a
 * piece (hovered, picked or holding the caret), a card's grip, and the tip
 * over an element; with the DOM reads they share.
 */

import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Tip } from '@open-artifact/editor-kit/react';
import { inflateBox, rectOf, type Box, type Rect } from './geometry.ts';
import { CARD_GRIP_CLASS, EDIT_PORT_SLACK, cardGripAt, editMarkInset, insetLineRects, mergeLineRects, toLayerBox, type EditMarkLook, type TipSide } from './layer.ts';
import { DRAG_TO_MOVE } from './labels.ts';
import { getPieceRect, getScrollContainer, getViewportBounds, isTextPiece, type PagePiece } from './pieces.ts';

/** What `checkVisibility` is asked when a hidden piece must not count (as an export would see it). */
export const EXPORT_VISIBILITY_OPTIONS = { visibilityProperty: true, opacityProperty: true, checkVisibilityCSS: true, checkOpacity: true } as CheckVisibilityOptions;

/** The element shows (where `checkVisibility` is known). */
export const isShown = (element: Element, options?: CheckVisibilityOptions): boolean =>
  typeof element.checkVisibility !== 'function' || element.checkVisibility(options);

/** A trusted window event, heard in the capture phase; returns a stop function. */
export function addTrustedWindowListener<K extends keyof WindowEventMap>(type: K, listener: (event: WindowEventMap[K]) => void): () => void {
  const onEvent = (event: WindowEventMap[K]): void => {
    if (event.isTrusted) listener(event);
  };
  window.addEventListener(type, onEvent, true);
  return () => window.removeEventListener(type, onEvent, true);
}

/** A menu, popover or dialog is open over the page. */
/** A dialog or menu is open (a link's card, which goes with the next press, isn't one). */
export const hasOpenOverlay = (): boolean => document.querySelector('[role="dialog"]:not([data-link-card]), [role="alertdialog"], [role="menu"]') !== null;

export function collectFocusableDescendants(element: Element): HTMLElement[] {
  return [
    ...element.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((stop) => stop.tabIndex >= 0 && stop.closest('[aria-hidden="true"]') === null);
}

export const isInlineDrawing = (piece: PagePiece): boolean => piece.kind === 'drawing' && getComputedStyle(piece.el).display === 'inline';

/** An inline drawing's rect, widened over the punctuation right after it. */
function extendOverPunctuation(piece: PagePiece, rect: DOMRect): Rect {
  const box = rectOf(rect);
  let next = piece.el.nextSibling;
  while (next instanceof Element) next = next.firstChild;
  const match = next instanceof Text ? /^[,.;:!?)\]’”]+/.exec(next.data) : null;
  if (!(next instanceof Text) || match === null) return box;
  const range = document.createRange();
  range.setStart(next, 0);
  range.setEnd(next, match[0].length);
  const marks = range.getBoundingClientRect();
  return marks.width > 0 && marks.bottom <= box.bottom + 2 && marks.right > box.right ? rectOf({ ...box, width: marks.right - box.left }) : box;
}

export function getEditMarkRect(piece: PagePiece, look: EditMarkLook): Rect {
  if (!isInlineDrawing(piece)) return inflateBox(getPieceRect(piece), editMarkInset(piece.kind, isTextPiece(piece), look));
  const rect = extendOverPunctuation(piece, getPieceRect(piece));
  return rectOf({ left: rect.left, top: rect.top - 1, width: rect.width, height: rect.height + 2 });
}

/** The rects a run of words is washed with: one for a block, one per line for words that wrap inline. */
export function listLineRects(piece: PagePiece): Box[] {
  const lines = getComputedStyle(piece.el).display === 'inline' ? mergeLineRects([...piece.el.getClientRects()].map((rect) => rectOf(rect))) : [];
  if (lines.length < 2) return [getEditMarkRect(piece, 'over')];
  return insetLineRects(lines, editMarkInset(piece.kind, isTextPiece(piece), 'over'));
}

export interface EditMarkProps {
  piece: PagePiece;
  look: EditMarkLook;
  on: boolean;
  room: Box;
  /** The source mark's ground (a rule or bulk source id), for its tint. */
  ground?: string;
}

/** The mark around a piece, clipped to the piece's scroller. */
export function EditMark({ piece, look, on, room, ground }: EditMarkProps): ReactNode {
  const port = inflateBox(getViewportBounds(getScrollContainer(piece.el)), EDIT_PORT_SLACK);
  const radius = piece.kind === 'block' ? getComputedStyle(piece.el).borderRadius : undefined;
  return (
    <div className="dash-edit-port" style={toLayerBox(port, room)}>
      <div
        className="dash-edit-mark"
        data-look={look}
        data-slight={isTextPiece(piece) ? '' : undefined}
        data-amid={isInlineDrawing(piece) ? '' : undefined}
        data-ground={ground}
        data-on={on ? '' : undefined}
        style={{ ...toLayerBox(getEditMarkRect(piece, look), port), borderRadius: radius }}
      />
    </div>
  );
}

export interface CardGripProps {
  card: Element;
  /** The grip of the picked card (drawn full). */
  full: boolean;
  room: Box;
  onPress(event: PointerEvent): void;
}

export function CardGrip({ card, full, room, onPress }: CardGripProps): ReactNode {
  return (
    <Tip label={DRAG_TO_MOVE} side="left">
      <div
        className={CARD_GRIP_CLASS}
        data-full={full ? '' : undefined}
        style={cardGripAt(rectOf(card.getBoundingClientRect()), room)}
        onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => onPress(event.nativeEvent)}
      />
    </Tip>
  );
}

/** A tip over `box` (in the layer), on `side`; one that follows the pointer is marked so it never takes the pointer. */
export function EditTipView({ box, room, side, follow = false, children }: { box: Box; room: Box; side: TipSide; follow?: boolean; children: ReactNode }): ReactNode {
  const at = toLayerBox(box, room);
  return (
    <div
      role="tooltip"
      className="dash-edit-tip"
      data-side={side}
      data-follow={follow ? '' : undefined}
      style={{ left: at.left + at.width / 2, top: side === 'top' ? at.top - 8 : at.top + at.height + 8 }}
    >
      {children}
    </div>
  );
}
