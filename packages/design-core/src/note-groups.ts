/**
 * Groups of canvas notes (stickies, titles, shapes, drawings, pictures).
 *
 * Each note lists the groups it belongs to in `groups`, innermost first, so
 * groups nest: grouping two groups makes an outer group around them. Groups
 * nest at most `MAX_NOTE_GROUPS` levels (stored lists are cleaned by
 * `normalizeNoteGroups`). A group is only real while it
 * has two or more members and its members differ from every other group's;
 * anything else in `groups` is ignored and dropped on the next edit.
 *
 * Selection follows the groups: picking a grouped note selects its outermost
 * group, double-clicking steps one group in, and Group / Ungroup plan the new
 * `groups` lists of the notes they touch. Every function here is pure.
 */

import { freshId, MAX_NOTE_GROUPS, pageOf, type Canvas, type CanvasNote } from './canvas.ts';

/** A note as the group functions see it. */
export interface GroupedItem {
  id: string;
  groups?: readonly string[];
}

/** Group id → member ids, and note id → its groups, smallest first. */
export interface NoteGroupIndex {
  members: Map<string, string[]>;
  chain: Map<string, string[]>;
}

/** Why Group or Ungroup did nothing. */
export type GroupRefusal = 'few' | 'already' | 'deep' | 'nothing';

/** Note id → its new `groups` list. */
export type GroupPlan = Map<string, string[]>;

/** The notes of a canvas in stacking order, as group items. */
export function groupItems(canvas: Canvas): GroupedItem[] {
  return Object.entries(canvas.notes).map(([id, note]) => ({ id, groups: Array.isArray(note.groups) ? (note.groups as string[]) : undefined }));
}

const cache = new WeakMap<readonly GroupedItem[], NoteGroupIndex>();

/**
 * Indexes the groups of a note list. Groups of fewer than two members, and
 * groups with the same members as an earlier one, are dropped. Cached per list.
 */
export function noteGroupIndex(items: readonly GroupedItem[]): NoteGroupIndex {
  const hit = cache.get(items);
  if (hit) return hit;
  const members = new Map<string, string[]>();
  for (const item of items) {
    for (const group of new Set(item.groups ?? [])) {
      const list = members.get(group) ?? [];
      list.push(item.id);
      members.set(group, list);
    }
  }
  const seen = new Set<string>();
  for (const [group, ids] of members) {
    const key = ids.join('\n');
    if (ids.length < 2 || seen.has(key)) members.delete(group);
    else seen.add(key);
  }
  const size = (group: string) => members.get(group)?.length ?? 0;
  const chain = new Map<string, string[]>();
  for (const item of items) {
    const groups = [...new Set(item.groups ?? [])].filter((group) => members.has(group));
    if (groups.length) chain.set(item.id, groups.sort((a, b) => size(a) - size(b)));
  }
  const index = { members, chain };
  cache.set(items, index);
  return index;
}

/** The outermost group of `id` that is not in `excluded`. */
function outermostOutside(index: NoteGroupIndex, id: string, excluded: ReadonlySet<string>): string | undefined {
  const chain = index.chain.get(id) ?? [];
  for (let i = chain.length - 1; i >= 0; i--) if (!excluded.has(chain[i]!)) return chain[i];
  return undefined;
}

/** Groups the selection covers only in part: the ones it has stepped into. */
export function partiallySelectedGroups(index: NoteGroupIndex, selected: Iterable<string>): Set<string> {
  const counts = new Map<string, number>();
  for (const id of selected) for (const group of index.chain.get(id) ?? []) counts.set(group, (counts.get(group) ?? 0) + 1);
  return new Set([...counts].filter(([group, count]) => count < (index.members.get(group)?.length ?? 0)).map(([group]) => group));
}

