/**
 * The Undo / Redo / Cancel / Save bar, shared by hand edits and drafts,
 * with the status line ("Saved") and the working mark that take its place.
 */

import { Check, LoaderCircle, Redo2, Undo2, X } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { Card, ChromeDivider, Tip, TipButton, type ChromeSide } from '@open-artifact/editor-kit/react';
import { MOD, SHIFT } from '@open-artifact/editor-kit';
import { Button, cn } from '@open-artifact/ui';
import { useFocusHandoff } from '../sources/focus.ts';
import { useShown, areDraftsFree } from '../state/shown.ts';
import { isDraftBarShown, isDraftWorkingShown } from './draft-state.ts';
import { cancelPageEdits, redoPageEdit, savePageEdits, undoPageEdit, useEditFlow } from './edit-flow.ts';
import { cancelDraft, redoDraft, saveDraft, undoDraft, useDraftFlow } from './flow.ts';
import { useEditKeys } from './keys.ts';
import {
  CANT_CANCEL_WHILE_SAVING,
  CANT_REDO_WHILE_SAVING,
  CANT_UNDO_WHILE_SAVING,
  CANCEL_LABEL,
  DRAFT_BAR_WORDS,
  DRAFT_WORKING_LABEL,
  EDIT_WAITING_MESSAGE,
  NOTHING_TO_REDO_LABEL,
  NOTHING_TO_SAVE_YET,
  NOTHING_TO_UNDO_YET_LABEL,
  REDO_LABEL,
  REMIX_REQUEST_WORDS,
  SAVED_LABEL,
  SAVE_LABEL,
  SAVING_LABEL,
  UNDO_LABEL,
  UNSAVED_CHANGES_GROUP,
  cancelChangesTip,
  saveChangesLabel,
  saveChangesTip,
  type EditBarWords,
} from './words.ts';

/** What the bar shows and does. */
export interface EditBarModel {
  phase: 'off' | 'editing' | 'saving';
  count: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Cmd/Ctrl+S saves (shown on the Save tooltip). */
  keys?: boolean;
  undo(): void;
  redo(): void;
  cancel(): void;
  save(): void;
}

/** A press on the bar keeps the caret where it is in the page. */
function keepEditFocus(event: MouseEvent): void {
  event.preventDefault();
}

/**
 * Where focus goes when the bar goes away while it held focus (Save or Cancel pressed from the keyboard): the toolbar's
 * Sources button, else the page's content. Nothing moves while the window is in the background.
 */
export function focusAfterEditBar(): void {
  if (!document.hasFocus()) return;
  const sources = document.querySelector<HTMLElement>('[data-dash-sources] button');
  sources?.focus({ preventScroll: true });
  if (sources !== null && document.activeElement === sources) return;
  document.querySelector<HTMLElement>('[data-dash-content]')?.focus({ preventScroll: true });
}

/**
 * The bar; `words` replaces the hand-edit words (a draft, a remix request). When it goes away with focus inside and
 * focus lands nowhere, `onGone` puts it somewhere ({@link focusAfterEditBar} by default).
 */
