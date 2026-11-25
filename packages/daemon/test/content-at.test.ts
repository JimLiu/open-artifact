/**
 * An artifact's `contentAt` (the Library's "last changed" and the thumbnail's version) follows its content files only:
 * the page-to-agent channel (`_agent/`), the uploads (`_blobs/`) and the version history (`history/`) are not content,
 * so opening or previewing an artifact does not make it newer.
 */

import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { startDaemon, type Daemon } from '../src/daemon.ts';

let daemon: Daemon;
before(async () => {
  daemon = await startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
});
after(() => daemon.close());

/** Writes `rel` under `root` with the given modification time. */
function write(root: string, rel: string, at: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, 'x');
  const when = new Date(at);
  utimesSync(full, when, when);
}

/** The artifact's `contentAt`, read afresh (the daemon keeps a stamp for 5 s). */
function contentAt(id: string): string | null {
  daemon['contentStamps'].clear();
  return daemon.artifactView(daemon.store.require(id)).contentAt;
}

test('contentAt: _agent/, _blobs/ and history/ do not count, a content file does', () => {
  const root = tempDir('open-artifact-content-at-');
  write(root, 'index.html', '2026-01-01T00:00:00.000Z');
  const made = daemon.store.create({ root, type: 'page', typeSource: 'builtin', owner: null, title: 'Stamps' });
  assert.equal(contentAt(made.id), '2026-01-01T00:00:00.000Z');

  write(root, '_agent/requests/one.json', '2026-02-01T00:00:00.000Z');
  assert.equal(contentAt(made.id), '2026-01-01T00:00:00.000Z', 'a file under _agent/ is not content');
  write(root, 'history/2026-03-01/index.html', '2026-03-01T00:00:00.000Z');
  assert.equal(contentAt(made.id), '2026-01-01T00:00:00.000Z', 'a file under history/ is not content');
  write(root, '_blobs/ab/abcdef', '2026-04-01T00:00:00.000Z');
  assert.equal(contentAt(made.id), '2026-01-01T00:00:00.000Z', 'a file under _blobs/ is not content');
  write(root, '.artifact.json', '2026-04-15T00:00:00.000Z');
  assert.equal(contentAt(made.id), '2026-01-01T00:00:00.000Z', 'a dot file is not content');

  write(root, 'assets/chart.json', '2026-05-01T00:00:00.000Z');
  assert.equal(contentAt(made.id), '2026-05-01T00:00:00.000Z', 'a content file in a folder counts');
  write(root, 'index.html', '2026-06-01T00:00:00.000Z');
  assert.equal(contentAt(made.id), '2026-06-01T00:00:00.000Z', 'the content file changed');
});
