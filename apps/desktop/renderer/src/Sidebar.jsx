// The sidebar: the window's controls (room for the macOS window buttons, collapse, back, forward), New, Search, the
// library, the pinned artifacts and the ones changed last. Its lists are the home page's store: they follow every
// change the page sees (made, renamed, pinned, deleted), at once.
import { useMemo, useState } from 'react';
import { ArtifactsIcon, TypeIcon, typeStyle, usePage } from '@open-artifact/library-page';
import { BackIcon, ChevronIcon, ForwardIcon, PlusIcon, SearchIcon, SidebarIcon } from './icons.jsx';

/** How many of the artifacts changed last the sidebar lists. */
export const RECENT_MAX = 8;

const latest = (key) => (a, b) => (b[key] || '').localeCompare(a[key] || '');

/** The window's controls: collapse or expand the sidebar, back, forward. Also at the tab bar's start when collapsed. */
export function WindowControls({ t, state, platform }) {
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
      <button type="button" className="icon-button" data-testid="back" aria-label={t('nav.back')} title={t('nav.back')} disabled={!state.canBack} onClick={() => void desktop.back()}>
        <BackIcon />
      </button>
      <button type="button" className="icon-button" data-testid="forward" aria-label={t('nav.forward')} title={t('nav.forward')} disabled={!state.canForward} onClick={() => void desktop.forward()}>
        <ForwardIcon />
      </button>
    </div>
  );
}

function ArtifactRow({ artifact, current, t }) {
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
      >
        <span className="type-glyph">
          <TypeIcon type={artifact.type} size={16} />
        </span>
        <span className="row-title">{title}</span>
      </button>
    </li>
  );
}

export function Sidebar({ t, state, platform, onNew, onSearch }) {
  const artifacts = usePage((s) => s.artifacts);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const pinned = useMemo(() => artifacts.filter((a) => a.pinned).sort(latest('openedAt')), [artifacts]);
  const recent = useMemo(() => artifacts.filter((a) => !a.pinned).sort(latest('updatedAt')).slice(0, RECENT_MAX), [artifacts]);
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
      <button type="button" className="nav-row" data-testid="nav-library" aria-current={onHome ? 'page' : undefined} onClick={() => void window.desktop.select('home')}>
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
                  <ArtifactRow key={a.id} artifact={a} current={state.current === a.id} t={t} />
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
                <ArtifactRow key={a.id} artifact={a} current={state.current === a.id} t={t} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </nav>
  );
}
