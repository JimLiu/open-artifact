/**
 * Aligning the selected element's border (Inside, Center, Outside) and
 * editing an aligned border: what the artboard paints against the border
 * is measured when asked, and the style and the focus ring change as one
 * undo step.
 */

import { attributeValue, resolveElement, styleMap, type HtmlElement } from '@open-artifact/dc';
import { alignedLookEdit, alignEdit, alignmentName, FOCUS_STYLE_ATTRIBUTE, type AlignContext, type AlignEdit, type BorderAlignment, type BorderLook } from '../lib/border-align.ts';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { announce } from './announce.ts';
import { templateOf } from './agent.ts';
import { edit } from './commands.ts';
import { boardApi } from './frames.ts';

/** The selected element (the first one), where it is and what it computes. */
function selected(): { board: string; tid: number; path: number[]; element: HtmlElement; computed: Record<string, string> } | null {
  const { selection } = useView.getState();
  if (selection.kind !== 'elements' || selection.items.length === 0) return null;
  const { tid, path } = selection.items[0]!;
  const source = useDocument.getState().boards[selection.board]?.source;
  if (source == null) return null;
  const element = resolveElement(templateOf(source), tid, path);
  if (!element) return null;
  const computed = boardApi(selection.board)?.inspect(tid)?.computed ?? {};
  return { board: selection.board, tid, path, element, computed };
}

/** Inside a repeated or conditional group (its place is not the element's own). */
const inGroup = (element: HtmlElement): boolean => {
  for (let node = element.parent; node; node = node.parent) if (node.tag === 'sc-for' || node.tag === 'sc-if') return true;
  return false;
};

/** What aligning depends on, measured in the artboard now. */
function contextOf(board: string, tid: number, element: HtmlElement): AlignContext {
  const measured = boardApi(board)?.borderContext(tid) ?? null;
  const frameless = useDocument.getState().canvas.boards[board]?.frameless === true;
  const absolute = styleMap(attributeValue(element, 'style') ?? '').position?.trim() === 'absolute';
  return {
    ...(measured ? { pinned: measured.pinned, classBorder: measured.classBorder, classOutline: measured.classOutline, focusStyled: measured.focusStyled } : {}),
    placed: frameless && absolute && !inGroup(element),
  };
}

/** Writes an edit to the element as one undo step. */
function write(board: string, target: { tid: number; path: number[] }, change: AlignEdit): boolean {
  let done = false;
  useDocument.getState().transact(() => {
    done = edit(board, { kind: 'style', targets: [target], patch: change.style });
    if (done && change.focus !== undefined) edit(board, { kind: 'attr', target, name: FOCUS_STYLE_ATTRIBUTE, value: change.focus });
  });
  return done;
}

/** Moves the selected element's border to `to`; says so when it did. */
export function alignSelectedBorder(to: BorderAlignment): boolean {
  const at = selected();
  if (!at) return false;
  const change = alignEdit(at.element, to, at.computed, contextOf(at.board, at.tid, at.element));
  if (!change || !write(at.board, at, change)) return false;
  announce(alignmentName(to));
  return true;
}

/** Changes the color, style or width of the selected element's aligned border. */
export function editSelectedAlignedBorder(change: Partial<BorderLook>): boolean {
  const at = selected();
  if (!at) return false;
  const next = alignedLookEdit(at.element, change, at.computed, contextOf(at.board, at.tid, at.element));
  return next !== null && write(at.board, at, next);
}
