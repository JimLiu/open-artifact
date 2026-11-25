import type { PageArtifact } from '@open-artifact/library-page';
import type { DesktopState } from '../../src/contracts.ts';
import type { TabSnapshot } from '../../src/tabs.ts';
import type { ArtifactMenu } from './types.ts';
// The window's page: the sidebar, the tab bar, and the home page (the shared `ArtifactsPage`). The home page stays
// mounted while an artifact's tab is in front (its view covers this part of the window), so its list keeps following
// the library and the sidebar keeps showing it.
import { ArtifactsPage, EMPTY_SESSIONS, EnvProvider, StoreProvider, createPageStore } from '@open-artifact/library-page';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InstallAppDialog } from './InstallAppDialog.tsx';
import { NewDialog } from './NewDialog.tsx';
import { ServerButton, ServerPanel, useServers } from './ServerSwitcher.tsx';
import { ServicePanel, ServiceStatus } from './ServicePanel.tsx';
import { SettingsDialog } from './SettingsDialog.tsx';
import { Sidebar } from './Sidebar.tsx';
import { TabBar, TabMenu } from './TabBar.tsx';
import { MissingFolder, UnsavedDialog } from './Unsaved.tsx';
import { pageApi, pageHost, setTypeWords, tileGroups } from './host.ts';
import { runtimeUpdates, useRuntime, useService } from './service.ts';
import { typeName, wordsFor } from './words.ts';

/** The cards' icons for Show in Finder (a folder) and Move To… (a folder with an arrow), 16×16 paths. */
export const FOLDER_ICON = 'M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7.5Z';
/** The cards' icon for Install as App… (an app's square with an arrow into it), 16×16 paths. */
export const APP_ICON = 'M3.5 3.5h9v9h-9zM8 5.5v4M6.25 7.75 8 9.5l1.75-1.75';
export const MOVE_ICON = 'M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7.5ZM6 9h4.5M9 7.5 10.5 9 9 10.5';

