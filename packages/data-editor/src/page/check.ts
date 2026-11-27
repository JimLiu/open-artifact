import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardFile, Parameters, UnknownRecord } from '@open-artifact/data-core';
import {
  DASHBOARD_ENTRY_FILENAME,
  USER_CHECK_DOCUMENT,
  USER_PAGE_DOCUMENT,
  USER_RUNS_DOCUMENT,
  areDashboardFilesEqual,
} from '@open-artifact/data-core';
import { useAgentActivity, type AgentActivity } from '../platform/agent-activity.ts';
import { getCurrentViewer } from '../platform/viewer.ts';
import { LiveWriteError, liveDocument, writeOwnDocument } from '../sync/index.ts';
import type { PageFault } from './faults.ts';
import { isActionableRunReport, isCleanRunReport, type DashboardRunReport } from './runs.ts';
import { fitShownPageRecord, type ShownPage } from './shown-page.ts';
import type { DrawingFault, OutputFault } from './validation.ts';

export type StoreWriteOutcome = 'ok' | 'retry' | 'off';

/** What the per-user document writer stores through (the live document by default; tests pass their own). */
export interface UserDocumentStore {
  write(name: string, document: UnknownRecord): Promise<StoreWriteOutcome>;
  remove(name: string): Promise<StoreWriteOutcome>;
  viewer(): Promise<string | null>;
  wait(ms: number): Promise<void>;
}

/** Writes (or, given null, removes) one `data/users/<viewer>/<name>` document. */
export type UserDocumentWriter = (document: object | null) => Promise<StoreWriteOutcome>;

const USER_DOCUMENT_WRITE_TRIES = 3;
const RETRIED_WRITE_CODES: ReadonlySet<string> = new Set(['unavailable', 'resource_exhausted', 'conflict']);

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function writeOwn(name: string, document: UnknownRecord | null): Promise<StoreWriteOutcome> {
  if (liveDocument() === null) return 'off';
  try {
    await writeOwnDocument(name, document);
    return 'ok';
  } catch (error) {
    if (!(error instanceof LiveWriteError)) return 'retry';
    if (document === null && error.code === 'not_found') return 'ok';
    return RETRIED_WRITE_CODES.has(error.code) ? 'retry' : 'off';
  }
}

export const LIVE_USER_DOCUMENT_STORE: UserDocumentStore = {
  write: (name, document) => writeOwn(name, document),
  remove: (name) => writeOwn(name, null),
  viewer: () => Promise.resolve(getCurrentViewer()?.id ?? null),
  wait,
};

/**
 * The viewer's own document `name`, written in turn: a newer write cancels the retries of older ones, and removing a
 * document this writer removed last does nothing.
 */
export function createUserDocumentWriter(
  name: string,
  retryMs = 1000,
  store: UserDocumentStore = LIVE_USER_DOCUMENT_STORE,
): UserDocumentWriter {
  let queue: Promise<unknown> = Promise.resolve();
  let turn = 0;
  let wrote: boolean | null = null;
  async function run(document: object | null, mine: number): Promise<StoreWriteOutcome> {
    if ((await store.viewer()) === null) return 'off';
    for (let attempt = 0; attempt < USER_DOCUMENT_WRITE_TRIES; attempt++) {
      if (attempt > 0) await store.wait(retryMs);
      if (mine !== turn) break;
      if (document === null && wrote === false) return 'ok';
      if (document !== null) wrote = true;
      const outcome = document === null ? await store.remove(name) : await store.write(name, document as UnknownRecord);
      if (outcome === 'ok' && document === null) wrote = false;
      if (outcome !== 'retry') return outcome;
    }
    return 'retry';
  }
  return (document) => {
    const mine = ++turn;
    const next = queue.then(() => run(document, mine)).catch((): StoreWriteOutcome => 'retry');
    queue = next;
    return next;
  };
}

export interface RunReporter {
  /** `showing`: what the page shows when it isn't the dashboard itself (`drafts/<id>`, `history/<n>`). */
  report(report: DashboardRunReport, showing?: string | null): void;
  dispose(): void;
}

