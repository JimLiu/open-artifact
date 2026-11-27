/** Cells changed from their defaults. */
import * as React from 'react';
import { Button } from '../../kit/button.tsx';
import { TooltipGroup } from '../../kit/tooltip.tsx';
import { PaneEmptyState, PaneRow, PaneSection, SidePane, focusPaneStart, useSidePaneCaret } from './side-pane.tsx';
import { swallowRestOfPress } from '../press-swallow.ts';
import { defaultValueLabel, defaultsAndLimitsMessages, moreChangedCellsLabel, resetCellLabel } from '../../messages/defaults-and-limits.ts';
import type { CellId } from '../../model/workbook.ts';

/** A cell that holds something other than its default. */
export interface ChangedCell {
  cellId: CellId;
  address: string;
  held: string;
  defaultValue: string;
  mayBeReset: boolean;
}
/** The changed cells as the pane lists them. */
export interface ChangedCellsShown {
  listed: ChangedCell[];
  countNotListed: number;
  mayAnyBeReset: boolean;
}
/** What was done in the pane. */
export type ChangedCellsPaneAct = { kind: 'resetAll' } | { kind: 'reset'; cellId: CellId } | { kind: 'goTo'; cellId: CellId };

export interface ChangedCellRowProps {
  cell: ChangedCell;
  onAct: (act: ChangedCellsPaneAct) => void;
}
export function ChangedCellRow({ cell, onAct }: ChangedCellRowProps) {
  let { cellId, address, held, defaultValue, mayBeReset } = cell;
  return <PaneRow><Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start py-1 text-start" onClick={() =>
        onAct({
          kind: 'goTo',
          cellId,
        })}><span className="flex min-w-0 flex-col"><span className="flex min-w-0 gap-sm"><span dir="auto" className="truncate">{address}</span><span dir="auto" className="min-w-0 truncate font-medium">{held}</span></span><span dir="auto" className="truncate text-footnote text-secondary">{defaultValueLabel(defaultValue)}</span></span></Button><Button variant="ghost" iconOnly icon="ArrowCounterClockwise" aria-label={resetCellLabel(address)} disabled={!mayBeReset} className="text-secondary" onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        swallowRestOfPress(event);
        onAct({
          kind: 'reset',
          cellId,
        });
      }} /></PaneRow>;
}

export interface ChangedCellsPaneProps {
  pane: ChangedCellsShown | null;
  timesAsked: number;
  paneRef: React.RefObject<HTMLElement | null>;
  takesNoTyping: boolean;
  paneWidth: number;
  onPaneWidthChange: (width: number) => void;
  onKeyDownInPane: (event: React.KeyboardEvent<HTMLElement>) => void;
  whatHasCaretAfter: () => HTMLElement | false;
  wasPointerPressedLast: () => boolean;
  onAct: (act: ChangedCellsPaneAct) => void;
  onPressed?: () => void;
  onShut: () => void;
}
export const ChangedCellsPane = React.memo(function ({
  pane,
  timesAsked,
  paneRef,
  takesNoTyping,
  paneWidth,
  onPaneWidthChange,
  onKeyDownInPane,
  whatHasCaretAfter,
  wasPointerPressedLast,
  onAct,
  onPressed,
  onShut,
}: ChangedCellsPaneProps) {
  if (
    (useSidePaneCaret({
      isOpen: pane !== null,
      timesAsked,
      paneRef,
      putCaretWhereToStart: () =>
        focusPaneStart(paneRef.current, 'start', {
          isByPointer: wasPointerPressedLast(),
        }),
      whatHasCaretAfter,
    }),
    pane === null)
  )
    return null;
  let { listed, countNotListed, mayAnyBeReset } = pane;
  return <SidePane ref={paneRef} title={defaultsAndLimitsMessages.changedCells()} takesNoTyping={takesNoTyping} width={paneWidth} onWidthChange={onPaneWidthChange} onClose={onShut} onKeyDown={onKeyDownInPane} onPressed={onPressed} wasPointerPressedLast={wasPointerPressedLast}>{listed.length === 0
      ? <PaneEmptyState title="" hint={defaultsAndLimitsMessages.noneChanged()} />
      : (<PaneSection title={null} className="pt-2"><PaneRow><Button variant="secondary" className="w-full" disabled={!mayAnyBeReset} onClick={() =>
              onAct({
                kind: 'resetAll',
              })}>{defaultsAndLimitsMessages.resetAll()}</Button></PaneRow><TooltipGroup closeDelay={0}><ul className="flex flex-col">{listed.map((cell) => <li key={Object.values(cell.cellId).join()}><ChangedCellRow cell={cell} onAct={onAct} /></li>)}</ul></TooltipGroup>{countNotListed > 0 &&
          <p className="px-lg py-1 text-center text-footnote text-muted">{moreChangedCellsLabel(countNotListed)}</p>}</PaneSection>)}</SidePane>;
});
