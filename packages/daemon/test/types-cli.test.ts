/**
 * `open-artifact types --help` prints the `types` commands. It used to fall into `types --workspace <dir>`'s branch
 * (any `--…` lists) and print the types as JSON.
 */

import { TEST_HOME } from './helpers.ts';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const BIN = fileURLToPath(new URL('../src/bin/open-artifact.ts', import.meta.url));

function run(args: string[]): { code: number | null; out: string; err: string } {
  const result = spawnSync(process.execPath, [BIN, ...args], { env: { ...process.env, OPEN_ARTIFACT_HOME: TEST_HOME }, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test('types --help, -h and help print the types commands, not the list', () => {
  for (const flag of ['--help', '-h', 'help']) {
    const shown = run(['types', flag]);
    assert.equal(shown.code, 0, shown.err);
    assert.doesNotMatch(shown.out, /^\s*[[{]/, `types ${flag} printed JSON`);
    for (const command of ['types [list]', 'types new <id>', 'types check', 'types pack', 'types install', 'types publish <id>']) {
      assert.ok(shown.out.includes(`open-artifact ${command}`), `types ${flag} names ${command}:\n${shown.out}`);
    }
    assert.doesNotMatch(shown.out, /open-artifact (remote|harness|daemon) /, 'only the types lines');
  }
  // `types --workspace <dir>` still lists.
  const listed = run(['types', '--workspace', TEST_HOME]);
  assert.equal(listed.code, 0, listed.err);
  assert.ok(Array.isArray(JSON.parse(listed.out)));
});

test('the usage names types publish and publish --with-type', () => {
  const shown = run(['--help']);
  assert.equal(shown.code, 0, shown.err);
  assert.match(shown.out, /open-artifact types publish <id>/);
  assert.match(shown.out, /open-artifact publish <id\|folder> \[--remote <name>\] \[--with-type\]/);
});
