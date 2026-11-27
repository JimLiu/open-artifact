/**
 * The Hermes plugin (plugins/hermes, Python) without Hermes: its cached tool schemas are the daemon's, the shipped
 * profile is the one the plugin says hello with, and in a fake gateway (test/fake_gateway.py) against a real daemon in
 * a temporary OPEN_ARTIFACT_HOME, through `open-artifact harness --stdio`, it registers the three tools and its hooks,
 * makes an artifact, takes the owner's Ask live as a user turn, and hands a refused one over in the next turn as data.
 *
 * The Python parts are skipped, saying so, when python3 (3.9 or later) is not on the PATH.
 *
 * Run: node --test plugins/hermes/test/hermes.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { TOOL_DEFINITIONS } from '@open-artifact/protocol';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, '..');
const repo = join(plugin, '..', '..');

/** Why the Python parts cannot run here, or null. */
function noPython() {
  const found = spawnSync('python3', ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' });
  if (found.error || found.status !== 0) return 'python3 is not on the PATH';
  const [major, minor] = found.stdout.trim().split('.').map(Number);
  return major > 3 || (major === 3 && minor >= 9) ? null : `python3 is ${found.stdout.trim()}; the plugin needs 3.9 or later`;
}
const skip = noPython();
if (skip) console.log(`# plugins/hermes: skipped: ${skip}`);

describe('the Hermes plugin', () => {
  it('ships the daemon\'s tool schemas', () => {
    const cached = JSON.parse(readFileSync(join(plugin, 'schemas.json'), 'utf8')).tools;
    const shape = (tools) => tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
    assert.deepEqual(shape(cached), shape(TOOL_DEFINITIONS), 'refresh plugins/hermes/schemas.json from TOOL_DEFINITIONS');
  });

  it('says hello with the shipped profile', { skip: skip ?? false }, () => {
    const shipped = JSON.parse(readFileSync(join(repo, 'packages', 'daemon', 'harnesses', 'hermes.json'), 'utf8'));
    const run = spawnSync('python3', ['-c', `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("oa_hermes", sys.argv[1] + "/__init__.py", submodule_search_locations=[sys.argv[1]])
m = importlib.util.module_from_spec(spec); sys.modules["oa_hermes"] = m; spec.loader.exec_module(m)
a = m.Adapter(object(), data_dir=sys.argv[2])
print(json.dumps({"harness": m.HARNESS, "hello": a.bridge._hello}))
`, plugin, mkdtempSync(join(tmpdir(), 'oa-hermes-hello-'))], { encoding: 'utf8', env: { ...process.env, OPEN_ARTIFACT_HERMES_AGENT_NAME: '', PYTHONDONTWRITEBYTECODE: '1' } });
    assert.equal(run.status, 0, run.stderr);
    const { harness, hello } = JSON.parse(run.stdout);
    assert.equal(harness, shipped.name);
    assert.equal(hello.harness, shipped.name);
    for (const key of ['title', 'agentName', 'level', 'entry', 'plugin', 'sessionEnv', 'open']) assert.equal(hello.profile[key], shipped[key], key);
    assert.deepEqual(hello.profile.markers, shipped.markers);
    assert.deepEqual(hello.profile.wake, shipped.wake);
    assert.deepEqual(hello.profile.policy, shipped.policy);
    assert.deepEqual(hello.caps.wake, shipped.caps.wake);
    assert.equal(hello.caps.tools, shipped.caps.tools);
    // plugin.yaml keeps the version (raised with the others at a release); the hello reports that one.
    const { version } = JSON.parse(readFileSync(join(repo, 'packages', 'daemon', 'package.json'), 'utf8'));
    assert.equal(readFileSync(join(plugin, 'plugin.yaml'), 'utf8').match(/^version:\s*(\S+)/m)?.[1], version, 'raise plugins/hermes/plugin.yaml with the release');
    assert.equal(hello.kit.version, version);
  });

  // 2026-11-27: the release's hermes/ folder carries the runtime, but the plugin ran only the `open-artifact` on the
  // PATH, so a folder installed as the README says answered every tool call `unavailable`.
  it('runs the runtime its folder carries, else the one on the PATH, unless OPEN_ARTIFACT_CLI says otherwise', { skip: skip ?? false }, () => {
    const folder = mkdtempSync(join(tmpdir(), 'oa-hermes-cli-'));
    for (const file of ['__init__.py', 'bridge.py', 'plugin.yaml']) writeFileSync(join(folder, file), readFileSync(join(plugin, file)));
    const command = (env) => {
      const run = spawnSync('python3', ['-c', `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("oa_hermes", sys.argv[1] + "/__init__.py", submodule_search_locations=[sys.argv[1]])
m = importlib.util.module_from_spec(spec); sys.modules["oa_hermes"] = m; spec.loader.exec_module(m)
print(json.dumps(m.Adapter(object(), data_dir=sys.argv[2]).bridge.command()))
`, folder, join(folder, 'data')], { encoding: 'utf8', env: { ...process.env, OPEN_ARTIFACT_CLI: '', PYTHONDONTWRITEBYTECODE: '1', ...env } });
      assert.equal(run.status, 0, run.stderr);
      return JSON.parse(run.stdout);
    };
    try {
      const tail = ['harness', '--stdio', '--harness', 'hermes'];
      const onPath = command();
      assert.match(onPath[0], /open-artifact$/);
      assert.deepEqual(onPath.slice(1), tail);
      const script = join(folder, 'skills', 'open-artifact', 'scripts', 'open-artifact.mjs');
      mkdirSync(dirname(script), { recursive: true });
      writeFileSync(script, '');
      const carried = command();
      assert.match(carried[0], /node(\.exe)?$/);
      assert.equal(realpathSync(carried[1]), realpathSync(script));
      assert.deepEqual(carried.slice(2), tail);
      assert.deepEqual(command({ OPEN_ARTIFACT_CLI: 'npx @open-artifact/cli' }), ['npx', '@open-artifact/cli', ...tail]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('the Hermes plugin\'s bridge', { skip: skip ?? false }, () => {
  it('fails only the requests of the process that ended, and gives up a write the child does not take', { timeout: 60_000 }, () => {
    const run = spawnSync('python3', [join(here, 'bridge_cases.py')], { encoding: 'utf8', timeout: 50_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.deepEqual(run.stdout.trim().split('\n'), ['stale-exit ok', 'stuck-write ok']);
  });
});

describe('the Hermes plugin in a fake gateway, against a real daemon', { skip: skip ?? false }, () => {
  let dir;
  let env;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'oa-hermes-'));
    const bin = join(dir, 'open-artifact.mjs');
    buildSync({
      entryPoints: [join(repo, 'packages/daemon/src/bin/open-artifact.ts')],
      outfile: bin,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      charset: 'utf8',
      legalComments: 'none',
      logLevel: 'silent',
      banner: { js: "import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url);" },
    });
    const type = join(dir, 'types', 'note');
    mkdirSync(type, { recursive: true });
    writeFileSync(join(type, 'artifact-type.json'), JSON.stringify({ name: 'Note', description: 'A one-page note as a local HTML file.', when: 'The person wants a short note.' }));
    writeFileSync(join(type, 'index.html'), '<!doctype html><title>note</title><iframe src="note.html"></iframe>\n');
    mkdirSync(join(dir, 'builtin'));
    mkdirSync(join(dir, 'work'));
    // These tests may run inside an agent's session (a Hermes gateway's tool commands carry HERMES_SESSION_KEY): the
    // plugin would take that session for the test's own.
    const outer = { ...process.env };
    for (const name of Object.keys(outer)) if (/^(HERMES_SESSION_|HERMES_AGENT$|OPEN_ARTIFACT_)/.test(name)) delete outer[name];
    env = {
      ...outer,
      OPEN_ARTIFACT_HOME: join(dir, 'home'),
      OPEN_ARTIFACT_USER_TYPES: join(dir, 'types'),
      OPEN_ARTIFACT_BUILTIN_TYPES: join(dir, 'builtin'),
      OPEN_ARTIFACT_DAEMON_BIN: bin,
      OPEN_ARTIFACT_PORT: '0',
      OPEN_ARTIFACT_BROWSER: 'none',
      OPEN_ARTIFACT_IDLE_MS: '0',
      OPEN_ARTIFACT_WAKE_MERGE_MS: '20',
      OPEN_ARTIFACT_CLI: `"${process.execPath}" "${bin}"`,
      OPEN_ARTIFACT_HERMES_DATA: join(dir, 'plugin-data'),
      OA_TEST_WORK: join(dir, 'work'),
      PYTHONDONTWRITEBYTECODE: '1',
    };
  });

  after(() => {
    try {
      const { pid } = JSON.parse(readFileSync(join(dir, 'home', 'daemon.json'), 'utf8'));
      if (pid) process.kill(pid, 'SIGTERM');
    } catch {
      // no daemon came up
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('registers its tools and hooks, makes an artifact, takes the owner\'s Ask live and hands a refused one over as data', { timeout: 120_000 }, () => {
    const run = spawnSync('python3', [join(here, 'fake_gateway.py')], { env, encoding: 'utf8', timeout: 110_000 });
    const lines = run.stdout.trim().split('\n');
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.deepEqual(lines.map((line) => line.split(' ')[0]), ['routing', 'failed-call', 'register', 'tools', 'live', 'inbox', 'PASS']);
    assert.match(lines[2], /^register ok daemon=\S+ inbox\.return=True$/);
    assert.match(lines[3], /attached=True/);
    assert.equal(lines[4], 'live ok via=live');
  });
});
