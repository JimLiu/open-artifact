// Shared by the desktop updater and the release publisher. Desktop tags are independent of npm's v* tags/Latest.
export const UPDATE_REPOSITORY = 'JimLiu/open-artifact';
export const UPDATE_FEED = 'desktop-updates-darwin-arm64.json';
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function stableVersion(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && stable.test(value) && value.split('.').every(part => Number.isSafeInteger(Number(part)));
}

export function compareVersions(a: string, b: string) {
  if (!stableVersion(a) || !stableVersion(b)) throw new Error('Expected stable desktop versions');
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! > right[i]! ? 1 : -1;
  return 0;
}

export function releaseBase(version: string, repository = UPDATE_REPOSITORY) {
  if (!stableVersion(version) || repository !== repository.trim() || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid desktop release');
  return `https://github.com/${repository}/releases/download/desktop-v${version}`;
}

export function updateFeed(version: string, size: number, sha256: string, repository = UPDATE_REPOSITORY) {
  const base = releaseBase(version, repository);
  if (!Number.isSafeInteger(size) || size <= 0 || sha256.length !== 64 || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid update ZIP integrity');
  return {
    currentRelease: version,
    releases: [{ version, updateTo: {
      version, name: `Open Artifact Desktop ${version}`,
      url: `${base}/Open-Artifact-${version}-darwin-arm64.zip`, size, sha256,
    } }],
  };
}

export interface DesktopRelease {
  version: string;
  feed: string;
  page: string;
  notes: string;
  size: number;
}

export async function githubReleases(fetchJson: (url: string, signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) {
  const all: unknown[] = [];
  for (let page = 1; page <= 10; page++) {
    const rows = await fetchJson(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=100&page=${page}`, signal);
    if (!Array.isArray(rows)) throw new Error('Invalid GitHub releases response');
    all.push(...rows);
    if (rows.length < 100) return all;
  }
  throw new Error('GitHub release history exceeds the update search limit');
}

/** Ignore drafts, prereleases, npm releases, older versions and older desktop releases without an update feed. */
export function selectRelease(releases: unknown[], current: string): DesktopRelease | null {
  let newest: DesktopRelease | null = null;
  for (const input of releases) {
    const release = record(input);
    if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string') continue;
    const version = release.tag_name.startsWith('desktop-v') ? release.tag_name.slice(9) : '';
    if (!stableVersion(version) || compareVersions(version, current) <= 0 || (newest && compareVersions(version, newest.version) <= 0)) continue;
    const assets = Array.isArray(release.assets) ? release.assets.map(record) : [];
    const feed = assets.find(asset => asset.name === UPDATE_FEED && asset.state === 'uploaded');
    const zip = assets.find(asset => asset.name === `Open-Artifact-${version}-darwin-arm64.zip` && asset.state === 'uploaded');
    if (!feed || !zip || !Number.isSafeInteger(zip.size) || Number(zip.size) <= 0) continue;
    newest = {
      version, feed: `${releaseBase(version)}/${UPDATE_FEED}`,
      page: `https://github.com/${UPDATE_REPOSITORY}/releases/tag/desktop-v${version}`,
      notes: typeof release.body === 'string' ? release.body.slice(0, 100_000) : '', size: Number(zip.size),
    };
  }
  return newest;
}

/** Fail closed before giving the immutable feed to Squirrel (which verifies the ZIP and code signature). */
export function validateFeed(value: unknown, release: Pick<DesktopRelease, 'version' | 'size'>, repository = UPDATE_REPOSITORY) {
  const feed = record(value);
  if (feed.currentRelease !== release.version || !Array.isArray(feed.releases) || feed.releases.length !== 1) throw new Error('Update feed version differs');
  const entry = record(feed.releases[0]);
  const update = record(entry.updateTo);
  if (typeof update.sha256 !== 'string') throw new Error('Invalid update ZIP integrity');
  const expected = updateFeed(release.version, release.size, update.sha256, repository);
  if (entry.version !== release.version || update.version !== release.version || update.url !== expected.releases[0]!.updateTo.url ||
      update.size !== release.size || update.delta !== undefined) throw new Error('Update feed ZIP differs');
  return expected;
}
