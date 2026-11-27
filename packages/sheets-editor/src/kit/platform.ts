import * as React from 'react';

export const COARSE_OR_HOVERLESS_MEDIA_QUERY = '(pointer: coarse), (hover: none)';
export const NARROW_VIEWPORT_MEDIA_QUERY = '(width < 40rem)';
export const COARSE_POINTER_MEDIA_QUERY = '(pointer: coarse)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
export const REDUCED_MOTION_ATTRIBUTE = 'data-reduce-motion';
const DESKTOP_SHELL_USER_AGENT_TOKEN = ' Electron/';

const browserWindow = (win?: Window | null): Window | undefined => win ?? (typeof window === 'undefined' ? undefined : window);

/** The window's list for a media query; some embedded browsers hand back nothing. */
function mediaList(target: Window | undefined, query: string): MediaQueryList | undefined {
  if (typeof target?.matchMedia !== 'function') return undefined;
  const list: MediaQueryList | undefined = target.matchMedia(query);
  return list ?? undefined;
}

export function windowMatchesMedia(query: string, win?: Window | null): boolean {
  return mediaList(browserWindow(win), query)?.matches === true;
}

export function ownerWindowOf(element: Element | null | undefined): Window & typeof globalThis {
  return element?.ownerDocument.defaultView ?? window;
}

/** Whether touch is the main way in: no fine pointer, or nothing that hovers. */
export function usesCoarsePointer(win?: Window | null): boolean {
  return windowMatchesMedia(COARSE_OR_HOVERLESS_MEDIA_QUERY, win);
}

/** A guess at whether a hardware keyboard is at hand, so shortcut hints are worth showing. */
export function likelyHasKeyboard(win?: Window | null): boolean {
  const target = browserWindow(win);
  if (target?.navigator?.userAgent?.includes(DESKTOP_SHELL_USER_AGENT_TOKEN)) return true;
  return !(windowMatchesMedia(COARSE_POINTER_MEDIA_QUERY, target) && (target?.navigator?.maxTouchPoints ?? 0) > 0);
}

/** Calls back whenever the pointer, viewport width or keyboard guess may have changed. */
export function subscribeSheetMedia(onChange: () => void, win?: Window | null): () => void {
  const target = browserWindow(win);
  const lists = [COARSE_OR_HOVERLESS_MEDIA_QUERY, NARROW_VIEWPORT_MEDIA_QUERY, COARSE_POINTER_MEDIA_QUERY].flatMap(
    (query) => mediaList(target, query) ?? [],
  );
  for (const list of lists) list.addEventListener('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange);
  };
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  return windowMatchesMedia(REDUCED_MOTION_QUERY) || document.documentElement.getAttribute(REDUCED_MOTION_ATTRIBUTE) === 'true';
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const list = mediaList(window, REDUCED_MOTION_QUERY);
  list?.addEventListener('change', onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [REDUCED_MOTION_ATTRIBUTE] });
  return () => {
    list?.removeEventListener('change', onChange);
    observer.disconnect();
  };
}

export function useReducedMotion(): boolean {
  return React.useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

function subscribeCoarsePointer(onChange: () => void): () => void {
  const list = mediaList(window, COARSE_OR_HOVERLESS_MEDIA_QUERY);
  if (list === undefined) return () => {};
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

export function useCoarsePointerMedia(): boolean {
  return React.useSyncExternalStore(subscribeCoarsePointer, () => usesCoarsePointer(), () => false);
}

/** Whether a media query matches in the window, kept current as it changes. */
export function useWindowMediaQuery(win: Window | null | undefined, query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const list = mediaList(browserWindow(win), query);
      list?.addEventListener('change', onChange);
      return () => list?.removeEventListener('change', onChange);
    },
    [win, query],
  );
  return React.useSyncExternalStore(subscribe, () => windowMatchesMedia(query, win), () => false);
}

const isMacLike = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

export function isApplePlatform(): boolean {
  return isMacLike();
}

const PULL_TO_REFRESH_RELEASE_MS = 500;
const pullToRefreshHolds = new WeakMap<HTMLElement, number>();

/** Only a top-level page on an Android touch screen reloads when pulled down. */
function canHoldPullToRefresh(view: Window): boolean {
  return /android/i.test(view.navigator.userAgent) && usesCoarsePointer(view) && view.parent === view;
}

function holdPullToRefresh(view: Window): () => void {
  const root = view.document.documentElement;
  const change = (delta: number): void => {
    const count = (pullToRefreshHolds.get(root) ?? 0) + delta;
    pullToRefreshHolds.set(root, count);
    root.style.overscrollBehaviorY = count > 0 ? 'contain' : '';
  };
  change(1);
  return () => {
    view.setTimeout(() => change(-1), PULL_TO_REFRESH_RELEASE_MS);
  };
}

/** Keeps a pull-down inside an open overlay from reloading the page. */
export function useHoldPullToRefresh(open: boolean, win?: Window | null): void {
  React.useEffect(() => {
    const view = browserWindow(win);
    if (!open || view === undefined || !canHoldPullToRefresh(view)) return undefined;
    let release: (() => void) | undefined;
    let frame = view.requestAnimationFrame(() => {
      frame = view.requestAnimationFrame(() => {
        release = holdPullToRefresh(view);
      });
    });
    return () => {
      view.cancelAnimationFrame(frame);
      release?.();
    };
  }, [open, win]);
}
