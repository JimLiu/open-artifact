/** The words of the edit bar, drafts, remix and hand edits. */

export const SAVE_LABEL = 'Save';
export const SAVED_LABEL = 'Saved';
export const SAVING_LABEL = 'Saving…';
export const UNDO_LABEL = 'Undo';
export const REDO_LABEL = 'Redo';
export const CANCEL_LABEL = 'Cancel';
export const NOTHING_TO_UNDO_YET_LABEL = 'Nothing to undo yet';
export const NOTHING_TO_UNDO_LABEL = 'Nothing to undo';
export const NOTHING_TO_REDO_LABEL = 'Nothing to redo';
export const CANT_UNDO_WHILE_SAVING = 'Can’t undo while saving';
export const CANT_REDO_WHILE_SAVING = 'Can’t redo while saving';
export const CANT_CANCEL_WHILE_SAVING = 'Can’t cancel while saving';
export const NOTHING_TO_SAVE_YET = 'Nothing to save yet';
export const UNSAVED_CHANGES_GROUP = 'Unsaved changes';

export function countChanges(count: number): string {
  return count === 1 ? '1 change' : `${count} changes`;
}

export function saveChangesLabel(count: number): string {
  return `Save ${countChanges(count)}`;
}

export function cancelChangesTip(count: number): string {
  return count === 0 ? CANCEL_LABEL : `Cancel: discard ${countChanges(count)}`;
}

export function saveChangesTip(count: number): string {
  return count === 1 ? 'Make this change live for everyone with access' : 'Make these changes live for everyone with access';
}

/** What the edit bar says instead of its hand-edit words (a draft, or a remix request with no draft yet). */
export interface EditBarWords {
  group: string;
  noUndo: string;
  noRedo: string;
  cancel: string;
  saves: string;
  noSave: string;
}

export const DRAFT_BAR_WORDS: EditBarWords = {
  group: 'Draft',
  noUndo: 'Showing the saved artifact',
  noRedo: 'Showing the draft',
  cancel: 'Cancel: discard the draft',
  saves: 'Save this draft for everyone with access',
  noSave: 'Redo to show the draft, then save',
};

export const STYLE_BAR_WORDS: EditBarWords = {
  group: 'Style',
  noUndo: 'Use Cancel to discard style changes',
  noRedo: 'No style change to redo',
  cancel: 'Cancel: discard these style changes',
  saves: 'Make this style live for others too',
  noSave: 'No style change to save',
};

export const REMIX_REQUEST_WORDS: EditBarWords = {
  group: 'Draft request',
  noUndo: 'Showing the saved artifact',
  noRedo: 'No new draft to show yet',
  cancel: 'Cancel the request',
  saves: 'Save this draft for everyone with access',
  noSave: 'No new draft to save yet',
};

/** Why the pencil is off. */
export const EDIT_UNAVAILABLE_REASONS = {
  older_version: 'Go back to the latest version to edit',
  agent_working: 'The agent is working. You can edit when it’s done.',
  draft_open: 'Save or cancel the draft to edit',
  comments_on: 'Turn off comments to edit',
  needs_agent: 'Ask the agent to make this artifact editable.',
} as const;
export type EditUnavailableReason = keyof typeof EDIT_UNAVAILABLE_REASONS;
export const EDIT_TOOL_TOOLTIP = 'Edit the page';
export const SAVE_OR_CANCEL_FIRST_LABEL = 'Save or cancel your changes first.';
export const EDIT_WAITING_MESSAGE = EDIT_UNAVAILABLE_REASONS.agent_working;
export const READY_TO_EDIT_LABEL = 'Ready to edit';
export const CHANGES_DISCARDED_LABEL = 'Changes discarded';

