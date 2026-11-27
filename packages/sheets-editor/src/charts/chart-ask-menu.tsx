import { AgentMark, usePreloadWorkingMark } from '../kit/agent-mark.tsx';
import { Icon, type IconName } from '../kit/icon.tsx';
import { Shortcut } from '../kit/shortcut.tsx';
import * as React from 'react';
import { askTooLong } from '@open-artifact/editor-kit';
import { MAX_ASK_WORDS_LENGTH, cleanAskWords, tooLongNoteOf } from '../agent/ask-words.ts';
import type { ChartChangeStage } from './ask-to-change-chart.ts';
import { ChartThumbnail } from './chart-thumbnail.tsx';
import type { ChartSketch } from './chart-thumbnail-paths.ts';
import { STOCK_CHART_KINDS, type StockKind } from './stock-programs.ts';
import { chartKindTypedFor, kindRowsShownAndMore, type KindRowsShownAndMore } from './chart-kind-offers.ts';
import { chartKindName, CHART_MESSAGES, type ChartKindOrAny } from './chart-words.ts';
import { DrawnAndSaid, AgentWritingRow } from '../agent/agent-rows.tsx';
import { chartMessages } from '../messages/charts.ts';
import { AskOrPickList } from '../ui/ask-list/ask-or-pick-list.tsx';
import { SIDE_PANE_DEFAULT_WIDTH } from '../ui/side-pane/side-pane.tsx';
import { opensMoreRowsLabel } from '../i18n/menu-labels.ts';
import { CONTEXT_BAR_PART_ATTRIBUTE } from '../ui/toolbar-tooltip.tsx';
export let KEEP_CHANGE_ROW: 'keep';
export let DISCARD_CHANGE_ROW: 'discard';
/** Why the menu cannot ask the agent: the chat is not to be had, or it is not known yet. */
export type ChartMenuWhyNot = 'noChat' | 'waiting';
/** The rows that ask for a chart: of a kind, of any kind, or in the words typed. */
type ChartRowId = StockKind | typeof ASK_AGENT_ROW | typeof ANY_KIND_ROW | typeof MORE_KINDS_ROW;
/** Every row of the menu: those that ask for a chart, and those that keep or discard a change. */
type ChartMenuRowId = ChartRowId | typeof KEEP_CHANGE_ROW | typeof DISCARD_CHANGE_ROW;
interface ChartMenuRow {
  id: ChartRowId;
  mark: React.ReactNode;
  drawn: React.ReactNode;
  isChecked?: boolean;
  laysItselfOut?: boolean;
  givesPlaceToRows?: boolean;
}
/** Whether the menu shows only the kinds of chart, without the field, and whether it can be used that way. */
export interface KindsOnlyState {
  showsOnlyKinds: boolean;
  canBeUsed: boolean;
}
/** What decides whether the menu shows only the kinds of chart. */
export interface KindsOnlyDue {
  areOnlyKindsDue: boolean;
  canTakeKind: boolean;
  isFieldLocked: boolean;
}
export function defaultChartKindRows(canBeScattered: boolean): KindRowsShownAndMore {
  let shown = DEFAULT_CHART_KINDS.map(({ kind }) => kind);
  let more = STOCK_CHART_KINDS.filter((kind) => !shown.includes(kind) && (canBeScattered || kind !== 'scatter'));
  return {
    shown,
    more,
  };
}
export function chartKindOfRow(rowId: ChartMenuRowId): ChartKindOrAny | null {
  if (rowId === ASK_AGENT_ROW || rowId === ANY_KIND_ROW) return 'any';
  return STOCK_CHART_KINDS.find((kind) => kind === rowId) ?? null;
}
export function nextKindsOnlyState(state: KindsOnlyState, due: KindsOnlyDue): KindsOnlyState {
  let canBeUsedWith = (isShowingOnlyKinds: boolean) => due.canTakeKind || (!isShowingOnlyKinds && !due.isFieldLocked);
  let showsOnlyKinds = state.canBeUsed && canBeUsedWith(state.showsOnlyKinds) ? state.showsOnlyKinds : due.areOnlyKindsDue;
  return {
    showsOnlyKinds,
    canBeUsed: canBeUsedWith(showsOnlyKinds),
  };
}
interface ChartAskMenuProps {
  /** The kinds of chart offered for the cells, or for the chart to change to. */
  onOffer: readonly ChartSketch[];
  whyNot: ChartMenuWhyNot | null;
  canPageMakeChart: boolean;
  areKindsForPage?: boolean;
  onAsked: (kind: ChartKindOrAny, typed: string) => void;
  /** The menu changes a chart rather than making one. */
  changesChart?: boolean;
  /** Whether a scatter chart is among the kinds the menu may offer when it has no kinds of its own. */
  canBeScattered?: boolean;
  /** The kind the chart is now, checked among the rows. */
  kindNow?: StockKind | null;
  /** What marks the list of more kinds as part of what holds the menu. */
  marksOfMoreKinds?: Readonly<Record<string, boolean | string>>;
  noteOnLastAsk?: string | null;
  mostTyped?: number;
  typed: string;
  onTyped: (typed: string) => void;
  /** Whether a key belongs to something outside the menu, which the menu leaves alone. */
  isKeyOfAnother?: (event: React.KeyboardEvent<HTMLElement>) => boolean;
  change?: ChartChangeStage | null;
  /** What the agent was asked, shown in the field while it is at work. */
  askedOfAgent?: string;
  isKindAsked?: boolean;
  isNoteOfFault?: boolean;
  isLastAskNotToBeRepeated?: boolean;
  onChangeKept?: () => void;
  onSteppedBackFromChange: () => void;
}
export function ChartAskMenu({
  onOffer,
  whyNot,
  canPageMakeChart,
  areKindsForPage = canPageMakeChart,
  onAsked,
  changesChart = false,
  canBeScattered = true,
  kindNow = null,
  marksOfMoreKinds = CONTEXT_BAR_PART_MARKS,
  noteOnLastAsk = null,
  mostTyped = MAX_ASK_WORDS_LENGTH,
  typed,
  onTyped,
  isKeyOfAnother,
  change = null,
  askedOfAgent = '',
  isKindAsked = false,
  isNoteOfFault = true,
  isLastAskNotToBeRepeated = false,
  onChangeKept,
  onSteppedBackFromChange,
}: ChartAskMenuProps) {
  let canAskAgent = whyNot === null;
  usePreloadWorkingMark(canAskAgent);
  let [ownTyped, setOwnTyped] = React.useState('');
  let [typedText, setTypedText] = [typed ?? ownTyped, onTyped ?? setOwnTyped];
  let hasTyped = cleanAskWords(typedText) !== '';
  let canTakeKind = (!hasTyped && onOffer.length > 0 && canPageMakeChart) || canAskAgent;
  let [kindAtFirst] = React.useState(kindNow);
  let { shown: shownKinds, more: moreKinds } =
    onOffer.length > 0
      ? kindRowsShownAndMore(
          onOffer.map(({ kind }) => kind),
          kindAtFirst,
        )
      : defaultChartKindRows(canBeScattered);
  let kindNamed = change === null ? chartKindTypedFor(typedText, [...shownKinds, ...moreKinds]) : null;
  let canTakeNamedKind = (onOffer.length > 0 && canPageMakeChart) || canAskAgent;
  let canTakeRow = (rowId: ChartMenuRowId) =>
    chartKindOfRow(rowId) === 'any' ? canAskAgent : rowId === kindNamed ? canTakeNamedKind : canTakeKind;
  let withUsability = (row: ChartMenuRow) => ({
    ...row,
    isOutOfUse: !canTakeRow(row.id),
  });
  let [isFieldLocked, setIsFieldLocked] = React.useState(whyNot === 'noChat');
  let nextIsFieldLocked = isFieldLockedForNoChat(isFieldLocked, whyNot);
  if (nextIsFieldLocked !== isFieldLocked) setIsFieldLocked(nextIsFieldLocked);
  let areOnlyKindsDue = whyNot === 'noChat' && areKindsForPage && onOffer.length > 0;
  let [kindsOnly, setKindsOnly] = React.useState(NO_KINDS_ONLY_STATE);
  let nextKindsOnly = nextKindsOnlyState(kindsOnly, {
    areOnlyKindsDue,
    canTakeKind,
    isFieldLocked: nextIsFieldLocked,
  });
  let { showsOnlyKinds } = nextKindsOnly;
  if (showsOnlyKinds !== kindsOnly.showsOnlyKinds || nextKindsOnly.canBeUsed !== kindsOnly.canBeUsed) setKindsOnly(nextKindsOnly);
  let [hasRoomBeside, setHasRoomBeside] = React.useState(true);
  let [rowToPointAt, setRowToPointAt] = React.useState<StockKind | null>(null);
  let kindRow = (kind: StockKind, markOfNone: React.ReactNode = EMPTY_ROW_MARK): ChartMenuRow => {
    let offered = onOffer.find((chart) => chart.kind === kind);
    let icon = DEFAULT_CHART_KINDS.find((defaultKind) => defaultKind.kind === kind)?.icon;
    return {
      id: kind,
      mark:
        offered !== undefined
          ? <ChartThumbnail chart={offered} size={CHART_THUMBNAIL_SIZE} isOutOfUse={!canTakeRow(kind)} />
          : icon !== undefined
            ? <Icon name={icon} size="md" />
            : markOfNone,
      drawn: chartKindName(kind),
      isChecked: kind === kindNow,
    };
  };
  let moreKindsNotNamed = moreKinds.filter((kind) => kind !== kindNamed);
  let moreKindsRow: ChartMenuRow = {
    id: MORE_KINDS_ROW,
    mark: <Icon name="DotsHorizontal" size="md" />,
    laysItselfOut: true,
    givesPlaceToRows: !hasRoomBeside,
    drawn: (<><span className="min-w-0 flex-1 truncate"><DrawnAndSaid drawn={CHART_MESSAGES.moreTypes()} said={opensMoreRowsLabel(CHART_MESSAGES.moreTypes())} /></span><span className="flex w-5 shrink-0 justify-center text-muted"><Icon name={hasRoomBeside ? 'CaretRight' : 'CaretDown'} size="sm" /></span></>),
  };
  let kindRows: ChartMenuRow[] = [
    ...shownKinds.filter((kind) => kind !== kindNamed).map((kind) => kindRow(kind)),
    ...(rowToPointAt !== null
      ? moreKindsNotNamed.map((kind) => kindRow(kind))
      : moreKindsNotNamed.length > 0 && (kindNamed === null || onOffer.length > 0)
        ? [moreKindsRow]
        : []),
  ];
  let kindSections = [
    {
      id: 'kinds',
      heading:
        hasTyped || onOffer.length === 0 || changesChart
          ? null
          : <span className="flex h-4 items-center">{CHART_MESSAGES.suggested()}</span>,
      rows: [
        ...(hasTyped
          ? [
              {
                id: ASK_AGENT_ROW,
                mark: WAND_ROW_MARK,
                drawn: changesChart ? CHART_MESSAGES.changeThisChart() : CHART_MESSAGES.makeThisChart(),
              },
            ]
          : []),
        ...kindRows,
      ].map(withUsability),
    },
    ...(hasTyped || changesChart || showsOnlyKinds
      ? []
      : [
          {
            id: 'anyKind',
            heading: null,
            rows: [
              withUsability({
                id: ANY_KIND_ROW,
                mark: WAND_ROW_MARK,
                drawn: <DrawnAndSaid drawn={CHART_MESSAGES.quickChart()} said={CHART_MESSAGES.quickChartSaid()} />,
              }),
            ],
          },
        ]),
  ];
  let [kindsSection] = kindSections;
  let changeSections =
    !changesChart || kindsSection === undefined
      ? kindSections
      : [
          ...(hasTyped
            ? [
                {
                  id: 'ask',
                  heading: null,
                  rows: kindsSection.rows.slice(0, 1),
                },
                {
                  id: 'line',
                  heading: null,
                  rows: [],
                },
              ]
            : []),
          {
            id: 'kinds',
            heading: <span className="flex h-4 items-center">{CHART_MESSAGES.changeChartType()}</span>,
            rows: kindsSection.rows.slice(hasTyped ? 1 : 0),
          },
        ];
  let sections =
    kindNamed === null
      ? changeSections
      : [
          {
            id: 'named',
            heading: null,
            rows: [withUsability(kindRow(kindNamed))],
          },
          ...kindSections,
        ];
  let kindRowCount = changesChart ? Math.min(kindRows.length, MAX_KIND_ROWS_WHEN_CHANGING) : kindRows.length;
  let [mostKindRows, setMostKindRows] = React.useState(kindRowCount);
  if (kindRowCount > mostKindRows) setMostKindRows(kindRowCount);
  let [hasHadOffers, setHasHadOffers] = React.useState(onOffer.length > 0);
  if (onOffer.length > 0 && !hasHadOffers) setHasHadOffers(true);
  if (showsOnlyKinds !== kindsOnly.showsOnlyKinds) {
    setMostKindRows(kindRowCount);
    setHasHadOffers(onOffer.length > 0);
  }
  let [hasHadNote, setHasHadNote] = React.useState(false);
  let [noteHeight, setNoteHeight] = React.useState<number | null>(null);
  let noteId = React.useId();
  let workingText = changesChart ? chartMessages.changingChart() : CHART_MESSAGES.makingChart();
  let changeSaid = (
    {
      agentWrites: workingText,
      waits: chartMessages.changeIsPreview(),
      none: null,
    } satisfies Record<ChartChangeStage | 'none', string | null>
  )[change ?? 'none'];
  let [stoppedWithTyped, setStoppedWithTyped] = React.useState<string | null>(null);
  if (stoppedWithTyped !== null && !isStopNoteStillValid(stoppedWithTyped, typedText, change)) setStoppedWithTyped(null);
  let [wasRequestKept, setWasRequestKept] = React.useState(false);
  let stoppedSaid =
    stoppedWithTyped === null ? null : wasRequestKept ? chartMessages.stoppedWithRequestKept() : chartMessages.stoppedWithRequestGone();
  let stepBackFromChange = () => {
    setStoppedWithTyped(typedText);
    setWasRequestKept(hasTyped && !isKindAsked);
    onSteppedBackFromChange?.();
  };
  let isNoAgentNote = whyNot === 'noChat' && !showsOnlyKinds;
  // Words over the Ask limit are not sent: the field keeps them, and says so until they are changed.
  let [refusedTyped, setRefusedTyped] = React.useState<string | null>(null);
  let tooLongNote = tooLongNoteOf(typedText, refusedTyped);
  let note = isNoAgentNote ? CHART_MESSAGES.noAgent() : (tooLongNote ?? noteOnLastAsk);
  let measureNote = (noteElement: HTMLDivElement | null) => {
    if (noteElement !== null && noteElement.offsetHeight > 0)
      setNoteHeight((tallest) => Math.max(tallest ?? 0, noteElement.offsetHeight));
  };
  if (note !== null && !hasHadNote) setHasHadNote(true);
  let keepOrDiscardSections = [
    {
      id: 'keepOrDiscard',
      heading: null,
      rows: [
        {
          id: KEEP_CHANGE_ROW,
          mark: EMPTY_ROW_MARK,
          drawn: chartMessages.keepChange(),
        },
        {
          id: DISCARD_CHANGE_ROW,
          mark: EMPTY_ROW_MARK,
          drawn: chartMessages.discardChange(),
          atEnd: ESC_SHORTCUT_HINT,
        },
      ],
    },
  ];
  let fieldName = changesChart ? chartMessages.askAgentToChangeChart() : CHART_MESSAGES.askAgentToMakeAChart();
  let takeRow = (rowId: ChartMenuRowId) => {
    if (rowId === KEEP_CHANGE_ROW) return onChangeKept?.();
    if (rowId === DISCARD_CHANGE_ROW) return onSteppedBackFromChange?.();
    if (rowId === MORE_KINDS_ROW) return setRowToPointAt(moreKindsNotNamed[0] ?? null);
    let kind = chartKindOfRow(rowId);
    if (kind === null || !canTakeRow(rowId)) return;
    let asked = kind === kindNamed ? '' : typedText;
    if (askTooLong(asked)) return setRefusedTyped(typedText);
    onAsked(kind, asked);
  };
  return <AskOrPickList nameOfField={fieldName} nameOfList={changesChart ? chartMessages.editWithAgent() : CHART_MESSAGES.insertChart()} placeholder={fieldName} text={change !== null && typedText === '' ? askedOfAgent : typedText} {...((nextIsFieldLocked || change === 'waits') && {
      idOfWhyFieldIsOutOfUse: noteId,
    })} isFieldLeftOut={showsOnlyKinds} mostCharacters={mostTyped} stands={change === 'agentWrites' ? 'whileAgentWrites' : 'atRest'} hasAnswer={change === 'waits' || isLastAskNotToBeRepeated} isAgentAtWork={change === 'agentWrites'} said={isNoAgentNote ? note : (changeSaid ?? tooLongNote ?? (changesChart ? null : noteOnLastAsk) ?? stoppedSaid)} note={change === 'waits'
        ? <div id={noteId} className="sr-only">{changeSaid}</div>
        : note === null
          ? null
          : <div ref={measureNote} id={noteId} className={`px-md py-1 text-footnote ${isNoAgentNote || (!isNoteOfFault && tooLongNote === null) ? 'text-secondary' : 'text-danger'}`}>{note}</div>} sections={change === 'waits' ? keepOrDiscardSections : sections} {...(hasRoomBeside && {
      rowsBeside: {
        ofRow: MORE_KINDS_ROW,
        name: CHART_MESSAGES.moreTypes(),
        rows: moreKindsNotNamed.map((kind) => kindRow(kind, <></>)),
        marks: marksOfMoreKinds,
      },
    })} onRoomBesideMeasured={setHasRoomBeside} rowToPointAt={rowToPointAt} {...(change === 'agentWrites' && {
      inPlaceOfList: (<AgentWritingRow words={{
          writes: workingText,
          stop: chartMessages.stopChange(),
        }} isAmongRowsOfList onStopped={stepBackFromChange} />),
    })} doesFirstRowAnswer={hasTyped || change === 'waits'} foot={null} wordsOfFoot={{
      keep: '',
      discard: '',
      stop: '',
    }} height={change !== null && changesChart
        ? CHANGE_PREVIEW_MENU_HEIGHTS[change]
        : showsOnlyKinds
          ? chartKindsOnlyHeight(kindRows.length)
          : chartMenuHeight(
              !changesChart ? mostKindRows : hasTyped ? Math.min(mostKindRows, MAX_KIND_ROWS_UNDER_ASK) : mostKindRows - 1,
              hasHadOffers || changesChart,
              note !== null || (hasHadNote && !changesChart) ? (noteHeight ?? 'unmeasured') : null,
              changesChart && !hasTyped,
            )} doesHeightEase={changesChart} width={SIDE_PANE_DEFAULT_WIDTH} {...(isKeyOfAnother !== undefined && {
      isKeyOfAnother,
    })} onTextChange={setTypedText} onRowPointedAt={ignoreChartMenuEvent} onRowTaken={takeRow} onEntered={() => (hasTyped ? takeRow(ASK_AGENT_ROW) : undefined)} onKept={ignoreChartMenuEvent} onSteppedBack={stepBackFromChange} />;
}
export const CHART_MENU_BASE_REM = 3.5;
export const CHART_MENU_FLUSH_REM = 0.5;
export const CHART_MENU_HEADING_REM = 1.75;
export const CHART_MENU_NOTE_REM = 1.5625;
export const chartMenuHeight = (rowCount: number, hasHeading: boolean, noteHeight: number | 'unmeasured' | null, isFlush = false) =>
  `calc(${CHART_MENU_BASE_REM - (isFlush ? CHART_MENU_FLUSH_REM : 0) + (hasHeading ? CHART_MENU_HEADING_REM : 0) + (noteHeight === 'unmeasured' ? CHART_MENU_NOTE_REM : 0)}rem + ${typeof noteHeight === 'number' ? `${noteHeight}px + ` : ''}${rowCount + 1} * max(var(--ui-h-control), 1.75rem))`;
