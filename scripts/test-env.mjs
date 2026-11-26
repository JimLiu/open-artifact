/**
 * Preloaded by `npm test` (`node --import ./scripts/test-env.mjs --test …`): what every test process must have set
 * before it runs, whatever package it is in.
 *
 * `OPEN_ARTIFACT_HOME_WORKSPACE`: the person's Open Artifact folder (`homeWorkspace`), where a session's artifacts go
 * when nothing says otherwise. A test that starts a daemon without naming one would write into the real
 * `~/OpenArtifact`; here it is a temporary folder, removed when the run ends.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.OPEN_ARTIFACT_HOME_WORKSPACE) {
  const dir = mkdtempSync(join(tmpdir(), 'open-artifact-home-workspace-'));
  process.env.OPEN_ARTIFACT_HOME_WORKSPACE = dir;
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
}
