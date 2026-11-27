/**
 * The banner over the text when saving is in trouble: offline, edits waiting too long, or stopped. Once saving has
 * stopped the text can't be edited any more (what is typed would be lost); the banner offers to copy the page, to
 * reload, or to restore the document from its versions. Over it, while an owner has the doc locked, who locked it;
 * under it, after a reload that came before all edits were saved, a word to check that nothing is missing.
 */
import { Button, Dialog, toast } from '@open-artifact/ui';
import { CircleAlert, Lock, WifiOff } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { setDocs, useDocs } from '../app/store.ts';
import { useEditor } from '../editor/format.ts';
import { mayLock, setLocked } from './lock.ts';
import { ReloadNotice } from './ReloadNotice.tsx';
import { BANNER_WORDS, bannerFor, LOCK_MENU_WORDS, LOCKED_WORDS, lockedByWords, READ_ONLY_WORDS, RELOAD_WORDS } from './words.ts';

/** The open tab's text on the clipboard, as rich text and plain text. */
async function copyPage(): Promise<void> {
  const view = useEditor.getState().view;
  if (!view) return;
  const html = view.dom.innerHTML;
  const text = view.dom.innerText;
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) }),
      ]);
    } else await navigator.clipboard.writeText(text);
    toast.add({ title: 'Copied this tab' });
  } catch {
    toast.add({ title: 'Couldn’t copy', description: 'Select the text and copy it with ⌘C or Ctrl+C.' });
  }
}

/** Who locked the doc, and that nobody can edit it until an owner unlocks it. */
function LockBanner(): ReactNode {
  const locked = useDocs(state => state.project?.locked);
  if (!locked) return null;
  return (
    <div
      role="status"
      data-testid="lock-banner"
      title={READ_ONLY_WORDS}
      className="pointer-events-auto flex max-w-[640px] items-start gap-2.5 rounded-lg border border-chrome-line bg-chrome px-3 py-2.5 text-[13px] text-chrome-fg shadow-sm"
    >
      <Lock className="mt-0.5 size-4 flex-none text-chrome-muted" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{lockedByWords(locked.by.name)}</p>
        <p className="text-chrome-muted">{LOCKED_WORDS}</p>
        {locked.note ? <p className="text-chrome-muted">“{locked.note}”</p> : null}
        {mayLock() ? (
          <div className="mt-1 flex">
            <Button size="sm" onClick={() => void setLocked(false)}>
              {LOCK_MENU_WORDS.unlock}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SaveBanner(): ReactNode {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex flex-col items-center gap-2 px-4">
      <LockBanner />
      <SaveStateBanner />
      <ReloadNotice />
    </div>
  );
}

function SaveStateBanner(): ReactNode {
  const status = useDocs(state => (state.activeTab ? state.saving[state.activeTab] : undefined));
  const [reloading, setReloading] = useState(false);
  const kind = bannerFor(status);
  if (!kind) return null;
  const stopped = kind === 'stopped';
  const Icon = kind === 'offline' ? WifiOff : CircleAlert;

  return (
    <>
      <div
        role={stopped ? 'alert' : 'status'}
        data-testid="save-banner"
        data-kind={kind}
        className={`pointer-events-auto flex max-w-[640px] items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] shadow-sm ${
          stopped ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100' : 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100'
        }`}
      >
        <Icon className="mt-0.5 size-4 flex-none" aria-hidden />
        <div className="flex flex-col gap-2">
          <p>{BANNER_WORDS[kind]}</p>
          {stopped ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void copyPage()}>
                Copy this tab
              </Button>
              <Button size="sm" onClick={() => setDocs({ history: true })}>
                Restore the document…
              </Button>
              <Button size="sm" variant="primary" onClick={() => setReloading(true)}>
                Reload
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {reloading ? (
        <Dialog
          open
          onOpenChange={open => setReloading(open)}
          title={RELOAD_WORDS.title}
          description={RELOAD_WORDS.description}
          footer={
            <>
              <Button autoFocus onClick={() => setReloading(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => location.reload()}>
                Reload
              </Button>
            </>
          }
        />
      ) : null}
    </>
  );
}
