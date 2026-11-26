/**
 * The arithmetic of {@link TabStrip} (`tab-strip.tsx`), apart from the page so it can be tested on its own: which tabs
 * fit in the row and what room the ones whose title is cut are given, where a dragged tab is drawn and lands, where a tab picked from
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

/** Where the dragged tab is, for {@link dragLeft} and {@link dragOrder}; all in the row's own coordinates. */
export interface DragBox {
  /** Its left edge where the pointer puts it, before the row holds it. */
  left: number;
  width: number;
  /** The left edge of the place it is laid out in. */
  slot: number;
  /** The row's edges. */
  rowLeft: number;
  rowRight: number;
  /** Where the fixed tabs end (-Infinity when there are none): the dragged tab goes no further left. */
  fixedEnd: number;
}

/** Room left between the dragged tab and the row's ends. */
export const DRAG_EDGE_PX = 4;

/** Where the dragged tab is drawn: under the pointer, held inside the row and right of the fixed tabs. */
export function dragLeft(drag: DragBox): number {
  return Math.min(Math.max(drag.left, drag.rowLeft + DRAG_EDGE_PX, drag.fixedEnd), drag.rowRight - DRAG_EDGE_PX - drag.width);
}

/**
 * The order while a tab is dragged. It goes after every other tab of the row it has passed: one whose middle its own
 * middle (held inside the row) has passed, or, when it covers the other tab whole, one laid out after its place. Held
 * against the fixed tabs, it goes first. `row` is the tabs shown that can move, in order; `boxOf` says where another
 * tab is laid out.
 */
export function dragOrder(
  order: readonly string[],
  row: readonly string[],
  id: string,
  drag: DragBox,
  boxOf: (id: string) => { left: number; width: number } | undefined,
): string[] {
  const right = drag.left + drag.width;
  const middle = Math.min(Math.max(drag.left + drag.width / 2, drag.rowLeft + DRAG_EDGE_PX), drag.rowRight - DRAG_EDGE_PX);
  let passed = 0;
  for (const other of row) {
    const box = other === id ? undefined : boxOf(other);
    if (!box) continue;
    const covers = drag.left < box.left && right > box.left + box.width;
    if (covers ? box.left > drag.slot : middle > box.left + box.width / 2) passed++;
  }
  if (dragLeft(drag) <= drag.fixedEnd + 1) passed = 0;
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
