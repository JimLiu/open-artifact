/**
 * Editing commands: every change the editor makes to the deck goes through
 * here as one undoable step. Slide commands work on the deck index (order,
 * sections, cover) and slide files; element commands work on the current
 * slide's selection.
 *
 * Selection rules (the stage and the keyboard share them):
 * - a click selects the innermost element under the pointer;
 * - an unpainted layout box (no fill, border or shadow) is not selected by a
 *   click, only by walking up from a child (Shift+Enter);
 * - a manual group (`data-group`) is selected as a whole until it is
 *   entered (Enter, or a double click), like a single element.
 */

import { localize } from '@open-artifact/runtime';
import { maybeSession } from './session.ts';
import { slideHash } from './location.ts';
import {
  addSectionAtGap,
  addSectionAtSlide,
  boxPaints,
  cloneNode,
  comparePaths,
  DEFAULT_TEXT,
  deleteSection,
  describeSection,
  duplicateNodes,
  duplicateSlide,
  groupNodes,
  isAncestorPath,
  isPinned,
  LIMITS,
  countSlideCells,
  insertTableColumn,
  insertTableRow,
  removeTableColumn,
  removeTableRow,
  tableColumns,
  makeLayout,
  moveIdsToIndex,
  moveNode,
  moveSectionToGap,
  moveSectionsToGap,
  moveSlidesIntoNewSection,
  moveSlidesToSection,
  newSlideId,
  newTable,
  newTextBox,
  nodeAt,
  patchNodeStyle,
  pinNode,
  pinnedRectOf,
  pxValue,
  reconcileSections,
  removeNodes,
  removeSlideFromSections,
  reorderNode,
  round2,
  samePath,
  sectionedDeck,
  sectionsMap,
  sectionsOf,
  setHidden,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  slideElementIds,
  slideMoveDestination,
  ungroupNode,
  updateNodeAt,
  walkNodes,
  insertNodes,
  type DeckIndex,
  type IconName,
  type LayoutId,
  type NodePath,
  type Rect,
  type SectionedDeck,
  type ShapeKind,
  type Slide,
  type SlideNode,
  type TableNode,
  type StylePatch,
  type ZMove,
} from '@open-artifact/slides-core';
import { toast } from '@open-artifact/ui';
import { targetTable, type TableTarget } from '../lib/table-target.ts';
import { deckOrder, useDeck, type SlideEntry } from '../state/deck.ts';
import { useView } from '../state/view.ts';

/* -------------------------------------------------------------------------- */
/* Guards and plumbing                                                         */
/* -------------------------------------------------------------------------- */

/** True when this viewer may change the deck now. */
export function canChange(): boolean {
  const deck = useDeck.getState();
  return deck.status === 'ready' && !deck.readOnly;
}

/** The entry of a slide that can be edited (not held read-only), or null. */
export function editableEntry(id: string | null): SlideEntry | null {
  if (!id || !canChange()) return null;
  const entry = useDeck.getState().slides[id];
  return entry && !entry.held && !entry.conflict ? entry : null;
}

/** The slide on stage, editable or not. */
export function currentSlide(): Slide | null {
  const id = useView.getState().current;
  return id ? (useDeck.getState().slides[id]?.slide ?? null) : null;
}

/** The deck order (index order resolved against the slide files). */
export function order(): string[] {
  return deckOrder(useDeck.getState());
}

/**
 * Changes one slide as one undo step. `fn` returns the new slide, or null /
 * the same slide for "no change". Returns true when something changed.
 */
export function changeSlide(id: string, label: string, fn: (slide: Slide) => Slide | null, options: { coalesce?: string } = {}): boolean {
  const entry = editableEntry(id);
  if (!entry) return false;
  const next = fn(entry.slide);
  if (!next || next === entry.slide) return false;
  useDeck.getState().apply(label, { slides: { [id]: next } }, { ...options, focus: id });
  return true;
}

/** Changes the slide on stage. */
export function changeCurrent(label: string, fn: (slide: Slide) => Slide | null, options: { coalesce?: string } = {}): boolean {
  const id = useView.getState().current;
  return id ? changeSlide(id, label, fn, options) : false;
}

/** The index with a new order and section list. */
function withSections(index: DeckIndex, deck: SectionedDeck): DeckIndex {
  return { ...index, order: deck.order, sections: sectionsMap(reconcileSections(deck.sections, deck.order)) };
}

/** The sectioned slice of the current deck. */
function sectioned(): SectionedDeck {
  const state = useDeck.getState();
  return sectionedDeck(state.index, deckOrder(state));
}

/** Applies a section operation's result, if it applied. */
function applySections(label: string, next: SectionedDeck | undefined, slides?: Record<string, Slide | null>): boolean {
  if (!next || !canChange()) return false;
  const state = useDeck.getState();
  state.apply(label, { index: withSections(state.index, next), ...(slides ? { slides } : {}) });
  return true;
}

/* -------------------------------------------------------------------------- */
/* Slides                                                                      */
/* -------------------------------------------------------------------------- */

/** The slides a slide command acts on: the selection, else the current slide. */
export function targetSlides(): string[] {
  const view = useView.getState();
  const ids = view.slideSelection.length ? view.slideSelection : view.current ? [view.current] : [];
  const all = order();
  return all.filter((id) => ids.includes(id));
}

