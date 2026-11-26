/**
 * Comment threads in memory, with the type server's rules in short: a person edits and removes only their own
 * messages, the full list goes to the page after every change (`onChange`), and handing a thread to the agent marks it
 * `pending` until the agent reads it.
 */

import { ArtifactError, type CommentAuthor, type CommentCreate, type CommentMessage, type CommentThread, type JsonRecord } from '@open-artifact/runtime';
import { channel, randomId } from './events.ts';

const MAX_TEXT = 20_000;

export class CommentStore {
  private threads: CommentThread[] = [];
  readonly changes = channel<CommentThread[]>();

  constructor(private readonly person: CommentAuthor) {}

  list(): CommentThread[] {
    return structuredClone(this.threads);
  }

  find(id: string): CommentThread {
    const thread = this.threads.find((t) => t.id === id);
    if (!thread) throw new ArtifactError('not_found', `No thread ${id}.`);
    return thread;
  }

  /** Reports the change and answers with a copy of the thread. */
  private changed(thread?: CommentThread): CommentThread {
    this.changes.emit(this.list());
    return structuredClone(thread ?? this.threads[0]!);
  }

  private message(author: CommentAuthor, text: unknown, to?: string[]): CommentMessage {
    if (typeof text !== 'string' || !text.trim()) throw new ArtifactError('invalid', 'A comment needs text.');
    if (text.length > MAX_TEXT) throw new ArtifactError('invalid', 'The comment is too long.');
    return { id: `m-${randomId(6)}`, author, text, at: new Date().toISOString(), ...(to?.length ? { to: [...to] } : {}) };
  }

  create(input: CommentCreate): CommentThread {
    if (!input || typeof input.anchor !== 'string') throw new ArtifactError('invalid', 'input {anchor, label, text} is required.');
    const thread: CommentThread = {
      id: `t-${randomId(6)}`,
      anchor: input.anchor,
      label: typeof input.label === 'string' ? input.label : '',
      ...(typeof input.detail === 'string' ? { detail: input.detail } : {}),
      location: (input.location ?? {}) as JsonRecord,
      status: 'open',
      messages: [this.message(this.person, input.text, input.to)],
    };
    this.threads.push(thread);
    return this.changed(thread);
  }

  reply(threadId: string, text: string, to?: string[], author: CommentAuthor = this.person): CommentThread {
    const thread = this.find(threadId);
    thread.messages.push(this.message(author, text, to));
    // A person writing again reopens what the agent answered; the agent's reply closes its turn.
    if (author.kind === 'agent' && thread.agent) thread.agent = { status: 'replied' };
    return this.changed(thread);
  }

  edit(threadId: string, messageId: string, text: string, to?: string[]): CommentThread {
    const thread = this.find(threadId);
    const message = this.own(thread, messageId);
    const fresh = this.message(this.person, text, to);
    message.text = fresh.text;
    message.editedAt = fresh.at;
    if (to) {
      if (to.length) message.to = [...to];
      else delete message.to;
    }
    return this.changed(thread);
  }

  react(threadId: string, messageId: string, emoji: string, on: boolean): CommentThread {
    const thread = this.find(threadId);
    const message = thread.messages.find((m) => m.id === messageId);
    if (!message) throw new ArtifactError('not_found', `No message ${messageId}.`);
    if (typeof emoji !== 'string' || !emoji || emoji.length > 16) throw new ArtifactError('invalid', 'Bad emoji.');
    const reactions = message.reactions ?? [];
    const same = (a: CommentAuthor): boolean => a.kind === this.person.kind && a.name === this.person.name;
    let entry = reactions.find((r) => r.emoji === emoji);
    if (on) {
      if (!entry) reactions.push((entry = { emoji, authors: [] }));
      if (!entry.authors.some(same)) entry.authors.push({ ...this.person });
    } else if (entry) {
      entry.authors = entry.authors.filter((a) => !same(a));
    }
    const kept = reactions.filter((r) => r.authors.length);
    if (kept.length) message.reactions = kept;
    else delete message.reactions;
    return this.changed(thread);
  }

  setResolved(threadId: string, resolved: boolean, by: CommentAuthor = this.person): CommentThread {
    const thread = this.find(threadId);
    thread.status = resolved ? 'resolved' : 'open';
    if (resolved) thread.resolvedBy = { ...by };
    else delete thread.resolvedBy;
    return this.changed(thread);
  }

  move(threadId: string, anchor: string, location?: JsonRecord): CommentThread {
    const thread = this.find(threadId);
    if (typeof anchor !== 'string') throw new ArtifactError('invalid', 'anchor is a string.');
    thread.anchor = anchor;
    if (location) thread.location = location;
    return this.changed(thread);
  }

  remove(threadId: string, messageId?: string): void {
    const thread = this.find(threadId);
    if (messageId === undefined || (thread.messages.length === 1 && thread.messages[0]!.id === messageId)) {
      this.threads = this.threads.filter((t) => t !== thread);
    } else {
      const message = this.own(thread, messageId);
      thread.messages = thread.messages.filter((m) => m !== message);
    }
    this.changes.emit(this.list());
  }

  /** Marks the thread as sent to the agent (`pending`), or leaves its status for an `unasked` message. */
  markSent(threadId: string, unasked: boolean): CommentThread {
    const thread = this.find(threadId);
    if (!unasked || !thread.agent) thread.agent = { status: 'pending' };
    return this.changed(thread);
  }

  /** The agent read it. */
  markDelivered(threadId: string): void {
    const thread = this.threads.find((t) => t.id === threadId);
    if (!thread || thread.agent?.status !== 'pending') return;
    thread.agent = { status: 'delivered' };
    this.changed(thread);
  }

  private own(thread: CommentThread, messageId: string): CommentMessage {
    const message = thread.messages.find((m) => m.id === messageId);
    if (!message) throw new ArtifactError('not_found', `No message ${messageId}.`);
    if (message.author.kind !== this.person.kind || message.author.name !== this.person.name) throw new ArtifactError('not_writer', 'Only its author can change a message.');
    return message;
  }
}
