/**
 * Comment threads for any editor: the store (threads, comment mode, the
 * open card, the draft, the list), and the thread actions over the
 * `comments` capability.
 *
 * Editor-agnostic: what an anchor is,
 * how it is labelled, where it points the agent and how the editor shows it
 * are the {@link CommentsAdapter}'s. The editor hands the capability to
 * {@link CommentsController.start}.
 */

import { useCapability, type CommentAuthor, type CommentSendOptions, type CommentsCapability, type CommentThread, type JsonRecord, type Peer } from '@open-artifact/runtime';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { AGENT_KEY, foldName, MENTION_PEOPLE_LIMIT, mentionLimitText, peopleNamed, type MentionPerson } from './mentions.ts';
import type { AnchorState } from './pins.ts';

/**
 * Longest comment, in UTF-8 bytes of the trimmed text: claude.ai's comment boxes take as much. The boxes also set it
 * as their `maxLength` (UTF-16 units), so typing and pasting stop there, and a longer text in bytes (CJK, emoji) is
 * refused when it is sent, with the draft kept.
 */
export const COMMENT_TEXT_BYTES = 4096;

/** The stored anchor of a comment on the whole artifact (see {@link CommentsAdapter.wholeArtifact}). */
export const WHOLE_ARTIFACT = '';

/** What the default check says when a comment is over {@link COMMENT_TEXT_BYTES}. */
export const COMMENT_TOO_LONG = 'That comment is too long.';

/** Longest docs comment, in characters: the docs composer counts toward it. */
export const COMMENT_TEXT_MAX = 4000;

const utf8 = new TextEncoder();

/** The UTF-8 size of `text`, as {@link COMMENT_TEXT_BYTES} counts it. */
export function commentTextBytes(text: string): number {
  return utf8.encode(text).length;
}

/** What an editor tells the comments controller. `A` is its anchor type. */
export interface CommentsAdapter<A> {
  /** Shows a short message (a toast); default: nothing. */
  notify?(message: { title: string; description?: string }): void;
  /** Reads a stored anchor; anything unreadable should come back as a whole-document anchor. */
  parse(text: string): A;
  serialize(anchor: A): string;
  /** A short label of what the anchor names ("Button “Sign up” in Home"). */
  label(anchor: A): string;
  /** Location details stored with the thread for the agent. */
  location?(anchor: A): JsonRecord;
  /** How the anchor resolves now (default `ok`). */
  state?(anchor: A): AnchorState;
  /** What a card says about an anchor that is not where it was made (default: a generic sentence). */
  stateNote?(state: AnchorState): string | null;
  /** Brings a thread's anchor into view (page, camera); the card opens after it. */
  reveal?(anchor: A): void;
  /** The viewer may write comments (commenters and up). */
  canComment(): boolean;
  /** The viewer may hand threads to the agent (usually the owner, with an agent connected). */
  canSendToAgent(): boolean;
  /** The agent's name in toasts. */
  agentName?(): string;
  /** false: the agent is not woken while it idles, so the toast tells the person to message it. */
  agentWakesIdle?(): boolean | undefined;
  /** The viewer's name (the new comment's pin shows their initials; default `You`). */
  viewerName?(): string;
  /** People the editor knows besides those the host lists and the threads name (listed after the host's, before authors). */
  people?(): readonly MentionPerson[];
  /** Comment mode turned on or off (end text editing, pick the select tool…). */
  onModeChange?(on: boolean): void;
  /** What the document is called in messages (default `document`). */
  noun?: string;
  /** Most threads one document keeps (default 500). */
  maxThreads?: number;
  /**
   * Checks a message before it is sent: the text to send, or `undefined` to
   * send nothing (after telling the person why); the draft stays either way
   * until a send succeeds. Default: trimmed, and refused with
   * {@link COMMENT_TOO_LONG} past {@link COMMENT_TEXT_BYTES}.
   */
  checkText?(text: string): string | undefined;
  /** What the agent reads about an anchor, stored with a new thread. */
  detail?(anchor: A): string | undefined;
  /** The viewer may delete threads (default: anyone who may comment). */
  canRemove?(): boolean;
  /**
   * Hands a thread to the agent the editor's way (its own request tracking
   * and messages); resolves whether it was sent. Default: the capability's
   * `sendToAgent` and a "Sent to …" message.
   */
  sendToAgent?(thread: CommentThread, anchor: A): Promise<boolean>;
  /** Told of threads as the host hands them over: the list, every change and every write. */
  heard?(threads: readonly CommentThread[]): void;
  /** A new thread's card opens once it is saved (default: always); `sent`: it went to the agent too. */
  opensCreated?(sent: boolean): boolean;
  /**
   * The anchor of a comment on the whole artifact rather than a spot in it: it has no pin and is written from the
   * "All comments" panel. A thread stored with it, or with the empty string, is on the whole artifact. Without it the
   * panel has no composer.
   */
  wholeArtifact?(): A;
  /**
   * The type's pins show a comment set aside ({@link CommentsState.parked}) and take it up again when pressed. Only
   * then is a comment begun on the page set aside when a card or the panel's composer opens; without it the draft
   * just closes and its text goes on to the next one. Every type with {@link wholeArtifact} sets it.
   */
  parksDrafts?: boolean;
}