/**
 * Debounces the run reports; the latest goes to `data/users/<me>/runs` (a clean one removes it), with `showing` when
 * the page shows a draft or an earlier version.
 */
export function createRunReporter(
  debounceMs = 1000,
  write: UserDocumentWriter = createUserDocumentWriter(USER_RUNS_DOCUMENT, 5000),
): RunReporter {
  let pending = '';
  let sent = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    report(input, showing = null) {
      const clean = isCleanRunReport(input);
      const document = showing === null ? { ...input } : { ...input, showing };
      const key = clean ? 'delete' : JSON.stringify(document);
      if (key === pending || (!clean && !isActionableRunReport(input))) return;
      pending = key;
      clearTimeout(timer);
      if (key === sent) return;
      timer = setTimeout(() => {
        sent = key;
        void write(clean ? null : document).then((outcome) => {
          if (outcome === 'retry' && sent === key) sent = '';
          if (outcome === 'retry' && pending === key) pending = '';
        });
      }, debounceMs);
    },
    dispose() {
      clearTimeout(timer);
      pending = sent;
    },
  };
}

export const CHECK_FIRST_WAIT_MS = 1500;
export const MAX_CHECK_SOURCES = 300;
export const CHECK_POLL_MS = 250;
export const CHECK_SETTLED_HOLD_MS = 1500;
export const CHECK_WORK_WAIT_MS = 3000;

export const PAGE_NEEDS_FIX_TEXT = 'Something on this page stopped working.';
export const PAGE_FIXING_TEXT = 'The agent is fixing this page';
export const AGENT_WORKING_TEXT = 'The agent is working';
export const ASK_AGENT_LABEL = 'Ask the agent';
/** The named request that asks the agent to fix the page. */
export const FIX_PAGE_REQUEST = 'fixPage';

/** A layout or drawing fault the page found. */
export type PageCheckOutput = OutputFault | DrawingFault;
/** One line of a failed check's `page`: a fault the page's code hit, or an output finding. */
export type PageCheckEntry = PageFault | PageCheckOutput;
export type PageCheckRuleWhat = 'filter_without_rule' | 'rule_unreadable' | 'rule_not_portable';
export type PageCheckSource =
  | { kind: 'source'; what: PageCheckRuleWhat; dataset: string; filter: string }
  | { kind: 'source'; what: 'items_unread'; dataset: string };
export type PageCheckStatus = 'checking' | 'still_loading' | 'not_shown' | 'passed';

export interface PageCheckFindings {
  page?: PageCheckEntry[];
  sources?: PageCheckSource[];
}

/** `data/users/<me>/check`; `page` (and `sources`, when any) come with status "failed". */
export interface PageCheckDocument extends PageCheckFindings {
  v: 1;
  status: PageCheckStatus | 'failed';
  at: string;
  /** The check is of a draft (`drafts/<id>`), not the dashboard itself. */
  showing?: string;
}

export interface PageCheckUnruled {
  dataset: string;
  filter: string;
  what?: PageCheckRuleWhat;
}

export interface PageCheckProps {
  /** The page files shown now. */
  files: readonly DashboardFile[];
  /** The stored files (the same array as `files` unless an edit or a draft is shown). */
  stored?: readonly DashboardFile[];
  faults: readonly PageFault[];
  /** Checks run only while this is true (loaded, writable, the dashboard or a draft shown). */
  on: boolean;
  /** What the page shows when it isn't the dashboard itself (`drafts/<id>`); written on the check. */
  showing?: string | null;
  /** The page reported its first paint and no source it reads is still loading. */
  settled: boolean;
  /** Output findings, read once the faults are none; null when they can't be read yet. */
  output?: () => PageCheckOutput[] | null;
  /** Changes when a draft is shown or put away: the next files change is not a write. */
  flips?: unknown;
  /** The filters of live queries with no rule that pins them; a change re-runs the check. */
  unruled?: readonly PageCheckUnruled[];
  /** The ids of datasets whose last good run holds `items` the page has not read. */
  unread?: readonly string[];
}

export interface PageCheckState {
  marked: boolean;
  fixable: boolean;
  hadPage: boolean;
  judged?: readonly DashboardFile[];
}

