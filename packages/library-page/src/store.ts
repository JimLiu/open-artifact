/**
 * The page's state: the library list, what the person filters by, what is selected (an open menu or dialog), the
 * notice at the foot of the page, and the live updates that keep the list current. One store per mounted plugin
 * (`createPageStore`), handed to the components through {@link StoreProvider}.
 *
 * Everything that needs the app (opening a session, starting one, the clipboard, taking a thumbnail) comes in as
 * {@link PageHost}, so the store runs, and is tested, without a host.
 */
import { createContext, createElement, useContext, type ReactNode } from 'react';
import { useStore as useZustand } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { PageApi, PendingWindow } from './api.ts';
import { NO_FILTERS, type Filters } from './filters.ts';
import type { Translate } from './i18n.ts';
import type { OpenAnswer, PageArtifact, TypeTile } from './library/routes.ts';

/** Where the list stands. */
export type LoadStatus = 'loading' | 'ready' | 'error';
/** Cards or rows. */
export type Layout = 'grid' | 'list';

/** A notice at the foot of the page: a link copied, a delete with its undo, or what went wrong. */
export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
  /** The trash entry Undo puts back. */
  undo?: string;
}

/** The dialog open over the page, for one artifact. */
export interface DialogState {
  kind: 'rename' | 'delete';
  id: string;
}

/** What the store holds. */
export interface PageState {
  status: LoadStatus;
  artifacts: PageArtifact[];
  /** The types a new session can make one of. */
  types: TypeTile[];
  error: string;
  /** The artifact being opened. */
  opening: string | null;
  toast: Toast | null;
  filters: Filters;
  query: string;
  layout: Layout;
  /** The artifact whose actions menu is open. */
  menuFor: string | null;
  dialog: DialogState | null;
  /** The library's events are coming in. */
  live: boolean;
  /** Counts the host's asks to put the keyboard in the search box ({@link PageActions.focusSearch}); 0 before any. */
  searchFocus: number;
}

/** What the store does. */
export interface PageActions {
  reload(): Promise<void>;
  setFilters(patch: Partial<Filters>): void;
  clearFilters(): void;
  setQuery(query: string): void;
  /** Shows the search box and puts the keyboard in it: for a host's own search entry (the page draws it at once). */
  focusSearch(): void;
  setLayout(layout: Layout): void;
  setMenuFor(id: string | null): void;
  openDialog(dialog: DialogState): void;
  closeDialog(): void;
  showToast(message: string, kind?: Toast['kind'], undo?: string): void;
  dismissToast(): void;
  /** Opens an artifact's page in its session's Browser; `panel` opens one of the Shell's panels on it (`share`). */
  open(artifact: PageArtifact, panel?: 'share'): Promise<void>;
  /** Opens an artifact at the Shell's share panel. */
  share(artifact: PageArtifact): Promise<void>;
  /** A new session: empty, or one to make an artifact of a type (the host's {@link PageHost.create}). */
  create(typeId?: string): void;
  pin(artifact: PageArtifact, pinned: boolean): Promise<void>;
  rename(artifact: PageArtifact, title: string): Promise<void>;
  copyLink(artifact: PageArtifact): Promise<void>;
  remove(artifact: PageArtifact): Promise<void>;
  undo(trash: string): Promise<void>;
  /** Follow the library's events; the returned function stops. */
  watchEvents(): () => void;
  /** Take the thumbnails the list lacks while the page is on screen; the returned function stops. */
  watchThumbnails(): () => void;
}

/** The store's whole shape. */
export type PageStore = PageState & PageActions;