/** The comments store. */
export interface CommentsState<A> {
  available: boolean;
  threads: CommentThread[];
  /** Comment mode: presses on the surface start threads. */
  on: boolean;
  /** The thread list is open. */
  listOpen: boolean;
  /** The thread shown in a card. */
  active: string | null;
  /** A thread being written (its anchor chosen, no message yet). */
  draft: A | null;
  /** Show resolved threads (pins and list). */
  showResolved: boolean;
  /** The new-comment composer's "Send to agent" box (starts off; kept while the composer is moved to another spot). */
  sendNew: boolean;
  /** The new-comment composer's text (kept while it is moved to another spot). */
  draftText: string;
  /** Each thread's reply box: text and its "Send to agent" box (kept while the card closes and opens). */
  replies: Record<string, { text: string; send: boolean }>;
  /**
   * A comment begun on the page and set aside with words in it (a card or the panel's composer opened over it): drawn
   * as a draft pin, and pressing that takes it up again. While it waits, no other spot starts a comment.
   */
  parked: ParkedDraft<A> | null;
  /** The message being edited in a card, and whether its words differ from the saved ones. */
  editing: Editing | null;
  /** Writes on their way to the host, one key each: `new`, `reply:<thread>`, `edit:<message>`, `delete:<thread>`, `send`. */
  writing: string[];
  /** People the host knows on this artifact (who has it, then who is here now), once {@link CommentsController.followPeople} ran. */
  known: MentionPerson[];
  /** The viewer as the host names them (to leave them out of `@`), once known. */
  self: { id: string; name: string } | null;
  /**
   * A resolve or reopen the host has not answered yet. The thread already shows its new status; until the answer
   * comes, no other thread can be resolved or reopened and the thread menus wait.
   */
  statusChange: StatusChange | null;
  setOn(on: boolean): void;
  setListOpen(open: boolean): void;
  setActive(id: string | null): void;
  setDraft(draft: A | null): void;
  setShowResolved(show: boolean): void;
  setSendNew(send: boolean): void;
  setDraftText(text: string): void;
  setReply(id: string, reply: { text: string; send: boolean }): void;
  /** Starts or ends editing a message, or says whether its words changed. */
  setEditing(editing: Editing | null): void;
}

/** A page comment set aside: where it was, its words and its "Send to agent" box. */
export interface ParkedDraft<A> {
  anchor: A;
  text: string;
  send: boolean;
}

/** A message being edited: its thread, its "Send to agent" box, and whether its words differ from the saved ones. */
export interface Editing {
  thread: string;
  message: string;
  send: boolean;
  changed: boolean;
}

/** Why the panel's composer did not open: a write on its way, a comment being written, or an edit with changes. */
export type ComposeRefusal = 'posting' | 'writing' | 'editing';

/** A thread's status, set before the host has confirmed it. */
export interface StatusChange {
  id: string;
  status: CommentThread['status'];
}

