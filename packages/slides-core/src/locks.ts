/**
 * Locks: `data-locked` on an element holds it in place in the editor, and
 * everything inside it with it. The file stores only the flag
 * (`NodeBase.locked`); these are the rules the editor applies to it.
 */

import { nodeAt, nodeLabel, type NodePath } from './ids.ts';
import type { Slide, SlideNode } from './model.ts';

/** True when the node at `path` exists and it, or an element holding it, is locked. */
export function isLocked(slide: Slide, path: NodePath): boolean {
  if (!nodeAt(slide, path)) return false;
  for (let depth = 1; depth <= path.length; depth++) {
    if (nodeAt(slide, path.slice(0, depth))?.locked) return true;
  }
  return false;
}

/**
 * Locks or unlocks the nodes at `paths` (paths that lead nowhere are
 * skipped). Unlocking also clears the locks of the elements holding each
 * node: while one of them stays locked, so does the node.
 */
export function setLocked(slide: Slide, paths: readonly NodePath[], locked: boolean): Slide {
  let next = slide;
  for (const path of paths) {
    if (path.length === 0 || !nodeAt(next, path)) continue;
    const children = relock(next.children, path, 0, locked);
    if (children !== next.children) next = { ...next, children };
  }
  return next;
}

/** `nodes` with the lock set along `path`; the same array when nothing changed. */
function relock(nodes: SlideNode[], path: NodePath, depth: number, locked: boolean): SlideNode[] {
  const index = path[depth]!;
  const node = nodes[index]!;
  let next: SlideNode;
  if (depth === path.length - 1) next = withFlag(node, locked);
  else {
    next = locked ? node : withFlag(node, false);
    if (next.kind === 'box') {
      const children = relock(next.children, path, depth + 1, locked);
      if (children !== next.children) next = { ...next, children };
    }
  }
  if (next === node) return nodes;
  const copy = nodes.slice();
  copy[index] = next;
  return copy;
}

function withFlag(node: SlideNode, locked: boolean): SlideNode {
  if (Boolean(node.locked) === locked) return node;
  const copy = { ...node };
  if (locked) copy.locked = true;
  else delete copy.locked;
  return copy;
}

/** How locks bear on a selection. */
export type SelectionLocks =
  | { kind: 'empty' }
  /** What may be edited: the whole selection, or only its unlocked part when it mixes both. */
  | { kind: 'free'; paths: NodePath[] }
  /** Every selected node is locked: edits wait until it is unlocked. */
  | { kind: 'locked'; paths: NodePath[] };

/** Sorts a selection by its locks (see {@link SelectionLocks}). */
export function selectionLocks(slide: Slide, paths: readonly NodePath[]): SelectionLocks {
  if (paths.length === 0) return { kind: 'empty' };
  const free = paths.filter((path) => !isLocked(slide, path));
  return free.length > 0 ? { kind: 'free', paths: free } : { kind: 'locked', paths: [...paths] };
}

/** What a sweep over many elements (Select all, a marquee) picks. */
export interface Sweep {
  /** The candidates that are not locked. */
  paths: NodePath[];
  /** True when there were candidates and every one of them is locked. */
  allLocked: boolean;
}

/** Picks the unlocked candidates of a sweep: a sweep never takes a locked element. */
export function sweepUnlocked(slide: Slide, candidates: readonly NodePath[]): Sweep {
  const paths = candidates.filter((path) => !isLocked(slide, path));
  return { paths, allLocked: candidates.length > 0 && paths.length === 0 };
}

/** A deep copy of a node with every lock in it cleared: what copying, pasting and duplicating make. */
export function unlockedCopy<T extends SlideNode>(node: T): T {
  const copy = structuredClone(node);
  clearLocks(copy);
  return copy;
}

function clearLocks(node: SlideNode): void {
  delete node.locked;
  if (node.kind === 'box') node.children.forEach(clearLocks);
}

/** A label marked as belonging to a locked element. */
export function lockedLabel(label: string): string {
  return `${label} (locked)`;
}

/** The name read out for the node at `path`: its label, marked when the node is locked. */
export function accessibleNodeLabel(slide: Slide, path: NodePath, max = 60): string | undefined {
  const node = nodeAt(slide, path);
  if (!node) return undefined;
  const label = nodeLabel(node, max);
  return isLocked(slide, path) ? lockedLabel(label) : label;
}

/** What the lock command does to a selection. */
export type LockToggle =
  | { kind: 'empty' }
  /** Only nodes a stylesheet made (`::before` / `::after`): there is no element in the file to hold the flag. */
  | { kind: 'generated' }
  | { kind: 'lock' | 'unlock'; paths: NodePath[] };

/** True for a node that only exists as the output of a stylesheet rule. */
export function isGenerated(node: SlideNode): boolean {
  return node.origin === -1;
}

/**
 * Lock when anything selected is still free, unlock when everything is
 * locked; generated nodes are left out either way.
 */
export function lockToggle(slide: Slide, paths: readonly NodePath[]): LockToggle {
  const targets = paths.filter((path) => {
    const node = nodeAt(slide, path);
    return node !== undefined && path.length > 0 && !isGenerated(node);
  });
  if (targets.length === 0) return paths.some((path) => nodeAt(slide, path)) ? { kind: 'generated' } : { kind: 'empty' };
  const unlock = targets.every((path) => isLocked(slide, path));
  return { kind: unlock ? 'unlock' : 'lock', paths: targets };
}