/** What the store needs from the app. */
export interface PageHost {
  /** The app can start a session from here. */
  canCreate(): boolean;
  /** Starts a session: empty, or one to make an artifact of `type`. */
  create(type?: { id: string; title: string }): void;
  /** The app is open on another device. */
  away(): boolean;
  /** A window opened now, for an address that comes later. */
  pendingWindow(): PendingWindow | null;
  /** Shows an opened artifact: in its session's Browser, else a window. `sessionGone` when its session cannot be shown. */
  show(answer: OpenAnswer, pending: PendingWindow | null): Promise<{ sessionGone: boolean }>;
  copy(text: string): Promise<void>;
  /** Takes a thumbnail of a page; undefined where the app cannot (no desktop Browser). */
  capture?: (url: string, type: string, signal: AbortSignal) => Promise<Uint8Array>;
  /** The page is on screen (a hidden window draws nothing to take a picture of). */
  visible(): boolean;
  /** Where the layout choice is kept between visits. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

/** What {@link createPageStore} takes. */
export interface PageStoreOptions {
  api: PageApi;
  host: PageHost;
  t: Translate;
  /** How long the list waits after a library event before it reloads, ms. */
  eventDelayMs?: number;
}

const LAYOUT_KEY = 'open-artifact.view';

/** A URL with one search parameter set; the URL as it is when it does not parse. */
function withParam(url: string, name: string, value: string): string {
  try {
    const at = new URL(url);
    at.searchParams.set(name, value);
    return at.href;
  } catch {
    return url;
  }
}

function readLayout(storage: PageHost['storage']): Layout {
  try {
    return storage?.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/** The page's store. */
export function createPageStore({ api, host, t, eventDelayMs = 300 }: PageStoreOptions): StoreApi<PageStore> {
  let toastId = 0;
  let loading: Promise<void> | null = null;
  /** Thumbnails tried in this run of the app, whether they worked or not: a page that gives no picture is not tried again and again. */
  const tried = new Set<string>();
  let watching: AbortController | null = null;
  let taking = false;

  return createStore<PageStore>()((set, get) => {
    const patch = (id: string, change: Partial<PageArtifact>) =>
      set({ artifacts: get().artifacts.map((a) => (a.id === id ? { ...a, ...change } : a)) });
    const failed = (error: unknown) => get().showToast(t('action.failed', { message: (error as Error).message }), 'error');
    /** Whether the artifact's type is installed; says so when it is not. */
    const openable = (a: PageArtifact) => {
      if (a.openable) return true;
      get().showToast(t('open.typeMissing', { type: a.typeTitle || a.type }), 'error');
      return false;
    };

    const pump = () => {
      const capture = host.capture;
      if (taking || watching === null || capture === undefined) return;
      const signal = watching.signal;
      taking = true;
      void (async () => {
        try {
          for (;;) {
            if (signal.aborted || !host.visible()) return;
            const next = get().artifacts.find((a) => a.thumbnail !== a.updatedAt && a.openable && !tried.has(`${a.id}\u0000${a.updatedAt}`));
            if (next === undefined) return;
            tried.add(`${next.id}\u0000${next.updatedAt}`);
            try {
              const url = await api.preview(next.id);
              if (typeof url !== 'string') throw new Error('no address');
              const jpeg = await capture(url, next.type, signal);
              const saved = await api.saveThumbnail(next.id, next.updatedAt, jpeg);
              patch(next.id, { thumbnail: saved ?? next.updatedAt });
            } catch (error) {
              if (!signal.aborted) console.warn(`Open Artifact page: no thumbnail for ${next.root}:`, error);
            }
          }
        } finally {
          taking = false;
        }
      })();
    };

    return {
      status: 'loading',
      artifacts: [],
      types: [],
      error: '',
      opening: null,
      toast: null,
      filters: NO_FILTERS,
      query: '',
      layout: readLayout(host.storage),
      menuFor: null,
      dialog: null,
      live: false,
      searchFocus: 0,

      reload() {
        if (loading) return loading;
        if (get().artifacts.length === 0) set({ status: 'loading' });
        loading = (async () => {
          try {
            const { artifacts, types } = await api.list();
            set({ status: 'ready', artifacts, types, error: '' });
            pump();
          } catch (error) {
            set({ status: 'error', error: (error as Error).message });
          }
        })().finally(() => {
          loading = null;
        });
        return loading;
      },

      setFilters: (change) => set({ filters: { ...get().filters, ...change } }),
      clearFilters: () => set({ filters: { ...NO_FILTERS, sort: get().filters.sort } }),
      setQuery: (query) => set({ query }),
      focusSearch: () => set({ searchFocus: get().searchFocus + 1 }),
      setLayout(layout) {
        set({ layout });
        try {
          host.storage?.setItem(LAYOUT_KEY, layout);
        } catch {
          // Storage refused: the choice lasts this visit.
        }
      },
      setMenuFor: (menuFor) => set({ menuFor }),
      openDialog: (dialog) => set({ dialog, menuFor: null }),
      closeDialog: () => set({ dialog: null }),
      showToast: (message, kind = 'info', undo) => set({ toast: { id: ++toastId, message, kind, ...(undo ? { undo } : {}) } }),
      dismissToast: () => set({ toast: null }),

      async open(artifact, panel) {
        if (get().opening !== null || !openable(artifact)) return;
        // On another device the page opens in a window of its own: opened now, while the click counts, as starting
        // the page can take longer than a browser lets a page wait to open one.
        const away = host.away();
        const pending = away ? host.pendingWindow() : null;
        if (away && pending === null) return get().showToast(t('open.blocked'), 'error');
        set({ opening: artifact.id, toast: null });
        try {
          const opened = await api.open(artifact.id);
          const answer = panel ? { ...opened, url: withParam(opened.url, 'panel', panel) } : opened;
          const { sessionGone } = await host.show({ ...answer, sessionId: answer.sessionId || artifact.sessionId }, pending);
          set({ opening: null });
          // One of another harness (or of none) has no session of the host's to go back to: only a session gone is news.
          if (sessionGone && (answer.sessionId || artifact.sessionId)) get().showToast(t('open.noSession'));
          void get().reload();
        } catch (error) {
          pending?.close();
          set({ opening: null });
          get().showToast(t('open.failed', { message: (error as Error).message }), 'error');
        }
      },

      share: (artifact) => get().open(artifact, 'share'),

      create(typeId) {
        if (!host.canCreate()) return;
        if (typeId === undefined) return host.create();
        host.create({ id: typeId, title: get().types.find((type) => type.id === typeId)?.title || typeId });
      },

      async pin(artifact, pinned) {
        if (!openable(artifact)) return;
        patch(artifact.id, { pinned });
        try {
          await api.update(artifact.id, { pinned });
        } catch (error) {
          patch(artifact.id, { pinned: artifact.pinned });
          failed(error);
        }
      },

      async rename(artifact, title) {
        const next = title.trim();
        if (!next || next === artifact.title || !openable(artifact)) return;
        patch(artifact.id, { title: next });
        try {
          const saved = await api.update(artifact.id, { title: next });
          if (saved && typeof saved.id === 'string' && saved.id) patch(artifact.id, saved);
        } catch (error) {
          patch(artifact.id, { title: artifact.title });
          failed(error);
        }
      },

      async copyLink(artifact) {
        if (!openable(artifact)) return;
        // From another device there is no link to copy: the Shell's address is this computer's loopback.
        if (host.away()) return get().showToast(t('toast.copyRemote'));
        try {
          await host.copy(artifact.viewUrl);
          get().showToast(t('toast.copied'));
        } catch (error) {
          failed(error);
        }
      },

      async remove(artifact) {
        try {
          const { trash, path } = await api.remove(artifact.id);
          set({ artifacts: get().artifacts.filter((a) => a.id !== artifact.id), dialog: null });
          get().showToast(t(path ? 'toast.removed' : 'toast.deleted', { title: artifact.title }), 'info', trash);
        } catch (error) {
          failed(error);
        }
      },

      async undo(trash) {
        set({ toast: null });
        try {
          await api.restore(trash);
          await get().reload();
        } catch (error) {
          failed(error);
        }
      },

      watchEvents() {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const stop = api.events(
          () => {
            if (!get().live) set({ live: true });
            clearTimeout(timer);
            timer = setTimeout(() => void get().reload(), eventDelayMs);
          },
          () => set({ live: false }),
        );
        return () => {
          clearTimeout(timer);
          stop?.();
          set({ live: false });
        };
      },

      watchThumbnails() {
        const controller = new AbortController();
        watching = controller;
        pump();
        return () => {
          controller.abort(new Error('the page closed'));
          if (watching === controller) watching = null;
        };
      },
    };
  });
}

const StoreContext = createContext<StoreApi<PageStore> | null>(null);

/** Hands a page store to the components below. */
export function StoreProvider({ store, children }: { store: StoreApi<PageStore>; children: ReactNode }) {
  return createElement(StoreContext.Provider, { value: store }, children);
}

/** A slice of the page store. */
export function usePage<T>(select: (state: PageStore) => T): T {
  const store = useContext(StoreContext);
  if (store === null) throw new Error('usePage needs a StoreProvider');
  return useZustand(store, select);
}
