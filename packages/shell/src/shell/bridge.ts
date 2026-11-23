/**
 * The Shell's two postMessage protocols (`@open-artifact/protocol`'s
 * `shell.ts`):
 *
 * - **chrome**, with the page in the `open-artifact-shell` frame: `chrome_hello` on
 *   every load (with what the Shell draws: save state, page actions,
 *   export formats, the share notice), `chrome_report` back, `chrome_cmd`
 *   from the bar's buttons, `chrome_exports` for a v1 page's Export tab,
 *   `chrome_export` for what became of an `export_format`,
 *   `files_changed` (the frame reloads unless the page answers
 *   `files_changed_ok` within a second), and `clipboard_write` /
 *   `clipboard_data` / `clipboard_done` (`clipboard.ts`);
 * - `frame_denied` from the page's server, when it refused the frame: the
 *   Shell asks for the page's address again once (`actions.ts`);
 * - **capability broker**, also with the page: `cap_want`/`cap` from the
 *   page's `window.openartifact`, run by `broker.ts` against the page's
 *   backend and answered with `cap_grant`/`cap_r`/`cap_ack`/`cap_ev`;
 * - **host**, with the app that embeds the Shell: `shell_hello` to `*` on
 *   load, `host_hello` back, then `shell_ready`, `new_session`,
 *   `open_session`, `close`, `comment_summon`, `place`, `open_external`
 *   and `saved_file` to the host's origin; the host may send `goto` with a
 *   place, and `host_hello` again when its theme changes. `host_hello` is
 *   taken only from an origin a connected adapter declared
 *   (`caps.open.origins`, read from `/api/open-artifact.embed` each time);
 *   while no adapter declared any, any parent is taken as before but gets no
 *   prompt or comment text, links or saved files (`toHostMessage`). A Shell
 *   opened as a top-level view (`?oa_view=<ticket>`, no parent) speaks the
 *   same protocol through the daemon instead (`view-channel.ts`).
 */

import { copyShellLink, frameDenied } from './actions.ts';
import { DOC_FRAGMENT, HOST_PROTOCOL, SLIDE_FRAGMENT } from '@open-artifact/protocol';
import type { ChromeCommand, ChromeExportItem, ChromeExportState, PageToShell, ShellToHost, ShellToPage } from '@open-artifact/protocol';
import { CHROME_DRAWS, isShellMessage } from '@open-artifact/protocol';
import { toast } from '@open-artifact/ui';
import { mayComment, roleOf } from '../lib/cloud.ts';
import { declaredHosts } from '../lib/host-origins.ts';
import { t } from '../lib/i18n.ts';
import { call as brokerCall, setSavedFileListener, want as brokerWant, type PagePost } from './broker.ts';
import { browserClipboard, createClipboardRelay } from './clipboard.ts';
import {
  FRAME_READY_FALLBACK_MS, accentVars, actionOf, exportRequestId, frameDeniedReason, handlePageLeaving,
  hostOf, hostVerdict, inlineView, normalizeReport, readyOnLoad, sheetPageFragment, showsComments,
  toHostMessage, type ExportEntry, type HostInfo,
} from './model.ts';
import { gotoCommand, placeOf } from './place.ts';
import { useShell } from './store.ts';
import { startViewChannel, viewSend } from './view-channel.ts';

/** The page's frame, while mounted. */
let frame: HTMLIFrameElement | null = null;
/** The page's origin: chrome messages go only there. */
let pageOrigin = location.origin;
// An async editor can attach its message listener after the iframe's load event.
let helloOnFirstReport = false;
let loaded = false;
let hasReport = false;
let documentId: number | undefined;
let retiredDocument: number | undefined;
let leavingToken: string | undefined;
let leaving: AbortController | undefined;
let readyTimer: ReturnType<typeof setTimeout> | undefined;
/** Export requests waiting for `chrome_exports`, by id. */
const exportsWaiting = new Map<string, (items: ChromeExportItem[]) => void>();
let exportSeq = 0;
/** `export_format` requests in flight, by request id: what the toast names. */
const formatsWaiting = new Map<string, string>();
/** The page's last reported place, for a host that says hello later or asks for an unknown one. */
let place: string | null = null;
/** Pending reload after `files_changed`, cleared by `files_changed_ok`. */
let filesTimer: ReturnType<typeof setTimeout> | null = null;