export interface PageCheckDependencies {
  viewer(): Promise<string | null>;
  wait(ms: number): Promise<void>;
  hidden(): boolean;
  put(document: PageCheckDocument | null): Promise<StoreWriteOutcome>;
}

export interface PageCheckRun {
  now: () => PageCheckProps;
  stale: () => boolean;
  told?: (told: boolean) => void;
}

export interface PageCheckResult {
  /** A failed check was written and the agent is at work on it. */
  fixing: boolean;
  /** The agent is at work since a check began (until `graceMs` after it goes idle). */
  working: boolean;
}

export type PageCheckNotice = 'fixing' | 'fix' | null;

export const createPageCheckState = (): PageCheckState => ({ marked: false, fixable: false, hadPage: false });

/** Faults first, then the output findings (null: no faults and nothing to read yet). */
export function mergeCheckOutput(
  drawing: readonly PageCheckOutput[],
  output: readonly PageCheckOutput[] | null,
): PageCheckOutput[] | null {
  return output === null && drawing.length === 0 ? null : [...drawing, ...(output ?? [])];
}

const hasEntryFile = (files: readonly DashboardFile[]): boolean => files.some((file) => file.name === DASHBOARD_ENTRY_FILENAME);

/**
 * One check after a write: marks "checking" (unless still marked), waits for the page to settle as long as it takes
 * (saying why meanwhile), then writes what it found through `deps.put` (null removes the document).
 */
export async function runPageCheck({ now, stale, told }: PageCheckRun, state: PageCheckState, deps: PageCheckDependencies): Promise<void> {
  const mark = async (status: PageCheckStatus | 'failed' | null, extra: PageCheckFindings = {}): Promise<boolean> => {
    state.marked = status === 'checking';
    const showing = now().showing ?? null;
    const written =
      (await deps.put(status === null ? null : { v: 1, status, at: new Date().toISOString(), ...(showing === null ? {} : { showing }), ...extra })) === 'ok';
    if (!written) state.marked = false;
    return written;
  };
  try {
    if ((await deps.viewer()) === null || stale()) return;
    if (!state.marked) await mark('checking');
    await deps.wait(CHECK_FIRST_WAIT_MS);
    if (stale()) return;
    if (!hasEntryFile(now().files)) {
      told?.(false);
      await mark(null);
      return;
    }
    let waiting: PageCheckStatus | null = null;
    let settled = false;
    while (!stale() && !settled) {
      const why: PageCheckStatus | null = deps.hidden() ? 'not_shown' : now().settled ? null : 'still_loading';
      if (why !== null) {
        if (why !== waiting) await mark(why);
        waiting = why;
        await deps.wait(CHECK_POLL_MS);
        continue;
      }
      await deps.wait(CHECK_SETTLED_HOLD_MS);
      settled = now().settled && !deps.hidden();
    }
    if (stale()) return;
    const checked = now().files;
    const again = state.judged === checked;
    const faults = now().faults.filter((fault) => !state.hadPage || again || fault.kind === 'stopped');
    state.hadPage = true;
    state.judged = checked;
    const read = now().output;
    const output = faults.length > 0 || read === undefined ? [] : read();
    const found = output ?? [];
    const sources: PageCheckSource[] = [
      ...(now().unruled ?? []).map(
        (entry): PageCheckSource => ({
          kind: 'source',
          what: entry.what ?? 'filter_without_rule',
          dataset: entry.dataset,
          filter: entry.filter,
        }),
      ),
      ...(now().unread ?? []).map((dataset): PageCheckSource => ({ kind: 'source', what: 'items_unread', dataset })),
    ].slice(0, MAX_CHECK_SOURCES);
    const page: PageCheckEntry[] = [...faults, ...found];
    if (page.length === 0) {
      told?.(false);
      if (sources.length > 0) {
        await mark('failed', { page, sources });
        return;
      }
      if (state.fixable && output !== null) state.fixable = false;
      await mark(output === null ? null : 'passed');
      return;
    }
    state.fixable = found.length > 0 || faults.some((fault) => fault.kind === 'stopped');
    const written = await mark('failed', { page, ...(sources.length === 0 ? {} : { sources }) });
    if (!stale()) told?.(written && faults.length > 0);
  } catch {
    if (stale()) return;
    told?.(false);
    await mark(null);
  }
}

