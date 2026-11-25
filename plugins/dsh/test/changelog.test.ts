/**
 * The release notes: the changelog route's answer with an offered release's notes (src/server/changelog.ts). Reading
 * CHANGELOG.md, and which notes "What's new" shows, are `@open-artifact/library-page`'s (its test/library.test.ts).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { changelogReader, changelogSources } from '../src/server/changelog.ts';

const NAME = 'dsh-open-artifact';

const CHANGELOG = `# Changelog

Intro that is not a release.

## [0.9.1] - 2026-11-19

Smaller installs.

### Changed

- The type server is shared, in
  \`vendor/type-server/\`.
- **Docs** opens faster.

## [0.9.0] - 2026-11-18

One version for every package.

### Added

- Sheets.

### Fixed

- A [bug](https://example.com/1) and a [local link](README.md).

[0.9.1]: https://github.com/JimLiu/open-artifact/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/JimLiu/open-artifact/compare/v0.2.2...v0.9.0
`;

const AHEAD = `## [0.9.3] - 2026-11-21\n\nThree.\n\n### Fixed\n\n- c\n\n## [0.9.2] - 2026-11-20\n\nTwo.\n\n### Added\n\n- b\n\n${CHANGELOG.split('## [0.9.1]')[1] ? `## [0.9.1]${CHANGELOG.split('## [0.9.1]')[1]}` : ''}`;

/** A plugin folder at `version`, with CHANGELOG. */
function plugin(version: string): string {
  const root = mkdtempSync(join(tmpdir(), 'oa-changelog-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: NAME, version }));
  writeFileSync(join(root, 'CHANGELOG.md'), CHANGELOG);
  return root;
}

const offering = (latest: string, registry = 'https://registry.npmjs.org/') => async () => ({
  updates: [{ name: NAME, version: '0.9.1', latest, spec: 'x.tgz', registry, enabled: true, native: false }],
  failed: [],
});

describe('changelogReader', () => {
  it('answers the installed version and the releases up to it, from the folder', async () => {
    const read = changelogReader({ name: NAME, root: plugin('0.9.0'), fetcher: async () => assert.fail('no fetch without upcoming') });
    const answer = await read(false);
    assert.equal(answer.version, '0.9.0');
    assert.deepEqual(
      answer.releases.map((r) => r.version),
      ['0.9.0'],
    );
    assert.deepEqual(answer.upcoming, []);
  });

  it("finds the offered release's notes at the first source that has that release, and keeps them", async () => {
    const asked: string[] = [];
    const fetcher = async (url: string) => {
      asked.push(url);
      if (url.includes('jsdelivr')) return new Response(CHANGELOG); // a copy without 0.9.3: not it
      if (url.includes('githubusercontent')) return new Response(AHEAD);
      return new Response('', { status: 404 });
    };
    const read = changelogReader({ name: NAME, root: plugin('0.9.1'), updates: offering('0.9.3'), fetcher });
    const answer = await read(true);
    assert.deepEqual(
      answer.upcoming.map((r) => r.version),
      ['0.9.3', '0.9.2'],
    );
    assert.deepEqual(asked, changelogSources(NAME, '0.9.3', 'https://registry.npmjs.org/'));
    await read(true);
    assert.equal(asked.length, 2);
  });

  it('asks npmmirror first when it offered the release; no source answering means no notes', async () => {
    assert.match(changelogSources(NAME, '1.0.0', 'https://registry.npmmirror.com/')[0]!, /^https:\/\/registry\.npmmirror\.com\/dsh-open-artifact\/1\.0\.0\/files\/CHANGELOG\.md$/);
    const read = changelogReader({ name: NAME, root: plugin('0.9.1'), updates: offering('0.9.3'), fetcher: async () => new Response('', { status: 404 }) });
    assert.deepEqual((await read(true)).upcoming, []);
  });
});