/** Adds every member of each id's outermost group outside `excluded`. */
export function expandToGroups(index: NoteGroupIndex, ids: readonly string[], excluded: ReadonlySet<string> = new Set()): string[] {
  if (!index.members.size) return [...ids];
  const out = new Set(ids);
  const done = new Set<string>();
  for (const id of out) {
    const group = outermostOutside(index, id, excluded);
    if (group === undefined || done.has(group)) continue;
    done.add(group);
    for (const member of index.members.get(group) ?? []) out.add(member);
  }
  return [...out];
}

/**
 * Picking notes selects their whole groups, except groups the previous
 * selection had stepped into (so clicking around inside a group stays inside).
 */
export function expandNotesToGroups(items: readonly GroupedItem[], picked: readonly string[], previous: readonly string[] = []): string[] {
  const index = noteGroupIndex(items);
  return expandToGroups(index, picked, partiallySelectedGroups(index, previous));
}

/**
 * Double-click on a grouped note: the selection one group further in, or
 * `null` when the note is not grouped or already selected alone.
 */
export function enterNoteGroup(items: readonly GroupedItem[], id: string, selected: readonly string[]): string[] | null {
  const index = noteGroupIndex(items);
  if (!index.chain.has(id) || (selected.length === 1 && selected[0] === id)) return null;
  const open = partiallySelectedGroups(index, selected);
  const group = outermostOutside(index, id, open);
  if (group === undefined) return [id];
  open.add(group);
  return expandToGroups(index, [id], open);
}

/** The selected ids, bucketed by the outermost whole group each is in. */
export function groupSelectionUnits(index: NoteGroupIndex, items: readonly GroupedItem[], selected: ReadonlySet<string>): { group?: string; ids: string[] }[] {
  const open = partiallySelectedGroups(index, selected);
  const units = new Map<string, { group?: string; ids: string[] }>();
  for (const item of items) {
    if (!selected.has(item.id)) continue;
    const group = outermostOutside(index, item.id, open);
    const key = group !== undefined ? `/${group}` : item.id;
    const unit = units.get(key) ?? (group !== undefined ? { group, ids: [] } : { ids: [] });
    unit.ids.push(item.id);
    units.set(key, unit);
  }
  return [...units.values()];
}

/** Whether the selection holds at least one whole group (Ungroup applies). */
export function selectionHasGroup(items: readonly GroupedItem[], selected: readonly string[]): boolean {
  return groupSelectionUnits(noteGroupIndex(items), items, new Set(selected)).some((unit) => unit.group !== undefined);
}

/**
 * Plans Group: the selected units become one new group `newGroup`, nested
 * inside any group they all share. Refuses fewer than two units, a selection
 * that is already one group, and nesting deeper than `maxDepth`.
 */
export function planGroup(items: readonly GroupedItem[], selected: readonly string[], newGroup: string, maxDepth = MAX_NOTE_GROUPS): GroupPlan | { refused: GroupRefusal } {
  const index = noteGroupIndex(items);
  const picked = new Set(selected);
  const units = groupSelectionUnits(index, items, picked);
  if (units.length < 2) return { refused: units[0]?.group !== undefined ? 'already' : 'few' };
  const open = partiallySelectedGroups(index, picked);
  const ids = units.flatMap((unit) => unit.ids);
  const shared = (group: string) => open.has(group) && ids.every((id) => index.chain.get(id)?.includes(group));
  const plan: GroupPlan = new Map();
  for (const id of ids) {
    const chain = index.chain.get(id) ?? [];
    plan.set(id, [...chain.filter((group) => !open.has(group)), newGroup, ...chain.filter(shared)]);
  }
  return [...plan.values()].some((groups) => groups.length > maxDepth) ? { refused: 'deep' } : plan;
}

/** Plans Ungroup: every whole group in the selection is removed from its members. */
export function planUngroup(items: readonly GroupedItem[], selected: readonly string[]): GroupPlan | { refused: GroupRefusal } {
  const index = noteGroupIndex(items);
  const groups = new Set(groupSelectionUnits(index, items, new Set(selected)).flatMap((unit) => (unit.group !== undefined ? [unit.group] : [])));
  if (!groups.size) return { refused: 'nothing' };
  const plan: GroupPlan = new Map();
  for (const group of groups) {
    for (const id of index.members.get(group) ?? []) plan.set(id, (index.chain.get(id) ?? []).filter((g) => !groups.has(g)));
  }
  return plan;
}