/** What a menu says while a status change is on its way. */
export const WAIT_FOR_STATUS_CHANGE = 'Wait for the current change to finish.';

/** The threads as shown: the stored ones, with an unconfirmed status change already applied. */
export function withStatusChange(threads: CommentThread[], change: StatusChange | null): CommentThread[] {
  if (!change) return threads;
  return threads.map((thread) => (thread.id === change.id ? withStatus(thread, change.status) : thread));
}

function withStatus(thread: CommentThread, status: CommentThread['status'], resolvedBy?: CommentThread['resolvedBy']): CommentThread {
  if (thread.status === status && thread.resolvedBy === resolvedBy) return thread;
  const { resolvedBy: _, ...rest } = thread;
  return status === 'resolved' && resolvedBy ? { ...rest, status, resolvedBy } : { ...rest, status };
}

/** One editor's comments. */
export interface CommentsController<A> {
  readonly store: UseBoundStore<StoreApi<CommentsState<A>>>;
  readonly adapter: CommentsAdapter<A>;
  /** Loads the threads and keeps them current; `open` is a thread id to reveal (`?comment=`). */
  start(capability: CommentsCapability | null, open?: string | null): Promise<void>;
  /** Stops following the capability's changes. */
  stop(): void;
  capability(): CommentsCapability | null;
  canComment(): boolean;
  canSendToAgent(): boolean;
  /** The viewer may delete threads. */
  canRemove(): boolean;
  anchorOf(thread: Pick<CommentThread, 'anchor'>): A;
  /** The anchor of a new comment on the whole artifact, when the type has them (the panel's composer). */
  wholeArtifact(): A | null;
  /** The thread is on the whole artifact: no pin, nothing to bring into view. */
  isWhole(thread: Pick<CommentThread, 'anchor'>): boolean;
  /** The anchor is the whole artifact's. */
  isWholeAnchor(anchor: A): boolean;
  /**
   * Opens the composer for a comment on the whole artifact; resolves `null`, or why it stays shut while a write is on
   * its way or an edit has changes. A comment begun on the page is set aside when it has words in it (see
   * {@link CommentsState.parked}), and dropped when it has none.
   */
  composeWhole(): ComposeRefusal | null;
  /** Why the panel's composer would not open now (the same order the refusal is said in), or `null`. */
  composeRefusal(): ComposeRefusal | null;
  labelOf(anchor: A): string;
  stateOf(anchor: A): AnchorState;
  stateNote(state: AnchorState | undefined): string | null;
  /** Starts a thread (`send`: and hands it to the agent; `to`: whom it names); resolves whether it was saved. */
  create(anchor: A, text: string, options?: MessageOptions): Promise<boolean>;
  /** Replies to a thread (`send`: and hands it to the agent; a resolved thread reopens); resolves whether it was saved. */
  reply(id: string, text: string, options?: MessageOptions): Promise<boolean>;
  /** Changes the text of one of the viewer's own messages (`send`: and hands the thread to the agent); resolves whether it was saved. */
  edit(id: string, messageId: string, text: string, options?: MessageOptions): Promise<boolean>;
  /** The viewer wrote this and may still change it. */
  canEdit(author: CommentAuthor): boolean;
  /** Starts following who the host says has the artifact and who is here (once; the `@` list asks for it when it first opens). */
  followPeople(): void;
  /** Whom `@` can name besides the agent, in the order the list shows them (the viewer included: the list leaves them out). */
  mentionPeople(): MentionPerson[];
  /**
   * Resolves or reopens a thread. It shows the new status at once (a resolved card closes); if the host refuses, it
   * goes back and its card reopens. One at a time: ignored while another change is waiting for the host.
   */
  resolve(id: string, resolved: boolean): Promise<void>;
  remove(id: string, messageId?: string): Promise<void>;
  move(id: string, anchor: A): Promise<void>;
  /**
   * Hands a thread to the agent; resolves whether it was sent. `parts`: the person's words in the newest message and
   * what it is on, for an app to show (the host checks them).
   */
  sendToAgent(id: string, parts?: Pick<CommentSendOptions, 'userText' | 'selectionSnapshot'>): Promise<boolean>;
  sendAllToAgent(): Promise<void>;
  /** Whether a thread has something from a person the agent has not been handed (open, a person's message, not sent or answered since). */
  canSendThread(thread: CommentThread): boolean;
  reveal(thread: CommentThread): void;
  /** Shows a thread where it is: comment mode on, its anchor in view, its card open (the "All comments" panel's rows). */
  show(thread: CommentThread): void;
  /** The viewer's name. */
  viewerName(): string;
}

