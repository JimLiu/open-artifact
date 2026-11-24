/**
 * The agent's side of every editor: following its status, and telling the
 * person how the host took a request ("Send to agent", "Ask agent to fix").
 * Pure; the editor shows the message (a toast).
 */

import { localize, uiLocale } from '@open-artifact/runtime';
import type { AgentCapability, AgentSendResult, AgentStatus } from '@open-artifact/runtime';

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
      return result.drafted ? { title: draftedText(agent?.name).sent } : { title: localize('Sent to the agent', '已发送给 Agent') };
    case 'queued':
      if (agent?.wakesIdle === false) {
        const name = agent.name || localize('The agent', 'Agent');
        return { title: localize(`Queued for ${name}`, `已加入 ${name} 的待处理队列`), description: localize(`${name} gets it on its next turn. If it is idle, send it a message there to start one.`, `${name} 会在下一轮处理。若它正空闲，可在对话中发送消息启动新一轮。`) };
      }
      return { title: localize('Queued for the agent', '已加入 Agent 的待处理队列'), description: localize(`It will see the request the next time it checks ${subject}.`, 'Agent 下次查看作品时会看到此请求。') };
    case 'staged':
      return { title: localize('Request prepared', '请求已准备好'), description: localize('Your agent will ask before acting on it.', 'Agent 会在处理前向你确认。') };
    default:
      return { title: localize('Could not reach the agent', '无法联系 Agent'), description: result.reason ?? localize('Try again, or copy your request into the conversation.', '请重试，或将请求复制到对话中。') };
  }
}

/**
 * The words for a request put in the agent's conversation for the person to send there (`drafted`), as the Shell
 * says them: `sent` after sending, `via` for a thread or request that went that way (`label`: the same, as a label
 * of its own). English, or Simplified Chinese when the page's language is Chinese.
 */
export function draftedText(agentName?: string | null, zh = uiLocale() === 'zh-CN'): { sent: string; via: string; label: string } {
  const name = String(agentName ?? '').trim();
  return zh
    ? { sent: `已放进 ${name || 'Agent'} 的对话：到那里发出去。`, via: '在对话里，等你发出', label: '在对话里，等你发出' }
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
