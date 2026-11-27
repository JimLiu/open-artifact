/**
 * Where a keyboard paste goes: to the control being typed in, or to the
 * canvas. Words go to a field only while one is being edited; anywhere else
 * (a label with some text selected, a toolbar button) they land on the
 * canvas. A picture never goes into words: it is refused, with a word on
 * what to do, while a menu or popup is open or a text box has the focus.
 */

/** A control's kind: none, a one-line field (or a list), a text area or editable text. */
export type PasteField = 'none' | 'input' | 'text';

export interface PasteContext {
  /** A picture or video on the clipboard (`null`: words or markup). */
  media: 'image' | 'video' | null;
  /** The clipboard has words. */
  hasText: boolean;
  /** What has the focus. */
  focus: PasteField;
  /** What the paste was sent to. */
  target: PasteField;
  /** The focus is in the properties panel. */
  panelFocus: boolean;
  /** Text is selected inside what has the focus. */
  selectionInFocus: boolean;
  /** A menu, popup or dialog is open. */
  popupOpen: boolean;
}

export type PasteRoute = { to: 'control' } | { to: 'canvas' } | { to: 'none'; message: string };

const noun = (media: 'image' | 'video'): string => (media === 'video' ? 'video' : 'image');

export function pasteRoute(ctx: PasteContext): PasteRoute {
  if (ctx.media) {
    if (ctx.popupOpen) return { to: 'none', message: `The ${noun(ctx.media)} wasn’t pasted. Close the open menu or popup, then paste again.` };
    if (ctx.focus === 'text') return { to: 'none', message: `The ${noun(ctx.media)} wasn’t pasted. Click the design, then paste again.` };
    return ctx.focus === 'input' && ctx.hasText ? { to: 'control' } : { to: 'canvas' };
  }
  if (ctx.focus !== 'none' && ctx.hasText) return { to: 'control' };
  if (ctx.selectionInFocus && (ctx.focus !== 'none' || ctx.panelFocus)) return { to: 'control' };
  if (ctx.popupOpen) return { to: 'control' };
  return ctx.target !== 'none' ? { to: 'control' } : { to: 'canvas' };
}
