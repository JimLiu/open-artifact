/**
 * Grouping (⌘G), ungrouping (⇧⌘G) and moving layers to another parent in
 * the outline, keeping what moves where it is on screen.
 *
 * Each measures the elements against the box they will sit in before the
 * change (`BoardApi.measure`), then makes the change and writes their
 * layout back (`lib/layout-write-back.ts`), as one undo step.
 */

import { attributeValue, elementChildren, elementPath, resolveElement, styleMap, type HtmlElement, type MeasuredBox, type StylePatch, type TemplateModel } from '@open-artifact/dc';
import { toast } from '@open-artifact/ui';
import {
  GROUP_REFUSALS,
  MOVE_UNMEASURED,
  UNGROUP_REFUSALS,
  flowGroupStyle,
  isImportTag,
  isTablePart,
  liftedOnUngroup,
  positionedGroup,
  staysByPosition,
  writeBackPatch,
  type FlexLayout,
  type MeasuredElement,
} from '../lib/layout-write-back.ts';
import type { Address, BoardOp } from '../lib/ops.ts';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { templateOf } from './agent.ts';
import { announce } from './announce.ts';
import { edit, selectedElements, tryEdit } from './commands.ts';
import { boardApi } from './frames.ts';
import { refuseLocked } from './locks.ts';

const isPositioned = (position: string | undefined): boolean => position === 'absolute' || position === 'fixed';
const isWrapper = (element: HtmlElement): boolean => element.tag === 'sc-if' || element.tag === 'sc-for';
const addressOf = (model: TemplateModel, element: HtmlElement): Address => ({ tid: model.tidOf.get(element)!, path: elementPath(model, element) });

/** True when an element sits in a repeated template (its rows follow the data). */
function isRepeated(element: HtmlElement): boolean {
  for (let up = element.parent; up; up = up.parent) if (up.tag === 'sc-for') return true;
  return false;
}

/** The element a box is placed against: the nearest positioned one from `from` up, `null` for the artboard. */
function containingBlock(board: string, model: TemplateModel, from: HtmlElement | null): number | null {
  const api = boardApi(board);
  for (let up = from; up; up = up.parent) {
    if (isWrapper(up)) continue;
    const tid = model.tidOf.get(up)!;
    const position = api?.inspect(tid)?.computed.position;
    if (position && position !== 'static') return tid;
  }
  return null;
}

/** Text styles an element placed in `parent` would inherit (`null` for the artboard: nothing to compare). */
function inheritedIn(board: string, model: TemplateModel, parent: HtmlElement | null): Record<string, string> | null {
  for (let up = parent; up; up = up.parent) {
    if (isWrapper(up)) continue;
    return boardApi(board)?.inspect(model.tidOf.get(up)!)?.computed ?? null;
  }
  return null;
}

const measured = (element: HtmlElement, box: MeasuredBox): MeasuredElement => ({
  tag: element.tag,
  inline: styleMap(attributeValue(element, 'style') ?? ''),
  box: { left: box.left, top: box.top, width: box.width, height: box.height },
  computed: box.computed,
  ...(box.there ? { there: box.there } : {}),
});

/** The tid of the element that lays out what is placed in `parent` (`null` for the artboard). */
const layoutTid = (model: TemplateModel, parent: HtmlElement | null): number | null => {
  const up = layoutParent(parent);
  return up ? model.tidOf.get(up)! : null;
};

/**
 * What an element is measured and written back as: an `sc-if` as the one
 * element it shows (`null` while it shows nothing, or more than one), an
 * `sc-for` not at all, anything else as itself.
 */
function shownAs(board: string, model: TemplateModel, element: HtmlElement): HtmlElement | null {
  if (element.tag === 'sc-for' || element.tag === 'helmet') return null;
  if (element.tag !== 'sc-if') return element;
  const inner = elementChildren(element).filter((child) => child.tag !== 'helmet');
  if (inner.length !== 1 || isWrapper(inner[0]!)) return null;
  return boardApi(board)?.inspect(model.tidOf.get(inner[0]!)!) ? inner[0]! : null;
}

