import type { PageArtifact } from '@open-artifact/library-page';
import type { ArtifactAction, ArtifactMenu, DialogProps, InstallApp, WindowProps, WordsProps } from './types.ts';
// The sidebar: the window's controls (room for the macOS window buttons, collapse, back, forward), New, Search, the
// library, the pinned artifacts and the ones changed last. Its lists are the home page's store: they follow every
// change the page sees (made, renamed, pinned, deleted), at once.
import { ArtifactsIcon, TypeIcon, typeStyle, usePage } from '@open-artifact/library-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackIcon, ChevronIcon, ForwardIcon, PlusIcon, SearchIcon, SettingsIcon, SidebarIcon } from './icons.tsx';

/** How many of the artifacts changed last the sidebar lists. */
export const RECENT_MAX = 8;

const latest = (key: 'openedAt' | 'updatedAt') => (a: PageArtifact, b: PageArtifact) => (b[key] || '').localeCompare(a[key] || '');

/** The window's controls: collapse or expand the sidebar, back, forward. Also at the tab bar's start when collapsed. */
export function WindowControls({ t, state, platform }: WindowProps) {
  const desktop = window.desktop;
  const collapsed = !!state.sidebarCollapsed;
  return (
    <div className="window-controls">
      {platform === 'darwin' && <span className="traffic-room" aria-hidden="true" />}
      <button
        type="button"
        className="icon-button"
        data-testid="toggle-sidebar"
        aria-label={t(collapsed ? 'sidebar.expand' : 'sidebar.collapse')}
        title={t(collapsed ? 'sidebar.expand' : 'sidebar.collapse')}
        aria-expanded={!collapsed}
        onClick={() => void desktop.setSidebarCollapsed(!collapsed)}
      >
        <SidebarIcon />
      </button>
      <button
        type="button"
        className="icon-button"
        data-testid="back"
        aria-label={t('nav.back')}
        title={t('nav.back')}
        disabled={!state.canBack}
        onClick={() => void desktop.back()}
      >
        <BackIcon />
      </button>
      <button
        type="button"
        className="icon-button"
        data-testid="forward"
        aria-label={t('nav.forward')}
        title={t('nav.forward')}
        disabled={!state.canForward}
        onClick={() => void desktop.forward()}
      >
        <ForwardIcon />
      </button>
    </div>
  );
}

/** The width of the sidebar's right-click menu (CSS `.row-menu`); it stays inside the sidebar, off the artifact's view. */
const MENU_WIDTH = 200;

/**
 * A row's right-click menu: Open, Show in Finder, Move To…, Install as App… (an artifact's view would be drawn over a
 * menu past the sidebar).
 */
function RowMenu({ t, menu, onClose, artifactDo, onInstallApp }: DialogProps & { menu: ArtifactMenu; artifactDo: ArtifactAction; onInstallApp: InstallApp }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('button')?.focus();
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target instanceof Node ? event.target : null)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', away, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  const item = (testid: string, label: string, run: () => void) => (
    <button
      type="button"
      role="menuitem"
      className="row-menu-item"
      data-testid={testid}
      onClick={() => {
        onClose();
        run();
      }}
    >
      {label}
    </button>
  );
  const sidebar = box.current?.parentElement?.getBoundingClientRect();
  const left = Math.max(4, Math.min(menu.x, (sidebar?.width ?? 240) - MENU_WIDTH - 4));
  const top = Math.max(4, Math.min(menu.y, window.innerHeight - 160));
  return (
    <div
      ref={box}
      className="row-menu"
      role="menu"
      aria-label={t('row.menu', { title: menu.title })}
      data-testid="row-menu"
      data-artifact={menu.id}
      style={{ left, top }}
    >
      {item('row-open', t('row.open'), () => void window.desktop.open(menu.id))}
      <div className="row-menu-rule" role="separator" />
      {item('row-reveal', t('card.reveal'), () => artifactDo('reveal', menu.id))}
      {item('row-move', t('card.move'), () => artifactDo('move', menu.id))}
      <div className="row-menu-rule" role="separator" />
      {item('row-install-app', t('menu.installApp'), () => onInstallApp(menu.id, menu.title))}
    </div>
  );
}

