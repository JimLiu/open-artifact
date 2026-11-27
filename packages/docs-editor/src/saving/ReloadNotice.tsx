/** The notice owed after a reload that came before all edits were saved (reload-notice.ts): check that nothing is missing. */
import { IconButton } from '@open-artifact/ui';
import { CircleAlert, X } from 'lucide-react';
import { type ReactNode } from 'react';
import { useDocs } from '../app/store.ts';
import { RELOAD_NOTICE_WORDS } from './left-unsaved.ts';
import { dismissReloadNotice, useReloadNotice } from './reload-notice.ts';

export function ReloadNotice(): ReactNode {
  const tab = useReloadNotice(state => (state.shown ? state.tab : null));
  const active = useDocs(state => state.activeTab);
  if (!tab || tab !== active) return null;
  return (
    <div
      role="status"
      data-testid="reload-notice"
      className="pointer-events-auto flex max-w-[640px] items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-950 shadow-sm dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <CircleAlert className="mt-0.5 size-4 flex-none" aria-hidden />
      <p className="flex-1">{RELOAD_NOTICE_WORDS}</p>
      <IconButton size="sm" label="Dismiss" icon={<X className="size-3.5" />} onClick={dismissReloadNotice} />
    </div>
  );
}
