/**
 * The agent's side of every editor: following its status, and telling the
 * person how the host took a request ("Send to agent", "Ask agent to fix").
 * Pure; the editor shows the message (a toast).
 */

import type { AgentCapability, AgentSendResult, AgentStatus, SelectionSnapshot } from '@open-artifact/runtime';

/** What {@link selectionSnapshotOf} takes: the selection as the request's `text` names it, taken when Send is pressed. */
export interface SelectionSnapshotInput {
  /** What is selected, e.g. `elements`, `slides`, `area` ({@link SelectionSnapshot}`.kind`). */
  kind: string;
  /** How many are selected; at least `items.length`. */
  count?: number;
  /** The selected things, first ones first; more than the limit are left out (`count` still says how many). */
  items?: ReadonlyArray<{ id: string; kind?: string; label?: string }>;
  /** The noun for `label` (`element` → `3 selected elements`); ignored when `label` is given. */
  noun?: string;
  /** The one-line chip text, when the noun form does not fit (a cell range, a data pick). */
  label?: string;
  where?: string;
  text?: string;
}

/** Most items a snapshot lists (as `SELECTION_SNAPSHOT_LIMITS.items` of `@open-artifact/protocol`). */
const SNAPSHOT_ITEMS = 20;

/**
 * A request's `selectionSnapshot`: what was selected when the person pressed Send, for the app that shows the request
 * to put beside their words (`3 selected elements`, opened to list them). `null` when nothing is selected. The type
 * server and the daemon check it again; this only shapes it.
 */
export function selectionSnapshotOf(input: SelectionSnapshotInput): SelectionSnapshot | null {
  const items = (input.items ?? [])
    .filter((item) => typeof item.id === 'string' && item.id !== '')
    .slice(0, SNAPSHOT_ITEMS)
    .map((item) => ({ id: item.id, ...(item.kind ? { kind: item.kind } : {}), ...(item.label ? { label: item.label } : {}) }));
  const count = Math.max(Math.floor(input.count ?? 0), items.length);
  if (count < 1) return null;
  const noun = input.noun ?? 'item';
  const label = input.label?.trim() || `${count} selected ${count === 1 ? noun : `${noun}s`}`;
  return {
    kind: input.kind,
    label,
    count,
    ...(items.length ? { items } : {}),
    ...(input.where ? { where: input.where } : {}),
    ...(input.text ? { text: input.text } : {}),
  };
}

/** A message for the person. */
export interface AgentResultMessage {
  title: string;
  description?: string;
}

/**
 * How the host took a request, for a toast. `subject` names what the agent
 * checks next ("this design", "this deck", "this board"). `agent` is its
 * status: one that is not woken while it idles (`wakesIdle: false`) gets a
 * queued request on its next turn, which the person starts.
 */
export function agentResultMessage(
  result: Pick<AgentSendResult, 'status' | 'reason' | 'drafted'>,
  subject: string,
  agent?: Pick<AgentStatus, 'name' | 'wakesIdle'>,
): AgentResultMessage {
  switch (result.status) {
    case 'delivered':
      return result.drafted ? { title: draftedText(agent?.name).sent } : { title: 'Sent to the agent' };
    case 'queued':
      if (agent?.wakesIdle === false) {
        const name = agent.name || 'The agent';
        return { title: `Queued for ${name}`, description: `${name} gets it on its next turn. If it is idle, send it a message there to start one.` };
      }
      return { title: 'Queued for the agent', description: `It will see the request the next time it checks ${subject}.` };
    case 'staged':
      return { title: 'Request prepared', description: 'Your agent will ask before acting on it.' };
    default:
      return { title: 'Could not reach the agent', description: result.reason ?? 'Try again, or copy your request into the conversation.' };
  }
}

/** Whether the page's language is Chinese (the Shell's rule: `zh*` → Simplified Chinese). */
function chinese(): boolean {
  try {
    return /^zh\b/i.test(globalThis.navigator?.language ?? '');
  } catch {
    return false;
  }
}

/**
 * The words for a request put in the agent's conversation for the person to send there (`drafted`), as the Shell
 * says them: `sent` after sending, `via` for a thread or request that went that way (`label`: the same, as a label
 * of its own). English, or Simplified Chinese when the page's language is Chinese.
 */
export function draftedText(agentName?: string | null, zh = chinese()): { sent: string; via: string; label: string } {
  const name = String(agentName ?? '').trim();
  return zh
    ? { sent: `已放进 ${name || '智能体'} 的对话：到那里发出去。`, via: '在对话里，等你发出', label: '在对话里，等你发出' }
    : { sent: `It is in the ${name || 'agent'} conversation now: send it there.`, via: 'in the conversation, for you to send', label: 'In the conversation, for you to send' };
}

/** A failed send result for an error thrown while sending. */
export function sendFailure(error: unknown): AgentSendResult {
  return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
}

/** Follows the agent's status (none without an agent); returns a function that stops. */
export function watchAgentStatus(agent: AgentCapability | null | undefined, onStatus: (status: AgentStatus) => void, onUnavailable?: () => void): () => void {
  if (!agent) return () => {};
  let stopped = false;
  let received = false;
  agent.status().then(
    (status) => {
      if (!stopped && !received) onStatus(status);
    },
    () => { if (!stopped && !received) onUnavailable?.(); },
  );
  const off = agent.onStatus(status => {
    if (!stopped) { received = true; onStatus(status); }
  });
  return () => {
    stopped = true;
    off();
  };
}
