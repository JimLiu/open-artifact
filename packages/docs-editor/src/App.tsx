/** The Docs page: the top bar, the open tab's text on its page, and the panels beside it. */
import { type ReactNode } from 'react';
import { editorActions } from './app/actions.ts';
import { useDisplay, useDocs } from './app/store.ts';
import { PageBar } from './chrome/PageBar.tsx';
import { Slot } from './chrome/Slot.tsx';
import { TopBar } from './chrome/TopBar.tsx';
import { DocEditor } from './editor/DocEditor.tsx';
import { VersionPreview, useVersionPreviewing } from './history/index.ts';
import { ExportScopeDialog } from './topbar/ExportScopeDialog.tsx';

export function App(): ReactNode {
  const phase = useDocs(state => state.phase);
  if (phase.kind === 'opening') return <div className="grid h-full place-items-center text-sm text-chrome-muted">Opening…</div>;
  if (phase.kind === 'failed')
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-sm">
          <div className="mb-1 text-sm font-medium">This doc could not be opened</div>
          <div className="text-sm text-chrome-muted">{phase.message}</div>
        </div>
      </div>
    );
  return <DocShell />;
}

function DocShell(): ReactNode {
  const activeTab = useDocs(state => state.activeTab);
  const display = useDisplay();
  const previewing = useVersionPreviewing();
  return (
    <div className="flex h-full flex-col" data-tabs-location={display.tabsLocation}>
      <TopBar />
      <PageBar />
      <div className="relative flex min-h-0 flex-1">
        <Slot name="aside" />
        <main className="doc-scroll relative min-w-0 flex-1 overflow-y-auto" data-doc-scroll="">
          <div
            className="doc-page relative mx-auto px-[52px] pt-16 pb-[40vh]"
            data-text-font={display.textFont}
            data-heading-font={display.headingFont}
            data-width={display.pageWidth}
            style={{ maxWidth: 'calc(var(--doc-width) + 104px)' }}
          >
            {previewing ? (
              <VersionPreview />
            ) : (
              <>
                {activeTab ? <DocEditor key={activeTab} tabId={activeTab} actions={editorActions} /> : null}
                <Slot name="layer" />
              </>
            )}
          </div>
        </main>
        <Slot name="float" />
        <Slot name="rail" />
      </div>
      <Slot name="overlay" />
      <ExportScopeDialog />
    </div>
  );
}
