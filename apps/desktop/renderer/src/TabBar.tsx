import type { TabSnapshot } from '../../src/tabs.ts';
import type { InstallApp, WindowProps, WordsProps } from './types.ts';
// The tab bar: the library first (never closed or moved), one tab per open artifact (its type's icon in its color, its
// title, a dot while something is not saved, what its connection is doing, a close button), then "+". Tabs are dragged
// to change their order; the ones that do not fit go into the list behind ▾. A tab's right-click menu has Install as
// App… and the Close items. Its empty part moves the window.
//
// "+" opens a menu: New, one line per installed type (picking one makes it at once, with no name, and opens it), then
// the artifacts made for the same project as the tab in front that are not open (or, with none, the ones opened last).
//
// The row is the UI kit's TabStrip (styled by ui.css). Its menus drop below the bar, where the view of the tab in front is drawn: `onPopupChange` tells the window's page,
// which hides the view while one is open.
import { ArtifactsIcon, TypeIcon, typeStyle, usePage, type PageArtifact } from '@open-artifact/library-page';
import { TabStrip, type TabStripMenuItem, type TabStripTab, type TabStripWords } from '@open-artifact/ui/tab-strip';
import { useMemo } from 'react';
import { WindowControls } from './Sidebar.tsx';
import { typeName } from './words.ts';

const STATUS_WORD: Partial<Record<TabSnapshot['status'], string>> = {
  opening: 'tabs.opening',
  reconnecting: 'tabs.reconnecting',
  stopped: 'tabs.stopped',
  stale: 'tabs.stale',
  crashed: 'tabs.crashed',
  missing: 'tabs.missing',
};

/** The order of the types under New; a type not named here comes after them, in the order the library gives. */
const NEW_ORDER = ['docs', 'slides', 'design', 'sheets', 'data', 'whiteboard', 'motion'];
/** How many artifacts the + menu lists. */
const RELATED_MAX = 6;

const typeIcon = (type: string) => (
  <span className="tab-type" style={typeStyle(type)}>
    <TypeIcon type={type} size={14} />
  </span>
);

const openedAt = (a: PageArtifact) => Date.parse(a.openedAt) || 0;

/** What a tab shows after its title: what its connection is doing, or Reload for a tab kept as it was. */
function TabState({ tab, t }: WordsProps & { tab: TabSnapshot }) {
  // While a close (or the app's quit) waits for the save: that word, before what the connection does.
  const status = tab.closing ? 'tabs.closing' : STATUS_WORD[tab.status];
  if (!status) return null;
  if (tab.status === 'stale' && !tab.closing)
    return (
      <button
        type="button"
        className="tab-state tab-reload"
        title={t('tabs.staleHint')}
        onClick={(event) => {
          event.stopPropagation();
          void window.desktop.reload(tab.id);
        }}
      >
        {t(status)}
      </button>
    );
  return (
    <span className="tab-state" data-testid={tab.closing ? 'tab-closing' : undefined}>
      {t(status)}
    </span>
  );
}

