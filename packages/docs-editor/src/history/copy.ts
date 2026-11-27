/** "Make a copy": a past version of a tab as a new tab, named for the tab and the version's time. */
import type { DocState } from '@open-artifact/docs-core';
import type { DocJson, DocMember } from '@open-artifact/runtime/doc-api';
import { blockToJson, docToPage } from '../sync/page.ts';

/** The longest tab name the doc takes. */
const MAX_NAME = 255;

/** "Notes (version of Nov 18, 2026, 3:04 PM)". */
export function copyName(tabName: string, at: string, locale?: string): string {
  const date = new Date(at);
  const when = Number.isNaN(date.getTime())
    ? at
    : date.toLocaleString(locale, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return safeTabName(`${tabName} (version of ${when})`);
}

/** A tab name as the doc takes one: no slashes or control characters, no spaces at the ends, at most 255 characters. */
export function safeTabName(name: string): string {
  const clean = name.replace(/[/\\]/g, '-').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
  return clean.slice(0, MAX_NAME).trim() || 'Copy';
}

/** The calls that make the copy: a new tab, then its body filled with the version's blocks (as new blocks). */
export function copyMembers(name: string, version: DocState): DocMember[] {
  const content = docToPage(version).content?.map(node => blockToJson(node)) ?? [];
  return [
    { verb: 'create', object: 'file', $lid: 'copy', payload: { birthName: name } },
    {
      verb: 'create',
      object: 'node',
      payload: { parent: { object: 'file', id: '$lid:copy' }, source: { as: 'blocks', from: { kind: 'blocks', content: content as unknown as DocJson[] } } },
    },
  ];
}

/** The version a copy was made of: which tab, which rev, which row of the list. */
export interface CopiedFrom {
  tab: string;
  rev: number;
  row: string;
  /** How many versions the row holds (the copy is of its newest). */
  count: number;
}

/**
 * What follows a copy: when the person still has that version open, the copy opens in its place; when they went on to
 * something else meanwhile, the page only says it is made, with a way to open it.
 */
export function afterCopy(from: CopiedFrom, shown: Pick<CopiedFrom, 'tab' | 'rev' | 'row'> | null): { open: boolean; title: string } {
  const open = !!shown && shown.tab === from.tab && shown.rev === from.rev && shown.row === from.row;
  if (open) return { open, title: from.count > 1 ? `Opened a copy of the newest of ${from.count} versions` : 'Copy opened in a new tab' };
  return { open, title: from.count > 1 ? `Copied the newest of ${from.count} versions` : 'Copy created' };
}

/** The new tab's id, from the answer to {@link copyMembers}. */
export function mintedTab(answer: Record<string, unknown>): string | null {
  const acks = Array.isArray(answer.acks) ? (answer.acks as unknown[]) : [];
  const first = acks[0];
  const minted = typeof first === 'object' && first !== null ? (first as Record<string, unknown>).minted : undefined;
  return typeof minted === 'string' ? minted : null;
}
