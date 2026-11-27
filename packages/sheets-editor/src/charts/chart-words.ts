import { translateMessage } from '../i18n/messages.ts';
import { chartMessages, type ChartChangeRefusal } from '../messages/charts.ts';
import { STOCK_KINDS, type StockKind } from './stock-programs.ts';
import { cleanAskWords, MAX_ASK_WORDS_LENGTH } from '../agent/ask-words.ts';
/** A kind of chart asked for, or 'any' when the agent is to pick it. */
export type ChartKindOrAny = StockKind | 'any';
/** Why no chart was made or changed. */
export type WhyNoChart = 'noCells' | 'filterCutsTable' | ChartChangeRefusal;
export function chartKindName(chartKind: StockKind): string {
  switch (chartKind) {
    case 'bar':
      return translateMessage({
        defaultMessage: 'Bar chart',
        id: 'h0g1Vqlau5',
      });
    case 'stackedBar':
      return translateMessage({
        defaultMessage: 'Stacked bar chart',
        id: 'JjXDcaZpv+',
      });
    case 'line':
      return translateMessage({
        defaultMessage: 'Line chart',
        id: 'RZzs6837Hn',
      });
    case 'horizontalBar':
      return translateMessage({
        defaultMessage: 'Horizontal bar chart',
        id: 'KH4GEIq7SJ',
      });
    case 'stackedBar100':
      return translateMessage({
        defaultMessage: '100% stacked bar chart',
        id: 'E3OzqYaD/J',
      });
    case 'area':
      return translateMessage({
        defaultMessage: 'Area chart',
        id: 'oHD1yR2fg6',
      });
    case 'scatter':
      return translateMessage({
        defaultMessage: 'Scatter chart',
        id: 'JlhAD1md/O',
      });
    case 'pie':
      return translateMessage({
        defaultMessage: 'Pie chart',
        id: 'EGV7QC2EPp',
      });
  }
}
export function makeThisChartKindPrompt(chartKind: StockKind): string {
  switch (chartKind) {
    case 'bar':
      return translateMessage({
        defaultMessage: 'Make this a bar chart.',
        id: 'CNs6ODvENZ',
      });
    case 'stackedBar':
      return translateMessage({
        defaultMessage: 'Make this a stacked bar chart.',
        id: '2XL7tafjza',
      });
    case 'line':
      return translateMessage({
        defaultMessage: 'Make this a line chart.',
        id: 'JBVkeM+k+u',
      });
    case 'horizontalBar':
      return translateMessage({
        defaultMessage: 'Make this a horizontal bar chart.',
        id: '4qDMpXxGZS',
      });
    case 'stackedBar100':
      return translateMessage({
        defaultMessage: 'Make this a 100% stacked bar chart.',
        id: '7H2e0Yaxcr',
      });
    case 'area':
      return translateMessage({
        defaultMessage: 'Make this an area chart.',
        id: 'mUJFW2x3/r',
      });
    case 'scatter':
      return translateMessage({
        defaultMessage: 'Make this a scatter chart.',
        id: '5vpMbWf3SZ',
      });
    case 'pie':
      return translateMessage({
        defaultMessage: 'Make this a pie chart.',
        id: 'C965sMjdo4',
      });
  }
}
export function insertChartKindLabel(chartKind: StockKind): string {
  switch (chartKind) {
    case 'bar':
      return translateMessage({
        defaultMessage: 'Insert a bar chart',
        id: 'Lfxnp75dtL',
      });
    case 'stackedBar':
      return translateMessage({
        defaultMessage: 'Insert a stacked bar chart',
        id: 'k8MtB2oxVe',
      });
    case 'line':
      return translateMessage({
        defaultMessage: 'Insert a line chart',
        id: 'DZXCpZpNx9',
      });
    case 'horizontalBar':
      return translateMessage({
        defaultMessage: 'Insert a horizontal bar chart',
        id: 'oTe1GCgS//',
      });
    case 'stackedBar100':
      return translateMessage({
        defaultMessage: 'Insert a 100% stacked bar chart',
        id: 'YVYyB0QwMV',
      });
    case 'area':
      return translateMessage({
        defaultMessage: 'Insert an area chart',
        id: '8h2oVT8Irs',
      });
    case 'scatter':
      return translateMessage({
        defaultMessage: 'Insert a scatter chart',
        id: 'p2TEopyUcL',
      });
    case 'pie':
      return translateMessage({
        defaultMessage: 'Insert a pie chart',
        id: '52tvPvpPcD',
      });
  }
}
export const CHART_MESSAGES = {
  insertChart: () =>
    translateMessage({
      defaultMessage: 'Insert chart',
      id: 'Bfp3cHLaOL',
    }),
  makeChart: () =>
    translateMessage({
      defaultMessage: 'Make chart',
      id: '3H8Nzms0bh',
    }),
  askAgentToMakeAChart: () =>
    translateMessage({
      defaultMessage: 'Ask Agent to make a chart',
      id: 'jzs0w5PjXY',
    }),
  makeThisChart: () =>
    translateMessage({
      defaultMessage: 'Make this chart',
      id: 'sLul2OCq4r',
    }),
  changeThisChart: () =>
    translateMessage({
      defaultMessage: 'Change this chart',
      id: 'i/AHEyRlo6',
    }),
  changeChartType: () =>
    translateMessage({
      defaultMessage: 'Change chart type',
      id: 'ri77/2X9BY',
    }),
  suggested: () =>
    translateMessage({
      defaultMessage: 'Suggested',
      id: 'Cp45SUo5//',
    }),
  quickChart: () =>
    translateMessage({
      defaultMessage: 'Quick chart',
      id: 'e6Ei6cO/3q',
    }),
  quickChartSaid: () =>
    translateMessage({
      defaultMessage: 'Quick chart, made by Agent',
      id: 'GcxlD02qjU',
    }),
  oneRangeNeeded: () =>
    translateMessage({
      defaultMessage: 'Select just one group of cells to insert a chart.',
      id: 'FiKkM95Fj+',
    }),
  filterCutsCells: () =>
    translateMessage({
      defaultMessage: 'Clear the filter to insert a chart from these cells.',
      id: 'P9304jPC57',
    }),
  chartAdded: () =>
    translateMessage({
      defaultMessage: 'Chart added',
      id: 'cx77hK/q4s',
    }),
  chartAddedWithValuesNotShown: (count: number) =>
    translateMessage(
      {
        defaultMessage:
          '{count, plural, one {Chart added. # value isn’t a number and isn’t shown.} other {Chart added. # values aren’t numbers and aren’t shown.}}',
        id: 'Mxr9vMyv89',
      },
      {
        count,
      },
    ),
  chartNotAdded: () =>
    translateMessage({
      defaultMessage: 'Couldn’t add the chart. Try again.',
      id: 'L8NWOxl5ld',
    }),
  noRoomForChart: () =>
    translateMessage({
      defaultMessage: 'Couldn’t add the chart. This Sheet has as many charts as it can hold. Delete one to add another.',
      id: 'gFyWwXZP9K',
    }),
  chartCannotBeAdded: () =>
    translateMessage({
      defaultMessage: 'Couldn’t add the chart.',
      id: 'fS5qQHDzny',
    }),
  undoChartAdded: () =>
    translateMessage({
      defaultMessage: 'Undo adding the chart',
      id: 'syynHhjDIB',
    }),
  makingChart: () =>
    translateMessage({
      defaultMessage: 'Making the chart…',
      id: 'es90R4zGXk',
    }),
  chartAddedByAgent: () =>
    translateMessage({
      defaultMessage: 'Agent added a chart',
      id: '/EpyL2dtcl',
    }),
  chartStopped: () =>
    translateMessage({
      defaultMessage: 'Stopped making the chart because you switched sheets.',
      id: 'zEkNfNuspB',
    }),
  chartNotMade: () =>
    translateMessage({
      defaultMessage: 'Couldn’t make the chart. Try again.',
      id: 'QxGSmtjlrk',
    }),
  chartNotToBeHadHere: () =>
    translateMessage({
      defaultMessage: 'Agent can’t make this chart here.',
      id: 'C8e2TwE8e3',
    }),
  noCellsToChart: () =>
    translateMessage({
      defaultMessage: 'Select cells with data to chart first.',
      id: 'MJfAyaJUoW',
    }),
  nameOfChartOfAnyKind: () =>
    translateMessage({
      defaultMessage: 'Chart',
      id: 'wLYh8d3bvc',
    }),
  moreTypes: () =>
    translateMessage({
      defaultMessage: 'More types',
      id: 'FnlSEzttQE',
    }),
  noAgent: () =>
    translateMessage({
      defaultMessage: 'Agent isn’t available in this Sheet.',
      id: 'k8yqYuBise',
    }),
};
export const chartCaptionOrName = (chartKind: ChartKindOrAny, caption: string): string =>
  caption !== '' ? caption : chartKind === 'any' ? CHART_MESSAGES.quickChart() : chartKindName(chartKind);
