/**
 * Who a thread is assigned to. A person's message carries it in `assignee` (`null`: no one). From the "Assign to"
 * menu it is a reply of its own whose words say what changed ("Assigned to @Ana", "Reassigned from @Bo to @Ana",
 * "This comment is no longer assigned.") and which names the new assignee in `to`; the card draws such replies as one
 * line of note. A comment sent with "Assign to" checked keeps its own words and is drawn as a message. Messages
 * without `assignee` are known by those words alone.
 */
import type { CommentMessage, CommentThread } from '@open-artifact/runtime';
import { AGENT_KEY } from './mentions.ts';

/** The words of an unassigning reply. */
export const UNASSIGNED_TEXT = 'This comment is no longer assigned.';

/** The most people the "Assign to" menu offers. */
export const MAX_CANDIDATES = 8;

/** The words of the reply that assigns `to` (`null`: nobody), `from` being who had it. */
export function assignText(to: string | null, from: string | null): string {
  if (to === null) return UNASSIGNED_TEXT;
  return from === null || from === to ? `Assigned to @${to}` : `Reassigned from @${from} to @${to}`;
}

/** What a message changes: `{ to }` assigns someone, `{ to: null }` unassigns; `null` when it is an ordinary message. */
export function assignmentIn(message: CommentMessage): { to: string | null; from?: string; worded: boolean } | null {
  if (message.author.kind !== 'person') return null;
  const said = wordedAssignment(message);
  if (message.assignee === undefined) return said && { ...said, worded: true };
  const to = message.assignee;
  if (said?.to !== to) return { to, worded: false };
  return { ...said, worded: true };
}

/** What a message's words say it changes, when they are only the words of an assignment. */
function wordedAssignment(message: CommentMessage): { to: string | null; from?: string } | null {
  const text = message.text.trim();
  if (text === UNASSIGNED_TEXT) return message.to?.length ? null : { to: null };
  const to = message.to?.length === 1 ? message.to[0]! : null;
  if (to === null || to === AGENT_KEY) return null;
  if (text === `Assigned to @${to}`) return { to };
  const prefix = 'Reassigned from @';
  const suffix = ` to @${to}`;
  if (text.startsWith(prefix) && text.endsWith(suffix) && text.length > prefix.length + suffix.length) {
    return { to, from: text.slice(prefix.length, -suffix.length) };
  }
  return null;
}

export interface AssignStep {
  message: CommentMessage;
  /** Who had the thread before this message. */
  before: string | null;
  /** Who has it after. */
  after: string | null;
  /** The message is only the words of an assignment that agrees with the thread so far: the card draws it as a note. */
  note: boolean;
}

/** The thread's messages in order, with who had the thread before and after each. */
export function assignSteps(thread: CommentThread): AssignStep[] {
  const steps: AssignStep[] = [];
  let current: string | null = null;
  for (const message of thread.messages) {
    const change = assignmentIn(message);
    const before = current;
    let note = false;
    if (change && change.to !== null) {
      note = change.worded && (change.from === undefined || change.from === before);
      current = change.to;
    } else if (change && before !== null) {
      note = change.worded;
      current = null;
    }
    steps.push({ message, before, after: current, note });
  }
  return steps;
}

/** Who the thread is assigned to now, if anyone. */
export const assigneeOf = (thread: CommentThread): string | null => assignSteps(thread).at(-1)?.after ?? null;

/** The ids of the messages the card draws as notes of who the thread was assigned to. */
export function assignNotes(thread: CommentThread): Set<string> {
  return new Set(assignSteps(thread).filter(step => step.note).map(step => step.message.id));
}

/** Whether a message is a note of an assignment (and not words someone wrote to the thread). */
export const isAssignNote = (thread: CommentThread, message: CommentMessage): boolean => assignNotes(thread).has(message.id);

/**
 * Who the "Assign to" menu offers: the viewer, the people of the thread, then the others listed (those who can be
 * @mentioned), at most {@link MAX_CANDIDATES}; the one it is assigned to stays in, as the last, when the list is full.
 * The agent is never offered.
 */
export function assignCandidates({ me, thread, listed, current }: { me: string; thread: CommentThread; listed: readonly string[]; current: string | null }): string[] {
  const names: string[] = [];
  const add = (name: string | null | undefined) => {
    if (name && name !== AGENT_KEY && !names.includes(name)) names.push(name);
  };
  add(me);
  for (const message of thread.messages) if (message.author.kind === 'person') add(message.author.name);
  for (const name of listed) add(name);
  add(current);
  const shown = names.slice(0, MAX_CANDIDATES);
  if (current !== null && !shown.includes(current)) shown[MAX_CANDIDATES - 1] = current;
  return shown;
}

/** The card's mark: "Assigned to you", "Assigned to Ana". */
export const assignedLabel = (assignee: string, me: string | null): string => (assignee === me ? 'Assigned to you' : `Assigned to ${assignee}`);

/** The words of a note: "Ana assigned Bo", "You took this on", "Ana unassigned you", "Bo is no longer assigned". */
export function assignNoteText(step: AssignStep, me: string | null): string {
  const author = step.message.author.name;
  const who = author === me ? 'You' : author;
  const whom = (name: string) => (name === me ? 'you' : name);
  if (step.after !== null) return step.after === author ? `${who} took this on` : `${who} assigned ${whom(step.after)}`;
  const was = step.before ?? '';
  return was === author ? `${who} ${author === me ? 'are' : 'is'} no longer assigned` : `${who} unassigned ${whom(was)}`;
}