/** Adds a slide of `layout` after `after` (default: the current slide) and shows it. */
export function addSlide(layout: LayoutId = 'blank', after: string | null = useView.getState().current): string | null {
  if (!canChange()) return null;
  const state = useDeck.getState();
  const ids = deckOrder(state);
  if (ids.length >= LIMITS.slides) {
    toast.add({ title: localize(`A deck holds at most ${LIMITS.slides} slides`, `一份演示文稿最多包含 ${LIMITS.slides} 张幻灯片`) });
    return null;
  }
  const taken = new Set([...Object.keys(state.slides), ...Object.keys(state.trash)]);
  const id = newSlideId(taken);
  const slide = makeLayout(layout, id);
  const at = after ? ids.indexOf(after) + 1 : ids.length;
  const nextOrder = [...ids.slice(0, at), id, ...ids.slice(at)];
  state.apply(localize('Add slide', '添加幻灯片'), { slides: { [id]: slide }, index: { ...state.index, order: nextOrder } }, { focus: id });
  useView.getState().showSlide(id);
  return id;
}

/** Duplicates slides; the copies follow the last of them. */
export function duplicateSlides(ids: readonly string[] = targetSlides()): string[] {
  if (!canChange() || ids.length === 0) return [];
  const state = useDeck.getState();
  const all = deckOrder(state);
  if (all.length + ids.length > LIMITS.slides) {
    toast.add({ title: localize(`A deck holds at most ${LIMITS.slides} slides`, `一份演示文稿最多包含 ${LIMITS.slides} 张幻灯片`) });
    return [];
  }
  const taken = new Set([...Object.keys(state.slides), ...Object.keys(state.trash)]);
  const slides: Record<string, Slide> = {};
  const copies: string[] = [];
  for (const id of ids) {
    const source = state.slides[id];
    if (!source || source.held) continue;
    const copyId = newSlideId(taken);
    taken.add(copyId);
    slides[copyId] = duplicateSlide(source.slide, copyId);
    copies.push(copyId);
  }
  if (copies.length === 0) return [];
  const last = Math.max(...ids.map((id) => all.indexOf(id)));
  const nextOrder = [...all.slice(0, last + 1), ...copies, ...all.slice(last + 1)];
  state.apply(copies.length === 1 ? localize('Duplicate slide', '复制幻灯片') : localize(`Duplicate ${copies.length} slides`, `复制 ${copies.length} 张幻灯片`), { slides, index: { ...state.index, order: nextOrder } });
  useView.getState().showSlide(copies[0]!);
  if (copies.length > 1) useView.getState().selectSlides(copies);
  return copies;
}

/** Inserts slides (already compiled, ids free) after `after`. */
export function insertSlides(slides: readonly Slide[], after: string | null, label: string): string[] {
  if (!canChange() || slides.length === 0) return [];
  const state = useDeck.getState();
  const all = deckOrder(state);
  const room = LIMITS.slides - all.length;
  if (room <= 0) {
    toast.add({ title: localize(`A deck holds at most ${LIMITS.slides} slides`, `一份演示文稿最多包含 ${LIMITS.slides} 张幻灯片`) });
    return [];
  }
  const taken = new Set([...Object.keys(state.slides), ...Object.keys(state.trash)]);
  const added: Record<string, Slide> = {};
  const ids: string[] = [];
  for (const slide of slides.slice(0, room)) {
    const id = taken.has(slide.id) ? newSlideId(taken) : slide.id;
    taken.add(id);
    added[id] = id === slide.id ? slide : { ...slide, id };
    ids.push(id);
  }
  const at = after ? all.indexOf(after) + 1 : all.length;
  state.apply(label, { slides: added, index: { ...state.index, order: [...all.slice(0, at), ...ids, ...all.slice(at)] } });
  useView.getState().showSlide(ids[0]!);
  if (ids.length > 1) useView.getState().selectSlides(ids);
  return ids;
}

/** Deletes slides (the deck keeps at least one). */
export function deleteSlides(ids: readonly string[] = targetSlides()): void {
  if (!canChange() || ids.length === 0) return;
  const state = useDeck.getState();
  const all = deckOrder(state);
  const doomed = ids.filter((id) => state.slides[id]);
  if (doomed.length >= all.length) {
    toast.add({ title: localize('A deck keeps at least one slide', '演示文稿至少保留一张幻灯片') });
    return;
  }
  let sections = sectionsOf(state.index);
  let remaining = all;
  for (const id of doomed) {
    sections = removeSlideFromSections(sections, remaining, id);
    remaining = remaining.filter((x) => x !== id);
  }
  const slides: Record<string, null> = {};
  for (const id of doomed) slides[id] = null;
  const index: DeckIndex = { ...state.index, order: remaining, sections: sectionsMap(reconcileSections(sections, remaining)) };
  if (index.cover && doomed.includes(index.cover)) delete index.cover;
  const view = useView.getState();
  const firstAt = Math.min(...doomed.map((id) => all.indexOf(id)));
  state.apply(doomed.length === 1 ? localize('Delete slide', '删除幻灯片') : localize(`Delete ${doomed.length} slides`, `删除 ${doomed.length} 张幻灯片`), { slides, index });
  if (view.current && doomed.includes(view.current)) view.showSlide(remaining[Math.min(firstAt, remaining.length - 1)] ?? null);
  else view.selectSlides(view.current ? [view.current] : []);
  if (doomed.length > 1) toast.add({ title: localize(`Deleted ${doomed.length} slides`, `已删除 ${doomed.length} 张幻灯片`) });
}

