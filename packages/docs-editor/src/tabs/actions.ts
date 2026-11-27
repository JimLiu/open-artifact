/** What the tab list does: each sends its call, then shows the tab it made or lands on, or says what went wrong. */
import type { DiskDoc } from '@open-artifact/docs-core';
import { announce } from '@open-artifact/editor-kit';
import type { DocFile, DocMember } from '@open-artifact/runtime/doc-api';
import { toast } from '@open-artifact/ui';
import { CallDenied, docClient } from '../app/doc-client.ts';
import { session } from '../app/session.ts';
import { docLinkBase } from '../selbar/navigate.ts';
import { showTab } from '../app/start.ts';
import { getDocs } from '../app/store.ts';
import { deleteMembers, duplicateMembers, mintedTab, moveMember, newTabMembers, renameMember } from './members.ts';
import { expandRow, getTabsUi, setTabsUi } from './state.ts';
import { type DropZone, type MoveStep, type TabMove, deletePlan, dropMove, leavesNoTab, movePatch, positionOf, stepMove, tabTree } from './tree.ts';

export const LAST_TAB_WORDS = 'A document needs at least one tab';

const files = (): DocFile[] => getDocs().project?.files ?? [];

function wordsOf(error: unknown, fallback: string): string {
  if (error instanceof CallDenied) {
    if (error.reason === 'last_tab') return LAST_TAB_WORDS;
    if (error.reason === 'not_your_session') return 'Your access to this document ended.';
    if (error.reason === 'absent') return 'That tab has since been deleted.';
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Runs one tab write at a time; a failure is shown under the list and as a toast. */
async function write<T>(fallback: string, run: () => Promise<T>): Promise<T | null> {
  if (getTabsUi().busy) return null;
  setTabsUi({ busy: true, error: null });
  try {
    return await run();
  } catch (error) {
    const words = wordsOf(error, fallback);
    setTabsUi({ error: words });
    toast.add({ title: words, type: 'error' });
    return null;
  } finally {
    setTabsUi({ busy: false });
  }
}

const send = (members: DocMember[]) => docClient().call(members.length === 1 ? { member: members[0]! } : { batch: members });

/** A new tab at the end (or the last subtab of `parent`); it opens, and its name is ready to type over. */
export async function createTab(parent?: string, rename = true): Promise<string | null> {
  return write('Couldn’t add the tab.', async () => {
    const made = newTabMembers(files(), parent);
    const id = mintedTab(await send(made.members));
    if (!id) throw new Error('Could not create the tab — the server accepted it but named no id. Reload and try again.');
    if (parent) expandRow(parent);
    showTab(id);
    if (rename) setTabsUi({ renaming: { id, draft: made.name } });
    return id;
  });
}

export async function renameTab(id: string, name: string): Promise<void> {
  const file = files().find(item => item.id === id);
  const trimmed = name.trim();
  if (!file || !trimmed || trimmed === file.name) return;
  await write('Couldn’t rename the tab.', () => send([renameMember(id, trimmed)]));
}

/** A copy of the tab right after it, which opens. */
export async function duplicateTab(id: string): Promise<void> {
  await write('Couldn’t duplicate the tab.', async () => {
    await docClient().settled();
    const read = await session().doc.read(id);
    const made = duplicateMembers(files(), id, read.doc as unknown as DiskDoc);
    if (!made) throw new Error('This tab no longer exists.');
    const copy = mintedTab(await send(made.members));
    if (copy) showTab(copy);
  });
}

/** Deletes a tab (and its subtabs, unless they are kept); when the open tab goes, the first one left opens. */
export async function deleteTab(id: string, keepSubtabs: boolean): Promise<void> {
  const before = files();
  const plan = deletePlan(before, id, keepSubtabs);
  if (!plan.deleteIds.length) return;
  if (leavesNoTab(before, plan)) {
    setTabsUi({ error: LAST_TAB_WORDS });
    return;
  }
  await write('Couldn’t delete the tab.', async () => {
    await send(deleteMembers(plan));
    const active = getDocs().activeTab;
    if (active && plan.deleteIds.includes(active)) {
      const next = tabTree(files().filter(file => !plan.deleteIds.includes(file.id)))[0];
      if (next) showTab(next.id);
    }
  });
}

const MOVED_WORDS: Record<MoveStep, { top: string; nested: string }> = {
  up: { top: 'Moved up, {pos} of {size}', nested: 'Moved up, {pos} of {size}' },
  down: { top: 'Moved down, {pos} of {size}', nested: 'Moved down, {pos} of {size}' },
  into: { top: 'Moved in one level, tab {pos} of {size}', nested: 'Moved in one level, subtab {pos} of {size}' },
  out: { top: 'Moved out one level, tab {pos} of {size}', nested: 'Moved out one level, subtab {pos} of {size}' },
};

async function moveTo(id: string, move: TabMove): Promise<boolean> {
  const patch = movePatch(files(), id, move);
  if (!patch) return false;
  const done = await write('Couldn’t move the tab.', () => send([moveMember(patch)]));
  if (done === null) return false;
  if (move.parent) expandRow(move.parent);
  return true;
}

/** One step from the tab's menu: up, down, into the tab above, or out a level. */
export async function stepTab(id: string, step: MoveStep): Promise<void> {
  const move = stepMove(tabTree(files()), id, step);
  if (!move || !(await moveTo(id, move))) return;
  const place = positionOf(tabTree(files()), id);
  if (place) {
    const words = MOVED_WORDS[step][place.parentId === undefined ? 'top' : 'nested'];
    announce(words.replace('{pos}', String(place.pos)).replace('{size}', String(place.size)));
  }
}

/** A tab dragged onto another: before it, after it, or into it. */
export async function dropTab(id: string, targetId: string, zone: DropZone): Promise<void> {
  if (id === targetId) return;
  const move = dropMove(tabTree(files()), targetId, zone);
  if (move) await moveTo(id, move);
}

/** A tab dragged to the end of the list: last at the top level. */
export async function dropTabAtEnd(id: string): Promise<void> {
  await moveTo(id, { parent: undefined, beforeId: undefined });
}

/** This page's address, opening on tab `id`. */
export function tabLink(id: string): string {
  const url = docLinkBase();
  url.searchParams.delete('tab');
  url.hash = id;
  return url.toString();
}

export async function copyTabLink(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(tabLink(id));
    toast.add({ title: 'Link copied', type: 'success' });
  } catch {
    toast.add({ title: 'Couldn’t copy the link', description: tabLink(id), type: 'error' });
  }
}

/** Shows a tab from the list; the open tab clicked again keeps its place. */
export function openTab(id: string): void {
  setTabsUi({ error: null });
  showTab(id);
}