/** Applies per-element style patches as one edit (no edit when there are none). */
function writeBack(board: string, edits: { target: Address; patch: StylePatch }[]): boolean {
  if (!edits.length) return true;
  return tryEdit(board, { kind: 'styles', edits }).kind === 'done';
}

/* -------------------------------------------------------------------------- */
/* Group                                                                       */
/* -------------------------------------------------------------------------- */

/** The flex layout of a parent, when it lays out its children in a row or column. */
function flexOf(board: string, model: TemplateModel, parent: HtmlElement | null): FlexLayout | null {
  if (!parent) return null;
  const computed = boardApi(board)?.inspect(model.tidOf.get(parent)!)?.computed;
  if (!computed || (computed.display !== 'flex' && computed.display !== 'inline-flex')) return null;
  return { 'flex-direction': computed['flex-direction'], gap: computed.gap, 'justify-content': computed['justify-content'], 'align-items': computed['align-items'] };
}

/** Why the selected elements can't form a group, or `null`. */
function groupRefusal(board: string, model: TemplateModel, elements: readonly HtmlElement[]): string | null {
  const api = boardApi(board);
  if (!api) return GROUP_REFUSALS.unmeasured;
  for (const element of elements) {
    if (element.tag === 'helmet' || isWrapper(element) || isRepeated(element)) return GROUP_REFUSALS.here;
    let inSvg = false;
    for (let up = element.parent; up; up = up.parent) if (up.tag === 'svg') inSvg = true;
    if (inSvg) return GROUP_REFUSALS.here;
    const computed = api.inspect(model.tidOf.get(element)!)?.computed;
    if (!computed) return GROUP_REFUSALS.unmeasured;
    if (isTablePart(element.tag, computed.display)) return GROUP_REFUSALS.tableParts;
    if (computed.position === 'fixed') return GROUP_REFUSALS.fixed;
  }
  return null;
}

/**
 * Groups the selected elements (⌘G). Members of one flex parent get a
 * group laid out the same way; positioned members get a positioned group
 * around them and keep their place on screen.
 */
export function groupSelection(): void {
  if (useDocument.getState().readOnly) return;
  const { selection } = useView.getState();
  if (selection.kind === 'mixed') {
    toast.add({ title: GROUP_REFUSALS.here });
    return;
  }
  const selected = selectedElements();
  if (!selected) return;
  const { board, model, elements } = selected;
  const refusal = groupRefusal(board, model, elements);
  if (refusal) {
    toast.add({ title: refusal });
    return;
  }
  const api = boardApi(board)!;
  const parents = new Set(elements.map((element) => element.parent));
  const positioned = elements.some((element) => isPositioned(api.inspect(model.tidOf.get(element)!)?.computed.position));
  const last = elements[elements.length - 1]!;
  if (!positioned && parents.size === 1) {
    const style = flowGroupStyle(flexOf(board, model, last.parent));
    const op: BoardOp = { kind: 'wrap', targets: elements.map((element) => addressOf(model, element)), open: `<div data-dc-group style="${style}">`, close: '</div>' };
    finishGroup(board, () => tryEdit(board, op));
    return;
  }
  if (!positioned) {
    finishGroup(board, () => gather(board, elements.map((element) => model.tidOf.get(element)!), `<div data-dc-group style="${flowGroupStyle(null)}">`));
    return;
  }
  // A positioned group: measured against the box it will be placed in.
  const tids = elements.map((element) => model.tidOf.get(element)!);
  const boxes = api.measure(tids, containingBlock(board, model, last.parent), { parent: layoutTid(model, last.parent), wrap: true });
  if (!boxes) {
    toast.add({ title: GROUP_REFUSALS.unmeasured });
    return;
  }
  if (boxes.some((box) => box.transformed)) {
    toast.add({ title: GROUP_REFUSALS.transformed });
    return;
  }
  const plan = positionedGroup(elements.map((element, i) => measured(element, boxes[i]!)));
  if (!plan) {
    toast.add({ title: GROUP_REFUSALS.here });
    return;
  }
  finishGroup(board, () => {
    if (!writeBack(board, elements.map((element, i) => ({ target: addressOf(model, element), patch: plan.members[i]! })))) return { kind: 'failed' as const };
    return gather(board, tids, `<div data-dc-group style="${plan.style}">`);
  });
}

