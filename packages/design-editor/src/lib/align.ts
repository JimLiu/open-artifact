/**
 * Lining selected elements up with each other: the six actions, their
 * ⌥-letter shortcuts, and the offsets that put each element's box on the
 * edge or centre line of the box around them all.
 */

export type AlignAction = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export interface AlignInfo {
  action: AlignAction;
  /** The button's name. */
  label: string;
  /** What is announced once it is done. */
  done: string;
  /** The letter pressed with ⌥ / Alt. */
  letter: string;
  axis: 'x' | 'y';
}

export const ALIGN_ACTIONS: readonly AlignInfo[] = [
  { action: 'left', label: 'Align left', done: 'Aligned left', letter: 'a', axis: 'x' },
  { action: 'hcenter', label: 'Align horizontal centers', done: 'Aligned horizontal centers', letter: 'h', axis: 'x' },
  { action: 'right', label: 'Align right', done: 'Aligned right', letter: 'd', axis: 'x' },
  { action: 'top', label: 'Align top', done: 'Aligned top', letter: 'w', axis: 'y' },
  { action: 'vcenter', label: 'Align vertical centers', done: 'Aligned vertical centers', letter: 'v', axis: 'y' },
  { action: 'bottom', label: 'Align bottom', done: 'Aligned bottom', letter: 's', axis: 'y' },
];

export const alignInfo = (action: AlignAction): AlignInfo => ALIGN_ACTIONS.find((info) => info.action === action)!;

/** The shortcut shown in a button's tooltip, such as `⌥A`. */
export const alignShortcut = (action: AlignAction): string => `⌥${alignInfo(action).letter.toUpperCase()}`;

/** Announced when every box already sits on the line. */
export const ALREADY_ALIGNED = 'Already aligned';
/** Refused: the elements are not placed with offsets. `position` / `absolute` name the Position row and its option. */
export const notPositionedMessage = (position: string, absolute: string): string => `Nothing moved. Set ${position} to ${absolute} on these elements to line them up.`;
/** Refused: a box between them and the artboard turns, flips or stretches them. */
export const TRANSFORMED_MESSAGE = 'One or more of these is inside something rotated, flipped or stretched, so nothing moved.';

/**
 * The action an ⌥-letter press asks for: Alt alone (no ⌘, Ctrl or Shift),
 * the letter read from `key` when it is a–z, otherwise from the physical
 * key (`code`), so other keyboard layouts (and ⌥ turning A into å) work.
 */
export function alignActionOfKey(press: { key: string; code: string; alt: boolean; ctrl: boolean; meta: boolean; shift: boolean }): AlignAction | null {
  if (!press.alt || press.ctrl || press.meta || press.shift) return null;
  const letter = /^[a-z]$/i.test(press.key) ? press.key.toLowerCase() : /^Key[A-Z]$/.test(press.code) ? press.code.slice(3).toLowerCase() : null;
  return ALIGN_ACTIONS.find((info) => info.letter === letter)?.action ?? null;
}

export interface AlignBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const tenth = (value: number): number => {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
};

/** How far each box moves (rounded to 0.1px) to line up on `action` with the box around them all. */
export function alignOffsets(boxes: readonly AlignBox[], action: AlignAction): { dx: number; dy: number }[] {
  if (!boxes.length) return [];
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  return boxes.map((b) => {
    switch (action) {
      case 'left':
        return { dx: tenth(left - b.left), dy: 0 };
      case 'hcenter':
        return { dx: tenth((left + right) / 2 - (b.left + b.width / 2)), dy: 0 };
      case 'right':
        return { dx: tenth(right - (b.left + b.width)), dy: 0 };
      case 'top':
        return { dx: 0, dy: tenth(top - b.top) };
      case 'vcenter':
        return { dx: 0, dy: tenth((top + bottom) / 2 - (b.top + b.height / 2)) };
      case 'bottom':
        return { dx: 0, dy: tenth(bottom - (b.top + b.height)) };
    }
  });
}

/** True when nothing would move. */
export const isAligned = (offsets: readonly { dx: number; dy: number }[]): boolean => offsets.every((o) => o.dx === 0 && o.dy === 0);

/* --------------------------- aligning to the parent --------------------------- */

/** One selected element, as the align row reads it. */
export interface AlignSubject {
  /** Its inline style. */
  inline: Readonly<Record<string, string>>;
  /** Its position (inline, else computed). */
  position: string;
  /** Its display (inline, else computed). */
  display: string;
  /** Its parent's display. */
  parentDisplay: string;
  /** Shifted with the `translate` property. */
  translated: boolean;
}

/** One action of the align row when the selection aligns to its parent. */
export interface ParentAlign {
  on: boolean;
  patch: Record<string, string | null>;
  /** Why it is off (shown as `{action} — {reason}`), or null. */
  reason: string | null;
}

