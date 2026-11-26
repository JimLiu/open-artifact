import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, githubReleases, releaseBase, selectRelease, UPDATE_FEED, updateFeed, validateFeed } from '../src/app-update-feed.ts';
import { AppUpdates, CHECK_INTERVAL_MS, FIRST_CHECK_MS, hasAppUpdate, updateAvailability, type AppUpdateDeps, type AppUpdateView } from '../src/app-update.ts';

const digest = 'a'.repeat(64);
const size = 12345;
const candidate = (version = '0.17.0') => ({
  tag_name: `desktop-v${version}`, draft: false, prerelease: false, body: 'A new desktop release',
  assets: [{ name: UPDATE_FEED, state: 'uploaded', size: 500 },
    { name: `Open-Artifact-${version}-darwin-arm64.zip`, state: 'uploaded', size }],
});

test('only newer stable desktop releases with a complete arm64 updater can be selected', () => {
  const npm = { ...candidate('9.0.0'), tag_name: 'v9.0.0' };
  const older = candidate('0.15.0');
  const same = candidate('0.16.1');
  const draft = { ...candidate('8.0.0'), draft: true };
  const prerelease = { ...candidate('8.0.0'), prerelease: true };
  const missing = { ...candidate('7.0.0'), assets: [] };
  const malformed = candidate('01.0.0');
  const next = candidate('0.17.0');
  assert.equal(selectRelease([npm, older, same, draft, prerelease, missing, malformed], '0.16.1'), null);
  assert.equal(selectRelease([next, candidate('0.18.0'), npm, draft], '0.16.1')?.version, '0.18.0');
  assert.equal(selectRelease([next], '0.16.1')?.feed, `${releaseBase('0.17.0')}/${UPDATE_FEED}`);
  assert.equal(compareVersions('0.9.0', '0.10.0'), -1);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  assert.throws(() => compareVersions('1.0.0-beta.1', '1.0.0'));
  assert.throws(() => releaseBase('../version'));
  assert.throws(() => releaseBase('0.17.0\n'));
});

test('static Squirrel feed requires the correct version, ZIP URL, SHA-256 and byte count', () => {
  const release = { version: '0.17.0', size };
  const feed = updateFeed(release.version, size, digest);
  assert.deepEqual(validateFeed(feed, release), feed);
  for (const mutate of [
    (v: typeof feed) => { v.currentRelease = '0.16.0'; },
    (v: typeof feed) => { v.releases[0].version = '0.16.0'; },
    (v: typeof feed) => { v.releases[0].updateTo.url = 'http://example.com/update.zip'; },
    (v: typeof feed) => { v.releases[0].updateTo.url += '/../other.zip'; },
    (v: typeof feed) => { v.releases[0].updateTo.sha256 = ''; },
    (v: typeof feed) => { v.releases[0].updateTo.sha256 += '\n'; },
    (v: typeof feed) => { v.releases[0].updateTo.size--; },
    (v: typeof feed) => { v.releases.push(v.releases[0]); },
  ]) {
    const changed = structuredClone(feed);
    mutate(changed);
    assert.throws(() => validateFeed(changed, release));
  }
});

test('GitHub discovery paginates past npm releases; malformed, rate limited and truncated responses fail', async () => {
  const urls: string[] = [];
  const signal = new AbortController().signal;
  const releases = await githubReleases(async url => {
    urls.push(url);
    return urls.length === 1 ? Array.from({ length: 100 }, () => ({ tag_name: 'v1.0.0' })) : [candidate()];
  }, signal);
  assert.equal(selectRelease(releases, '0.16.1')?.version, '0.17.0');
  assert.match(urls[1], /page=2$/);
  await assert.rejects(githubReleases(async () => ({ message: 'API limit' }), signal), /Invalid GitHub/);
  await assert.rejects(githubReleases(async () => { throw new Error('GitHub HTTP 403'); }, signal), /403/);
  await assert.rejects(githubReleases(async () => Array(100).fill(null), signal), /search limit/);
});

function setup(overrides: Partial<AppUpdateDeps> = {}) {
  const views: AppUpdateView[] = [];
  const downloads: string[] = [];
  const opened: string[] = [];
  const prefs = { autoCheck: true, autoDownload: false };
  let checks = 0;
  let installs = 0;
  const updates = new AppUpdates({
    current: '0.16.1', unavailable: null,
    preferences: () => prefs, save: (name, on) => { prefs[name] = on; },
    releases: async () => { checks++; return [candidate()]; },
    feed: async () => updateFeed('0.17.0', size, digest),
    download: release => { downloads.push(release.feed); },
    confirmInstall: async install => { install(); return true; },
    install: () => { installs++; },
    changed: view => { views.push(view); }, openNotes: url => { opened.push(url); }, log: () => {},
    ...overrides,
  });
  return { updates, views, downloads, opened, prefs, checks: () => checks, installs: () => installs };
}

test('checks deduplicate; download is opt in; native verification gates install; duplicate downloads are ignored', async () => {
  const f = setup();
  try {
    const first = f.updates.check();
    assert.equal(f.updates.check(), first);
    assert.equal((await first).phase, 'available');
    assert.equal(f.checks(), 1);
    assert.equal(f.downloads.length, 0);
    assert.equal(await f.updates.install(), false);
    f.updates.download();
    f.updates.download();
    await f.updates.check();
    assert.equal(f.downloads.length, 1);
    assert.equal(f.checks(), 1);
    assert.equal(await f.updates.install(), false);
    f.updates.downloaded();
    assert.equal(f.updates.view().phase, 'ready');
    assert.equal(await f.updates.install(), true);
    assert.equal(f.installs(), 1);
    assert.equal(await f.updates.install(), false);
    assert.equal(f.updates.notes(), true);
    assert.match(f.opened[0], /\/releases\/tag\/desktop-v0\.17\.0$/);
  } finally { f.updates.close(); }
});

