// The window's page: the sidebar, the tab bar, and the home page (the shared `ArtifactsPage`). The home page stays
// mounted while an artifact's tab is in front (its view covers this part of the window), so its list keeps following
// the library and the sidebar keeps showing it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArtifactsPage, EMPTY_SESSIONS, EnvProvider, StoreProvider, createPageStore } from '@open-artifact/library-page';
import { Sidebar } from './Sidebar.jsx';
import { TabBar } from './TabBar.jsx';
import { NewDialog } from './NewDialog.jsx';
import { pageApi, pageHost, tileGroups } from './host.js';
import { wordsFor } from './words.js';

export function App({ initial }) {
  const [state, setState] = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchWanted, setSearchWanted] = useState(0);
  const stateRef = useRef(initial);
  stateRef.current = state;
  const { locale, theme, platform } = state.look;

  const t = useMemo(() => wordsFor(locale), [locale]);
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
  const env = useMemo(() => ({ t, api: pageApi, sessions: EMPTY_SESSIONS }), [t]);

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

  // A dialog is drawn over the artifact's view: the view is hidden while it is open.
  useEffect(() => {
    void window.desktop.setOverlay(dialogOpen);
  }, [dialogOpen]);

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
          {!collapsed && <Sidebar t={t} state={state} platform={platform} onNew={openDialog} onSearch={onSearch} />}
          <div className="main">
            <TabBar t={t} state={state} platform={platform} onNew={openDialog} />
            <main className="content" data-testid="home" hidden={state.current !== 'home'}>
              <ArtifactsPage canCreate theme={theme} platform={platform} searchButton={false} createButton={false} tileGroups={groups} />
            </main>
          </div>
        </div>
        {dialogOpen && <NewDialog t={t} onClose={() => setDialogOpen(false)} />}
      </StoreProvider>
    </EnvProvider>
  );
}
