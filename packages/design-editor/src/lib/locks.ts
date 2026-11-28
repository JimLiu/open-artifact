/**
 * Locked layers.
 *
 * An element is locked by a `data-locked` attribute in the artboard source
 * (`data-locked="true"`; a bare `data-locked` counts too). Unlocking removes
 * the attribute. Artboards and notes are locked in canvas.json instead
 * (design-core `locks.ts`).
 *
 * A locked element stays where it is: edits that would move, resize,
 * delete or restructure it are refused, and edits that mix placement with
 * other properties keep only the other properties. Its words, colours and
 * other looks can still change, and other elements can still go into it.
 * Copies never carry a lock.
 */

import { applySplices, attributeValue, parseStyle, parseTemplate, resolveElement, serializeStyle, setAttribute, type HtmlElement, type Splice, type StylePatch, type TemplateModel } from '@open-artifact/dc';
import type { Address, BoardOp } from './ops.ts';

/** The attribute that locks an element. */
export const LOCK_ATTRIBUTE = 'data-locked';

/** Toast when an edit is refused because something is locked. */
export const LOCKED_MESSAGE = 'Locked: unlock first.';
/** Why a control is disabled because the selection is locked. */
export const LOCKED_REASON = 'Locked: unlock first';
/** Toast when nothing selected can be locked. */
export const UNLOCKABLE_MESSAGE = 'This can’t be locked.';
/** Why Lock is disabled when nothing selected can be locked. */
export const UNLOCKABLE_REASON = 'This can’t be locked';

/**
 * Why Delete is disabled by locks, or `null`. Canvas objects (artboards,
 * notes) and mixed selections block it only when every one selected is
 * locked: the unlocked ones are deleted and the locked ones stay. Among
 * the elements of one artboard any locked one blocks it.
 */
export function deleteLockReason(kind: 'objects' | 'elements' | 'mixed', lock: { lockable: number; locked: number }): string | null {
  if (!lock.locked) return null;
  if (kind === 'elements') return LOCKED_REASON;
  return lock.locked >= lock.lockable ? LOCKED_REASON : null;
}

/** Elements that render no box of their own: a lock on them means nothing. */
const NEVER_LOCKED = new Set(['dc-import', 'x-import', 'sc-if', 'sc-for']);

/**
 * How an element's own marker reads: `fixed` for elements that can't be
 * locked, and for a `data-locked` the author set to another value (it is
 * left alone).
 */
export type LockMark = 'locked' | 'unlocked' | 'fixed';

export function lockMark(element: HtmlElement): LockMark {
  if (NEVER_LOCKED.has(element.tag)) return 'fixed';
  const value = attributeValue(element, LOCK_ATTRIBUTE);
  if (value === undefined) return 'unlocked';
  return value === '' || value.toLowerCase() === 'true' ? 'locked' : 'fixed';
}

/** The `<svg>` elements an element draws inside, nearest first (none past a `<foreignObject>`). */
function svgAncestors(element: HtmlElement): HtmlElement[] {
  const out: HtmlElement[] = [];
  for (let up = element.parent; up && up.tag !== 'foreignobject'; up = up.parent) if (up.tag === 'svg') out.push(up);
  return out;
}

/** True when the element is locked, by its own marker or by the `<svg>` it is drawn in. */
export function isElementLocked(element: HtmlElement): boolean {
  return lockMark(element) === 'locked' || svgAncestors(element).some((svg) => lockMark(svg) === 'locked');
}

const lockedCache = new WeakMap<TemplateModel, number[]>();

/** Template ids of every locked element (hover and clicks pass through them). */
export function lockedTids(model: TemplateModel): number[] {
  let tids = lockedCache.get(model);
  if (!tids) {
    tids = model.elements.flatMap((element) => (isElementLocked(element) ? [model.tidOf.get(element)!] : []));
    lockedCache.set(model, tids);
  }
  return tids;
}

/** True when the element can take a lock. */
export function isLockable(element: HtmlElement): boolean {
  return lockMark(element) !== 'fixed';
}

/** What a lock toggle does to a set of states: lock all unless every one is locked; `null` for none. */
export function nextLockState(locked: readonly boolean[]): boolean | null {
  if (!locked.length) return null;
  return !locked.every(Boolean);
}

/**
 * Splices that lock or unlock elements. Locking marks each one not locked
 * yet; unlocking removes the marker from each, from any `<svg>` locking it,
 * and from everything inside an `<svg>` it unlocks.
 */
export function lockSplices(model: TemplateModel, elements: readonly HtmlElement[], locked: boolean): Splice[] {
  const touched = new Set<HtmlElement>();
  for (const element of elements) {
    if (!isLockable(element)) continue;
    if (locked) {
      if (!isElementLocked(element)) touched.add(element);
      continue;
    }
    const svgs = svgAncestors(element).filter((svg) => lockMark(svg) === 'locked');
    for (const each of [element, ...svgs]) {
      if (lockMark(each) === 'locked') touched.add(each);
      if (each.tag === 'svg') for (const inner of model.elements) if (inner !== each && each.start <= inner.start && inner.end <= each.end && lockMark(inner) === 'locked') touched.add(inner);
    }
  }
  return [...touched].flatMap((element) => setAttribute(model, element, LOCK_ATTRIBUTE, locked ? 'true' : null));
}

/** Markup with every lock marker removed (what copies and pastes insert). */
export function withoutLocks(html: string): string {
  if (!html.toLowerCase().includes(LOCK_ATTRIBUTE)) return html;
  const model = parseTemplate(html);
  const splices = model.elements.filter((element) => lockMark(element) === 'locked' || (NEVER_LOCKED.has(element.tag) && attributeValue(element, LOCK_ATTRIBUTE) !== undefined)).flatMap((element) => setAttribute(model, element, LOCK_ATTRIBUTE, null));
  return splices.length ? applySplices(model.text, splices) : html;
}