export function EditBar({
  edit,
  words,
  tipSide = 'bottom',
  onGone = focusAfterEditBar,
}: {
  edit: EditBarModel;
  words?: EditBarWords;
  tipSide?: ChromeSide;
  onGone?: () => void;
}): ReactNode {
  const saving = edit.phase === 'saving';
  const shortcut = edit.keys === true && edit.count > 0 ? `${MOD}S` : undefined;
  const handoff = useFocusHandoff<HTMLDivElement>(onGone);
  return (
    <Card ref={handoff} role="group" aria-label={words?.group ?? UNSAVED_CHANGES_GROUP} className="p-1">
      <EditHistoryButtons edit={edit} words={words} tipSide={tipSide} />
      <ChromeDivider />
      <TipButton
        square
        aria-label={CANCEL_LABEL}
        tip={saving ? CANT_CANCEL_WHILE_SAVING : (words?.cancel ?? cancelChangesTip(edit.count))}
        side={tipSide}
        disabled={saving}
        onMouseDown={keepEditFocus}
        onClick={edit.cancel}
      >
        <X className="size-4" />
      </TipButton>
      <Tip label={edit.count === 0 && !saving ? (words?.noSave ?? NOTHING_TO_SAVE_YET) : (words?.saves ?? saveChangesTip(edit.count))} shortcut={shortcut} side={tipSide}>
        <span className="inline-flex">
          <Button
            variant="primary"
            aria-label={saving ? SAVING_LABEL : words !== undefined || edit.count === 0 ? SAVE_LABEL : saveChangesLabel(edit.count)}
            aria-busy={saving || undefined}
            disabled={saving || edit.count === 0}
            onMouseDown={keepEditFocus}
            onClick={edit.save}
          >
            {saving ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            {SAVE_LABEL}
            {words === undefined ? (
              <span aria-hidden="true" className={cn('ms-1 rounded-full bg-white/20 px-1.5 text-[11px] tabular-nums', edit.count === 0 && 'invisible')}>
                {edit.count}
              </span>
            ) : null}
          </Button>
        </span>
      </Tip>
    </Card>
  );
}

/**
 * The bar's Undo and Redo. `alone`: drawn on their own (where hand edits and the agent's changes go into a shared
 * draft, there is no Save or Cancel), in a card that stays usable while the rest of the toolbar waits.
 */
export function EditHistoryButtons({
  edit,
  words,
  tipSide = 'bottom',
  alone = false,
}: {
  edit: Pick<EditBarModel, 'phase' | 'canUndo' | 'canRedo' | 'undo' | 'redo'>;
  words?: Pick<EditBarWords, 'noUndo' | 'noRedo'>;
  tipSide?: ChromeSide;
  alone?: boolean;
}): ReactNode {
  const saving = edit.phase === 'saving';
  const buttons = (
    <>
      <TipButton
        square
        aria-label={UNDO_LABEL}
        tip={saving ? CANT_UNDO_WHILE_SAVING : edit.canUndo ? UNDO_LABEL : (words?.noUndo ?? NOTHING_TO_UNDO_YET_LABEL)}
        shortcut={edit.canUndo && !saving ? `${MOD}Z` : undefined}
        side={tipSide}
        disabled={saving || !edit.canUndo}
        onMouseDown={keepEditFocus}
        onClick={edit.undo}
      >
        <Undo2 className="size-4" />
      </TipButton>
      <TipButton
        square
        aria-label={REDO_LABEL}
        tip={saving ? CANT_REDO_WHILE_SAVING : edit.canRedo ? REDO_LABEL : (words?.noRedo ?? NOTHING_TO_REDO_LABEL)}
        shortcut={edit.canRedo && !saving ? `${SHIFT}${MOD}Z` : undefined}
        side={tipSide}
        disabled={saving || !edit.canRedo}
        onMouseDown={keepEditFocus}
        onClick={edit.redo}
      >
        <Redo2 className="size-4" />
      </TipButton>
    </>
  );
  if (!alone) return buttons;
  return (
    <Card data-usable="" className="dash-edit-history gap-0.5 p-1">
      {buttons}
    </Card>
  );
}

/** A status line in place of the bar; "Saved" gets a check. */
export function EditStatus({ words }: { words: string }): ReactNode {
  return (
    <span role="status" className="flex items-center gap-1.5 text-[13px] text-chrome-muted">
      {words === SAVED_LABEL ? <Check className="size-3.5" aria-hidden="true" /> : null}
      {words}
    </span>
  );
}

/** The agent works on what this bar would save. */
export function AgentWorking({ words = DRAFT_WORKING_LABEL }: { words?: string }): ReactNode {
  return (
    <Card role="status" className="gap-1.5 px-3 py-1.5 text-[13px] text-chrome-muted">
      <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
      {words}
    </Card>
  );
}

/** The hand-edit bar, its status, or the agent working to make the page editable. Null when none shows. */
export function PageEditBar({ tipSide }: { tipSide?: ChromeSide }): ReactNode {
  const flow = useEditFlow();
  const commenting = useShown((state) => state.commenting);
  const viewingVersion = useShown((state) => state.version !== null);
  const keys = flow.phase === 'editing' && flow.dialog === null && !commenting;
  useEditKeys(keys, (key, repeat) => {
    if (key === 'save') {
      if (!repeat) void savePageEdits();
    } else if (key === 'undo') undoPageEdit();
    else redoPageEdit();
    return true;
  });
  if (flow.joint && flow.phase !== 'off') {
    if (flow.canUndo || flow.canRedo)
      return (
        <EditHistoryButtons
          alone
          tipSide={tipSide}
          edit={{ phase: flow.phase, canUndo: flow.canUndo, canRedo: flow.canRedo, undo: undoPageEdit, redo: redoPageEdit }}
        />
      );
    return flow.status === null ? null : <EditStatus words={flow.status} />;
  }
  const shown = flow.phase !== 'off' && (flow.count > 0 || flow.phase === 'saving' || flow.canUndo || flow.canRedo);
  if (shown)
    return (
      <EditBar
        tipSide={tipSide}
        edit={{
          phase: flow.phase,
          count: flow.count,
          canUndo: flow.canUndo,
          canRedo: flow.canRedo,
          keys,
          undo: undoPageEdit,
          redo: redoPageEdit,
          cancel: cancelPageEdits,
          save: () => void savePageEdits(),
        }}
      />
    );
  if (flow.status !== null) return <EditStatus words={flow.status} />;
  if (flow.converting === 'working' && !viewingVersion) return <AgentWorking words={EDIT_WAITING_MESSAGE} />;
  return null;
}

/** The draft bar (or the remix request's), the working mark, or the draft status. Null when none shows. */
export function DraftBar({ tipSide }: { tipSide?: ChromeSide }): ReactNode {
  const flow = useDraftFlow();
  const free = useShown(areDraftsFree);
  const { view } = flow;
  const barShown = isDraftBarShown(view, free);
  useEditKeys(view.ready && view.held && free && flow.asking === null, (key) => {
    if (!view.can[key]) return false;
    if (key === 'save') saveDraft();
    else if (key === 'undo') undoDraft();
    else redoDraft();
    return true;
  });
  if (barShown)
    return (
      <EditBar
        tipSide={tipSide}
        words={view.unstarted ? REMIX_REQUEST_WORDS : DRAFT_BAR_WORDS}
        edit={{
          phase: flow.saving ? 'saving' : 'editing',
          count: view.showing ? 1 : 0,
          canUndo: view.can.undo,
          canRedo: view.can.redo,
          keys: view.can.save,
          undo: undoDraft,
          redo: redoDraft,
          cancel: cancelDraft,
          save: saveDraft,
        }}
      />
    );
  if (isDraftWorkingShown(view, free)) return <AgentWorking />;
  if (flow.status !== null) return <EditStatus words={flow.status} />;
  return null;
}