/** What to tell the viewer when Group or Ungroup refused. */
export function groupRefusalMessage(reason: GroupRefusal, maxDepth = MAX_NOTE_GROUPS): string {
  switch (reason) {
    case 'few':
      return 'Select two or more objects to group.';
    case 'already':
      return 'These are already one group.';
    case 'deep':
      return `Groups can nest only ${maxDepth} levels deep. Ungroup one first.`;
    default:
      return 'Nothing to ungroup. Select a group.';
  }
}

/** The note with `groups` set, or without the key when the list is empty. */
export function withNoteGroups<T extends CanvasNote>(note: T, groups: readonly string[] | undefined): T {
  const { groups: _old, ...rest } = note;
  return (groups && groups.length ? { ...rest, groups: [...groups] } : rest) as T;
}

/**
 * Moves `ids` next to the topmost of them in the stacking order (same page
 * only), so the members of a new group stay together. Returns the new note
 * order; notes on other pages keep their place.
 */
export function gatherInStack(order: readonly string[], ids: ReadonlySet<string>, pageOf: (id: string) => string | null): string[] {
  let top = -1;
  order.forEach((id, at) => {
    if (ids.has(id)) top = at;
  });
  if (top < 0) return [...order];
  const page = pageOf(order[top]!);
  const stays = (id: string) => !ids.has(id) || pageOf(id) !== page;
  return [...order.slice(0, top + 1).filter(stays), ...order.filter((id) => !stays(id)), ...order.slice(top + 1)];
}

/**
 * The `groups` of copies: one fresh id per live source group (so a copy of a
 * group is its own group), dead group ids dropped. `copied` are the source
 * notes being copied; returns source id → the copy's groups.
 */
export function freshGroupIds(copied: readonly GroupedItem[], newGroupId: () => string): Map<string, string[] | undefined> {
  const { members } = noteGroupIndex(copied);
  const renamed = new Map<string, string>();
  const rename = (group: string) => {
    let id = renamed.get(group);
    if (id === undefined) renamed.set(group, (id = newGroupId()));
    return id;
  };
  return new Map(copied.map((item) => [item.id, item.groups?.flatMap((group) => (members.has(group) ? [rename(group)] : []))]));
}

/** Every group id used by a canvas, for minting fresh ones. */
export function usedGroupIds(canvas: Canvas): Set<string> {
  const out = new Set<string>();
  for (const note of Object.values(canvas.notes)) if (Array.isArray(note.groups)) for (const group of note.groups as string[]) out.add(group);
  return out;
}

/**
 * Groups (`'group'`) or ungroups the selected notes of a canvas. A new
 * group's notes gather in the stack next to the topmost of them. Returns the
 * new canvas, or the refusal.
 */
export function regroupNotes(canvas: Canvas, selected: readonly string[], kind: 'group' | 'ungroup', newGroup: string): { canvas: Canvas } | { refused: GroupRefusal } {
  const items = groupItems(canvas);
  const plan = kind === 'group' ? planGroup(items, selected, newGroup) : planUngroup(items, selected);
  if (!(plan instanceof Map)) return plan;
  const page = (id: string) => (canvas.pages.length ? (canvas.notes[id]?.page ?? canvas.pages[0]!.id) : null);
  const ids = Object.keys(canvas.notes);
  const order = kind === 'group' ? gatherInStack(ids, new Set(plan.keys()), page) : ids;
  const notes: Record<string, CanvasNote> = {};
  for (const id of order) notes[id] = plan.has(id) ? withNoteGroups(canvas.notes[id]!, plan.get(id)) : canvas.notes[id]!;
  return { canvas: { ...canvas, notes } };
}