/* ------------------------------- placement ------------------------------- */

/** CSS properties that place or size an element, with their longhands (`margin-top`, `min-width`, `grid-row-start`…). */
const PLACEMENT_FAMILIES = [
  'position', 'left', 'top', 'right', 'bottom', 'inset', 'width', 'height', 'inline-size', 'block-size', 'min', 'max', 'margin',
  'aspect-ratio', 'box-sizing', 'float', 'zoom', 'transform', 'rotate', 'scale', 'translate', 'z-index', 'order',
  'align-self', 'justify-self', 'place-self', 'object-fit', 'object-position', 'object-view-box', 'grid-column', 'grid-row', 'grid-area',
];
/** Flex item sizing (the `flex-direction` family lays out children, so it is not here). */
const PLACEMENT_EXACT = new Set(['flex', 'flex-grow', 'flex-shrink', 'flex-basis']);
/** Attributes that place or size an element (SVG geometry and the replaced-element size). */
const PLACEMENT_ATTRIBUTES = new Set(['width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'viewbox', 'transform']);

/** True for a CSS property that places or sizes an element. */
export function isPlacementProperty(property: string): boolean {
  const name = property.trim().toLowerCase().replace(/^-webkit-/, '');
  return PLACEMENT_EXACT.has(name) || PLACEMENT_FAMILIES.some((family) => name === family || name.startsWith(`${family}-`));
}

/** True for an attribute that places or sizes an element. */
export function isPlacementAttribute(name: string): boolean {
  return PLACEMENT_ATTRIBUTES.has(name.toLowerCase());
}

/** A style patch without its placement properties, and which ones were dropped. */
export function withoutPlacement(patch: StylePatch): { patch: StylePatch; dropped: string[] } {
  const kept: Record<string, string | null> = {};
  const dropped: string[] = [];
  for (const [property, value] of Object.entries(patch)) {
    if (isPlacementProperty(property)) dropped.push(property);
    else kept[property] = value;
  }
  return { patch: kept, dropped };
}

/* -------------------------------- edits ---------------------------------- */

/**
 * What locks make of an edit: `free` when none applies, `trimmed` with the
 * edit minus placement on locked elements, `refused` when nothing of it may
 * go through. Targets that don't resolve are left to the edit itself.
 */
export type LockVerdict = { kind: 'free' } | { kind: 'trimmed'; op: BoardOp } | { kind: 'refused' };

const FREE: LockVerdict = { kind: 'free' };
const REFUSED: LockVerdict = { kind: 'refused' };

export function lockVerdict(model: TemplateModel, op: BoardOp): LockVerdict {
  const locked = (address: Address | null): boolean => {
    const element = address ? resolveElement(model, address.tid, address.path) : null;
    return Boolean(element && isElementLocked(element));
  };
  switch (op.kind) {
    case 'style':
    case 'styles': {
      const edits = op.kind === 'style' ? op.targets.map((target) => ({ target, patch: op.patch })) : op.edits;
      let changed = false;
      const kept: { target: Address; patch: StylePatch }[] = [];
      for (const entry of edits) {
        if (!locked(entry.target)) {
          kept.push(entry);
          continue;
        }
        const { patch, dropped } = withoutPlacement(entry.patch);
        if (!dropped.length) {
          kept.push(entry);
          continue;
        }
        changed = true;
        if (Object.keys(patch).length) kept.push({ target: entry.target, patch });
      }
      if (!changed) return FREE;
      return kept.length ? { kind: 'trimmed', op: { kind: 'styles', edits: kept } } : REFUSED;
    }
    case 'attr': {
      if (!locked(op.target)) return FREE;
      if (op.name.toLowerCase() !== 'style') return isPlacementAttribute(op.name) ? REFUSED : FREE;
      // A whole new style (the Code tab): its placement stays as it was.
      const before = parseStyle(attributeValue(resolveElement(model, op.target.tid, op.target.path)!, 'style') ?? '');
      const after = parseStyle(op.value ?? '');
      const placed = (list: typeof before, keep: boolean) => serializeStyle(list.filter((d) => isPlacementProperty(d.property) === keep));
      if (placed(before, true) === placed(after, true)) return FREE;
      if (placed(before, false) === placed(after, false)) return REFUSED;
      const value = serializeStyle([...after.filter((d) => !isPlacementProperty(d.property)), ...before.filter((d) => isPlacementProperty(d.property))]);
      return { kind: 'trimmed', op: { ...op, value: value || null } };
    }
    case 'remove':
    case 'wrap':
      return op.targets.some(locked) ? REFUSED : FREE;
    case 'move':
      // A lock pins the element itself: others can still go into it.
      return op.targets.some(locked) ? REFUSED : FREE;
    case 'unwrap':
      return locked(op.target) ? REFUSED : FREE;
    case 'replace':
      return op.edits.some((entry) => locked(entry.target)) ? REFUSED : FREE;
    default:
      return FREE;
  }
}

/* --------------------------------- keys ---------------------------------- */

/**
 * ⌘L or ⇧⌘L (Ctrl elsewhere); not with Alt, not repeated. The key that types
 * `l`, or on a layout without Latin letters the physical L key.
 */
export function isLockKey({ key, code, meta, alt, repeat }: { key: string; code?: string; meta: boolean; alt: boolean; repeat?: boolean }): boolean {
  if (!meta || alt || repeat) return false;
  return key.toLowerCase() === 'l' || (code === 'KeyL' && !/^[a-z]$/i.test(key));
}
