/**
 * Pagination of Flow artboards. The paging itself (paper sizes, where pages are cut) lives in
 * `@open-artifact/export-kit`; this adds what an artboard entry says about its paper.
 */

import { PAPER, type Paper } from '@open-artifact/export-kit';

export {
  BREAK_MARGIN,
  MAX_FLOW_PAGES,
  MAX_UNSPLIT_PICTURE,
  PAPER,
  breakMargin,
  flowPages,
  keepTogetherSpans,
  pageSlices,
  paginate,
  type Interval,
  type KeepBlock,
  type PageSlice,
  type PaginateOptions,
  type Paper,
} from '@open-artifact/export-kit';

/** The paper of an artboard entry, when it paginates. */
export function flowPaper(entry: { print?: unknown; paper?: unknown }): { paper: Paper; width: number; height: number } | null {
  if (entry.print !== 'flow') return null;
  const paper: Paper = entry.paper === 'a4' ? 'a4' : 'letter';
  return { paper, ...PAPER[paper] };
}
