/** The share actions behind "Load data using": share, stop sharing, and share again after a save. */

import { toast } from '@open-artifact/ui';
import { DELETE_FIELD, prepareDashboardContent, type Dataset } from '@open-artifact/data-core';
import { maybeDataEngine } from '../data/engine.ts';
import { ShareRouteError, collectSharedCalls } from '../data/shared-access.ts';
import { joinSentences } from '../data/util.ts';
import { maybeSession } from '../services/session.ts';
import { useDocument } from '../state/document.ts';
import { SETTING_NOT_SAVED_MESSAGE } from './refresh.ts';
import { writeSettings } from '../sync/index.ts';
import { SETTINGS_ECHO_MS, shareFailedMessage, sharedAsWrittenMessage, track, unshareFailedMessage, waitForDocumentEcho } from './run-as.ts';

/** Writes `dash/settings` and resolves once the document read it back (or after a while). */
export async function writeSettingsRead(patch: Record<string, unknown>, waitMs = SETTINGS_ECHO_MS): Promise<void> {
  const before = useDocument.getState().content;
  await writeSettings(patch);
  await waitForDocumentEcho(before, waitMs);
}

function liveDatasets(): readonly Dataset[] {
  return prepareDashboardContent(useDocument.getState().content).datasets;
}

function shareErrorMessage(connector: string, error: unknown, sharing: boolean): string {
  if (sharing && error instanceof ShareRouteError && error.code === 'invalid_argument') return sharedAsWrittenMessage(connector);
  return sharing ? shareFailedMessage(connector) : unshareFailedMessage(connector);
}

/** Shares (or reshares) the connector for every source call on it now. */
async function reshare(connector: string): Promise<void> {
  const engine = maybeDataEngine();
  if (engine === null) throw new Error('No data engine.');
  await engine.sharedAccess.share(connector, collectSharedCalls(connector, liveDatasets()));
}

/** "Your access": shares the connector, then marks it shared, then loads its sources again. */
export function shareConnector(connector: string): Promise<void> {
  return track(
    connector,
    (async () => {
      const viewer = maybeSession()?.viewer;
      if (viewer === undefined) return;
      try {
        await reshare(connector);
      } catch (error) {
        toast.add({ title: shareErrorMessage(connector, error, true) });
        return;
      }
      try {
        await writeSettingsRead({ shared: { [connector]: { id: viewer.id, name: viewer.name, at: Date.now() } } });
      } catch (error) {
        const said = error instanceof Error ? error.message : '';
        toast.add({ title: said === '' ? SETTING_NOT_SAVED_MESSAGE : joinSentences(SETTING_NOT_SAVED_MESSAGE, said) });
        await maybeDataEngine()?.sharedAccess.share(connector, []).catch(() => undefined);
        return;
      }
      maybeDataEngine()?.retry(connector);
    })(),
  );
}

/** "Each viewer": stops sharing, then drops the mark, then loads its sources again. */
export function stopSharingConnector(connector: string): Promise<void> {
  return track(
    connector,
    (async () => {
      try {
        await maybeDataEngine()?.sharedAccess.share(connector, []);
      } catch (error) {
        toast.add({ title: shareErrorMessage(connector, error, false) });
        return;
      }
      try {
        await writeSettingsRead({ shared: { [connector]: DELETE_FIELD } });
      } catch (error) {
        const said = error instanceof Error ? error.message : '';
        toast.add({ title: said === '' ? SETTING_NOT_SAVED_MESSAGE : joinSentences(SETTING_NOT_SAVED_MESSAGE, said) });
        return;
      }
      maybeDataEngine()?.retry(connector);
    })(),
  );
}

/** Whether this viewer (the owner) shares the connector. */
export function isSharedByMe(connector: string): boolean {
  const viewer = maybeSession()?.viewer;
  const mark = useDocument.getState().content.shared?.[connector];
  return viewer !== undefined && viewer.role === 'owner' && mark !== undefined && mark.id === viewer.id;
}

/**
 * After a source on a connector this viewer shares was saved: shares its calls as they are now, marks the share
 * anew (so every open page drops what it knew of the old one and loads again), then loads the connector's sources
 * again here. A failed reshare says so; the save itself stands.
 */
export async function reshareAfterSave(connector: string): Promise<void> {
  if (!isSharedByMe(connector)) return;
  await track(
    connector,
    (async () => {
      try {
        await reshare(connector);
      } catch (error) {
        toast.add({ title: shareErrorMessage(connector, error, true) });
        return;
      }
      const viewer = maybeSession()?.viewer;
      if (viewer === undefined) return;
      await writeSettingsRead({ shared: { [connector]: { id: viewer.id, name: viewer.name, at: Date.now() } } }).catch((error: unknown) => {
        const said = error instanceof Error ? error.message : '';
        toast.add({ title: said === '' ? SETTING_NOT_SAVED_MESSAGE : joinSentences(SETTING_NOT_SAVED_MESSAGE, said) });
      });
    })(),
  );
  maybeDataEngine()?.retry(connector);
}