export const SAVE_FAILED_MESSAGE = 'Couldn’t save your changes.';
export const TRY_AGAIN_LABEL = 'Try again.';
export const CANCEL_AND_ASK_MESSAGE = 'Cancel them, then ask the agent to make the same changes.';
export const EDIT_ACCESS_LOST_MESSAGE = 'You may no longer be able to edit this artifact.';
export const EDIT_BEHIND_MESSAGE = 'This artifact changed. Save to overwrite that change, or Cancel to see it.';

export const DRAFT_READ_ONLY_MESSAGE = 'You can’t edit this artifact right now, so the draft can’t be saved.';
export const DRAFT_UNREADABLE_MESSAGE = 'The draft couldn’t be read, so nothing was saved. Try again.';
export const DRAFT_CHANGED_MESSAGE = 'The draft changed since it was shown, so nothing was saved. Look it over and save again.';
export const DRAFT_GONE_MESSAGE = 'This draft was already saved or discarded.';
export const DRAFT_PARTLY_SAVED_MESSAGE = 'Saving stopped partway, so the artifact may be partly changed. Press Save again to finish.';
export const DRAFT_DISCARD_FAILED_MESSAGE = 'Couldn’t discard the draft. Try again.';
export const DRAFT_START_FAILED_MESSAGE = 'Couldn’t start the draft. Pick a format under Design again.';
export const DRAFT_BEHIND_MESSAGE =
  'This artifact changed after the draft was made. Save replaces that change with the draft. Cancel discards the draft and keeps the change.';
export const DRAFT_SHOWN_MESSAGE = 'Showing the draft. Only people who can edit can see it until you save.';
export const DRAFT_HIDDEN_MESSAGE = 'Showing the saved artifact.';
export const DRAFT_DISCARDED_LABEL = 'Draft discarded';
export const REQUEST_CANCELED_LABEL = 'Request canceled';
export const CANCEL_REQUEST_FAILED_MESSAGE = 'Couldn’t cancel the request. Try again.';
export const DRAFT_READY_MESSAGE = 'The draft is ready to save or cancel.';
export const DRAFT_WORKING_LABEL = 'The agent is working';

export const DRAFT_PICK_FORMAT_MESSAGE = 'Pick a format for a new draft. Nothing changes until you save.';
export const DRAFT_PICK_FORMAT_REPLACES_MESSAGE =
  'Pick a format for a new draft to replace your current one. Nothing else changes until you save.';
export const REMIX_FORMAT_TITLE = 'Format';
export const VIEW_DRAFT_LABEL = 'View draft';

export function draftWaitingMessage(name: string): string {
  return name === '' ? 'Someone else has a draft waiting.' : `${name} has a draft waiting.`;
}

export type DraftQuestion = 'save' | 'discard';

/**
 * The save / discard dialog's title; `whose` is null for the viewer's own draft (the shared draft asks before it is
 * published), "" when the owner's name is unknown.
 */
export function draftQuestionTitle(what: DraftQuestion, whose: string | null): string {
  if (what === 'save') return whose === null ? 'Publish this draft?' : whose ? `Save ${whose}’s draft?` : 'Save someone else’s draft?';
  if (whose === null) return 'Discard this draft?';
  return whose === '' ? 'Discard someone else’s draft?' : `Discard ${whose}’s draft?`;
}

export const DRAFT_SAVE_DESCRIPTION = 'Everyone with access will see it. The agent may still be working on it in the chat it came from.';
export const DRAFT_DISCARD_DESCRIPTION = 'The artifact stays as it is. The draft can’t be brought back.';
export const KEEP_DRAFT_LABEL = 'Keep draft';
export const DISCARD_LABEL = 'Discard';

export const ASK_AGENT_LABEL = 'Ask the agent';
export const CONVERT_TITLE = 'Ask the agent to make this artifact editable?';
export const CONVERT_DESCRIPTION = 'This artifact can’t be edited by hand yet. Ask the agent to rewrite it so it can be.';
export const NOT_NOW_LABEL = 'Not now';
export const KEEP_EDITING_LABEL = 'Keep editing';
export const ASK_TITLE = 'Save your changes first?';
export const DISCARD_AND_ASK_LABEL = 'Discard and ask';
export const SAVE_AND_ASK_LABEL = 'Save and ask';

