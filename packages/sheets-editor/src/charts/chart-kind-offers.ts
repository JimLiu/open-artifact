import * as React from 'react';
import type { ChartEditsByAgent } from './agent-edits.ts';
import { CHART_ROWS_INPUT } from './chart-kind-fit.ts';
import { chartKindsOfferedForRows, type ChartOfferOfCells } from './chart-offers.ts';
import type { ChartSketch } from './chart-thumbnail-paths.ts';
import { chartKindName, makeThisChartKindPrompt } from './chart-words.ts';
import type { ChartOfView } from './placed-views.ts';
import { STOCK_CHART_KINDS, type StockKind } from './stock-programs.ts';

// Which kinds of chart the ask menu offers for a chart, and which kind the words typed in it name.

/** The kinds a menu shows at once, and those it keeps under More types. */
export interface KindRowsShownAndMore {
  shown: readonly StockKind[];
  more: readonly StockKind[];
}
/** The kind a chart is known to be now, read for the node it was read for. */
interface KindKnown {
  nodeId: string;
  kind: StockKind | null;
}
/** What the ask menu of a chart is to offer: the kinds, drawn, and the kind the chart is now. */
export interface ChartKindOffers {
  onOffer: readonly ChartSketch[];
  kindNow: StockKind | null;
}
export function kindRowsShownAndMore(kinds: readonly StockKind[], kindNow: StockKind | null): KindRowsShownAndMore {
  if (kinds.length <= MAX_KIND_ROWS_SHOWN + 1)
    return {
      shown: kinds,
      more: [],
    };
  let first = kinds.slice(0, MAX_KIND_ROWS_SHOWN),
    shown = kindNow === null || first.includes(kindNow) || !kinds.includes(kindNow) ? first : [...first.slice(0, -1), kindNow];
  return {
    shown,
    more: kinds.filter((kind) => !shown.includes(kind)),
  };
}
export function chartKindTypedFor(typed: string, kinds: readonly StockKind[]): StockKind | null {
  let words = wordsOfKindName(typed);
  if (words.join('').length < MIN_KIND_WORDS_LENGTH) return null;
  let found = kinds
    .map((kind) => ({
      kind,
      name: wordsOfKindName(chartKindName(kind)),
    }))
    .filter(({ name }) => words.every((word) => name.some((nameWord) => nameWord.startsWith(word))));
  if (found.length === kinds.length) return null;
  return found.toSorted((a, b) => a.name.length - b.name.length)[0]?.kind ?? null;
}
export function chartKindOffersOfChart(chart: ChartOfView, kindNow: StockKind | null): readonly ChartSketch[] {
  let { [CHART_ROWS_INPUT]: rows = [], ...otherInputs } = chart.kind === 'none' ? {} : chart.inputs,
    offers: readonly ChartOfferOfCells[] = Object.keys(otherInputs).length > 0 ? [] : chartKindsOfferedForRows(rows, kindNow),
    [firstOffer] = offers;
  return firstOffer?.isForPage === true && (kindNow !== null || !firstOffer.isBestLeftToAgent) ? offers : SAMPLE_CHART_KIND_OFFERS;
}
export function useChartKindOffers({
  chart,
  isSelected,
  changes,
  isCardOpen,
}: {
  chart: ChartOfView;
  isSelected: boolean;
  changes: Pick<ChartEditsByAgent, 'kindOf'> | null;
  isCardOpen: boolean;
}): ChartKindOffers {
  let nodeId = isSelected && chart.kind !== 'none' ? chart.nodeId : null,
    [known, setKnown] = React.useState<KindKnown | null>(null);
  React.useEffect(() => {
    if (nodeId === null || changes === null) return;
    let isAlive = true;
    return (
      changes
        .kindOf(nodeId)
        .catch(() => null)
        .then((kind) =>
          isAlive
            ? setKnown({
                nodeId,
                kind,
              })
            : void 0,
        ),
      () => {
        isAlive = false;
      }
    );
  }, [nodeId, changes]);
  let kindNow = known !== null && known.nodeId === nodeId ? known.kind : null,
    offers = React.useMemo(() => (nodeId === null ? NO_CHART_KIND_OFFERS : chartKindOffersOfChart(chart, kindNow)), [chart, nodeId, kindNow]),
    [keptOffers, setKeptOffers] = React.useState(offers);
  if (keptOffers !== offers && (!isCardOpen || keptOffers === NO_CHART_KIND_OFFERS)) setKeptOffers(offers);
  return {
    onOffer: keptOffers === NO_CHART_KIND_OFFERS ? SAMPLE_CHART_KIND_OFFERS : keptOffers,
    kindNow,
  };
}
export const MAX_KIND_ROWS_SHOWN = 3;
export const wordsOfKindName = (written: string): string[] => written.toLowerCase().split(/\s+/).filter(Boolean);
export const MIN_KIND_WORDS_LENGTH = 2;
export const SAMPLE_CHART_KIND_OFFERS: readonly ChartSketch[] = [
  {
    kind: 'bar',
    series: [
      [3, 5, 4, 7],
      [2, 3, 5, 4],
    ],
  },
  {
    kind: 'line',
    series: [
      [2, 4, 3, 6, 5, 8],
      [1, 2, 4, 3, 5, 4],
    ],
  },
  {
    kind: 'pie',
    series: [[5, 3, 2, 1]],
  },
  {
    kind: 'horizontalBar',
    series: [[7, 5, 4, 2]],
  },
  {
    kind: 'stackedBar',
    series: [
      [3, 4, 3, 5, 4],
      [2, 2, 3, 2, 4],
      [1, 2, 1, 2, 2],
    ],
  },
  {
    kind: 'stackedBar100',
    series: [
      [3, 4, 3, 5, 4],
      [2, 2, 3, 2, 4],
      [1, 2, 1, 2, 2],
    ],
  },
  {
    kind: 'area',
    series: [
      [2, 3, 3, 5, 4, 6],
      [1, 2, 2, 2, 3, 3],
    ],
  },
  {
    kind: 'scatter',
    series: [
      [1, 2, 3, 4, 5, 6, 7],
      [2, 1, 4, 3, 6, 4, 7],
    ],
  },
];
export const longestChartKindPromptLength = (): number => Math.max(...STOCK_CHART_KINDS.map((kind) => makeThisChartKindPrompt(kind).length));
export const NO_CHART_KIND_OFFERS: readonly ChartSketch[] = [];
