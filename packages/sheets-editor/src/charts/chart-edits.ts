import { CHART_ROWS_INPUT } from './chart-kind-fit.ts';
export { CHART_ROWS_INPUT };
import type { Edit } from '@open-artifact/sheets-core';
import { areaOfHeld } from './cells-held.ts';
import { placeChartForArea, DEFAULT_CHART_SIZE, roomForChartIn } from './placement.ts';
import { layoutOfView } from '../grid/layout.ts';
import { parseA1AreaAsSeen } from '../model/a1-references.ts';
import { nodeRefOf } from './placed-views.ts';
import { cellRefOf } from '../model/workbook.ts';
import { doesCommentModePick } from '../comments/comment-state.ts';
import { withNoEffects, type PageTransition } from '../state/transitions.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { refusalMessageKey, isEditRefusalReason } from '../model/refusals.ts';
import type { PageState } from '../state/initial-state.ts';
import type { ChartEditAsked, EditOfChartAsked, PageContext } from '../state/event-reducer.ts';
import type { ChartEditOutcome, ReadsWithTextMeasurer } from '../state/controller.ts';
import type { EditOutcome } from '../store/workbook-sync.ts';
import type { WorkbookReads } from '../model/workbook.ts';
export function editToAddChart(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  { nodeId, name, cells, at }: Extract<ChartEditAsked, { kind: 'add' }>,
): Edit | null {
  const { sheetId } = cells;
  const sheet = reads.listSheets().find((candidate) => candidate.sheetId === sheetId);
  const area = areaOfHeld(reads, cells);
  const placed = area === null ? null : placeChartForArea(reads, sheetId, area);
  if (sheet === undefined || placed === null) return null;
  const [rangeArea, topLeftArea] = [
    parseA1AreaAsSeen(placed.range, sheet),
    parseA1AreaAsSeen(placed.topLeft, {
      ...sheet,
      ownRowOrder: null,
    }),
  ];
  if (rangeArea === null || topLeftArea === null) return null;
  const cellAsked = state.sheetId === sheetId ? (at ?? null) : null,
    positionAsked = cellAsked === null ? null : reads.positionOfCell(cellAsked),
    isRoomAtAsked =
      positionAsked !== null &&
      roomForChartIn(reads, sheetId, layoutOfView(state, reads))?.isRoomAt(positionAsked.rowIndex, positionAsked.columnIndex, false) === true;
  const [firstCell, lastCell, topLeftCell] = [
    reads.cellIdAt(sheetId, rangeArea.topRowIndex, rangeArea.leftColumnIndex),
    reads.cellIdAt(sheetId, rangeArea.topRowIndex + rangeArea.rowCount - 1, rangeArea.leftColumnIndex + rangeArea.columnCount - 1),
    isRoomAtAsked ? cellAsked : reads.cellIdAt(sheetId, topLeftArea.topRowIndex, topLeftArea.leftColumnIndex),
  ];
  if (firstCell === null || lastCell === null || topLeftCell === null) return null;
  return {
    kind: 'addPlacedView',
    sheetId,
    name,
    embed: {
      ref: nodeRefOf(nodeId),
      caption: '',
    },
    inputs: [
      {
        name: CHART_ROWS_INPUT,
        range: {
          sheetId,
          topLeft: cellRefOf(firstCell),
          bottomRight: cellRefOf(lastCell),
        },
      },
    ],
    topLeft: cellRefOf(topLeftCell),
    ...DEFAULT_CHART_SIZE,
  };
}
export function editToPointChartAt(
  reads: WorkbookReads,
  { viewId, from, to, renaming }: Extract<ChartEditAsked, { kind: 'pointAtOtherNode' }>,
): Edit | null {
  const [placed] = reads.listSheets().flatMap(
    ({ sheetId }) =>
      reads
        .placementsIn(sheetId)
        .filter((placement) => placement.viewId === viewId)
        .map(
          ({ placementId }) => ({
            sheetId,
            placementId,
          }),
        ),
  );
  if (placed === undefined) return null;
  const isNameOfKind = renaming !== null && reads.viewAsItStands(viewId)?.view.name === renaming.from;
  return {
    kind: 'replaceWidgetNodeOfPlacedView',
    ...placed,
    oldNode: nodeRefOf(from),
    newNode: nodeRefOf(to),
    ...(isNameOfKind && {
      newName: renaming.to,
    }),
  };
}
export function reduceEditOfChartAsked(
  state: PageState,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
  { asked, askId }: Pick<EditOfChartAsked, 'asked' | 'askId'>,
): PageTransition {
  if (refusalOfEveryEdit !== null || doesCommentModePick(state)) return withNoEffects(state);
  const edit = asked.kind === 'add' ? editToAddChart(state, reads, asked) : editToPointChartAt(reads, asked);
  return edit === null
    ? withNoEffects(state)
    : queueEdit(state, edit, {
        ...IF_QUEUED_DEFAULTS,
        select: null,
        done: null,
        leavesEntryOpen: true,
        askOfChart: askId,
      });
}
export function chartEditOutcome(answer: EditOutcome): ChartEditOutcome {
  if (answer.kind === 'editQueued')
    return {
      step: answer.step ?? null,
    };
  if (answer.kind === 'nothingToChange')
    return {
      step: null,
    };
  if (answer.kind === 'toBeShownFirst') return 'notMade';
  const messageKey = refusalMessageKey(answer.refusal);
  if (messageKey === 'tooManyCharts') return 'full';
  if (answer.refusal === 'widgetNodeNotShownByTheView') return 'showsAnother';
  return isEditRefusalReason(messageKey) || answer.refusal === 'widgetNodeOfAnotherView' ? 'unsure' : 'notMade';
}