/** A group id no note of the canvas uses. */
export function freshGroupId(canvas: Canvas, also: Iterable<string> = []): string {
  return freshId('g', [...usedGroupIds(canvas), ...also]);
}

/**
 * Adds copies of notes (duplicate, paste). Copies of a group form a new
 * group of their own; group ids that were not live among the copied notes
 * are dropped. `place` positions each copy. Returns the canvas and the new ids
 * in the order of `sources`.
 */
export function addNoteCopies(canvas: Canvas, sources: readonly CanvasNote[], place: (note: CanvasNote) => CanvasNote, idPrefix = 'n'): { canvas: Canvas; ids: string[] } {
  const minted: string[] = [];
  const groups = freshGroupIds(
    sources.map((note, at) => ({ id: String(at), groups: Array.isArray(note.groups) ? note.groups : undefined })),
    () => {
      const id = freshGroupId(canvas, minted);
      minted.push(id);
      return id;
    },
  );
  const notes = { ...canvas.notes };
  const ids: string[] = [];
  sources.forEach((source, at) => {
    const id = freshId(idPrefix, Object.keys(notes));
    notes[id] = withNoteGroups(place(source), groups.get(String(at)));
    ids.push(id);
  });
  return { canvas: { ...canvas, notes }, ids };
}

/**
 * Brings the given notes to the front (`'front'`, painted last) or sends them
 * to the back, keeping their order among themselves. Notes paint in the
 * order of the `notes` record. Returns the same canvas when nothing moves.
 */
export function restackNotes(canvas: Canvas, ids: readonly string[], to: 'front' | 'back'): Canvas {
  const picked = new Set(ids.filter((id) => id in canvas.notes));
  const keys = Object.keys(canvas.notes);
  const moving = keys.filter((id) => picked.has(id));
  const staying = keys.filter((id) => !picked.has(id));
  const order = to === 'front' ? [...staying, ...moving] : [...moving, ...staying];
  if (!moving.length || order.every((id, at) => id === keys[at])) return canvas;
  const notes: Record<string, CanvasNote> = {};
  for (const id of order) notes[id] = canvas.notes[id]!;
  return { ...canvas, notes };
}

/**
 * Moves notes one step up (`forward`) or down (`backward`) the stacking
 * order: each steps past the next note on its page that is not moving, or
 * past that note's whole group. Locked notes stay where they are. Returns
 * the same canvas when nothing moves.
 */
export function stepNotes(canvas: Canvas, ids: readonly string[], direction: 'forward' | 'backward'): Canvas {
  const moving = new Set(ids.filter((id) => id in canvas.notes && canvas.notes[id]!.locked !== true));
  const keys = Object.keys(canvas.notes);
  if (!moving.size) return canvas;
  const index = noteGroupIndex(groupItems(canvas));
  const page = (id: string) => pageOf(canvas, canvas.notes[id]!);
  let order = [...keys];
  const up = direction === 'forward';
  // The note nearest the end it heads for goes first, so none jumps another.
  const queue = keys.filter((id) => moving.has(id));
  if (up) queue.reverse();
  for (const id of queue) {
    const at = order.indexOf(id);
    const ahead = up ? order.slice(at + 1) : order.slice(0, at).reverse();
    const next = ahead.find((other) => !moving.has(other) && page(other) === page(id));
    if (next === undefined) continue;
    // Stepping past a grouped note steps past all of its group on this page.
    const unit = new Set(expandToGroups(index, [next]).filter((other) => !moving.has(other) && page(other) === page(id)));
    const rest = order.filter((other) => other !== id);
    const spots = rest.flatMap((other, spot) => (unit.has(other) ? [spot] : []));
    const spot = up ? Math.max(...spots) + 1 : Math.min(...spots);
    order = [...rest.slice(0, spot), id, ...rest.slice(spot)];
  }
  if (order.every((id, at) => id === keys[at])) return canvas;
  const notes: Record<string, CanvasNote> = {};
  for (const id of order) notes[id] = canvas.notes[id]!;
  return { ...canvas, notes };
}