export function App({ initial }: { initial: DesktopState }) {
  const [state, setState] = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchWanted, setSearchWanted] = useState(0);
  // The service panel (`{ ask }`: opened with a question asked) and the settings dialog.
  const [servicePanel, setServicePanel] = useState<{ ask: 'restart' | 'stop' | null } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The servers switcher (the sites this computer is connected to).
  const [serversOpen, setServersOpen] = useState(false);
  // "Install as app" of one artifact (`{ id, title }`), and a tab's right-click menu (`{ id, title, x, y }`).
  const [installFor, setInstallFor] = useState<{ id: string; title: string } | null>(null);
  const [tabMenu, setTabMenu] = useState<ArtifactMenu | null>(null);
  const servers = useServers();
  const service = useService();
  const runtime = useRuntime();
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const runtimeListeners = useRef(new Set<() => void>());
  useEffect(() => {
    for (const listener of runtimeListeners.current) listener();
  }, [runtime]);
  const stateRef = useRef(initial);
  stateRef.current = state;
  const { locale, theme, platform } = state.look;

  const t = useMemo(() => wordsFor(locale), [locale]);
  // Before the store's first list: the type names the shared page has no word for are the app's.
  setTypeWords((id, title) => typeName(t, id, title));
  const store = useMemo(
    () =>
      createPageStore({
        api: pageApi,
        host: pageHost({
          openDialog: () => setDialogOpen(true),
          failed: (message) => store.getState().showToast(t('create.failed', { message }), 'error'),
          visible: () => !!stateRef.current.thumbnails && stateRef.current.current === 'home',
        }),
        t,
      }),
    // One store for the window's life; the words are its language's, which does not change while it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // The runtime's offer at the top of the library (the shared page's update panel); "Restart now" is the service's
  // restart, asked first as in the service panel.
  const updates = useMemo(
    () =>
      runtimeUpdates({
        get: () => runtimeRef.current,
        subscribe: (listener) => {
          runtimeListeners.current.add(listener);
          return () => runtimeListeners.current.delete(listener);
        },
        t,
        restart: () => setServicePanel({ ask: 'restart' }),
      }),
    [t],
  );
  const env = useMemo(() => ({ t, api: pageApi, sessions: EMPTY_SESSIONS, updates }), [t, updates]);

  useEffect(() => window.desktop.onState(setState), []);
  /** An artifact's title, from the page's store (the newest), else its tab's. */
  const titleOfId = (id: string) =>
    store.getState().artifacts.find((a) => a.id === id)?.title || stateRef.current.tabs.find((tab) => tab.id === id)?.title || id;

  // What the menu bar asks of this page.
  useEffect(
    () =>
      window.desktop.onCommand(({ name, arg }) => {
        if (name === 'settings') setSettingsOpen(true);
        else if (name === 'new-dialog') setDialogOpen(true);
        else if (name === 'service') setServicePanel({ ask: null });
        else if (name === 'servers') setServersOpen(true);
        else if (name === 'install-app' && typeof arg?.id === 'string') setInstallFor({ id: arg.id, title: titleOfId(arg.id) });
        else if (name === 'toast' && typeof arg?.message === 'string') store.getState().showToast(arg.message, arg.kind === 'error' ? 'error' : 'info');
      }),
    [store],
  );

  // Show in Finder and Move To… in each card's More menu (and the sidebar's right-click menu): the main process's.
  const artifactDo = useCallback(
    (act: 'reveal' | 'move' | 'relocate', id: string) =>
      void window.desktop.artifactDo(act, id).then((out) => {
        if (out && out.ok === false) store.getState().showToast(t('action.failed', { message: out.error }), 'error');
      }),
    [store, t],
  );
  const cardActions = useMemo(
    () => [
      { id: 'reveal', label: t('card.reveal'), icon: FOLDER_ICON, run: (artifact: PageArtifact) => artifactDo('reveal', artifact.id) },
      { id: 'move', label: t('card.move'), icon: MOVE_ICON, run: (artifact: PageArtifact) => artifactDo('move', artifact.id) },
      {
        id: 'install-app',
        label: t('menu.installApp'),
        icon: APP_ICON,
        run: (artifact: PageArtifact) => setInstallFor({ id: artifact.id, title: artifact.title || artifact.id }),
      },
    ],
    [t, artifactDo],
  );

  // The look and the language on the root, for the CSS.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.platform = platform;
    root.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [theme, platform, locale]);

  // The window's title follows the tab in front.
  useEffect(() => {
    const tab = state.tabs.find((x) => x.id === state.current);
    const title = tab ? store.getState().artifacts.find((a) => a.id === tab.id)?.title || tab.title : '';
    document.title = title ? `${title} — Open Artifact` : 'Open Artifact';
  }, [state, store]);

  // Thumbnails can be taken again once the window is on screen: the list's reload starts them.
  const thumbnails = !!state.thumbnails;
  useEffect(() => {
    if (thumbnails) void store.getState().reload();
  }, [thumbnails, store]);

  // A dialog is drawn over the artifact's view: the view is hidden while one is open (the main process's question
  // about unsaved work too).
  // A tab's menu too: it drops below the tab bar, where the view is.
  const overlay = dialogOpen || !!servicePanel || settingsOpen || serversOpen || !!state.ask || !!installFor || !!tabMenu;
  useEffect(() => {
    void window.desktop.setOverlay(overlay);
  }, [overlay]);

  // Search: the library comes to the front, the keyboard comes back to this page, then the search field takes it.
  const onSearch = useCallback(() => {
    void window.desktop.select('home');
    setSearchWanted((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!searchWanted || state.current !== 'home') return;
    void window.desktop.focus().then(() => store.getState().focusSearch());
    setSearchWanted(0);
  }, [searchWanted, state.current, store]);

  const openDialog = useCallback(() => setDialogOpen(true), []);
  const titleOf = (tab: TabSnapshot) => store.getState().artifacts.find((a) => a.id === tab.id)?.title || tab.title || tab.id;
  const installApp = useCallback((id: string, title: string) => setInstallFor({ id, title }), []);
  const closeTabMenu = useCallback(() => setTabMenu(null), []);
  // The tabs with work not saved, named in the service panel's restart and stop questions.
  const unsavedNames = state.tabs.filter((tab) => tab.unsaved).map(titleOf);
  const front = state.tabs.find((tab) => tab.id === state.current);
  const frontArtifact = front ? store.getState().artifacts.find((a) => a.id === front.id) : null;
  const groups = useMemo(() => tileGroups(t), [t]);
  const collapsed = !!state.sidebarCollapsed;

  return (
    <EnvProvider env={env}>
      <StoreProvider store={store}>
        <div className="window" data-sidebar={collapsed ? 'collapsed' : 'open'}>
          {!collapsed && (
            <Sidebar
              t={t}
              state={state}
              platform={platform}
              onNew={openDialog}
              onSearch={onSearch}
              onSettings={() => setSettingsOpen(true)}
              artifactDo={artifactDo}
              onInstallApp={installApp}
            />
          )}
          <div className="main">
            <TabBar t={t} state={state} platform={platform} onNew={openDialog} onMenu={setTabMenu} />
            <main className="content" data-testid="home" hidden={state.current !== 'home'}>
              <ArtifactsPage
                canCreate
                theme={theme}
                platform={platform}
                searchButton={false}
                createButton={false}
                tileGroups={groups}
                headingTools={
                  <>
                    <ServerButton t={t} view={servers} onOpen={() => setServersOpen(true)} />
                    <ServiceStatus t={t} service={service} onOpen={() => setServicePanel({ ask: null })} />
                  </>
                }
                cardActions={cardActions}
              />
            </main>
            {front?.status === 'missing' && (
              <main className="content" data-testid="missing">
                <MissingFolder t={t} tab={front} title={titleOf(front)} type={frontArtifact?.type ?? front.type} />
              </main>
            )}
          </div>
        </div>
        {dialogOpen && <NewDialog t={t} onClose={() => setDialogOpen(false)} />}
        {tabMenu && <TabMenu t={t} menu={tabMenu} onClose={closeTabMenu} onInstallApp={installApp} />}
        {installFor && <InstallAppDialog key={installFor.id} t={t} artifact={installFor} onClose={() => setInstallFor(null)} />}
        {settingsOpen && !servicePanel && !serversOpen && (
          <SettingsDialog
            t={t}
            settings={state.settings}
            service={service}
            runtime={runtime}
            servers={servers}
            onService={() => setServicePanel({ ask: null })}
            onServers={() => setServersOpen(true)}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        {serversOpen && !servicePanel && <ServerPanel t={t} view={servers} onClose={() => setServersOpen(false)} />}
        {servicePanel && (
          <ServicePanel t={t} service={service} runtime={runtime} ask={servicePanel.ask} unsaved={unsavedNames} onClose={() => setServicePanel(null)} />
        )}
        {state.ask && <UnsavedDialog key={state.ask.id} t={t} ask={state.ask} />}
      </StoreProvider>
    </EnvProvider>
  );
}
