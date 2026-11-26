/**
 * The Design editor's announcements: selection, page, mode and tool changes
 * read out through the store-free announcer of `@open-artifact/editor-kit`
 * (which this module re-exports).
 */

import { announce } from '@open-artifact/editor-kit';
import { boardsOnPage, isLockedObject } from '@open-artifact/design-core';
import { useDocument } from '../state/document.ts';
import { useView, type Selection } from '../state/view.ts';
import { templateOf } from './agent.ts';
import { describeElement } from '../lib/outline.ts';
import { resolveElement } from '@open-artifact/dc';

export { announce, announcementText, ANNOUNCE_LIMIT, useAnnouncer } from '@open-artifact/editor-kit';

const boardTitle = (path: string): string => useDocument.getState().canvas.boards[path]?.title || path.replace(/^.*\//, '').replace(/\.dc\.html$/, '');

/** A sentence describing a selection. */
export function describeSelection(selection: Selection): string {
  if (selection.kind === 'none') return 'Selection cleared';
  if (selection.kind === 'objects') {
    const { boards, notes } = selection;
    if (boards.length + notes.length === 0) return 'Selection cleared';
    if (boards.length === 1 && notes.length === 0) return `Artboard ${boardTitle(boards[0]!)}${isLockedObject(useDocument.getState().canvas.boards[boards[0]!]) ? ', locked' : ''} selected`;
    if (notes.length === 1 && boards.length === 0) {
      const note = useDocument.getState().canvas.notes[notes[0]!];
      const text = note?.text?.trim();
      return `${note?.kind === 'title1' ? 'Text' : note?.kind ? note.kind : 'Note'}${text ? ` “${text.slice(0, 40)}”` : ''} selected`;
    }
    const parts = [boards.length ? `${boards.length} artboard${boards.length === 1 ? '' : 's'}` : '', notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : ''].filter(Boolean);
    return `${parts.join(' and ')} selected`;
  }
  const source = useDocument.getState().boards[selection.board]?.source;
  if (selection.items.length !== 1 || !source) return `${selection.items.length} elements selected in ${boardTitle(selection.board)}`;
  const item = selection.items[0]!;
  const element = resolveElement(templateOf(source), item.tid, item.path);
  const name = element ? describeElement(element).name : 'Element';
  return `${name} selected in ${boardTitle(selection.board)}`;
}

let started = false;

/** Announces selection and page changes. */
const TOOL_NAMES: Partial<Record<string, string>> = { hand: 'Hand', board: 'Artboard', sticky: 'Note', title: 'Text', rect: 'Rectangle', oval: 'Oval', line: 'Line', arrow: 'Arrow', pen: 'Pencil', path: 'Pen. Click to add points, drag for curves, Enter to finish', image: 'Image. Click where the image goes' };

export function startAnnouncer(): void {
  if (started) return;
  started = true;
  useView.subscribe((state, previous) => {
    if (state.page !== previous.page) {
      const { canvas } = useDocument.getState();
      const name = canvas.pages.find((p) => p.id === state.page)?.name ?? 'Page';
      const count = boardsOnPage(canvas, state.page).length;
      announce(`${name}, ${count} artboard${count === 1 ? '' : 's'}`);
      return;
    }
    if (state.selection !== previous.selection) announce(describeSelection(state.selection));
    else if (state.mode !== previous.mode) announce(state.mode === 'focused' && state.focused ? `Playing ${boardTitle(state.focused)}` : 'Back to canvas');
    else if (state.tool !== previous.tool && state.tool !== 'select') announce(`${TOOL_NAMES[state.tool] ?? state.tool} tool`);
  });
}
