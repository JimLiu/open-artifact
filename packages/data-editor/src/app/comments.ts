/**
 * Comments on the dashboard page. The host keeps the threads (the
 * `comments` capability); this module picks places on the page
 * (`comment-targets.ts`) and drives the editor kit's controller.
 *
 * - Comment mode: the Comments button, the Shell's, or C (not in a field or
 *   dialog, no modifier keys, not while the edit tool is on); Esc leaves it.
 *   While it is on, the page's own presses are held (a click on a bar
 *   comments on its chart instead of filtering), the pointer is a crosshair
 *   over the page and what a click would pick has a dashed outline. Edit,
 *   Design and Sources are off meanwhile (`setCommenting`).
 * - The comment state goes to the Shell (its Comments button and count),
 *   and its `comments_mode` / `comments_list` commands come here.
 */

import { toast } from '@open-artifact/ui';
import { isComposingKey } from '@open-artifact/ui/keys';
import { createComments, openMessageCount } from '@open-artifact/editor-kit';
import { maybeSession } from '../services/session.ts';
import { onShellCommand, setShellReport } from '../services/shell.ts';
import { setCommenting } from '../state/shown.ts';
import { useAgentActivity } from '../platform/agent-activity.ts';
import { describeTarget, findTarget, inField, pickElement, readTarget } from './comment-targets.ts';

/** The store document a comment is about: the page, which the agent changes. */
export const PAGE_FILE = 'files/index.html';
export const MAX_THREADS = 500;
/** What a comment on the whole dashboard is on (the "All comments" panel writes them). */
export const WHOLE_ARTIFACT_LABEL = 'Whole artifact';
const MODE_ATTR = 'data-dash-comment-layer';
const HOST_MODE_ATTR = 'data-comment-mode';
const HOVER_ATTR = 'data-dash-comment-hover';
const PICKED_ATTR = 'data-dash-comment-picked';
const EDIT_TOOL_ON = '.dash-edit-layer';
const FLASH_MS = 1600;
const PRESS_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick'] as const;

/** What a thread is on: a selector on the page, with what a new comment worked out about it. */
export interface PageAnchor {
  selector: string;
  label?: string;
  detail?: string;
}

export const pageComments = createComments<PageAnchor>({
  notify: (message) => toast.add(message),
  parse: (text) => ({ selector: text }),
  serialize: (anchor) => anchor.selector,
  label: (anchor) => anchor.label ?? 'Page',
  detail: (anchor) => anchor.detail,
  // A comment on the whole dashboard names the page alone.
  location: (anchor) => ({ file: PAGE_FILE, ...(anchor.selector ? { selector: anchor.selector } : {}) }),
  state: (anchor) => (typeof document === 'undefined' || findTarget(document, anchor.selector) !== null ? 'ok' : 'orphaned'),
  canComment: () => maybeSession()?.canComment ?? false,
  canSendToAgent: () => (maybeSession()?.canAsk ?? false) && maybeSession()?.agent !== null && useAgentActivity.getState().available,
  canRemove: () => maybeSession()?.canRemoveComments ?? false,
  agentName: () => useAgentActivity.getState().name,
  agentWakesIdle: () => useAgentActivity.getState().wakesIdle,
  viewerName: () => maybeSession()?.viewer.name ?? 'You',
  noun: 'dashboard',
  maxThreads: MAX_THREADS,
  reveal: (anchor) => revealTarget(anchor.selector),
  wholeArtifact: () => ({ selector: '', label: WHOLE_ARTIFACT_LABEL }),
  parksDrafts: true,
});

export const useComments = pageComments.store;

let hovered: Element | null = null;
let picked: Element | null = null;
let flashTimer: ReturnType<typeof setTimeout> | undefined;

function hover(el: Element | null): void {
  if (hovered === el) return;
  hovered?.removeAttribute(HOVER_ATTR);
  hovered = el;
  hovered?.setAttribute(HOVER_ATTR, '');
}

function pick(el: Element | null): void {
  clearTimeout(flashTimer);
  picked?.removeAttribute(PICKED_ATTR);
  picked = el;
  picked?.setAttribute(PICKED_ATTR, '');
}

