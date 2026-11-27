import * as React from 'react';
import { AlertDialog } from '../kit/dialog.tsx';
import type { DialogPopupProps } from '../kit/dialog.tsx';
import { Banner } from '../kit/banner.tsx';
import { Button } from '../kit/button.tsx';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { preventRepeatedPress, scrollBoxByKey } from '../clipboard/hidden-text-paste-dialog.tsx';
import { connectedTableMessages } from './connected-table-messages.ts';
import { CallView, WrittenCode } from './connected-table-call.tsx';
import type { CallToConfirmShown } from './connected-table-view.ts';

export interface CallConfirmDialogProps {
  /** The call that waits to be confirmed, or `null` when none does. */
  shown: CallToConfirmShown | null;
  whatHasCaretAfter: DialogPopupProps['finalFocus'];
  onAnswered: (nth: number, isToRun: boolean) => void;
}

export const CallConfirmDialog = React.memo(function ({ shown, whatHasCaretAfter, onAnswered }: CallConfirmDialogProps) {
  let [lastShown, setLastShown] = React.useState(shown);
  if (shown !== null && shown !== lastShown) setLastShown(shown);
  let toConfirm = shown ?? lastShown,
    nth = toConfirm?.nth ?? 0,
    cancelRef = React.useRef<HTMLButtonElement>(null),
    scrollBoxRef = React.useRef<HTMLDivElement>(null),
    onOpenChange = React.useCallback(
      (open: boolean) => {
        if (!open) onAnswered(nth, false);
      },
      [nth, onAnswered],
    ),
    run = React.useCallback(
      (clickEvent: React.MouseEvent<HTMLButtonElement>) => {
        if (clickEvent.detail <= 1) onAnswered(nth, true);
      },
      [nth, onAnswered],
    );
  return (
    <AlertDialog.Root open={shown !== null} onOpenChange={onOpenChange}>
      <AlertDialog.Popup key={nth} initialFocus={cancelRef} finalFocus={whatHasCaretAfter} onKeyDown={(keyEvent) => scrollBoxByKey(scrollBoxRef.current, keyEvent)}>
        <AlertDialog.Title>{connectedTableMessages.runWithYourAccess()}</AlertDialog.Title>
        <AlertDialog.Description render={<div />} className="flex min-h-0 flex-col gap-md">
          <p>{connectedTableMessages.whoSees()}</p>
          {toConfirm?.isMarkedReadOnly === false ? (
            <Banner variant="warning" role="none">
              {connectedTableMessages.mayChangeData()}
              {' '}
              {connectedTableMessages.mayRunTwice()}
            </Banner>
          ) : (
            <p>{connectedTableMessages.mayRunTwice()}</p>
          )}
          {toConfirm !== null && (
            <div ref={scrollBoxRef} className="scroll-fade-y flex min-h-0 flex-col gap-sm overflow-y-auto">
              <h3 dir="auto" className="text-body-semibold wrap-anywhere text-primary">
                <WrittenCode written={toConfirm.call.title} />
              </h3>
              <CallView call={toConfirm.call} />
            </div>
          )}
        </AlertDialog.Description>
        <AlertDialog.Footer align="end">
          <AlertDialog.Close
            render={
              <Button ref={cancelRef} variant="secondary" data-initial-focus="" onKeyDown={preventRepeatedPress}>
                {sheetMessages.cancel()}
              </Button>
            }
          />
          <Button variant="primary" onKeyDown={preventRepeatedPress} onClick={run}>
            {connectedTableMessages.run()}
          </Button>
        </AlertDialog.Footer>
      </AlertDialog.Popup>
    </AlertDialog.Root>
  );
});
