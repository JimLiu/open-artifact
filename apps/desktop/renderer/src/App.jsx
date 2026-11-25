// The window's page: the sidebar, the tab bar, and the home page (the shared `ArtifactsPage`). The home page stays
// mounted while an artifact's tab is in front (its view covers this part of the window), so its list keeps following
// the library and the sidebar keeps showing it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArtifactsPage, EMPTY_SESSIONS, EnvProvider, StoreProvider, createPageStore } from '@open-artifact/library-page';
import { Sidebar } from './Sidebar.jsx';
import { TabBar } from './TabBar.jsx';
import { NewDialog } from './NewDialog.jsx';
import { ServicePanel, ServiceStatus } from './ServicePanel.jsx';
import { SettingsDialog } from './SettingsDialog.jsx';
import { pageApi, pageHost, setTypeWords, tileGroups } from './host.js';
import { runtimeUpdates, useRuntime, useService } from './service.js';
import { typeName, wordsFor } from './words.js';

export function App({ initial }) {
  const [state, setState] = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchWanted, setSearchWanted] = useState(0);
  // The service panel (`{ ask }`: opened with a question asked) and the settings dialog.
  const [servicePanel, setServicePanel] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const service = useService();
  const runtime = useRuntime();
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const runtimeListeners = useRef(new Set());
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

  // A dialog is drawn over the artifact's view: the view is hidden while one is open.
  const overlay = dialogOpen || !!servicePanel || settingsOpen;
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
  const groups = useMemo(() => tileGroups(t), [t]);
  const collapsed = !!state.sidebarCollapsed;

  return (
    <EnvProvider env={env}>
      <StoreProvider store={store}>
        <div className="window" data-sidebar={collapsed ? 'collapsed' : 'open'}>
          {!collapsed && <Sidebar t={t} state={state} platform={platform} onNew={openDialog} onSearch={onSearch} onSettings={() => setSettingsOpen(true)} />}
          <div className="main">
            <TabBar t={t} state={state} platform={platform} onNew={openDialog} />
            <main className="content" data-testid="home" hidden={state.current !== 'home'}>
              <ArtifactsPage
                canCreate
                theme={theme}
                platform={platform}
                searchButton={false}
                createButton={false}
                tileGroups={groups}
                headingTools={<ServiceStatus t={t} service={service} onOpen={() => setServicePanel({ ask: null })} />}
              />
            </main>
          </div>
        </div>
        {dialogOpen && <NewDialog t={t} onClose={() => setDialogOpen(false)} />}
        {settingsOpen && !servicePanel && (
          <SettingsDialog t={t} settings={state.settings} service={service} runtime={runtime} onService={() => setServicePanel({ ask: null })} onClose={() => setSettingsOpen(false)} />
        )}
        {servicePanel && <ServicePanel t={t} service={service} runtime={runtime} ask={servicePanel.ask} onClose={() => setServicePanel(null)} />}
      </StoreProvider>
    </EnvProvider>
  );
}
