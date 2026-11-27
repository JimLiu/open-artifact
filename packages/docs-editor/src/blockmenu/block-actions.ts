/** What the element menu does to a top-level block, found again by its id when it runs. */
import { Fragment, type Node as PMNode, Slice } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { deleteNodeAt, duplicateNodeAt, topBlockAt } from '../editor/commands.ts';
import { foldedIds, toggleFold } from '../editor/fold.ts';
import { schema } from '../editor/schema.ts';
import { headingHref, headingWords } from '../selbar/fragments.ts';
import { copyText } from '../selbar/links.ts';
import { docLinkUrl } from '../selbar/navigate.ts';
import { toast } from '@open-artifact/ui';

/** A block the menu was opened on: its id when it has one, and where it was. */
export interface BlockRef {
  bid: string | null;
  pos: number;
}

export const isHeading = (node: PMNode) => node.type === schema.nodes.paragraph && !!node.attrs.heading;

/** The block now: by its id, else what is still at its place. */
export function resolveBlock(doc: PMNode, ref: BlockRef): { node: PMNode; pos: number } | null {
  if (ref.bid) {
    let found: { node: PMNode; pos: number } | null = null;
    doc.forEach((node, pos) => {
      if (!found && node.attrs.bid === ref.bid) found = { node, pos };
    });
    if (found) return found;
    return null;
  }
  return ref.pos <= doc.content.size ? topBlockAt(doc, ref.pos) : null;
}

export async function copyBlock(view: EditorView, ref: BlockRef): Promise<void> {
  const block = resolveBlock(view.state.doc, ref);
  if (!block) return;
  const { dom, text } = view.serializeForClipboard(new Slice(Fragment.from(block.node), 0, 0));
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': new Blob([dom.innerHTML], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) }),
      ]);
      toast.add({ title: 'Copied', type: 'success' });
      return;
    }
  } catch {
    // Some browsers refuse rich copies; the text alone below.
  }
  await copyText(text, 'Copied');
}

export function headingLink(node: PMNode): string | null {
  if (!isHeading(node) || typeof node.attrs.bid !== 'string') return null;
  return docLinkUrl(headingHref(node.attrs.bid, headingWords(node)));
}

export function copyHeadingLink(view: EditorView, ref: BlockRef): void {
  const block = resolveBlock(view.state.doc, ref);
  const url = block ? headingLink(block.node) : null;
  if (url) void copyText(url);
}

export function duplicateBlock(view: EditorView, ref: BlockRef): void {
  const block = resolveBlock(view.state.doc, ref);
  if (block) duplicateNodeAt(block.pos)(view.state, view.dispatch);
  view.focus();
}

export function deleteBlock(view: EditorView, ref: BlockRef): void {
  const block = resolveBlock(view.state.doc, ref);
  if (!block) return;
  // The doc keeps one block: the last one is emptied instead.
  if (view.state.doc.childCount === 1) view.dispatch(view.state.tr.replaceWith(block.pos, block.pos + block.node.nodeSize, schema.nodes.paragraph!.create()));
  else deleteNodeAt(block.pos)(view.state, view.dispatch);
  view.focus();
}

export function isFolded(view: EditorView, node: PMNode): boolean {
  return typeof node.attrs.bid === 'string' && foldedIds(view.state).has(node.attrs.bid);
}

export function foldBlock(view: EditorView, ref: BlockRef): void {
  const block = resolveBlock(view.state.doc, ref);
  const bid = block?.node.attrs.bid;
  if (typeof bid === 'string') toggleFold(bid)(view.state, view.dispatch);
}
