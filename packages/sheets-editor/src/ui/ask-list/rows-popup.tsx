/** A row's own rows, shown in a card beside the list. */
import * as React from 'react';
import { Popover } from '../../kit/popover.tsx';
import { MODIFIER_KEYS } from '../../state/escape.ts';
import { isTouchBelowSm } from '../../app/media-queries.ts';
import {
  LIST_CARD_BESIDE_GAP,
  ListRow,
  ListboxOfRows,
  hasRoomForCardBesideList,
  useListCardHover,
  watchAncestorStyles,
  withListTabStops,
} from '../list-under-cell.tsx';
import { popupCollisionPadding, useBottomInset } from '../../shell/bottom-insets.ts';
import { swallowRestOfPress } from '../press-swallow.ts';
import type { ListCardHover } from '../list-under-cell.tsx';
import type { PopoverPopupProps } from '../../kit/popover.tsx';

/** Where the card beside stands: which of its rows is highlighted, if any. */
export interface ListRowsPopupStands {
  highlighted: number | null;
}
/** What a key does while the list can open rows beside it: a row to highlight, or an act. */
export type ListRowsPopupKeyAction = number | 'shut' | 'shutAndPassOn' | 'nothing' | 'take' | null;
/** A key as the rows beside read it. */
export interface KeyOfListRowsPopup {
  key: string;
  repeat: boolean;
  hasModifier: boolean;
}
/** The state the rows beside read a key in. */
export interface StateOfListRowsPopup {
  stands: ListRowsPopupStands | null;
  rowCount: number;
  isOpenerHighlighted: boolean;
}
/** A row of the card beside. */
export interface RowBeside<RowId extends string = string> {
  id: RowId;
  inside: React.ReactNode;
}
export interface ListRowsPopupState {
  stands: ListRowsPopupStands | null;
  set: (nextStands: ListRowsPopupStands | null) => void;
  pointer: ListCardHover;
}

export const LIST_ROWS_POPUP_MAX_WIDTH = 240;
export const LIST_ROWS_POPUP_COLLISION: PopoverPopupProps['collisionAvoidance'] = {
  side: 'flip',
  align: 'shift',
  fallbackAxisSide: 'none',
};

export function listRowsPopupKeyAction(key: KeyOfListRowsPopup, state: StateOfListRowsPopup): ListRowsPopupKeyAction {
  let { key: keyName, repeat, hasModifier } = key;
  let { stands, rowCount, isOpenerHighlighted } = state;
  if (MODIFIER_KEYS.has(keyName)) return null;
  let highlighted = stands?.highlighted ?? null;
  if (stands !== null && keyName === 'Escape') return 'shut';
  if (hasModifier) return stands === null ? null : 'shutAndPassOn';
  if (highlighted === null) {
    if (isOpenerHighlighted && (keyName === 'ArrowRight' || keyName === 'Enter')) return 0;
    return stands === null ? null : 'shutAndPassOn';
  }
  switch (keyName) {
    case 'ArrowDown':
      return (highlighted + 1) % rowCount;
    case 'ArrowUp':
      return (highlighted + rowCount - 1) % rowCount;
    case 'Home':
      return 0;
    case 'End':
      return rowCount - 1;
    case 'ArrowLeft':
      return 'shut';
    case 'ArrowRight':
      return 'nothing';
    case 'Enter':
      return repeat ? 'nothing' : 'take';
    default:
      return 'shutAndPassOn';
  }
}
export function useRoomBesideMeasured(boxRef: React.RefObject<HTMLElement | null>, onRoomBesideMeasured: ((hasRoom: boolean) => void) | undefined): void {
  let onMeasured = React.useEffectEvent((hasRoom: boolean) => onRoomBesideMeasured?.(hasRoom));
  let tellsRoomBeside = onRoomBesideMeasured !== undefined;
  React.useLayoutEffect(() => {
    let box = boxRef.current;
    let view = box?.ownerDocument.defaultView ?? null;
    if (!tellsRoomBeside || box === null || view === null) return;
    let measure = () =>
      onMeasured(
        !isTouchBelowSm() &&
          hasRoomForCardBesideList(box.getBoundingClientRect(), box.ownerDocument.documentElement.clientWidth, LIST_ROWS_POPUP_MAX_WIDTH),
      );
    measure();
    let stopWatching = watchAncestorStyles(box, measure);
    view.addEventListener('resize', measure);
    return () => {
      stopWatching();
      view.removeEventListener('resize', measure);
    };
  }, [boxRef, tellsRoomBeside]);
}
export function useListRowsPopup(rowsListedKey: string | null): ListRowsPopupState {
  let [stands, setStands] = React.useState<ListRowsPopupStands | null>(null);
  let [lastRowsListedKey, setLastRowsListedKey] = React.useState(rowsListedKey);
  if (lastRowsListedKey !== rowsListedKey) {
    setLastRowsListedKey(rowsListedKey);
    setStands(null);
  }
  let pointer = useListCardHover({
    rowsListed: rowsListedKey,
    isOpen: stands !== null,
    onAsked: () =>
      setStands({
        highlighted: null,
      }),
    onShut: () => setStands(null),
  });
  return {
    stands,
    set(nextStands) {
      pointer.overCard();
      setStands(nextStands);
    },
    pointer,
  };
}

