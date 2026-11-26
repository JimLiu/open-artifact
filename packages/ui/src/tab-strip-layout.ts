/**
 * The arithmetic of {@link TabStrip} (`tab-strip.tsx`), apart from the page so it can be tested on its own: which tabs
 * fit in the row and what room the ones whose title is cut are given, where a dragged tab lands, where a tab picked from
 * the list of those that do not fit goes, and what each Close item of a tab's menu closes.
 */

/** What {@link fitTabs} measures, one entry per tab in the order shown. */
export interface FitInput {
  ids: readonly string[];
  /** Stays first and is never put in the list. */
  fixed: readonly boolean[];
  /** Each tab's width on its own (the room it was given taken off). */
  widths: readonly number[];
  /** What each tab's title needs on top of that to be whole. */
  needs: readonly number[];
  /** The space between two tabs. */
  gap: number;
  /** The room for the tabs (the row's width less + and the space before it). */
  avail: number;
  /** ▾'s width with the space before it: taken off the room once some tabs do not fit. */
  more: number;
  /** The tab in front: kept in sight. */
  activeId: string;
  /** The first tab shown (of those not fixed) the last time: kept while the tab in front stays in sight. */
  start: number;
}

export interface Fit {
  /** Tabs that do not fit: out of the row, in the list. */
  hidden: Set<string>;
  /** Room given to a tab whose title is cut, out of what the row has left over. */
  stretch: Map<string, number>;
  /** Tabs whose title is still cut: it fades out at its end. */
  clipped: Set<string>;
  /** The first tab shown, of those not fixed. */
  start: number;
}

/** Which tabs fit in the row. */
export function fitTabs(input: FitInput): Fit {
  const { ids, fixed, widths, needs, gap, avail, more, activeId } = input;
  const fit: Fit = { hidden: new Set(), stretch: new Map(), clipped: new Set(), start: 0 };
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, ids.length - 1);
  if (total > avail + 0.5) {
    const moving = ids.map((_, i) => i).filter((i) => !fixed[i]);
    const fixedWidth = ids.reduce((sum, _, i) => (fixed[i] ? sum + widths[i] + gap : sum), 0);
    const space = avail - more - fixedWidth;
    const span = (from: number, to: number) => {
      let w = gap * (to - from);
      for (let k = from; k <= to; k++) w += widths[moving[k]];
      return w;
    };
    const count = moving.length;
    const front = moving.findIndex((i) => ids[i] === activeId);
    let first = Math.min(Math.max(0, input.start), Math.max(0, count - 1));
    if (front >= 0) {
      if (front < first) first = front;
      else while (first < front && span(first, front) > space) first++;
    }
    let last = first;
    while (last + 1 < count && span(first, last + 1) <= space) last++;
    // Closing tabs at the end leaves room: the tabs before come back into it.
    if (last === count - 1) while (first > 0 && span(first - 1, last) <= space) first--;
    fit.start = first;
    moving.forEach((i, k) => (k < first || k > last) && fit.hidden.add(ids[i]));
    // What is left over goes to the tabs shown whose title is cut, the ones that need least first.
    let spare = count ? Math.floor(space - span(first, last)) : 0;
    const wants = moving
      .slice(first, last + 1)
      .map((i) => ({ id: ids[i], px: Math.ceil(needs[i]) }))
      .filter((want) => want.px > 1)
      .sort((a, b) => a.px - b.px);
    wants.forEach((want, k) => {
      const give = Math.max(0, Math.min(want.px, Math.floor(spare / (wants.length - k))));
      spare -= give;
      if (give > 0) fit.stretch.set(want.id, give);
    });
  }
  ids.forEach((id, i) => needs[i] - (fit.stretch.get(id) ?? 0) > 1 && fit.clipped.add(id));
  return fit;
}

/** Whether two fits show the same thing. */
export const sameFit = (a: Fit, b: Fit) => fitKey(a) === fitKey(b);
const fitKey = (fit: Fit) =>
  [[...fit.hidden].join(','), [...fit.stretch].map(([id, px]) => `${id}=${px}`).join(','), [...fit.clipped].join(',')].join('|');

/** The order with `id` moved to `to`. */
export function moveTo(order: readonly string[], id: string, to: number): string[] {
  const next = order.filter((x) => x !== id);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
  return next;
}

/**
 * The order while a tab is dragged: it goes after every other tab of the row whose middle its own middle has passed.
 * `row` is the tabs shown that can move, in order; `middleOf` says where another tab's middle is.
 */
export function dragOrder(order: readonly string[], row: readonly string[], id: string, middle: number, middleOf: (id: string) => number): string[] {
  const passed = row.filter((other) => other !== id && middleOf(other) < middle).length;
  return moveTo(order, id, order.indexOf(row[0]) + passed);
}

/** Where a tab picked from the list goes: next to the last tab shown. Null when it stays where it is. */
export function pickedPlace(order: readonly string[], id: string, lastShown: string | undefined): number | null {
  const last = lastShown === undefined ? -1 : order.indexOf(lastShown);
  const from = order.indexOf(id);
  if (last < 0 || from < 0) return null;
  const to = from < last + 1 ? last : last + 1;
  return to === from ? null : to;
}

/** What the Close items of a tab's menu close: the others, the ones to its right, all (closable ones only). */
export function closeGroups(order: readonly string[], closable: (id: string) => boolean, id: string) {
  const all = order.filter(closable);
  return {
    others: all.filter((x) => x !== id),
    right: order.slice(order.indexOf(id) + 1).filter(closable),
    all,
  };
}
