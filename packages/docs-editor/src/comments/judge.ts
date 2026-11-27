
import type { CommentMessage, CommentThread } from '@open-artifact/runtime';
import { assignNotes } from './assign.ts';
import { AGENT_KEY } from './mentions.ts';

/** `asked`: the message @mentions the agent; `wake`: it goes to the agent unasked; `nothing`: it stays with people. */
export type JudgeChoice = 'asked' | 'wake' | 'nothing';

export interface JudgeCase {
  /** The thread as saved, the new (or edited) message last. */
  thread: CommentThread;
  /** Who the message names (`agent` for the agent). */
  to: readonly string[];
  /** The message was changed, not written: only an @mention sends it. */
  edited?: boolean;
}

export interface JudgeVerdict {
  choice: JudgeChoice;
  /** Why, in a few words (for tests and logs). */
  why: string;
}

/** Whether, and how, the thread's newest message goes to the agent. */
export function judgeComment({ thread, to, edited = false }: JudgeCase): JudgeVerdict {
  if (to.includes(AGENT_KEY)) return { choice: 'asked', why: 'it @mentions the agent' };
  if (edited) return { choice: 'nothing', why: 'an edit reaches the agent only with an @mention' };
  const message = thread.messages.at(-1);
  if (!message || message.author.kind !== 'person') return { choice: 'nothing', why: 'no new message of a person' };
  if (thread.messages.length < 2) return { choice: 'nothing', why: 'a new thread reaches the agent only with an @mention' };
  if (to.length > 0 || namesSomeone(message.text)) return { choice: 'nothing', why: 'it is addressed to someone else' };
  const earlier = thread.messages.slice(0, -1);
  const lastAgent = earlier.findLastIndex(item => item.author.kind === 'agent');
  if (lastAgent < 0 && !thread.agent) return { choice: 'nothing', why: 'the agent took no part in the thread' };
  if (thread.agent?.status === 'pending') return { choice: 'nothing', why: 'the thread already waits for the agent, who reads it whole' };
  // Who the thread was assigned to is a note, not someone talking.
  const notes = assignNotes(thread);
  if (earlier.slice(lastAgent + 1).some(item => item.author.kind === 'person' && item.author.name !== message.author.name && !notes.has(item.id))) {
    return { choice: 'nothing', why: 'other people are talking in the thread' };
  }
  // A thanks or an OK closes a talk, unless it answers what the agent asked.
  const asking = lastAgent >= 0 && /[?？]\s*$/.test(earlier[lastAgent]!.text);
  if (!asking && isAcknowledgement(message)) return { choice: 'nothing', why: 'it only acknowledges' };
  return { choice: 'wake', why: 'it goes on a thread with the agent' };
}

/**
 * Whether a reply of `author` with this text, and naming `to`, would go to the agent unasked: the reply box's
 * "Send to agent" follows it until the person sets the box.
 */
export function replyWakes(thread: CommentThread, text: string, author: string, to: readonly string[]): boolean {
  const draft: CommentMessage = { id: '', author: { kind: 'person', name: author }, text, at: '' };
  return judgeComment({ thread: { ...thread, messages: [...thread.messages, draft] }, to }).choice === 'wake';
}

/** An `@name` left in the text once the agent's mention is out of `to`: someone the page does not know. */
function namesSomeone(text: string): boolean {
  return /(?:^|\s)@[\p{L}\p{N}_]/u.test(text);
}

/** Thanks, OK, an emoji: words that close a talk rather than ask for more (or answer a question of the agent's). */
const ACKNOWLEDGEMENTS = new Set([
  'thanks',
  'thankyou',
  'thanksalot',
  'thx',
  'ty',
  'ok',
  'okay',
  'k',
  'great',
  'perfect',
  'nice',
  'cool',
  'gotit',
  'lgtm',
  'looksgood',
  'soundsgood',
  'done',
  'yes',
  'yep',
  'no',
  'nope',
  '谢谢',
  '多谢',
  '好的',
  '好',
  '收到',
  '可以',
  '行',
]);

function isAcknowledgement(message: CommentMessage): boolean {
  const words = message.text.toLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]/gu, '');
  return words === '' || ACKNOWLEDGEMENTS.has(words);
}
