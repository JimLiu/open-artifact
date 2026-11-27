/**
 * What is selected on the canvas, and how a click, a Shift-click or a
 * marquee changes it.
 *
 * A selection is one of four shapes. `objects` and `elements` are the
 * common cases; `mixed` holds everything else: elements in more than one
 * artboard, or elements together with artboards or notes. A selection
 * that fits one of the simpler shapes is never stored as `mixed`
 * (`selectionFrom` decides), so code that handles only `elements` or
 * `objects` stays right for those.
 */

/** A selected element inside an artboard. */
export interface ElementSelection {
  tid: number;
  path: number[];
  /** Which rendered instance was clicked (repeated templates render several). */
  instance: number;
}

/** Selected elements of one artboard. */
export interface BoardElements {
  board: string;
  items: ElementSelection[];
}

/** Whole artboards and canvas notes. */
export interface ObjectsSelection {
  kind: 'objects';
  boards: string[];
  notes: string[];
}

/** Elements inside one artboard. */
export interface ElementsSelection {
  kind: 'elements';
  board: string;
  items: ElementSelection[];
}

/** One thing in a selection. */
export type SelectionMember =
  | { kind: 'board'; board: string }
  | { kind: 'note'; note: string }
  | { kind: 'element'; board: string; item: ElementSelection };

/** Elements of several artboards, or elements together with artboards or notes. */
export interface MixedSelection {
  kind: 'mixed';
  boards: string[];
  notes: string[];
  /** At most one entry per artboard, none for a selected artboard, none empty. */
  elements: BoardElements[];
  /** What joined last: the properties panel reads its file first. */
  primary: SelectionMember | null;
}

export type Selection = { kind: 'none' } | ObjectsSelection | ElementsSelection | MixedSelection;

export const NO_SELECTION: Selection = { kind: 'none' };

/** A selection taken apart, in any shape. */
export interface SelectionParts {
  boards: readonly string[];
  notes: readonly string[];
  elements: readonly BoardElements[];
  primary?: SelectionMember | null;
}

/** The members of a selection by kind. */
export function selectionParts(selection: Selection): SelectionParts {
  switch (selection.kind) {
    case 'none':
      return { boards: [], notes: [], elements: [] };
    case 'objects':
      return { boards: selection.boards, notes: selection.notes, elements: [] };
    case 'elements':
      return { boards: [], notes: [], elements: selection.items.length ? [{ board: selection.board, items: selection.items }] : [] };
    case 'mixed':
      return selection;
  }
}

const sameItem = (a: ElementSelection, b: ElementSelection): boolean => a.tid === b.tid && a.instance === b.instance;

/** The last member of the parts (what the properties panel leads with when nothing says otherwise). */
function lastMember(parts: SelectionParts): SelectionMember | null {
  const group = parts.elements[parts.elements.length - 1];
  const item = group?.items[group.items.length - 1];
  if (group && item) return { kind: 'element', board: group.board, item };
  const note = parts.notes[parts.notes.length - 1];
  if (note !== undefined) return { kind: 'note', note };
  const board = parts.boards[parts.boards.length - 1];
  return board !== undefined ? { kind: 'board', board } : null;
}

/** Whether a member is still in the parts. */
function holds(parts: SelectionParts, member: SelectionMember): boolean {
  if (member.kind === 'board') return parts.boards.includes(member.board);
  if (member.kind === 'note') return parts.notes.includes(member.note);
  return parts.elements.some((group) => group.board === member.board && group.items.some((item) => sameItem(item, member.item)));
}

/**
 * The selection made of these members, in its simplest shape. Elements of
 * a selected artboard are dropped (the artboard holds them), duplicates
 * go, and an artboard's elements end up in one entry.
 */
export function selectionFrom(parts: SelectionParts): Selection {
  const boards = [...new Set(parts.boards)];
  const notes = [...new Set(parts.notes)];
  const byBoard = new Map<string, ElementSelection[]>();
  for (const group of parts.elements) {
    if (boards.includes(group.board)) continue;
    const items = byBoard.get(group.board) ?? [];
    for (const item of group.items) if (!items.some((kept) => sameItem(kept, item))) items.push(item);
    byBoard.set(group.board, items);
  }
  const elements = [...byBoard].filter(([, items]) => items.length).map(([board, items]) => ({ board, items }));
  if (!elements.length) return boards.length || notes.length ? { kind: 'objects', boards, notes } : NO_SELECTION;
  if (elements.length === 1 && !boards.length && !notes.length) return { kind: 'elements', board: elements[0]!.board, items: elements[0]!.items };
  const normal = { boards, notes, elements };
  const primary = parts.primary && holds(normal, parts.primary) ? parts.primary : lastMember(normal);
  return { kind: 'mixed', ...normal, primary };
}

/** A selection in its simplest shape (see `selectionFrom`); simple shapes come back as they are. */
export function normalSelection(selection: Selection): Selection {
  return selection.kind === 'mixed' ? selectionFrom(selection) : selection;
}