/** Skips (hides) or shows slides when presenting and exporting. */
export function setSlidesHidden(ids: readonly string[], hidden: boolean): void {
  if (!canChange()) return;
  const state = useDeck.getState();
  const slides: Record<string, Slide> = {};
  for (const id of ids) {
    const entry = editableEntry(id);
    if (entry && entry.slide.hidden !== hidden) slides[id] = setHidden(entry.slide, hidden);
  }
  const count = Object.keys(slides).length;
  if (count === 0) return;
  state.apply(hidden ? (count === 1 ? localize('Skip slide', '跳过幻灯片') : localize(`Skip ${count} slides`, `跳过 ${count} 张幻灯片`)) : count === 1 ? localize('Unskip slide', '取消跳过幻灯片') : localize(`Unskip ${count} slides`, `取消跳过 ${count} 张幻灯片`), { slides });
}

/** Makes a slide the deck's cover thumbnail. */
export function setCoverSlide(id: string): void {
  if (!canChange()) return;
  const state = useDeck.getState();
  if (state.index.cover === id) return;
  state.apply(localize('Set cover slide', '设置封面幻灯片'), { index: { ...state.index, cover: id } });
  toast.add({ title: localize('Cover thumbnail set', '已设置封面缩略图') });
}

/** Moves slides to outline gap `gap` (a slide index in the full order, before the move). */
export function moveSlidesToGap(ids: readonly string[], gap: number): void {
  if (!canChange() || ids.length === 0) return;
  const deck = sectioned();
  const moving = deck.order.filter((id) => ids.includes(id));
  const destination = slideMoveDestination(deck, moving, gap);
  let next = moveSlidesToSection(deck, moving, destination.sectionKey, destination.index);
  if (!next) next = { ...deck, order: moveIdsToIndex(deck.order, moving, gap) };
  if (next.order.join() === deck.order.join() && next.sections === deck.sections) return;
  if (applySections(moving.length === 1 ? localize('Move slide', '移动幻灯片') : localize(`Move ${moving.length} slides`, `移动 ${moving.length} 张幻灯片`), next) && moving.length > 1) {
    toast.add({ title: localize(`Moved ${moving.length} slides`, `已移动 ${moving.length} 张幻灯片`) });
  }
}

/** Moves slides into an existing section (null: the opening run) at `index` within it. */
export function moveSlidesIntoSection(ids: readonly string[], sectionKey: string | null, index: number): void {
  const deck = sectioned();
  applySections(ids.length === 1 ? localize('Move slide', '移动幻灯片') : localize(`Move ${ids.length} slides`, `移动 ${ids.length} 张幻灯片`), moveSlidesToSection(deck, deck.order.filter((id) => ids.includes(id)), sectionKey, index));
}

/** Moves the selected slides one place up (-1) or down (+1). */
export function nudgeSlides(delta: -1 | 1, ids: readonly string[] = targetSlides()): void {
  if (ids.length === 0) return;
  const all = order();
  const positions = ids.map((id) => all.indexOf(id)).sort((a, b) => a - b);
  const first = positions[0]!;
  const last = positions[positions.length - 1]!;
  if (delta < 0 && first === 0) return;
  if (delta > 0 && last === all.length - 1) return;
  moveSlidesToGap(ids, delta < 0 ? first - 1 : last + 2);
}

/** Moves slides into a new section of their own. */
export function slidesToNewSection(ids: readonly string[] = targetSlides()): void {
  const deck = sectioned();
  const moving = deck.order.filter((id) => ids.includes(id));
  if (moving.length === 0) return;
  const gap = deck.order.indexOf(moving[0]!);
  if (!applySections(localize('Move to new section', '移到新节'), moveSlidesIntoNewSection(deck, moving, gap))) {
    toast.add({ title: localize(`A deck holds at most ${LIMITS.sections} sections`, `一份演示文稿最多包含 ${LIMITS.sections} 个节`) });
  }
}

/** Starts a section at a slide. */
export function startSectionAt(slideId: string): void {
  if (!applySections(localize('Add section', '添加节'), addSectionAtSlide(sectioned(), slideId))) toast.add({ title: localize('A section already starts here', '此处已有节的起始位置') });
}

/** Adds an empty section at an outline gap. */
export function addSectionAt(gap: number): void {
  if (!applySections(localize('Add section', '添加节'), addSectionAtGap(sectioned(), gap))) toast.add({ title: localize(`A deck holds at most ${LIMITS.sections} sections`, `一份演示文稿最多包含 ${LIMITS.sections} 个节`) });
}

/** Deletes a section (its slides stay where they are). */
export function removeSection(key: string): void {
  applySections(localize('Delete section', '删除节'), deleteSection(sectioned(), key));
}

/** Writes a section's one-sentence description. */
export function setSectionDescription(key: string, text: string): void {
  applySections(localize('Describe section', '编辑节说明'), describeSection(sectioned(), key, text));
}

/**
 * Describes the opening run (the slides before the first section): it
 * becomes a section starting at its first slide, with that description.
 */
export function describeOpeningRun(firstSlideId: string, text: string): void {
  if (!text) return;
  applySections(localize('Describe section', '编辑节说明'), addSectionAtSlide(sectioned(), firstSlideId, text));
}

