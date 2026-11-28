/**
 * Cropping an image or video note on the canvas. The draft lives here until
 * the crop is confirmed (Enter, Escape, a press elsewhere, another selection
 * or tool) and is then written as one undo step: the note's `crop`, its css
 * fit, and its box when the frame changed. ⌘Z while cropping, the note being
 * deleted or its picture being changed by someone else cancel it.
 */

import { create } from 'zustand';
import { toast } from '@open-artifact/ui';
import { isTextField } from '@open-artifact/editor-kit';
import { isUncropped, UNCROPPED, type CanvasNote, type NoteCrop } from '@open-artifact/design-core';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { announce } from './announce.ts';
import { refuseLocked } from './locks.ts';
import { LOCKED_MESSAGE } from '../lib/locks.ts';
import { pictureSize } from './picture-sizes.ts';
import {
  contentInsets,
  CROP_MESSAGES,
  cropFromPosition,
  cropKeyAction,
  cropOf,
  cropRefusal,
  intoNote,
  panPicture,
  pictureRect,
  placeFrame,
  zoomPicture,
  type Box,
  type CropKeyPress,
  type Size,
} from '../lib/note-crop.ts';

export interface CropDraft {
  note: string;
  src: string;
  natural: Size;
  /** The picture's area of the note when cropping began (inside its border), in the note's space. */
  start: Box;
  /** The crop the note showed when cropping began. */
  from: NoteCrop;
  frame: Box;
  picture: Box;
  /** The corner zoom handles show (after a press on the picture outside the frame). */
  zoomHandles: boolean;
}

export const useNoteCrop = create<{ draft: CropDraft | null }>(() => ({ draft: null }));

/** A handle drag in progress: Escape cancels just that drag. */
let cancelDrag: (() => void) | null = null;
export function setCropDrag(cancel: (() => void) | null): void {
  cancelDrag = cancel;
}

let unwatch: (() => void) | null = null;

const noteSize = (note: CanvasNote): Size => ({ w: note.w ?? 320, h: note.h ?? 240 });

/** Why the note cannot be cropped now, as said to the user, or null. */
export function noteCropBlocked(note: CanvasNote | undefined): string | null {
  if (!note || note.kind !== 'image' || !note.src) return CROP_MESSAGES.unloaded;
  const why = cropRefusal(note, Boolean(pictureSize(note.src)));
  if (why === 'locked') return LOCKED_MESSAGE;
  return why ? CROP_MESSAGES[why] : null;
}

/** Starts cropping a note (double-click, the bar's Crop button). Says why when it can't. */
export function startNoteCrop(id: string): boolean {
  const doc = useDocument.getState();
  const view = useView.getState();
  if (doc.readOnly) return false;
  if (view.noteCrop === id) return true;
  if (view.noteCrop) endNoteCrop('confirm');
  const note = doc.canvas.notes[id];
  if (!note || note.kind !== 'image' || !note.src) return false;
  const natural = pictureSize(note.src);
  const why = cropRefusal(note, Boolean(natural));
  if (why === 'locked') {
    refuseLocked();
    return false;
  }
  if (why || !natural) {
    announce(CROP_MESSAGES[why ?? 'unloaded']);
    return false;
  }
  const active = document.activeElement;
  if (active instanceof HTMLElement && isTextField(active)) active.blur();
  const size = noteSize(note);
  const inset = contentInsets(note.css);
  const start = { x: inset.left, y: inset.top, w: Math.max(1, size.w - inset.left - inset.right), h: Math.max(1, size.h - inset.top - inset.bottom) };
  const fit = note.css?.['object-fit'];
  const from = note.crop ?? (fit === 'cover' ? cropFromPosition(note.css?.['object-position']) : UNCROPPED);
  const picture = pictureRect(natural, start, from);
  const selection = view.selection;
  if (selection.kind !== 'objects' || selection.boards.length || selection.notes.length !== 1 || selection.notes[0] !== id) view.select({ kind: 'objects', boards: [], notes: [id] });
  useNoteCrop.setState({ draft: { note: id, src: note.src, natural, start, from, frame: start, picture, zoomHandles: false } });
  useView.getState().setNoteCrop(id);
  watch(id, note.src);
  announce(CROP_MESSAGES.started);
  return true;
}

