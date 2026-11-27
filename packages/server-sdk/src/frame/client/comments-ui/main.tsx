/**
 * The frame shell's comment views: the editor kit's pins, composer, thread
 * card and list (`@open-artifact/editor-kit/react`), the same as every
 * editor's, drawn over a frame-host page. Built into `client/comments.js`
 * and `comments.css` (vite.frame.config.ts); the shell (shell.ts, a plain
 * script) loads it first and calls {@link mount}.
 *
 *
 * pin goes (`placed`, viewport points; the composer's under `composer`) and
 * this layer draws the pins, the open thread's card and the new comment's
 * composer beside them, the edge tabs for pins off screen and the list. The
 * shell keeps the data and the page protocol: it calls the `comments`
 * capability, hands threads to the page, asks the page to reveal a thread
 * and lets a page take "Send to agent" itself. This module only draws: a
 * comments controller (`createComments`) over a capability made of the
 * shell's calls, whose threads the shell pushes in ({@link FrameCommentsUi.setThreads}).
 *
 * Comment text, labels and author names are untrusted: rendered as text.
 */

import './styles.css';
import { StrictMode, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { COMMENT_TEXT_BYTES, COMMENT_TOO_LONG, commentTextBytes, createComments, type CommentsController, type PinPlace } from '@open-artifact/editor-kit';
import { AllComments, CommentPins, CommentPopover, CommentsButton, CommentsLayer, ThreadCard, type AgentBadge } from '@open-artifact/editor-kit/react';
import type { CommentsCapability, CommentThread } from '@open-artifact/runtime';

/** A thread as the shell holds it (the page's shape). */
export interface PageThread {
  id: string;
  anchor: unknown;
  label: string;
  detail?: string;
  resolved: boolean;
  agent: { status: string } | null;
  messages: { id: string; author?: { kind?: string; name?: string }; text: string; at: string }[];
}

type Point = { x: number; y: number } | null | undefined;

/** What the shell does for the views. */
export interface FrameCommentsBridge {
  /** Calls the `comments` capability. */
  cap(method: string, arg: Record<string, unknown>): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Hands a thread, or a new comment, to the agent (the page may take it itself). */
  sendToAgent(payload: Record<string, unknown>): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Reloads the threads (they come back through {@link FrameCommentsUi.setThreads}). */
  refresh(): Promise<void>;
  agent(): AgentBadge;
  /** The thread shown in a card changed (the page marks its pin). */
  activeChanged(id: string | null): void;
  /** The list was opened or closed from the views (its own button, the launcher). */
  listChanged(open: boolean): void;
  /** Comment mode was turned on or off from the views (a list row, an edge tab, the launcher). */
  modeChanged(on: boolean): void;
  /** The composer of a new comment opened or closed. */
  composingChanged(open: boolean): void;
  /** Asks the page to bring a thread's anchor into view. */
  reveal(id: string): void;
  /** A pin was dragged to a viewport point: the page says what is there and the thread moves. */
  move?(id: string, at: { x: number; y: number }): void;
  toast(text: string): void;
}

/** How the views are mounted. */
export interface FrameCommentsOptions {
  
  launcher?: boolean;
}

/** What the shell drives. */
export interface FrameCommentsUi {
  setThreads(threads: PageThread[]): void;
  /** Where the page puts each thread's pin, and the composer's (`composer`), in viewport points. */
  setPlaced(map: Record<string, Point>): void;
  /** Opens the composer of a new thread at `at`. */
  compose(anchor: unknown, at: Point, label?: string, detail?: string): void;
  /** Opens a thread's card; returns whether it exists. */
  openThread(id: string, at: Point): boolean;
  /** Reveals a thread (list rows, `?comment=`): comment mode on, the page shows it, its card opens. */
  show(id: string): boolean;
  /** Closes the card or composer. */
  close(): void;
  /** A press outside the views (in the page, outside comment mode): the card closes, and an empty composer. */
  outsidePress(): void;
  setList(open: boolean): void;
  /** Comment mode, as the shell has it (does not call back). */
  setMode(on: boolean): void;
  /** The page draws its own comments button: the launcher stays hidden. */
  setPageButton(drawn: boolean): void;
  /** Pins can be dragged (the page moves threads). */
  setMovable(movable: boolean): void;
  /** The thread in a card. */
  active(): string | null;
  /** A card or composer is open. */
  open(): boolean;
  /** The composer's typed text, or null when no composer is open. */
  draftText(): string | null;
  /** Where the composer is (viewport point), while it is open. */
  draftPoint(): Point;
}

/** What a frame thread is on: the page's own anchor, with the label and detail it gave (and the thread it is of). */
interface FrameAnchor {
  value: unknown;
  label: string;
  detail?: string;
  /** The thread whose anchor this is (none for a new comment's). */
  id?: string;
}

/** What a comment on the whole page is on: the empty anchor, as the shell stores it. */
const WHOLE_PAGE: FrameAnchor = { value: '', label: 'Whole artifact' };

/** The shell's pixels are the page's viewport pixels: no camera. */
const CAMERA = { x: 0, y: 0, zoom: 1 };

/** The window's size, kept current. */
function useWindowSize(): { width: number; height: number } {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const update = (): void => setSize(read());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return size;
}

/** A page thread in the runtime's shape (its anchor carries the page's anchor, label and the thread id). */
function toThread(t: PageThread): CommentThread {
  return {
    id: t.id,
    // One on the whole page keeps the empty anchor, so the controller knows it.
    anchor: t.anchor === '' ? '' : JSON.stringify({ v: t.anchor ?? null, l: t.label ?? '', ...(t.detail ? { d: t.detail } : {}), i: t.id }),
    label: t.label ?? '',
    location: {},
    status: t.resolved ? 'resolved' : 'open',
    ...(t.agent && ['pending', 'delivered', 'replied'].includes(t.agent.status) ? { agent: { status: t.agent.status as 'pending' | 'delivered' | 'replied' } } : {}),
    messages: t.messages.map((m) => ({ id: m.id, author: { kind: m.author?.kind === 'agent' ? 'agent' : 'person', name: m.author?.name ?? '' }, text: m.text, at: m.at })),
  };
}

function parseFrameAnchor(text: string): FrameAnchor {
  if (text === '') return WHOLE_PAGE;
  try {
    const raw = JSON.parse(text) as { v?: unknown; l?: unknown; d?: unknown; i?: unknown };
    return {
      value: raw.v ?? null,
      label: typeof raw.l === 'string' ? raw.l : '',
      ...(typeof raw.d === 'string' ? { detail: raw.d } : {}),
      ...(typeof raw.i === 'string' ? { id: raw.i } : {}),
    };
  } catch {
    return { value: null, label: '' };
  }
}

const finite = (p: Point): p is { x: number; y: number } => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** Mounts the views in `host` (an empty element over the page). */
export function mount(host: HTMLElement, bridge: FrameCommentsBridge, options: FrameCommentsOptions = {}): FrameCommentsUi {
  let threads: CommentThread[] = [];
  const listeners = new Set<(threads: CommentThread[]) => void>();
  const latest = async (id: string): Promise<CommentThread> => {
    await bridge.refresh();
    const thread = threads.find((t) => t.id === id);
    if (!thread) throw new Error('The thread is gone.');
    return thread;
  };

  // The capability the controller calls: the shell's calls, then a reload.
  const capability: CommentsCapability = {
    list: async () => threads,
    async create(input) {
      const anchor = parseFrameAnchor(input.anchor);
      const out = await bridge.cap('create', { anchor: anchor.value, text: input.text, label: input.label, ...(input.detail ? { detail: input.detail } : {}) });
      return latest(String(out.threadId));
    },
    async reply(id, text) {
      await bridge.cap('reply', { threadId: id, text });
      return latest(id);
    },
    edit: () => Promise.reject(new Error('Editing a comment is not available here.')),
    react: () => Promise.reject(new Error('Reactions are not available here.')),
    async setResolved(id, resolved) {
      await bridge.cap('resolve', { threadId: id, resolved });
      return latest(id);
    },
    async move(id, anchor) {
      await bridge.cap('move', { threadId: id, anchor: parseFrameAnchor(anchor).value });
      return latest(id);
    },
    async remove(id, messageId) {
      await bridge.cap('delete', { threadId: id, ...(messageId ? { commentId: messageId } : {}) });
      await bridge.refresh();
    },
    async sendToAgent(id) {
      await bridge.sendToAgent({ threadId: id });
      return latest(id);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  /** Mode changes the shell made: not echoed back to it. */
  let quiet = false;
  const base = createComments<FrameAnchor>({
    notify: (message) => bridge.toast(message.description ? `${message.title}: ${message.description}` : message.title),
    parse: parseFrameAnchor,
    serialize: (anchor) => JSON.stringify({ v: anchor.value ?? null, l: anchor.label, ...(anchor.detail ? { d: anchor.detail } : {}) }),
    label: (anchor) => anchor.label || 'Comment',
    detail: (anchor) => anchor.detail,
    canComment: () => true,
    canSendToAgent: () => bridge.agent().available,
    agentName: () => bridge.agent().name,
    agentWakesIdle: () => bridge.agent().wakesIdle,
    // A list row or an edge tab: the page brings the thread into view, then its card opens at its pin.
    reveal: (anchor) => {
      if (anchor.id) bridge.reveal(anchor.id);
    },
    onModeChange: (on) => {
      if (!quiet) bridge.modeChanged(on);
    },
    noun: 'page',
    // The whole page: no pin; written from the "All comments" panel.
    wholeArtifact: () => WHOLE_PAGE,
    parksDrafts: true,
  });
  const comments: CommentsController<FrameAnchor> = {
    ...base,
    // "Send to agent" on a new comment is one call, which a page may take itself.
    async create(anchor, text, options) {
      if (!options?.send || !base.canSendToAgent()) return base.create(anchor, text, options);
      const body = text.trim();
      if (!body) return false;
      // The controller's own check, which this path goes around: refused past the limit, the draft kept.
      if (commentTextBytes(body) > COMMENT_TEXT_BYTES) {
        bridge.toast(COMMENT_TOO_LONG);
        return false;
      }
      const point = placed.composer ?? draftAt;
      try {
        const out = (await bridge.sendToAgent({ anchor: anchor.value, text: body, label: anchor.label, ...(anchor.detail ? { detail: anchor.detail } : {}) })) as {
          status?: string;
          threadId?: string;
          reply?: string;
        } | null;
        base.store.getState().setDraft(null);
        await bridge.refresh();
        if (out?.status === 'handled') bridge.toast(out.reply || `Sent to ${bridge.agent().name}.`);
        else if (out?.threadId) {
          
          cardPoints.set(out.threadId, point);
          base.store.getState().setActive(out.threadId);
        } else bridge.toast(`Sent to ${bridge.agent().name}.`);
        return true;
      } catch (error) {
        bridge.toast((error as Error)?.message || 'Could not save the comment.');
        return false;
      }
    },
  };
  // `start` lists before it follows changes: threads the shell hands in meanwhile (right after mount) are passed on once it follows.
  void base.start(capability).then(() => {
    for (const l of listeners) l(threads);
  });

  // Where the composer and cards sit when the page placed no pin for them; and a comment set aside, where it was.
  let draftAt: Point = null;
  let parkedAt: Point = null;
  const cardPoints = new Map<string, Point>();
  let placed: Record<string, Point> = {};
  let pageButton = false;
  let movable = false;
  let version = 0;
  const viewListeners = new Set<() => void>();
  const bump = (): void => {
    version += 1;
    for (const l of viewListeners) l();
  };

  let lastActive: string | null = null;
  base.store.subscribe((state, prev) => {
    if (state.parked && !prev.parked) parkedAt = placed.composer ?? draftAt;
    // A thread just written opens its card where the composer was.
    if (state.active && prev.draft && !state.draft && !cardPoints.has(state.active)) cardPoints.set(state.active, placed.composer ?? draftAt);
    if (state.active !== lastActive) {
      lastActive = state.active;
      bridge.activeChanged(state.active);
    }
    if ((prev.draft === null) !== (state.draft === null)) {
      if (state.draft === null) draftAt = null;
      bridge.composingChanged(state.draft !== null);
    }
    if (prev.listOpen !== state.listOpen) bridge.listChanged(state.listOpen);
    // Taken up again: its composer opens where it was.
    if (prev.parked && !state.parked && state.draft === prev.parked.anchor) draftAt = parkedAt;
  });

  function Views() {
    useSyncExternalStore(
      (l) => {
        viewListeners.add(l);
        return () => viewListeners.delete(l);
      },
      () => version,
    );
    const store = comments.store;
    const active = store((s) => s.active);
    const listOpen = store((s) => s.listOpen);
    const all = store((s) => s.threads);
    const agentNow = bridge.agent();
    const agent = useMemo((): AgentBadge => ({ available: agentNow.available, name: agentNow.name, wakesIdle: agentNow.wakesIdle }), [agentNow.available, agentNow.name, agentNow.wakesIdle]);
    const viewport = useWindowSize();
    const place = useCallback(
      (anchor: FrameAnchor): PinPlace | null => {
        // A thread's pin is where the page put it; the open one, until then, where its card was opened.
        const at = anchor === store.getState().parked?.anchor
          ? parkedAt
          : anchor.id
          ? (placed[anchor.id] ?? (anchor.id === active ? cardPoints.get(anchor.id) : null))
          : 'composer' in placed
            ? placed.composer
            : (draftAt ?? { x: viewport.width / 2, y: 80 });
        return finite(at) ? { world: at, state: 'ok' } : null;
      },
      // `version` changes whenever placed, draftAt or cardPoints do.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [version, viewport.width, active],
    );
    // An open thread with no place on the page: in the list alone while it is open, else a card near the top (one on the
    // whole page opens by the list).
    const found = active ? all.find((t) => t.id === active) : undefined;
    const unplaced = found && !comments.isWhole(found) && !place(comments.anchorOf(found)) && !listOpen ? found : undefined;
    const close = (): void => {
      const state = store.getState();
      state.setDraft(null);
      state.setActive(null);
    };
    return (
      <>
        <CommentPins comments={comments} camera={CAMERA} viewport={viewport} place={place} agent={agent} revision={version} movable={movable} onMove={bridge.move} />
        {unplaced ? (
          <CommentsLayer mark="data-comment-layer" onEscape={() => (close(), true)}>
            <CommentPopover key={unplaced.id} corner={{ x: viewport.width / 2 - 165, y: 80 }} viewport={viewport} onEscape={close}>
              {(maxHeight) => <ThreadCard comments={comments} agent={agent} thread={unplaced} maxHeight={maxHeight} />}
            </CommentPopover>
          </CommentsLayer>
        ) : null}
        <AllComments comments={comments} agent={agent} top={12} hint="Turn on commenting and click the page." />
        {options.launcher && !pageButton ? (
          <div className="frame-comments-launcher">
            <CommentsButton comments={comments} side="top" />
          </div>
        ) : null}
      </>
    );
  }

  createRoot(host).render(
    <StrictMode>
      <Views />
    </StrictMode>,
  );

  const quietly = (fn: () => void): void => {
    quiet = true;
    try {
      fn();
    } finally {
      quiet = false;
    }
  };

  return {
    setThreads(next) {
      threads = next.map(toThread);
      for (const l of listeners) l(threads);
    },
    setPlaced(map) {
      placed = map;
      bump();
    },
    compose(anchor, at, label, detail) {
      draftAt = at;
      comments.store.getState().setDraft({ value: anchor, label: label || '', ...(detail ? { detail } : {}) });
      bump();
    },
    openThread(id, at) {
      if (!threads.some((t) => t.id === id)) return false;
      cardPoints.set(id, at);
      comments.store.getState().setActive(id);
      bump();
      return true;
    },
    show(id) {
      const thread = comments.store.getState().threads.find((t) => t.id === id) ?? threads.find((t) => t.id === id);
      if (!thread) return false;
      comments.show(thread);
      return true;
    },
    close() {
      const state = comments.store.getState();
      state.setDraft(null);
      state.setActive(null);
    },
    outsidePress() {
      const state = comments.store.getState();
      if (state.active) state.setActive(null);
      if (state.draft !== null && !state.draftText.trim()) state.setDraft(null);
    },
    setList(open) {
      comments.store.getState().setListOpen(open);
    },
    setMode(on) {
      if (comments.store.getState().on === on) return;
      // The store only: setOn would drop the draft and call back into the shell.
      quietly(() => comments.store.setState({ on }));
    },
    setPageButton(drawn) {
      if (pageButton === drawn) return;
      pageButton = drawn;
      bump();
    },
    setMovable(next) {
      if (movable === next) return;
      movable = next;
      bump();
    },
    active: () => comments.store.getState().active,
    open() {
      const state = comments.store.getState();
      return state.draft !== null || state.active !== null;
    },
    draftText() {
      const state = comments.store.getState();
      return state.draft === null ? null : state.draftText;
    },
    draftPoint: () => placed.composer ?? draftAt,
  };
}

declare global {
  interface Window {
    __openArtifactFrameComments?: { mount: typeof mount };
  }
}

window.__openArtifactFrameComments = { mount };
