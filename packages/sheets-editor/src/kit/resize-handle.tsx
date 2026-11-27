import * as React from 'react';
import { cn } from './cn.ts';

/** The edge of the resized element that the handle sits on. */
export type ResizeHandleSide = 'inline-start' | 'inline-end' | 'top' | 'bottom';

const KEY_STEP = 8;
const KEY_STEP_LARGE = 32;

const SIDE_CLASSES: Readonly<Record<ResizeHandleSide, string>> = {
  'inline-start': 'inset-y-0 start-[calc(-6px_-_(var(--ui-ring-outer,0px)_-_var(--ui-ring-inner,0px))/2)] w-3 cursor-col-resize',
  'inline-end': 'inset-y-0 end-[calc(-6px_-_(var(--ui-ring-outer,0px)_-_var(--ui-ring-inner,0px))/2)] w-3 cursor-col-resize',
  top: 'inset-x-0 top-[calc(-6px_-_(var(--ui-ring-outer,0px)_-_var(--ui-ring-inner,0px))/2)] h-3 cursor-row-resize',
  bottom: 'inset-x-0 bottom-[calc(-6px_-_(var(--ui-ring-outer,0px)_-_var(--ui-ring-inner,0px))/2)] h-3 cursor-row-resize',
};

export interface ResizeHandleProps {
  side: ResizeHandleSide;
  'aria-label': string;
  /** The current size, for assistive tech. */
  'aria-valuenow'?: number;
  'aria-valuemin'?: number;
  'aria-valuemax'?: number;
  'aria-describedby'?: string;
  className?: string;
  /** A drag or a key press is about to resize. */
  onResizeStart?: () => void;
  /**
   * Pixels moved since the resize started, along the screen's x axis for side handles
   * (right is positive whatever the writing direction) or its y axis for top and bottom ones.
   */
  onResize?: (delta: number) => void;
  /** The resize is over; `didResize` is false when nothing moved. */
  onResizeEnd?: (didResize: boolean) => void;
  /** Runs after the handle's own mouse down. */
  onMouseDown?: (event: React.MouseEvent<HTMLDivElement>) => void;
  /** Runs after the handle's own keys. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onKeyUp?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onBlur?: (event: React.FocusEvent<HTMLDivElement>) => void;
}

/**
 * A grip on the edge of a pane for changing its size, by dragging or with the arrow keys
 * (Shift for bigger steps) once focused.
 */
export function ResizeHandle({
  side,
  className,
  onResizeStart,
  onResize,
  onResizeEnd,
  onMouseDown,
  onKeyDown: onKeyDownAfter,
  ...aria
}: ResizeHandleProps): React.ReactElement {
  const isVertical = side === 'inline-start' || side === 'inline-end';
  const [dragging, setDragging] = React.useState(false);
  const dragRef = React.useRef<{ pointerId: number; start: number; moved: boolean } | null>(null);

  const along = (event: React.PointerEvent): number => (isVertical ? event.clientX : event.clientY);

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onResizeEnd?.(drag.moved);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const keys: Readonly<Record<string, number>> = isVertical
      ? { ArrowLeft: -step, ArrowRight: step }
      : { ArrowUp: -step, ArrowDown: step };
    const delta = keys[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      onResizeStart?.();
      onResize?.(delta);
      onResizeEnd?.(true);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onResizeStart?.();
      onResizeEnd?.(false);
    }
  };

  return (
    <div
      data-ui="ResizeHandle"
      data-side={side}
      data-dragging={dragging ? '' : undefined}
      role="separator"
      aria-orientation={isVertical ? 'vertical' : 'horizontal'}
      tabIndex={0}
      {...aria}
      className={cn(
        'group/resize absolute z-10 flex touch-none select-none items-center justify-center text-muted outline-none',
        SIDE_CLASSES[side],
        className,
      )}
      onMouseDown={(event) => {
        event.preventDefault();
        onMouseDown?.(event);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || dragRef.current !== null) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { pointerId: event.pointerId, start: along(event), moved: false };
        setDragging(true);
        onResizeStart?.();
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (drag === null || drag.pointerId !== event.pointerId) return;
        const delta = along(event) - drag.start;
        if (delta === 0 && !drag.moved) return;
        drag.moved = true;
        onResize?.(delta);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={(event) => {
        onKeyDown(event);
        onKeyDownAfter?.(event);
      }}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none rounded-full bg-current opacity-0 transition-opacity duration-base motion-reduce:transition-none',
          'group-hover/resize:opacity-100 group-hover/resize:delay-150',
          'group-data-[dragging]/resize:text-secondary group-data-[dragging]/resize:opacity-100',
          'group-focus-visible/resize:bg-fill-accent group-focus-visible/resize:opacity-100',
          'forced-colors:bg-[CanvasText]',
          isVertical
            ? 'h-full max-h-12 w-[3px] group-focus-visible/resize:max-h-none'
            : 'h-[3px] w-full max-w-12 group-focus-visible/resize:max-w-none',
        )}
      />
    </div>
  );
}
