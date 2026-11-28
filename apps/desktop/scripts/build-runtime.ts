#!/usr/bin/env node
/**
 * Puts the Open Artifact runtime the app carries into `apps/desktop/resources/runtime/`: the same folder
 * `@open-artifact/cli` publishes (scripts/build-npm.mjs, `stageCli`), which is the built skill folder
 * `skills/open-artifact/` plus a package.json naming its version and Harness API range.
 *
 * What the daemon and the editors need, all of it under the skill's `vendor/` (scripts/build-skill.mjs):
 *
 *   scripts/open-artifact.mjs        the entry the kit starts (`runtimeInfo` looks for it); points the daemon at vendor/
 *   vendor/open-artifact.mjs         the daemon and its CLI, one bundled file
 *   vendor/runtime.json              the version and the Harness API range (`runtimeInfo` reads it)
 *   vendor/shell/, vendor/home/      the Shell every artifact page opens in, and the daemon's home page
 *   vendor/frame-host/               the server of page types
 *   vendor/harnesses/                the harness profiles
 *   vendor/type-server/              the one type server every built-in type runs, with every editor
 *   vendor/artifact-types/<id>/      the built-in types (manifest, skill, a scripts/cli.mjs running type-server/)
 *   SKILL.md, reference/             the skill text, as the published package carries it
 *
 * The app starts the daemon with its own executable and ELECTRON_RUN_AS_NODE=1, so no Node.js is needed to run it.
 *
 * Build the pieces first, at the repository root: `npm run build`, then `node scripts/build-skill.mjs`.
 *
 *   node scripts/build-runtime.ts [--out <dir>]     default out: apps/desktop/resources/runtime
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_TYPE_IDS } from '@open-artifact/protocol';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(app, '..', '..');
const skill = join(repo, 'skills', 'open-artifact');
const at = process.argv.indexOf('--out');
const out = at > 0 ? resolve(process.argv[at + 1] ?? '') : join(app, 'resources', 'runtime');

const fail = (line: string) => {
  console.error(`desktop runtime: ${line}`);
  process.exit(1);
};
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8'));
const SERVER_TYPES = BUILTIN_TYPE_IDS.filter((id) => id !== 'page');

/** What must be there for the daemon to start and every built-in editor to open. */
const REQUIRED = [
  'scripts/open-artifact.mjs',
  'vendor/open-artifact.mjs',
  'vendor/runtime.json',
  'vendor/shell/index.html',
  'vendor/home/index.html',
  'vendor/frame-host/frame-host.mjs',
  'vendor/harnesses',
  'vendor/type-server/cli.mjs',
  'vendor/type-server/support.js',
  'vendor/type-server/sheets.wasm',
  'vendor/type-server/motion-tools.html',
  'vendor/type-server/pdf-reader.mjs',
  'vendor/type-server/pdf-cmaps',
  'vendor/type-server/shell/index.html',
  ...SERVER_TYPES.map((type) => `vendor/type-server/editors/${type}/index.html`),
  ...BUILTIN_TYPE_IDS.map((type) => `vendor/artifact-types/${type}/artifact-type.json`),
  ...SERVER_TYPES.map((type) => `vendor/artifact-types/${type}/scripts/cli.mjs`),
];
const missing = REQUIRED.filter((path) => !existsSync(join(skill, path)));
if (missing.length) {
  fail(`skills/open-artifact is not built (missing ${missing.join(', ')}). At the repository root run: npm run build && node scripts/build-skill.mjs`);
}

// A runtime older than the sources it was built from is the usual cause of "feature X is not listed": say so.
const daemonPkg = readJson<{ version: string }>(join(repo, 'packages', 'daemon', 'package.json'));
const runtime = readJson<{ version: string; protocols: { harness: { min: number; max: number } } }>(join(skill, 'vendor', 'runtime.json'));
if (runtime.version !== daemonPkg.version) fail(`skills/open-artifact/vendor is ${runtime.version}, the daemon sources are ${daemonPkg.version}: rebuild it.`);
const builtAt = statSync(join(skill, 'vendor', 'open-artifact.mjs')).mtimeMs;
const newestSource = statSync(join(repo, 'packages', 'daemon', 'src', 'daemon.ts')).mtimeMs;
if (newestSource > builtAt)
  console.warn('desktop runtime: packages/daemon/src/daemon.ts is newer than the vendored daemon; rebuild with node scripts/build-skill.mjs if it changed.');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const entry of ['scripts', 'vendor', 'reference', 'SKILL.md']) {
  if (existsSync(join(skill, entry))) cpSync(join(skill, entry), join(out, entry), { recursive: true });
}
for (const file of ['LICENSE', 'NOTICE']) cpSync(join(repo, file), join(out, file));
// The package.json @open-artifact/cli has (the fields a runtime is read by: version, the bin, the protocol range).
const pkg = {
  name: '@open-artifact/cli',
  version: daemonPkg.version,
  private: true,
  description: 'The Open Artifact runtime carried by Open Artifact Desktop: the daemon, its Shell and the built-in types.',
  type: 'module',
  bin: { 'open-artifact': 'scripts/open-artifact.mjs' },
  engines: readJson<{ engines: { node: string } }>(join(repo, 'package.json')).engines,
  license: 'Apache-2.0',
  openArtifact: { protocols: runtime.protocols },
};
writeFileSync(join(out, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`desktop runtime: ${pkg.version} in ${out}`);
