/**
 * The properties panel for several things at once: several artboards, or
 * a selection across files (elements of several artboards, notes,
 * artboards). Rows are the ones every member has; a value the members
 * share shows, a value they don't reads `Mixed`.
 */

import type { BoardEntry, CanvasNote } from '@open-artifact/design-core';
import { MIXED, mergedValue, sharedPaintRoles, type PaintKind, type PaintRole } from './selection.ts';

/** Title of a row whose members differ. */
export const MIXED_ACROSS = 'Mixed across the selection';
/** Why the size of artboards sized by their content can't be typed. */
export const SIZED_BY_CONTENT = 'These are sized by their content—double-click one to edit it';
/** Why guides can't be edited for artboards whose guides differ. */
export const GUIDES_DIFFER = 'The selected artboards have different guides—select one artboard to edit its guides';
/** Why Position is off for a selection with canvas objects or pieces in it. */
export const POSITION_ACROSS = 'Canvas objects are placed freely on the canvas';

/** How long the panel waits for the selection and the artboards to settle before reading them again. */
export const READ_SETTLE_MS = 120;

/** One value for all, or `Mixed`; `''` when there is none. */
export function sharedValue<T>(values: readonly T[], show: (value: T) => string = String): string {
  return mergedValue(values.map(show));
}

/** The color rows a note has in its own panel: a shape's Fill. Others have none of the element rows. */
export function noteRoles(note: Pick<CanvasNote, 'kind'>): PaintRole[] {
  return note.kind === 'rect' || note.kind === 'oval' ? ['fill'] : [];
}

/**
 * The color rows of a selection across files: those every element has and
 * every note has; artboards take none (they have no fill or stroke).
 */
export function mixedRoles(elementKinds: readonly PaintKind[], notes: readonly Pick<CanvasNote, 'kind'>[], boards: number): PaintRole[] {
  if (boards) return [];
  const roles = elementKinds.length ? sharedPaintRoles(elementKinds) : notes.length ? (['text', 'fill', 'stroke'] as const).slice() : [];
  return roles.filter((role) => notes.every((note) => noteRoles(note).includes(role)));
}

/** True when the Position row is off: the selection holds canvas objects (artboards, notes) or pieces. */
export function positionBlocked(counts: { objects: number; pieces: number }): boolean {
  return counts.objects > 0 || counts.pieces > 0;
}

/** A number typed for several members at once. */
export type TypedChange = { set: number } | { by: number };

/**
 * A number typed for several artboards: a plain number sets each, a
 * signed one (`+4`, `-2`) changes each by that much from its own value.
 * `null` when it is not a number.
 */
export function typedChange(text: string): TypedChange | null {
  const trimmed = text.trim().replace(/px$/i, '').trim();
  if (!/^[+-]?\d*\.?\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return /^[+-]/.test(trimmed) ? { by: value } : { set: value };
}

/** One member's value after a change, whole and never below `least`. */
export function changedBy(value: number, change: TypedChange, least = 0): number {
  return Math.max(least, Math.round('set' in change ? change.set : value + change.by));
}

/** Each artboard's radius after a change (`undefined` for none). */
export function radiiAfter(radii: readonly (number | undefined)[], change: TypedChange): (number | undefined)[] {
  return radii.map((radius) => changedBy(radius ?? 0, change) || undefined);
}

/** What is said once several artboards' radius changed. */
export function radiusSaid(after: readonly (number | undefined)[]): string {
  const shared = sharedValue(after, (radius) => String(radius ?? 0));
  return shared === MIXED ? `Corner radius changed on ${after.length} artboards` : `Corner radius ${shared}px on ${after.length} artboards`;
}

/** Guides of several artboards: the ones they all have, or `null` when they differ. */
export function sharedGuides(entries: readonly Pick<BoardEntry, 'guides'>[]): BoardEntry['guides'] | null {
  const key = (entry: Pick<BoardEntry, 'guides'>) => JSON.stringify(entry.guides ?? []);
  return entries.every((entry) => key(entry) === key(entries[0]!)) ? (entries[0]?.guides ?? []) : null;
}
