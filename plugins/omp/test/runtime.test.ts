/**
 * The runtime search: the plugin's own `skills/` holds only SKILL.md, so it must not be taken for the Open Artifact
 * runtime; the ancestor skill folder that carries the launcher and a version is.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, test } from 'node:test';
import { hostRuntime, runtimeFolders } from '../src/runtime.ts';

let temps: string[] = [];
afterEach(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
  temps = [];
});

test('finds the ancestor skill runtime, not the plugin’s own skills folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-omp-runtime-'));
  temps.push(root);
  const runtime = join(root, 'skills', 'open-artifact');
  mkdirSync(join(runtime, 'scripts'), { recursive: true });
  writeFileSync(join(runtime, 'scripts', 'open-artifact.mjs'), '');
  mkdirSync(join(runtime, 'vendor'), { recursive: true });
  writeFileSync(join(runtime, 'vendor', 'runtime.json'), JSON.stringify({ version: '1.2.3' }));
  writeFileSync(join(runtime, 'SKILL.md'), '---\nname: open-artifact\n---\n');
  const own = join(root, 'plugins', 'omp');
  mkdirSync(join(own, 'skills', 'open-artifact'), { recursive: true });
  writeFileSync(join(own, 'skills', 'open-artifact', 'SKILL.md'), '---\nname: open-artifact\n---\n');

  const from = pathToFileURL(join(own, 'src', 'extension.ts')).href;
  assert.deepEqual(runtimeFolders(from), [runtime]);
  assert.deepEqual(hostRuntime(runtimeFolders(from)), { dir: runtime, version: '1.2.3' });
});
