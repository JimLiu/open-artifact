/**
 * Boot: connects the session, follows the color scheme, restores this tab's
 * camera, connects the Shell and the agent, starts live sync, collaboration,
 * exports and version history, and installs the board's input (tools, hover, keys,
 * clipboard, drops, the text editor's host). Returns a function that stops everything.
 */

import { surfaceRef } from '../canvas/BoardSurface.tsx';
import { connectShell } from '@open-artifact/runtime';
import { startCollab } from '../collab/index.ts';
import { setBoardRevealed } from '../state/board.ts';
import { followColorScheme } from '../state/theme.ts';
import { installBenchHook } from './bench.ts';
import { installHover } from '../tools/index.ts';
import { primeAgentState, watchAgent, whenAgentSettled } from './agent.ts';
import { announce } from './announce.ts';
import { startDrawingLooks } from './drawing-looks.ts';
import { startAutoFit } from './auto-fit.ts';
import { installClipboard } from './clipboard.ts';
import { startCropMemory } from './crop.ts';
import { installDrop } from './drop.ts';
import { startExport } from './export.ts';
import { installKeyboard } from './keyboard.ts';
import { installRegions } from './regions.ts';
import { startSession } from './session.ts';
import { setShellReport, startShell } from './shell.ts';
import { startSync } from './sync.ts';
import { installTextEditHost } from './text-host.ts';
import { startTextMetrics } from './text-metrics.ts';
import { startTextPush } from './text-push.ts';
import { startTurnedAnchors } from './turned-anchor.ts';
import { startVersionHistory } from './version-history.ts';
import { boardStorageKey, keepCameraRemembered, restoreCamera } from './viewport.ts';

/**
 * Starts the board. Call after the board surface has mounted (its input
 * listeners attach to it). Rejects when the page cannot reach its
 * document store.
 */
export async function startBoard(signal?: AbortSignal): Promise<() => Promise<void>> {
  signal?.throwIfAborted();
  setBoardRevealed(false);
  const connection = connectShell();
  const cameraKey = boardStorageKey(connection);
  primeAgentState();
  const ownView = restoreCamera(cameraKey, location.pathname);
  const stops: Array<() => void | Promise<void>> = [];
  if (connection) stops.push(() => connection.dispose());
  const stopAll = async (): Promise<void> => {
    const stopped = await Promise.allSettled(stops.splice(0).reverse().map(async stop => stop()));
    setBoardRevealed(false);
    for (const result of stopped) if (result.status === 'rejected') throw result.reason;
  };
  try {
    connection?.report({ ready: false, saved: 'loading' });
    stops.push(followColorScheme());
    stops.push(startTextMetrics());
    await startSession(connection);
    signal?.throwIfAborted();
    stops.push(keepCameraRemembered(cameraKey));
    setShellReport({ ready: false, saved: 'loading' });
    stops.push(startShell());
    stops.push(watchAgent());
    stops.push(startSync({ announce }));
    signal?.throwIfAborted();
    stops.push(startAutoFit({ ownView }));
    stops.push(startCollab());
    stops.push(startExport());
    stops.push(startDrawingLooks());
    stops.push(startVersionHistory());
    stops.push(installKeyboard());
    stops.push(installRegions());
    stops.push(startCropMemory());
    stops.push(installClipboard());
    stops.push(installTextEditHost());
    stops.push(startTextPush());
    stops.push(startTurnedAnchors());
    stops.push(installBenchHook());
    const surface = surfaceRef.current;
    if (surface) {
      stops.push(installHover(surface));
      stops.push(installDrop(surface));
    }
    await whenAgentSettled();
    signal?.throwIfAborted();
    return stopAll;
  } catch (error) {
    const clearReport = async () => connection?.report(signal?.aborted ? {} : { ready: true, saved: 'loadError' });
    await Promise.allSettled([clearReport(), stopAll()]);
    throw error;
  }
}
