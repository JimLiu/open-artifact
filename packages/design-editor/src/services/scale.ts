/**
 * The Scale tool (K): scales the selected elements and everything inside
 * them by a factor, through their inline styles. While it is active the
 * selection strip shows a percent field; each change rewrites the styles
 * from the originals (one undo step), Done keeps the result, Cancel undoes it.
 */

import { create } from 'zustand';
import { attributeValue, elementChildren, elementPath, hasDynamicStyle, styleMap, type HtmlElement } from '@open-artifact/dc';
import { toast } from '@open-artifact/ui';
import type { Address } from '../lib/ops.ts';
import { pinnedStyle, scaleLengths, scaleStyle } from '../lib/scale.ts';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { edit, selectedElements, undo } from './commands.ts';
import { boardApi } from './frames.ts';
import { isElementLocked } from '../lib/locks.ts';
import { refuseLocked } from './locks.ts';

interface Target {
  address: Address;
  /** Inline declarations as they were. */
  style: Record<string, string>;
  /** Declarations added for the scale (computed or attribute sizes); removed again at 100%. */
  pinned: Record<string, string>;
  root: boolean;
}

interface ScaleSession {
  board: string;
  targets: Target[];
  /** Width of the first selected element, for `320px` inputs. */
  width: number;
  key: string;
  applied: boolean;
  /** Elements whose size could not be scaled (components, styles from the script). */
  kept: number;
}

interface ScaleState {
  session: ScaleSession | null;
  factor: number;
}

export const useScale = create<ScaleState>(() => ({ session: null, factor: 1 }));

const SIZED_TAGS = new Set(['svg', 'img', 'video', 'canvas']);
const attrPx = (value: string | undefined) => (value && /^\d*\.?\d+(px)?$/.test(value.trim()) ? `${parseFloat(value)}px` : null);

/** Starts scaling the selection. */
export function armScale(): void {
  const doc = useDocument.getState();
  if (doc.readOnly) return;
  const selected = selectedElements();
  if (!selected) {
    toast.add({ title: 'Select elements to scale them' });
    return;
  }
  if (selected.elements.some(isElementLocked)) {
    refuseLocked();
    return;
  }
  const { board, model } = selected;
  const api = boardApi(board);
  const targets: Target[] = [];
  let kept = 0;
  const address = (el: HtmlElement): Address => ({ tid: model.tidOf.get(el)!, path: elementPath(model, el) });
  const visit = (el: HtmlElement, root: boolean): void => {
    if (el.tag === 'helmet' || el.tag === 'style' || el.tag === 'script') return;
    if (el.tag === 'dc-import' || el.tag === 'x-import') {
      kept++;
      return;
    }
    if (el.tag !== 'sc-for' && el.tag !== 'sc-if') {
      if (hasDynamicStyle(el)) kept++;
      else {
        const style = styleMap(attributeValue(el, 'style') ?? '');
        const pinned: Record<string, string> = {};
        if (root) {
          const computed = api?.inspect(model.tidOf.get(el)!)?.computed;
          if (computed) Object.assign(pinned, pinnedStyle(style, computed));
        }
        if (SIZED_TAGS.has(el.tag)) {
          const width = attrPx(attributeValue(el, 'width'));
          const height = attrPx(attributeValue(el, 'height'));
          if (width && !style.width && !pinned.width) pinned.width = width;
          if (height && !style.height && !pinned.height) pinned.height = height;
        }
        targets.push({ address: address(el), style, pinned, root });
      }
    }
    // An SVG scales as a whole through its box (its viewBox does the rest).
    if (el.tag === 'svg') return;
    for (const child of elementChildren(el)) visit(child, false);
  };
  for (const el of selected.elements) visit(el, true);
  if (!targets.length) {
    toast.add({ title: 'Nothing here can be scaled', description: 'Its styles come from the page’s script or from components.' });
    return;
  }
  const first = selected.elements[0]!;
  const width = api?.inspect(model.tidOf.get(first)!)?.rect.width ?? 0;
  useScale.setState({ session: { board, targets, width, key: `scale-${Date.now()}`, applied: false, kept }, factor: 1 });
}

/** Applies a factor. */
export function setScaleFactor(factor: number): void {
  const { session } = useScale.getState();
  if (!session) return;
  const f = Math.min(100, Math.max(0.01, factor));
  useScale.setState({ factor: f });
  if (!session.applied && f === 1) return;
  const edits = session.targets.map((target) => {
    const patch: Record<string, string | null> = { ...scaleStyle(target.style, f, target.root) };
    for (const [property, value] of Object.entries(target.pinned)) patch[property] = f === 1 ? null : scaleLengths(value, f);
    return { target: target.address, patch };
  });
  if (edit(session.board, { kind: 'styles', edits }, { coalesce: session.key })) session.applied = true;
}

/** Keeps the scaled result. */
export function commitScale(): void {
  const { session, factor } = useScale.getState();
  if (!session) return;
  useScale.setState({ session: null, factor: 1 });
  if (!session.applied) return;
  toast.add({
    title: `Scaled to ${Math.round(factor * 100)}%`,
    description: session.kept ? 'Components and styles from the page’s script kept their size.' : undefined,
  });
}

export function cancelScale(): void {
  const { session } = useScale.getState();
  if (!session) return;
  useScale.setState({ session: null, factor: 1 });
  if (session.applied) undo();
}

// Changing the selection keeps the result.
useView.subscribe((state, previous) => {
  if (state.selection !== previous.selection && useScale.getState().session) commitScale();
});