/** How a message is sent: `send` hands its thread to the agent; `to` is whom it names (`agent` for the agent). */
export interface MessageOptions {
  send?: boolean;
  to?: readonly string[];
}

/** Under a thread sent to the agent that has not taken it yet; one that is not woken while it idles needs a message. */
export function queuedNote(agent: { name: string; wakesIdle?: boolean }): string {
  return agent.wakesIdle === false ? `${agent.name} gets this on its next turn: send it a message to start one` : 'Waiting for the agent';
}

/** The toast after a thread goes to the agent; one that is not woken while it idles needs a message from the person. */
export function sentNotice(name: string, wakesIdle: boolean | undefined): { title: string; description?: string } {
  return wakesIdle === false
    ? { title: `Sent to ${name}`, description: `${name} gets it on its next turn. If it is idle, send it a message there to start one.` }
    : { title: `Sent to ${name}` };
}

export function openCount(threads: readonly CommentThread[]): number {
  return threads.filter((t) => t.status === 'open').length;
}

export function openMessageCount(threads: readonly CommentThread[]): number {
  return threads.reduce((sum, t) => (t.status === 'open' ? sum + t.messages.length : sum), 0);
}

/** The default note of a card whose anchor moved away. */
function defaultStateNote(state: AnchorState | undefined): string | null {
  if (state === 'detached') return 'What this was on is gone; shown on what held it.';
  if (state === 'orphaned') return 'What this was on has been deleted.';
  return null;
}

