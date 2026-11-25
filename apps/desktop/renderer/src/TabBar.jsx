// The tab bar: the library first (never closed), one tab per open artifact (its type's color, its title, a mark while
// something is not saved, what its connection is doing, a close button), then "+". It scrolls sideways and never
// wraps; its empty part moves the window.
import { useEffect, useRef } from 'react';
import { ArtifactsIcon, typeStyle, usePage } from '@open-artifact/library-page';
import { CloseIcon, PlusIcon } from './icons.jsx';
import { WindowControls } from './Sidebar.jsx';

const STATUS_WORD = { opening: 'tabs.opening', reconnecting: 'tabs.reconnecting', stopped: 'tabs.stopped', stale: 'tabs.stale', crashed: 'tabs.crashed', missing: 'tabs.missing' };

function ArtifactTab({ tab, selected, title, type, t }) {
  const desktop = window.desktop;
  // While a close (or the app's quit) waits for the save: that word, before what the connection does.
  const status = tab.closing ? 'tabs.closing' : STATUS_WORD[tab.status];
  return (
    <div
      className="tab"
      role="tab"
      tabIndex={0}
      aria-selected={selected}
      data-tab={tab.id}
      data-unsaved={String(!!tab.unsaved)}
      data-status={tab.status || undefined}
      data-closing={tab.closing ? 'true' : undefined}
      title={title}
      onClick={() => void desktop.select(tab.id)}
      onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && void desktop.select(tab.id)}
      onAuxClick={(event) => event.button === 1 && void desktop.close(tab.id)}
    >
      <span className="tab-swatch" aria-hidden="true" style={typeStyle(type)} />
      <span className="tab-title">{title}</span>
      {tab.unsaved && <span className="tab-dot" data-testid="unsaved" title={t('tabs.unsaved')} aria-label={t('tabs.unsaved')} />}
      {status &&
        (tab.status === 'stale' && !tab.closing ? (
          <button
            type="button"
            className="tab-state tab-reload"
            title={t('tabs.staleHint')}
            onClick={(event) => {
              event.stopPropagation();
              void desktop.reload(tab.id);
            }}
          >
            {t(status)}
          </button>
        ) : (
          <span className="tab-state" data-testid={tab.closing ? 'tab-closing' : undefined}>
            {t(status)}
          </span>
        ))}
      <button
        type="button"
        className="tab-close"
        aria-label={t('tabs.close', { title })}
        title={t('tabs.close', { title })}
        onClick={(event) => {
          event.stopPropagation();
          void desktop.close(tab.id);
        }}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

export function TabBar({ t, state, platform, onNew }) {
  const artifacts = usePage((s) => s.artifacts);
  const strip = useRef(null);
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const collapsed = !!state.sidebarCollapsed;

  // The current tab stays in sight.
  useEffect(() => {
    strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [state.current, state.tabs.length]);

  return (
    <header id="bar" className="tab-bar drag" data-collapsed={String(collapsed)}>
      {collapsed && <WindowControls t={t} state={state} platform={platform} />}
      <div className="tab-strip" role="tablist" aria-label={t('tabs.label')} ref={strip}>
        <div
          className="tab tab-home"
          role="tab"
          tabIndex={0}
          aria-selected={state.current === 'home'}
          data-tab="home"
          onClick={() => void window.desktop.select('home')}
          onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && void window.desktop.select('home')}
        >
          <ArtifactsIcon size={15} />
          <span className="tab-title">{t('nav.library')}</span>
        </div>
        {state.tabs.map((tab) => {
          const artifact = byId.get(tab.id);
          // The page's store has the newest title (a rename shows at once); the main process's is the fallback.
          const title = artifact?.title || tab.title || t('nav.untitled');
          return <ArtifactTab key={tab.id} tab={tab} selected={state.current === tab.id} title={title} type={artifact?.type || tab.type} t={t} />;
        })}
        <button type="button" className="icon-button tab-new" data-testid="tab-new" aria-label={t('tabs.new')} title={t('tabs.new')} onClick={onNew}>
          <PlusIcon size={14} />
        </button>
      </div>
      <span id="connection" role="status" aria-live="polite" data-connected={String(!!state.connected)}>
        {state.connected ? '' : state.service === 'elsewhere' ? t('service.elsewhere') : state.service === 'stopped' ? t('connection.stopped') : t('connection.lost')}
      </span>
    </header>
  );
}