/** Names of the panel controls the reasons point to. */
const NAMES = { absolute: 'Absolute', fixedPosition: 'Fixed', fixedSize: 'Fixed', align: 'Align', advanced: 'Code' };

const isPositioned = (position: string) => position === 'absolute' || position === 'fixed';
const fixedSize = (inline: Readonly<Record<string, string>>, axis: 'width' | 'height'): boolean => {
  const value = inline[axis];
  return Boolean(value && value !== 'auto' && value !== 'fit-content' && value !== 'max-content' && value !== '100%' && value !== 'stretch') || Boolean(inline[`max-${axis}`]);
};

/**
 * The six actions when the selection lines up inside its parent: offsets
 * for positioned elements, auto margins in the flow. `blocked` is why the
 * selection's layout can't change (locked, or styled from code), if so.
 */
export function parentAlign(subjects: readonly AlignSubject[], options: { readOnly: boolean; blocked: string | null }): Record<AlignAction, ParentAlign> {
  const first = subjects[0];
  const i = first?.inline ?? {};
  const positioned = Boolean(first && isPositioned(first.position));
  const many = subjects.length > 1;
  const shared = (reason: string | null): string | null => {
    if (options.readOnly) return 'Read-only selection';
    if (options.blocked) return options.blocked;
    if (!first) return 'Nothing selected';
    if (many && subjects.some((s) => isPositioned(s.position) !== positioned)) return 'The selection mixes positioned and in-flow elements — align them one at a time';
    if (many && subjects.some((s) => (s.inline.transform ?? '') !== (i.transform ?? ''))) return 'The selected elements carry different transforms — align them one at a time';
    if (subjects.some((s) => s.translated)) return `This element is shifted with the translate property — remove it (${NAMES.advanced}) or align it by hand`;
    if (subjects.some((s) => s.parentDisplay.includes('flex') || s.parentDisplay.includes('grid'))) return `Placed by its parent — select the parent and use its ${NAMES.align}`;
    if (many && !positioned) return 'In-flow elements align one at a time — select one';
    return reason;
  };
  const sizeReason = (axis: 'width' | 'height'): string | null => {
    if (!subjects.every((s) => fixedSize(s.inline, axis))) return `give it a ${NAMES.fixedSize} ${axis} first (an auto ${axis} would stretch edge to edge)`;
    if (many && subjects.some((s) => s.inline[axis] !== i[axis])) return `the selected elements need one shared ${NAMES.fixedSize} ${axis}`;
    return null;
  };
  const flowReason = !positioned && first ? (subjects.some((s) => s.display !== 'block') ? 'Only block elements can be aligned this way' : sizeReason('width')) : null;
  const vertical = positioned ? null : `position it first (${NAMES.absolute} or ${NAMES.fixedPosition}) to align it vertically`;
  const h: Record<'left' | 'hcenter' | 'right', ParentAlign> = positioned
    ? {
        left: { on: i.left !== undefined && i.right === undefined, patch: { left: '0', right: null, 'margin-left': null, 'margin-right': null }, reason: shared(null) },
        hcenter: { on: i['margin-left'] === 'auto' && i['margin-right'] === 'auto', patch: { left: '0', right: '0', 'margin-left': 'auto', 'margin-right': 'auto' }, reason: shared(sizeReason('width')) },
        right: { on: i.right !== undefined && i.left === undefined, patch: { left: null, right: '0', 'margin-left': null, 'margin-right': null }, reason: shared(null) },
      }
    : {
        left: { on: i['margin-right'] === 'auto' && i['margin-left'] !== 'auto', patch: { 'margin-left': '0', 'margin-right': 'auto' }, reason: shared(flowReason) },
        hcenter: { on: i['margin-left'] === 'auto' && i['margin-right'] === 'auto', patch: { 'margin-left': 'auto', 'margin-right': 'auto' }, reason: shared(flowReason) },
        right: { on: i['margin-left'] === 'auto' && i['margin-right'] !== 'auto', patch: { 'margin-left': 'auto', 'margin-right': '0' }, reason: shared(flowReason) },
      };
  return {
    ...h,
    top: { on: positioned && i.top !== undefined && i.bottom === undefined, patch: { top: '0', bottom: null, 'margin-top': null, 'margin-bottom': null }, reason: shared(vertical) },
    vcenter: { on: positioned && i['margin-top'] === 'auto' && i['margin-bottom'] === 'auto', patch: { top: '0', bottom: '0', 'margin-top': 'auto', 'margin-bottom': 'auto' }, reason: shared(vertical ?? sizeReason('height')) },
    bottom: { on: positioned && i.bottom !== undefined && i.top === undefined, patch: { top: null, bottom: '0', 'margin-top': null, 'margin-bottom': null }, reason: shared(vertical) },
  };
}

/** A disabled button's tooltip: `{action} — {reason}`. */
export const alignTip = (action: AlignAction, reason: string): string => `${alignInfo(action).label} — ${reason}`;
