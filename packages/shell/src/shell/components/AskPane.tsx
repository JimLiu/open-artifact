/**
 * The "Ask agent" pane beside the page: the owner session's state, what was
 * sent from here, and a box whose messages go to that session
 * (`artifacts.ask`).
 *
 * On a cloud host no session owns the artifact: the pane says what the host says of the owner's agent (a linked
 * computer connected or away, an MCP client used lately, or none), and, once sent, whether it has the request now.
 *
 * On this computer, an artifact no session owns (made on the home page, a folder opened) lists the sessions online now:
 * the person picks one and it gets the artifact and what was sent from it (`artifacts.assign`). With none online, the
 * pane offers the prompt that has a session take it over.
 */

import { Copy, Send, UserCheck, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { MAX_HOST_TEXT } from '@open-artifact/protocol';
import { Button, IconButton } from '@open-artifact/ui';
import { OwnerBadge } from '../../components/OwnerBadge.tsx';
import { api, errorText } from '../../lib/api.ts';
import { ago, copyText } from '../../lib/format.ts';
import { cloudAskLine } from '../../lib/cloud.ts';
import { t, type MessageKey } from '../../lib/i18n.ts';
import { ask } from '../actions.ts';
import { useAgentName, useCloudAgent, useOwner, useOwnerState, useRole } from '../hooks.ts';
import { assignableSessions, takeOverText, type AssignableSession, type Delivery } from '../model.ts';
import { useBoot, useShell } from '../store.ts';

const DELIVERY: Record<Delivery, MessageKey> = { delivered: 'viaDelivered', drafted: 'viaDrafted', inbox: 'viaInbox', failed: 'viaFailed' };

/** The pane's heading lines for the owner's state. */
function useStateLines(agent: string): { state: string; note: string } {
  const owner = useOwner();
  const status = useOwnerState();
  const cloudAgent = useCloudAgent();
  const role = useRole();
  if (cloudAgent && status !== 'working') {
    const said = cloudAskLine(cloudAgent, role === 'owner');
    return { state: t(said.key, said.vars), note: '' };
  }
  if (cloudAgent) return { state: t('working', { agent: cloudAgent.name }), note: '' };
  if (!owner) return { state: t('noOwner'), note: t('noOwnerNote') };
  // The harness's display name when its profile gives one, else its id as it is.
  const harness = owner.harnessTitle ?? owner.harness;
  if (status === 'working') return { state: t('working', { agent }), note: t('ownerNote', { harness }) };
  if (owner.live) return { state: t('agentIdle', { agent }), note: t('ownerNote', { harness }) };
  return { state: t('sessionOffline'), note: t('offlineNote', { agent, harness }) };
}

/** An artifact no session owns: pick a session online now to hand it to, or copy the prompt that has one take it. */
function AssignBox() {
  const boot = useBoot();
  // Every artifact refresh (sessions come and go: `harness/changed`) lists the sessions again.
  const artifact = useShell((state) => state.artifact);
  const [sessions, setSessions] = useState<AssignableSession[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let live = true;
    api.harnesses().then(
      (info) => live && setSessions(assignableSessions(info)),
      () => live && setSessions([]),
    );
    return () => {
      live = false;
    };
  }, [artifact]);
  if (sessions === null) return null;
  const pick = sessions.some((s) => s.key === chosen) ? chosen : (sessions[0]?.key ?? '');
  if (!sessions.length) {
    const prompt = takeOverText(boot);
    return (
      <div data-testid="assign-none" className="mb-3.5">
        <p className="mb-1.5 mt-0 text-xs text-fg-muted">{t('noSessionsOnline')}</p>
        <textarea readOnly value={prompt} aria-label={t('copyTakeOver')} className="block min-h-20 w-full resize-y rounded-lg border border-line bg-surface-2 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-fg outline-none focus:border-accent" />
        <div className="mt-1.5 flex items-center gap-2">
          <Button
            size="md"
            icon={<Copy className="size-3.5" />}
            onClick={async () => {
              await copyText(prompt);
              setStatus(t('promptCopied'));
            }}
          >
            {t('copyTakeOver')}
          </Button>
          <span role="status" className="min-w-0 flex-1 text-xs text-fg-muted">
            {status}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div data-testid="assign-box" className="mb-3.5">
      <p className="mb-1.5 mt-0 text-xs font-medium">{t('assignTo')}</p>
      <div className="flex items-center gap-2">
        <select
          data-testid="assign-session"
          aria-label={t('assignPick')}
          value={pick}
          onChange={(event) => setChosen(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2 text-[13px] text-fg outline-none focus:border-accent"
        >
          {sessions.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <Button
          size="md"
          variant="primary"
          data-testid="assign-button"
          disabled={busy || !pick}
          icon={<UserCheck className="size-3.5" />}
          onClick={async () => {
            setBusy(true);
            setStatus(t('assigning'));
            try {
              await api.assign(boot.id, pick);
              // The pane shows the owner next (this box goes): the line under the message box says what happened.
              setStatus('');
              useShell.getState().setAskStatus(t('assigned', { session: sessions.find((s) => s.key === pick)?.label ?? pick }));
            } catch (error) {
              setStatus(t('couldNotAssign', { error: errorText(error) }));
            }
            setBusy(false);
          }}
        >
          {t('assignButton')}
        </Button>
      </div>
      <p role="status" className="mb-0 mt-1.5 text-xs text-fg-muted">
        {status}
      </p>
    </div>
  );
}

/** The ask pane. */
export function AskPane() {
  const agent = useAgentName();
  const sent = useShell((state) => state.sent);
  const status = useShell((state) => state.askStatus);
  const ownerStatus = useOwnerState();
  const cloudAgent = useCloudAgent();
  const owner = useOwner();
  const boot = useBoot();
  const role = useRole();
  const { state, note } = useStateLines(agent);
  // A cloud host's agent: its own words for the dot, and "waiting for the agent" (there is no session to wait for).
  const badgeLabel = cloudAgent && ownerStatus !== 'working' ? t(cloudAgent.state === 'online' ? 'statusConnected' : cloudAgent.state === 'none' ? 'statusNoAgent' : 'statusOffline') : undefined;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const statusId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLOListElement>(null);
  const length = text.trim().length;
  const tooLong = length > MAX_HOST_TEXT;
  const canSend = !busy && length > 0 && !tooLong;

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: 'end' });
  }, [sent.length]);

  const submit = async (): Promise<void> => {
    if (!canSend) return;
    setBusy(true);
    if (await ask(text, agent)) setText('');
    setBusy(false);
  };

  return (
    <aside
      aria-label={t('ask', { agent })}
      className="flex w-[360px] max-w-full shrink-0 flex-col border-l border-line bg-surface max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-10 max-md:shadow-popup"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pl-3.5 pr-1.5">
        <span className="min-w-0 flex-1 truncate font-medium">{agent}</span>
        <OwnerBadge state={ownerStatus} {...(badgeLabel ? { label: badgeLabel } : {})} />
        <IconButton label={t('hideAsk')} icon={<X className="size-4" />} size="lg" onClick={() => useShell.getState().setAskOpen(false)} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3.5">
        <p className="mb-1 mt-0 font-medium">{state}</p>
        {note ? <p className="mb-3.5 mt-0 text-xs text-fg-muted">{note}</p> : <div className="mb-3.5" />}
        {!owner && !cloudAgent && !boot.cloud && role === 'owner' ? <AssignBox /> : null}
        <ol ref={log} className="m-0 flex list-none flex-col gap-2.5 p-0">
          {sent.map((message, index) => (
            <li key={`${message.at}-${index}`} className="max-w-[92%] self-end whitespace-pre-wrap break-words rounded-2xl bg-surface-2 px-3 py-2">
              {message.text}
              <span className="mt-0.5 block text-[11px] text-fg-muted">
                {ago(message.at)} · {t(cloudAgent && message.delivery === 'inbox' ? 'viaWaitingAgent' : DELIVERY[message.delivery])}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <form
        className="p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={input}
          rows={3}
          value={text}
          placeholder={t('askPlaceholder')}
          aria-label={t('askPlaceholder')}
          aria-invalid={tooLong || undefined}
          aria-describedby={tooLong ? statusId : undefined}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          className="block max-h-[40vh] min-h-[72px] w-full resize-y rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
        />
        <div className="mt-2 flex items-center gap-2">
          <span id={statusId} role="status" className="min-w-0 flex-1 text-xs text-fg-muted">
            {tooLong ? t('askTooLong', { limit: MAX_HOST_TEXT }) : status}
          </span>
          <Button type="submit" size="lg" variant="primary" disabled={!canSend} icon={<Send className="size-3.5" />}>
            {t(owner?.wakeMode === 'draft' ? 'sendToConversation' : 'sendToAgent', { agent })}
          </Button>
        </div>
      </form>
    </aside>
  );
}
