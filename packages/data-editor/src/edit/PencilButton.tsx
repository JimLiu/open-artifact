/**
 * The pencil: what a click on the page does, "Use the page" or Edit. Edit
 * turns edit mode on (or, for a page that can't be edited by hand, asks to
 * have the agent make it editable); the tooltip says what keeps it off.
 * Hidden on a touch screen, where edit mode has no hover or keys.
 */

import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { MousePointer2, Pencil } from 'lucide-react';
import { TipButton } from '@open-artifact/editor-kit/react';
import { leavePageEdit, startPageEdit, useEditFlow } from '../drafts/edit-flow.ts';
import { EDIT_TOOL_TOOLTIP, EDIT_UNAVAILABLE_REASONS, SAVE_OR_CANCEL_FIRST_LABEL, type EditUnavailableReason } from '../drafts/words.ts';
import { useCanReachAgent } from '../ask/ask.ts';
import { canEditPageByHand, hasPageEntry, isOneWriterPage, isReparseStable, parsePageEntryMarkup } from '../page/parse.ts';
import { useAgentActivity } from '../platform/agent-activity.ts';
import { useDocument } from '../state/document.ts';
import { areDraftsFree, useShown } from '../state/shown.ts';
import { CLICK_TOOL_GROUP_LABEL, USE_PAGE_LABEL, pencilReason } from './pencil.ts';

const COARSE_POINTER = '(pointer: coarse)';

function subscribeCoarse(listener: () => void): () => void {
  const query = window.matchMedia(COARSE_POINTER);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

/** The screen's main pointer is a finger. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia(COARSE_POINTER).matches,
    () => false,
  );
}

export interface PencilState {
  editing: boolean;
  /** The files hold a page (`index.html`) to edit; without one there is no pencil. */
  hasPage: boolean;
  /** Why Edit is off, or null. */
  reason: EditUnavailableReason | null;
  /** Edit's tooltip. */
  tip: string;
  /** "Use the page" is off: changes are unsaved. */
  unsaved: boolean;
  /** An edit dialog is open. */
  dialog: boolean;
  edit(): void;
  use(): void;
}

/** The pencil's state and actions, for a toolbar that draws its own buttons. */
export function usePencil(): PencilState {
  const editing = useEditFlow((state) => state.phase !== 'off');
  const unsaved = useEditFlow((state) => state.count > 0);
  const dialog = useEditFlow((state) => state.dialog !== null);
  const viewingVersion = useShown((state) => state.version !== null);
  const draftShown = useShown((state) => state.draft !== null && areDraftsFree(state));
  const commenting = useShown((state) => state.commenting);
  const agentWorking = useAgentActivity((state) => state.activity === 'working');
  const files = useDocument((state) => state.content.files);
  const canAsk = useCanReachAgent();
  const fragment = useMemo(() => parsePageEntryMarkup(files), [files]);
  const oneWriter = isOneWriterPage(fragment);
  const editableByHand = useMemo(() => oneWriter && isReparseStable(fragment), [fragment, oneWriter]);
  const reason = pencilReason({ editing, viewingVersion, agentWorking, draftShown, commenting, editableByHand, canAsk });
  return {
    editing,
    hasPage: hasPageEntry(files),
    reason,
    tip: reason === null ? EDIT_TOOL_TOOLTIP : EDIT_UNAVAILABLE_REASONS[reason],
    unsaved,
    dialog,
    edit() {
      if (editing || reason !== null) return;
      startPageEdit({ editable: () => canEditPageByHand(useDocument.getState().content.files), misparsed: oneWriter && !editableByHand });
    },
    use() {
      if (editing && !unsaved) leavePageEdit();
    },
  };
}

export interface PencilButtonProps {
  size?: 'md' | 'lg' | 'xl';
}

export function PencilButton({ size = 'lg' }: PencilButtonProps): ReactNode {
  const pencil = usePencil();
  const coarse = useCoarsePointer();
  if (coarse) return null;
  return (
    <div role="group" aria-label={CLICK_TOOL_GROUP_LABEL} className="inline-flex items-center gap-0.5">
      <TipButton
        tip={pencil.editing && pencil.unsaved ? SAVE_OR_CANCEL_FIRST_LABEL : USE_PAGE_LABEL}
        aria-label={USE_PAGE_LABEL}
        square
        size={size}
        pressed={!pencil.editing}
        disabled={pencil.editing && (pencil.unsaved || pencil.dialog)}
        onClick={pencil.use}
      >
        <MousePointer2 size={16} aria-hidden />
      </TipButton>
      <TipButton
        tip={pencil.tip}
        aria-label={EDIT_TOOL_TOOLTIP}
        square
        size={size}
        pressed={pencil.editing}
        disabled={!pencil.editing && (pencil.reason !== null || pencil.dialog)}
        onClick={pencil.edit}
        data-dash-pencil=""
      >
        <Pencil size={16} aria-hidden />
      </TipButton>
    </div>
  );
}
