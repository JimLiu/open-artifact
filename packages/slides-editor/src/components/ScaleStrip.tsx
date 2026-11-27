/**
 * The format strip while Scale is on: a percent field with Done and Cancel.
 * Typing a size scales the preview as soon as it reads as one; the arrow keys
 * step it.
 */

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import { announce } from '@open-artifact/editor-kit';
import { isComposingKey } from '@open-artifact/ui';
import { Card, ChromeButton, ChromeDivider, Tip } from '@open-artifact/editor-kit/react';
import { formatScale, parseScaleInput, scaleInRange, stepScale } from '../lib/scale.ts';
import { undoRedoKey } from '../lib/shortcut-keys.ts';
import { undo } from '../services/commands.ts';
import { SCALE_STRIP_ATTRIBUTE, cancelScale, keepScale, noteTypedInvalid, scaleUndoInField, setScale, useScale } from '../services/scale.ts';

/** What was typed, and the factor it was typed at (a grip drag or an arrow key replaces it). */
interface Typed {
  text: string;
  at: number;
}

export function ScaleStrip(): ReactNode {
  const session = useScale((s) => s.session);
  const [typed, setTyped] = useState<Typed | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const hint = useId();

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);

  if (!session) return null;
  const { factor, limits, target } = session;
  const shown = typed && typed.at === factor ? typed.text : formatScale(factor);
  const invalid = typed !== null && typed.at === factor && !scaleInRange(parseScaleInput(typed.text, target.box.w), limits);
  const range = `Type a scale from ${formatScale(limits.min)} to ${formatScale(limits.max)}`;

  const onChange = (text: string): void => {
    const next = parseScaleInput(text, target.box.w);
    if (scaleInRange(next, limits)) {
      setScale(next);
      noteTypedInvalid(false);
      setTyped({ text, at: useScale.getState().session?.factor ?? next });
    } else {
      noteTypedInvalid(true);
      setTyped({ text, at: factor });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (isComposingKey(event.nativeEvent)) return;
    // The keys the field takes stay out of the editor's shortcuts; the rest (F6, ⌘F) go on.
    const handled = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === 'Enter') {
      handled();
      if (invalid) announce(range);
      else keepScale();
    } else if (event.key === 'Escape') {
      handled();
      cancelScale();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      handled();
      const next = stepScale(factor, event.key === 'ArrowUp', event.shiftKey, limits);
      setScale(next);
      setTyped(null);
      noteTypedInvalid(false);
      announce(formatScale(next));
    } else if (undoRedoKey(event.nativeEvent) === 'undo') {
      handled();
      // Before anything has been scaled, ⌘Z also takes back the step before the scale.
      if (!scaleUndoInField()) {
        cancelScale();
        undo();
      }
    }
  };

  // The focus leaving the strip (Tab, Shift+Tab, F6, a click elsewhere) keeps the scale.
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    keepScale();
  };

  return (
    <Card role="toolbar" aria-label="Scale" className="h-10 gap-1 px-1" onBlur={onBlur} {...{ [SCALE_STRIP_ATTRIBUTE]: '' }}>
      <label className="flex items-center gap-2 pl-2 text-[13px]">
        <span>Scale</span>
        <input
          ref={input}
          value={shown}
          aria-label="Scale"
          aria-describedby={hint}
          aria-invalid={invalid || undefined}
          title={invalid ? range : undefined}
          spellCheck={false}
          autoComplete="off"
          inputMode="decimal"
          className={`h-7 w-20 rounded-md bg-chrome-field px-2 text-right tabular-nums text-chrome-fg outline-none focus-visible:ring-2 focus-visible:ring-chrome-accent ${invalid ? 'ring-2 ring-danger' : ''}`}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>
      <span id={hint} className="sr-only">
        A percentage, a multiple such as 1.5x, or a width in px. The arrow keys step by 1%, with Shift by 10%. Enter keeps the scale, Escape puts it back.
      </span>
      <ChromeDivider />
      <Tip label="Done" shortcut="↵">
        <ChromeButton square aria-label="Done" disabled={invalid} onClick={keepScale}>
          <Check className="size-4" />
        </ChromeButton>
      </Tip>
      <Tip label="Cancel" shortcut="Esc">
        <ChromeButton square aria-label="Cancel" onClick={cancelScale}>
          <X className="size-4" />
        </ChromeButton>
      </Tip>
    </Card>
  );
}
