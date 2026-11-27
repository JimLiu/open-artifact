import type { StockKind } from './stock-programs.ts';
/** A small chart of a kind, drawn from a few made-up series to show what the kind looks like. */
export interface ChartSketch {
  kind: StockKind;
  series: readonly (readonly number[])[];
}
/** One path of a chart's thumbnail, in a 20 by 20 box. */
export interface ThumbnailPath {
  color: string;
  isLine: boolean;
  path: string;
}
export function barThumbnailPaths(series: ChartSketch['series'], isStacked: boolean, isLying: boolean = false): ThumbnailPath[] {
  const columns = (series[0] ?? []).map(
    (_value, columnIndex) => series.map((values) => values[columnIndex] ?? 0),
  );
  const columnTotals = columns.map((column) => (isStacked ? sumNumbers(column) : Math.max(...column)));
  const yScale = thumbnailYScale(Math.min(0, ...columns.flat()), Math.max(0, ...columnTotals));
  const slotWidth = 17.5 / columns.length;
  const barWidth = (slotWidth - 1.5) / (isStacked ? 1 : series.length);
  return series.map(
    (_values, seriesIndex) => ({
      color: chartCategoricalColor(seriesIndex),
      isLine: false,
      path: columns
        .map((column, columnIndex) => {
          const base = isStacked ? sumNumbers(column.slice(0, seriesIndex)) : 0;
          const [fromY, toY] = [yScale(base), yScale(base + (column[seriesIndex] ?? 0))];
          const barHeight = Math.max(Math.abs(fromY - toY), 0.5);
          const barStart = 2 + columnIndex * slotWidth + (isStacked ? 0 : seriesIndex * barWidth);
          return isLying
            ? `M${20 - Math.max(fromY, toY)} ${barStart}h${barHeight}v${barWidth}h${-barHeight}z`
            : `M${barStart} ${Math.min(fromY, toY)}h${barWidth}v${barHeight}h${-barWidth}z`;
        })
        .join(''),
    }),
  );
}
export function lineThumbnailPaths(series: ChartSketch['series']): ThumbnailPath[] {
  const yScale = thumbnailYScale(Math.min(...series.flat()), Math.max(...series.flat()));
  return series.map(
    (points, seriesIndex) => ({
      color: chartCategoricalColor(seriesIndex),
      isLine: true,
      path: points
        .map(
          (point, pointIndex) =>
            `${pointIndex === 0 ? 'M' : 'L'}${2 + (16 * pointIndex) / Math.max(points.length - 1, 1)} ${yScale(point)}`,
        )
        .join(''),
    }),
  );
}
export function pieThumbnailPaths(slices: readonly number[]): ThumbnailPath[] {
  const total = Math.max(sumNumbers(slices), Number.MIN_VALUE);
  const [center, radius] = [10, 8];
  const innerRadius = 0.6 * radius;
  const pointOnCircle = (fraction: number, circleRadius: number) =>
    `${center + circleRadius * Math.sin(2 * Math.PI * fraction)} ${center - circleRadius * Math.cos(2 * Math.PI * fraction)}`;
  return slices.map((_slice, sliceIndex) => {
    const startFraction = sumNumbers(slices.slice(0, sliceIndex)) / total;
    const endFraction = sumNumbers(slices.slice(0, sliceIndex + 1)) / total;
    const largeArcFlag = endFraction - startFraction > 0.5 ? 1 : 0;
    return {
      color: chartCategoricalColor(sliceIndex),
      isLine: false,
      path: `M${pointOnCircle(startFraction, radius)}A${radius} ${radius} 0 ${largeArcFlag} 1 ${pointOnCircle(endFraction, radius)}L${pointOnCircle(endFraction, innerRadius)}A${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${pointOnCircle(startFraction, innerRadius)}z`,
    };
  });
}
export function areaThumbnailPaths(series: ChartSketch['series']): ThumbnailPath[] {
  const yScale = thumbnailYScale(Math.min(0, ...series.flat()), Math.max(0, ...series.flat()));
  return series
    .map((list, seriesIndex) => ({
      list,
      color: chartCategoricalColor(seriesIndex),
    }))
    .toSorted((first, second) => sumNumbers(second.list) - sumNumbers(first.list))
    .map(({ list, color }) => {
      const lines = list.map((point, pointIndex) => `L${2 + (16 * pointIndex) / Math.max(list.length - 1, 1)} ${yScale(point)}`);
      return {
        color,
        isLine: false,
        path: `M2 ${yScale(0)}${lines.join('')}V${yScale(0)}z`,
      };
    });
}
export function scatterThumbnailPaths([first = [], second]: ChartSketch['series']): ThumbnailPath[] {
  const [xs, ys] = second === undefined ? [first.map((_value, index) => index), first] : [first, second];
  const radius = SCATTER_THUMBNAIL_DOT_RADIUS;
  const dots = xs.map((x, index) => {
    const left = 2 + (16 - 2 * radius) * unitPositionIn(xs, x);
    const top = 2 + radius + (16 - 2 * radius) * (1 - unitPositionIn(ys, ys[index] ?? 0));
    return `M${left} ${top}a${radius} ${radius} 0 1 0 ${2 * radius} 0a${radius} ${radius} 0 1 0 ${-2 * radius} 0z`;
  });
  return [
    {
      color: chartCategoricalColor(0),
      isLine: false,
      path: dots.join(''),
    },
  ];
}
export function chartThumbnailPaths({ kind, series }: ChartSketch): ThumbnailPath[] {
  switch (kind) {
    case 'bar':
      return barThumbnailPaths(series, false);
    case 'horizontalBar':
      return barThumbnailPaths(series, false, true);
    case 'stackedBar':
      return barThumbnailPaths(series, true);
    case 'stackedBar100':
      return barThumbnailPaths(sharesOfWholeSeries(series), true);
    case 'line':
      return lineThumbnailPaths(series);
    case 'area':
      return areaThumbnailPaths(series);
    case 'scatter':
      return scatterThumbnailPaths(series);
    case 'pie':
      return pieThumbnailPaths(series[0] ?? []);
  }
}
export const chartCategoricalColor = (seriesIndex: number) => `var(--ui-chart-categorical-${seriesIndex + 1})`;
export const sumNumbers = (numbers: readonly number[]) => numbers.reduce((total, value) => total + value, 0);
export const thumbnailYScale =
  (min: number, max: number) =>
  (value: number) =>
    2 + 16 * (1 - (max === min ? 0 : (value - min) / (max - min)));
/** Each value as its share of the sum of all the series at its place. */
export const sharesOfWholeSeries = (series: ChartSketch['series']): number[][] =>
  series.map((list) =>
    list.map((value, index) => value / Math.max(sumNumbers(series.map((other) => other[index] ?? 0)), Number.MIN_VALUE)),
  );
export const SCATTER_THUMBNAIL_DOT_RADIUS = 1.4;
/** Where a value lies between the least and the greatest of values, from 0 to 1. */
export const unitPositionIn = (values: readonly number[], value: number): number =>
  (value - Math.min(...values)) / Math.max(Math.max(...values) - Math.min(...values), Number.MIN_VALUE);
