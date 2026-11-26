/**
 * How the editor treats locked elements: which commands a selection refuses
 * and why, the lock shortcut, what is read out, and how a selection settles.
 * The lock rules themselves live in slides-core (`locks.ts`).
 */

import { isLocked, lockToggle, nodeAt, selectionLocks, sweepUnlocked, type NodePath, type Slide } from '@open-artifact/slides-core';
import { shortcutLetter, type ShortcutKeyLike } from '@open-artifact/ui/keys';
import { layerMoveKey } from './shortcut-keys.ts';

export const LOCKED_REFUSAL = 'Locked. Unlock to make changes';
export const ALL_LOCKED_REFUSAL = 'Every element on this slide is locked';
export const GENERATED_REFUSAL = "Content added by the slide's styles can't be locked";

/**
 * What a command does to the selection, as locks see it:
 * - `edit` moves, resizes, restacks, regroups, crops or removes it;
 * - `duplicate` adds copies next to it, inside its container;
 * - `ungroup` takes a group apart.
 */
export type LockedAction = 'edit' | 'duplicate' | 'ungroup';

/** Why the selection refuses `action`, or null when it goes ahead. */
export function lockRefusal(slide: Slide, paths: readonly NodePath[], action: LockedAction): string | null {
  if (paths.length === 0) return null;
  switch (action) {
    case 'edit':
      return selectionLocks(slide, paths).kind === 'locked' ? LOCKED_REFUSAL : null;
    case 'duplicate':
      return paths.some((path) => path.length > 1 && isLocked(slide, path.slice(0, -1))) ? LOCKED_REFUSAL : null;
    case 'ungroup':
      return paths.some((path) => nodeAt(slide, path)?.kind === 'box' && isLocked(slide, path)) ? LOCKED_REFUSAL : null;
  }
}

/** The part of the selection an edit applies to: all of it, or its unlocked part when it mixes both. */
export function editablePart(slide: Slide, paths: readonly NodePath[]): NodePath[] {
  const locks = selectionLocks(slide, paths);
  return locks.kind === 'free' ? locks.paths : [];
}

/** True when there is a selection and every node of it is locked. */
export function allLocked(slide: Slide, paths: readonly NodePath[]): boolean {
  return selectionLocks(slide, paths).kind === 'locked';
}

/**
 * The selection a change of locks or selection should settle on, or null to
 * keep it. While the slide can be edited a selection holds either only
 * unlocked nodes or only locked ones (so a locked set can still be unlocked
 * together); read-only, anything goes.
 */
export function settledSelection(slide: Slide, paths: readonly NodePath[], editable: boolean): NodePath[] | null {
  if (!editable) return null;
  const locks = selectionLocks(slide, paths);
  return locks.kind === 'free' && locks.paths.length < paths.length ? locks.paths : null;
}

/** What a sweep (Select all, a marquee) picks: everything when read-only, else what is unlocked. */
export function sweepTargets(slide: Slide, candidates: readonly NodePath[], editable: boolean): NodePath[] {
  return editable ? sweepUnlocked(slide, candidates).paths : [...candidates];
}

/** Why Select all has nothing to take, or null. */
export function selectAllRefusal(slide: Slide, candidates: readonly NodePath[], editable: boolean): string | null {
  return editable && sweepUnlocked(slide, candidates).allLocked ? ALL_LOCKED_REFUSAL : null;
}

/** The menu row of the lock command for a selection: its label and, when it can't run, why. */
export function lockMenuRow(slide: Slide, paths: readonly NodePath[]): { label: 'Lock' | 'Unlock'; refusal: string | null } {
  const toggle = lockToggle(slide, paths);
  if (toggle.kind === 'unlock') return { label: 'Unlock', refusal: null };
  return { label: 'Lock', refusal: toggle.kind === 'generated' ? GENERATED_REFUSAL : null };
}

/** What is read out after locking or unlocking `count` elements. */
export function lockAnnouncement(locked: boolean, count: number): string {
  const what = count === 1 ? 'Element' : `${count} elements`;
  return `${what} ${locked ? 'locked' : 'unlocked'}`;
}

/** The key event fields {@link isLockShortcut} reads. */
export interface LockKeyLike extends ShortcutKeyLike {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** ⇧⌘L (Ctrl+Shift+L off the Mac): lock or unlock the selection. */
export function isLockShortcut(event: LockKeyLike): boolean {
  return (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && shortcutLetter(event) === 'l';
}

const LOCKED_KEYS = new Set(['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '[', ']']);

/** A key whose command (delete, move, restack, group) a locked selection refuses; held, it only repeats the refusal. */
export function refusedWhenLocked(event: LockKeyLike, apple: boolean): boolean {
  if (layerMoveKey(event, apple) !== null) return true;
  if (event.metaKey || event.ctrlKey) return !event.altKey && shortcutLetter(event) === 'g';
  return !event.altKey && LOCKED_KEYS.has(event.key);
}

/** Lets one refusal through per `windowMs`, so a burst of refused presses shows a single notice. */
export function refusalGate(windowMs: number, now: () => number = Date.now): () => boolean {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < windowMs) return false;
    last = t;
    return true;
  };
}