test('automatic checks respect delay, interval and saved preferences; automatic download can be enabled', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = setup();
  try {
    f.updates.start();
    t.mock.timers.tick(FIRST_CHECK_MS - 1);
    assert.equal(f.checks(), 0);
    t.mock.timers.tick(1);
    await f.updates.check();
    assert.equal(f.checks(), 1);
    f.updates.setPreference('autoCheck', false);
    assert.equal(f.prefs.autoCheck, false);
    t.mock.timers.tick(CHECK_INTERVAL_MS);
    assert.equal(f.checks(), 1);
    f.updates.setPreference('autoCheck', true);
    await f.updates.check();
    assert.equal(f.checks(), 2);
    f.updates.setPreference('autoDownload', true);
    assert.equal(f.prefs.autoDownload, true);
    assert.equal(f.downloads.length, 1);
    f.updates.close();
    t.mock.timers.tick(CHECK_INTERVAL_MS);
    assert.equal(f.checks(), 2);
  } finally { f.updates.close(); }
});

test('automatic download follows a successful check, never an invalid feed', async () => {
  for (const valid of [true, false]) {
    const f = setup({ preferences: () => ({ autoCheck: true, autoDownload: true }),
      feed: async () => valid ? updateFeed('0.17.0', size, digest) : {} });
    try {
      assert.equal((await f.updates.check()).phase, valid ? 'downloading' : 'error');
      assert.equal(f.downloads.length, valid ? 1 : 0);
    } finally { f.updates.close(); }
  }
});

test('network and signature failures can be retried without claiming an update is ready', async () => {
  let attempts = 0;
  const f = setup({ releases: async () => { if (!attempts++) throw new Error('network unavailable'); return [candidate()]; } });
  try {
    assert.equal((await f.updates.check()).phase, 'error');
    assert.match(f.updates.view().error!, /network/);
    await f.updates.check();
    f.updates.download();
    f.updates.failed(new Error('Invalid code signature'));
    f.updates.downloaded();
    assert.equal(f.updates.view().phase, 'error');
    assert.equal(await f.updates.install(), false);
    f.updates.download();
    assert.equal(f.downloads.length, 2);
    f.updates.downloaded();
    assert.equal(f.updates.view().phase, 'ready');
  } finally { f.updates.close(); }
});

test('canceling the unsaved-work confirmation preserves the staged update; concurrent install asks once', async () => {
  let finish: ((yes: boolean) => void) | undefined;
  const f = setup({ confirmInstall: install => new Promise(resolve => {
    finish = yes => { if (yes) install(); resolve(yes); };
  }) });
  try {
    await f.updates.check();
    f.updates.download();
    f.updates.downloaded();
    const cancelled = f.updates.install();
    assert.equal(await f.updates.install(), false);
    finish!(false);
    assert.equal(await cancelled, false);
    assert.equal(f.updates.view().phase, 'ready');
    assert.equal(f.installs(), 0);
    const accepted = f.updates.install();
    finish!(true);
    assert.equal(await accepted, true);
    assert.equal(f.installs(), 1);
  } finally { f.updates.close(); }
});

test('canceling a download clears progress and ignores late progress from that request', async () => {
  let send: Parameters<AppUpdateDeps['download']>[2] | undefined;
  let signal: AbortSignal | undefined;
  const f = setup({ download: (_release, nextSignal, progress) => { signal = nextSignal; send = progress; } });
  try {
    assert.equal(hasAppUpdate(f.updates.view()), false);
    await f.updates.check();
    assert.equal(hasAppUpdate(f.updates.view()), true);
    f.updates.download();
    send!({ received: 42, total: size, stage: 'download' });
    assert.equal(f.updates.view().progress?.received, 42);
    assert.equal(f.updates.cancel(), true);
    assert.equal(signal!.aborted, true);
    send!({ received: 100, total: size, stage: 'download' });
    assert.equal(f.updates.view().progress, null);
    assert.equal(f.updates.view().phase, 'available');
    f.updates.download();
    send!({ received: size, total: size, stage: 'verify' });
    assert.equal(f.updates.cancel(), false);
    f.updates.downloaded();
    assert.equal(f.updates.view().progress, null);
  } finally { f.updates.close(); }
});

test('development/ad hoc/unsupported/test builds never check or install; shutdown aborts in-flight checks', async () => {
  assert.equal(updateAvailability(true, true, false, 'darwin', 'arm64'), null);
  assert.equal(updateAvailability(false, true, false, 'darwin', 'arm64'), 'development');
  assert.equal(updateAvailability(true, false, false, 'darwin', 'arm64'), 'development');
  assert.equal(updateAvailability(true, true, false, 'darwin', 'x64'), 'platform');
  assert.equal(updateAvailability(true, true, false, 'win32', 'x64'), 'platform');
  for (const unavailable of ['development', 'platform', 'test'] as const) {
    const f = setup({ unavailable });
    f.updates.start();
    assert.throws(() => f.updates.check(), /unavailable/);
    assert.throws(() => f.updates.download(), /unavailable/);
    await assert.rejects(f.updates.install(), /unavailable/);
    assert.equal(f.checks(), 0);
    f.updates.close();
  }
  const f = setup({ releases: signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))) });
  const checking = f.updates.check();
  f.updates.close();
  await checking;
  assert.equal(f.views.length, 1, 'no late state pushed after shutdown');
});