/**
 * Moves elements (by tid, in document order) into a new group put where
 * the last of them was.
 */
function gather(board: string, tids: readonly number[], open: string): ReturnType<typeof tryEdit> {
  const source = useDocument.getState().boards[board]?.source;
  if (!source) return { kind: 'failed' };
  const model = templateOf(source);
  const elements = tids.map((tid) => model.elements[tid]).filter((element): element is HtmlElement => Boolean(element));
  if (elements.length !== tids.length) return { kind: 'failed' };
  const inner = elements.map((element) => model.text.slice(element.start, element.end)).join('\n');
  const edits = elements.map((element, i) => ({ target: addressOf(model, element), html: i === elements.length - 1 ? `${open}\n${inner}\n</div>` : '' }));
  return tryEdit(board, { kind: 'replace', edits });
}

/** Runs the edits of a group as one undo step and selects the group, or says why nothing changed. */
function finishGroup(board: string, run: () => ReturnType<typeof tryEdit>): void {
  const outcome = useDocument.getState().transact((cancel) => {
    const result = run();
    // A failed second edit must not leave the first behind.
    if (result.kind !== 'done') cancel();
    return result;
  });
  if (outcome.kind !== 'done') {
    if (outcome.kind === 'locked') refuseLocked();
    else toast.add({ title: GROUP_REFUSALS.here });
    return;
  }
  const source = useDocument.getState().boards[board]?.source;
  const model = source ? templateOf(source) : null;
  const group = model?.elements.find((element) => attributeValue(element, 'data-dc-group') !== undefined && outcome.created.some((address) => address.tid === model.tidOf.get(element)));
  if (model && group) useView.getState().select({ kind: 'elements', board, items: [{ ...addressOf(model, group), instance: 0 }] });
  announce('Grouped');
}

/* -------------------------------------------------------------------------- */
/* Ungroup                                                                     */
/* -------------------------------------------------------------------------- */

/** Why an element can't be ungrouped, or `null`. */
function ungroupRefusal(element: HtmlElement): string | null {
  if (isImportTag(element.tag)) return UNGROUP_REFUSALS.instance;
  if (attributeValue(element, 'data-uneditable') !== undefined) return UNGROUP_REFUSALS.managed;
  for (let up: HtmlElement | null = element; up; up = up.parent) if (up.tag === 'svg') return UNGROUP_REFUSALS.drawing;
  const group = attributeValue(element, 'data-dc-group') !== undefined;
  if (isWrapper(element) || (!group && isRepeated(element))) return UNGROUP_REFUSALS.data;
  if (group) return null;
  const ownWords = element.children.some((node) => node.type === 'text' && node.value.trim() !== '');
  if (!elementChildren(element).length || ownWords || element.tag === 'a') return UNGROUP_REFUSALS.nothing;
  return null;
}

/**
 * Ungroups the selected groups (⇧⌘G): each one's children take its place
 * and stay where they are on screen; they are selected afterwards.
 */
