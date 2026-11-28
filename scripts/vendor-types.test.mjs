/**
 * `scripts/vendor-types.mjs`: completeness checks for `dist/server/` and `skills/open-artifact/vendor/`.
 *
 * Run: node --test scripts/vendor-types.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertSkillVendorComplete,
  missingSkillVendorFiles,
  missingTypeServerFiles,
  readBuiltinTypeIds,
  requiredTypeServerEntries,
  serverTypeIds,
  vendorTypes,
} from './vendor-types.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function touch(file, text = '') {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** Creates a minimal fake repo layout with `artifact-types/`, `packages/protocol/src/type-authoring.ts` and `dist/server/`. */
function makeFakeRepo({ builtEditors = ['design', 'whiteboard', 'motion'] } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'oa-vendor-types-'));
  dirs.push(repo);
  const types = ['design', 'whiteboard', 'motion', 'page'];
  touch(
    join(repo, 'packages', 'protocol', 'src', 'type-authoring.ts'),
    `export const BUILTIN_TYPE_IDS: readonly string[] = Object.freeze(${JSON.stringify(types)});\n`,
  );
  for (const type of types) {
    const manifest = type === 'page' ? { openArtifact: { style: 'page' } } : { openArtifact: { style: 'db' } };
    touch(join(repo, 'artifact-types', type, 'artifact-type.json'), JSON.stringify(manifest));
  }
  const server = join(repo, 'dist', 'server');
  for (const entry of requiredTypeServerEntries(builtEditors)) {
    if (entry.kind === 'dir') mkdirSync(join(server, entry.path), { recursive: true });
    else touch(join(server, entry.path), 'ok');
  }
  return { repo, types, server };
}

describe('vendor-types completeness checks', () => {
  it('reads all built-in types from protocol and derives every server-backed type', () => {
    const all = readBuiltinTypeIds(REPO);
    const serverTypes = serverTypeIds(REPO, all);
    assert.ok(all.includes('page'));
    assert.ok(!serverTypes.includes('page'));
    for (const id of ['design', 'design-system', 'whiteboard', 'slides', 'data', 'sheets', 'docs', 'motion']) {
      assert.ok(serverTypes.includes(id), `missing server type ${id}`);
    }
  });

  it('refuses a partial dist/server/ missing any built-in editor (e.g. interrupted build)', () => {
    const { repo, types } = makeFakeRepo({ builtEditors: ['design', 'whiteboard'] });
    const vendor = join(repo, 'skills', 'open-artifact', 'vendor');
    assert.deepEqual(missingTypeServerFiles(join(repo, 'dist', 'server'), ['design', 'whiteboard', 'motion']), ['editors/motion/index.html']);
    assert.throws(
      () => vendorTypes({ repo, vendor, types }),
      /incomplete \(missing editors\/motion\/index\.html\)/,
    );
    assert.equal(existsSync(join(vendor, 'type-server')), false);
  });

  it('vendors a complete dist/server/ and creates shims for server-backed types only', () => {
    const { repo, types } = makeFakeRepo({ builtEditors: ['design', 'whiteboard', 'motion'] });
    const skill = join(repo, 'skills', 'open-artifact');
    const vendor = join(skill, 'vendor');
    vendorTypes({ repo, vendor, types });
    assert.equal(existsSync(join(vendor, 'type-server', 'editors', 'motion', 'index.html')), true);
    assert.equal(existsSync(join(vendor, 'artifact-types', 'motion', 'scripts', 'cli.mjs')), true);
    assert.equal(existsSync(join(vendor, 'artifact-types', 'page', 'scripts', 'cli.mjs')), false);

    // Populate the rest of the skill vendor files and confirm completeness check passes.
    touch(join(skill, 'scripts', 'open-artifact.mjs'));
    touch(join(vendor, 'open-artifact.mjs'));
    touch(join(vendor, 'runtime.json'), '{}');
    touch(join(vendor, 'shell', 'index.html'));
    touch(join(vendor, 'home', 'index.html'));
    touch(join(vendor, 'frame-host', 'frame-host.mjs'));
    mkdirSync(join(vendor, 'harnesses'), { recursive: true });
    assert.deepEqual(missingSkillVendorFiles(skill, { repo, types }), []);
    assert.doesNotThrow(() => assertSkillVendorComplete(skill, { repo, types, label: 'test' }));

    // Removing one editor page must fail the downstream packaging check.
    rmSync(join(vendor, 'type-server', 'editors', 'motion', 'index.html'));
    assert.throws(
      () => assertSkillVendorComplete(skill, { repo, types, label: 'plugins build' }),
      /plugins build:.*missing vendor\/type-server\/editors\/motion\/index\.html/,
    );
  });
});
