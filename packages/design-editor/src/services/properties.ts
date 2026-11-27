/**
 * Copy properties (⌥⌘C) and Paste properties (⌥⌘V) on the selection: one
 * element, canvas note or artboard is copied; any number of them take the
 * paste, each only the groups its kind takes, as one undo step. The groups
 * and their conversions are `lib/style-clipboard.ts`.
 */

import { attributeValue, elementPath, parseStyle, serializeStyle, styleMap, type HtmlElement, type TemplateModel } from '@open-artifact/dc';
import { noteCssValue, type CanvasNote } from '@open-artifact/design-core';
import { toast } from '@open-artifact/ui';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { selectionParts } from '../lib/selection.ts';
import { REFUSED, refuses, subjectOf } from '../lib/style-subject.ts';
import {
  copyBoardStyle,
  copyElementStyle,
  copyNoteStyle,
  hasValues,
  pastedBoardRadius,
  pastedElementStyle,
  pastedNote,
  pasteReport,
  readCopiedStyle,
  STYLE_CLIPBOARD_TEXT,
  writeCopiedStyle,
  type CopiedStyle,
  type Declarations,
} from '../lib/style-clipboard.ts';
import { edit, resolvedGroups } from './commands.ts';
import { boardApi } from './frames.ts';

function computedOf(board: string, model: TemplateModel, element: HtmlElement): Declarations {
  const tid = model.tidOf.get(element);
  return (tid === undefined ? null : boardApi(board)?.inspect(tid)?.computed) ?? {};
}

/** What the selection's one member would copy, or why nothing. */
function copyOfSelection(): CopiedStyle | { refused: string } | null {
  const parts = selectionParts(useView.getState().selection);
  const count = parts.boards.length + parts.notes.length + parts.elements.reduce((sum, group) => sum + group.items.length, 0);
  if (!count) return null;
  if (count > 1) return { refused: STYLE_CLIPBOARD_TEXT.justOne };
  const { canvas } = useDocument.getState();
  let copied: CopiedStyle | null = null;
  if (parts.notes.length) {
    const note = canvas.notes[parts.notes[0]!];
    copied = note ? copyNoteStyle(note) : null;
  } else if (parts.boards.length) {
    const entry = canvas.boards[parts.boards[0]!];
    copied = entry ? copyBoardStyle(entry.radius) : null;
  } else {
    const group = resolvedGroups(parts.elements)[0];
    const element = group?.elements[0];
    if (group && element && !REFUSED.has(element.tag)) {
      const subject = subjectOf(element);
      copied = copyElementStyle(subject.kind, styleMap(attributeValue(subject.element, 'style') ?? ''), computedOf(group.board, group.model, subject.element));
    }
  }
  return copied && hasValues(copied) ? copied : { refused: STYLE_CLIPBOARD_TEXT.nothing };
}

/** Why Copy properties is off for the selection, or null when it is on. */
export function copyPropertiesRefusal(): string | null {
  const copied = copyOfSelection();
  if (!copied) return STYLE_CLIPBOARD_TEXT.nothing;
  return 'refused' in copied ? copied.refused : null;
}

/** Why Paste properties is off, or null when it is on. */
export function pastePropertiesRefusal(): string | null {
  return readCopiedStyle() ? null : STYLE_CLIPBOARD_TEXT.copyFirst;
}

/** ⌥⌘C: copies the look of the one selected element, note or artboard. */
export function copyProperties(): void {
  const copied = copyOfSelection();
  if (!copied) return;
  if ('refused' in copied) {
    toast.add({ title: `${copied.refused}.` });
    return;
  }
  toast.add({ title: writeCopiedStyle(copied) ? STYLE_CLIPBOARD_TEXT.copied : STYLE_CLIPBOARD_TEXT.copyFailed });
}

/** An inline style from declarations, keeping `!important` on those that had it. */
function styleText(declarations: Declarations, before: string): string {
  const important = new Set(parseStyle(before).filter((declaration) => declaration.important).map((declaration) => declaration.property));
  return serializeStyle(Object.entries(declarations).map(([property, value]) => ({ property, value, important: important.has(property) })));
}

/** ⌥⌘V: pastes the copied look onto every selected element, note and artboard that takes it. */
export function pasteProperties(): void {
  const doc = useDocument.getState();
  if (doc.readOnly) return;
  const copied = readCopiedStyle();
  if (!copied) {
    toast.add({ title: `${STYLE_CLIPBOARD_TEXT.copyFirst}.` });
    return;
  }
  const parts = selectionParts(useView.getState().selection);
  if (!parts.boards.length && !parts.notes.length && !parts.elements.length) {
    toast.add({ title: STYLE_CLIPBOARD_TEXT.selectTargets });
    return;
  }
  let pasted = 0;
  let refused = 0;
  let failed = false;
  const key = `paste-properties:${Date.now()}`;
  doc.transact(() => {
    for (const group of resolvedGroups(parts.elements)) {
      for (const element of group.elements) {
        if (refuses(element)) {
          refused++;
          continue;
        }
        const subject = subjectOf(element);
        const computed = computedOf(group.board, group.model, subject.element);
        const tid = group.model.tidOf.get(subject.element);
        const rect = tid === undefined ? undefined : boardApi(group.board)?.inspect(tid)?.rect;
        const before = attributeValue(subject.element, 'style') ?? '';
        const next = pastedElementStyle(copied, subject.kind, styleMap(before), computed, rect && rect.height > rect.width ? 'down' : 'across');
        if (!next || tid === undefined) {
          refused++;
          continue;
        }
        const target = { tid, path: elementPath(group.model, subject.element) };
        const text = styleText(next, before);
        if (text === before.trim()) pasted++;
        else if (edit(group.board, { kind: 'attr', target, name: 'style', value: text || null }, { coalesce: key })) pasted++;
        else failed = true;
      }
    }
    const notes: Record<string, CanvasNote> = {};
    for (const id of parts.notes) {
      const note = doc.canvas.notes[id];
      const next = note ? pastedNote(copied, note, noteCssValue) : null;
      if (next) {
        notes[id] = next;
        pasted++;
      } else refused++;
    }
    const radii: Record<string, number | undefined> = {};
    for (const path of parts.boards) {
      const radius = doc.canvas.boards[path] ? pastedBoardRadius(copied) : null;
      if (radius === null) refused++;
      else {
        radii[path] = radius;
        pasted++;
      }
    }
    if (Object.keys(notes).length || Object.keys(radii).length) {
      useDocument.getState().updateCanvas((canvas) => {
        const boards = { ...canvas.boards };
        for (const [path, radius] of Object.entries(radii)) {
          const entry = { ...boards[path]! };
          if (radius === undefined) delete entry.radius;
          else entry.radius = radius;
          boards[path] = entry;
        }
        return { ...canvas, notes: { ...canvas.notes, ...notes }, boards };
      });
    }
  });
  toast.add({ title: failed ? STYLE_CLIPBOARD_TEXT.pasteFailed : pasteReport(pasted, refused) });
}
