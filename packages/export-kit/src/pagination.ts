/**
 * Cutting a long rendered document into paper pages: where each page starts so no cut falls inside a line of text or a
 * picture, headings stay with what they introduce, and a forced break starts a new page. Pure: the measures come from
 * document-measure.ts.
 */

/** Paper sizes in CSS px (96 px/in). */
export type Paper = 'letter' | 'a4';
export const PAPER: Record<Paper, { width: number; height: number }> = {
  letter: { width: 816, height: 1056 },
  a4: { width: 794, height: 1123 },
};

/** Most pages one Flow artboard exports to. */
export const MAX_FLOW_PAGES = 100;
/** Share of a page added at each break, below the cut and above the next page's content. */
export const BREAK_MARGIN = 0.05;
/** Pictures taller than this are cut where the page ends instead of being kept whole. */
export const MAX_UNSPLIT_PICTURE = 950;

/** A vertical span `[top, bottom]` in document px. */
export type Interval = readonly [number, number];

/** A block kept with what it introduces (headings, captions, header rows). */
export interface KeepBlock {
  /** The block itself. */
  top: number;
  bottom: number;
  /** Where the kept run starts: the block, or a short lead-in line above it. */
  from: number;
  /** Kept with what follows (headings, top captions, header rows). */
  next: boolean;
  /** Kept with what precedes (a caption below a picture or table). */
  prev: boolean;
}

/** One page: content `[top, bottom)` of the document drawn at `offset` px from the page's top. */
export interface PageSlice {
  top: number;
  bottom: number;
  offset: number;
}

/** The margin added at each break for a page height (0 when the page is too short for it). */
export function breakMargin(pageHeight: number): number {
  const margin = Math.round(pageHeight * BREAK_MARGIN);
  return margin > 0 && pageHeight - 2 * margin > 40 ? margin : 0;
}

/**
 * Spans that should not be cut so a block stays with its neighbour: a
 * heading with the first band (line or picture) after it, a bottom caption
 * with the band before it. A span longer than a quarter of a page is not
 * kept (that much empty space costs more than the split).
 */
export function keepTogetherSpans(blocks: readonly KeepBlock[], bands: readonly Interval[], pageHeight: number): Interval[] {
  const spans: Interval[] = [];
  if (!(pageHeight > 0)) return spans;
  const limit = pageHeight / 4;
  const sorted = bands.filter((band) => band[1] > band[0]).sort((a, b) => a[0] - b[0]);
  /** Index of the first band starting at or after `position`. */
  const firstFrom = (position: number): number => {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sorted[middle]![0] < position - 0.5) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  for (const block of blocks) {
    if (!(block.bottom > block.top) || !(block.from <= block.top)) continue;
    const start = block.prev || block.bottom - block.from > limit ? block.top : block.from;
    const fits = block.bottom - start <= limit;
    if (fits) spans.push([start, block.bottom]);
    // A block too tall to keep whole: its first and last lines stand in for it.
    let firstInside: Interval | null = null;
    let lastInside: Interval | null = null;
    if (!fits) {
      for (let i = firstFrom(block.top); i < sorted.length && sorted[i]![0] < block.bottom - 0.5; i++) {
        if (sorted[i]![1] > block.bottom + 0.5) continue;
        firstInside ??= sorted[i]!;
        lastInside = sorted[i]!;
      }
    }
    if (block.next) {
      const index = firstFrom(block.bottom);
      const from = fits ? start : lastInside ? lastInside[0] : block.top;
      if (index < sorted.length && sorted[index]![0] - from <= limit) spans.push([from, sorted[index]![1]]);
    }
    if (block.prev && block.from < block.top) {
      const to = fits ? block.bottom : firstInside ? firstInside[1] : block.bottom;
      if (to - block.from <= limit) spans.push([block.from, to]);
    }
  }
  return spans;
}

/** Options of {@link paginate}. */
export interface PaginateOptions {
  maxPages?: number;
  /** Margin added at each break (see {@link breakMargin}). */
  overlap?: number;
  /** Spans from {@link keepTogetherSpans}: kept when that costs at most a quarter page. */
  keep?: readonly Interval[];
}

/**
 * Where each page starts, in document px (the first is 0). `intervals` are
 * the spans a cut must not fall inside (text lines, pictures); a span longer
 * than a page's content height is ignored (it is cut where the page ends).
 */