/** Scrolls a target into view and outlines it for a moment. */
export function revealTarget(selector: string): void {
  const el = findTarget(document, selector);
  if (el === null) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  pick(el);
  flashTimer = setTimeout(() => {
    if (picked === el && useComments.getState().draft === null) pick(null);
  }, FLASH_MS);
}

/** Turns comment mode on or off (on only for someone who may comment). */
export function setCommentMode(on: boolean): void {
  if (on && !pageComments.canComment()) return;
  useComments.getState().setOn(on);
}

function reportToShell(): void {
  const { available, on, listOpen, threads } = useComments.getState();
  setShellReport({ comments: { available, on, open: listOpen, count: openMessageCount(threads), pageButton: false } });
}

/** Comment mode's presses on the page, its hover outline and its keys. */
function watchPage(): () => void {
  const press = (event: MouseEvent): void => {
    const { on } = useComments.getState();
    if (!on || event.button !== 0) return;
    const target = readTarget(event.target, window, { x: event.clientX, y: event.clientY });
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.type !== 'click') return;
    hover(null);
    pick(target.el);
    const { label, detail } = describeTarget(target);
    const state = useComments.getState();
    state.setActive(null);
    state.setDraft({ selector: target.anchor, label, detail });
  };
  let frame = 0;
  const move = (event: PointerEvent): void => {
    const { on, draft } = useComments.getState();
    if (!on || draft !== null || event.buttons !== 0) return hover(null);
    const { clientX, clientY, target } = event;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => hover(pickElement(target, window, { x: clientX, y: clientY })));
  };
  const key = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isComposingKey(event) || inField(event.target)) return;
    const { on, draft, active } = useComments.getState();
    if (event.key === 'Escape') {
      if (!on || draft !== null || active !== null) return;
      setCommentMode(false);
    } else if ((event.key === 'c' || event.key === 'C') && !event.shiftKey && !event.repeat) {
      if (draft !== null || document.querySelector(EDIT_TOOL_ON) !== null) return;
      setCommentMode(!on);
    } else return;
    event.preventDefault();
  };
  for (const type of PRESS_EVENTS) window.addEventListener(type, press, true);
  window.addEventListener('pointermove', move, { capture: true, passive: true });
  window.addEventListener('keydown', key);
  return () => {
    cancelAnimationFrame(frame);
    for (const type of PRESS_EVENTS) window.removeEventListener(type, press, true);
    window.removeEventListener('pointermove', move, { capture: true });
    window.removeEventListener('keydown', key);
  };
}

/**
 * Starts comments: loads the threads and follows changes (the `?comment=`
 * thread opens), handles comment mode on the page and the Shell's comment
 * commands. Returns a stop function.
 */
export function startComments(): () => void {
  const capability = maybeSession()?.comments ?? null;
  const stops: (() => void)[] = [];
  const open = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('comment');
  void pageComments.start(capability, open);
  stops.push(() => pageComments.stop());
  if (capability !== null) stops.push(watchPage());
  stops.push(
    useComments.subscribe((state, previous) => {
      if (state.on !== previous.on) {
        setCommenting(state.on);
        document.documentElement.toggleAttribute(MODE_ATTR, state.on);
        document.documentElement.toggleAttribute(HOST_MODE_ATTR, state.on);
        if (!state.on) {
          hover(null);
          pick(null);
        }
      }
      if (state.draft === null && previous.draft !== null) pick(null);
      if (state.on !== previous.on || state.threads !== previous.threads || state.listOpen !== previous.listOpen || state.available !== previous.available)
        reportToShell();
    }),
  );
  stops.push(
    onShellCommand((command) => {
      if (command.cmd === 'comments_mode') setCommentMode(command.on ?? !useComments.getState().on);
      else if (command.cmd === 'comments_list') useComments.getState().setListOpen(command.open ?? !useComments.getState().listOpen);
    }),
  );
  reportToShell();
  return () => {
    for (const stop of stops.reverse()) stop();
    hover(null);
    pick(null);
    setCommenting(false);
    document.documentElement.removeAttribute(MODE_ATTR);
    document.documentElement.removeAttribute(HOST_MODE_ATTR);
    setShellReport({ comments: undefined });
  };
}
