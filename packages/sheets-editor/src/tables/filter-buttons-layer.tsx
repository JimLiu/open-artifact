import { Button } from '../kit/button.tsx';
import { Icon } from '../kit/icon.tsx';
import { Surface } from '../kit/surface.tsx';
import { TooltipGroup } from '../kit/tooltip.tsx';
import * as React from 'react';
import { filterButtonAtPoint } from './table-drawing.ts';
import { pointInZoomedElement } from '../grid/zoom.ts';
import { FILTER_BUTTON_SIZE, FILTER_BUTTON_HIT_MARGIN, filterButtonCellKey, foundTableKeyAtPointer } from './filter-buttons-place.ts';
import { Fragment } from 'react/jsx-runtime';
import { isElementFocused } from './own-filter-bar-view.tsx';
import { ContentsBox } from '../ui/contents-box.tsx';
import { preventMouseDownDefault } from '../ui/dom-events.ts';
import { boxInBody } from '../grid/grid-drawing.tsx';
import { isSelectionOfferCovered } from '../state/offers-at-selection.ts';
import { sortAndFilterMessages } from './sort-filter-labels.ts';
import { filterByColumnLabel } from './filter-messages.ts';
import { textPaintStyle, fillPaintStyle } from '../grid/cell-drawing.tsx';
import type { PaintPair, StyleWithVariables } from '../grid/cell-drawing.tsx';
import type { BodyOrigin } from '../grid/grid-drawing.tsx';
import type { GridView } from '../grid/grid-view.ts';
import type { PaneRect } from '../grid/geometry.ts';
import type { GridWithFoundTables } from './filter-buttons-place.ts';
import type { ButtonProps } from '../kit/button.tsx';
import type { OwnFilter } from './own-filters.ts';
import type { ClearAroundButton, FilterButtonAt, FilterButtonInView, GroundUnderButton, PlacedFilterButton } from './table-drawing.ts';
import type { FoundTableOutline, TableOutline } from './table-outlines.ts';
import type { OutlineHeldBack } from './tables-in-view.ts';
/** A table drawn, known by its key. */
export type TableDrawnWithKey = Pick<OwnFilter, 'key'>;
/** When the agent's change of a revision was first drawn. */
export interface RevisionTime {
  revision: number;
  atMs: number;
}
/** The grid as far as finding the filter button under a point goes: the cells' corner, and the buttons. */
export interface GridWithFilterButtons {
  body: BodyOrigin;
  filterButtons: readonly Pick<PlacedFilterButton, 'tableKey' | 'c' | 'cell'>[];
}
/** Where the pointer is in the window. */
export type PointerAt = Pick<MouseEvent, 'clientX' | 'clientY'>;
export interface FilterButtonPointedAtWatch {
  drawn: GridWithFilterButtons & GridWithFoundTables;
  gridRef: React.RefObject<Element | null>;
  zoom: number;
}
export interface FilterButtonPointedAt {
  pointedAt: FilterButtonAt | null;
  /** The found table the pointer is over or near the button of, if any. */
  tablePointedAt: string | null;
  pointerMovedTo: (pointer: PointerAt | null) => void;
}
/** What the grid holds that tells which buttons of found tables are shown. */
export type GridWithFoundTablesShown = Pick<GridView, 'filterButtons' | 'foundTableOutlines' | 'activeCellBox' | 'offersAtSelection'>;
export interface TablesButtonGroundProps {
  grounds: readonly GroundUnderButton[];
  row: PaneRect;
  body: BodyOrigin;
  isShown: boolean;
  isOverHeaderKept: boolean;
}
/** A touch press, on what, and when it was lifted. */
interface TouchPress {
  on: EventTarget | null;
  liftedAtMs: number;
}
/** What an element that comes in place is given: the mark of its coming, and the end of it. */
export interface ComesInPlaceProps {
  'data-comes-in-place': true | undefined;
  onAnimationEnd: (animationEvent: React.AnimationEvent) => void;
}
export interface ButtonThatComesInPlaceProps extends ButtonProps {
  comesInPlace: boolean;
  ref?: React.Ref<HTMLElement>;
}
/** The clips of a table's outline: the rest of it, and the parts over frozen lines and over the headers. */
export interface OutlineClipPaths {
  rest: string;
  overFrozen: string | null;
  overHeaders: string | null;
}
/** A table's outline as drawn, with when it comes if it is a found table's. */
export type OutlineToDraw = TableOutline & Partial<Pick<FoundTableOutline, 'comesLater'>>;
export interface FilterTableOutlineProps {
  comesLater: OutlineHeldBack | null;
  revisionsDrawn: readonly RevisionTime[];
  isOfFoundTable: boolean | undefined;
  isOverFrozen?: boolean;
  isOverHeaders?: boolean;
  sidesCut: string | undefined;
  comesInPlace: boolean;
  style: React.CSSProperties;
}
/** A filter button pressed: its table, row and column, and whether its list is open. */
export type FilterButtonPressed = Pick<PlacedFilterButton, 'tableKey' | 'r' | 'c' | 'isOfFoundTable' | 'isListOpen'>;
export interface FilterButtonsLayerProps {
  buttons: readonly FilterButtonInView[];
  filteredTablesDrawn: readonly TableDrawnWithKey[];
  pointedAt: FilterButtonAt | null;
  /** Keys of the found tables' buttons that are shown, and of the cells whose column buttons are. */
  ofFoundTablesShown?: readonly string[];
  body: BodyOrigin;
  onListAsked: (pressed: FilterButtonPressed) => void;
  onGoingWithCaret: () => void;
}
export interface FilterTableOutlinesProps {
  outlines: readonly OutlineToDraw[];
  body: BodyOrigin;
  areOfFoundTables?: boolean;
  latestRevisionByAgent?: number;
  filteredTablesDrawn?: readonly TableDrawnWithKey[];
}
export function noteKeysDrawn(seenKeys: string[], list: readonly TableDrawnWithKey[]): void {
  seenKeys.splice(0, seenKeys.length, ...keysOfList(list));
}
export function keysNewlyDrawn(seenKeys: readonly string[], list: readonly TableDrawnWithKey[]): readonly string[] {
  let newKeys = list.flatMap(({ key }) => (seenKeys.includes(key) ? [] : [key]));
  return newKeys.length === 0 ? NO_KEYS_NEWLY_DRAWN : newKeys;
}
export function noteRevisionTime(revisionTimes: RevisionTime[], revision: number, atMs: number): void {
  if (revision <= (revisionTimes.at(-1)?.revision ?? 0)) return;
  revisionTimes.push({
    revision,
    atMs,
  });
  if (revisionTimes.length > 50) revisionTimes.shift();
}
export function delayOfLaterOutline(
  revisionTimes: readonly RevisionTime[],
  { revisionOfMark, afterMs }: OutlineHeldBack,
  nowMs: number,
): number | null {
  let markedAtMs = revisionTimes.find(({ revision }) => revision >= revisionOfMark)?.atMs ?? nowMs;
  let delayMs = afterMs - (nowMs - markedAtMs);
  return delayMs > -200 ? delayMs : null;
}
export function useFilterButtonPointedAt({ drawn, gridRef, zoom }: FilterButtonPointedAtWatch): FilterButtonPointedAt {
  let pointerRef = React.useRef<PointerAt | null>(null);
  let [pointedAt, setPointedAt] = React.useState<FilterButtonAt | null>(null);
  let [tablePointedAt, setTablePointedAt] = React.useState<string | null>(null);
  let lookAtPointer = React.useCallback(() => {
    let [pointer, grid] = [pointerRef.current, gridRef.current];
    let buttonPointedAt =
      pointer === null || grid === null || drawn.filterButtons.length === 0
        ? null
        : filterButtonAtPoint(pointInZoomedElement(grid, zoom, pointer), drawn);
    setPointedAt(
      (previous) =>
        previous?.tableKey === buttonPointedAt?.tableKey && previous?.c === buttonPointedAt?.c ? previous : buttonPointedAt,
    );
    let point = pointer === null || grid === null || drawn.filterButtons.length === 0 ? null : pointInZoomedElement(grid, zoom, pointer);
    setTablePointedAt((previous) => (point === null ? null : foundTableKeyAtPointer(point, drawn, previous)));
  }, [drawn, gridRef, zoom]);
  React.useLayoutEffect(lookAtPointer, [lookAtPointer]);
  let pointerMovedTo = React.useCallback(
    (moveEvent: PointerAt | null) => {
      pointerRef.current =
        moveEvent === null
          ? null
          : {
              clientX: moveEvent.clientX,
              clientY: moveEvent.clientY,
            };
      lookAtPointer();
    },
    [lookAtPointer],
  );
  return {
    pointedAt,
    tablePointedAt,
    pointerMovedTo,
  };
}
export function useOfFoundTablesShown(
  { filterButtons, foundTableOutlines, activeCellBox, offersAtSelection }: GridWithFoundTablesShown,
  { pointedAt, tablePointedAt }: Pick<FilterButtonPointedAt, 'pointedAt' | 'tablePointedAt'>,
  zoom: number,
): readonly string[] {
  let [isPressNotByMouse, setIsPressNotByMouse] = React.useState(false);
  React.useEffect(() => {
    let notePress = ({ pointerType }: PointerEvent) => setIsPressNotByMouse(pointerType !== 'mouse');
    document.addEventListener('pointerdown', notePress, true);
    return () => document.removeEventListener('pointerdown', notePress, true);
  }, []);
  let tableOfActiveCell = isPressNotByMouse ? foundTableOutlines.find((outline) => isActiveCellInBox(outline, activeCellBox))?.tableKey : undefined;
  let shown = filterButtons
    .flatMap((button): string[] => {
      if (button.isOfColumnOfFoundTable)
        return button.isListOpen || isFilterButtonPointedAt(button, pointedAt) || (button.isInActiveCell && isPressNotByMouse)
          ? [filterButtonCellKey(button)]
          : [];
      if (!button.isOfFoundTable) return [];
      return button.tableKey === tableOfActiveCell ||
        (button.tableKey === tablePointedAt && !isTableButtonCoveredByOffer(button, offersAtSelection, zoom))
        ? [tableButtonKey(button.tableKey)]
        : [];
    })
    .join('\n');
  return React.useMemo(() => shown.split('\n'), [shown]);
}
export function TablesButtonGround(props: TablesButtonGroundProps) {
  let { grounds, row, body } = props;
  let [first, last] = [grounds[0], grounds.at(-1)];
  if (first === undefined || last === undefined) return null;
  return (
    <div
      aria-hidden
      className="sheet-ground-of-tables-button"
      data-is-called-for={props.isShown || undefined}
      data-is-over-header-kept={props.isOverHeaderKept || undefined}
      style={boxInBody(
        {
          left: first.left,
          top: row.top,
          width: last.left + last.width - first.left,
          height: row.height - 1,
        },
        body,
      )}
    >
      {grounds.map(({ left, width, ground }) => (
        <div
          key={left}
          data-ground={typeof ground === 'string' ? ground : 'fill'}
          style={{
            left: left - first.left,
            width,
            ...fillPaintStyle(typeof ground === 'string' ? null : ground),
          }}
        />
      ))}
    </div>
  );
}
export function filterButtonClearAtStyle({ top, right, bottom, left }: ClearAroundButton): StyleWithVariables {
  let halfButton = FILTER_BUTTON_SIZE / 2;
  return {
    '--sheet-shows-above-middle': `${top + halfButton}px`,
    '--sheet-shows-right-of-middle': `${right + halfButton}px`,
    '--sheet-shows-below-middle': `${bottom + halfButton}px`,
    '--sheet-shows-left-of-middle': `${left + halfButton}px`,
  };
}
export function useKeysNewlyDrawn(list: readonly TableDrawnWithKey[]): readonly string[] {
  let [seenKeys] = React.useState(() => keysOfList(list));
  React.useLayoutEffect(() => {
    noteKeysDrawn(seenKeys, list);
  }, [seenKeys, list]);
  return keysNewlyDrawn(seenKeys, list);
}
export function useComesInPlaceProps(comesInPlace: boolean): ComesInPlaceProps {
  let [isComingInPlace, setIsComingInPlace] = React.useState(comesInPlace);
  return {
    'data-comes-in-place': isComingInPlace || undefined,
    onAnimationEnd: ({ target, currentTarget }: React.AnimationEvent) => {
      if (target === currentTarget) setIsComingInPlace(false);
    },
  };
}
export function useIsClickRightAfterTouch(): (clickEvent: React.MouseEvent) => boolean {
  let touchRef = React.useRef<TouchPress | null>(null);
  React.useEffect(() => {
    let notePress = ({ pointerType, target }: PointerEvent) => {
      touchRef.current =
        pointerType === 'mouse'
          ? null
          : {
              on: target,
              liftedAtMs: 1 / 0,
            };
    };
    let noteLift = ({ timeStamp }: PointerEvent) => {
      if (touchRef.current !== null) touchRef.current.liftedAtMs = timeStamp;
    };
    document.addEventListener('pointerdown', notePress, true);
    document.addEventListener('pointerup', noteLift, true);
    return () => {
      document.removeEventListener('pointerdown', notePress, true);
      document.removeEventListener('pointerup', noteLift, true);
    };
  }, []);
  return React.useCallback(({ currentTarget, timeStamp }: React.MouseEvent) => {
    let touch = touchRef.current;
    return touch !== null && Math.abs(timeStamp - touch.liftedAtMs) < TOUCH_CLICK_AFTER_LIFT_MS && !(touch.on instanceof Node && currentTarget.contains(touch.on));
  }, []);
}
export function ButtonThatComesInPlace({ comesInPlace, ...buttonProps }: ButtonThatComesInPlaceProps) {
  return <Button {...buttonProps} {...useComesInPlaceProps(comesInPlace)} />;
}
export function outlineClipPolygon(left: number, top: number, innerLeft: number, innerTop: number): string | null {
  if (innerLeft === left && innerTop === top) return null;
  let farEdge = 'calc(100% + 100vmax)';
  return `polygon(${left}px ${top}px, ${farEdge} ${top}px, ${farEdge} ${innerTop}px, ${innerLeft}px ${innerTop}px, ${innerLeft}px ${farEdge}, ${left}px ${farEdge})`;
}
export function outlineClipPaths({
  cutAtLeft,
  cutAtTop,
  frozenAcross,
  frozenDown,
  isAtRowNumbers,
  isAtColumnLetters,
}: Pick<TableOutline, 'cutAtLeft' | 'cutAtTop' | 'frozenAcross' | 'frozenDown' | 'isAtRowNumbers' | 'isAtColumnLetters'>): OutlineClipPaths {
  let [headersLeft, headersTop] = [isAtRowNumbers ? 0 : cutAtLeft, isAtColumnLetters ? 0 : cutAtTop];
  let [clipLeft, clipTop] = [Math.max(frozenAcross, headersLeft), Math.max(frozenDown, headersTop)];
  return {
    rest: `inset(${clipTop}px -100vmax -100vmax ${clipLeft}px)`,
    overFrozen: outlineClipPolygon(headersLeft, headersTop, clipLeft, clipTop),
    overHeaders: outlineClipPolygon(cutAtLeft, cutAtTop, headersLeft, headersTop),
  };
}
export function FilterTableOutline({
  comesLater,
  revisionsDrawn,
  isOfFoundTable,
  isOverFrozen,
  isOverHeaders,
  sidesCut,
  comesInPlace,
  style,
}: FilterTableOutlineProps) {
  let [animationDelayMs] = React.useState(
    () => (comesLater === null ? null : delayOfLaterOutline(revisionsDrawn, comesLater, performance.now())),
  );
  let comesInPlaceProps = useComesInPlaceProps(comesInPlace);
  return <div aria-hidden className="sheet-own-filter-outline" data-is-of-found-table={isOfFoundTable} data-comes-later={animationDelayMs !== null || undefined} {...comesInPlaceProps} data-is-over-frozen={isOverFrozen} data-is-over-headers={isOverHeaders} data-sides-cut={sidesCut} style={animationDelayMs === null
        ? style
        : {
            ...style,
            animationDelay: `${animationDelayMs}ms`,
          }} />;
}
export const NO_KEYS_NEWLY_DRAWN: readonly string[] = [];
export const keysOfList = (list: readonly TableDrawnWithKey[]): string[] => list.map(({ key }) => key);
export const startRevisionTimes = (revision: number): RevisionTime[] => [
  {
    revision,
    atMs: -1 / 0,
  },
];
export const isFilterButtonPointedAt = ({ tableKey, c }: FilterButtonAt, pointedAt: FilterButtonAt | null): boolean =>
  pointedAt?.tableKey === tableKey && pointedAt.c === c;
