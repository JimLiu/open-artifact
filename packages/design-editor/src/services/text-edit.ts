/**
 * The editor's half of in-place text editing: what a board reports while
 * text is edited (the formats at the caret, a link to set, the edit's end)
 * and the format bar's commands, which act on the board's selection.
 */

import { importTextOutcome, resolveElement, type BoardEvent, type TextFormat } from '@open-artifact/dc';
import { toast } from '@open-artifact/ui';
import { importTargets } from '../lib/text-edit.ts';
import { templateOf } from './agent.ts';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { attributeSelection, edit } from './commands.ts';
import { boardApi } from './frames.ts';
import { endPlacedText } from './board-draw.ts';
import { elementsIn } from '../lib/selection.ts';

/** Marks chrome that may take focus without ending the text edit (the format bar and its popups). */
export const KEEP_TEXT_EDIT = 'data-text-edit-keep';

let lastPointerDown: { target: EventTarget | null; at: number } = { target: null, at: 0 };
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (event) => (lastPointerDown = { target: event.target, at: performance.now() }), true);
}

/** True when focus went to (or the pointer just went down in) chrome that keeps the edit going. */
function focusKeepsTextEdit(board: string): boolean {
  const active = document.activeElement;
  if (active?.closest?.(`[${KEEP_TEXT_EDIT}]`)) return true;
  const target = lastPointerDown.target as Element | null;
  if (target?.closest?.(`[${KEEP_TEXT_EDIT}]`) && performance.now() - lastPointerDown.at < 1000) return true;
  // Focus came back to the board's own frame.
  return active instanceof HTMLIFrameElement && active.dataset.board === board;
}

/** Handles a board's text editing reports; true when the event was one. */
export function textEditEvent(board: string, event: BoardEvent): boolean {
  const view = useView.getState();
  switch (event.type) {
    case 'text-state':
      if (view.textEdit?.board !== board) return true;
      if (event.active) view.patchTextEdit({ tid: event.tid, plain: event.plain, formats: event.formats });
      return true;
    case 'link-edit':
      if (view.textEdit?.board === board) view.patchTextEdit({ link: { href: event.href, collapsed: event.collapsed, host: event.host === true, rect: event.rect } });
      return true;
    case 'text-blur':
      // Focus moving to the format bar keeps the edit; anywhere else (or out of the app) ends it.
      setTimeout(() => {
        const current = useView.getState().textEdit;
        if (current?.board !== board) return;
        if (document.hasFocus() && focusKeepsTextEdit(board)) return;
        boardApi(board)?.endTextEdit(true);
      }, 0);
      return true;
    case 'text-commit': {
      const selection = view.selection;
      const item = elementsIn(selection, board).find((i) => i.tid === event.tid);
      view.setTextEdit(null);
      if (event.target?.kind === 'prop') {
        const { prop } = event.target;
        if (event.text === event.target.value) return true;
        const overrides = useView.getState().overrides[board];
        if (edit(board, { kind: 'props', values: { [prop]: event.text } }) && overrides && Object.hasOwn(overrides, prop)) {
          useView.getState().setOverride(board, prop, event.text);
        }
        return true;
      }
      if (event.target?.kind === 'import') {
        // Words of a component instance: written where the instance gets them.
        const source = useDocument.getState().boards[board]?.source;
        const element = source && item ? resolveElement(templateOf(source), item.tid, item.path) : null;
        if (!source || !item || !element) return true;
        const outcome = importTextOutcome(event.target, event.text, importTargets(source, element, useView.getState().overrides[board]));
        if (outcome.kind === 'refuse') toast.add({ title: 'Ask the agent to edit this code component.' });
        else if (outcome.kind === 'toolong') toast.add({ title: 'That text is too long to edit on the canvas.' });
        else if (outcome.kind === 'notnumber') toast.add({ title: 'This value must be a number.' });
        else if (outcome.kind === 'commit') edit(board, { kind: 'importText', target: { tid: item.tid, path: item.path }, key: event.target.key, words: event.target.words, text: event.text });
        return true;
      }
      if (event.target?.kind === 'script') {
        const { start, end, quote, value } = event.target;
        if (event.text !== value) edit(board, { kind: 'scriptText', start, end, quote, value, text: event.text });
        return true;
      }
      const empty = event.text.trim() === '' && !/<(img|svg|video|picture)\b/i.test(event.html);
      // New text emptied in its first edit goes away.
      if (endPlacedText(board, event.tid, empty)) return true;
      // Every word deleted: keep the text as it was (an empty element is lost on the canvas).
      if (empty) return true;
      // A link just set is selected next.
      if (item) edit(board, { kind: 'richText', target: { tid: item.tid, path: item.path }, html: event.html, ...(event.link != null ? { link: event.link } : {}) }, { selectCreated: event.link != null });
      return true;
    }
    case 'text-cancel':
      view.setTextEdit(null);
      endPlacedText(board, event.tid, false);
      return true;
    default:
      return false;
  }
}

/** The board whose text is being edited, if any. */
function editing(): { board: string; plain: boolean } | null {
  const { textEdit } = useView.getState();
  return textEdit ? { board: textEdit.board, plain: textEdit.plain === true } : null;
}

/** Applies a format to the selection of the text being edited. */
export function formatEditedText(format: TextFormat): void {
  const current = editing();
  if (!current || current.plain || useDocument.getState().readOnly) return;
  boardApi(current.board)?.formatText(format);
}

/** Sets (or with `''`, removes) the link the board asked for. */
export function applyEditedTextLink(href: string): void {
  const { textEdit } = useView.getState();
  if (!textEdit?.link) return;
  const { host } = textEdit.link;
  useView.getState().patchTextEdit({ link: null });
  const api = boardApi(textEdit.board);
  if (host) {
    // The edited element is the link: end the edit, then set its own address.
    api?.endTextEdit(true);
    attributeSelection('href', href.trim() || null);
    return;
  }
  api?.applyLink(href.trim());
}

/** Closes the link prompt without a change. */
export function cancelEditedTextLink(): void {
  const { textEdit } = useView.getState();
  if (!textEdit?.link) return;
  useView.getState().patchTextEdit({ link: null });
  boardApi(textEdit.board)?.cancelLinkEdit();
}

/** Writes the words being typed and ends the edit (synchronous: the board reports the commit as it ends). True when one was open. */
export function commitTextEdit(): boolean {
  const { textEdit } = useView.getState();
  if (!textEdit) return false;
  boardApi(textEdit.board)?.endTextEdit(true);
  if (useView.getState().textEdit) useView.getState().setTextEdit(null);
  return true;
}