function ArtifactRow({ artifact, current, t, onMenu }: WordsProps & { artifact: PageArtifact; current: boolean; onMenu(menu: ArtifactMenu): void }) {
  const title = artifact.title || t('nav.untitled');
  return (
    <li>
      <button
        type="button"
        className="nav-row artifact-row"
        data-artifact={artifact.id}
        aria-current={current ? 'page' : undefined}
        title={title}
        style={typeStyle(artifact.type)}
        onClick={() => void window.desktop.open(artifact.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu({ id: artifact.id, title, x: event.clientX, y: event.clientY });
        }}
      >
        <span className="type-glyph">
          <TypeIcon type={artifact.type} size={16} />
        </span>
        <span className="row-title">{title}</span>
      </button>
    </li>
  );
}

export function Sidebar({
  t,
  state,
  platform,
  onNew,
  onSearch,
  onSettings,
  artifactDo,
  onInstallApp,
}: WindowProps & { onNew(): void; onSearch(): void; onSettings(): void; artifactDo: ArtifactAction; onInstallApp: InstallApp }) {
  const artifacts = usePage((s) => s.artifacts);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [menu, setMenu] = useState<ArtifactMenu | null>(null);
  const closeMenu = useMemo(() => () => setMenu(null), []);
  const pinned = useMemo(() => artifacts.filter((a) => a.pinned).sort(latest('openedAt')), [artifacts]);
  const recent = useMemo(
    () =>
      artifacts
        .filter((a) => !a.pinned)
        .sort(latest('updatedAt'))
        .slice(0, RECENT_MAX),
    [artifacts],
  );
  const onHome = state.current === 'home';
  return (
    <nav className="sidebar" aria-label={t('sidebar.label')} data-testid="sidebar">
      <div className="sidebar-top drag">
        <WindowControls t={t} state={state} platform={platform} />
      </div>
      <button type="button" className="nav-row" data-testid="nav-new" onClick={onNew}>
        <PlusIcon />
        {t('nav.new')}
      </button>
      <button type="button" className="nav-row" data-testid="nav-search" onClick={onSearch}>
        <SearchIcon />
        {t('nav.search')}
      </button>
      <button
        type="button"
        className="nav-row"
        data-testid="nav-library"
        aria-current={onHome ? 'page' : undefined}
        onClick={() => void window.desktop.select('home')}
      >
        <ArtifactsIcon size={16} />
        {t('nav.library')}
      </button>
      <div className="sidebar-lists">
        {pinned.length > 0 && (
          <section className="nav-section" data-testid="pinned" aria-label={t('nav.pinned')}>
            <button type="button" className="section-head" aria-expanded={pinnedOpen} onClick={() => setPinnedOpen(!pinnedOpen)}>
              {t('nav.pinned')}
              <ChevronIcon open={pinnedOpen} />
            </button>
            {pinnedOpen && (
              <ul>
                {pinned.map((a) => (
                  <ArtifactRow key={a.id} artifact={a} current={state.current === a.id} t={t} onMenu={setMenu} />
                ))}
              </ul>
            )}
          </section>
        )}
        {recent.length > 0 && (
          <section className="nav-section" data-testid="recent" aria-label={t('nav.recent')}>
            <span className="section-head">{t('nav.recent')}</span>
            <ul>
              {recent.map((a) => (
                <ArtifactRow key={a.id} artifact={a} current={state.current === a.id} t={t} onMenu={setMenu} />
              ))}
            </ul>
          </section>
        )}
      </div>
      <div className="sidebar-bottom">
        <button type="button" className="nav-row" data-testid="nav-settings" onClick={onSettings}>
          <SettingsIcon />
          {t('nav.settings')}
        </button>
      </div>
      {menu && <RowMenu t={t} menu={menu} onClose={closeMenu} artifactDo={artifactDo} onInstallApp={onInstallApp} />}
    </nav>
  );
}
