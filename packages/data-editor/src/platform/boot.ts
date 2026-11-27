/**
 * Boot: follows the colour scheme, connects the session, the Shell and the
 * agent's status, then starts live sync. When the store cannot be reached
 * the page still renders, empty and read-only, saying why.
 */

import { guardComposingKeys } from '@open-artifact/ui/keys';
import { startSession, type Session } from '../services/session.ts';
import { startShell } from '../services/shell.ts';
import { useDocument } from '../state/document.ts';
import { LIVE_SYNC_UNAVAILABLE, startLiveDocument, stopLiveDocument } from '../sync/index.ts';
import { watchAgentActivity } from './agent-activity.ts';
import { followColorScheme } from './color-scheme.ts';
import { blockHeldKeyActivation } from './keys.ts';

/** Shows the page empty and read-only, with why. */
export function showUnavailable(reason: string): void {
  useDocument.setState({ status: 'unavailable', canWrite: false, readOnlyReason: reason, saveMessage: reason, save: 'saved', pending: 0 });
}

/**
 * Starts the page; resolves (never rejects) once live sync runs or the
 * fallback is shown. Returns a function that stops everything.
 */
export async function startDataPage(): Promise<() => void> {
  // First on the window, so an input method's Enter, Escape or Tab reaches no shortcut.
  const stops: (() => void)[] = [guardComposingKeys(window), followColorScheme(), blockHeldKeyActivation(window)];
  const stopAll = (): void => {
    for (const stop of stops.reverse()) stop();
    stops.length = 0;
  };
  let connected: Session;
  try {
    connected = await startSession();
  } catch (error) {
    console.warn('data: live sync unavailable in this view', error);
    showUnavailable(error instanceof Error && error.message !== '' ? error.message : LIVE_SYNC_UNAVAILABLE);
    return stopAll;
  }
  stops.push(startShell());
  stops.push(watchAgentActivity(connected.agent));
  try {
    await startLiveDocument();
    stops.push(() => void stopLiveDocument());
  } catch (error) {
    console.error('data (live store): boot failed', error);
    showUnavailable(LIVE_SYNC_UNAVAILABLE);
  }
  return stopAll;
}
