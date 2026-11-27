/**
 * Starts the editor: the page's session, Shell and live sync first
 * (`startDataPage`), then the data engine, exports, drafts, hand edits,
 * history, comments, the side panels, the Shell's actions, source picking
 * and the Sources shortcut. Resolves to a function that stops everything.
 */

import { create } from 'zustand';
import { startDataEngine } from '../data/engine.ts';
import { startDraftFlow } from '../drafts/flow.ts';
import { startEditFlow } from '../drafts/edit-flow.ts';
import { startSharedDraft } from '../drafts/shared-flow.ts';
import { startDashboardExports } from '../export/index.ts';
import { startVersionHistory } from '../history/store.ts';
import { startDataPage } from '../platform/boot.ts';
import { maybeSession } from '../services/session.ts';
import { useDatasets } from '../state/datasets.ts';
import { getShownInputs } from '../state/shown.ts';
import { startComments } from './comments.ts';
import { startPanels, togglePanel } from './panels.ts';
import { startChromeActions } from './shell-actions.ts';
import { startSourcePicking } from './source-pick.ts';

const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"]';

/** Cmd/Ctrl+\ opens or closes Sources (not while comments are on or a dialog or menu is open). */
export function watchSourcesKey(target: Window): () => void {
  const key = (event: KeyboardEvent): void => {
    if ((event.key !== '\\' && event.code !== 'Backslash') || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    if (event.repeat || event.defaultPrevented || getShownInputs().commenting || target.document.querySelector(OVERLAY) !== null) return;
    event.preventDefault();
    togglePanel('sources');
  };
  target.addEventListener('keydown', key, true);
  return () => target.removeEventListener('keydown', key, true);
}

/** Tells the room which viewer this peer is (drafts name their people by it). */
function publishViewer(): void {
  const current = maybeSession();
  current?.room?.presence({ viewer: current.viewer.id }).catch(() => undefined);
}

export type AppPhase = 'starting' | 'ready' | 'failed';

export const useAppPhase = create<{ phase: AppPhase; error: string | null }>()(() => ({ phase: 'starting', error: null }));

export async function startDataApp(): Promise<() => void> {
  const stopPage = await startDataPage();
  const engine = startDataEngine({ store: useDatasets });
  const stops: (() => void)[] = [
    stopPage,
    () => engine.dispose(),
    startDashboardExports(),
    startDraftFlow(),
    startSharedDraft(),
    startEditFlow(),
    startVersionHistory(),
    startComments(),
    startPanels(),
    startChromeActions(),
    startSourcePicking(),
    watchSourcesKey(window),
  ];
  publishViewer();
  useAppPhase.setState({ phase: 'ready' });
  return () => {
    for (const stop of stops.reverse()) stop();
  };
}

/** Starts the editor once; a failure shows on the page instead of a blank one. */
export function bootDataApp(): void {
  startDataApp().catch((error: unknown) => {
    console.error('data: the editor could not start', error);
    useAppPhase.setState({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
  });
}
