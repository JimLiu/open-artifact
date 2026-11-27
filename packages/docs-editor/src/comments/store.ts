/**
 * The doc's comments: the shared controller (threads as the host hands them over, the open card, reply drafts), and
 * what only the doc has: the composer of a new thread, the message being edited, the list's filter, where each thread
 * of the open tab hangs, and who can be @mentioned.
 */
import type { AgentStatus, CommentThread, JsonRecord } from '@open-artifact/runtime';
import { createComments, type CommentsController } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import { create } from 'zustand';
import { maybeSession } from '../app/session.ts';
import { getDocs } from '../app/store.ts';
import { type DocAnchor, anchorLocation, parseAnchor, serializeAnchor } from './anchor.ts';
import { AGENT_KEY, type MentionCandidate } from './mentions.ts';

/** The pseudo thread id of the composer's words, while a new thread is written. */
export const NEW_THREAD = '__new';

/** Which threads the list shows; `mine`: the open ones the viewer wrote in or is @mentioned in. */
export type CommentFilter = 'open' | 'mine' | 'resolved' | 'all';

/** A new thread being written: what it is on, and its text. */
export interface Composer {
  anchor: DocAnchor;
  label: string;
  detail?: string;
  location: JsonRecord;
  text: string;
  /** The selection was too long: the thread hangs on its beginning. */
  clamped?: boolean;
  /** "Send to agent" as the person set it for this comment; unset, it is their last choice ({@link rememberedSend}). */
  send?: boolean;
  /** Opened by Reply on this suggestion's card. */
  suggestion?: string;
}

const SEND_KEY = 'oa-docs.comments.sendToAgent';

/** Whether a new comment starts with "Send to agent" checked: the person's last choice, checked until they make one. */
export function rememberedSend(): boolean {
  try {
    const kept = localStorage.getItem(SEND_KEY);
    return kept === null ? true : kept === '1';
  } catch {
    return true;
  }
}

/** Keeps the person's own choice of "Send to agent" for their next comment. */
export function rememberSend(send: boolean): void {
  try {
    localStorage.setItem(SEND_KEY, send ? '1' : '0');
  } catch {
    // Storage blocked: the choice lasts this comment only.
  }
}

/** How a thread of the open tab hangs on it now. */
export type Hold = 'ok' | 'detached' | 'page';

/** Where a popup opens, kept as a box so it stays put when the element it opened from goes away. */
export interface PickerSpot {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface CommentUiState {
  composer: Composer | null;
  /** The message whose text is being changed. */
  editing: { thread: string; message: string } | null;
  filter: CommentFilter;
  /** Which of the open thread's places was clicked (`null`: its first range). */
  activePlace: string | null;
  /** The open tab, and how each of its threads hangs on it. */
  placed: { tab: string | null; holds: Record<string, Hold> };
  agent: AgentStatus | null;
  /** Other people on the doc now. */
  peers: string[];
  /** The selection toolbar's reaction picker, open where the toolbar was (in viewport pixels). */
  picker: PickerSpot | null;
}

export const useCommentUi = create<CommentUiState>(() => ({
  composer: null,
  editing: null,
  filter: 'open',
  activePlace: null,
  placed: { tab: null, holds: {} },
  agent: null,
  peers: [],
  picker: null,
}));

export const setCommentUi = useCommentUi.setState;

/** The viewer's name, which their messages carry. */
export const myName = (): string | null => maybeSession()?.viewer.name ?? getDocs().me?.name ?? null;

/** The viewer may write comments here. */
export const canComment = (): boolean => {
  const current = maybeSession();
  return !!current?.comments && current.canComment;
};

/** The viewer may delete anyone's comments. */
export const canRemoveAny = (): boolean => !!maybeSession()?.canRemoveComments;

/** The viewer may hand threads to the agent, and one is there. */
export const canAskAgent = (): boolean => {
  const current = maybeSession();
  const agent = useCommentUi.getState().agent;
  return !!current?.agent && current.canAsk && (agent?.available ?? false);
};

export const agentName = (): string => useCommentUi.getState().agent?.name || 'Agent';

export const docComments: CommentsController<DocAnchor> = createComments<DocAnchor>({
  notify: message => void toast.add(message),
  parse: parseAnchor,
  serialize: serializeAnchor,
  label: () => '',
  location: anchor => anchorLocation(anchor, null),
  canComment,
  canSendToAgent: canAskAgent,
  canRemove: canRemoveAny,
  agentName,
  agentWakesIdle: () => useCommentUi.getState().agent?.wakesIdle,
  viewerName: () => myName() ?? 'You',
  noun: 'doc',
});

export const useThreads = <T>(pick: (state: { threads: CommentThread[]; active: string | null }) => T): T => docComments.store(pick);

/** Puts a thread the host answered with in the list. */
export function putThread(thread: CommentThread): void {
  docComments.store.setState(state => ({
    threads: state.threads.some(item => item.id === thread.id) ? state.threads.map(item => (item.id === thread.id ? thread : item)) : [...state.threads, thread],
  }));
}

export function threadById(id: string): CommentThread | undefined {
  return docComments.store.getState().threads.find(thread => thread.id === id);
}

/** Opens a thread's card (`place`: which of its places was clicked). */
export function setActive(id: string | null, place: string | null = null): void {
  docComments.store.getState().setActive(id);
  setCommentUi({ activePlace: id ? place : null, ...(id ? { composer: null } : {}) });
}

/** Who a comment can @mention: the agent (for those who may ask it), then the people who took part or are here. */
export function mentionCandidates(threads: readonly CommentThread[], peers: readonly string[], me: string | null, agent: { name: string } | null): MentionCandidate[] {
  const out: MentionCandidate[] = [];
  if (agent) out.push({ key: AGENT_KEY, name: agent.name, kind: 'agent' });
  const names = new Set<string>();
  for (const name of peers) names.add(name);
  for (const thread of threads) for (const message of thread.messages) if (message.author.kind === 'person') names.add(message.author.name);
  for (const name of names) if (name && name !== me && name !== agent?.name) out.push({ key: name, name, kind: 'person' });
  return out;
}
