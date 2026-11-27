/** The frame of a chip's picker: placed under the chip, closed by Escape or a press outside it. */
import { cn, isComposingKey } from '@open-artifact/ui';
import type { EditorView } from 'prosemirror-view';
import { type ReactNode, useEffect, useRef } from 'react';
import { PLACED, usePlaceAt } from './placement.ts';
import { closePicker } from './plugin.ts';

export interface PickerShellProps {
  view: EditorView;
  pos: number;
  /** Placed under the chip at `pos` (else under the caret there). */
  onChip: boolean;
  label: string;
  /** Escape: close and give the text the keyboard back. */
  onEscape(): void;
  className?: string;
  children: ReactNode;
}

export function PickerShell({ view, pos, onChip, label, onEscape, className, children }: PickerShellProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  usePlaceAt(view, pos, ref, onChip);
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || ref.current?.contains(target)) return;
      const chip = onChip ? view.nodeDOM(posRef.current) : null;
      if (chip && chip.contains(target)) return;
      closePicker(view);
    };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, [view, onChip]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={cn(PLACED, 'rounded-[12px] bg-chrome text-[14px] leading-5 text-chrome-fg shadow-chrome-popup', className)}
      onKeyDown={event => {
        if (event.key !== 'Escape' || isComposingKey(event.nativeEvent)) return;
        event.preventDefault();
        event.stopPropagation();
        onEscape();
      }}
    >
      {children}
    </div>
  );
}
