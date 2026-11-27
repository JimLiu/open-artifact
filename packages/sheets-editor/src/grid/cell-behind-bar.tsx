import * as React from 'react';
import { Button } from '../kit/button.tsx';
import { Tooltip } from '../kit/tooltip.tsx';
import { goToAddressLabel, interactiveSheetMessages } from '../messages/import.ts';
import { GOES_TO_CELL_BEHIND_ATTRIBUTE } from './focus-left.ts';
import type { CellOfInteractivePlace } from '../state/places.ts';
export interface CellBehindBarProps {
  cell: CellOfInteractivePlace | null;
  areCellsOffered: boolean;
  canWrite: boolean;
  isDrawn: boolean;
  onGoneTo: (cell: CellOfInteractivePlace) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}
/** The bar that names the cell behind an interactive view and goes to it. */
export function CellBehindBar({ cell, areCellsOffered, canWrite, isDrawn, onGoneTo, onKeyDown }: CellBehindBarProps) {
  let address = cell === null ? '' : `${cell.sheetName}!${cell.address}`;
  return <div className="sheet-cell-behind flex min-w-0 flex-1 items-center gap-sm px-sm">{cell === null &&
      (areCellsOffered || canWrite) &&
      <span className={`truncate px-sm text-muted ${isDrawn ? '' : 'invisible'}`}>{areCellsOffered ? interactiveSheetMessages.wayToCell() : interactiveSheetMessages.wayToWrittenCell()}</span>}{cell !== null &&
      <Tooltip content={goToAddressLabel(address)} side="bottom"><Button variant="ghost" size="sm" className="max-w-[40%] flex-none" aria-label={goToAddressLabel(address)} aria-description={cell.text} {...{
            [GOES_TO_CELL_BEHIND_ATTRIBUTE]: true,
          }} onClick={() => onGoneTo(cell)} onKeyDown={onKeyDown}><span className="flex min-w-0"><span className="truncate">{cell.sheetName}</span><span className="flex-none">{address.slice(cell.sheetName.length)}</span></span></Button></Tooltip>}<span className="sheet-cell-behind-text" data-shows-formula={cell?.text.startsWith('=') === true || undefined}>{cell?.text}</span></div>;
}
