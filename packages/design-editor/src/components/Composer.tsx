/**
 * "Send to agent": a small composer for a request about what is selected.
 * The agent receives the text, the selected elements (fenced as data) and
 * the current view context.
 */

import { Bot, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, IconButton, isComposingKey } from '@open-artifact/ui';
import { useView } from '../state/view.ts';
import { selectedElements, sendToAgent, useAgent } from '../services/agent.ts';
import { MOD } from '@open-artifact/editor-kit';
import { selectionCounts } from '../lib/selection.ts';

/** What the request is about, in words. */
function useSubject(): string {
  const selection = useView((s) => s.selection);
  if (selection.kind === 'elements') {
    const count = selection.items.length;
    const first = selectedElements()[0];
    if (count === 1 && first) return first.label ? `${first.kind}: “${first.label}”` : `a ${first.kind} element`;
    return `${count} elements in ${selection.board.replace(/\.dc\.html$/, '')}`;
  }
  if (selection.kind === 'mixed') {
    const counts = selectionCounts(selection);
    const parts = [`${counts.elements} element${counts.elements === 1 ? '' : 's'}${counts.elementBoards === 1 ? '' : ` on ${counts.elementBoards} artboards`}`];
    if (counts.objects) parts.push(`${counts.objects} canvas object${counts.objects === 1 ? '' : 's'}`);
    return parts.join(' and ');
  }
  if (selection.kind === 'objects') {
    const parts = [];
    if (selection.boards.length) parts.push(selection.boards.length === 1 ? selection.boards[0]!.replace(/\.dc\.html$/, '') : `${selection.boards.length} artboards`);
    if (selection.notes.length) parts.push(selection.notes.length === 1 ? '1 note' : `${selection.notes.length} notes`);
    return parts.join(' and ');
  }
  return 'what is on screen';
}

export function Composer() {
  const open = useView((s) => s.composer);
  const setComposer = useView((s) => s.setComposer);
  const status = useAgent((s) => s.status);
  const subject = useSubject();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) requestAnimationFrame(() => area.current?.focus());
  }, [open]);

  if (!open) return null;

  const submit = async (): Promise<void> => {
    if (!text.trim() || sending) return;
    setSending(true);
    const result = await sendToAgent(text);
    setSending(false);
    if (result && result.status !== 'failed') {
      setText('');
      setComposer(false);
    }
  };

  return (
    <div className="pointer-events-auto w-[min(560px,calc(100vw-32px))] rounded-xl bg-surface p-2 shadow-popup">
      <div className="flex items-center gap-2 px-1 pb-1.5 text-[12px] text-fg-muted">
        <Bot className="size-3.5" />
        <span className="flex-1 truncate">
          About <span className="text-fg">{subject}</span>
        </span>
        <IconButton size="sm" label="Close" icon={<X className="size-3.5" />} onClick={() => setComposer(false)} />
      </div>
      <textarea
        ref={area}
        value={text}
        rows={3}
        placeholder={status.available ? 'Describe the change you want…' : 'No agent is connected. Your request will wait until one checks this design.'}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (isComposingKey(event.nativeEvent)) return;
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          } else if (event.key === 'Escape') {
            setComposer(false);
          }
        }}
        className="block w-full resize-none rounded-lg border border-line bg-surface-2 p-2 text-[13px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
      />
      <div className="flex items-center justify-between gap-2 pt-1.5">
        <span className="px-1 text-[11px] text-fg-subtle">{MOD}Enter to send</span>
        <Button variant="primary" icon={<Send className="size-3.5" />} disabled={!text.trim() || sending} onClick={() => void submit()}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
