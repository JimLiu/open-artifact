/**
 * Finding the link a selection in edited text sits in, so that linking it
 * again changes that link instead of nesting a new one inside.
 */

/** The parts of a DOM node these functions walk. */
export interface LinkNode {
  readonly nodeName: string;
  readonly parentNode: LinkNode | null;
}

/** The outermost `<a>` holding `node` below `root`, or null (also when `node` is not inside `root`). */
export function outermostLink<T extends LinkNode>(node: T, root: T): T | null {
  let found: LinkNode | null = null;
  for (let at: LinkNode | null = node; at; at = at.parentNode) {
    if (at === root) return found as T | null;
    if (at.nodeName === 'A') found = at;
  }
  return null;
}

/** The link holding both ends of a selection below `root`, or null when they are not in the same one. */
export function linkAround<T extends LinkNode>(start: T, end: T, root: T): T | null {
  const link = outermostLink(start, root);
  return link && link === outermostLink(end, root) ? link : null;
}

/**
 * True when linking has to be redone (unlink, then link again): the selection
 * read back is not in one link carrying exactly `href`.
 */
export function linkMissed(readBack: string | null, href: string): boolean {
  return readBack !== href;
}
