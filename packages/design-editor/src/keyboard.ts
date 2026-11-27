/**
 * Keyboard shortcuts. Keys pressed inside an artboard frame arrive as
 * `key` events from the board runtime and go through the same table.
 */

import { isComposingKey } from '@open-artifact/ui/keys';
import { useDocument } from './state/document.ts';
import { NO_SELECTION, useView, type Tool } from './state/view.ts';
import {
  copyProperties,
  deleteSelection,
  duplicateSelection,
  flipSelection,
  groupSelectedNotes,
  moveSelectedElements,
  nudgeSelection,
  pasteProperties,
  redo,
  selectAllSiblings,
  selectChild,
  selectParent,
  selectSibling,
  stackSelection,
  undo,
  unwrapSelection,
  wrapSelection,
} from './services/commands.ts';
import { boardsOnPage, notesOnPage } from '@open-artifact/design-core';
import { copyToSystem, pasteFromSystem } from './services/clipboard.ts';
import { armScale, cancelScale, commitScale, useScale } from './services/scale.ts';
import { zoomStep, zoomTo, zoomToBoards, zoomToFit } from './services/viewport.ts';
import { frameKeyPressed } from './services/follow.ts';
import { openFind, useFind } from './services/find.ts';
import { leaveCommentMode, runCollabShortcut } from './services/collab.ts';
import { isApplePlatform, isTextField } from '@open-artifact/editor-kit';
import { copyAs } from './services/capture.ts';
import { historyShortcutOf, isCopyPngKey, isSaveKey, paintKeyOf, zoomKeyOf } from './lib/physical-keys.ts';
import { flush } from './services/sync.ts';
import { stackOrderOf } from './lib/stacking.ts';
import { swapSelectionPaint, unfillSelection } from './services/paint.ts';
import { isLockKey } from './lib/locks.ts';
import { toggleSelectionLock } from './services/locks.ts';
import { unlockedObjects } from '@open-artifact/design-core';
import { altHeldAfter, spacePanAfter, type HeldKeyEvent } from './lib/held-keys.ts';
import { DIALOG_SELECTOR, dialogKeepsKey } from './lib/dialog-keys.ts';
import { pressAgainMessage } from './lib/card-exit.ts';
import { cardExit } from './services/card-exit.ts';
import { announce } from './services/announce.ts';
import { COMMITTED_ATTRIBUTE, committedFieldPasses, textHandoffMessage, textHandoffOf } from './lib/input-handoff.ts';
import { commitTextEdit } from './services/text-edit.ts';
import { escapeGoesHome, regionStepOf } from './lib/focus-regions.ts';
import { focusHome, regionAt, rememberRegionFocus, stepRegion } from './services/focus-regions.ts';

/** A key press, from the window or from a frame. */
export interface KeyPress {
  key: string;
  /** Physical key (Alt changes `key` on macOS). */
  code?: string;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  /** Held down and repeating. */
  repeat?: boolean;
  /** Ctrl without ⌘ (`meta` is either). */
  ctrl?: boolean;
}

const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'hand', a: 'board', b: 'board', n: 'sticky', t: 'title', r: 'rect', o: 'oval', l: 'line', p: 'pen' };

/**
 * Runs the shortcut for a key; returns whether it was handled. Copy, cut
 * and paste pressed in this window are left to the clipboard events
 * (`fromFrame` false); pressed inside an artboard frame they run here.
 */
