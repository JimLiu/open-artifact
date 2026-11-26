/**
 * `open-artifact config`: setting and removing a plain setting in the person's file, a project's file and the person's
 * entry for a project; what is in effect and who set it; the daemon's route (the person's only); the command line.
 */
import { tempDir, TEST_HOME } from './helpers.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import { PROJECT_SETTINGS_FILE, type ConfigListResponse, type ConfigSetResponse, type DaemonState, type ToolCallResult } from '@open-artifact/protocol';
import { api, readDaemon } from '../src/client.ts';
import { configList, configSet } from '../src/config.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { files } from '../src/paths.ts';

const BIN = fileURLToPath(new URL('../src/bin/open-artifact.ts', import.meta.url));
const HOME_WS = process.env.OPEN_ARTIFACT_HOME_WORKSPACE!;

function repo(): string {
  const dir = tempDir('oa-config-repo-');
  mkdirSync(join(dir, '.git'));
  return dir;
}

/** A linked worktree of `main` (the files `git worktree add` leaves), without running git. */
function worktree(main: string): string {
  const dir = tempDir('oa-config-worktree-');
  const gitDir = join(main, '.git', 'worktrees', 'wt');
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, 'commondir'), '../..\n');
  writeFileSync(join(dir, '.git'), `gitdir: ${gitDir}\n`);
  return dir;
}

const saved = (): Record<string, unknown> => (existsSync(files.settings()) ? (JSON.parse(readFileSync(files.settings(), 'utf8')) as Record<string, unknown>) : {});
const projectFile = (dir: string): string => join(dir, PROJECT_SETTINGS_FILE);
const read = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

beforeEach(() => rmSync(files.settings(), { force: true }));

