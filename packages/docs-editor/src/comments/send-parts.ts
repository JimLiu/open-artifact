/**
 * What a comment sent to the agent carries for an app to show (`wake.request.parts`): the words the person typed,
 * and what the comment is on when they sent it. The host checks both; the agent's text does not depend on them.
 */
import { selectionSnapshotOf } from '@open-artifact/editor-kit';
import type { CommentSendOptions, SelectionSnapshot } from '@open-artifact/runtime';
import type { DocAnchor } from './anchor.ts';

/** What a new thread is on, as its composer saw it. */
export interface SendPlace {
  anchor: DocAnchor;
  /** The thread's label: the quoted words, `Empty paragraph`, a cells label, or `@Agent` on an agent chip. */
  label: string;
  /** The words the thread is on (the words, the cell or cells), or the line an agent chip went into. */
  quote?: string;
  /** The thread hangs on an agent chip the person put in at the caret: `quote` is its line. */
  chip?: boolean;
  /** The text block the thread is in. */
  block?: string | null;
}

/** The most a snapshot's `text` holds (`SELECTION_SNAPSHOT_LIMITS.text` of `@open-artifact/protocol`). */
const TEXT_MAX = 1800;

/** A tab's name, for `where`, when the doc has more than one tab. */
export const tabWhere = (name: string | null | undefined): string | undefined => (name ? `Tab "${name.replace(/\s+/g, ' ').trim()}"` : undefined);

/** The one-line chip text for words: the first words, on one line. */
const chipText = (words: string, max = 60): string => {
  const line = words.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/** What a new thread is on, at Send; `undefined` where nothing is (an agent chip on an empty line). */
export function docsSelectionSnapshot(place: SendPlace, where?: string): SelectionSnapshot | undefined {
  const items = place.block ? [{ id: place.block, kind: 'block' }] : [];
  const common = { count: 1, items, ...(where ? { where } : {}) };
  const quote = (place.quote?.trim() ?? '').slice(0, TEXT_MAX);
  const { anchor } = place;
  let snapshot: SelectionSnapshot | null = null;
  if (place.chip) {
    if (!quote) return undefined;
    snapshot = selectionSnapshotOf({ kind: 'line', label: chipText(quote), text: quote, ...common });
  } else if (anchor.kind === 'words') {
    snapshot = selectionSnapshotOf({ kind: 'text', label: place.label, ...(quote ? { text: quote } : {}), ...common });
  } else if (anchor.kind === 'block') {
    snapshot = selectionSnapshotOf({ kind: 'block', label: place.label, ...common, items: [{ id: anchor.block, kind: 'block' }] });
  } else if (anchor.kind === 'cell') {
    snapshot = selectionSnapshotOf({ kind: 'cell', label: place.label, ...(quote ? { text: quote } : {}), ...common, items: [{ id: anchor.cell, kind: 'cell' }] });
  } else if (anchor.kind === 'cells') {
    snapshot = selectionSnapshotOf({
      kind: 'cells',
      label: place.label,
      ...(quote ? { text: quote } : {}),
      ...(where ? { where } : {}),
      count: anchor.cells.length,
      items: anchor.cells.map(id => ({ id, kind: 'cell' })),
    });
  }
  return snapshot ?? undefined;
}

/** The parts of a send: the person's words (what they typed, before any `@agent` the page put first) and the place. */
export function sendParts(typed: string, snapshot?: SelectionSnapshot): Pick<CommentSendOptions, 'userText' | 'selectionSnapshot'> {
  const words = typed.trim();
  return { ...(words ? { userText: words } : {}), ...(snapshot ? { selectionSnapshot: snapshot } : {}) };
}