export function discardTitle(title: string): string {
  return `Discard your changes to ${title}?`;
}

export function discardDescription(count: number): string {
  return count === 1 ? `${count} change hasn’t been saved.` : `${count} changes haven’t been saved.`;
}

export function askDescription(count: number): string {
  return `The agent works from the saved artifact, so it won’t see your ${count} unsaved ${count === 1 ? 'change' : 'changes'}.`;
}

/** The reference the agent reads to make an older page editable by hand. */
export const ONE_WRITER_REFERENCE_PATH = 'reference/one-writer.md';

/** Sent to the agent when the person asks for the page to be made editable by hand. */
export const MAKE_EDITABLE_REQUEST = 'Rewrite this page so it can be edited by hand. Keep what it shows and how it looks.';

/** The selection sent with {@link MAKE_EDITABLE_REQUEST}: `misparsed` when its HTML does not read back the same. */
export function describeUneditablePage(misparsed: boolean): { label: string; chip: { about: 'convert' }; text: string } {
  return {
    label: 'Make editable',
    chip: { about: 'convert' },
    text:
      'From the dashboard’s page, to make this dashboard editable. ' +
      (misparsed
        ? 'Its HTML doesn’t read back as the same page once parsed and written out again (a misnested or unclosed tag, say), so it can’t be edited by hand.'
        : 'It can’t be edited by hand as it is stored.') +
      ` See ${ONE_WRITER_REFERENCE_PATH}.`,
  };
}

/** The shared draft: publishing, discarding, seeing it and restoring it. */
export const PUBLISH_LABEL = 'Publish';
export const PUBLISHED_LABEL = 'Published';
export const PUBLISHING_LABEL = 'Publishing…';
export const SEE_PUBLISHED_LABEL = 'See published';
export const SEE_DRAFT_LABEL = 'See draft';
export const SEE_HISTORY_LABEL = 'See history';
export const AUTO_PUBLISH_LABEL = 'Auto-publish';
export const DISCARD_DRAFT_LABEL = 'Discard draft';
export const REVERT_LABEL = 'Revert';
export const VERSION_OPTIONS_LABEL = 'Version options';
export const DRAFT_OPTIONS_LABEL = 'Draft options';
export const DRAFT_SEEN_BY_ALL_LABEL = 'Everyone with access can see this draft';
export const REVERT_TITLE = 'Revert to the previous version?';
export const AUTO_PUBLISH_TITLE = 'Turn on auto-publish?';
export const AUTO_PUBLISH_DESCRIPTION = 'Unpublished changes go live now. After that, edits go live automatically.';
export const TURN_ON_LABEL = 'Turn on';
export const AUTO_PUBLISH_FAILED_MESSAGE = 'Couldn’t change auto-publish.';
export const YOU_LABEL = 'you';
export const AGENT_LABEL = 'the agent';
export const SOMEONE_ELSE_LABEL = 'someone else';
export const SOMEONE_LABEL = 'Someone';

export const SHARED_SHOWN_MESSAGE = 'Showing the draft.';
export const SHARED_HIDDEN_MESSAGE = 'Showing the published artifact.';
export const SHARED_READY_MESSAGE = 'The draft is ready to publish or discard.';
export const SHARED_BEHIND_MESSAGE =
  'This artifact changed after the draft was started. Look the draft over before you publish, since it may undo that change.';