export const tableButtonKey = (tableKey: string): string => `table ${tableKey}`;
export const isActiveCellInBox = ({ left, top, width, height }: PaneRect, activeCellBox: Pick<PaneRect, 'left' | 'top'> | null): boolean =>
  activeCellBox !== null &&
  activeCellBox.left + 1 >= left &&
  activeCellBox.left + 1 < left + width &&
  activeCellBox.top + 1 >= top &&
  activeCellBox.top + 1 < top + height;
export const isTableButtonCoveredByOffer = (
  { left, top }: Pick<PlacedFilterButton, 'left' | 'top'>,
  offersAtSelection: GridView['offersAtSelection'],
  zoom: number,
): boolean =>
  offersAtSelection?.isTextCutOff === true &&
  offersAtSelection.besideIfShort !== null &&
  isSelectionOfferCovered(
    offersAtSelection.besideIfShort,
    [
      filterButtonHitBox({
        left,
        top,
      }),
    ],
    zoom,
    'short',
  );
export const filterButtonHitBox = ({ left, top }: Pick<PlacedFilterButton, 'left' | 'top'>): PaneRect => ({
  left: left - FILTER_BUTTON_HIT_MARGIN,
  top: top - FILTER_BUTTON_HIT_MARGIN,
  width: FILTER_BUTTON_SIZE + 2 * FILTER_BUTTON_HIT_MARGIN,
  height: FILTER_BUTTON_SIZE + 2 * FILTER_BUTTON_HIT_MARGIN,
});
export const TABLE_BUTTON_CLIP_MAX_PX = 40;
export const tableButtonClipPath = ({ top, right, bottom, left }: ClearAroundButton): string =>
  `inset(${[top, right, bottom, left].map((room) => `${-Math.min(room - FILTER_BUTTON_HIT_MARGIN, TABLE_BUTTON_CLIP_MAX_PX)}px`).join(' ')})`;
