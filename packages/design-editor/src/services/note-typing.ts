/**
 * The sticky being typed: its text box registers here so the typing strip
 * can read the draft and its selection, rewrite them (bold, italic, lists)
 * and give the box its focus back; and so the canvas and Escape commit the
 * draft rather than drop it.
 */

import { create } from 'zustand';
import { useView } from '../state/view.ts';
import type { Edited } from '../lib/note-typing.ts';

/** What the strip reads of the open text box. */
export interface NoteTyping {
  id: string | null;
  text: string;
  start: number;
  end: number;
}

export const useNoteTyping = create<NoteTyping>(() => ({ id: null, text: '', start: 0, end: 0 }));

/** The open text box, as the strip drives it. */
export interface NoteEditorHandle {
  id: string;
  area: HTMLTextAreaElement;
  /** Replaces the draft and selects `start`–`end` once it shows. */
  replace(edited: Edited): void;
  /** Writes the draft to the note and ends the typing. */
  commit(): void;
}

let open: NoteEditorHandle | null = null;

/** Registers the open text box; the returned function forgets it. */
export function registerNoteEditor(handle: NoteEditorHandle): () => void {
  open = handle;
  return () => {
    if (open !== handle) return;
    open = null;
    useNoteTyping.setState({ id: null, text: '', start: 0, end: 0 });
  };
}

/** Notes the draft and its selection, for the strip. */
export function reportNoteTyping(id: string, area: HTMLTextAreaElement): void {
  useNoteTyping.setState({ id, text: area.value, start: area.selectionStart, end: area.selectionEnd });
}

/** Rewrites the open draft (a format from the strip) and gives the box its focus back. */
export function editNoteTyping(edit: (typing: NoteTyping) => Edited): void {
  if (!open) return;
  const typing = useNoteTyping.getState();
  const edited = edit({ ...typing, text: open.area.value, start: open.area.selectionStart, end: open.area.selectionEnd });
  open.replace(edited);
}

/** Gives the open text box its focus back, its selection as it was. */
export function focusNoteTyping(): void {
  open?.area.focus({ preventScroll: true });
}

/** Ends the typing of a note, writing its draft. */
export function commitNoteTyping(): void {
  if (open) open.commit();
  else if (useView.getState().noteEdit) useView.getState().setNoteEdit(null);
}