/** The selected artboards (whole ones, not those elements are picked in). */
export function selectedBoardsOf(selection: Selection): string[] {
  return selection.kind === 'objects' || selection.kind === 'mixed' ? selection.boards : [];
}

/** The selected canvas notes. */
export function selectedNotesOf(selection: Selection): string[] {
  return selection.kind === 'objects' || selection.kind === 'mixed' ? selection.notes : [];
}

/** The selected elements, by artboard. */
export function elementGroupsOf(selection: Selection): BoardElements[] {
  if (selection.kind === 'elements') return selection.items.length ? [{ board: selection.board, items: selection.items }] : [];
  return selection.kind === 'mixed' ? selection.elements : [];
}

/** The selected elements of one artboard. */
export function elementsIn(selection: Selection, board: string): ElementSelection[] {
  return elementGroupsOf(selection).find((group) => group.board === board)?.items ?? [];
}

/** Whether an artboard takes part in the selection: selected whole, or holding selected elements. */
export function boardTakesPart(selection: Selection, board: string): boolean {
  return selectedBoardsOf(selection).includes(board) || elementsIn(selection, board).length > 0;
}

/** The artboards a selection reaches: those selected whole, then those its elements are in. */
export function boardsReached(selection: Selection): string[] {
  return [...new Set([...selectedBoardsOf(selection), ...elementGroupsOf(selection).map((group) => group.board)])];
}

/**
 * The member a selection leads with: the first element, else the first
 * artboard, else the first note; for a mixed one, what joined last.
 */
export function leadMember(selection: Selection): SelectionMember | null {
  if (selection.kind === 'mixed') return selection.primary;
  const group = elementGroupsOf(selection)[0];
  if (group?.items[0]) return { kind: 'element', board: group.board, item: group.items[0] };
  const board = selectedBoardsOf(selection)[0];
  if (board !== undefined) return { kind: 'board', board };
  const note = selectedNotesOf(selection)[0];
  return note !== undefined ? { kind: 'note', note } : null;
}

/** How many elements, artboards with elements, and canvas objects (artboards and notes) a selection holds. */
export interface SelectionCounts {
  elements: number;
  elementBoards: number;
  objects: number;
}

export function selectionCounts(selection: Selection): SelectionCounts {
  const groups = elementGroupsOf(selection);
  return {
    elements: groups.reduce((sum, group) => sum + group.items.length, 0),
    elementBoards: groups.length,
    objects: selectedBoardsOf(selection).length + selectedNotesOf(selection).length,
  };
}

/* -------------------------------------------------------------------------- */
/* Changes a press makes                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Shift on an artboard: a selected one leaves the selection; another
 * joins it, and its own selected elements give way to it.
 */
export function toggleBoard(selection: Selection, board: string): Selection {
  const parts = selectionParts(selection);
  if (parts.boards.includes(board)) return selectionFrom({ ...parts, boards: parts.boards.filter((path) => path !== board), primary: null });
  return selectionFrom({ ...parts, boards: [...parts.boards, board], primary: { kind: 'board', board } });
}

/** Shift on a note (with the rest of its group): out when it was selected, else in. */
export function toggleNotes(selection: Selection, notes: readonly string[], selected: boolean): Selection {
  const parts = selectionParts(selection);
  if (selected) return selectionFrom({ ...parts, notes: parts.notes.filter((id) => !notes.includes(id)), primary: null });
  const last = notes[notes.length - 1];
  return selectionFrom({ ...parts, notes: [...parts.notes, ...notes], primary: last === undefined ? null : { kind: 'note', note: last } });
}

/**
 * Whether adding an element of `board` selects that artboard instead: one
 * of the selected artboards is that one, or is a full artboard (only
 * fragments, which draw no frame, mix with elements this way).
 */
export function addingPromotes(selection: Selection, board: string, isFragment: (board: string) => boolean): boolean {
  return selectedBoardsOf(selection).some((path) => path === board || !isFragment(path));
}

/**
 * Shift on an element: a selected one leaves the selection; another joins
 * it, or its artboard does (see `addingPromotes`).
 */
export function toggleElement(selection: Selection, board: string, item: ElementSelection, isFragment: (board: string) => boolean): Selection {
  const parts = selectionParts(selection);
  const current = elementsIn(selection, board);
  if (current.some((kept) => kept.tid === item.tid)) {
    const items = current.filter((kept) => kept.tid !== item.tid);
    return selectionFrom({ ...parts, elements: parts.elements.map((group) => (group.board === board ? { board, items } : group)), primary: null });
  }
  if (addingPromotes(selection, board, isFragment)) {
    if (parts.boards.includes(board) && !current.length) return selection;
    return selectionFrom({ ...parts, boards: [...parts.boards, board], primary: { kind: 'board', board } });
  }
  return selectionFrom({ ...parts, elements: [...parts.elements, { board, items: [item] }], primary: { kind: 'element', board, item } });
}