export const SHARED_READ_ONLY_MESSAGE = 'You can’t edit this artifact right now, so the draft can’t be published.';
export const SHARED_UNREADABLE_MESSAGE = 'The draft couldn’t be read, so nothing was published. Try again.';
export const SHARED_CHANGED_MESSAGE = 'The draft changed since it was shown, so nothing was published. Look it over and publish again.';
export const SHARED_GONE_MESSAGE = 'This draft was already published or discarded.';
export const SHARED_PARTLY_PUBLISHED_MESSAGE = 'Publishing stopped partway, so the artifact may be partly changed. Publish again to finish.';
export const SHARED_AGENT_WORKING_MESSAGE = 'The agent is working. You can publish when it’s done.';
export const SHARED_OTHERS_HOLD_MESSAGE =
  'The draft also has someone else’s changes, so it wasn’t published automatically. You can still publish it.';
export const SHARED_LEFT_MESSAGE = 'Someone changed the draft in the meantime. Their changes are still in it.';
export const STEP_MOVED_MESSAGE = 'Someone has changed the draft since, so it was left as it is.';
export const STEP_FAILED_MESSAGE = 'Couldn’t change the draft. Try again.';
export const CHANGE_UNDONE_LABEL = 'Change undone';
export const CHANGE_REDONE_LABEL = 'Change redone';
export const DRAFT_DISCARDED_TOAST = 'Draft discarded.';
export const DRAFT_RESTORED_MESSAGE = 'Draft restored.';
export const DRAFT_RESTORE_FAILED_MESSAGE = 'Couldn’t restore the draft. Try again from History.';
export const DRAFT_RESTORE_GONE_MESSAGE = 'This draft was already restored, or is too old to restore.';
export const REPLACE_NEWER_TITLE = 'Replace newer changes in the draft?';
export const REPLACE_NEWER_DESCRIPTION = 'The draft has changes to the same parts. Restoring replaces them, and they can’t be brought back.';
export const KEEP_NEWER_LABEL = 'Keep newer changes';
export const RESTORE_DRAFT_LABEL = 'Restore';
export const UNDO_TOAST_LABEL = 'Undo';
export const REVERTED_LABEL = 'Restored.';
export const REVERT_MOVED_MESSAGE = 'This artifact just changed, so nothing was reverted. Try again.';
export const OPEN_DRAFT_LABEL = 'Draft';
export const PAGE_CHANGED_ELSEWHERE_MESSAGE = 'Someone else changed this page, so your last change wasn’t kept.';

/** "{when} by {name}" for the version menu's heading. */
export function versionMadeBy(when: string, name: string): string {
  return name === '' ? when : `${when} by ${name}`;
}

/** What the question before reverting says under its title. */
export function revertDescription(version: string): string {
  return `${version}. Everyone will see it.`;
}

/** The toast when someone else settles the shared draft. */
export function sharedSettledMessage(what: 'saved' | 'discarded', left: boolean, name: string): string {
  if (what === 'saved') return `${name} published the draft.`;
  return left ? `${name} discarded the draft. Some changes are still in it.` : `${name} discarded the draft.`;
}

/** What the publish / discard question says; `names` is null without others' changes, "" when their names are unknown. */
export function sharedQuestionDescription(what: DraftQuestion, names: string | null): string {
  if (what === 'save') {
    return names ? `It holds changes by ${names}. Everyone with access will see them.` : 'It holds other people’s changes. Everyone with access will see them.';
  }
  if (names === null) return 'The artifact stays as it is. The draft can be restored from History.';
  return names === ''
    ? 'It holds other people’s changes. The artifact stays as it is, and the draft can be restored from History.'
    : `It holds changes by ${names}. The artifact stays as it is, and the draft can be restored from History.`;
}

/** A discarded draft's row in History. */
export function discardedDraftTitle(name: string): string {
  return `${name} discarded a draft`;
}

/** The spoken name of a discarded draft's Restore button. */
export function restoreDraftLabel(when: string): string {
  return `Restore the draft from ${when}`;
}

/** Why the remix formats wait. */
export const REMIX_SHARED_HELD_MESSAGE = 'Publish or discard the draft to pick a format.';
export const REMIX_STYLE_HELD_MESSAGE = 'Save or cancel your style changes to pick a format or change the design system.';