describe('configSet', () => {
  test("the person's file: one key changes, the others stay; unset removes it", () => {
    writeFileSync(files.settings(), JSON.stringify({ trustedProjects: ['/x'], serverPort: 4900 }));
    const done = configSet({ key: 'artifactsLocation', value: 'home' });
    assert.deepEqual(done, { ok: true, key: 'artifactsLocation', value: 'home', scope: 'user', file: files.settings() });
    assert.deepEqual(saved(), { trustedProjects: ['/x'], serverPort: 4900, artifactsLocation: 'home' });
    assert.equal(configSet({ key: 'serverPort', value: '4801' }).value, 4801);
    configSet({ key: 'homeWorkspace', value: '~/Decks' });
    configSet({ key: 'artifactsLocation', value: null });
    assert.deepEqual(saved(), { trustedProjects: ['/x'], serverPort: 4801, homeWorkspace: '~/Decks' });
  });

  test('values are checked, and keys with a command of their own are sent to it', () => {
    assert.throws(() => configSet({ key: 'artifactsLocation', value: 'desktop' }), { code: 'invalid_argument' });
    assert.throws(() => configSet({ key: 'serverPort', value: 'eighty' }), { code: 'invalid_argument' });
    assert.throws(() => configSet({ key: 'homeWorkspace', value: 'relative/dir' }), { code: 'invalid_argument' });
    assert.throws(() => configSet({ key: 'nope', value: '1' }), { code: 'invalid_argument' });
    assert.throws(() => configSet({ key: 'trustedProjects', value: '/x' }), /types trust/);
    assert.throws(() => configSet({ key: 'cloud', value: 'auto' }), /remote default/);
    assert.throws(() => configSet({ key: 'projects', value: '{}' }), /--local/);
    assert.deepEqual(saved(), {});
  });

  test("a project's file: at the top of the checkout from anywhere in it, only a project's keys, gone when empty", () => {
    const top = repo();
    const inner = join(top, 'packages', 'app');
    mkdirSync(inner, { recursive: true });
    const done = configSet({ key: 'artifactsLocation', value: 'workspace', scope: 'project', workspace: inner });
    assert.equal(done.file, projectFile(top));
    assert.equal(done.project, top);
    configSet({ key: 'artifactsDir', value: 'docs/decks', scope: 'project', workspace: inner });
    assert.deepEqual(read(projectFile(top)), { artifactsLocation: 'workspace', artifactsDir: 'docs/decks' });
    assert.deepEqual(saved(), {}, "the person's file is not touched");
    assert.throws(() => configSet({ key: 'artifactsDir', value: '../out', scope: 'project', workspace: top }), { code: 'invalid_argument' });
    assert.throws(() => configSet({ key: 'artifactsDir', value: '/abs', scope: 'project', workspace: top }), { code: 'invalid_argument' });
    assert.throws(() => configSet({ key: 'homeWorkspace', value: '~/x', scope: 'project', workspace: top }), /not a project's to set/);
    assert.throws(() => configSet({ key: 'artifactsDir', value: 'x', scope: 'project' }), /workspace/);
    configSet({ key: 'artifactsDir', value: null, scope: 'project', workspace: top });
    configSet({ key: 'artifactsLocation', value: null, scope: 'project', workspace: top });
    assert.equal(existsSync(projectFile(top)), false);
    assert.equal(existsSync(dirname(projectFile(top))), false);
  });

  test("a project's file that is not a JSON object is left as it is", () => {
    const top = repo();
    mkdirSync(dirname(projectFile(top)), { recursive: true });
    writeFileSync(projectFile(top), '[1, 2');
    assert.throws(() => configSet({ key: 'artifactsLocation', value: 'home', scope: 'project', workspace: top }), /not a JSON object/);
    assert.equal(readFileSync(projectFile(top), 'utf8'), '[1, 2');
  });

  test("the person's entry for a project: by the project's folder, the same one from a worktree, gone when empty", () => {
    const top = repo();
    const wt = worktree(top);
    const done = configSet({ key: 'artifactsLocation', value: 'home', scope: 'local', workspace: wt });
    assert.equal(done.file, files.settings());
    assert.equal(done.project, top);
    assert.deepEqual(saved(), { projects: { [top]: { artifactsLocation: 'home' } } });
    configSet({ key: 'artifactsDir', value: 'out', scope: 'local', workspace: top });
    assert.deepEqual(saved(), { projects: { [top]: { artifactsLocation: 'home', artifactsDir: 'out' } } });
    assert.equal(existsSync(projectFile(top)), false, 'nothing is written into the repository');
    configSet({ key: 'artifactsLocation', value: null, scope: 'local', workspace: top });
    configSet({ key: 'artifactsDir', value: null, scope: 'local', workspace: wt });
    assert.deepEqual(saved(), {});
  });
});

describe('configList', () => {
  test('each value with who set it', () => {
    const top = repo();
    let listed = configList(top, 'mcp');
    assert.deepEqual(listed.values.artifactsLocation, { value: 'home', source: 'default' });
    assert.deepEqual(listed.values.artifactsDir, { value: 'artifacts', source: 'default' });
    assert.deepEqual(listed.values.homeWorkspace, { value: HOME_WS, source: 'environment' });
    assert.equal(listed.project?.path, top);
    assert.equal(listed.project?.file, null);
    assert.deepEqual(configList(top, 'dsh', 'workspace').values.artifactsLocation, { value: 'workspace', source: 'harness' });

    configSet({ key: 'artifactsLocation', value: 'home' });
    assert.deepEqual(configList(top, 'dsh', 'workspace').values.artifactsLocation, { value: 'home', source: 'user' });

    mkdirSync(dirname(projectFile(top)), { recursive: true });
    writeFileSync(projectFile(top), JSON.stringify({ artifactsLocation: 'workspace', artifactsDir: 'decks', trustedProjects: ['/'] }));
    listed = configList(top, 'dsh', 'workspace');
    assert.deepEqual(listed.values.artifactsLocation, { value: 'workspace', source: 'project' });
    assert.deepEqual(listed.values.artifactsDir, { value: 'decks', source: 'project' });
    assert.equal(listed.project?.file, projectFile(top));
    assert.deepEqual(listed.project?.ignored, ['trustedProjects']);

    configSet({ key: 'artifactsLocation', value: 'home', scope: 'local', workspace: top });
    listed = configList(top, 'dsh', 'workspace');
    assert.deepEqual(listed.values.artifactsLocation, { value: 'home', source: 'local' });
    assert.deepEqual(listed.project?.local, { artifactsLocation: 'home' });
  });

  test('without a workspace: the person, the harness, the default', () => {
    assert.deepEqual(configList(null, null).values.artifactsLocation, { value: 'home', source: 'default' });
    assert.deepEqual(configList(null, 'dsh', 'workspace').values.artifactsLocation, { value: 'workspace', source: 'harness' });
    configSet({ key: 'artifactsLocation', value: 'workspace' });
    assert.deepEqual(configList(null, null).values.artifactsLocation, { value: 'workspace', source: 'user' });
    assert.equal(configList(null, null).project, undefined);
  });
});

describe('the daemon and the command line', () => {
  let daemon: Daemon;
  let state: DaemonState;

  before(async () => {
    daemon = await startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
    state = (await readDaemon())!;
  });
  after(() => daemon.close());

  const post = (body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(`${state.url}/api/open-artifact.config.set`, {
      method: 'POST',
      headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  interface Run {
    code: number | null;
    stdout: string;
    stderr: string;
  }
  function cli(args: string[], env: Record<string, string> = {}): Promise<Run> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, [BIN, ...args], {
        env: { ...process.env, OPEN_ARTIFACT_HOME: TEST_HOME, OPEN_ARTIFACT_BROWSER: 'none', ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      const timer = setTimeout(() => child.kill(), 60_000);
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolvePromise({ code, stdout, stderr });
      });
    });
  }

  test('config.set is the person\'s: refused inside an agent\'s session and from another origin, and the daemon uses what was set at once', async () => {
    const top = repo();
    const body = { key: 'artifactsLocation', value: 'workspace', scope: 'local', workspace: top };
    const fromAgent = await post(body, { 'x-open-artifact-agent': 'claude-code:abc' });
    assert.equal(fromAgent.status, 403);
    assert.equal(((await fromAgent.json()) as { code: string }).code, 'not_granted');
    assert.equal((await post(body, { origin: 'http://art.frame.localhost:1' })).status, 403);
    assert.equal((await post({ key: 'artifactsLocation', value: 'desktop' })).status, 400);
    assert.deepEqual(saved(), {}, 'nothing saved yet');

    const done = await post(body);
    assert.equal(done.status, 200);
    assert.equal(((await done.json()) as ConfigSetResponse).project, top);
    const made = await api<ToolCallResult>(state, 'tools.call', {
      name: 'Artifact',
      arguments: { action: 'publish', type_url: 'open-artifact://type/design', title: 'Config deck', open: 'never' },
      caller: { harness: 'mcp', session: 'config-1', workspace: top },
    });
    assert.equal(made.error, undefined, JSON.stringify(made.error));
    assert.equal(made.root, join(top, 'artifacts', 'config-deck'));
  });

  test('the command line: set, get, list and unset, in each place; refused when an agent runs it', async () => {
    const top = repo();
    const inner = join(top, 'src');
    mkdirSync(inner);
    let run = await cli(['config', 'get', 'artifactsLocation', '--workspace', top]);
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.stdout.trim(), 'home');
    run = await cli(['config', 'get', 'artifactsLocation', '--workspace', top, '--harness', 'claude-code']);
    assert.equal(run.stdout.trim(), 'workspace');

    run = await cli(['config', 'set', 'artifactsLocation', 'home', '--project', '--workspace', inner]);
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /this project's settings/);
    assert.deepEqual(read(projectFile(top)), { artifactsLocation: 'home' });

    run = await cli(['config', 'set', '--local', 'artifactsLocation', 'workspace', '--workspace', inner]);
    assert.equal(run.code, 0, run.stderr);
    assert.deepEqual(saved(), { projects: { [top]: { artifactsLocation: 'workspace' } } });

    run = await cli(['config', 'list', '--workspace', inner, '--harness', 'claude-code']);
    assert.equal(run.code, 0, run.stderr);
    const listed = JSON.parse(run.stdout) as ConfigListResponse;
    assert.deepEqual(listed.values.artifactsLocation, { value: 'workspace', source: 'local' });
    assert.deepEqual(listed.project?.settings, { artifactsLocation: 'home' });

    run = await cli(['config', 'set', 'artifactsDir', 'decks']);
    assert.equal(run.code, 0, run.stderr);
    assert.equal(saved().artifactsDir, 'decks');
    run = await cli(['config', 'unset', 'artifactsDir']);
    assert.equal(run.code, 0, run.stderr);
    assert.equal('artifactsDir' in saved(), false);

    run = await cli(['config', 'set', 'artifactsLocation', 'home', '--project', '--local']);
    assert.notEqual(run.code, 0);
    run = await cli(['config', 'set', 'artifactsLocation', 'desktop']);
    assert.notEqual(run.code, 0);
    assert.match(run.stderr, /home or workspace/);
    run = await cli(['config', 'set', 'trustedProjects', top]);
    assert.match(run.stderr, /types trust/);

    const before = JSON.stringify(saved());
    run = await cli(['config', 'set', 'artifactsLocation', 'home'], { CLAUDECODE: '1' });
    assert.notEqual(run.code, 0);
    assert.equal(JSON.stringify(saved()), before);
    // Reading is anyone's.
    run = await cli(['config', 'get', 'artifactsLocation', '--workspace', top], { CLAUDECODE: '1' });
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.stdout.trim(), 'workspace');

    run = await cli(['config', 'unset', 'artifactsLocation', '--local', '--workspace', top]);
    assert.equal(run.code, 0, run.stderr);
    run = await cli(['config', 'unset', 'artifactsLocation', '--project', '--workspace', top]);
    assert.equal(run.code, 0, run.stderr);
    assert.deepEqual(saved(), {});
    assert.equal(existsSync(projectFile(top)), false);
  });
});
