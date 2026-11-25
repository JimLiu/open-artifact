/**
 * The changelog route's answer: the release notes of the version installed and of the ones before it, from the
 * CHANGELOG.md the build copies into the plugin (scripts/build.mjs); and, while a newer release is offered (updates.ts),
 * that release's notes, from its own CHANGELOG.md, so the page can say what an update brings before it is installed.
 *
 * A release's CHANGELOG.md is asked for where the release is: the registry that offered it when that registry serves a
 * package's files (npmmirror), a CDN that serves npm packages' files, then the repository at the release's tag. What
 * answered is kept; nothing answering means no notes, and a later look asks again.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseChangelog, releasesBetween, type ChangelogAnswer, type ReleaseNotes } from '@open-artifact/library-page/library';
import type { UpdateCheck } from '../shared/routes.ts';

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** One source that does not answer stops holding things up after this long. */
const LOOKUP_MS = 8_000;
/** Where the repository keeps each release, by its `v<version>` tag. */
const REPOSITORY_RAW = 'https://raw.githubusercontent.com/JimLiu/open-artifact';

/** Where a release's CHANGELOG.md may be, in the order to ask. */
export function changelogSources(name: string, version: string, registry: string): string[] {
  const sources: string[] = [];
  if (/^https:\/\/registry\.npmmirror\.com\/?$/.test(registry)) sources.push(`https://registry.npmmirror.com/${name}/${version}/files/CHANGELOG.md`);
  sources.push(`https://cdn.jsdelivr.net/npm/${name}@${version}/CHANGELOG.md`, `${REPOSITORY_RAW}/v${version}/CHANGELOG.md`);
  return sources;
}

/** What the changelog route needs to know. */
export interface ChangelogOptions {
  /** The package. */
  name: string;
  /** The plugin folder (package.json, CHANGELOG.md). */
  root: string;
  /** Whether a newer release is out (the updates route's answer). */
  updates?: () => Promise<UpdateCheck>;
  fetcher?: Fetch;
}

/** Makes the changelog route's answer: `upcoming` asks for the offered release's notes too. */
export function changelogReader({ name, root, updates, fetcher = fetch }: ChangelogOptions): (upcoming: boolean) => Promise<ChangelogAnswer> {
  let local: { version: string; releases: ReleaseNotes[] } | null = null;
  const remote = new Map<string, ReleaseNotes[]>();

  /** The installed version and its notes. An update changes the folder's files under a running server: read again then. */
  const installed = (): { version: string; releases: ReleaseNotes[] } => {
    let version = '';
    try {
      version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }).version ?? '';
    } catch {
      // no package.json: no version, and no notes to pick from
    }
    if (local?.version === version) return local;
    // The build's copy; in a checkout not built yet, the repository's own.
    const file = [join(root, 'CHANGELOG.md'), join(root, '..', '..', 'CHANGELOG.md')].find((path) => existsSync(path));
    let releases: ReleaseNotes[] = [];
    try {
      if (file && version) releases = releasesBetween(parseChangelog(readFileSync(file, 'utf8')), '', version);
    } catch {
      releases = [];
    }
    return (local = { version, releases });
  };

  const notesOf = async (latest: string, registry: string): Promise<ReleaseNotes[]> => {
    const kept = remote.get(latest);
    if (kept) return kept;
    for (const url of changelogSources(name, latest, registry)) {
      try {
        const response = await fetcher(url, { signal: AbortSignal.timeout(LOOKUP_MS) });
        if (!response.ok) continue;
        const releases = parseChangelog(await response.text());
        // A CHANGELOG.md of another release (a CDN's stale copy) does not say what this one brings.
        if (!releases.some((r) => r.version === latest)) continue;
        remote.set(latest, releases);
        return releases;
      } catch {
        // not there, or not answering: the next source
      }
    }
    return [];
  };

  return async (upcoming) => {
    const { version, releases } = installed();
    let ahead: ReleaseNotes[] = [];
    if (upcoming && updates !== undefined && version) {
      const offer = (await updates().catch(() => null))?.updates.find((u) => u.name === name);
      if (offer) ahead = releasesBetween(await notesOf(offer.latest, offer.registry), version, offer.latest);
    }
    return { version, releases, upcoming: ahead };
  };
}
