/**
 * Working with the agent: the view context it receives with the viewer's
 * next message, "Send to agent", and the prepared requests the page offers
 * (fix a contrast pair, change the cover, build the system from a source).
 *
 * Names and text taken from the system (token names, component names,
 * preview errors) were written by someone else and are fenced as untrusted
 * data. Only what the viewer typed goes in as their own words.
 */

import { fenceUntrusted, type AgentRequest, type AgentSendResult, type AgentStatus } from '@open-artifact/runtime';
import { agentResultMessage, sendFailure, watchAgentStatus } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import { create } from 'zustand';
import { isDirty, useFiles } from '../state/files.ts';
import { useView, type Focus } from '../state/view.ts';
import { session } from './session.ts';
import { focusSnapshot } from '../lib/focus-snapshot.ts';

/** Live agent status. */
export const useAgent = create<{ status: AgentStatus }>()(() => ({
  status: { available: false, busy: false, name: 'Agent' },
}));

/** What the viewer has on screen, as the agent receives it. */
export interface SystemViewContext {
  type: 'design-system';
  section: string;
  focus: Focus | null;
  /** The theme the swatches show. */
  theme: string | null;
  /** The file open in the Files section. */
  file: string | null;
  /** Unsaved changes: re-read files before editing. */
  dirty: boolean;
  /** Hand edits made in this tab; when it changes, re-read before editing. */
  edits: number;
  readOnly: boolean;
}

/** The view context right now. */
export function currentViewContext(): SystemViewContext {
  const view = useView.getState();
  const files = useFiles.getState();
  return {
    type: 'design-system',
    section: view.section,
    focus: view.focus,
    theme: view.theme,
    file: view.section === 'files' ? view.file : null,
    dirty: isDirty(files),
    edits: files.edits,
    readOnly: files.readOnly,
  };
}

/** Publishes the view context whenever it changes, and follows the agent's status. */
export function startPresence(): void {
  const { room, agent } = session();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = '';
  const publish = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const context = currentViewContext();
      const text = JSON.stringify(context);
      if (text === last || !room) return;
      last = text;
      room.presence({ viewContext: context }).catch(() => undefined);
    }, 400);
  };
  useView.subscribe(publish);
  useFiles.subscribe((state, previous) => {
    if (state.edits !== previous.edits || state.save !== previous.save || state.readOnly !== previous.readOnly) publish();
  });
  publish();
  watchAgentStatus(agent, (status) => useAgent.setState({ status }));
}

/** Describes a send result to the viewer. */
function report(result: AgentSendResult): void {
  toast.add(agentResultMessage(result, 'this design system', useAgent.getState().status));
}

/** Describes what the viewer focused, fenced (names come from the system's files). */
function describeFocus(focus: Focus | null): string | null {
  if (!focus) return null;
  const what = focus.family ? `${focus.kind} in ${focus.family}` : focus.kind;
  return fenceUntrusted(`${what}: ${focus.name}`, { label: 'what the viewer selected' });
}

/** Sends a request; `title` labels it for the agent and in logs. */
async function send(
  title: string,
  parts: (string | null)[],
  context: Record<string, unknown> = {},
  shown: Pick<AgentRequest, 'userText' | 'selectionSnapshot'> = {},
): Promise<AgentSendResult | null> {
  const { agent, isOwner } = session();
  if (!isOwner) {
    toast.add({ title: 'Only the owner can send requests to the agent', description: 'Leave a comment instead.' });
    return null;
  }
  if (!agent) {
    toast.add({ title: 'No agent is connected', description: 'Ask your agent to open this design system again.' });
    return null;
  }
  try {
    const result = await agent.send({ title, text: parts.filter(Boolean).join('\n\n'), context: { view: currentViewContext(), ...context }, ...shown });
    report(result);
    return result;
  } catch (error) {
    const result = sendFailure(error);
    report(result);
    return result;
  }
}

/** "Send to agent": the viewer's request about what they focused. */
export async function sendToAgent(message: string): Promise<AgentSendResult | null> {
  const text = message.trim();
  if (!text) return null;
  const focus = useView.getState().focus;
  // Taken now, when Send is pressed: the app showing the request names what was focused then.
  const snapshot = focusSnapshot(focus);
  return send('Send to agent', [text, describeFocus(focus)], {}, { userText: text, ...(snapshot ? { selectionSnapshot: snapshot } : {}) });
}

/** A contrast pair that fails its threshold. */
export interface ContrastIssue {
  theme: string;
  foreground: string;
  background: string;
  ratio: number;
  required: number;
}

/** "Ask agent to fix" for low-contrast pairs. */
export async function askToFixContrast(issues: readonly ContrastIssue[]): Promise<void> {
  if (!issues.length) return;
  const listed = issues
    .map((issue) => `${issue.foreground} on ${issue.background} (theme ${issue.theme}): ${issue.ratio.toFixed(2)}:1, needs ${issue.required}:1`)
    .join('\n');
  await send(
    'Ask agent to fix',
    [
      'Fix the color contrast of these token pairs in tokens.json so each meets its threshold in every theme. Change as little as possible, keep each color recognizably the same hue, and note any value you had to keep in its usage text.',
      fenceUntrusted(listed, { label: 'contrast findings' }),
    ],
    { contrast: issues },
  );
}

/** "Ask agent to fix" for a component preview that threw. */
export async function askToFixPreview(component: string, message: string): Promise<void> {
  await send('Ask agent to fix', [
    `The preview of a component fails to render. Fix components/<name>/preview.html (or the bundle, if the error is there).`,
    fenceUntrusted(`component: ${component}\nerror: ${message}`, { label: 'preview error' }),
  ]);
}

/** Prepared requests offered by the page (welcome cards, the cover). */
export const REQUESTS = {
  fromConnectors:
    'Build this design system in its existing folder. Check this session’s connectors for a design file, code repository, drive or wiki with my brand materials. Tell me which sources are available and ask which to use. If none are connected, ask me about the brand, colors, typography and accessibility needs in one message and draft a starter system from my answers.',
  fromCode:
    'Build this design system from a GitHub repository using the design-system skill’s reference/from-code.md. Update this system in place. Ask me once which repository, branch and package to use. List what you found (variables by theme, text styles, fonts, logos, components) and wait for my go-ahead before writing.',
  fromUploads:
    'I uploaded brand files to this design system (fonts in fonts/, files in assets/). Build the tokens, README and cover from them.',
  cover: 'Change the cover of this design system: ',
  finishSetup:
    'Finish setting up this design system: it has `editing: "off"` in design-system.json. Run the checks, fix what they report (tokens, components, previews, README), then remove `editing` so the page can edit it again. Tell me what you changed.',
  resyncFromCode:
    'Resync this design system from its code (it has `editing: "code"`). Read the same repository, branch and package as last time, update tokens, text styles, fonts and components to match, and keep the README and notes. List what changed since the last sync.',
} as const;

/** Sends one of the prepared requests, with the viewer's extra words appended. */
export async function sendPrepared(text: string, extra = '', title = 'Send to agent'): Promise<AgentSendResult | null> {
  return send(title, [`${text}${extra.trim() ? `\n\n${extra.trim()}` : ''}`]);
}