/** Writes the clipboard for the page, where this browser can. */
const clipboardEnv = browserClipboard();
const clipboard = clipboardEnv
  ? createClipboardRelay(clipboardEnv, (id, error) => toPage({ openArtifact: 'clipboard_done', id, ...(error === undefined ? {} : { error }) }))
  : null;

/** The Shell runs inside another window. */
export const embedded = window.parent !== window;

function beginNavigation(): void {
  clearTimeout(readyTimer);
  leaving?.abort();
  if (documentId !== undefined) retiredDocument = documentId;
  documentId = undefined;
  leavingToken = undefined;
  hasReport = loaded = false;
  useShell.getState().setFrameLoading();
}

/** Registers the page's frame (or `null` when it unmounts) and the origin it is served from. */
export function attachFrame(element: HTMLIFrameElement | null, origin: string): void {
  if (frame === element && origin === pageOrigin) return;
  clearTimeout(readyTimer);
  leaving?.abort();
  frame = element;
  pageOrigin = origin;
  documentId = retiredDocument = undefined;
  if (element) beginNavigation();
}

/** A report can arrive before load. Only pages that never reported use the load deadline. */
export function frameLoaded(): void {
  if (!frame) return;
  if (loaded) beginNavigation();
  loaded = true;
  leaving = new AbortController();
  try {
    frame.contentWindow?.addEventListener('pagehide', beginNavigation, { once: true, signal: leaving.signal });
  } catch { /* Cross-origin editors send chrome_leaving on pagehide. */ }
  formatsWaiting.clear();
  clipboard?.clear();
  helloOnFirstReport = true;
  sendChromeHello();
  if (hasReport) return;
  const store = useShell.getState();
  const revealUnreportedPage = () => {
    store.setReport({});
    store.setPageReady(true);
  };
  if (readyOnLoad(store.boot?.pageKind ?? null)) revealUnreportedPage();
  else {
    // An editor can navigate its own frame to ordinary HTML. Give that document a turn to answer hello.
    readyTimer = setTimeout(revealUnreportedPage, retiredDocument === undefined ? FRAME_READY_FALLBACK_MS : 60);
  }
}

function sendChromeHello(): void {
  const boot = useShell.getState().boot;
  const standaloneDesign = boot?.type === 'design' && boot.typeServer;
  const theme = useShell.getState().host?.theme;
  toPage({ openArtifact: 'chrome_hello', draws: CHROME_DRAWS.filter(draw => draw !== 'actions' || !standaloneDesign), ...(clipboard ? { clipboard: true } : {}), ...(theme ? { theme } : {}) });
}

/** Sends a chrome message to the page. */
export function toPage(message: ShellToPage): void {
  frame?.contentWindow?.postMessage(message, pageOrigin);
}

/** Sends a broker answer to the page (with transferables). */
const toPageCap: PagePost = (message, transfer) => {
  frame?.contentWindow?.postMessage(message, { targetOrigin: pageOrigin, ...(transfer ? { transfer } : {}) });
};

/** Sends a `chrome_cmd` to the page. */
export function command(cmd: ChromeCommand): void {
  toPage({ openArtifact: 'chrome_cmd', ...cmd });
}

/** The page's export items, or none after two seconds (or when it reported no exports). */
export function requestExports(): Promise<ChromeExportItem[]> {
  return new Promise((resolve) => {
    if (!useShell.getState().report.exports) return resolve([]);
    const id = `x${++exportSeq}`;
    exportsWaiting.set(id, resolve);
    command({ cmd: 'exports', id });
    setTimeout(() => {
      if (exportsWaiting.delete(id)) resolve([]);
    }, 2000);
  });
}

/** Runs a page action, when the page declares it and it is enabled. */
export function runAction(id: string): void {
  const action = actionOf(useShell.getState().report, id);
  if (action && !action.disabled) command({ cmd: 'action', id });
}