/** Moves a section and its slides to an outline gap (a gap between rows). */
export function moveSection(key: string, gap: number): void {
  applySections(localize('Move section', '移动节'), moveSectionToGap(sectioned(), key, gap));
}

/** Moves several sections, in their order, to an outline gap. */
export function moveSections(keys: readonly string[], gap: number): void {
  applySections(keys.length > 1 ? localize('Move sections', '移动多个节') : localize('Move section', '移动节'), moveSectionsToGap(sectioned(), keys, gap));
}

/** Shows the slide `delta` places away from the current one. */
export function stepSlide(delta: number): void {
  const all = order();
  const view = useView.getState();
  const at = view.current ? all.indexOf(view.current) : -1;
  const next = all[Math.max(0, Math.min(all.length - 1, at + delta))];
  if (next && next !== view.current) view.showSlide(next);
}

/** Copies a slide's link. */
export function copySlideLink(id: string = useView.getState().current ?? ''): void {
  if (id) maybeSession()?.shell?.copySlideLink(slideHash(id));
}

/* -------------------------------------------------------------------------- */
/* Selection rules                                                             */
/* -------------------------------------------------------------------------- */

/** True when a box only lays out its children (no paint): clicks pass through it. */
export function isLayoutOnly(node: SlideNode): boolean {
  return node.kind === 'box' && !node.group && !boxPaints(node.style);
}

/**
 * The element a click on `hit` selects, given the current selection: the
 * outermost manual group above it (unless the selection is already inside
 * that group), else the innermost selectable element at or above it.
 */
export function selectableFor(slide: Slide, hit: NodePath, selection: readonly NodePath[]): NodePath | null {
  // Outermost group ancestor that is not entered.
  for (let depth = 1; depth <= hit.length; depth++) {
    const prefix = hit.slice(0, depth);
    const node = nodeAt(slide, prefix);
    if (node?.kind === 'box' && node.group && depth < hit.length) {
      const entered = selection.some((p) => isAncestorPath(prefix, p) || (samePath(prefix, p) && false));
      if (!entered) return prefix;
    }
  }
  for (let depth = hit.length; depth >= 1; depth--) {
    const prefix = hit.slice(0, depth);
    const node = nodeAt(slide, prefix);
    if (node && !isLayoutOnly(node)) return prefix;
  }
  return null;
}

/** Every selectable element of a slide in paint order (for Tab and Select all). */
export function selectableElements(slide: Slide, within: NodePath = []): NodePath[] {
  const out: NodePath[] = [];
  walkNodes(slide, (node, path) => {
    if (within.length && !isAncestorPath(within, path)) return;
    if (node.kind === 'box' && node.group) {
      if (path.length > within.length) {
        out.push(path);
        return false;
      }
      return;
    }
    if (!isLayoutOnly(node)) out.push(path);
  });
  return out;
}

/** Selects every element of the current slide (inside the entered group, if any). */
export function selectAll(): void {
  const slide = currentSlide();
  if (!slide) return;
  const view = useView.getState();
  const first = view.selection[0];
  const scope = first && first.length > 1 ? first.slice(0, -1) : [];
  const parent = scope.length ? nodeAt(slide, scope) : undefined;
  const within = parent?.kind === 'box' && parent.group ? scope : [];
  view.select(selectableElements(slide, within).filter((p) => p.length === within.length + 1 || within.length === 0));
}

/** Tab / Shift+Tab: the next or previous element. */
export function cycleSelection(delta: 1 | -1): void {
  const slide = currentSlide();
  if (!slide) return;
  const view = useView.getState();
  const all = selectableElements(slide);
  if (all.length === 0) return;
  const current = view.selection[view.selection.length - 1];
  const at = current ? all.findIndex((p) => samePath(p, current)) : -1;
  const next = all[(at + delta + all.length) % all.length]!;
  view.select([next]);
}

/** Enter: into a group (its first child) or into the text of a text element. */
export function enterSelection(): void {
  const slide = currentSlide();
  const view = useView.getState();
  const path = view.selection[0];
  if (!slide || !path || !view.current) return;
  const node = nodeAt(slide, path);
  if (!node) return;
  if (node.kind === 'box' && node.children.length) {
    view.select([[...path, 0]]);
    return;
  }
  if ((node.kind === 'text' || node.kind === 'list' || node.kind === 'textbox') && editableEntry(view.current)) {
    view.startTextEdit({ slideId: view.current, path });
  } else if (node.kind === 'table' && editableEntry(view.current)) {
    view.startTextEdit({ slideId: view.current, path, cell: [0, 0] });
  }
}

/** Shift+Enter: the parent of the selection (or out of text editing). */
export function exitSelection(): void {
  const view = useView.getState();
  if (view.textEdit) {
    const path = view.textEdit.path;
    view.endTextEdit();
    view.select([path]);
    return;
  }
  const path = view.selection[0];
  if (!path) return;
  view.select(path.length > 1 ? [path.slice(0, -1)] : []);
}

/* -------------------------------------------------------------------------- */
/* Elements                                                                    */
/* -------------------------------------------------------------------------- */

/** The selected paths that still exist on the current slide, in document order. */
export function selectedPaths(): NodePath[] {
  const slide = currentSlide();
  if (!slide) return [];
  return useView
    .getState()
    .selection.filter((p) => nodeAt(slide, p) !== undefined)
    .slice()
    .sort(comparePaths);
}

