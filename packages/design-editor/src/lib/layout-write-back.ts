/**
 * Keeping elements where they are on screen when their parent changes:
 * grouping, ungrouping, moving a layer to another parent in the outline.
 *
 * The editor measures each element against the box it will be placed in
 * (`BoardApi.measure`) before the change; `writeBackPatch` turns that box
 * into the inline styles that put it back there afterwards. The group
 * plan (`groupPlan`) decides what box a new group gets.
 */

import type { StylePatch } from '@open-artifact/dc';

/** An element measured before the change: its box in the new container, and what it computes. */
export interface MeasuredElement {
  tag: string;
  /** Its inline style, parsed. */
  inline: Readonly<Record<string, string>>;
  /** Border box against the new container's padding box. */
  box: { left: number; top: number; width: number; height: number };
  /** `position`, `display`, `z-index`, margins and inherited text styles, computed. */
  computed: Readonly<Record<string, string>>;
}

/** Text styles an element takes from its parent. */
export const INHERITED_TEXT = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform'] as const;

/** Components draw themselves: they keep only their place and size. */
export const isImportTag = (tag: string): boolean => tag === 'x-import' || tag === 'dc-import';

/** A pixel length: whole when it is nearly whole, else two decimals. */
export function pixels(value: number): string {
  const whole = Math.round(value);
  if (Math.abs(value - whole) < 0.01) return `${whole === 0 ? 0 : whole}px`;
  return `${Number(value.toFixed(2))}px`;
}

