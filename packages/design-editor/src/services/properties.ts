/**
 * Copy properties (⌥⌘C) and Paste properties (⌥⌘V) on the selection: one
 * element, canvas note or artboard is copied; any number of them take the
 * paste, each only the groups its kind takes, as one undo step. The groups
 * and their conversions are `lib/style-clipboard.ts`.
 */

import { attributeValue, elementPath, parseStyle, serializeStyle, styleMap, type HtmlElement, type TemplateModel } from '@open-artifact/dc';
import { DEFAULT_PAGE_COLOR, pageFillDeclarations, pageFillEdits, pageFillFromCopy, pageFillSplices, readPageFill, rootElementOf, safePageFillValue, type PageFill, type PageFillOptions } from '../lib/page-fill.ts';
import { announce } from './announce.ts';
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
  groupsFor,
  hasValues,
  NOTE_GROUPS,
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
import { edit, resolvedGroups, type ResolvedGroup } from './commands.ts';
import { templateOf } from './agent.ts';
import { boardApi } from './frames.ts';

/**
 * A frameless artboard as its one root element (it is copied and pasted
 * onto like an element), or null for a framed artboard.
 */
function framelessRoot(path: string): ResolvedGroup | null {
  const { canvas, boards } = useDocument.getState();
  const source = boards[path]?.source;
  if (!canvas.boards[path]?.frameless || !source) return null;
  const model = templateOf(source);
  const root = rootElementOf(model);
  return root ? { board: path, model, elements: [root] } : null;
}

/** Whether the artboard's root element covers its whole page, as measured: then its background is the page's. */
function pageLayout(path: string, model: TemplateModel): PageFillOptions {
  const entry = useDocument.getState().canvas.boards[path];
  const root = rootElementOf(model);
  const tid = root ? model.tidOf.get(root) : undefined;
  const rect = tid === undefined ? null : boardApi(path)?.inspect(tid)?.rect;
  if (!entry || !rect) return {};
  return { rootCovers: rect.x <= 0.5 && rect.y <= 0.5 && rect.x + rect.width >= entry.w - 0.5 && rect.y + rect.height >= entry.h - 0.5 };
}

/** A framed artboard's page background as copied declarations, or null when its page can't be read. */
export function boardFillOf(path: string): Declarations | null {
  const source = useDocument.getState().boards[path]?.source;
  if (!source) return null;
  const model = templateOf(source);
  const fill = readPageFill(model, pageLayout(path, model));
  return fill ? pageFillDeclarations(fill) : null;
}

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
  } else if (parts.boards.length && !framelessRoot(parts.boards[0]!)) {
    const entry = canvas.boards[parts.boards[0]!];
    const fill = entry ? boardFillOf(parts.boards[0]!) : null;
    copied = entry && fill ? copyBoardStyle(entry.radius, fill) : null;
  } else {
    const group = parts.boards.length ? framelessRoot(parts.boards[0]!) : resolvedGroups(parts.elements)[0];
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
    toast.add({ title: /[.!?]$/.test(copied.refused) ? copied.refused : `${copied.refused}.` });
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
    toast.add({ title: STYLE_CLIPBOARD_TEXT.copyFirst });
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
  const framed = parts.boards.filter((path) => !framelessRoot(path));
  const roots = parts.boards.map(framelessRoot).filter((group): group is ResolvedGroup => group !== null);
  doc.transact(() => {
    for (const group of [...resolvedGroups(parts.elements), ...roots]) {
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
    const fill = groupsFor(copied, NOTE_GROUPS.board).fill;
    for (const path of framed) {
      if (!doc.canvas.boards[path]) {
        refused++;
        continue;
      }
      const radius = pastedBoardRadius(copied);
      let took = radius !== null;
      if (radius !== null) radii[path] = radius;
      if (fill) {
        const page = pageFillFromCopy(fill);
        const source = useDocument.getState().boards[path]?.source;
        const edits = page ? pageFillEdits(page) : null;
        // The same background already: nothing to write, and still a paste.
        const model = source ? templateOf(source) : null;
        const layout = model ? pageLayout(path, model) : {};
        const splices = edits && model ? pageFillSplices(model, edits, layout) : null;
        if (splices && (!splices.length || edit(path, { kind: 'pageFill', edits: edits!, ...layout }, { coalesce: key }))) took = true;
        else if (splices) failed = true;
      }
      if (took) pasted++;
      else refused++;
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

/** Why the artboards' Background row is off: a page that isn't loaded or can't be read. */
export const PAGE_UNREADABLE = 'A selected artboard’s page can’t be read right now';

/**
 * The page backgrounds of framed artboards as the Background row shows them
 * (the image layers, else the color, else white), or null when one can't be read.
 */
export function boardBackgrounds(paths: readonly string[]): string[] | null {
  const out: string[] = [];
  for (const path of paths) {
    const source = useDocument.getState().boards[path]?.source;
    const model = source ? templateOf(source) : null;
    const fill = model ? readPageFill(model, pageLayout(path, model)) : null;
    if (!fill) return null;
    out.push(fill.image ?? fill.color ?? DEFAULT_PAGE_COLOR);
  }
  return out;
}

/**
 * The Background row's edit on framed artboards, as one undo step: a color
 * replaces the background, image layers (a gradient, a picture) keep the
 * color under them, empty removes both declarations.
 */
export function setBoardBackground(paths: readonly string[], value: string): void {
  const next = value.trim();
  if (next && !safePageFillValue(next)) return;
  const key = `board-background:${Date.now()}`;
  let changed = false;
  useDocument.getState().transact(() => {
    for (const path of paths) {
      const source = useDocument.getState().boards[path]?.source;
      const model = source ? templateOf(source) : null;
      const layout = model ? pageLayout(path, model) : {};
      const before = model ? readPageFill(model, layout) : null;
      if (!before) continue;
      const fill: PageFill = !next ? {} : LAYERED_VALUE.test(next) ? { image: next, ...(before.color ? { color: before.color } : {}) } : { color: next };
      if (edit(path, { kind: 'pageFill', edits: pageFillEdits(fill), ...layout }, { coalesce: key })) changed = true;
    }
  });
  if (changed) announce(next ? 'Background updated' : 'Background reset');
}

const LAYERED_VALUE = /url\(|gradient\(/i;
