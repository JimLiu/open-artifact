/** "Restore your unsaved changes to X?": offered once after a visit that closed before saving. */

import { History } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@open-artifact/ui';
import { discardRecovery, restoreRecovery, useRecovery } from '../services/recovery.ts';
import { Card } from '@open-artifact/editor-kit/react';
import { landFocusAfterDismiss } from '../services/focus-landing.ts';

export function RecoveryBanner() {
  const offer = useRecovery((s) => s.offer);
  const card = useRef<HTMLDivElement>(null);
  if (!offer) return null;
  // The banner goes away with the button that has focus: keep the keyboard's place near it.
  const answer = (run: () => void) => () => {
    if (card.current?.contains(document.activeElement)) landFocusAfterDismiss();
    run();
  };
  const when = new Date(offer.stash.at);
  return (
    <Card ref={card} role="alertdialog" aria-label="Unsaved changes found" className="pointer-events-auto max-w-[min(36rem,calc(100vw-24px))] gap-2 py-1.5 pl-3 pr-1.5">
      <History className="size-4 shrink-0 text-chrome-muted" strokeWidth={1.5} />
      <span className="min-w-0 text-[13px] leading-5 text-chrome-fg">
        {offer.prompt}
        <span className="ml-1 text-chrome-muted">
          From {when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} {when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.
        </span>
      </span>
      <Button size="sm" onClick={answer(discardRecovery)}>
        Discard
      </Button>
      <Button size="sm" variant="primary" onClick={answer(restoreRecovery)}>
        Restore
      </Button>
    </Card>
  );
}