export const chartKindNameOrAny = (chartKind: ChartKindOrAny): string =>
  chartKind === 'any' ? CHART_MESSAGES.nameOfChartOfAnyKind() : chartKindName(chartKind);
export const chartRefusalText = (why: WhyNoChart): string =>
  (
    ({
      noCells: CHART_MESSAGES.noCellsToChart,
      filterCutsTable: CHART_MESSAGES.filterCutsCells,
      noAgent: CHART_MESSAGES.noAgent,
      tooLarge: CHART_MESSAGES.chartNotToBeHadHere,
      forChat: chartMessages.changeNeedsChatWithChart,
      notHere: CHART_MESSAGES.chartNotToBeHadHere,
      notChanged: CHART_MESSAGES.chartNotMade,
    })
  )[why]();
export const MAX_CHART_TITLE_CHARS = 60;
/** What a row of a kind asks with: the page's "Make this a … chart." before the words typed, if any. */
export const askWordsOfKind = (kind: ChartKindOrAny, words: string) =>
  kind === 'any' ? words : [makeThisChartKindPrompt(kind), words.trim()].join(' ').trim();
/**
 * The most UTF-16 units of an ask that the page hands on when it writes a chart's code with the agent: all the words an
 * Ask field may hold, and room for the kind's sentence put before them, so words within the Ask limit are never cut.
 */
export const mostAskedUnitsWithKind = () =>
  MAX_ASK_WORDS_LENGTH + 1 + Math.max(...STOCK_KINDS.map((kind) => makeThisChartKindPrompt(kind).length));
export const newChartTitle = (chartKind: ChartKindOrAny, prompt: string): string =>
  chartKind !== 'any'
    ? chartKindName(chartKind)
    : prompt !== ''
      ? cleanAskWords(prompt.slice(0, MAX_CHART_TITLE_CHARS))
      : translateMessage({
          defaultMessage: 'New chart',
          id: 'L4jZHAul7X',
        });
