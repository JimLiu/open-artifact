import type { StockKind } from '@open-artifact/sheets-core/stock-charts';
import type { ChartCell, ChartRow } from '../chart-frame/messages.ts';
import { MESSAGE_LOCALE } from '../i18n/messages.ts';

export { STOCK_CHART_PROGRAMS, STOCK_KINDS, type StockKind } from '@open-artifact/sheets-core/stock-charts';

const isNumericCell = (cell: ChartCell | undefined): boolean => typeof cell?.value === 'number';
const isYearLikeCell = ({ value }: ChartCell): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value > 1800 && value < 2200;
const hasText = (row: ChartRow): boolean => row.some(({ text }) => text !== '');

/** How many cells a stock chart of this kind leaves out of its drawing because they hold words and not numbers. */
export function countCellsLeftOutOfChart({ rows = [] }: { rows?: readonly ChartRow[] }, chartKind: StockKind | 'any'): number {
  const rowsWithText = rows.slice(0, 100).filter(hasText);
  const hasHeaderRow = rowsWithText.length > 1 && rowsWithText[0]?.some(isNumericCell) === false;
  const dataRows = rowsWithText.slice(hasHeaderRow ? 1 : 0);
  const columnCount = dataRows[0]?.length ?? 0;
  const firstColumnCells = dataRows.flatMap((row) => row.slice(0, 1));
  const firstColumnIsLabels = columnCount > 1 && (!firstColumnCells.some(isNumericCell) || firstColumnCells.every(isYearLikeCell));
  const isChartedColumn = (_cell: ChartCell, columnIndex: number): boolean =>
    columnIndex >= (firstColumnIsLabels ? 1 : 0) && dataRows.some((row) => isNumericCell(row[columnIndex]));
  return rows
    .filter(hasText)
    .slice(hasHeaderRow ? 1 : 0)
    .filter((row) => !firstColumnIsLabels || row[0]?.text !== '')
    .flatMap((row) => row.filter(isChartedColumn).slice(0, chartKind === 'pie' ? 1 : undefined))
    .filter((cell) => !isNumericCell(cell) && cell.text !== '').length;
}
/** Whether a label reads as a date, a time or a period, so that the cells under it run along time. */
export function looksLikeTimeLabel(text: string): boolean {
  if (DATE_OR_TIME_PATTERN.test(text.trim())) return true;
  let words = wordsOfTimeLabel(text);
  return words.some(isDateWord) && words.some(isShortNumberWord) && isMadeOfPeriodWords(text);
}
/** Whether every word of a label that is not a number names a month, a weekday or a period. */
export function isMadeOfPeriodWords(text: string): boolean {
  let words = wordsOfTimeLabel(text),
    wordsThatAreNotNumbers = words.filter((word) => !isShortNumberWord(word));
  return (
    wordsThatAreNotNumbers.length > 0 &&
    wordsThatAreNotNumbers.every(
      (word) =>
        isDateWord(word) ||
        CHART_PERIOD_WORD_PATTERN.test(word) ||
        (CHART_PERIOD_UNIT_PATTERN.test(word) && wordsThatAreNotNumbers.length < words.length),
    )
  );
}
/** Every kind of stock chart, in the order the menus list them. */
export const STOCK_CHART_KINDS: readonly StockKind[] = ['bar', 'horizontalBar', 'stackedBar', 'stackedBar100', 'line', 'area', 'scatter', 'pie'];
export const DATE_WORD_LOCALES: readonly (string | undefined)[] = [MESSAGE_LOCALE, undefined];
export const normalizeDateWord = (word: string): string => word.toLowerCase().replace(/\.$/, '');
export const dateWordsOf = (options: Intl.DateTimeFormatOptions, count: number, dateAt: (index: number) => number): string[] =>
  DATE_WORD_LOCALES.flatMap((locale) => {
    let format = new Intl.DateTimeFormat(locale, options);
    return Array.from({ length: count }, (_, index) => normalizeDateWord(format.format(dateAt(index))));
  });
export const monthAndWeekdayWords = (width: 'short' | 'long'): string[] => [
  ...dateWordsOf({ month: width, timeZone: 'UTC' }, 12, (index) => Date.UTC(2024, index, 1)),
  ...dateWordsOf({ weekday: width, timeZone: 'UTC' }, 7, (index) => Date.UTC(2024, 0, index + 1)),
];
export const collectDateWords = (): Set<string> => new Set([...monthAndWeekdayWords('short'), ...monthAndWeekdayWords('long')]);
let knownDateWords: Set<string> | null = null;
export const isDateWord = (word: string): boolean =>
  (knownDateWords ??= collectDateWords()).has(normalizeDateWord(word)) || /^sept\.?$/i.test(word);
export const wordsOfTimeLabel = (text: string): string[] => text.split(/[\s,'’/-]+/).filter((word) => word !== '');
export const isShortNumberWord = (word: string): boolean => /^\d{1,4}$/.test(word);
export const CHART_PERIOD_WORD_PATTERN = /^(?:q[1-4]|[1-4]q|h[12]|fy\d{2,4}|wk?\d{1,2})$/i;
export const CHART_PERIOD_UNIT_PATTERN = /^(?:day|week|wk|month|quarter|year|fy)$/i;
export const [MONTH_NUMBER_PATTERN, DAY_NUMBER_PATTERN] = ['(?:0?[1-9]|1[0-2])', '(?:0?[1-9]|[12]\\d|3[01])'];
export const DATE_OR_TIME_PATTERN = new RegExp(
  `^(?:\\d{4}[-/]${MONTH_NUMBER_PATTERN}(?:[-/]${DAY_NUMBER_PATTERN})?\\b|${DAY_NUMBER_PATTERN}([-/])${DAY_NUMBER_PATTERN}\\1\\d{2,4}\\b|${DAY_NUMBER_PATTERN}\\.${MONTH_NUMBER_PATTERN}\\.\\d{4}\\b|${MONTH_NUMBER_PATTERN}/(?:${DAY_NUMBER_PATTERN}|\\d{4})$|\\d{1,3}:[0-5]\\d)`,
);
