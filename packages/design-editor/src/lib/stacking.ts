/**
 * Stacking shortcuts: one step up or down, or all the way to the front or
 * back. Read from the physical bracket keys, so the layout doesn't matter.
 */

/** Where a stacking shortcut sends the selection. */
export type StackOrder = 'forward' | 'backward' | 'front' | 'back';

/** The parts of a key press read here. */
export interface StackPress {
  key: string;
  code?: string;
  /** ⌘, or Ctrl elsewhere. */
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

const SIDES = new Map<string, 1 | -1>([
  ['BracketRight', 1],
  ['BracketLeft', -1],
  [']', 1],
  ['}', 1],
  ['[', -1],
  ['{', -1],
]);

/** +1 for the right bracket key, -1 for the left one, 0 for any other. */
function sideOf(press: StackPress): 1 | -1 | 0 {
  return (press.code ? SIDES.get(press.code) : undefined) ?? SIDES.get(press.key) ?? 0;
}

/**
 * The stacking move of a key press, or `null`.
 *
 * - ] / [ alone: to the front / back. With Shift (`}` / `{`) or Alt: nothing.
 * - ⌘] / ⌘[ one step forward / backward (Ctrl elsewhere).
 * - On a Mac ⌥⌘] / ⌥⌘[ to the front / back; ⇧⌘] / ⇧⌘[ are left to the
 *   browser, which switches tabs with them.
 * - Elsewhere Ctrl+Shift and Ctrl+Alt to the front / back; Ctrl+Alt only
 *   while the key still types a bracket (it is AltGr on many layouts).
 */
export function stackOrderOf(press: StackPress, apple: boolean): StackOrder | null {
  const side = sideOf(press);
  if (!side) return null;
  const toEnd: StackOrder = side > 0 ? 'front' : 'back';
  if (!press.meta) return press.shift || press.alt ? null : toEnd;
  const step: StackOrder = side > 0 ? 'forward' : 'backward';
  if (apple) {
    if (press.shift) return null;
    return press.alt ? toEnd : step;
  }
  if (press.alt) return press.key === ']' || press.key === '[' ? toEnd : null;
  return press.shift ? toEnd : step;
}

const SAID = new Map<StackOrder, readonly [moved: string, stuck: string]>([
  ['forward', ['Brought forward', 'Already at the front']],
  ['backward', ['Sent backward', 'Already at the back']],
  ['front', ['Brought to the front', 'Already at the front']],
  ['back', ['Sent to the back', 'Already at the back']],
]);

/** What a screen reader hears after a stacking move (`moved` false: it was already at that end). */
export function stackMessage(order: StackOrder, moved: boolean): string {
  const [done, stuck] = SAID.get(order)!;
  return moved ? done : stuck;
}

/** Toward the front (`forward`, `front`) or the back. */
export const stacksUp = (order: StackOrder): boolean => order === 'forward' || order === 'front';
