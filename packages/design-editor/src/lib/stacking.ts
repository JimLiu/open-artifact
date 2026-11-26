/**
 * Stacking shortcuts: one step up or down, or all the way to the front or
 * back. Read from the physical bracket keys, so the layout and Shift (which
 * turns `]` into `}`) don't matter.
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
 * - ⌘] / ⌘[ one step forward / backward (Ctrl elsewhere).
 * - ⇧⌘] / ⇧⌘[ to the front / back; on a Mac ⌥⌘] / ⌥⌘[ too.
 * - ] / [ and ⇧] / ⇧[ (`}` / `{`) without ⌘: to the front / back.
 */
export function stackOrderOf(press: StackPress, apple: boolean): StackOrder | null {
  const side = sideOf(press);
  if (!side) return null;
  if (!press.meta) return press.alt ? null : side > 0 ? 'front' : 'back';
  // Ctrl+Alt is AltGr on other platforms: it types characters.
  if (press.alt && !apple) return null;
  if (press.shift || press.alt) return side > 0 ? 'front' : 'back';
  return side > 0 ? 'forward' : 'backward';
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