export function runShortcut({ key, code, meta, shift, alt, repeat, ctrl }: KeyPress, fromFrame = false): boolean {
  const view = useView.getState();
  const doc = useDocument.getState();
  const lower = key.toLowerCase();

  const scaling = useScale.getState().session !== null;
  if (scaling && key === 'Escape') {
    cancelScale();
    return true;
  }
  if (scaling && key === 'Enter') {
    commitScale();
    return true;
  }
  if (runCollabShortcut({ key, code, meta, shift, alt })) return true;
  const letter = code?.startsWith('Key') ? code.slice(3).toLowerCase() : lower;
  const elements = view.selection.kind === 'elements';

  if (key === 'Escape') {
    if (view.composer) view.setComposer(false);
    else if (view.findOpen) useFind.getState().close();
    else if (view.noteEdit) view.setNoteEdit(null);
    else if (view.playing) view.play(null);
    else if (view.mode === 'focused') view.focus(null);
    else if (view.tool !== 'select') view.setTool('select');
    else if (view.selection.kind === 'elements') selectParent();
    else view.select(NO_SELECTION);
    return true;
  }

  if (meta && alt && !shift) {
    if (letter === 'c') {
      copyProperties();
      return true;
    }
    if (letter === 'v') {
      if (!doc.readOnly) pasteProperties();
      return true;
    }
  }

  // ⌘G / ⇧⌘G: canvas notes group; elements inside an artboard wrap and
  // unwrap. `letter` reads the physical key, so non-Latin layouts work too.
  if (meta && !alt && letter === 'g') {
    if (doc.readOnly) return true;
    if (view.selection.kind === 'objects') groupSelectedNotes(shift ? 'ungroup' : 'group');
    else if (shift) unwrapSelection();
    else wrapSelection('block');
    return true;
  }

  // ⌘F: find in the design; F3 / ⇧F3 step through the matches.
  if (meta && !alt && !shift && letter === 'f') {
    openFind();
    return true;
  }
  if (key === 'F3' && view.findOpen) {
    useFind.getState().step(shift ? -1 : 1);
    return true;
  }

  if (isCopyPngKey({ key, code, meta, shift, alt })) {
    void copyAs('png');
    return true;
  }

  // ⌘L / ⇧⌘L: lock or unlock the selection. Claimed even when held down,
  // so the browser never takes it.
  if (isLockKey({ key, code, meta, alt })) {
    if (!repeat && !doc.readOnly) toggleSelectionLock();
    return true;
  }

  if (runHistoryOrStacking({ key, code, meta, shift, alt, ctrl }, view.mode === 'focused')) return true;

  if (meta) {
    switch (lower) {
      case 'c':
      case 'x':
        if (!fromFrame || shift || alt) return false;
        copyToSystem(lower === 'x');
        return true;
      case 'v':
        if (!fromFrame || shift || alt) return false;
        void pasteFromSystem();
        return true;
      case 'd':
        duplicateSelection();
        return true;
      case 'a': {
        if (view.selection.kind === 'elements') {
          selectAllSiblings();
          return true;
        }
        // Locked artboards and notes are left out.
        const page = view.page;
        const free = unlockedObjects(doc.canvas, boardsOnPage(doc.canvas, page), notesOnPage(doc.canvas, page));
        view.select({ kind: 'objects', boards: free.boards, notes: free.notes });
        return true;
      }
      case '=':
      case '+':
        zoomStep(1);
        return true;
      case '-':
        zoomStep(-1);
        return true;
      case '0':
        zoomTo(1);
        return true;
      case '\\':
        view.togglePanel();
        return true;
      case 'enter':
        view.setComposer(true);
        return true;
      case 'k':
        if (!elements || shift || alt || doc.readOnly) return false;
        armScale();
        return true;
      default:
        return false;
    }
  }

  if (view.mode === 'focused') return false;

  const zoomKey = zoomKeyOf({ key, code, meta, shift, alt });
  if (zoomKey) {
    const s = view.selection;
    if (zoomKey === 'fit') zoomToFit();
    else if (zoomKey === 'actual') zoomTo(1);
    else if (s.kind === 'objects' && s.boards.length) zoomToBoards(s.boards);
    else if (s.kind === 'elements') zoomToBoards([s.board]);
    return true;
  }

  switch (key) {
    case 'Delete':
    case 'Backspace':
      if (doc.readOnly) return false;
      deleteSelection();
      return true;
    case 'Tab':
      selectSibling(shift ? -1 : 1);
      return true;
    case 'Enter':
      selectChild();
      return true;
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown': {
      const step = shift ? 10 : 1;
      const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
      if (view.selection.kind === 'elements') {
        // Positioned elements move; elements in the flow stay put.
        if (!doc.readOnly) moveSelectedElements(dx, dy, { coalesce: 'nudge' });
        return true;
      }
      if (view.selection.kind !== 'objects') return false;
      nudgeSelection(dx, dy);
      return true;
    }
    default:
      break;
  }
  if (runPaintKey({ key, code, meta, shift, alt })) return true;
  if (elements && !alt && !doc.readOnly) {
    if (shift && letter === 'h') {
      flipSelection('x');
      return true;
    }
    if (shift && letter === 'v') {
      flipSelection('y');
      return true;
    }
    if (shift && letter === 'a') {
      wrapSelection('flex');
      return true;
    }
    if (!shift && letter === 'k') {
      armScale();
      return true;
    }
  }
  if (!alt && shift && lower === 'l' && !doc.readOnly) {
    view.setTool('arrow');
    return true;
  }
  // ⇧P: the Pen (bezier paths; P stays the Pencil). ⇧I: place an image.
  if (!alt && shift && letter === 'p' && !doc.readOnly) {
    view.setTool('path');
    return true;
  }
  if (!alt && shift && letter === 'i' && !doc.readOnly) {
    view.setTool('image');
    return true;
  }
  if (!alt && !shift && TOOL_KEYS[lower] && (!doc.readOnly || TOOL_KEYS[lower] === 'select' || TOOL_KEYS[lower] === 'hand')) {
    // V also ends comment mode, even with Select already picked.
    if (TOOL_KEYS[lower] === 'select') leaveCommentMode();
    view.setTool(TOOL_KEYS[lower]);
    return true;
  }
  return false;
}