/** Exports one of the page's formats; the page answers with `chrome_export`. */
export function exportFormat(entry: ExportEntry): void {
  if (entry.disabled) return;
  const request = exportRequestId();
  formatsWaiting.set(request, entry.label);
  // A page that never answers leaves nothing behind.
  setTimeout(() => formatsWaiting.delete(request), 15 * 60_000);
  command({ cmd: 'export_format', request, format: entry.format, ...(entry.variant ? { variant: entry.variant } : {}) });
}

const EXPORT_FAILURE: Partial<Record<ChromeExportState, 'exportBusy' | 'exportUnsupported' | 'exportFailed'>> = {
  busy: 'exportBusy',
  unsupported: 'exportUnsupported',
  failed: 'exportFailed',
};

/** `chrome_export`: forgets finished requests and says why one did not run. */
function exportState(request: unknown, state: unknown, reason: unknown): void {
  if (typeof request !== 'string') return;
  const label = formatsWaiting.get(request);
  if (label === undefined) return;
  if (state === 'started') return;
  formatsWaiting.delete(request);
  const key = EXPORT_FAILURE[state as ChromeExportState];
  if (!key) return; // done; declined is the person's own choice
  const detail = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : '';
  toast.add({ title: t(key, { label }), ...(detail ? { description: detail } : {}) });
}

/** Reloads the page's frame. */
export function reloadPage(): void {
  if (!frame) return;
  beginNavigation();
  try {
    frame.contentWindow?.location.reload();
  } catch {
    // A cross-origin frame: setting the same address loads it again.
    const src = frame.src;
    frame.src = src;
  }
}

/** The artifact's files changed on disk: tell the page, and reload it unless it says it applied them. */
export function filesChanged(paths: string[]): void {
  if (!frame) return;
  toPage({ openArtifact: 'files_changed', paths });
  if (filesTimer) clearTimeout(filesTimer);
  filesTimer = setTimeout(() => {
    filesTimer = null;
    reloadPage();
  }, 1000);
}

/**
 * Sends a host message to the host (its origin, or the daemon's view channel), with the artifact's URL, as much of it
 * as the host may have (`toHostMessage`). False when nothing was sent: no host, or not for this one.
 */
export function toHost(message: ShellToHost): boolean {
  const { host, boot } = useShell.getState();
  if (!host || !boot) return false;
  const out = toHostMessage(host, message);
  if (!out) return false;
  if (host.via === 'view') viewSend({ artifact: boot.url, ...out });
  else window.parent.postMessage({ artifact: boot.url, ...out }, host.origin);
  return true;
}

