/**
 * The DOM-free half (`@open-artifact/library-page/library`): reading CHANGELOG.md, versions, the Library API's answers
 * in the page's shapes, and which notes "What's new" shows (changelog-state.ts, which runs without React).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { whatsNew } from '../src/changelog-state.ts';
import { artifactList, deleteAnswer, inlinePieces, isNewer, latestOf, openAnswer, pageView, parseChangelog, releasesBetween, thumbnailStamp, typeTiles } from '../src/library/index.ts';

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

describe('parseChangelog', () => {
  it('reads each release: version, date, summary, sections, items over several lines', () => {
    const releases = parseChangelog(CHANGELOG);
    assert.deepEqual(
      releases.map((r) => r.version),
      ['0.9.1', '0.9.0'],
    );
    assert.deepEqual(releases[0], {
      version: '0.9.1',
      date: '2026-11-19',
      summary: ['Smaller installs.'],
      sections: [{ title: 'Changed', items: ['The type server is shared, in `vendor/type-server/`.', '**Docs** opens faster.'] }],
    });
    assert.deepEqual(
      releases[1]!.sections.map((s) => s.title),
      ['Added', 'Fixed'],
    );
  });

  it('reads the repository CHANGELOG.md', () => {
    const releases = parseChangelog(readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8'));
    assert.ok(releases.length > 0);
    for (const r of releases) {
      assert.match(r.version, /^\d+\.\d+\.\d+/);
      assert.ok(r.sections.every((s) => s.items.length > 0), `${r.version} has an empty section`);
    }
  });
});

describe('releasesBetween', () => {
  it('keeps the releases after one version up to another, newest first', () => {
    const releases = parseChangelog(AHEAD);
    assert.deepEqual(
      releasesBetween(releases, '0.9.1', '0.9.3').map((r) => r.version),
      ['0.9.3', '0.9.2'],
    );
    assert.deepEqual(
      releasesBetween(releases, '', '0.9.1').map((r) => r.version),
      ['0.9.1', '0.9.0'],
    );
  });
});

describe('inlinePieces', () => {
  it('splits code, bold and web links, and keeps a local link as text', () => {
    assert.deepEqual(inlinePieces('A `x` and **y** [z](https://e.com) [w](README.md).'), [
      { kind: 'text', text: 'A ' },
      { kind: 'code', text: 'x' },
      { kind: 'text', text: ' and ' },
      { kind: 'strong', text: 'y' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'z', href: 'https://e.com' },
      { kind: 'text', text: ' ' },
      { kind: 'text', text: 'w' },
      { kind: 'text', text: '.' },
    ]);
  });
});

describe('isNewer', () => {
  it('orders versions, a prerelease before its release', () => {
    assert.ok(isNewer('0.8.0', '0.7.9'));
    assert.ok(isNewer('1.0.0', '1.0.0-beta.2'));
    assert.ok(isNewer('1.0.0-beta.10', '1.0.0-beta.2'));
    assert.ok(!isNewer('0.7.0', '0.7.0'));
    assert.ok(!isNewer('0.6.9', '0.7.0'));
  });
});

describe('shapes', () => {
  it('reads a thumbnail version from a stamp or a URL', () => {
    assert.equal(thumbnailStamp(null), null);
    assert.equal(thumbnailStamp('abc'), 'abc');
    assert.equal(thumbnailStamp('/api/open-artifact.artifacts.thumbnail?id=a&v=9'), '9');
    assert.equal(thumbnailStamp('http://127.0.0.1:1/x?v=3'), '3');
  });

  it('fills what the daemon leaves out', () => {
    const view = pageView({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }, 'dsh');
    assert.equal(view.openedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(view.updatedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(view.ownerStatus, null);
    assert.equal(view.openable, true);
    assert.deepEqual(typeTiles([{ id: 'design' }, { title: 'no id' }]), [{ id: 'design', title: 'design', description: '' }]);
  });
});

describe('route answers', () => {
  it('lists, opens and deletes in the page shapes, an owner of the host harness being its session', () => {
    const owned = { id: 'a', owner: { harness: 'dsh', session: 's1' } } as Parameters<typeof pageView>[0];
    const list = artifactList({ artifacts: [owned as never] }, { types: [{ id: 'docs', title: 'Docs' } as never] }, 'dsh');
    assert.equal(list.artifacts[0]!.sessionId, 's1');
    assert.equal(artifactList({ artifacts: [owned as never] }, {}, 'other').artifacts[0]!.sessionId, '');
    assert.deepEqual(list.types, [{ id: 'docs', title: 'Docs', description: '' }]);
    assert.deepEqual(openAnswer({}, { ...list.artifacts[0]!, viewUrl: 'http://x/a/a', title: 'T' }), { url: 'http://x/a/a', sessionId: 's1', title: 'T' });
    assert.deepEqual(deleteAnswer({}, 'a'), { trash: 'a', path: '' });
    assert.equal(latestOf([{ latest: '0.9.0' }, { latest: '0.10.0' }]), '0.10.0');
    assert.equal(latestOf([]), '');
  });
});

describe('whatsNew', () => {
  const releases = releasesBetween(parseChangelog(AHEAD), '', '0.9.3');
  const versions = (seen: string | null, version = '0.9.3') => whatsNew({ version, releases, seen }).map((r) => r.version);
  it('shows the releases since the one last seen', () => {
    assert.deepEqual(versions('0.9.1'), ['0.9.3', '0.9.2']);
  });
  it('shows only the installed one when none was ever seen, and nothing once it is', () => {
    assert.deepEqual(versions(null), ['0.9.3']);
    assert.deepEqual(versions('0.9.3'), []);
  });
  it('shows nothing after going back to an older version', () => {
    assert.deepEqual(versions('0.9.3', '0.9.2'), []);
  });
});