export const chartKindsOnlyHeight = (kindCount: number) =>
  `calc(2 * var(--ui-menu-gutter, 0.25rem) + ${CHART_MENU_HEADING_REM}rem + ${kindCount} * max(var(--ui-h-control), 1.75rem))`;
export const CHANGE_PREVIEW_MENU_HEIGHTS: Record<ChartChangeStage, string> = {
  agentWrites: chartMenuHeight(0, false, null, true),
  waits: chartMenuHeight(1, false, null, true),
};
export const [MAX_KIND_ROWS_WHEN_CHANGING, MAX_KIND_ROWS_UNDER_ASK] = [6, 4];
[KEEP_CHANGE_ROW, DISCARD_CHANGE_ROW] = ['keep', 'discard'];
export const ESC_SHORTCUT_HINT = <Shortcut aria-hidden keys="esc" variant="text" className="pointer-coarse:hidden" />;
export const ignoreChartMenuEvent = () => {};
export const CHART_THUMBNAIL_SIZE = 20;
export const CHART_MENU_WAND_SIZE = 14;
export const EMPTY_ROW_MARK = <span className="w-5 flex-none" />;
export const DEFAULT_CHART_KINDS: readonly { kind: StockKind; icon: IconName }[] = [
  {
    kind: 'bar',
    icon: 'Chart',
  },
  {
    kind: 'line',
    icon: 'ChartLine',
  },
];
export const ASK_AGENT_ROW: 'ask' = 'ask';
export const ANY_KIND_ROW: 'any' = 'any';
export const MORE_KINDS_ROW: 'more' = 'more';
export const CONTEXT_BAR_PART_MARKS: Readonly<Record<string, boolean>> = {
  [CONTEXT_BAR_PART_ATTRIBUTE]: true,
};
export const WAND_ROW_MARK = <span className="flex w-5 flex-none justify-center"><AgentMark size={CHART_MENU_WAND_SIZE} /></span>;
export const isFieldLockedForNoChat = (wasLocked: boolean, whyNot: ChartMenuWhyNot | null) => wasLocked && whyNot === 'noChat';
export const isStopNoteStillValid = (stoppedWithTyped: string, typed: string, change: ChartChangeStage | null) =>
  stoppedWithTyped === typed && change === null;
export const NO_KINDS_ONLY_STATE: KindsOnlyState = {
  showsOnlyKinds: false,
  canBeUsed: false,
};
