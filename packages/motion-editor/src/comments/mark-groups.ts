/**
 * The comment marks on the timeline, gathered where they crowd: moments closer than `gap` pixels make one group,
 * which shows a few of its marks and a "+N" that pages through the rest. A stretch keeps a mark of its own. Pure.
 */

export interface PlacedMark {
  id: string;
  /** Where it starts on the track, in pixels. */
  x: number;
  /** A stretch rather than a moment. */
  range: boolean;
}

export interface MarkGroup {
  /** Its first mark's id: what its page is kept under. */
  key: string;
  ids: readonly string[];
  /** The marks on show, on the page `page`. */
  shown: readonly string[];
  page: number;
  /** How many pages its marks take; 1 when all show. */
  pages: number;
  /** Where its first mark starts, in pixels. */
  x: number;
}

/** How many marks a crowded group shows at once. */
export const MARKS_SHOWN = 3;

export function groupMarks(marks: readonly PlacedMark[], gap: number, pages: ReadonlyMap<string, number> = new Map(), most = MARKS_SHOWN): MarkGroup[] {
  const runs: PlacedMark[][] = [];
  let run: PlacedMark[] | null = null;
  for (const mark of [...marks].sort((a, b) => a.x - b.x)) {
    if (mark.range) {
      runs.push([mark]);
      continue;
    }
    const last = run?.[run.length - 1];
    if (run !== null && last !== undefined && mark.x - last.x < gap) run.push(mark);
    else runs.push((run = [mark]));
  }
  return runs.map((members) => {
    const ids = members.map((mark) => mark.id);
    const key = ids[0]!;
    const count = Math.max(1, Math.ceil(ids.length / most));
    const page = Math.min(count - 1, Math.max(0, pages.get(key) ?? 0));
    return { key, ids, shown: ids.slice(page * most, page * most + most), page, pages: count, x: members[0]!.x };
  });
}

/** The page after `group`'s, back to the first after the last. */
export const nextPage = (group: MarkGroup): number => (group.page + 1) % group.pages;

/** How many of the group's marks are not on show. */
export const hiddenCount = (group: MarkGroup): number => group.ids.length - group.shown.length;
