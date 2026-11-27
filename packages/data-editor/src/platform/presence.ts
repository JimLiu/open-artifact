/**
 * The view context: what the viewer has on screen, published as this
 * viewer's room presence (`room.presence({viewContext})`) for the agent to
 * read before their next message. Reports are sanitized, sized (the full
 * context with the edit count, else the lean one) and deduplicated; a
 * change of labels only waits {@link PRESENCE_DEBOUNCE_MS}.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RoomCapability } from '@open-artifact/runtime';
import {
  PRESENCE_DEBOUNCE_MS,
  buildDashboardPresenceContext,
  choosePresenceContext,
  collectPagePresenceHooks,
  decodeLocationFragment,
  sanitizePresenceContext,
  type DashboardFile,
  type Dataset,
  type PresenceContextPair,
  type PresenceRunReport,
  type PresenceSelectionPoint,
} from '@open-artifact/data-core';
import { maybeSession } from '../services/session.ts';
import { useDocument } from '../state/document.ts';
import { getEditCount, subscribeEditCount } from './edit-count.ts';

export interface PresenceReporter {
  /** Reports the context now on screen (a raw context: it is sanitized here). */
  report(context: Record<string, unknown>): void;
  /** Stops publishing and clears what was published. */
  dispose(): void;
}

export interface PresenceReporterOptions {
  editCount?: { get(): number; subscribe(listener: () => void): () => void };
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/** A reporter publishing through `room` (one that does nothing without a room). */
export function createPresenceReporter(room: Pick<RoomCapability, 'presence'> | null, options: PresenceReporterOptions = {}): PresenceReporter {
  const edits = options.editCount ?? { get: getEditCount, subscribe: (listener: () => void) => subscribeEditCount(() => listener()) };
  const later = options.setTimeout ?? ((callback, ms) => globalThis.setTimeout(callback, ms));
  const cancel = options.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>));
  let disabled = room === null;
  let disposed = false;
  let pending: PresenceContextPair | null = null;
  let fullJson = '';
  let leanJson = '';
  let publishedJson = '';
  let publishing = false;
  let sizeWarned = false;
  let retryPending = false;
  let timer: unknown;
  const unsubscribeEdits = disabled ? () => undefined : edits.subscribe(() => void publish());

  const withEdits = (pair: PresenceContextPair): string => {
    const count = edits.get();
    return JSON.stringify(count > 0 ? { ...pair.full, edits: count } : pair.full);
  };

  function schedule(): void {
    if (timer !== undefined) cancel(timer);
    timer = later(() => void publish(), PRESENCE_DEBOUNCE_MS);
  }

  async function publish(): Promise<void> {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    if (disabled || publishing || pending === null || room === null) return;
    publishing = true;
    const { view, json } = choosePresenceContext(pending, edits.get());
    if (view === null && !sizeWarned) {
      sizeWarned = true;
      console.warn('data presence: the view context is over 3 KiB; cleared, not published');
    }
    const sentFull = withEdits(pending);
    const sentLean = leanJson;
    const sentEdits = edits.get();
    try {
      if (json === publishedJson) return;
      await room.presence({ viewContext: view });
      publishedJson = json;
      retryPending = false;
    } catch {
      retryPending = true;
    } finally {
      publishing = false;
      if (!disposed && pending !== null && withEdits(pending) !== sentFull) {
        if (leanJson === sentLean && edits.get() === sentEdits) {
          if (timer === undefined) schedule();
        } else void publish();
      }
    }
  }

  return {
    report(context) {
      if (disabled) return;
      const pair = sanitizePresenceContext(context);
      const nextFull = JSON.stringify(pair.full);
      if (nextFull === fullJson) {
        if (retryPending && timer === undefined) void publish();
        return;
      }
      const nextLean = JSON.stringify(pair.lean);
      const labelsOnly = !retryPending && pending !== null && nextLean === leanJson;
      pending = pair;
      fullJson = nextFull;
      leanJson = nextLean;
      if (labelsOnly) schedule();
      else void publish();
    },
    dispose() {
      if (timer !== undefined) cancel(timer);
      timer = undefined;
      unsubscribeEdits();
      if (!disabled && room !== null && (publishedJson !== '' || publishing)) room.presence({ viewContext: null }).catch(() => undefined);
      pending = null;
      disabled = disposed = true;
    },
  };
}

export interface DashboardPresenceInput {
  /** The dashboard is still loading (nothing is reported yet). */
  loading: boolean;
  /** Each dataset's last run (`data/users/<uid>/runs`), read at each report. */
  report: () => PresenceRunReport | null;
  files: readonly DashboardFile[];
  sources: ReadonlyMap<string, Dataset>;
  /** Data mode (the sources) is shown, not the page. */
  data: boolean;
  /** The edit mode holds unsaved hand edits. */
  dirty: boolean;
  /** The source open in the sources panel. */
  shown: string | null;
  filters: string[];
  /** The format told to the agent (`null`: not told). */
  form: string | null;
  /** The shown draft's id (`null`: the stored dashboard). */
  draft: string | null;
  /** What the page shows when it isn't the dashboard itself (`drafts/<id>`, `history/<n>`). */
  showing?: string | null;
  /** The draft the viewer's changes go to (`drafts/<id>`; `null`: the dashboard itself). */
  writeTo?: string | null;
}

/**
 * Reports the dashboard's view context while the page has a room. Returns
 * `onLink` (the page's location fragment changed) and `onPoint` (what the
 * viewer points at; left out without a room).
 */
export function useDashboardPresence(input: DashboardPresenceInput): {
  onLink: (fragment: string) => void;
  onPoint: ((point: PresenceSelectionPoint | null) => void) | undefined;
} {
  const room = maybeSession()?.room ?? null;
  const hasRoom = room !== null;
  const [place, setPlace] = useState(() => (typeof location === 'undefined' ? '' : decodeLocationFragment(location.hash)));
  const [pointed, setPointed] = useState<PresenceSelectionPoint | null>(null);
  const onPoint = useCallback(
    (point: PresenceSelectionPoint | null) => setPointed((previous) => (JSON.stringify(previous) === JSON.stringify(point) ? previous : point)),
    [],
  );
  const reporter = useRef<PresenceReporter | null>(null);
  useEffect(() => {
    if (room === null) return;
    const created = createPresenceReporter(room);
    reporter.current = created;
    return () => {
      created.dispose();
      reporter.current = null;
      setPointed(null);
    };
  }, [room]);

  const hooks = useMemo(() => collectPagePresenceHooks(input.files), [input.files]);
  const blurReports = useRef(false);
  const { loading, report, sources, data, dirty, shown, filters, form, draft, showing = null, writeTo = null } = input;
  useEffect(() => {
    if (!hasRoom || loading) return;
    const send = (): void =>
      reporter.current?.report(
        buildDashboardPresenceContext(report(), hooks, sources, { data, dirty, place, pointed, shown, filters, form, draft, showing, writeTo }),
      );
    send();
    // While the agent is told a format, a draft or an earlier version, the context stays when the window loses focus.
    blurReports.current ||= form !== null || draft !== null || showing !== null || writeTo !== null;
    if (blurReports.current) window.addEventListener('blur', send);
    const unsubscribe = useDocument.subscribe(send);
    return () => {
      window.removeEventListener('blur', send);
      unsubscribe();
    };
  }, [hasRoom, loading, report, hooks, sources, data, dirty, place, pointed, shown, filters, form, draft, showing, writeTo]);

  return { onLink: setPlace, onPoint: hasRoom ? onPoint : undefined };
}