/** Opens an address outside the Shell: the declared host opens it by its own rules, else a new browser tab. */
export function openExternal(url: string): void {
  if (/^https?:\/\//i.test(url) && toHost({ openArtifact: 'open_external', url })) return;
  window.open(url, '_blank', 'noopener');
}

/** Follows the host's colour scheme and accent: the Shell's root, and the page through `chrome_hello`. */
function applyTheme(host: HostInfo): void {
  const root = document.documentElement;
  if (!host.theme) return;
  root.dataset.theme = host.theme.scheme;
  for (const [name, value] of Object.entries(accentVars(host.theme.accent ?? null))) root.style.setProperty(name, value);
}

/** A `host_hello` was taken: the Shell answers `shell_ready` and its place. */
function acceptHost(host: HostInfo): void {
  const store = useShell.getState();
  store.setHost(host);
  applyTheme(host);
  if (host.theme) sendChromeHello();
  const boot = store.boot;
  if (!boot) return;
  const ready: ShellToHost = { openArtifact: 'shell_ready', artifact: boot.url };
  if (host.via === 'view') viewSend(ready);
  else window.parent.postMessage(ready, host.origin);
  tellPlace();
}

/** A host's `goto`: the page shows that place, or the Shell says where it is. */
function hostGoto(hash: unknown): void {
  const boot = useShell.getState().boot;
  if (!boot || typeof hash !== 'string') return;
  const cmd = gotoCommand(boot.type, hash);
  if (cmd) command(cmd);
  else tellPlace();
}

function tellPlace(): void {
  const boot = useShell.getState().boot;
  if (boot && place) toHost({ openArtifact: 'place', artifact: boot.url, hash: place });
}

function onPageMessage(message: PageToShell & { documentId?: unknown; leavingToken?: unknown }, event: MessageEvent): void {
  const store = useShell.getState();
  const reported = store.boot ? placeOf(store.boot.type, message) : null;
  if (reported) {
    place = reported;
    tellPlace();
  }
  switch (message.openArtifact) {
    case 'request_comment_mode':
      if (mayComment(roleOf(store.boot)) && showsComments(store.report) && typeof message.on === 'boolean') {
        const anchor = message.on && typeof message.anchor === 'string' ? message.anchor : undefined;
        command({ cmd: 'comments_mode', on: message.on, ...(anchor ? { anchor } : {}) });
      }
      break;
    case 'copy_slide_link':
      if (store.boot?.type === 'slides' && typeof message.hash === 'string' && SLIDE_FRAGMENT.test(message.hash)) {
        void copyShellLink(message.hash);
      }
      break;
    case 'copy_sheet_link':
      if (store.boot?.type === 'sheets' && typeof message.page === 'string') {
        void copyShellLink('#' + new URLSearchParams({ page: message.page }).toString());
      }
      break;
    case 'sheet_page':
      if (store.boot?.type !== 'sheets') break;
      if (message.page !== null && typeof message.page !== 'string') break;
      {
        const hash = message.page ? '#' + new URLSearchParams({ page: message.page }).toString() : '';
        if (location.hash !== hash) history.replaceState(history.state, '', location.pathname + location.search + hash);
      }
      break;
    case 'design_page':
      if (store.boot?.type === 'design' && (message.page === null || typeof message.page === 'string')) {
        const hash = message.page ? '#' + new URLSearchParams({ page: message.page }).toString() : '';
        if (location.hash !== hash) history.replaceState(history.state, '', location.pathname + location.search + hash);
      }
      break;
    case 'doc_place':
      if (store.boot?.type === 'docs' && typeof message.hash === 'string' && DOC_FRAGMENT.test(message.hash)) {
        const url = new URL(location.href);
        url.searchParams.delete('tab');
        url.hash = message.hash;
        if (url.href !== location.href) history.replaceState(history.state, '', url);
      }
      break;
    case 'current_slide':
      // The inline fragment stays on the address, so a reload shows the inline view again.
      if (store.boot?.type === 'slides' && typeof message.hash === 'string' && SLIDE_FRAGMENT.test(message.hash) && location.hash !== message.hash && !inlineView(store.boot, location.href, embedded)) {
        history.replaceState(history.state, '', message.hash);
      }
      break;
    case 'cap_want':
      void brokerWant(message, pageOrigin, toPageCap);
      break;
    case 'cap':
      void brokerCall(message, event, toPageCap);
      break;
    case 'clipboard_write':
      clipboard?.start(message.id, message.types);
      break;
    case 'clipboard_data':
      clipboard?.data(message.id, message.items, message.error);
      break;
    case 'files_changed_ok':
      if (filesTimer) clearTimeout(filesTimer);
      filesTimer = null;
      break;
    case 'frame_denied': {
      // From the frame's own window and origin only (checked in onMessage): the refusal page of its server.
      const reason = frameDeniedReason(message);
      if (reason) frameDenied(reason);
      break;
    }
    case 'chrome_report':
      if (message.report && typeof message.report === 'object') {
        if (typeof message.documentId === 'number') {
          if (retiredDocument !== undefined && message.documentId <= retiredDocument) break;
          if (documentId !== undefined && message.documentId !== documentId) {
            if (message.documentId < documentId) break;
            beginNavigation();
          }
          documentId = message.documentId;
          leavingToken = typeof message.leavingToken === 'string' ? message.leavingToken : undefined;
        } else if (documentId !== undefined) break;
        clearTimeout(readyTimer);
        hasReport = true;
        store.setReport(normalizeReport(message.report));
        if (message.report.ready !== false) store.setPageReady(true);
        else store.setPageReady(false);
        if (helloOnFirstReport) {
          helloOnFirstReport = false;
          sendChromeHello();
        }
      }
      break;
    case 'chrome_export':
      exportState(message.request, message.state, message.reason);
      break;
    case 'chrome_exports': {
      const done = exportsWaiting.get(message.id);
      exportsWaiting.delete(message.id);
      const items = Array.isArray(message.items) ? message.items.filter((item) => item && typeof item.label === 'string') : [];
      done?.(items);
      break;
    }
    default:
      break;
  }
}

/** A navigation notice from the runtime that identifies the document leaving this frame. */
function isFrameLeaving(message: unknown): message is { openArtifact: 'chrome_leaving'; documentId?: unknown; leavingToken?: unknown } {
  return typeof message === 'object' && message !== null && 'openArtifact' in message && message.openArtifact === 'chrome_leaving';
}

function onMessage(event: MessageEvent): void {
  const message: unknown = event.data;
  if (isFrameLeaving(message)) {
    if (!frame || event.origin !== pageOrigin || documentId === undefined || message.documentId !== documentId) return;
    handlePageLeaving(frame.contentWindow, event.source, leavingToken, message.leavingToken, beginNavigation);
    return;
  }
  if (!isShellMessage(message)) return;
  if (frame && event.source === frame.contentWindow) {
    if (event.origin === pageOrigin) onPageMessage(message as PageToShell, event);
    return;
  }
  if (event.source !== window.parent || !embedded) return;
  if (message.openArtifact === 'goto') {
    const host = useShell.getState().host;
    if (!host || host.via !== 'frame' || event.origin !== host.origin) return;
    hostGoto(message.hash);
    return;
  }
  if (message.openArtifact !== 'host_hello') return;
  const origin = event.origin;
  // Only from an origin a connected adapter declared; while none declared any, as before but without texts.
  void declaredHosts().then((hosts) => {
    const verdict = hostVerdict(origin, hosts);
    if (verdict === 'refused') return;
    const host = hostOf(message, origin, verdict === 'declared');
    if (host) acceptHost(host);
  });
}

/** A command from the adapter of this top-level view (through the daemon): its host, declared by its connection. */
function onViewCommand(message: unknown): void {
  if (!isShellMessage(message)) return;
  if (message.openArtifact === 'goto') {
    if (useShell.getState().host?.via === 'view') hostGoto(message.hash);
    return;
  }
  const host = hostOf(message, 'view', true, 'view');
  if (host) acceptHost(host);
}

/**
 * A press in the page's frame is no event in this window: when the window
 * loses focus to the frame, the open menus and panels close.
 */
function onBlur(): void {
  setTimeout(() => {
    if (frame && document.activeElement === frame) useShell.getState().closePopups();
  });
}

/** The page says leaving now loses work: the browser asks before the Shell unloads. */
function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!useShell.getState().report.leaveLosesWork) return;
  event.preventDefault();
  event.returnValue = '';
}

