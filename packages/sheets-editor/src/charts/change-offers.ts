import type { ChartInputs } from '../chart-frame/messages.ts';
import type { ChartCellsProblem } from '../messages/charts.ts';
import { canSwapChartKind } from './chart-kind-fit.ts';
import type { ChartSketch } from './chart-thumbnail-paths.ts';
import type { ChartOfView } from './placed-views.ts';
import { STOCK_CHART_KINDS } from './stock-programs.ts';

// What "Change chart type" offers for a chart. It lives apart from the layer that draws the menu, so that it can be
// tested without the layer's components.

/** A kind offered under "Change chart type", and whether the page swaps to it alone (or the agent writes it). */
export type ChartChangeOffer = ChartSketch & { isSwap: boolean };

/** Why the cells a chart reads cannot be drawn: none holds a number, or some hold errors. Null when they can be. */
export function chartCellsProblem(inputs: ChartInputs): ChartCellsProblem | null {
  const areas = Object.values(inputs);
  if (areas.length === 0) return null;
  let hasErrorCells = false;
  for (const area of areas) {
    const hasManyColumns = area.some((row) => row.length > 1);
    for (const [rowIndex, row] of area.entries())
      for (const [columnIndex, { value, text }] of row.entries()) {
        const isLabelCell = (rowIndex === 0 && area.length > 1) || (columnIndex === 0 && hasManyColumns);
        if (typeof value === 'number' || (value !== null && !isLabelCell)) return null;
        hasErrorCells ||= value === null && text !== '';
      }
  }
  return hasErrorCells ? 'cellsHaveErrors' : 'cellsHaveNoNumbers';
}
/**
 * Whether this chart can be changed here: by a kind swap the page makes alone, or by the agent. Of the changes to
 * charts only whether there are any is read.
 */
export const canAskChartChange = (changes: object | null, chart: ChartOfView, canAgentWrite = false): boolean =>
  changes !== null &&
  chart.kind !== 'none' &&
  chartCellsProblem(chart.inputs) === null &&
  (canAgentWrite || STOCK_CHART_KINDS.some((kind) => canSwapChartKind(chart.inputs, kind)));
/**
 * The kinds offered under "Change chart type", marked with whether the page swaps to each alone. With the agent at hand
 * every kind offered stays; with none, only the kinds the page can swap this chart to by itself, none when there are none.
 */
export function chartChangeOffers(offers: readonly ChartSketch[], chart: ChartOfView, canAgentWrite: boolean): ChartChangeOffer[] {
  if (chart.kind === 'none') return [];
  let marked = offers.map((offer) => ({
    ...offer,
    isSwap: canSwapChartKind(chart.inputs, offer.kind),
  }));
  return canAgentWrite ? marked : marked.filter(({ isSwap }) => isSwap);
}