export const NO_FOUND_TABLES_SHOWN: readonly string[] = [];
export const stopFilterButtonEvent = (buttonEvent: React.SyntheticEvent): void => buttonEvent.stopPropagation();
export const stopContextMenuOutsideFoundTable = (menuEvent: React.MouseEvent): void => {
  let { target } = menuEvent;
  if (!(target instanceof Element) || target.closest('[data-is-of-found-table]') === null) menuEvent.stopPropagation();
};
export const stopEnterOrSpacePropagation = (keyEvent: React.KeyboardEvent): void => {
  if (keyEvent.key === 'Enter' || keyEvent.key === ' ') keyEvent.stopPropagation();
};
export const atRestMarkStyle = (mark: PaintPair | null): StyleWithVariables =>
  mark === null
    ? {}
    : {
        '--sheet-mark-on-light': mark.onLight,
        '--sheet-mark-on-dark': mark.onDark,
      };
export const groundBesideButtonStyle = ({ left, cell }: Pick<PlacedFilterButton, 'left' | 'cell'>): StyleWithVariables => ({
  '--sheet-ground-past-button': `${Math.max(0, cell.left + cell.width - 1 - left - FILTER_BUTTON_SIZE)}px`,
  '--sheet-ground-before-button': `${Math.max(0, Math.min(8, left - cell.left))}px`,
});
export const NO_FILTERED_TABLES_DRAWN: readonly TableDrawnWithKey[] = [];
export const TOUCH_CLICK_AFTER_LIFT_MS = 700;
export const FilterButtonsLayer = React.memo(function ({
  buttons,
  filteredTablesDrawn,
  pointedAt,
  ofFoundTablesShown = NO_FOUND_TABLES_SHOWN,
  body,
  onListAsked,
  onGoingWithCaret,
}: FilterButtonsLayerProps) {
  let [tableWithCaret, setTableWithCaret] = React.useState<string | null>(null);
  let caretGoesOnRef = React.useCallback(
    (button: HTMLElement) =>
      () => {
        if (button === button.ownerDocument.activeElement) setTableWithCaret(null);
        if (isElementFocused(button)) onGoingWithCaret();
      },
    [onGoingWithCaret],
  );
  let tablesNewlyDrawn = useKeysNewlyDrawn(filteredTablesDrawn);
  let isClickRightAfterTouch = useIsClickRightAfterTouch();
  let isTableButtonShown = (tableKey: string, isListOpen: boolean): boolean =>
    !isListOpen && (tableKey === tableWithCaret || ofFoundTablesShown.includes(tableButtonKey(tableKey)));
  return (
    <ContentsBox
      onPointerDown={stopFilterButtonEvent}
      onMouseDown={(mouseEvent: React.MouseEvent) => {
        stopFilterButtonEvent(mouseEvent);
        preventMouseDownDefault(mouseEvent);
      }}
      onPointerUp={stopFilterButtonEvent}
      onClick={stopFilterButtonEvent}
      onDoubleClick={stopFilterButtonEvent}
      onContextMenu={stopContextMenuOutsideFoundTable}
      onKeyDown={stopEnterOrSpacePropagation}
      onKeyUp={stopEnterOrSpacePropagation}
    >
      <TooltipGroup>
        {buttons.map(
          ({
            tableKey,
            r,
            isOfFoundTable,
            isOfColumnOfFoundTable,
            c,
            column,
            left,
            top,
            clearAt,
            cell,
            isOn,
            isListOpen,
            ink,
            ground,
            givesWayToText,
            isInActiveCell,
            atRest,
            headerKept,
            groundsWhereHeld,
          }) => (
            <React.Fragment key={isOfFoundTable ? `${r} ${c} table` : `${r} ${c}`}>
              <TablesButtonGround
                grounds={groundsWhereHeld}
                row={cell}
                body={body}
                isShown={isTableButtonShown(tableKey, isListOpen)}
                isOverHeaderKept={headerKept !== null}
              />
              {isOfFoundTable && (
                <Surface
                  aria-hidden
                  elevation="popover"
                  className="sheet-holder-of-tables-button"
                  data-is-called-for={isTableButtonShown(tableKey, isListOpen) || undefined}
                  data-is-over-header-kept={headerKept !== null || undefined}
                  style={{
                    ...boxInBody(
                      filterButtonHitBox({
                        left,
                        top,
                      }),
                      body,
                    ),
                    clipPath: tableButtonClipPath(clearAt),
                  }}
                />
              )}
              <ButtonThatComesInPlace
                ref={caretGoesOnRef}
                comesInPlace={tablesNewlyDrawn.includes(tableKey)}
                variant="ghost"
                size="xxs"
                iconOnly
                icon={isOfFoundTable ? <Icon name="FilterAdd" size="sm" /> : <Icon name="FilterLines" size="xs" />}
                tabIndex={-1}
                className="sheet-own-filter-button"
                aria-label={isOfFoundTable ? sortAndFilterMessages.sortAndFilter() : filterByColumnLabel(column, isOn)}
                aria-haspopup="dialog"
                aria-expanded={isListOpen}
                data-is-on={isOn || undefined}
                data-is-of-found-table={isOfFoundTable || isOfColumnOfFoundTable || undefined}
                data-is-beside-table={isOfFoundTable || undefined}
                data-is-of-column-of-found-table={isOfColumnOfFoundTable || undefined}
                data-gives-way-to-text={givesWayToText || undefined}
                data-is-called-for={
                  (isOfFoundTable
                    ? isTableButtonShown(tableKey, isListOpen)
                    : isOfColumnOfFoundTable
                      ? ofFoundTablesShown.includes(
                          filterButtonCellKey({
                            r,
                            c,
                          }),
                        )
                      : isInActiveCell ||
                        isFilterButtonPointedAt(
                          {
                            tableKey,
                            c,
                          },
                          pointedAt,
                        )) || undefined
                }
                data-has-text-paint={ink !== null || undefined}
                data-is-over-header-kept={headerKept !== null || undefined}
                data-ground={ground === null ? undefined : typeof ground === 'string' ? ground : 'fill'}
                style={{
                  left: body.left + left + FILTER_BUTTON_SIZE / 2,
                  top: body.top + top + FILTER_BUTTON_SIZE / 2,
                  ...filterButtonClearAtStyle(clearAt),
                  ...(givesWayToText &&
                    groundBesideButtonStyle({
                      left,
                      cell,
                    })),
                  ...textPaintStyle(ink),
                  ...atRestMarkStyle(atRest),
                  ...fillPaintStyle(typeof ground === 'string' ? null : ground),
                }}
                onFocus={isOfFoundTable ? () => setTableWithCaret(tableKey) : undefined}
                onBlur={isOfFoundTable ? () => setTableWithCaret(null) : undefined}
                onClick={(clickEvent: React.MouseEvent) => {
                  if ((isOfFoundTable || isOfColumnOfFoundTable) && isClickRightAfterTouch(clickEvent)) return;
                  onListAsked({
                    tableKey,
                    r,
                    c,
                    isOfFoundTable,
                    isListOpen,
                  });
                }}
              />
            </React.Fragment>
          ),
        )}
      </TooltipGroup>
    </ContentsBox>
  );
});
export const FilterTableOutlines = React.memo(function ({
  outlines,
  body,
  areOfFoundTables,
  latestRevisionByAgent = 0,
  filteredTablesDrawn = NO_FILTERED_TABLES_DRAWN,
}: FilterTableOutlinesProps) {
  let [revisionTimes] = React.useState(() => startRevisionTimes(latestRevisionByAgent));
  React.useLayoutEffect(() => {
    noteRevisionTime(revisionTimes, latestRevisionByAgent, performance.now());
  }, [revisionTimes, latestRevisionByAgent]);
  let tablesNewlyDrawn = useKeysNewlyDrawn(filteredTablesDrawn);
  return <>{outlines.map((outline) => {
      let { tableKey, left, top, width, height } = outline;
      let { rest: restClip, overFrozen: overFrozenClip, overHeaders: overHeadersClip } = outlineClipPaths(outline);
      let outlineStyle = {
        left: body.left + left,
        top: body.top + top,
        width: width - 1,
        height: height - 1,
        clipPath: restClip,
      };
      let outlineProps = {
        comesLater: outline.comesLater ?? null,
        revisionsDrawn: revisionTimes,
        isOfFoundTable: areOfFoundTables,
        sidesCut: outline.sidesCut ?? undefined,
        comesInPlace: tablesNewlyDrawn.includes(tableKey),
      };
      return (<React.Fragment key={tableKey}><FilterTableOutline {...outlineProps} style={outlineStyle} />{overFrozenClip !== null &&
              (<FilterTableOutline {...outlineProps} isOverFrozen style={{
                  ...outlineStyle,
                  clipPath: overFrozenClip,
                }} />)}{overHeadersClip !== null &&
              (<FilterTableOutline {...outlineProps} isOverHeaders style={{
                  ...outlineStyle,
                  clipPath: overHeadersClip,
                }} />)}</React.Fragment>);
    })}</>;
});
