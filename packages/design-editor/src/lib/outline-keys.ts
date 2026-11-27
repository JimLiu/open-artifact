/**
 * Keys on a focused row of the layers list. The list is one tab stop;
 * inside it the arrows walk the visible rows (Left and Right close and
 * open a row, then step to its parent or first child), Home and End jump
 * to the ends, Enter selects the row and Space selects it too (with Shift,
 * ⌘ or Ctrl it joins the selection), and F2 renames it. Other keys, and
 * any with ⌥ or ⌘ (Space aside), go on to the canvas: Delete, ⌘C and the
 * rest act on the selection as usual.
 */

/** What the list needs to know about a visible row. */
export interface OutlineRowState {
  /** 1 for the top rows (`aria-level`). */
  level: number;
  /** It has rows inside it. */
  expandable: boolean;
  open: boolean;
}

export interface OutlinePress {
  key: string;
  shift: boolean;
  /** ⌘ or Ctrl. */
  meta: boolean;
  alt: boolean;
}

export type OutlineKeyStep =
  | { kind: 'focus'; index: number }
  | { kind: 'open'; open: boolean }
  | { kind: 'select'; additive: boolean }
  | { kind: 'rename' };

const WALK_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'F2']);

/** True when a key pressed on a row belongs to the list, not to the canvas. */
export function outlineKeepsKey(press: OutlinePress): boolean {
  if (press.alt) return false;
  if (press.key === ' ') return true;
  return !press.meta && WALK_KEYS.has(press.key);
}

/** The row a row sits in: the nearest row above it one level out; -1 for a top row. */
export function parentRowOf(rows: readonly OutlineRowState[], at: number): number {
  const level = rows[at]?.level ?? 1;
  for (let index = at - 1; index >= 0; index--) if (rows[index]!.level < level) return index;
  return -1;
}

/** What a key does on the row at `at`; `null` when nothing (the key is still kept). */
export function outlineKeyStep(rows: readonly OutlineRowState[], at: number, press: OutlinePress): OutlineKeyStep | null {
  const row = rows[at];
  if (!row || !outlineKeepsKey(press)) return null;
  const last = rows.length - 1;
  const focus = (index: number): OutlineKeyStep | null => (index === at ? null : { kind: 'focus', index });
  switch (press.key) {
    case 'ArrowDown':
      return focus(Math.min(at + 1, last));
    case 'ArrowUp':
      return focus(Math.max(at - 1, 0));
    case 'Home':
      return focus(0);
    case 'End':
      return focus(last);
    case 'ArrowRight':
      if (row.expandable && !row.open) return { kind: 'open', open: true };
      return row.open && at < last && rows[at + 1]!.level > row.level ? focus(at + 1) : null;
    case 'ArrowLeft': {
      if (row.expandable && row.open) return { kind: 'open', open: false };
      const parent = parentRowOf(rows, at);
      return parent < 0 ? null : focus(parent);
    }
    case 'Enter':
      return press.shift ? null : { kind: 'select', additive: false };
    case ' ':
      return { kind: 'select', additive: press.shift || press.meta };
    case 'F2':
      return { kind: 'rename' };
    default:
      return null;
  }
}