export function ungroupSelection(): void {
  if (useDocument.getState().readOnly) return;
  const selected = selectedElements();
  if (!selected) {
    if (useView.getState().selection.kind === 'mixed') toast.add({ title: UNGROUP_REFUSALS.nothing });
    return;
  }
  const { board, model, elements } = selected;
  for (const element of elements) {
    const refusal = ungroupRefusal(element);
    if (refusal) {
      toast.add({ title: refusal });
      return;
    }
  }
  const api = boardApi(board);
  if (!api) {
    toast.add({ title: UNGROUP_REFUSALS.unmeasured });
    return;
  }
  const edits: { target: Address; patch: StylePatch }[] = [];
  const childTids: number[] = [];
  for (const group of elements) {
    // A conditional child is measured and kept in place as the element it shows.
    const own = elementChildren(group).filter((child) => child.tag !== 'helmet');
    const children = own.flatMap((child) => shownAs(board, model, child) ?? []);
    childTids.push(...elementChildren(group).map((child) => model.tidOf.get(child)!));
    if (!children.length) continue;
    const boxes = api.measure(children.map((child) => model.tidOf.get(child)!), containingBlock(board, model, group.parent), { parent: layoutTid(model, group.parent) });
    if (!boxes) {
      toast.add({ title: UNGROUP_REFUSALS.unmeasured });
      return;
    }
    const inherited = inheritedIn(board, model, group.parent);
    // Positioned children stay where they were; flowing ones are lifted out only from an absolute
    // or fixed group whose children can all leave the flow, and then all of them or none.
    const lifted = liftedOnUngroup(
      { position: api.inspect(model.tidOf.get(group)!)?.computed.position ?? 'static', blocked: children.length < own.length },
      children.map((child, i) => ({ tag: child.tag, position: boxes[i]!.computed.position ?? 'static', display: boxes[i]!.computed.display ?? '', repeated: isRepeated(child) })),
    );
    const flowing: { target: Address; patch: StylePatch }[] = [];
    let flowFits = true;
    children.forEach((child, i) => {
      if (!lifted[i]) return;
      const box = boxes[i]!;
      const patch = writeBackPatch(measured(child, box), inherited);
      if (isPositioned(box.computed.position)) {
        if (patch) edits.push({ target: addressOf(model, child), patch });
      } else if (patch) flowing.push({ target: addressOf(model, child), patch });
      else flowFits = false;
    });
    if (flowFits) edits.push(...flowing);
  }
  const groupTids = elements.map((element) => model.tidOf.get(element)!);
  const done = useDocument.getState().transact((cancel) => {
    const unwrapped = (() => {
      if (!writeBack(board, edits)) return false;
      // Later groups first: unwrapping one renumbers only what follows it.
      for (const tid of [...groupTids].sort((a, b) => b - a)) {
        const current = templateOf(useDocument.getState().boards[board]!.source!);
        const element = current.elements[tid];
        if (!element || tryEdit(board, { kind: 'unwrap', target: addressOf(current, element) }).kind !== 'done') return false;
      }
      return true;
    })();
    if (!unwrapped) cancel();
    return unwrapped;
  });
  if (!done) {
    toast.add({ title: UNGROUP_REFUSALS.unmeasured });
    return;
  }
  // Each child moves up past the groups before it that went.
  const after = templateOf(useDocument.getState().boards[board]!.source!);
  const items = childTids
    .map((tid) => after.elements[tid - groupTids.filter((group) => group < tid).length])
    .filter((element): element is HtmlElement => Boolean(element))
    .map((element) => ({ ...addressOf(after, element), instance: 0 }));
  if (items.length) useView.getState().select({ kind: 'elements', board, items });
  announce('Ungrouped');
}

/** What decides whether a flow element placed in `parent` leaves the flow to stay put. */
function containerFacts(board: string, model: TemplateModel, parent: HtmlElement | null, moving: readonly HtmlElement[]) {
  const api = boardApi(board);
  const computed = parent ? api?.inspect(model.tidOf.get(parent)!)?.computed : undefined;
  const siblings = parent ? elementChildren(parent) : elementChildren(model.nodes);
  const others = siblings
    .filter((child) => !moving.includes(child) && !isWrapper(child) && child.tag !== 'helmet')
    .map((child) => api?.inspect(model.tidOf.get(child)!)?.computed.position ?? 'static');
  return {
    display: parent ? (computed?.display ?? '') : 'block',
    positioned: isPositioned(computed?.position),
    root: !parent,
    others,
  };
}

