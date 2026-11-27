/** Asks before a past version replaces the tab's text. */
import { ConfirmDialog } from '@open-artifact/ui';
import { type ReactNode } from 'react';
import { useDocs } from '../app/store.ts';
import { FIRST_SAVED_RESTORE_NOTE, isFirstSaved } from './compare-target.ts';
import { restorePreview } from './data.ts';
import { fullTime } from './groups.ts';
import { restoreNote } from './restore-note.ts';
import { setHistory, useVersionHistory, versionKey } from './store.ts';

export function RestoreDialog(): ReactNode {
  const open = useVersionHistory(state => state.confirmRestore);
  const preview = useVersionHistory(state => state.preview);
  const pending = useDocs(state => (preview ? state.suggestions[preview.tab] : undefined));
  const version = useVersionHistory(state => (preview ? (state.docs[versionKey(preview.tab, preview.rev)] ?? null) : null));
  const versions = useVersionHistory(state => state.versions);
  const compare = useVersionHistory(state => state.compare);
  const baseUnread = useVersionHistory(state => (preview?.base == null ? true : !!state.docErrors[versionKey(preview.tab, preview.base)]));
  if (!preview || preview.current) return null;
  const when = fullTime(preview.at);
  const what =
    preview.count > 1
      ? `The tab will be set to the newest of the ${preview.count} versions in this group, saved ${when}.`
      : `The tab will be set to its state from ${when}.`;
  const note = restoreNote(pending ?? [], version);
  const suggestions = note ? ` ${note}` : '';
  // Said while the preview shows this version's changes against the tab as first saved.
  const compared = compare && !baseUnread && isFirstSaved(versions, preview.base) ? ` ${FIRST_SAVED_RESTORE_NOTE}` : '';
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={next => setHistory({ confirmRestore: next })}
      title="Restore this version"
      description={`${what}${compared} Restoring creates a new version with this content; your current version stays in history.${suggestions}`}
      confirmLabel="Restore"
      onConfirm={() => void restorePreview()}
    />
  );
}