/** Creates an editor's comments controller. */
export function createComments<A>(adapter: CommentsAdapter<A>): CommentsController<A> {
  const maxThreads = adapter.maxThreads ?? 500;
  const noun = adapter.noun ?? 'document';
  const notify = (message: { title: string; description?: string }): void => adapter.notify?.(message);
  let capability: CommentsCapability | null = null;
  let unfollow: (() => void) | undefined;
  /** Bumped by {@link CommentsController.stop}: a list arriving after it is dropped. */
  let generation = 0;

  /** The whole artifact's stored anchor, when the type has one. */
  const wholeKey = (): string | null => (adapter.wholeArtifact ? adapter.serialize(adapter.wholeArtifact()) : null);
  /** Whole-artifact threads: only a type that has them reads the empty string (or its own anchor for them) so. */
  const isWholeKey = (key: string): boolean => Boolean(adapter.wholeArtifact) && (key === WHOLE_ARTIFACT || key === wholeKey());
  const isWhole = (thread: Pick<CommentThread, 'anchor'>): boolean => isWholeKey(thread.anchor);
  const isWholeAnchor = (anchor: A): boolean => isWholeKey(adapter.serialize(anchor));
  const sameSpot = (a: A, b: A): boolean => adapter.serialize(a) === adapter.serialize(b);

  const store = create<CommentsState<A>>()((set, get) => ({
    available: false,
    threads: [],
    on: false,
    listOpen: false,
    active: null,
    draft: null,
    showResolved: false,
    sendNew: false,
    draftText: '',
    replies: {},
    parked: null,
    editing: null,
    writing: [],
    known: [],
    self: null,
    statusChange: null,
    setOn(on) {
      set({ on, draft: null });
      adapter.onModeChange?.(on);
    },
    setListOpen(listOpen) {
      set({ listOpen });
    },
    setActive(active) {
      const state = get();
      const panel = state.draft !== null && isWholeAnchor(state.draft);
      if (active !== null && active !== state.active) {
        // Changes being edited in another card, or words in the panel's composer, hold the card where it is.
        if (state.editing?.changed && state.editing.thread !== active) return;
        if (panel && state.draftText.trim() !== '') return;
      }
      // A comment begun on the page with words in it is set aside for later; the panel's composer, empty, just closes.
      const page = state.draft !== null && !panel ? state.draft : null;
      const parks = Boolean(adapter.parksDrafts) && active !== null && page !== null && state.draftText.trim() !== '';
      set({
        active,
        draft: null,
        ...(state.editing && state.editing.thread !== active ? { editing: null } : {}),
        ...(parks ? { parked: { anchor: page, text: state.draftText, send: state.sendNew } } : {}),
        ...(parks || panel ? { draftText: '', sendNew: false } : {}),
      });
    },
    setDraft(draft) {
      const state = get();
      // Dropped: its text and box go too.
      if (draft === null) return set({ draft, active: null, editing: null, draftText: '', sendNew: false });
      const panel = state.draft !== null && isWholeAnchor(state.draft);
      if (isWholeAnchor(draft)) {
        // The panel's composer: a comment begun on the page is set aside when it has words in it.
        const page = state.draft !== null && !panel ? state.draft : null;
        const parks = Boolean(adapter.parksDrafts) && page !== null && state.draftText.trim() !== '';
        // Where nothing would show it set aside, its words go on into the panel's composer.
        const carries = page !== null && !adapter.parksDrafts;
        return set({
          draft,
          active: null,
          editing: null,
          ...(panel || carries ? {} : { draftText: '', sendNew: false }),
          ...(parks ? { parked: { anchor: page, text: state.draftText, send: state.sendNew } } : {}),
        });
      }
      // A spot on the page: not while an edit has changes or the panel's composer has words in it.
      if (state.editing?.changed) return;
      if (panel && state.draftText.trim() !== '') return;
      const parked = state.parked;
      if (parked) {
        // The comment set aside comes back where it was; until it is sent or dropped, no other spot starts one.
        if (!sameSpot(parked.anchor, draft)) return;
        return set({ draft: parked.anchor, active: null, editing: null, parked: null, draftText: parked.text, sendNew: parked.send });
      }
      // Moved to another spot: its text and box stay. From the panel's empty composer: a fresh one.
      set({ draft, active: null, editing: null, ...(panel ? { draftText: '', sendNew: false } : {}) });
    },
    setShowResolved(showResolved) {
      set({ showResolved });
    },
    setSendNew(sendNew) {
      set({ sendNew });
    },
    setDraftText(draftText) {
      set({ draftText });
    },
    setReply(id, reply) {
      set((state) => ({ replies: { ...state.replies, [id]: reply } }));
    },
    setEditing(editing) {
      set({ editing });
    },
  }));

  /** Marks a write as on its way to the host until it settles. */
  const writing = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
    store.setState((state) => ({ writing: [...state.writing, key] }));
    try {
      return await work();
    } finally {
      store.setState((state) => {
        const at = state.writing.indexOf(key);
        return { writing: at < 0 ? state.writing : [...state.writing.slice(0, at), ...state.writing.slice(at + 1)] };
      });
    }
  };

  /** Anchors parsed once per stored string. */
  const parsed = new Map<string, A>();
  const anchorOf = (thread: Pick<CommentThread, 'anchor'>): A => {
    let anchor = parsed.get(thread.anchor);
    if (anchor === undefined) {
      anchor = adapter.parse(thread.anchor);
      if (parsed.size > 2000) parsed.clear();
      parsed.set(thread.anchor, anchor);
    }
    return anchor;
  };

  /** The threads as the host last told them, without an unconfirmed status change. */
  let stored: CommentThread[] = [];
  const keep = (threads: CommentThread[], also?: Partial<CommentsState<A>>): void => {
    stored = threads;
    const statusChange = also && 'statusChange' in also ? (also.statusChange ?? null) : store.getState().statusChange;
    // An edit whose message is gone ends with it.
    const editing = store.getState().editing;
    const gone = editing !== null && !threads.some((t) => t.id === editing.thread && t.messages.some((m) => m.id === editing.message));
    store.setState({ ...also, threads: withStatusChange(threads, statusChange), ...(gone ? { editing: null } : {}) });
  };

  const failed = (error: unknown): void => {
    notify({ title: 'The comment could not be saved', description: error instanceof Error ? error.message : String(error) });
  };
  const put = (thread: CommentThread): void => {
    keep(stored.map((t) => (t.id === thread.id ? thread : t)));
    adapter.heard?.([thread]);
  };
  const checkText = (text: string): string | undefined => {
    if (adapter.checkText) return adapter.checkText(text);
    const body = text.trim();
    if (!body) return undefined;
    if (commentTextBytes(body) > COMMENT_TEXT_BYTES) {
      notify({ title: COMMENT_TOO_LONG });
      return undefined;
    }
    return body;
  };
  const canComment = (): boolean => Boolean(capability) && adapter.canComment();
  const canSendToAgent = (): boolean => Boolean(capability) && adapter.canSendToAgent();
  const canRemove = (): boolean => Boolean(capability) && (adapter.canRemove ? adapter.canRemove() : adapter.canComment());
  /** `to` as the host takes it (none when empty), or `undefined` after saying why a message names too many people. */
  const recipients = (options: MessageOptions | undefined, verb: 'post' | 'save'): { to?: string[] } | undefined => {
    const to = [...new Set(options?.to ?? [])];
    if (peopleNamed(to) > MENTION_PEOPLE_LIMIT) {
      notify({ title: mentionLimitText(verb) });
      return undefined;
    }
    return to.length ? { to } : {};
  };
  let following = false;
  let unfollowPeople: (() => void) | undefined;

  const controller: CommentsController<A> = {
    store,
    adapter,
    async start(found, open) {
      if (!found) return;
      capability = found;
      const started = generation;
      store.setState({ available: true });
      try {
        const threads = await found.list();
        if (started !== generation) return;
        keep(threads);
        adapter.heard?.(threads);
      } catch {
        // The list arrives with the first change.
      }
      if (started !== generation) return;
      unfollow = found.onChange((threads) => {
        const active = store.getState().active;
        keep(threads, { active: active && threads.some((t) => t.id === active) ? active : null });
        adapter.heard?.(threads);
      });
      const thread = open ? store.getState().threads.find((t) => t.id === open) : undefined;
      if (thread) controller.reveal(thread);
    },
    stop() {
      generation += 1;
      unfollow?.();
      unfollow = undefined;
      following = false;
      unfollowPeople?.();
      unfollowPeople = undefined;
    },
    capability: () => capability,
    canComment,
    canSendToAgent,
    canRemove,
    anchorOf,
    wholeArtifact: () => adapter.wholeArtifact?.() ?? null,
    isWhole,
    isWholeAnchor,
    composeWhole() {
      const whole = adapter.wholeArtifact?.();
      if (!whole) return null;
      const refusal = controller.composeRefusal();
      if (refusal) return refusal;
      store.getState().setDraft(whole);
      return null;
    },
    composeRefusal() {
      const state = store.getState();
      if (state.writing.length > 0 || state.statusChange !== null) return 'posting';
      if (!state.editing?.changed) return null;
      return state.draft !== null ? 'writing' : 'editing';
    },
    labelOf: (anchor) => adapter.label(anchor),
    stateOf: (anchor) => (isWholeAnchor(anchor) ? 'ok' : (adapter.state?.(anchor) ?? 'ok')),
    stateNote: (state) => (adapter.stateNote ? adapter.stateNote(state ?? 'ok') : defaultStateNote(state)),
    async create(anchor, text, options) {
      if (!capability) return false;
      const body = checkText(text);
      if (!body) return false;
      const named = recipients(options, 'post');
      if (!named) return false;
      if (store.getState().threads.length >= maxThreads) {
        notify({ title: `This ${noun} already has ${maxThreads} comments` });
        return false;
      }
      const cap = capability;
      try {
        const detail = adapter.detail?.(anchor);
        const thread = await writing('new', () => cap.create({
          anchor: adapter.serialize(anchor),
          label: adapter.label(anchor),
          ...(detail !== undefined ? { detail } : {}),
          location: adapter.location?.(anchor) ?? {},
          text: body,
          ...named,
        }));
        const sends = Boolean(options?.send) && canSendToAgent();
        keep(stored.some((t) => t.id === thread.id) ? stored : [...stored, thread], {
          draft: null,
          draftText: '',
          sendNew: false,
          active: adapter.opensCreated?.(sends) === false ? null : thread.id,
        });
        adapter.heard?.([thread]);
        if (sends) await controller.sendToAgent(thread.id);
        return true;
      } catch (error) {
        failed(error);
        return false;
      }
    },
    async reply(id, text, options) {
      if (!capability) return false;
      const body = checkText(text);
      if (!body) return false;
      const named = recipients(options, 'post');
      if (!named) return false;
      const cap = capability;
      try {
        const thread = await writing(`reply:${id}`, async () => {
          const posted = await (named.to ? cap.reply(id, body, named) : cap.reply(id, body));
          // A reply to a resolved thread reopens it.
          return posted.status === 'resolved' ? cap.setResolved(id, false) : posted;
        });
        put(thread);
        store.setState((state) => {
          const { [id]: _, ...replies } = state.replies;
          return { replies };
        });
        if (options?.send && canSendToAgent()) await controller.sendToAgent(id);
        return true;
      } catch (error) {
        failed(error);
        return false;
      }
    },
    async edit(id, messageId, text, options) {
      if (!capability) return false;
      const body = checkText(text);
      if (!body) return false;
      const named = recipients(options, 'save');
      if (!named) return false;
      const cap = capability;
      try {
        put(await writing(`edit:${messageId}`, () => cap.edit(id, messageId, body, { to: named.to ?? [] })));
        if (options?.send && canSendToAgent()) await controller.sendToAgent(id);
        return true;
      } catch (error) {
        failed(error);
        return false;
      }
    },
    canEdit: (author) => canComment() && author.kind === 'person' && author.name === controller.viewerName(),
    followPeople() {
      if (following) return;
      following = true;
      void followRoom(store, () => !following).then((stop) => {
        if (following) unfollowPeople = stop;
        else stop();
      });
    },
    mentionPeople() {
      const { known, threads } = store.getState();
      const out: MentionPerson[] = [...known, ...(adapter.people?.() ?? [])];
      const named: MentionPerson[] = [];
      for (const thread of threads) {
        for (const message of thread.messages) {
          if (message.author.kind === 'person' && message.author.name) out.push({ key: message.author.name, name: message.author.name });
          for (const key of message.to ?? []) if (key !== AGENT_KEY) named.push({ key, name: key });
        }
      }
      return [...out, ...named];
    },
    async resolve(id, resolved) {
      if (!capability) return;
      const state = store.getState();
      const status = resolved ? 'resolved' : 'open';
      const thread = state.threads.find((t) => t.id === id);
      if (!thread || state.statusChange || thread.status === status) return;
      const closes = resolved && state.active === id && !state.showResolved;
      keep(stored, { statusChange: { id, status }, ...(closes ? { active: null } : {}) });
      try {
        const answer = await capability.setResolved(id, resolved);
        // Only the status is taken from the answer: a change heard meanwhile may be newer in everything else.
        keep(
          stored.map((t) => (t.id === id ? withStatus(t, answer.status, answer.resolvedBy) : t)),
          { statusChange: null },
        );
        adapter.heard?.([answer]);
      } catch (error) {
        keep(stored, { statusChange: null });
        failed(error);
        const now = store.getState();
        if (closes && now.active === null && now.draft === null && stored.some((t) => t.id === id)) store.setState({ active: id });
      }
    },
    async remove(id, messageId) {
      if (!capability || (adapter.canRemove && !adapter.canRemove())) return;
      const cap = capability;
      try {
        await writing(`delete:${messageId ?? id}`, () => cap.remove(id, messageId));
        if (!messageId) keep(stored.filter((t) => t.id !== id), { active: store.getState().active === id ? null : store.getState().active });
      } catch (error) {
        failed(error);
      }
    },
    async move(id, anchor) {
      if (!capability) return;
      try {
        put(await capability.move(id, adapter.serialize(anchor), adapter.location?.(anchor)));
      } catch (error) {
        failed(error);
      }
    },
    async sendToAgent(id, parts) {
      if (!capability || !canSendToAgent()) return false;
      const thread = adapter.sendToAgent ? store.getState().threads.find((t) => t.id === id) : undefined;
      const send = adapter.sendToAgent;
      if (send) return thread ? writing('send', () => send(thread, anchorOf(thread))) : false;
      const cap = capability;
      try {
        put(await writing('send', () => (parts?.userText || parts?.selectionSnapshot ? cap.sendToAgent(id, parts) : cap.sendToAgent(id))));
        notify(sentNotice(adapter.agentName?.() || 'the agent', adapter.agentWakesIdle?.()));
        return true;
      } catch (error) {
        failed(error);
        return false;
      }
    },
    async sendAllToAgent() {
      if (!capability || !canSendToAgent()) return;
      const open = store.getState().threads.filter((t) => controller.canSendThread(t));
      if (!open.length) return;
      // All at once: the host merges what reaches it within a short window into one message, so the agent gets
      // every thread in one turn. One after another, each would wait out the window and arrive (or queue) alone.
      const send = adapter.sendToAgent;
      if (send) {
        await writing('send', () => Promise.all(open.map((thread) => send(thread, anchorOf(thread)))));
        return;
      }
      const cap = capability;
      const results = await writing('send', () => Promise.allSettled(open.map((thread) => cap.sendToAgent(thread.id))));
      let sent = 0;
      for (const result of results) {
        if (result.status === 'fulfilled') {
          put(result.value);
          sent++;
        }
      }
      if (sent) notify(sentNotice(adapter.agentName?.() || 'the agent', adapter.agentWakesIdle?.()));
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failure) failed(failure.reason);
    },
    canSendThread(thread) {
      if (thread.status !== 'open') return false;
      const last = thread.messages.at(-1);
      if (!last || last.author.kind !== 'person') return false;
      // Not sent yet, or the agent answered and a person wrote since.
      return !thread.agent || thread.agent.status === 'replied';
    },
    reveal(thread) {
      if (!isWhole(thread)) adapter.reveal?.(anchorOf(thread));
      store.getState().setActive(thread.id);
    },
    show(thread) {
      const state = store.getState();
      if (!state.on) state.setOn(true);
      if (thread.status === 'resolved' && !store.getState().showResolved) store.getState().setShowResolved(true);
      controller.reveal(thread);
    },
    viewerName: () => adapter.viewerName?.() || 'You',
  };
  return controller;
}

