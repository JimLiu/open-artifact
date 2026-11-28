/** Handles on a picture's left and right sides that drag it wider or narrower. */
import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef } from 'react';
import { resizeImage } from './actions.ts';
import { clampWidth, draggedWidth, widthForEdge } from './geometry.ts';
import type { ImageTarget } from './store.ts';
import type { MediaBox } from './useMediaBox.ts';

type Side = 'e' | 'w';

interface Drag {
  side: Side;
  startX: number;
  startWidth: number;
  width: number;
  /** The line's `text-align` and `direction`, which decide how the picture's edges move as it widens. */
  align: string;
  direction: string;
  /** Where the dragged edge was at the press (screen px). */
  startEdge: number;
  pointer: number;
}

export function ResizeHandles({ target, box, element }: { target: ImageTarget; box: MediaBox; element: HTMLElement }): ReactNode {
  const drag = useRef<Drag | null>(null);
  const height = Math.max(16, Math.min(48, Math.round(box.height * 0.5)));

  const preview = (width: number | null) => {
    element.style.width = width === null ? '' : `${width}px`;
  };

  const edgeOf = (side: Side) => {
    const rect = element.getBoundingClientRect();
    return side === 'e' ? rect.right : rect.left;
  };

  const down = (side: Side) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const line = getComputedStyle(element.parentElement ?? element);
    const startEdge = edgeOf(side);
    drag.current = { side, startX: event.clientX, startWidth: box.width, width: Math.round(box.width), pointer: event.pointerId, align: line.textAlign, direction: line.direction, startEdge };
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const delta = event.clientX - current.startX;
    const clamp = (width: number) => clampWidth(width, box.room);
    const guess = clamp(draggedWidth(current.side, current.startWidth, delta, current.align, current.direction));
    // Keep the dragged edge under the pointer, wherever the line and its cell put the picture as it widens.
    const edgeAt = (width: number) => {
      preview(width);
      return edgeOf(current.side);
    };
    current.width = widthForEdge(current.startEdge + delta, edgeAt, { width: current.startWidth, edge: current.startEdge }, guess, clamp) ?? guess;
    preview(current.width);
  };

  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    // A new width redraws the picture at that width; otherwise the preview is taken off.
    if (current.width !== Math.round(current.startWidth)) resizeImage(target, current.width);
    else preview(null);
  };

  const cancel = () => {
    if (!drag.current) return;
    drag.current = null;
    preview(null);
  };

  const handle = (side: Side) => (
    <div
      key={side}
      className={`doc-image-handle doc-image-handle-${side}`}
      style={{ left: side === 'w' ? box.left : box.left + box.width, top: box.top + box.height / 2, height }}
      aria-hidden="true"
      onPointerDown={down(side)}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onMouseDown={event => event.preventDefault()}
    />
  );

  return (
    <>
      {handle('w')}
      {handle('e')}
    </>
  );
}