const isPositioned = (position: string | undefined): boolean => position === 'absolute' || position === 'fixed';
const isPercent = (value: string | undefined): boolean => Boolean(value && /%\s*$/.test(value));
const hasAuto = (value: string | undefined): boolean => Boolean(value && /\bauto\b/.test(value));
const holes = (value: string | undefined): number => (value?.match(/\{\{/g) ?? []).length;

const INSETS = ['inset', 'inset-inline', 'inset-block', 'inset-inline-start', 'inset-inline-end', 'inset-block-start', 'inset-block-end'];
const GRID_PLACEMENT = ['grid-area', 'grid-column', 'grid-row', 'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end'];
const MARGINS = ['margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'margin-inline', 'margin-block'];

/**
 * The inline styles that keep an element at its measured box in the new
 * container. `inheritedThere` is what the new place would give it to
 * inherit (computed on the new parent); text styles that would change are
 * written on the element. `null` when the change would take away one of
 * its `{{…}}` expressions: the element is then left as it is.
 */
export function writeBackPatch(element: MeasuredElement, inheritedThere: Readonly<Record<string, string>> | null = null): StylePatch | null {
  const { inline, box, computed } = element;
  const patch: Record<string, string | null> = {};
  const positioned = isPositioned(computed.position);
  let left = box.left;
  let top = box.top;
  if (positioned) {
    // `left` and `top` place the margin box, unless the margin centres it.
    const margin = inline.margin ?? '';
    if (!hasAuto(margin) && !hasAuto(inline['margin-left'])) left -= parseFloat(computed['margin-left'] ?? '0') || 0;
    if (!hasAuto(margin) && !hasAuto(inline['margin-top'])) top -= parseFloat(computed['margin-top'] ?? '0') || 0;
    if (inline.position && inline.position !== computed.position) patch.position = computed.position!;
    const pinnedX = Boolean(inline.left && inline.right && inline.left !== 'auto' && inline.right !== 'auto');
    const pinnedY = Boolean(inline.top && inline.bottom && inline.top !== 'auto' && inline.bottom !== 'auto');
    if (isPercent(inline.width) || ((!inline.width || inline.width === 'auto') && pinnedX)) patch.width = pixels(box.width);
    if (isPercent(inline.height) || ((!inline.height || inline.height === 'auto') && pinnedY)) patch.height = pixels(box.height);
  } else {
    patch.position = 'absolute';
    for (const name of MARGINS) if (inline[name] !== undefined && name !== 'margin') patch[name] = null;
    patch.margin = '0px';
    patch.width = pixels(box.width);
    if ((inline.height && inline.height !== 'auto') || isPercent(inline.height)) patch.height = pixels(box.height);
  }
  for (const name of INSETS) if (inline[name] !== undefined) patch[name] = null;
  patch.left = pixels(left);
  patch.top = pixels(top);
  if (inline.right !== undefined) patch.right = 'auto';
  if (inline.bottom !== undefined) patch.bottom = 'auto';
  const placed = GRID_PLACEMENT.filter((name) => inline[name] !== undefined);
  for (const name of placed) patch[name] = null;
  if (placed.length) patch['grid-area'] = 'auto';
  if (inheritedThere && !isImportTag(element.tag) && !inline.font) {
    for (const name of INHERITED_TEXT) {
      if (inline[name] !== undefined) continue;
      const own = computed[name];
      if (own && inheritedThere[name] !== undefined && own !== inheritedThere[name]) patch[name] = own;
    }
  }
  // Nothing written may take away an expression.
  for (const [name, value] of Object.entries(patch)) if (holes(inline[name]) > holes(value ?? undefined)) return null;
  return patch;
}

/* -------------------------------------------------------------------------- */
/* Groups                                                                      */
/* -------------------------------------------------------------------------- */

/** Why the selection cannot be grouped, in the words the toast uses. */
export const GROUP_REFUSALS = {
  tableParts: 'List items and table cells can’t join a group.',
  fixed: 'Can’t group these: one is fixed to the window.',
  transformed: 'Can’t group these: one is inside a rotated or scaled box.',
  unmeasured: 'Couldn’t group these right now. Try again.',
  here: 'Can’t group these elements together here.',
} as const;

/** Why the selection cannot be ungrouped. */
export const UNGROUP_REFUSALS = {
  nothing: 'Nothing to ungroup. Select a group, or a layer that holds other layers.',
  managed: 'This component manages itself, so it can’t be ungrouped',
  instance: 'A component instance can’t be ungrouped',
  data: 'A repeated or conditional layer follows the layout’s data, so it can’t be ungrouped',
  drawing: 'Parts of a drawing can’t be ungrouped',
  unmeasured: 'Couldn’t ungroup these right now. Try again.',
} as const;

/** What a move out of a grid says when its boxes could not be measured. */
export const MOVE_UNMEASURED = 'Couldn’t move. Nothing changed.';

const TABLE_PARTS = new Set(['li', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'caption', 'col', 'colgroup']);

/** True for elements that only make sense inside a list or table. */
export const isTablePart = (tag: string, display = ''): boolean => TABLE_PARTS.has(tag) || display === 'list-item' || display.startsWith('table');

/** The flex layout a group copies from the parent its members share. */
export interface FlexLayout {
  'flex-direction'?: string;
  gap?: string;
  'justify-content'?: string;
  'align-items'?: string;
}

/** How a new group is made. */
export type GroupPlan =
  /** A plain box, or one that lays out like the flex parent. */
  | { kind: 'flow'; style: string }
  /** A positioned box around the members, which are placed inside it. */
  | { kind: 'positioned'; style: string; members: StylePatch[] };

/** Inline style of a plain group, laid out like `flex` when it is given. */
export function flowGroupStyle(flex: FlexLayout | null): string {
  if (!flex) return 'box-sizing: border-box';
  const value = (name: keyof FlexLayout, fallback: string) => flex[name] || fallback;
  return [
    'box-sizing: border-box',
    'display: flex',
    `flex-direction: ${value('flex-direction', 'row')}`,
    `gap: ${value('gap', '0px')}`,
    `justify-content: ${value('justify-content', 'flex-start')}`,
    `align-items: ${value('align-items', 'stretch')}`,
  ].join('; ');
}

/**
 * A positioned group around measured members (boxes against the group's
 * container): the group takes their bounds and highest stacking, each
 * member is placed inside it. `null` when a member's styles can't be
 * written back (an expression would go).
 */
export function positionedGroup(members: readonly MeasuredElement[]): Extract<GroupPlan, { kind: 'positioned' }> | null {
  const left = Math.min(...members.map((member) => member.box.left));
  const top = Math.min(...members.map((member) => member.box.top));
  const right = Math.max(...members.map((member) => member.box.left + member.box.width));
  const bottom = Math.max(...members.map((member) => member.box.top + member.box.height));
  const stacks = members.map((member) => member.computed['z-index']).filter((z): z is string => Boolean(z) && z !== 'auto');
  const z = stacks.length ? Math.max(...stacks.map(Number).filter(Number.isFinite)) : null;
  const style = [
    'box-sizing: border-box',
    'position: absolute',
    'margin: 0px',
    `left: ${pixels(left)}`,
    `top: ${pixels(top)}`,
    `width: ${pixels(right - left)}`,
    `height: ${pixels(bottom - top)}`,
    ...(z !== null && Number.isFinite(z) ? [`z-index: ${z}`] : []),
  ].join('; ');
  const patches: StylePatch[] = [];
  for (const member of members) {
    const patch = writeBackPatch({ ...member, box: { ...member.box, left: member.box.left - left, top: member.box.top - top } });
    if (!patch) return null;
    patches.push(patch);
  }
  return { kind: 'positioned', style, members: patches };
}

/**
 * Whether an element moved into a container leaves the flow to stay where
 * it was: the container is free (a block whose other children are all
 * positioned, or an empty positioned one or the artboard itself) and the
 * element can leave the flow.
 */
export function staysByPosition(element: { tag: string; display: string; repeated: boolean }, container: { display: string; positioned: boolean; root: boolean; others: readonly string[] }): boolean {
  if (element.repeated || isTablePart(element.tag, element.display)) return false;
  if (element.display === 'inline') return false;
  if (container.display !== 'block' && container.display !== 'flow-root') return false;
  if (container.others.length) return container.others.every(isPositioned);
  return container.root || container.positioned;
}