export interface ListRowsPopupProps<RowId extends string = string> {
  id: string;
  idOfRow: (index: number) => string;
  name: string;
  rows: readonly RowBeside<RowId>[];
  highlighted: number | null;
  card: React.RefObject<HTMLElement | null>;
  idOfOpener: string;
  marks: Record<`data-${string}`, string | boolean | undefined>;
  onPointedAt: (index: number) => void;
  onPointerInOrOut: (isIn: boolean) => void;
  onRowTaken: (rowId: RowId) => void;
}
export function ListRowsPopup<RowId extends string = string>({ id, idOfRow, name, rows, highlighted, card, idOfOpener, marks, onPointedAt, onPointerInOrOut, onRowTaken }: ListRowsPopupProps<RowId>) {
  let bottomInset = useBottomInset();
  let anchor = {
    getBoundingClientRect(): DOMRect {
      let cardElement = card.current;
      let opener = cardElement?.ownerDocument.getElementById(idOfOpener) ?? null;
      let view = cardElement?.ownerDocument.defaultView ?? null;
      if (cardElement === null || opener === null || view === null) return new DOMRect();
      let { left, width } = cardElement.getBoundingClientRect();
      let { top, height } = opener.getBoundingClientRect();
      let padding = Number.parseFloat(view.getComputedStyle(cardElement).paddingBottom);
      return new DOMRect(left, top - padding, width, height + 2 * padding);
    },
  };
  return withListTabStops(
    <Popover.Root open><Popover.Popup anchor={anchor} side="inline-end" align="end" sideOffset={LIST_CARD_BESIDE_GAP} collisionAvoidance={LIST_ROWS_POPUP_COLLISION} collisionPadding={popupCollisionPadding(bottomInset)} padding="none" initialFocus={false} finalFocus={false} keepFocus role="presentation" data-list-under-cell {...marks} style={{
          maxWidth: LIST_ROWS_POPUP_MAX_WIDTH,
        }} onClickCapture={(event: React.MouseEvent<HTMLDivElement>) => swallowRestOfPress(event)} onPointerEnter={() => onPointerInOrOut(true)} onPointerLeave={() => onPointerInOrOut(false)}><ListboxOfRows id={id} label={name}>{rows.map((row, index) => <ListRow key={row.id} id={idOfRow(index)} placeInList={index + 1} rowsInList={rows.length} isHighlighted={index === highlighted} onChosen={() => onRowTaken(row.id)} onPointedAt={() => onPointedAt(index)}>{row.inside}</ListRow>)}</ListboxOfRows></Popover.Popup></Popover.Root>,
  );
}