export function TabBar({
  t,
  state,
  platform,
  onCreate,
  onInstallApp,
  onPopupChange,
}: WindowProps & { onCreate(type: string): void; onInstallApp: InstallApp; onPopupChange(open: boolean): void }) {
  const artifacts = usePage((s) => s.artifacts);
  const types = usePage((s) => s.types);
  const collapsed = !!state.sidebarCollapsed;
  const words = useMemo<TabStripWords>(
    () => ({
      label: t('tabs.label'),
      newTab: t('tabs.new'),
      moreTabs: t('tabs.more'),
      close: (title) => t('tabs.close', { title }),
      menu: (title) => t('row.menu', { title }),
      closeTab: t('tabs.closeThis'),
      closeOthers: t('tabs.closeOthers'),
      closeRight: t('tabs.closeRight'),
      closeAll: t('tabs.closeAll'),
    }),
    [t],
  );

  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const tabs: TabStripTab[] = [
    { id: 'home', title: t('nav.library'), icon: <ArtifactsIcon size={15} />, fixed: true, attrs: { 'data-tab': 'home' } },
    ...state.tabs.map((tab): TabStripTab => {
      const artifact = byId.get(tab.id);
      // The page's store has the newest title (a rename shows at once); the main process's is the fallback.
      const title = artifact?.title || tab.title || t('nav.untitled');
      const type = artifact?.type || tab.type;
      return {
        id: tab.id,
        title,
        icon: typeIcon(type),
        detail: type ? typeName(t, type, undefined) : undefined,
        marked: !!tab.unsaved,
        markLabel: t('tabs.unsaved'),
        extra: <TabState tab={tab} t={t} />,
        attrs: {
          'data-tab': tab.id,
          'data-unsaved': String(!!tab.unsaved),
          'data-status': tab.status || undefined,
          'data-closing': tab.closing ? 'true' : undefined,
        },
      };
    }),
  ];

  // ---- what + offers ----
  const rank = (id: string) => (NEW_ORDER.includes(id) ? NEW_ORDER.indexOf(id) : NEW_ORDER.length);
  const newTypes = types.map((tile, i) => ({ tile, i })).sort((a, b) => rank(a.tile.id) - rank(b.tile.id) || a.i - b.i);
  const open = new Set(state.tabs.map((tab) => tab.id));
  const closed = artifacts.filter((a) => !open.has(a.id) && a.openable).sort((a, b) => openedAt(b) - openedAt(a));
  const project = byId.get(state.current)?.project;
  const sameProject = project ? closed.filter((a) => a.project === project) : [];
  const relatedHeading = sameProject.length ? t('tabs.related') : t('tabs.recent');
  const related = sameProject.length ? sameProject : closed;
  const newMenu: TabStripMenuItem[] = [
    ...(newTypes.length ? [{ heading: t('tabs.newHeading') }] : []),
    ...newTypes.map(
      ({ tile }): TabStripMenuItem => ({
        key: `new:${tile.id}`,
        label: typeName(t, tile.id, tile.title),
        icon: typeIcon(tile.id),
        attrs: { 'data-type': tile.id },
        onSelect: () => onCreate(tile.id),
      }),
    ),
    ...(newTypes.length && related.length ? ['separator' as const] : []),
    ...(related.length ? [{ heading: relatedHeading }] : []),
    ...related.slice(0, RELATED_MAX).map(
      (a): TabStripMenuItem => ({
        key: `open:${a.id}`,
        label: a.title || t('nav.untitled'),
        detail: typeName(t, a.type, a.typeTitle),
        icon: typeIcon(a.type),
        attrs: { 'data-artifact': a.id },
        onSelect: () => void window.desktop.open(a.id),
      }),
    ),
  ];

  return (
    <header id="bar" className="tab-bar drag" data-collapsed={String(collapsed)}>
      {collapsed && <WindowControls t={t} state={state} platform={platform} />}
      <TabStrip
        tabs={tabs}
        activeId={state.current}
        words={words}
        onSelect={(id) => void window.desktop.select(id)}
        onClose={(ids) => {
          // One after another: a tab with unsaved work asks first, and the next waits for the answer.
          void (async () => {
            for (const id of ids) await window.desktop.close(id);
          })();
        }}
        // The main process counts only the artifact tabs: the library is first.
        onReorder={(id, index) => void window.desktop.move(id, index - 1)}
        newMenu={newMenu}
        newTestId="tab-new"
        menuItems={(tab) => [{ key: 'install-app', label: t('menu.installApp'), testId: 'tab-install-app', onSelect: () => onInstallApp(tab.id, tab.title) }]}
        onPopupChange={onPopupChange}
      />
      <span id="connection" role="status" aria-live="polite" data-connected={String(!!state.connected)}>
        {state.connected
          ? ''
          : state.service === 'elsewhere'
            ? t('service.elsewhere')
            : state.service === 'stopped'
              ? t('connection.stopped')
              : t('connection.lost')}
      </span>
    </header>
  );
}
