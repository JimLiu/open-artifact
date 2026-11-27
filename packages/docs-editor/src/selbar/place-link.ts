/**
 * Copy link to selection: a link to the block the selection starts in, naming the selected words by their first and
 * last characters (the paragraph the cursor is in, with nothing selected; the first cell, for cells). A block not yet
 * saved has no id to link to, so the link is to the tab instead.
 */
import type { DocState } from '@open-artifact/docs-core';
import { toast } from '@open-artifact/ui';
import { docClient } from '../app/doc-client.ts';
import { useEditor } from '../editor/format.ts';
import { blockPlaceHref } from './fragments.ts';
import { copyText } from './links.ts';
import { docLinkUrl } from './navigate.ts';
import { selectionPlace } from './selection-place.ts';

/** The model of an open tab, which knows its characters' ids. */
const shadowOf = (tab: string): DocState | null => docClient().openTabOf(tab)?.binding.shadow ?? null;

/** Copies the tab's link when the selection's block can't be linked to yet, saying so. */
async function copyTabInstead(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast.add({ title: 'Copied a link to this tab instead', description: 'To link to this part of the doc, try again in a moment.' });
  } catch {
    toast.add({ title: "Couldn't copy to the clipboard" });
  }
}

/** Copies a link to the selection of the open tab (Mod-Alt-l); false when no tab is open. */
export function copyPlaceLink(): boolean {
  const { view, tab } = useEditor.getState();
  if (!view || !tab) return false;
  const place = selectionPlace(view.state.doc, view.state.selection, shadowOf(tab));
  if (place) void copyText(docLinkUrl(`#${tab}.${blockPlaceHref(place.block, place.words).slice(1)}`));
  else void copyTabInstead(docLinkUrl(`#${tab}`));
  return true;
}