/** Selected paths without descendants of other selected paths. */
function topmost(paths: readonly NodePath[]): NodePath[] {
  return paths.filter((p) => !paths.some((q) => isAncestorPath(q, p)));
}

/** Deletes the selection. */
export function deleteSelection(): void {
  const paths = topmost(selectedPaths());
  if (paths.length === 0) return;
  if (changeCurrent(paths.length === 1 ? localize('Delete', '删除') : localize(`Delete ${paths.length} elements`, `删除 ${paths.length} 个元素`), (slide) => removeNodes(slide, paths))) {
    useView.getState().select([]);
  }
}

/** ⌘D: duplicates the selection next to itself. */
export function duplicateSelection(): void {
  const paths = topmost(selectedPaths());
  if (paths.length === 0) return;
  const parent = paths[0]!.slice(0, -1);
  const siblings = paths.filter((p) => samePath(p.slice(0, -1), parent));
  let copies: NodePath[] = [];
  if (
    changeCurrent(localize('Duplicate', '复制一份'), (slide) => {
      const result = duplicateNodes(slide, siblings);
      copies = result.paths;
      return result.slide;
    })
  ) {
    useView.getState().select(copies);
  }
}

/** Updates every selected node with `fn`. */
export function updateSelection(label: string, fn: (node: SlideNode, path: NodePath) => SlideNode, options: { coalesce?: string } = {}): boolean {
  const paths = selectedPaths();
  if (paths.length === 0) return false;
  return changeCurrent(
    label,
    (slide) => {
      let next = slide;
      for (const path of paths) next = updateNodeAt(next, path, (node) => fn(node, path));
      return next;
    },
    options,
  );
}

/** Patches the style of the selection, or of the slide when nothing is selected. */
export function patchSelectionStyle(label: string, patch: StylePatch, options: { coalesce?: string; slide?: boolean } = {}): boolean {
  const paths = selectedPaths();
  if (paths.length === 0 || options.slide) return changeCurrent(label, (slide) => patchNodeStyle(slide, [], patch), options);
  return changeCurrent(
    label,
    (slide) => {
      let next = slide;
      for (const path of paths) next = patchNodeStyle(next, path, patch);
      return next;
    },
    options,
  );
}

/** Arrow keys: moves pinned selected elements by (dx, dy) slide px. */
export function nudgeSelection(dx: number, dy: number): void {
  const paths = topmost(selectedPaths());
  const slide = currentSlide();
  if (!slide || paths.length === 0) return;
  const pinned = paths.filter((p) => {
    const node = nodeAt(slide, p);
    return node && isPinned(node) && pinnedRectOf(node);
  });
  if (pinned.length === 0) {
    // Flow elements step through their siblings instead.
    if (paths.length === 1) {
      const path = paths[0]!;
      const delta = dx + dy > 0 ? 1 : -1;
      const index = path[path.length - 1]! + delta;
      const parent = path.slice(0, -1);
      let moved: NodePath | null = null;
      changeCurrent(
        localize('Move', '移动'),
        (s) => {
          const siblings = parent.length ? (nodeAt(s, parent) as Extract<SlideNode, { kind: 'box' }> | undefined)?.children : s.children;
          if (!siblings || index < 0 || index >= siblings.length) return null;
          const result = moveNode(s, path, parent, delta > 0 ? index + 1 : index);
          moved = result.path;
          return result.slide;
        },
        { coalesce: 'nudge' },
      );
      if (moved) useView.getState().select([moved]);
    }
    return;
  }
  changeCurrent(
    localize('Move', '移动'),
    (s) => {
      let next = s;
      for (const path of pinned) {
        next = updateNodeAt(next, path, (node) => {
          const r = pinnedRectOf(node)!;
          return { ...node, style: { ...node.style, left: pxValue(r.x + dx), top: pxValue(r.y + dy) } } as SlideNode;
        });
      }
      return next;
    },
    { coalesce: 'nudge' },
  );
}

/** Z-order: `]` to front, `[` to back (and one step with the modifier). */
export function reorderSelection(move: ZMove): void {
  const paths = topmost(selectedPaths());
  if (paths.length === 0) return;
  const ordered = move === 'front' || move === 'backward' ? paths : [...paths].reverse();
  let next: NodePath[] = [];
  changeCurrent(move === 'front' ? localize('Bring to front', '置于顶层') : move === 'back' ? localize('Send to back', '置于底层') : move === 'forward' ? localize('Bring forward', '上移一层') : localize('Send backward', '下移一层'), (slide) => {
    let s = slide;
    next = [];
    for (const path of ordered) {
      const result = reorderNode(s, path, move);
      s = result.slide;
      next.push(result.path);
    }
    return s;
  });
  if (next.length) useView.getState().select(next);
}

/** ⌘G: groups selected siblings (at most 24) into a manual group. */
export function groupSelection(): void {
  const paths = topmost(selectedPaths());
  if (paths.length < 2) return;
  if (paths.length > LIMITS.group) {
    toast.add({ title: localize(`A group holds at most ${LIMITS.group} elements`, `一个组合最多包含 ${LIMITS.group} 个元素`) });
    return;
  }
  const parent = paths[0]!.slice(0, -1);
  if (!paths.every((p) => samePath(p.slice(0, -1), parent))) {
    toast.add({ title: localize('Only elements side by side in one container can be grouped', '只有同一容器中的同级元素可以组合') });
    return;
  }
  let path: NodePath | null = null;
  changeCurrent(localize('Group', '组合'), (slide) => {
    const result = groupNodes(slide, paths, { group: true });
    if (!result) return null;
    path = result.path;
    return result.slide;
  });
  if (path) useView.getState().select([path]);
}

