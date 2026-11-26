/**
 * The host channel of a Shell opened as a top-level view (`host.open`'s `embed_url`: the Shell's address with
 * `?oa_view=<ticket>`, no parent frame). The Shell claims the one-time ticket over a WebSocket to
 * `/api/open-artifact.view` (its first message, `view`, carries a key only this Shell knows), then sends what it would
 * have posted to a parent frame with `POST /api/open-artifact.view` and that key; the adapter's commands come down the
 * socket. A browser opens at most six HTTP/1.1 connections to one host and a WebSocket is not one of them, so a host
 * with many views open (an app's tabs) still loads the next one; where no socket opens, the same claim goes over an
 * event stream (`GET`) instead.
 * The ticket leaves the address once claimed; the key stays in this tab's session storage, so a reload comes back to
 * the same view (within the daemon's grace).
 */

import { LIBRARY_ROUTES, VIEW_TICKET_PARAM, type ShellToHost } from '@open-artifact/protocol';

const ROUTE = `/api/open-artifact.${LIBRARY_ROUTES.view}`;
/** Reconnects after a dropped stream, at most. */
const MAX_RETRIES = 5;

interface Claimed {
  view: string;
  key: string;
}

let current: Claimed | null = null;

const storageKey = (id: string): string => `open-artifact.view.${id}`;

function stored(id: string): Claimed | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(storageKey(id)) ?? 'null') as Partial<Claimed> | null;
    return raw && typeof raw.view === 'string' && typeof raw.key === 'string' ? { view: raw.view, key: raw.key } : null;
  } catch {
    return null;
  }
}

function store(id: string, claimed: Claimed | null): void {
  try {
    if (claimed) sessionStorage.setItem(storageKey(id), JSON.stringify(claimed));
    else sessionStorage.removeItem(storageKey(id));
  } catch {
    // No session storage: a reload starts without the view.
  }
}

/** The ticket on this address, removed from it (it is used once; a reload uses the key). */
export function takeTicket(): string | null {
  const url = new URL(location.href);
  const ticket = url.searchParams.get(VIEW_TICKET_PARAM);
  if (ticket === null) return null;
  url.searchParams.delete(VIEW_TICKET_PARAM);
  history.replaceState(history.state, '', url);
  return ticket || null;
}

/** What comes down the channel, and its end (`opened`: whether it was ever open). */
interface StreamHandlers {
  view: (data: { view?: unknown; key?: unknown }) => void;
  command: (message: unknown) => void;
  lost: (opened: boolean) => void;
}
interface Stream {
  close(): void;
}

/** Whether to try a WebSocket first (until one fails to open in this page). */
let useSocket = typeof WebSocket !== 'undefined';

/** The channel over a WebSocket: JSON text messages, `{type: 'view', …}` then `{type: 'command', command}`. */
function openSocket(path: string, on: StreamHandlers): Stream {
  const url = new URL(path, location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  let opened = false;
  let done = false;
  socket.addEventListener('open', () => (opened = true));
  socket.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(String((event as MessageEvent).data)) as { type?: unknown; command?: unknown };
      if (data.type === 'view') on.view(data as { view?: unknown; key?: unknown });
      else if (data.type === 'command') on.command(data.command);
    } catch {
      // Not JSON: dropped.
    }
  });
  socket.addEventListener('close', () => {
    if (done) return;
    done = true;
    on.lost(opened);
  });
  return {
    close: () => {
      done = true;
      socket.close();
    },
  };
}

/** The channel over an event stream: events `view` and `command`. */
function openEvents(path: string, on: StreamHandlers): Stream {
  const source = new EventSource(path);
  let done = false;
  source.addEventListener('view', (event) => {
    try {
      on.view(JSON.parse((event as MessageEvent<string>).data) as { view?: unknown; key?: unknown });
    } catch {
      // Not a view event.
    }
  });
  source.addEventListener('command', (event) => {
    try {
      on.command(JSON.parse((event as MessageEvent<string>).data));
    } catch {
      // Not JSON: dropped.
    }
  });
  source.addEventListener('error', () => {
    source.close();
    if (done) return;
    done = true;
    on.lost(true);
  });
  return {
    close: () => {
      done = true;
      source.close();
    },
  };
}

/**
 * Starts the view channel of artifact `id` when this Shell was opened as a top-level view; `null` when it was not.
 * `onOpen` runs once the view is claimed (the Shell says `shell_hello`), `onCommand` for each host message.
 */
export function startViewChannel(id: string, handlers: { onCommand: (message: unknown) => void; onOpen: () => void }): (() => void) | null {
  const ticket = takeTicket();
  const kept = ticket ? null : stored(id);
  if (!ticket && !kept) return null;
  let stopped = false;
  let source: Stream | null = null;
  let retries = 0;
  const onView = (data: { view?: unknown; key?: unknown }): void => {
    if (typeof data.view !== 'string' || typeof data.key !== 'string') return;
    current = { view: data.view, key: data.key };
    store(id, current);
    retries = 0;
    handlers.onOpen();
  };
  const open = (view: string, key: string | null): void => {
    const query = new URLSearchParams({ view, id, ...(key ? { key } : {}) });
    source = (useSocket ? openSocket : openEvents)(`${ROUTE}?${query}`, {
      view: onView,
      command: handlers.onCommand,
      lost: (opened) => {
        source = null;
        if (stopped) return;
        // No socket opened at all (a proxy that does not pass them on, or a refused claim): the same claim over an
        // event stream, which says which it was.
        if (useSocket && !opened) {
          useSocket = false;
          open(view, key);
          return;
        }
        // A refused claim or a dropped stream: try again with the key, a few times.
        if (!current || retries >= MAX_RETRIES) {
          store(id, null);
          current = null;
          return;
        }
        retries += 1;
        const again = current;
        setTimeout(() => !stopped && open(again.view, again.key), 1000 * retries);
      },
    });
  };
  if (ticket) open(ticket, null);
  else if (kept) {
    current = kept;
    open(kept.view, kept.key);
  }
  return () => {
    stopped = true;
    source?.close();
    current = null;
  };
}

/** Longest wait for the daemon to take one message before the next is sent anyway, ms. */
const SEND_TIMEOUT_MS = 10_000;

/** The last message on its way: the next one is sent once it was taken. */
let sending: Promise<void> = Promise.resolve();

/**
 * Sends a host message through the view channel; nothing before the view is claimed. Messages go one at a time, in
 * the order said: each is its own POST, and two in flight at once may be taken in either order (a `saving` taken
 * after the `saved` that followed it would leave the host showing `saving` for good).
 */
export function viewSend(message: ShellToHost | (ShellToHost & { artifact: string })): void {
  const claimed = current;
  if (!claimed) return;
  const body = JSON.stringify({ view: claimed.view, key: claimed.key, event: message });
  sending = sending.then(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    return fetch(ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: controller.signal })
      .then(() => undefined, () => undefined)
      .finally(() => clearTimeout(timer));
  });
}