/** A peer is someone the `@` list names when it is a person with a name. */
const personOf = (peer: Peer): MentionPerson | null => (peer.kind === 'person' && peer.name.trim() ? { key: peer.name, name: peer.name, id: peer.id } : null);

/**
 * Follows the room: who has the artifact (asked once: its owner first) and who is here now, into the store's `known`;
 * and who the viewer is, into `self`. Resolves a stop function. Without a room there is no one to add.
 */
async function followRoom<A>(store: UseBoundStore<StoreApi<CommentsState<A>>>, stopped: () => boolean): Promise<() => void> {
  const [room, user] = await Promise.all([useCapability('room'), useCapability('user')]);
  const me = await user?.me().catch(() => null);
  if (me) store.setState({ self: { id: me.id, name: me.name } });
  if (!room || stopped()) return () => {};
  const [selfPeer, members, peers] = await Promise.all([
    room.self().catch(() => ''),
    room.participants ? room.participants().catch(() => []) : Promise.resolve([]),
    room.peers().catch((): Peer[] => []),
  ]);
  const listed: MentionPerson[] = [...members]
    .sort((a, b) => Number(b.owner === true) - Number(a.owner === true))
    .filter((member) => member.name.trim())
    .map((member) => ({ key: member.name, name: member.name, id: member.id }));
  const update = (present: readonly Peer[]): void => {
    const here = present.filter((peer) => peer.id !== selfPeer).map(personOf).filter((person): person is MentionPerson => person !== null);
    const seen = new Set<string>();
    const known = [...listed, ...here].filter((person) => {
      const key = foldName(person.key);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    store.setState({ known });
  };
  update(peers);
  return room.onPeers(update);
}