/**
 * ⌘Z / ⇧⌘Z and Ctrl+Y by the physical key (see `historyShortcutOf`); the stacking
 * shortcuts (see `stackOrderOf`). With ⌘ they are always claimed, so the
 * browser never takes them; bare brackets only when something restacks,
 * and not while an artboard plays.
 */
function runHistoryOrStacking(press: KeyPress, playing: boolean): boolean {
  const apple = isApplePlatform();
  const history = historyShortcutOf(press);
  if (history) {
    if (history === 'undo') undo();
    else redo();
    return true;
  }
  const order = stackOrderOf(press, apple);
  if (!order || (!press.meta && playing)) return false;
  return stackSelection(order) || press.meta;
}

/** X takes the fill away, ⇧X swaps fill and stroke, on the selected elements or shape notes. */
function runPaintKey(press: KeyPress): boolean {
  const paint = paintKeyOf(press);
  if (!paint || useDocument.getState().readOnly) return false;
  return paint === 'swap' ? swapSelectionPaint() : unfillSelection();
}

/** Right after the address field closes by keyboard, the first Delete only says to press it again. */
function swallowedAfterCard(press: { key: string; repeat?: boolean }): boolean {
  const after = cardExit.keyDown(press);
  if (after === 'first') announce(pressAgainMessage(press.key, isApplePlatform()));
  return after !== null;
}