/* -------------------------------------------------------------------------- */
/* Moving to another parent                                                    */
/* -------------------------------------------------------------------------- */

/** The parent that lays an element out: its parent, past `sc-if` / `sc-for`. */
function layoutParent(parent: HtmlElement | null): HtmlElement | null {
  let up = parent;
  while (up && isWrapper(up)) up = up.parent;
  return up;
}

/**
 * Moves layers (an outline drag) and selects them. When their laying-out
 * parent changes, positioned ones keep their place on screen, and flow
 * ones dropped into a free container become positioned where they were.
 */
export function moveLayers(board: string, op: Extract<BoardOp, { kind: 'move' }>): boolean {
  const source = useDocument.getState().boards[board]?.source;
  const api = boardApi(board);
  if (!source) return false;
  const model = templateOf(source);
  const elements = op.targets.map((target) => resolveElement(model, target.tid, target.path)).filter((element): element is HtmlElement => Boolean(element));
  const target = resolveElement(model, op.target.tid, op.target.path);
  if (!target || elements.length !== op.targets.length) return false;
  const into = op.position === 'last-child' || op.position === 'first-child';
  const newParent = into ? target : target.parent;
  const newLayout = into && !isWrapper(target) ? target : layoutParent(newParent);
  const same = elements.every((element) => layoutParent(element.parent) === newLayout);
  if (same || (newLayout && isImportTag(newLayout.tag))) return edit(board, op, { selectCreated: true });
  // A conditional layer is measured and kept in place as the element it shows.
  const movable = elements.flatMap((element) => {
    const shown = shownAs(board, model, element);
    return shown ? [{ element, shown }] : [];
  });
  const tids = movable.map(({ shown }) => model.tidOf.get(shown)!);
  const boxes = api && movable.length ? api.measure(tids, containingBlock(board, model, newLayout), { parent: newLayout ? model.tidOf.get(newLayout)! : null }) : movable.length ? null : [];
  if (!boxes) {
    toast.add({ title: MOVE_UNMEASURED });
    return false;
  }
  const container = containerFacts(board, model, newLayout, elements);
  const inherited = inheritedIn(board, model, newLayout);
  const patches = new Map<number, StylePatch>();
  movable.forEach(({ element, shown }, i) => {
    const box = boxes[i]!;
    const stays = isPositioned(box.computed.position) || staysByPosition({ tag: shown.tag, display: box.computed.display ?? '', repeated: isRepeated(element) }, container);
    const patch = stays ? writeBackPatch(measured(shown, box), inherited) : null;
    if (patch) patches.set(op.targets.indexOf(op.targets.find((address) => address.tid === model.tidOf.get(element))!), patch);
  });
  const moved = useDocument.getState().transact((cancel) => {
    const outcome = tryEdit(board, op);
    if (outcome.kind !== 'done') return outcome;
    const after = templateOf(useDocument.getState().boards[board]!.source!);
    // A moved conditional layer takes its patch on the element it shows.
    const writtenOn = (address: Address): Address => {
      const element = resolveElement(after, address.tid, address.path);
      const inner = element?.tag === 'sc-if' ? elementChildren(element).filter((child) => child.tag !== 'helmet')[0] : undefined;
      return inner ? addressOf(after, inner) : address;
    };
    const edits = [...patches].flatMap(([index, patch]) => (outcome.created[index] ? [{ target: writtenOn(outcome.created[index]!), patch }] : []));
    if (writeBack(board, edits)) return outcome;
    cancel();
    return { kind: 'failed' as const };
  });
  if (moved.kind !== 'done') {
    if (moved.kind === 'locked') refuseLocked();
    else toast.add({ title: MOVE_UNMEASURED });
    return false;
  }
  if (moved.created.length) useView.getState().select({ kind: 'elements', board, items: moved.created.map((address) => ({ ...address, instance: 0 })) });
  return true;
}
