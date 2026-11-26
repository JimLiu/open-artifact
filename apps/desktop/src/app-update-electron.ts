import { app, autoUpdater, net } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { githubReleases, validateFeed } from './app-update-feed.ts';
import { AppUpdates, updateAvailability, type AppUpdateDeps } from './app-update.ts';
import { downloadUpdateZip, nativeUpdateServer } from './app-update-download.ts';

/** Chromium networking follows the system proxy, as in BaoCut. All remote endpoints are derived in the main process. */
async function fetchJson(url: string, signal: AbortSignal) {
  const response = await net.fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), cache: 'no-store', headers: {
    Accept: 'application/json', 'User-Agent': `Open-Artifact-Desktop/${app.getVersion()}`,
  } });
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
  if (!response.body) throw new Error('Empty GitHub response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) throw new Error('GitHub response is too large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function electronAppUpdates(options: Pick<AppUpdateDeps, 'preferences' | 'save' | 'confirmInstall' | 'openNotes' | 'changed' | 'log'> & { testMode: boolean }) {
  let release = false;
  try { release = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')).desktopUpdates === true; } catch { /* development */ }
  const unavailable = updateAvailability(app.isPackaged, release, options.testMode, process.platform, process.arch);
  const updates = new AppUpdates({
    ...options, current: app.getVersion(), unavailable,
    releases: signal => githubReleases(fetchJson, signal),
    feed: fetchJson,
    async download(release, signal, progress) {
      const feed = validateFeed(await fetchJson(release.feed, signal), release);
      const info = feed.releases[0]!.updateTo;
      const archive = await downloadUpdateZip(info, {
        cache: join(app.getPath('userData'), 'updates'), signal, progress,
        fetch: (url, init) => net.fetch(url, { ...init, headers: { 'User-Agent': `Open-Artifact-Desktop/${app.getVersion()}` } }),
      });
      const server = await nativeUpdateServer(archive, info, signal);
      autoUpdater.setFeedURL({ url: server.url, serverType: 'json' });
      autoUpdater.checkForUpdates();
    },
    install: () => autoUpdater.quitAndInstall(),
  });
  // Never initialize Squirrel on development, ad hoc, unsupported or test builds.
  if (!unavailable) {
    autoUpdater.on('error', error => updates.failed(error));
    autoUpdater.on('update-downloaded', () => updates.downloaded());
    autoUpdater.on('update-not-available', () => updates.noUpdate());
  }
  return updates;
}