export function paginate(intervals: readonly Interval[], contentHeight: number, pageHeight: number, options: PaginateOptions = {}): number[] {
  const maxPages = Math.max(1, options.maxPages ?? MAX_FLOW_PAGES);
  const overlap = options.overlap ?? 0;
  const margin = overlap > 0 && pageHeight - 2 * overlap > 40 ? overlap : 0;
  if (!(pageHeight > 0)) return [0];
  const keepSlack = pageHeight / 4;
  const keep = options.keep ?? [];
  const all = keep.length ? [...intervals, ...keep] : intervals;

  const plan = (spans: readonly Interval[]): { tops: number[]; short: boolean } => {
    const tops = [0];
    let top = 0;
    for (;;) {
      const room = pageHeight - (tops.length > 1 ? margin : 0);
      if (!(top + room < contentHeight - 4)) break;
      if (tops.length >= maxPages) return { tops, short: true };
      const target = top + room - margin;
      /** Moves the cut up out of every span it would fall inside. */
      const settle = (list: readonly Interval[]): { cut: number; settled: boolean } | null => {
        let cut = target;
        for (let attempt = 0; attempt < 64; attempt++) {
          let next = cut;
          for (const span of list) {
            if (span[1] - span[0] > pageHeight - 2 * margin) continue;
            if (span[0] < cut && cut < span[1] && span[0] < next) next = span[0];
          }
          if (next === cut) return { cut, settled: true };
          // Nothing fits on this page without a cut through something: cut at the page's end.
          if (next <= top + 40) return null;
          cut = next;
        }
        return { cut, settled: false };
      };
      const base = settle(intervals);
      let cut = base === null ? target : base.cut;
      if (spans !== intervals) {
        const kept = settle(spans);
        if (kept !== null && kept.settled && kept.cut <= cut && cut - kept.cut <= keepSlack) cut = kept.cut;
      }
      tops.push(cut);
      top = cut;
    }
    return { tops, short: false };
  };

  const result = plan(all);
  // Keeping things together pushed past the page limit: plan again without it.
  return result.short && all !== intervals ? plan(intervals).tops : result.tops;
}

/** The pages for the tops {@link paginate} chose. The last page ends with the content (or its room, at the page limit). */
export function pageSlices(tops: readonly number[], contentHeight: number, pageHeight: number, overlap = 0): PageSlice[] {
  const margin = overlap > 0 && pageHeight - 2 * overlap > 40 ? overlap : 0;
  return tops.map((top, index) => {
    const offset = index > 0 ? margin : 0;
    const room = pageHeight - offset;
    const next = tops[index + 1];
    const bottom = Math.min(next ?? contentHeight, top + room, Math.max(top, contentHeight));
    return { top, bottom: Math.max(top, bottom), offset };
  });
}

/** Everything at once: the page slices of a measured Flow document. */
export function flowPages(
  measured: { contentHeight: number; bands: readonly Interval[]; blocks: readonly KeepBlock[] },
  pageHeight: number,
  maxPages = MAX_FLOW_PAGES,
): PageSlice[] {
  const overlap = breakMargin(pageHeight);
  const intervals = measured.bands.filter((band) => band[1] > band[0]);
  const keep = keepTogetherSpans(measured.blocks, intervals, pageHeight);
  const tops = paginate(intervals, measured.contentHeight, pageHeight, { maxPages, overlap, keep });
  return pageSlices(tops, measured.contentHeight, pageHeight, overlap);
}

/**
 * The page slices of a measured document that also has forced breaks (`break-before: page`): each break starts a new
 * page, and what lies between two breaks is paginated on its own ({@link flowPages}). A page a break starts keeps the
 * break margin above its content, as the pages after a cut do. Breaks at or before the top, past the content, or
 * within 1 px of another are ignored. At most `maxPages` slices; the rest of the document is left out.
 */
export function flowPagesWithBreaks(
  measured: { contentHeight: number; bands: readonly Interval[]; blocks: readonly KeepBlock[] },
  pageHeight: number,
  breaks: readonly number[],
  maxPages = MAX_FLOW_PAGES,
): PageSlice[] {
  const starts = [0];
  for (const at of [...breaks].sort((a, b) => a - b)) if (at > starts[starts.length - 1]! + 1 && at < measured.contentHeight - 1) starts.push(at);
  if (starts.length === 1) return flowPages(measured, pageHeight, maxPages);
  const margin = breakMargin(pageHeight);
  const out: PageSlice[] = [];
  for (const [index, start] of starts.entries()) {
    const room = maxPages - out.length;
    if (room <= 0) break;
    const end = starts[index + 1] ?? measured.contentHeight;
    // A section is paginated as a document of its own that begins `lead` px above its content: the margin its first
    // page keeps. A band or block across a forced break belongs to neither side whole.
    const lead = index > 0 ? margin : 0;
    const shift = lead - start;
    const bands = measured.bands.filter((band) => band[0] >= start - 0.5 && band[1] <= end + 0.5).map((band): Interval => [band[0] + shift, band[1] + shift]);
    const blocks = measured.blocks
      .filter((block) => block.from >= start - 0.5 && block.bottom <= end + 0.5)
      .map((block) => ({ ...block, top: block.top + shift, bottom: block.bottom + shift, from: block.from + shift }));
    for (const [page, slice] of flowPages({ contentHeight: end - start + lead, bands, blocks }, pageHeight, room).entries()) {
      if (page === 0) out.push({ top: start, bottom: Math.max(start, slice.bottom - shift), offset: lead });
      else out.push({ top: slice.top - shift, bottom: slice.bottom - shift, offset: slice.offset });
    }
  }
  return out;
}