/** Runs `onWork` once the agent is at work within `ms`, else `onIdle`; the returned function cancels both. */
export function waitForAgentWork(onWork: () => void, onIdle: () => void, ms = CHECK_WORK_WAIT_MS): () => void {
  let done = false;
  let unsubscribe = (): void => {};
  const finish = (then?: () => void): void => {
    if (done) return;
    done = true;
    unsubscribe();
    clearTimeout(timer);
    then?.();
  };
  const timer = setTimeout(() => finish(onIdle), ms);
  unsubscribe = useAgentActivity.subscribe((state) => {
    if (state.activity === 'working') finish(onWork);
  });
  if (done) unsubscribe();
  else if (useAgentActivity.getState().activity === 'working') finish(onWork);
  return () => finish();
}

const PAGE_CHECK_DEPENDENCIES: Omit<PageCheckDependencies, 'put'> = {
  viewer: () => Promise.resolve(getCurrentViewer()?.id ?? null),
  wait,
  hidden: () => document.hidden,
};

type PageCheckPhase = 'begun' | 'working' | null;

/**
 * Runs the page check after each write of the page's files, into `data/users/<me>/check`; `graceMs` keeps `working`
 * on that long after the agent goes idle.
 */
export function usePageCheck(props: PageCheckProps, graceMs: number): PageCheckResult {
  const latest = useRef(props);
  latest.current = props;
  const checkedFiles = useRef<readonly DashboardFile[] | null>(null);
  const unruledKey = (props.unruled ?? []).map((entry) => `${entry.dataset}\0${entry.filter}\0${entry.what ?? ''}`).join('\u0001');
  const checkedUnruled = useRef(unruledKey);
  const interrupted = useRef(false);
  const generation = useRef(0);
  const state = useRef(createPageCheckState());
  const [deps] = useState<PageCheckDependencies>(() => ({
    ...PAGE_CHECK_DEPENDENCIES,
    put: createUserDocumentWriter(USER_CHECK_DOCUMENT),
  }));
  const flips = useRef(props.flips);
  const [told, setTold] = useState(false);
  const [phase, setPhase] = useState<PageCheckPhase>(null);
  const hasPhase = useRef(false);
  hasPhase.current = phase !== null;
  const clear = (): void => {
    state.current.marked = false;
    void deps.put(null);
  };

  useEffect(() => {
    if (!props.on) return;
    const first = checkedFiles.current === null;
    if (!first && props.files === checkedFiles.current && unruledKey === checkedUnruled.current && !interrupted.current) return;
    checkedFiles.current = props.files;
    checkedUnruled.current = unruledKey;
    interrupted.current = false;
    if (props.files.length === 0) {
      if (first) clear();
      return;
    }
    const mine = ++generation.current;
    let finished = false;
    const flipped = flips.current !== props.flips;
    const check = (): void => {
      setPhase((current) => current ?? 'begun');
      void runPageCheck(
        {
          now: () => latest.current,
          stale: () => mine !== generation.current,
          told: (said) => setTold(said && hasPhase.current),
        },
        state.current,
        deps,
      ).finally(() => {
        if (mine === generation.current) finished = true;
      });
    };
    const skip = (): void => {
      finished = true;
      state.current.hadPage = flipped || hasEntryFile(props.files);
      clear();
    };
    let cancel: (() => void) | undefined;
    if (flipped) state.current = createPageCheckState();
    if (first)
      cancel = waitForAgentWork(check, () => (useAgentActivity.getState().activity === 'unknown' ? check() : skip()));
    else if (flipped) skip();
    else check();
    return () => {
      cancel?.();
      interrupted.current = !finished;
      generation.current++;
    };
  }, [props.on, props.files, unruledKey]);

  useEffect(() => {
    flips.current = props.flips;
  }, [props.flips]);

  useEffect(() => {
    if (!props.on || props.stored === undefined || areDashboardFilesEqual(props.stored, props.files)) return;
    generation.current++;
    clear();
  }, [props.on, props.stored]);

  const activity = useAgentActivity((current) => current.activity);
  const now: AgentActivity = phase !== null ? activity : 'unknown';
  if (phase === 'begun' && now === 'working') setPhase('working');

  useEffect(() => {
    if (phase === null || now !== 'idle') return;
    const timer = setTimeout(() => {
      setPhase(null);
      setTold(false);
    }, graceMs);
    return () => clearTimeout(timer);
  }, [phase, now]);

  const working = phase === 'working';
  const fixing = working && told;
  return useMemo(() => ({ fixing, working }), [fixing, working]);
}

