import { LoaderCircle, MessageSquare, TriangleAlert, X } from 'lucide-react';
import { useRef, type ReactElement } from 'react';
import { Button, IconButton } from '@open-artifact/ui';
import { ASK_AGENT_LABEL, PAGE_FIXING_TEXT, PAGE_NEEDS_FIX_TEXT } from '../page/check.ts';
import { useDismissFocusLanding } from './dismiss-focus.ts';

/** "Something on this page stopped working.", with Ask the agent and Dismiss. */
export function PageNeedsFixNotice({ onAsk, onDismiss }: { onAsk?: () => void; onDismiss?: () => void }): ReactElement {
  const banner = useRef<HTMLDivElement | null>(null);
  const dismiss = useDismissFocusLanding(banner, onDismiss);
  return (
    <div ref={banner} role="status" className="flex items-center gap-2 rounded-control border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-fg">
      <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">{PAGE_NEEDS_FIX_TEXT}</span>
      {onAsk === undefined ? null : (
        <Button size="sm" icon={<MessageSquare className="size-3.5" aria-hidden />} onClick={onAsk}>
          {ASK_AGENT_LABEL}
        </Button>
      )}
      {dismiss === undefined ? null : <IconButton size="sm" label="Dismiss" icon={<X className="size-3.5" />} onClick={dismiss} />}
    </div>
  );
}

/** "The agent is fixing this page", with the working mark. */
export function PageFixingNotice(): ReactElement {
  return (
    <div role="status" className="flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 text-[13px] text-fg">
      <LoaderCircle className="size-3.5 shrink-0 animate-spin text-fg-muted" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{PAGE_FIXING_TEXT}</span>
    </div>
  );
}