/** Starts both protocols. Call once the boot is known; returns a function that stops them. */
export function startBridge(): () => void {
  const followPage = (): void => {
    if (useShell.getState().boot?.type === 'docs' && location.hash) command({ cmd: 'goto_doc', hash: location.hash });
    if (useShell.getState().boot?.type === 'sheets') {
      const page = new URLSearchParams(sheetPageFragment(location.hash).slice(1)).get('page');
      if (page) command({ cmd: 'goto_sheet', page });
    }
    if (useShell.getState().boot?.type === 'slides' && SLIDE_FRAGMENT.test(location.hash)) command({ cmd: 'goto_slide', hash: location.hash });
  };
  window.addEventListener('hashchange', followPage);
  window.addEventListener('message', onMessage);
  window.addEventListener('blur', onBlur);
  window.addEventListener('beforeunload', onBeforeUnload);
  const boot = useShell.getState().boot;
  const hello: ShellToHost | null = boot ? { openArtifact: 'shell_hello', version: boot.version, protocol: HOST_PROTOCOL, artifact: boot.url, id: boot.id, title: boot.title, type: boot.type } : null;
  if (embedded && hello) window.parent.postMessage(hello, '*');
  // A top-level view the adapter opened: the same protocol through the daemon.
  const stopView = !embedded && boot && hello ? startViewChannel(boot.id, { onCommand: onViewCommand, onOpen: () => viewSend(hello) }) : null;
  // Exports the page's server saved: the declared host hears where.
  setSavedFileListener((path) => void toHost({ openArtifact: 'saved_file', path }));
  return () => {
    stopView?.();
    setSavedFileListener(null);
    window.removeEventListener('hashchange', followPage);
    window.removeEventListener('message', onMessage);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}
