import { AlertDialog } from '../kit/dialog.tsx';
import type { DialogPopupProps } from '../kit/dialog.tsx';
import { Button } from '../kit/button.tsx';
import * as React from 'react';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import type { PasteThatWaitsShown } from './paste-that-waits.ts';
import { WrittenCode } from '../tables/connected-table-call.tsx';

interface HiddenTextPasteDialogProps {
  /** The paste that waits for an answer, or `null` when none does. */
  shown: PasteThatWaitsShown | null;
  whatHasCaretAfter: DialogPopupProps['finalFocus'];
  onAnswered: (nth: number, isToBePasted: boolean) => void;
}

export function scrollBoxByKey(box: HTMLElement | null, keyEvent: React.KeyboardEvent): void {
  if (box === null || keyEvent.target === box) return;
  let pagesToScroll = SCROLL_KEY_STEPS.get(keyEvent.key);
  if (pagesToScroll === void 0) return;
  keyEvent.preventDefault();
  box.scrollBy({
    top: pagesToScroll * box.clientHeight,
  });
}
export function preventRepeatedPress(keyEvent: React.KeyboardEvent<HTMLButtonElement>): void {
  if (keyEvent.repeat && (keyEvent.key === 'Enter' || keyEvent.key === ' ')) keyEvent.preventDefault();
}
export const NO_HIDDEN_TEXT_ROWS: PasteThatWaitsShown = {
  nth: 0,
  rows: [],
};
export const SCROLL_KEY_STEPS = new Map<string, number>([
  ['ArrowDown', 0.1],
  ['ArrowUp', -0.1],
  ['PageDown', 0.9],
  ['PageUp', -0.9],
]);
export const HiddenTextPasteDialog = React.memo(function ({
  shown,
  whatHasCaretAfter,
  onAnswered,
}: HiddenTextPasteDialogProps) {
  let [lastShown, setLastShown] = React.useState(NO_HIDDEN_TEXT_ROWS);
  if (shown !== null && shown !== lastShown) setLastShown(shown);
  let { nth, rows } = shown ?? lastShown;
  let cancelRef = React.useRef<HTMLButtonElement>(null);
  let rowsBoxRef = React.useRef<HTMLDivElement>(null);
  let onOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) onAnswered(nth, false);
    },
    [nth, onAnswered],
  );
  let pasteAnyway = React.useCallback(
    (clickEvent: React.MouseEvent<HTMLButtonElement>) => {
      if (clickEvent.detail <= 1) onAnswered(nth, true);
    },
    [nth, onAnswered],
  );
  return <AlertDialog.Root open={shown !== null} onOpenChange={onOpenChange}><AlertDialog.Popup key={nth} initialFocus={cancelRef} finalFocus={whatHasCaretAfter} onKeyDown={(keyEvent) => scrollBoxByKey(rowsBoxRef.current, keyEvent)}><AlertDialog.Title>{sheetMessages.pasteCellsWithHiddenText()}</AlertDialog.Title><AlertDialog.Description render={<div />} className="flex min-h-0 flex-col gap-md"><p>{sheetMessages.cellsContainTextNotShown()}</p><div className="flex min-h-0 flex-col rounded bg-alpha-1"><div ref={rowsBoxRef} className="scroll-fade-y min-h-0 overflow-y-auto p-md"><ul className="flex flex-col gap-sm text-primary">{rows.map(
                      ({ key, address, written }) =>
                        (<li key={key} className="flex gap-md"><span className="min-w-12 shrink-0 text-secondary tabular-nums">{address}</span><span dir="ltr" className="min-w-0 wrap-anywhere whitespace-pre-wrap"><WrittenCode written={written} /></span></li>),
                    )}</ul></div></div></AlertDialog.Description><AlertDialog.Footer align="end"><AlertDialog.Close render={<Button ref={cancelRef} variant="secondary" data-initial-focus="" onKeyDown={preventRepeatedPress}>{sheetMessages.cancel()}</Button>} /><Button variant="primary" onKeyDown={preventRepeatedPress} onClick={pasteAnyway}>{sheetMessages.pasteAnyway()}</Button></AlertDialog.Footer></AlertDialog.Popup></AlertDialog.Root>;
});