/** ⇧⌘G: ungroups the selected group(s). */
export function ungroupSelection(): void {
  const slide = currentSlide();
  const paths = topmost(selectedPaths())
    .filter((p) => {
      const node = slide && nodeAt(slide, p);
      return node?.kind === 'box';
    })
    .sort((a, b) => comparePaths(b, a));
  if (!slide || paths.length === 0) return;
  let selected: NodePath[] = [];
  changeCurrent(localize('Ungroup', '取消组合'), (s) => {
    let next = s;
    selected = [];
    for (const path of paths) {
      const result = ungroupNode(next, path);
      next = result.slide;
      selected.push(...result.paths);
    }
    return next;
  });
  useView.getState().select(selected);
}

/** ⌥⌘C: copies the style of the first selected element. */
export function copyStyle(): void {
  const slide = currentSlide();
  const path = selectedPaths()[0];
  const node = slide && path ? nodeAt(slide, path) : undefined;
  if (!node) return;
  const { position: _p, left: _l, top: _t, right: _r, bottom: _b, width: _w, height: _h, ...style } = node.style;
  useView.getState().setStyleClipboard({ style, kind: node.kind });
  toast.add({ title: localize('Style copied', '已复制样式') });
}

/** ⌥⌘V: pastes the copied style onto the selection (position and size stay). */
export function pasteStyle(): void {
  const copied = useView.getState().styleClipboard;
  if (!copied) return;
  updateSelection(localize('Paste style', '粘贴样式'), (node) => {
    const keep = { position: node.style.position, left: node.style.left, top: node.style.top, right: node.style.right, bottom: node.style.bottom, width: node.style.width, height: node.style.height };
    const style = { ...copied.style };
    for (const [key, value] of Object.entries(keep)) if (value !== undefined) (style as Record<string, string>)[key] = value;
    return { ...node, style } as SlideNode;
  });
}

/** K: scales pinned selected elements about their top-left corner. */
export function scaleSelection(factor: number): void {
  if (!(factor > 0) || factor === 1) return;
  updateSelection(localize('Scale', '缩放'), (node) => {
    const r = pinnedRectOf(node);
    if (!r) return node;
    let next = pinNode(node, { x: r.x, y: r.y, w: r.w * factor, h: r.h * factor });
    const size = /^([\d.]+)px$/.exec(node.style['font-size'] ?? '');
    if (size) next = { ...next, style: { ...next.style, 'font-size': pxValue(Number(size[1]) * factor) } } as SlideNode;
    return next;
  });
}

/** An edge or center line elements align on. */
export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Each alignment and its letter: pressed with Alt (⌥) on the stage or in the align popover. */
export const ALIGN_KEYS: Record<AlignEdge, string> = { left: 'A', center: 'H', right: 'D', top: 'W', middle: 'V', bottom: 'S' };

