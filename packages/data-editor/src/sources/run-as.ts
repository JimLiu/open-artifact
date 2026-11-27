/**
 * Whose connector access a connector's sources load with ("Load data using"): its words, busy state and settings echo.
 *
 * Each viewer: every viewer's own connectors (the owner's page alone has any). Your access: the owner shares the
 * connector for the exact source calls the dashboard makes, so everyone who opens it sees those results. The choice
 * is kept in `dash/settings.shared`; the approvals are kept on the owner's computer. The actions are in
 * `run-as-actions.ts`.
 */

import { create } from 'zustand';
import type { ConnectorShareMark } from '@open-artifact/data-core';
import { useDocument } from '../state/document.ts';

/* ---- words ------------------------------------------------------------------------------------------------------- */

export const LOAD_DATA_USING_LABEL = 'Load data using';
export const EACH_VIEWER_LABEL = 'Each viewer';
export const EACH_VIEWER_DESCRIPTION = 'This artifact uses each viewer’s own connectors.';
export const YOUR_ACCESS_LABEL = 'Your access';
export const YOUR_ACCESS_DESCRIPTION = 'This artifact lets everyone use your connector access.';
export const YOU_SHORT_LABEL = 'You';
export const SOMEONE_ELSE_LABEL = 'Someone else';
export const BETA_LABEL = 'Beta';
export const YOUR_ACCESS_NOTE = 'With Your access, permission is granted only to the exact queries needed.';
export const CANT_PICK_OTHERS_MESSAGE = 'You can’t pick someone else’s access.';
export const NOTHING_SHAREABLE_MESSAGE = 'None of these queries can be shared as written.';
export const LOCKED_IN_VIEW_MESSAGE = 'Whose access it uses can’t be changed in this view.';
export const EDITORS_ONLY_MESSAGE = 'Only editors can change this, and not while viewing a draft.';
export const SHARE_LABEL = 'Share';

export const othersAccessLabel = (name: string): string => (name === '' ? 'Someone else’s access' : `${name}’s access`);
export const replacesAccessDescription = (name: string): string => `Replaces ${name === '' ? 'someone else' : name}’s access with yours.`;
export const usesSharedAccessDescription = (name: string): string =>
  `Uses ${name === '' ? 'someone else' : name}’s connector access for the exact queries they shared.`;
export const runAsTriggerLabel = (connector: string, access: string): string => `${connector}: ${LOAD_DATA_USING_LABEL} ${access}`;

const queries = (count: number): string => `${count} ${count === 1 ? 'query' : 'queries'}`;

/** "You’re sharing access to 3 queries." and the like. */
export function describeSharingLine(mark: ConnectorShareMark, mine: boolean, count: number): string {
  if (mine) return `You’re sharing access to ${queries(count)}.`;
  return `${mark.name === '' ? SOMEONE_ELSE_LABEL : mark.name} is sharing access to ${queries(count)}.`;
}

export const shareFailedMessage = (connector: string): string => `Couldn’t share ${connector} access. Try again, or reload the whole page.`;
export const unshareFailedMessage = (connector: string): string => `Couldn’t stop sharing ${connector} access. Try again, or reload the whole page.`;
export const sharedAsWrittenMessage = (connector: string): string =>
  `${connector} access can’t be shared with its queries as written. Ask the agent to check them.`;

/* ---- who --------------------------------------------------------------------------------------------------------- */

/** A person's first name, for the short trigger label. */
export function shortPersonName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** The trigger's short text: Each viewer, You, the sharer's first name, or Someone else. */
export function runAsShortLabel(mark: ConnectorShareMark | undefined, viewerId: string | null): string {
  if (mark === undefined) return EACH_VIEWER_LABEL;
  if (mark.id === viewerId) return YOU_SHORT_LABEL;
  return shortPersonName(mark.name) || SOMEONE_ELSE_LABEL;
}

/* ---- busy -------------------------------------------------------------------------------------------------------- */

interface RunAsBusyState {
  /** Connectors whose pick is saving, with the share mark's time when it began (`null`: none). */
  saving: Readonly<Record<string, number | null>>;
}

export const useRunAsBusy = create<RunAsBusyState>(() => ({ saving: {} }));

/** Keeps a connector's control busy until the work settles. */
export function track<T>(connector: string, work: Promise<T>): Promise<T> {
  const at = useDocument.getState().content.shared?.[connector]?.at ?? null;
  useRunAsBusy.setState((state) => ({ saving: { ...state.saving, [connector]: at } }));
  const done = (): void =>
    useRunAsBusy.setState((state) => {
      const { [connector]: _done, ...rest } = state.saving;
      return { saving: rest };
    });
  work.then(done, done);
  return work;
}

/** Whether the control shows busy: a pick is saving and nobody changed the share meanwhile. */
export function isRunAsBusy(saving: RunAsBusyState['saving'], connector: string, mark: ConnectorShareMark | undefined): boolean {
  return Object.hasOwn(saving, connector) && (saving[connector] ?? null) === (mark?.at ?? null);
}

/* ---- settings echo ----------------------------------------------------------------------------------------------- */

/** How long a settings write waits to read itself back. */
export const SETTINGS_ECHO_MS = 5000;

/** Resolves once the document's content is no longer `before` (or after `waitMs`). */
export function waitForDocumentEcho(before: unknown, waitMs = SETTINGS_ECHO_MS): Promise<void> {
  if (useDocument.getState().content !== before) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, waitMs);
    const stop = useDocument.subscribe((state) => {
      if (state.content !== before) finish();
    });
    function finish(): void {
      clearTimeout(timer);
      stop();
      resolve();
    }
  });
}