/** Ends cropping: `confirm` writes the draft (when it changed anything), `cancel` drops it and says so, `drop` drops it quietly. */
export function endNoteCrop(how: 'confirm' | 'cancel' | 'drop'): void {
  const draft = useNoteCrop.getState().draft;
  unwatch?.();
  unwatch = null;
  cancelDrag = null;
  useNoteCrop.setState({ draft: null });
  useView.getState().setNoteCrop(null);
  if (!draft) return;
  if (how === 'cancel') announce(CROP_MESSAGES.cancelled);
  if (how !== 'confirm') return;
  const doc = useDocument.getState();
  const note = doc.canvas.notes[draft.note];
  if (!note || doc.readOnly) return;
  const crop = cropOf(draft.natural, draft.frame, draft.picture);
  const framed = draft.frame.x !== draft.start.x || draft.frame.y !== draft.start.y || draft.frame.w !== draft.start.w || draft.frame.h !== draft.start.h;
  const same = (a: NoteCrop, b: NoteCrop) => a.zoom === b.zoom && a.x === b.x && a.y === b.y;
  if (!framed && same(crop, cropOf(draft.natural, draft.start, pictureRect(draft.natural, draft.start, draft.from)))) return;
  let box: Box | null = null;
  if (framed) {
    const size = noteSize(note);
    const inset = { left: draft.start.x, top: draft.start.y, right: size.w - draft.start.x - draft.start.w, bottom: size.h - draft.start.y - draft.start.h };
    const outer = { x: draft.frame.x - inset.left, y: draft.frame.y - inset.top, w: draft.frame.w + inset.left + inset.right, h: draft.frame.h + inset.top + inset.bottom };
    box = placeFrame({ x: note.x, y: note.y, w: size.w, h: size.h, rotate: note.rotate }, outer);
  }
  useDocument.getState().updateCanvas((canvas) => {
    const current = canvas.notes[draft.note];
    if (!current) return canvas;
    const { 'object-position': _, ...css } = current.css ?? {};
    const next: CanvasNote = { ...current, css: { ...css, 'object-fit': 'cover' }, ...(box ?? {}) };
    if (isUncropped(crop)) delete next.crop;
    else next.crop = crop;
    return { ...canvas, notes: { ...canvas.notes, [draft.note]: next } };
  }, 'Crop');
  announce(isUncropped(crop) ? CROP_MESSAGES.removed : CROP_MESSAGES.cropped);
}

/** Changes the draft. */
export function patchNoteCrop(patch: Partial<Pick<CropDraft, 'frame' | 'picture' | 'zoomHandles'>>): void {
  const draft = useNoteCrop.getState().draft;
  if (draft) useNoteCrop.setState({ draft: { ...draft, ...patch } });
}

/** Moves the picture by a screen-space amount. */
export function panNoteCrop(dx: number, dy: number): void {
  const draft = useNoteCrop.getState().draft;
  if (!draft) return;
  const note = useDocument.getState().canvas.notes[draft.note];
  const moved = intoNote(dx, dy, note?.rotate, useView.getState().camera.zoom);
  patchNoteCrop({ picture: panPicture(draft.picture, draft.frame, moved.dx, moved.dy) });
}

/** Zooms the picture by `factor` about a point of the note's space (the frame's centre by default). */
export function zoomNoteCrop(factor: number, at?: { x: number; y: number }): void {
  const draft = useNoteCrop.getState().draft;
  if (!draft) return;
  const x = at?.x ?? draft.frame.x + draft.frame.w / 2;
  const y = at?.y ?? draft.frame.y + draft.frame.h / 2;
  patchNoteCrop({ picture: zoomPicture(draft.picture, draft.frame, draft.natural, factor, x, y) });
}

/**
 * A key pressed while cropping (from the window, or an artboard frame).
 * Returns true when cropping took it; false lets the editor have it.
 */
export function noteCropKey(press: CropKeyPress): boolean {
  if (!useNoteCrop.getState().draft) return false;
  const action = cropKeyAction(press);
  switch (action.kind) {
    case 'cancel':
      endNoteCrop('cancel');
      return true;
    case 'confirm':
      if (press.key === 'Escape' && cancelDrag) {
        cancelDrag();
        cancelDrag = null;
        return true;
      }
      endNoteCrop('confirm');
      return true;
    case 'confirm-pass':
      endNoteCrop('confirm');
      return false;
    case 'pass':
      return false;
    case 'hold':
      return true;
    case 'move':
      panNoteCrop(action.dx, action.dy);
      return true;
    case 'zoom':
      zoomNoteCrop(action.factor);
      return true;
  }
}

/** Confirms on another selection, a placing or drawing tool, playing an artboard or another page; cancels when the note goes or its picture changes. */
function watch(id: string, src: string): void {
  const offView = useView.subscribe((state, prev) => {
    if (state.noteCrop !== id) return;
    const selection = state.selection;
    const still = selection.kind === 'objects' && !selection.boards.length && selection.notes.length === 1 && selection.notes[0] === id;
    const placing = state.tool !== prev.tool && state.tool !== 'select' && state.tool !== 'hand';
    if ((state.selection !== prev.selection && !still) || placing || (state.playing && !prev.playing) || state.page !== prev.page || state.mode !== prev.mode) endNoteCrop('confirm');
  });
  const offDocument = useDocument.subscribe((state) => {
    const note = state.canvas.notes[id];
    if (!note || note.src !== src || state.readOnly) endNoteCrop('drop');
  });
  unwatch = () => {
    offView();
    offDocument();
  };
}

/** Refuses an action that cannot run while a note is being cropped; true when it did. */
export function refuseWhileCropping(message: string = CROP_MESSAGES.busy): boolean {
  if (!useView.getState().noteCrop) return false;
  toast.add({ title: message });
  return true;
}