/** Installs the window listeners. */
export function installKeyboard(): () => void {
  const inDialog = (target: EventTarget | null): boolean => Boolean((target as Element | null)?.closest?.(DIALOG_SELECTOR));
  const held = (event: KeyboardEvent): void => {
    const view = useView.getState();
    const press = event as KeyboardEvent & HeldKeyEvent;
    view.setAltHeld(altHeldAfter(press));
    if (event.key !== ' ' && view.spacePan) view.setSpacePan(spacePanAfter(true, press));
  };
  const down = (event: KeyboardEvent): void => {
    held(event);
    if (event.key === ' ' && !isTextField(event.target) && !inDialog(event.target)) {
      useView.getState().setSpacePan(spacePanAfter(useView.getState().spacePan, event as KeyboardEvent & HeldKeyEvent));
      event.preventDefault();
      return;
    }
    const press: KeyPress = { key: event.key, code: event.code, meta: event.metaKey || event.ctrlKey, shift: event.shiftKey, alt: event.altKey, repeat: event.repeat, ctrl: event.ctrlKey && !event.metaKey };
    // ⌘S never saves the web page; a field has committed its value by now.
    if (isSaveKey(press)) {
      if (event.defaultPrevented) return;
      event.preventDefault();
      saveNow();
      return;
    }
    // F6 / ⇧F6 step between the page's regions (Escape in the selection bar: `escapeHome`).
    const region = regionStepOf(press);
    if (region || (event.key === 'F6' && event.repeat)) {
      if (region && !event.defaultPrevented && !isComposingKey(event) && !document.querySelector(BLOCKING_POPUP)) stepRegion(region);
      event.preventDefault();
      return;
    }
    // The address card just closed keeps the focus while it animates out: a Delete there goes where the focus is going.
    const fromCard = cardExit.leftIn(event, event.target);
    if (isTextField(event.target) && !fromCard) {
      // A field committed with Enter hands shortcuts with a modifier to the canvas.
      const committed = (event.target as Element).hasAttribute(COMMITTED_ATTRIBUTE);
      if (!committed || event.defaultPrevented || isComposingKey(event) || !committedFieldPasses(press)) return;
      if (runShortcut(press)) event.preventDefault();
      return;
    }
    // Escape in an open menu or popover closes just that, not the selection (or a text edit).
    if (!fromCard && event.key === 'Escape' && (event.target as Element | null)?.closest?.('[role="menu"], [role="dialog"], [role="listbox"]')) return;
    // In a dialog or popover, Enter or Space presses its button and Delete deletes nothing behind it.
    if (!fromCard && dialogKeepsKey(event.key) && inDialog(event.target)) return;
    if (swallowedAfterCard(event)) {
      event.preventDefault();
      return;
    }
    // An artboard's text box still open: write its words first.
    const handoff = useView.getState().textEdit ? textHandoffOf(press, isApplePlatform()) : null;
    if (handoff) {
      commitTextEdit();
      if (handoff === 'hold') {
        event.preventDefault();
        announce(textHandoffMessage(press, isApplePlatform(), useView.getState().selection.kind !== 'none'));
        return;
      }
    }
    const handled = runShortcut(press);
    if (handled) event.preventDefault();
  };
  // Ahead of a tooltip open on the focused button, which would take that Escape for itself.
  const escapeHome = (event: KeyboardEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const press = { key: event.key, meta: event.metaKey || event.ctrlKey, shift: event.shiftKey, alt: event.altKey };
    if (event.defaultPrevented || !escapeGoesHome(press, { region: regionAt(target), inField: isTextField(target), expanded: target?.getAttribute('aria-expanded') === 'true' })) return;
    event.preventDefault();
    event.stopPropagation();
    focusHome();
  };
  const up = (event: KeyboardEvent): void => {
    held(event);
    cardExit.keyUp(event.key);
    if (event.key === ' ') useView.getState().setSpacePan(false);
  };
  const cancelCard = (): void => cardExit.cancel();
  const blur = (): void => {
    cardExit.cancel();
    useView.getState().setSpacePan(false);
    useView.getState().setAltHeld(false);
  };
  window.addEventListener('keydown', escapeHome, true);
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  document.addEventListener('focusin', rememberRegionFocus);
  window.addEventListener('blur', blur);
  window.addEventListener('pointerdown', cancelCard, true);
  return () => {
    window.removeEventListener('pointerdown', cancelCard, true);
    window.removeEventListener('keydown', escapeHome, true);
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    document.removeEventListener('focusin', rememberRegionFocus);
    window.removeEventListener('blur', blur);
  };
}

/** ⌘S: writes an open text box and saves at once (nothing to save when read-only). */
function saveNow(): void {
  if (useDocument.getState().readOnly) return;
  commitTextEdit();
  void flush();
}

/** Open dialogs and menus keep F6 to themselves. */
const BLOCKING_POPUP = '[role="dialog"]:not([data-toast]), [role="alertdialog"]:not([data-toast]), [role="menu"]';
let lastFrameRegionStep = 0;

/** Keys forwarded by an artboard frame. */
export function handleFrameKey(press: KeyPress): void {
  if (press.key === ' ') return;
  if (isSaveKey(press)) {
    saveNow();
    return;
  }
  if (press.key === 'F6') {
    const region = regionStepOf(press);
    const now = Date.now();
    // Out of the artboard to the next region, at most a few times a second.
    if (region && now - lastFrameRegionStep > 150 && !document.querySelector(BLOCKING_POPUP)) {
      lastFrameRegionStep = now;
      stepRegion(region);
    }
    return;
  }
  frameKeyPressed(press.key);
  if (swallowedAfterCard(press)) return;
  runShortcut(press, true);
}
