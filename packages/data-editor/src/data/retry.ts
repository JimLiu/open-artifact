import type { LoadFailure, LoadResult, PollClock } from '@open-artifact/data-core';

/** A failure soon after the page was shown (or a load began) is likely passing: it is tried again by itself. */
export const RECENTLY_SHOWN_MS = 4 * 6000;
/** The first retry of a busy or flaky load waits about this long (up to twice as long). */
export const FLAKY_RETRY_DELAY_MS = 6000;
/** A flaky load that failed twice is tried once more, quietly, after about this long. */
export const QUIET_RETRY_DELAY_MS = 12000;

/** A failure that is likely passing (`flaky`), with how long the connector asked to wait before another try. */
export interface RetryHint {
  flaky?: true;
  /** In ms. */
  wait?: number;
}

export type RetryableFailure = LoadFailure & RetryHint;

export function markFlaky(failure: LoadFailure, wait?: number): RetryableFailure {
  return { ...failure, flaky: true, ...(wait === undefined || wait <= 0 ? {} : { wait }) };
}

export function isFlakyLoad(result: LoadResult): boolean {
  return !result.ok && (result as RetryableFailure).flaky === true;
}

/** How long a failure asked to wait before another try; 0 when it didn't. */
export function getRetryWait(result: LoadResult): number {
  const wait = result.ok ? undefined : (result as RetryableFailure).wait;
  return typeof wait === 'number' && Number.isFinite(wait) && wait > 0 ? wait : 0;
}

/** `ms` to twice `ms`, so retries of many sources don't arrive together. */
export function jitterDelay(clock: PollClock, ms: number): number {
  return ms * (1 + clock.random());
}

/** When the page was last shown, and a wait for it to be shown again. */
export interface PageVisibility {
  /** When the page was last shown (opened, or made visible again); -Infinity once the tracker stopped. */
  shownAt(): number;
  hidden(): boolean;
  /** Resolves once the page is shown again (at once when it is, or when the tracker stops). */
  whenShown(): Promise<void>;
}

export interface PageVisibilityTracker extends PageVisibility {
  stop(): void;
}

/** Tracks the document's visibility: starting counts as being shown; stopping releases every wait. */
export function createPageVisibility(now: () => number, doc: Document | undefined = globalThis.document): PageVisibilityTracker {
  let shownAt = now();
  let stopped = false;
  let waiting: (() => void)[] = [];
  const isHidden = (): boolean => !stopped && doc?.visibilityState === 'hidden';
  const release = (): void => {
    const resolves = waiting;
    waiting = [];
    for (const resolve of resolves) resolve();
  };
  const onChange = (): void => {
    if (isHidden()) return;
    shownAt = now();
    release();
  };
  doc?.addEventListener('visibilitychange', onChange);
  return {
    shownAt: () => shownAt,
    hidden: isHidden,
    whenShown: () => (isHidden() ? new Promise<void>((resolve) => waiting.push(resolve)) : Promise.resolve()),
    stop() {
      stopped = true;
      shownAt = Number.NEGATIVE_INFINITY;
      doc?.removeEventListener('visibilitychange', onChange);
      release();
    },
  };
}
