import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { changeKind, developmentProfile, lockProfile, pinDevelopmentRuntime } from './dev-desktop.mjs';

test('Desktop launcher supplies isolated defaults and accepts explicit profile overrides', () => {
  const defaults = developmentProfile();
  assert.equal(defaults.port, 4890);
  assert.ok(defaults.home.endsWith('/.desktop-dev'));
  assert.deepEqual(defaults.problems, []);
  const custom = developmentProfile(['--home', '/tmp/oa-desktop-custom', '--port=14901', '--open', 'my-artifact']);
  assert.equal(custom.home, '/tmp/oa-desktop-custom');
  assert.equal(custom.port, 14901);
  assert.deepEqual(custom.open, ['my-artifact']);
  assert.throws(() => developmentProfile(['--port', '4800']), /does not use port 4800/);
  assert.throws(() => developmentProfile(['--home', '~/.agents/open-artifact']), /does not use the default home/);
  assert.throws(() => developmentProfile(['--port', 'invalid']), /not a port number/);
  assert.throws(() => developmentProfile(['--home']), /needs a value/);
});

test('rebuild routing covers runtime inputs and main/preload dependencies without watching generated output', () => {
  for (const path of ['apps/desktop/src/main.ts', 'apps/desktop/src/preload.ts', 'apps/desktop/renderer/src/words.ts', 'packages/library-page/src/library/index.ts', 'apps/desktop/renderer/notice/notice.ts'])
    assert.equal(changeKind(path), 'desktop', path);
  for (const path of ['packages/daemon/src/server.ts', 'packages/shell/src/main.ts', 'packages/docs-editor/src/App.tsx', 'packages/docs-editor/index.html', 'packages/docs-editor/vite.config.ts', 'packages/wasm-sheets/generated/engine.wasm', 'artifact-types/slides/artifact-type.json', 'scripts/build-skill.mjs'])
    assert.equal(changeKind(path), 'runtime', path);
  for (const path of ['apps/desktop/out/main.mjs', 'apps/desktop/resources/runtime/vendor/runtime.json', 'artifact-types/slides/scripts/cli.mjs', 'packages/docs-editor/dist/index.html', 'packages/daemon/test/server.test.ts', 'apps/desktop/renderer/src/App.tsx', 'packages/ui/src/tab-strip.tsx', 'packages/library-page/src/ArtifactsPage.tsx', 'README.md'])
    assert.equal(changeKind(path), null, path);
});

test('only one runner owns a development profile, and stale locks can be replaced', () => {
  const home = mkdtempSync(join(tmpdir(), 'oa-dev-lock-'));
  try {
    const unlock = lockProfile(home);
    assert.throws(() => lockProfile(home), /already running/);
    unlock();
    // A positive pid beyond the platform's pid range cannot name a live process.
    writeFileSync(join(home, 'desktop/dev-runner.json'), JSON.stringify({ pid: 2147483647 }));
    lockProfile(home)();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('the local runtime pin follows checkout versions while preserving other development settings', () => {
  const home = mkdtempSync(join(tmpdir(), 'oa-dev-runtime-'));
  try {
    const file = join(home, 'settings.json');
    writeFileSync(file, JSON.stringify({ other: true, runtime: { pin: '^9', update: 'prompt' } }));
    pinDevelopmentRuntime(home, '0.17.0');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { other: true, runtime: { pin: '0.17.0', update: 'prompt' } });
    pinDevelopmentRuntime(home, '0.17.1');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).runtime.pin, '0.17.1');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