/** Which check notice shows above the page: "fixing" while the agent works on it, "fix" until dismissed. */
export function getPageCheckNotice<T>(input: { broke: T | null; fixing: boolean; closed: T | null; free: boolean }): PageCheckNotice {
  if (input.broke === null || !input.free) return null;
  if (input.fixing) return 'fixing';
  return input.broke !== input.closed ? 'fix' : null;
}

/** The files of every stopped fault, once each (what a "fix this page" request names). */
export function getStoppedPageFiles(faults: readonly PageFault[]): string[] {
  return [...new Set(faults.flatMap((fault) => (fault.kind === 'stopped' && fault.file !== undefined ? [fault.file] : [])))];
}

export const SHOWN_PAGE_DELAY_MS = 1000;

/** True while `flag` is, and for `graceMs` after it turns false. */
export function useLingeringFlag(flag: boolean, graceMs: number): boolean {
  const [lingering, setLingering] = useState(flag);
  useEffect(() => {
    if (flag) {
      setLingering(true);
      return;
    }
    const timer = setTimeout(() => setLingering(false), graceMs);
    return () => clearTimeout(timer);
  }, [flag, graceMs]);
  return flag || lingering;
}

export interface ShownPageState {
  loaded: boolean;
  /** Reports run only while this is true (the viewer can edit the dashboard). */
  on: boolean;
  /** What the page shows when it isn't the dashboard itself (`drafts/<id>`, `history/<n>`); a change writes anew. */
  showing?: string | null;
  settled: boolean;
  files: readonly DashboardFile[];
  filters: Parameters;
  /** The page as it shows now, or null when it can't be read yet. */
  shown: () => ShownPage | null;
}

/**
 * While the agent's turn runs on a settled page, writes the viewer's rendered page to `data/users/<me>/page` a moment
 * after the turn starts, so the agent can read what the viewer sees (with `showing` while a draft or an earlier version
 * is on it); removes it when the turn ends, the page hides, what it shows changes or the report turns off.
 */
export function useShownPageReport(state: ShownPageState, { graceMs, writer }: { graceMs: number; writer?: UserDocumentWriter }): void {
  const [write] = useState<UserDocumentWriter>(() => writer ?? createUserDocumentWriter(USER_PAGE_DOCUMENT));
  const latest = useRef(state);
  latest.current = state;
  const activity = useAgentActivity((current) => current.activity);
  const turn = useLingeringFlag(state.loaded && state.on && activity === 'working', graceMs);
  useEffect(() => {
    if (!state.loaded) return;
    const remove = (): void => void write(null);
    remove();
    if (!state.on || !turn || !state.settled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = (): void => {
      const shown = latest.current.shown();
      if (shown === null) {
        timer = setTimeout(send, SHOWN_PAGE_DELAY_MS);
        return;
      }
      const showing = latest.current.showing ?? null;
      void write(
        fitShownPageRecord(shown.html, {
          v: 1,
          at: new Date().toISOString(),
          ...(showing === null ? {} : { showing }),
          width: shown.width,
          filters: latest.current.filters,
        }),
      );
    };
    timer = setTimeout(send, SHOWN_PAGE_DELAY_MS);
    window.addEventListener('pagehide', remove);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pagehide', remove);
    };
  }, [state.loaded, state.on, turn, state.settled, state.files, state.showing ?? null]);
}