/** The alignment an Alt+letter key event asks for (no other modifier), if any. */
export function alignEdgeForKey(event: { key: string; code: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): AlignEdge | undefined {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return undefined;
  // With Alt held a Mac types a symbol (⌥A is å): read the physical key.
  const letter = /^[a-z]$/i.test(event.key) ? event.key.toUpperCase() : event.code.replace(/^Key/, '');
  return (Object.keys(ALIGN_KEYS) as AlignEdge[]).find((edge) => ALIGN_KEYS[edge] === letter);
}

/** Why the selection cannot be aligned, or undefined when it can. */
export function alignRefusal(nodes: readonly SlideNode[]): string | undefined {
  if (nodes.length === 0) return localize('Select something first', '请先选择元素');
  return nodes.every((node) => pinnedRectOf(node)) ? undefined : localize('Only pinned elements can be aligned', '只有自由摆放的元素可以对齐');
}

/** Aligns pinned selected elements to the slide or to each other. */
export function alignSelection(edge: AlignEdge): void {
  const slide = currentSlide();
  const paths = topmost(selectedPaths());
  if (!slide || paths.length === 0) return;
  const rects = paths.map((p) => {
    const node = nodeAt(slide, p);
    return node ? pinnedRectOf(node) : null;
  });
  if (rects.some((r) => !r)) {
    toast.add({ title: localize('Only pinned elements can be aligned', '只有自由摆放的元素可以对齐') });
    return;
  }
  const list = rects as Rect[];
  const bounds =
    list.length === 1
      ? { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT }
      : (() => {
          const x = Math.min(...list.map((r) => r.x));
          const y = Math.min(...list.map((r) => r.y));
          return { x, y, w: Math.max(...list.map((r) => r.x + r.w)) - x, h: Math.max(...list.map((r) => r.y + r.h)) - y };
        })();
  changeCurrent(localize('Align', '对齐'), (s) => {
    let next = s;
    paths.forEach((path, i) => {
      const r = list[i]!;
      const x = edge === 'left' ? bounds.x : edge === 'center' ? bounds.x + (bounds.w - r.w) / 2 : edge === 'right' ? bounds.x + bounds.w - r.w : r.x;
      const y = edge === 'top' ? bounds.y : edge === 'middle' ? bounds.y + (bounds.h - r.h) / 2 : edge === 'bottom' ? bounds.y + bounds.h - r.h : r.y;
      next = updateNodeAt(next, path, (node) => pinNode(node, { x: round2(x), y: round2(y), w: r.w, h: r.h }));
    });
    return next;
  });
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                      */
/* -------------------------------------------------------------------------- */

/** Why a row or column cannot be added to a table on the current slide, or null. */
export function tableAddRefusal(table: TableNode, what: 'row' | 'column'): string | null {
  if (what === 'row' && table.rows.length >= LIMITS.tableRows) return localize(`A table holds at most ${LIMITS.tableRows} rows`, `表格最多包含 ${LIMITS.tableRows} 行`);
  if (what === 'column' && tableColumns(table) >= LIMITS.tableColumns) return localize(`A table holds at most ${LIMITS.tableColumns} columns`, `表格最多包含 ${LIMITS.tableColumns} 列`);
  const slide = currentSlide();
  const added = what === 'row' ? Math.max(1, tableColumns(table)) : table.rows.length;
  if (slide && countSlideCells(slide) + added > LIMITS.slideCells) return localize(`A slide holds at most ${LIMITS.slideCells} table cells`, `一张幻灯片最多包含 ${LIMITS.slideCells} 个表格单元格`);
  return null;
}

/** Why a row or column cannot be removed from a table, or null (the last one stays). */
export function tableRemoveRefusal(table: TableNode, what: 'row' | 'column'): string | null {
  if (what === 'row') return table.rows.length <= 1 ? localize('A table keeps at least one row', '表格至少保留一行') : null;
  return tableColumns(table) <= 1 ? localize('A table keeps at least one column', '表格至少保留一列') : null;
}

/**
 * Adds or removes a row or column of the table at `path`. `at` is the row or
 * column it happens at (adding inserts before it; the end when omitted;
 * removing takes the last when omitted). With `opened`, the table the menu
 * offering the command was opened on, nothing happens if the table is no
 * longer that one. Says what happened, or why not.
 */
export function editTable(path: NodePath, change: 'addRow' | 'addColumn' | 'removeRow' | 'removeColumn', at?: number, opened?: TableTarget): void {
  // Typing in a cell of this table ends first, and the change waits until
  // the editor has saved, so its text stays in the cell it was typed in.
  const edit = useView.getState().textEdit;
  if (edit?.cell && samePath(edit.path, path)) {
    useView.getState().endTextEdit();
    setTimeout(() => changeTable(path, change, at, opened), 0);
  } else changeTable(path, change, at, opened);
}

function changeTable(path: NodePath, change: 'addRow' | 'addColumn' | 'removeRow' | 'removeColumn', at?: number, opened?: TableTarget): boolean {
  const slide = currentSlide();
  if (opened && !targetTable(useView.getState().current, slide, opened)) {
    toast.add({ title: localize('The table changed while the menu was open, so it was left as it is', '菜单打开期间表格已发生变化，本次操作未应用') });
    return false;
  }
  const node = slide ? nodeAt(slide, path) : undefined;
  if (!node || node.kind !== 'table') return false;
  const what = change === 'addRow' || change === 'removeRow' ? 'row' : 'column';
  const adding = change === 'addRow' || change === 'addColumn';
  const refusal = adding ? tableAddRefusal(node, what) : tableRemoveRefusal(node, what);
  if (refusal) {
    toast.add({ title: refusal });
    return false;
  }
  const rows = node.rows.length;
  const cols = tableColumns(node);
  const label = adding ? (what === 'row' ? localize('Add row', '添加行') : localize('Add column', '添加列')) : what === 'row' ? localize('Remove row', '移除行') : localize('Remove column', '移除列');
  return changeCurrent(label, (s) =>
    updateNodeAt(s, path, (n) => {
      if (n.kind !== 'table') return n;
      switch (change) {
        case 'addRow':
          return insertTableRow(n, at ?? rows);
        case 'addColumn':
          return insertTableColumn(n, at ?? cols);
        case 'removeRow':
          return removeTableRow(n, at ?? rows - 1);
        case 'removeColumn':
          return removeTableColumn(n, at ?? cols - 1);
      }
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Inserting                                                                   */
/* -------------------------------------------------------------------------- */

/** A rect of size (w, h) centered on the slide, cascaded by `n` steps. */
export function centeredRect(w: number, h: number, n = 0): Rect {
  return { x: round2((SLIDE_WIDTH - w) / 2 + n * 32), y: round2((SLIDE_HEIGHT - h) / 2 + n * 32), w, h };
}

/**
 * Adds pinned nodes to the current slide (on top of everything) and selects
 * them. Returns their paths.
 */
export function insertPinned(label: string, nodes: readonly SlideNode[], options: { select?: boolean } = {}): NodePath[] {
  const slide = currentSlide();
  if (!slide || nodes.length === 0) return [];
  const pinnedCount = slide.children.filter(isPinned).length;
  if (pinnedCount + nodes.length > LIMITS.pinnedPerHost) {
    toast.add({ title: localize(`A slide holds at most ${LIMITS.pinnedPerHost} pinned elements`, `一张幻灯片最多可包含 ${LIMITS.pinnedPerHost} 个自由摆放的元素`), description: localize('Group some of them first.', '请先将部分元素组合起来。') });
    return [];
  }
  const taken = slideElementIds(slide);
  const copies = nodes.map((n) => cloneNode(n, taken));
  const at = slide.children.length;
  if (!changeCurrent(label, (s) => insertNodes(s, [], at, copies))) return [];
  const paths = copies.map((_, i) => [at + i]);
  if (options.select !== false) useView.getState().select(paths);
  return paths;
}

/** Adds a text box at `rect` and starts typing in it. */
export function insertTextBox(rect: Rect = centeredRect(800, 120)): void {
  const id = useView.getState().current;
  const [path] = insertPinned(localize('Add text', '添加文本'), [newTextBox(rect, DEFAULT_TEXT, { 'font-size': '48px' })]);
  if (path && id) useView.getState().startTextEdit({ slideId: id, path });
}

/** Adds a table. */
export function insertTable(rows = 3, cols = 3, rect?: Rect): void {
  const height = rows * 72;
  insertPinned(localize('Add table', '添加表格'), [newTable(rect ?? centeredRect(Math.min(1664, cols * 320), height), rows, cols, 'Column')]);
}

/** Shapes the Insert menu and the drawing tools add. */
export type InsertShapeKind = ShapeKind | 'connector';

/** Saturated colors are accent candidates (not greys, not near-white, not near-black). */
function isAccent(color: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min > 60 && max > 60 && min < 230;
}

/** The deck's accent: its most used saturated color (falls back to a blue). */
export function deckAccent(): string {
  const counts = new Map<string, number>();
  const add = (value: string | undefined): void => {
    if (!value) return;
    for (const match of value.matchAll(/#[0-9a-f]{6}\b/gi)) {
      const color = match[0].toLowerCase();
      if (isAccent(color)) counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  };
  for (const entry of Object.values(useDeck.getState().slides)) {
    walkNodes(entry.slide, (node) => {
      add(node.style.background);
      add(node.style.color);
      add(node.style.border);
    });
  }
  let best = '#2563eb';
  let most = 0;
  for (const [color, n] of counts) {
    if (n > most) {
      best = color;
      most = n;
    }
  }
  return best;
}

/** A new shape (or connector) filling `rect`. */
export function newShape(kind: InsertShapeKind, rect: Rect): SlideNode {
  if (kind === 'connector') {
    const px = (value: number) => ({ value: round2(value), unit: 'px' as const });
    return {
      kind: 'connector',
      style: { color: deckAccent() },
      points: { x1: px(rect.x), y1: px(rect.y + rect.h / 2), x2: px(rect.x + rect.w), y2: px(rect.y + rect.h / 2) },
      headStart: 'none',
      headEnd: 'filled',
      route: 'straight',
    };
  }
  const style: StylePatch = kind === 'line' ? { border: '4px solid #1a1a1a' } : { background: deckAccent() };
  return pinNode({ kind: 'shape', shape: kind, style: style as SlideNode['style'] }, rect);
}

/** Adds a shape centered on the slide (or at `rect`, from a drawing tool). */
export function insertShape(kind: InsertShapeKind, rect?: Rect): void {
  const line = kind === 'line' || kind === 'connector';
  const box = rect ?? centeredRect(line ? 480 : 300, line ? 16 : 300);
  insertPinned(kind === 'connector' ? localize('Add connector', '添加连接线') : localize('Add shape', '添加形状'), [newShape(kind, box)]);
}

/** Adds an icon. */
export function insertIcon(name: IconName = 'Lightbulb', rect: Rect = centeredRect(160, 160)): void {
  insertPinned(localize('Add icon', '添加图标'), [pinNode({ kind: 'icon', name, style: { color: deckAccent() } }, rect)]);
}

/** Wraps flow elements into pinned ones at measured rects (dragging out of the flow). */
export function pinAt(slide: Slide, paths: readonly NodePath[], rects: readonly Rect[]): { slide: Slide; paths: NodePath[] } {
  // Pinned elements live at the section level, on top.
  const nodes = paths.map((p, i) => pinNode(nodeAt(slide, p)!, rects[i]!));
  let next = removeNodes(slide, paths);
  const at = next.children.length;
  next = insertNodes(next, [], at, nodes);
  return { slide: next, paths: nodes.map((_, i) => [at + i]) };
}

/** Undo with the conflict warning protocol (warn first; a second undo runs). */
export function undo(): void {
  const view = useView.getState();
  if (view.textEdit) view.endTextEdit();
  const outcome = useDeck.getState().undoStep();
  if (!outcome.done && outcome.warning) toast.add({ title: outcome.warning });
  if (outcome.done && outcome.focus && outcome.focus !== view.current && useDeck.getState().slides[outcome.focus]) view.showSlide(outcome.focus, { keepSelection: false });
}

/** Redo, same protocol. */
export function redo(): void {
  const view = useView.getState();
  if (view.textEdit) view.endTextEdit();
  const outcome = useDeck.getState().redoStep();
  if (!outcome.done && outcome.warning) toast.add({ title: outcome.warning });
  if (outcome.done && outcome.focus && outcome.focus !== view.current && useDeck.getState().slides[outcome.focus]) view.showSlide(outcome.focus, { keepSelection: false });
}