/** The selection with these artboards and notes added (a marquee with Shift); selected elements stay. */
export function withObjects(selection: Selection, boards: readonly string[], notes: readonly string[]): Selection {
  const parts = selectionParts(selection);
  return selectionFrom({ ...parts, boards: [...parts.boards, ...boards], notes: [...parts.notes, ...notes] });
}

/** The selection with one artboard's elements replaced (a marquee inside it); everything else stays. */
export function withBoardElements(selection: Selection, board: string, items: readonly ElementSelection[]): Selection {
  const parts = selectionParts(selection);
  const others = parts.elements.filter((group) => group.board !== board);
  return selectionFrom({ ...parts, elements: [...others, { board, items: [...items] }] });
}

/* -------------------------------------------------------------------------- */
/* What the panels show                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Which inspector the properties panel shows: one artboard or note, a
 * set of artboards, the elements of one artboard, or the merged rows of
 * a mixed set (artboards with notes, or elements with anything else).
 */
export type InspectorRoute = 'none' | 'board' | 'note' | 'boards' | 'elements' | 'mixed';

export function inspectorRoute(selection: Selection): InspectorRoute {
  switch (selection.kind) {
    case 'none':
      return 'none';
    case 'elements':
      return selection.items.length ? 'elements' : 'none';
    case 'mixed':
      return 'mixed';
    case 'objects': {
      const count = selection.boards.length + selection.notes.length;
      if (count === 0) return 'none';
      if (count === 1) return selection.boards.length ? 'board' : 'note';
      return selection.notes.length ? 'mixed' : 'boards';
    }
  }
}

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/**
 * The label of the selection bar's Duplicate or Delete for a mixed
 * selection: `Duplicate 3 elements on 2 artboards and 1 canvas object (⌘D)`.
 */
export function crossFileActionLabel(verb: 'Duplicate' | 'Delete', counts: SelectionCounts, shortcut?: string): string {
  const where = counts.elementBoards === 1 ? '' : ` on ${counts.elementBoards} artboards`;
  const objects = counts.objects ? ` and ${plural(counts.objects, 'canvas object')}` : '';
  return `${verb} ${plural(counts.elements, 'element')}${where}${objects}${shortcut ? ` (${shortcut})` : ''}`;
}

/* -------------------------------------------------------------------------- */
/* Colors across files                                                         */
/* -------------------------------------------------------------------------- */

/** How an element takes color: words, a box, a filled shape, a line, a picture. */
export type PaintKind = 'text' | 'box' | 'shape' | 'line' | 'image';

/** Which color a control sets: the words', the fill, or the outline. */
export type PaintRole = 'text' | 'fill' | 'stroke';

/** Drawn elements: their colors are `fill` and `stroke`. */
const DRAWN_TAGS = new Set(['svg', 'rect', 'circle', 'ellipse', 'polygon', 'path', 'line', 'polyline']);

/**
 * The paint kind of an element, from its `elementKind` and tag: an HTML
 * box counts as a shape there, but takes a background and a border.
 */
export function paintKindOf(kind: 'text' | 'shape' | 'line' | 'image' | 'other', tag: string): PaintKind {
  if (kind === 'other' || (kind === 'shape' && !DRAWN_TAGS.has(tag))) return 'box';
  return kind;
}

/** The style property one color role writes on one kind, or `null` when that kind takes no such color. */
export function paintProperty(kind: PaintKind, role: PaintRole): string | null {
  switch (role) {
    case 'text':
      return kind === 'text' ? 'color' : null;
    case 'fill':
      return kind === 'box' ? 'background-color' : kind === 'shape' ? 'fill' : null;
    case 'stroke':
      // A line's outline is its stroke, never a border.
      return kind === 'shape' || kind === 'line' ? 'stroke' : kind === 'box' || kind === 'image' ? 'border-color' : null;
  }
}

/** The color controls a set of kinds shares: each one some member takes. */
export function paintRoles(kinds: Iterable<PaintKind>): PaintRole[] {
  const all = [...kinds];
  return (['text', 'fill', 'stroke'] as const).filter((role) => all.some((kind) => paintProperty(kind, role) !== null));
}

/** What a merged row shows for several members: their one value, or `Mixed` when they differ. */
export const MIXED = 'Mixed';

export function mergedValue(values: readonly string[]): string {
  if (!values.length) return '';
  return values.every((value) => value === values[0]) ? values[0]! : MIXED;
}

/** Roles every one of these kinds takes (a merged row needs each member to have it). */
export function sharedPaintRoles(kinds: readonly PaintKind[]): PaintRole[] {
  if (!kinds.length) return [];
  return (['text', 'fill', 'stroke'] as const).filter((role) => kinds.every((kind) => paintProperty(kind, role) !== null));
}
