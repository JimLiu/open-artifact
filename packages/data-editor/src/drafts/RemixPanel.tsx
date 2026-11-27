/**
 * The remix format cards: each asks the agent for a draft of the dashboard
 * in that format (the picked one stays marked while the request is out),
 * plus the line saying someone else has a draft waiting.
 */

import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { REMIX_FORMS } from '@open-artifact/data-core';
import { Button, cn } from '@open-artifact/ui';
import { askWithEdits } from './edit-flow.ts';
import { redoDraft, remixDraft, useDraftFlow } from './flow.ts';
import { FormPicture } from './FormPictures.tsx';
import { usePersonName } from './people.ts';
import { useCanAskAgent } from './request.ts';
import { useSharedDraft } from './shared-flow.ts';
import {
  DRAFT_PICK_FORMAT_MESSAGE,
  DRAFT_PICK_FORMAT_REPLACES_MESSAGE,
  REMIX_FORMAT_TITLE,
  REMIX_SHARED_HELD_MESSAGE,
  REMIX_STYLE_HELD_MESSAGE,
  VIEW_DRAFT_LABEL,
  draftWaitingMessage,
} from './words.ts';

/** Asks for a remix once unsaved hand edits are dealt with. */
function pick(form: string): void {
  askWithEdits(() => void remixDraft(form));
}

/**
 * The Format section of the Design panel; `titled` heads it "Format". `held`: unsaved style changes keep the formats
 * waiting; so does a shared draft holding changes.
 */
export function RemixPanel({ titled = true, held: styleHeld = false }: { titled?: boolean; held?: boolean }): ReactNode {
  const canAsk = useCanAskAgent();
  const sharedHeld = useSharedDraft((state) => state.on && state.view.ready);
  const held = styleHeld || sharedHeld;
  const flow = useDraftFlow();
  const { view } = flow;
  const owner = usePersonName(view.head !== null && !view.mine ? view.head.by : '');
  const busy = flow.asked || view.working || flow.saving;
  const [picked, setPicked] = useState<string | null>(null);
  if (!busy && picked !== null) setPicked(null);
  const checked = picked ?? (view.mine ? (view.head?.form ?? null) : null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (document.activeElement === document.body) panel.current?.focus({ preventScroll: true });
  }, [busy, view.showing]);
  const forms = canAsk ? REMIX_FORMS : [];
  return (
    <div ref={panel} tabIndex={-1} className="flex flex-col gap-2 outline-none">
      {titled ? <h3 className="text-[13px] font-semibold text-chrome-fg">{REMIX_FORMAT_TITLE}</h3> : null}
      <p className="text-[12px] text-chrome-muted">{view.mine && view.ready ? DRAFT_PICK_FORMAT_REPLACES_MESSAGE : DRAFT_PICK_FORMAT_MESSAGE}</p>
      {forms.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {forms.map(({ key, name }) => {
            const marked = busy && key === checked;
            return (
              <button
                key={key}
                type="button"
                disabled={busy || held}
                aria-pressed={marked || undefined}
                onClick={() => {
                  setPicked(key);
                  pick(key);
                }}
                className={cn(
                  'group relative flex flex-col overflow-hidden rounded-lg border border-chrome-line bg-chrome text-center text-[12px] text-chrome-muted outline-none transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-chrome-focus',
                  !busy && 'hover:border-chrome-accent/60 hover:text-chrome-fg',
                  marked && 'border-chrome-accent font-medium text-chrome-fg ring-2 ring-chrome-accent/40',
                  busy && !marked && 'opacity-50',
                )}
              >
                <FormPicture form={key} className="aspect-[212/146] w-full bg-chrome-hover" />
                <span className="flex items-center justify-center gap-1.5 px-2 py-1.5">
                  {name}
                  {flow.asked && marked ? <LoaderCircle className="size-3 animate-spin" aria-hidden="true" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {held && forms.length > 0 ? <p className="text-[13px] text-chrome-fg">{styleHeld ? REMIX_STYLE_HELD_MESSAGE : REMIX_SHARED_HELD_MESSAGE}</p> : null}
      {!view.mine && view.ready && !busy ? (
        <div className="flex flex-col gap-2 text-[13px] text-chrome-fg">
          <p>{draftWaitingMessage(owner)}</p>
          {!view.showing ? (
            <Button className="self-start" onClick={redoDraft}>
              {VIEW_DRAFT_LABEL}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
