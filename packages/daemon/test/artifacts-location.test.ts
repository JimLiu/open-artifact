/**
 * Where a session's new artifacts go: the project of a workspace, a project's settings and the person's own for it,
 * the folder under the Open Artifact folder, and what `Artifact` does with all of it.
 */
import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { PROJECT_SETTINGS_FILE, artifactIdOf, type ArtifactRecord, type DaemonState, type ToolCallResult } from '@open-artifact/protocol';
import { api, readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { files } from '../src/paths.ts';
import { harnessProfile } from '../src/harness-profiles.ts';
import { HOME_PROJECT_MARKER, homeProjectDir, projectOf } from '../src/project.ts';
import { artifactsPlacement, projectSettingsOf } from '../src/settings.ts';
import { slugify } from '../src/store.ts';

/** The Open Artifact folder of this test process (helpers.ts). */
const HOME_WS = process.env.OPEN_ARTIFACT_HOME_WORKSPACE!;

/** A folder that looks like the top of a Git checkout. */
function repo(prefix = 'oa-repo-'): string {
  const dir = tempDir(prefix);
  mkdirSync(join(dir, '.git'));
  return dir;
}

/** A linked worktree of `main` (the files `git worktree add` leaves), without running git. */
function worktree(main: string, name = 'wt'): string {
  const dir = tempDir('oa-worktree-');
  const gitDir = join(main, '.git', 'worktrees', name);
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, 'commondir'), '../..\n');
  writeFileSync(join(dir, '.git'), `gitdir: ${gitDir}\n`);
  return dir;
}

function projectFile(dir: string, settings: unknown): void {
  const file = join(dir, PROJECT_SETTINGS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof settings === 'string' ? settings : JSON.stringify(settings));
}

function userSettings(settings: unknown): void {
  writeFileSync(files.settings(), JSON.stringify(settings));
}

beforeEach(() => rmSync(files.settings(), { force: true }));

describe('projectOf', () => {
  test('the top of the checkout, from the top and from a folder inside it', () => {
    const top = repo();
    const inner = join(top, 'packages', 'app');
    mkdirSync(inner, { recursive: true });
    assert.deepEqual(projectOf(top), { project: top, dir: top, configDir: null, gitRoot: top });
    assert.deepEqual(projectOf(inner), { project: top, dir: top, configDir: null, gitRoot: top });
  });

  test('the nearest settings file up to the top of the checkout makes its folder the project', () => {
    const top = repo();
    const inner = join(top, 'packages', 'app', 'src');
    mkdirSync(inner, { recursive: true });
    projectFile(top, {});
    assert.equal(projectOf(inner).configDir, top);
    projectFile(join(top, 'packages', 'app'), {});
    const info = projectOf(inner);
    assert.equal(info.configDir, join(top, 'packages', 'app'));
    assert.equal(info.project, join(top, 'packages', 'app'));
    assert.equal(info.gitRoot, top);
  });

  test('a folder in no checkout is looked at alone: a settings file in a parent folder is not its own', () => {
    const parent = tempDir('oa-plain-');
    const inner = join(parent, 'notes');
    mkdirSync(inner);
    projectFile(parent, { artifactsLocation: 'workspace' });
    assert.deepEqual(projectOf(inner), { project: inner, dir: inner, configDir: null, gitRoot: null });
    assert.equal(projectOf(parent).configDir, parent);
  });

  test('a worktree is the project of its main working tree; its own settings file is the one read', () => {
    const main = repo();
    const wt = worktree(main);
    assert.deepEqual(projectOf(wt), { project: main, dir: wt, configDir: null, gitRoot: wt });
    mkdirSync(join(wt, 'pkg'));
    projectFile(join(wt, 'pkg'), {});
    const info = projectOf(join(wt, 'pkg'));
    assert.equal(info.configDir, join(wt, 'pkg'));
    assert.equal(info.project, join(main, 'pkg'));
  });

  test('a .git file with no commondir (a submodule) is its own project', () => {
    const dir = tempDir('oa-submodule-');
    writeFileSync(join(dir, '.git'), 'gitdir: ../.git/modules/sub\n');
    assert.deepEqual(projectOf(dir), { project: dir, dir, configDir: null, gitRoot: dir });
  });

  test("the person's own settings file is never a project's", () => {
    const top = repo();
    const before = process.env.OPEN_ARTIFACT_HOME;
    process.env.OPEN_ARTIFACT_HOME = join(top, '.agents', 'open-artifact');
    try {
      mkdirSync(process.env.OPEN_ARTIFACT_HOME, { recursive: true });
      writeFileSync(files.settings(), JSON.stringify({ artifactsLocation: 'workspace' }));
      assert.equal(projectOf(top).configDir, null);
      assert.deepEqual(artifactsPlacement(top).layers.project, {});
      assert.equal(artifactsPlacement(top).locationSource, 'user');
    } finally {
      process.env.OPEN_ARTIFACT_HOME = before;
    }
  });
});

describe('homeProjectDir', () => {
  test('named after the project folder, marked, and the same for the same project', () => {
    const base = tempDir('oa-home-ws-');
    const project = repo('my-app-');
    const dir = homeProjectDir(base, project);
    assert.equal(dir, join(base, slugify(basename(project))));
    assert.equal(JSON.parse(readFileSync(join(dir, HOME_PROJECT_MARKER), 'utf8')).project, project);
    assert.equal(homeProjectDir(base, project), dir);
    // A worktree-free second look through a link to the same folder is the same project.
    assert.equal(homeProjectDir(base, realpathSync(project)), dir);
  });

  test('another project with the same folder name gets a few digits of its path hash, always the same', () => {
    const base = tempDir('oa-home-ws-');
    const one = join(tempDir('oa-a-'), 'api');
    const two = join(tempDir('oa-b-'), 'api');
    mkdirSync(one);
    mkdirSync(two);
    assert.equal(homeProjectDir(base, one), join(base, 'api'));
    const second = homeProjectDir(base, two);
    assert.match(basename(second), /^api-[0-9a-f]{4}$/);
    assert.equal(homeProjectDir(base, two), second);
    assert.equal(homeProjectDir(base, one), join(base, 'api'));
  });

  test('a reserved name, and a folder that is not empty and says nothing, are not taken', () => {
    const base = tempDir('oa-home-ws-');
    const artifacts = join(tempDir('oa-c-'), 'artifacts');
    mkdirSync(artifacts);
    assert.match(basename(homeProjectDir(base, artifacts, ['artifacts'])), /^artifacts-[0-9a-f]{4}$/);
    const notes = join(tempDir('oa-d-'), 'notes');
    mkdirSync(notes);
    mkdirSync(join(base, 'notes'));
    writeFileSync(join(base, 'notes', 'mine.txt'), 'kept');
    assert.match(basename(homeProjectDir(base, notes)), /^notes-[0-9a-f]{4}$/);
    assert.equal(existsSync(join(base, 'notes', HOME_PROJECT_MARKER)), false);
  });
});

describe("a project's settings", () => {
  test('only the keys a project may set, with usable values', () => {
    const got = projectSettingsOf({
      artifactsLocation: 'workspace',
      artifactsDir: 'docs/decks',
      trustedProjects: ['/'],
      cloud: { publish: 'auto' },
      typeRoots: { extra: ['/tmp/evil'] },
      projects: { '/x': { artifactsLocation: 'home' } },
    });
    assert.deepEqual(got.settings, { artifactsLocation: 'workspace', artifactsDir: 'docs/decks' });
    assert.deepEqual(got.ignored.sort(), ['cloud', 'projects', 'trustedProjects', 'typeRoots']);
    assert.deepEqual(projectSettingsOf({ artifactsLocation: 'elsewhere' }), { settings: {}, ignored: ['artifactsLocation'] });
    assert.deepEqual(projectSettingsOf('nope'), { settings: {}, ignored: [] });
  });

  test('artifactsDir stays inside the project', () => {
    for (const dir of ['../out', 'a/../../out', '/etc', '~/Desktop', 'C:\\out', '', '   ']) {
      assert.deepEqual(projectSettingsOf({ artifactsDir: dir }).settings, {}, dir);
    }
    for (const dir of ['artifacts', 'docs/decks', 'a/../b', '.']) {
      assert.equal(projectSettingsOf({ artifactsDir: dir }).settings.artifactsDir, dir, dir);
    }
  });

  test('which one wins: the person for the project, the project, the person, the harness, the default', () => {
    const top = repo();
    assert.deepEqual(pick(artifactsPlacement(top)), ['home', 'default', 'artifacts', 'default']);
    assert.deepEqual(pick(artifactsPlacement(top, 'workspace')), ['workspace', 'harness', 'artifacts', 'default']);
    userSettings({ artifactsLocation: 'home', artifactsDir: 'made' });
    assert.deepEqual(pick(artifactsPlacement(top, 'workspace')), ['home', 'user', 'made', 'user']);
    projectFile(top, { artifactsLocation: 'workspace', artifactsDir: 'decks', serverPort: 1 });
    const fromProject = artifactsPlacement(top, 'workspace');
    assert.deepEqual(pick(fromProject), ['workspace', 'project', 'decks', 'project']);
    assert.deepEqual(fromProject.layers.projectIgnored, ['serverPort']);
    userSettings({ artifactsLocation: 'workspace', projects: { [top]: { artifactsLocation: 'home' } } });
    const local = artifactsPlacement(top, 'workspace');
    assert.deepEqual(pick(local), ['home', 'local', 'decks', 'project']);
    assert.equal(local.layers.localKey, top);
  });

  test("the person's entry for a project holds in each of its worktrees; a projects key in a project's file does nothing", () => {
    const main = repo();
    const wt = worktree(main);
    userSettings({ projects: { [main]: { artifactsLocation: 'workspace' } } });
    assert.deepEqual(pick(artifactsPlacement(wt)), ['workspace', 'local', 'artifacts', 'default']);
    const other = repo();
    projectFile(other, { projects: { [other]: { artifactsLocation: 'workspace' } } });
    assert.deepEqual(pick(artifactsPlacement(other)), ['home', 'default', 'artifacts', 'default']);
  });

  test('a settings file that is not a JSON object sets nothing', () => {
    const top = repo();
    projectFile(top, '{ not json');
    const placement = artifactsPlacement(top);
    assert.equal(placement.layers.fileBroken, true);
    assert.deepEqual(pick(placement), ['home', 'default', 'artifacts', 'default']);
  });
});

function pick(p: ReturnType<typeof artifactsPlacement>): [string, string, string, string] {
  return [p.location, p.locationSource, p.artifactsDir, p.artifactsDirSource];
}

describe('harness profiles', () => {
  test('every shipped profile but pi keeps artifacts in the workspace; an app without a profile says nothing', () => {
    for (const name of ['antigravity', 'chatgpt', 'claude-code', 'codex', 'copilot', 'cursor', 'dsh', 'zcode']) {
      assert.equal(harnessProfile(name).policy?.artifacts, 'workspace', name);
    }
    assert.equal(harnessProfile('pi').policy?.artifacts, undefined);
    assert.equal(harnessProfile('mcp').policy?.artifacts, undefined);
  });
});

describe('Artifact publish', () => {
  let daemon: Daemon;
  let state: DaemonState;

  before(async () => {
    daemon = await startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
    state = (await readDaemon())!;
  });
  after(() => daemon.close());

  /** Calls `Artifact` as a session of `harness` in `workspace`. `mcp` has no profile; `dsh`'s keeps artifacts in the workspace. */
  function artifact(args: Record<string, unknown>, workspace: string | null, harness = 'mcp', session = 's1'): Promise<ToolCallResult> {
    return api<ToolCallResult>(state, 'tools.call', { name: 'Artifact', arguments: args, caller: { harness, session, workspace } });
  }
  async function make(title: string, workspace: string | null, harness = 'mcp', more: Record<string, unknown> = {}, session = 's1'): Promise<ToolCallResult & { root: string; id: string }> {
    const made = await artifact({ action: 'publish', type_url: 'open-artifact://type/design', title, open: 'never', ...more }, workspace, harness, session);
    assert.equal(made.error, undefined, JSON.stringify(made.error));
    return { ...made, root: String(made.root), id: artifactIdOf(String(made.url))! };
  }
  const record = (id: string): ArtifactRecord => JSON.parse(readFileSync(join(files.artifacts(), `${id}.json`), 'utf8')) as ArtifactRecord;
  const notes = (result: ToolCallResult): string => ((result.notes as string[] | undefined) ?? []).join('\n');

  test('with nothing set, a session of an app without a profile makes it under the Open Artifact folder, by project', async () => {
    const top = repo('shop-');
    const made = await make('Launch plan', join(top));
    assert.equal(made.root, join(HOME_WS, slugify(basename(top)), 'launch-plan'));
    assert.equal(record(made.id).project, top);
    assert.match(notes(made), /outside your working folder/);
    assert.equal(existsSync(join(top, 'artifacts')), false);
    // The same name again: the folder is taken, so -2.
    assert.equal((await make('Launch plan', top)).root, join(HOME_WS, slugify(basename(top)), 'launch-plan-2'));
  });

  test("an app whose profile keeps artifacts in the workspace: there, and out of git when the daemon makes the folder", async () => {
    const top = repo();
    const made = await make('Board', top, 'dsh');
    assert.equal(made.root, join(top, 'artifacts', 'board'));
    assert.equal(record(made.id).project, top);
    assert.doesNotMatch(notes(made), /outside your working folder/);
    assert.match(readFileSync(join(top, 'artifacts', '.gitignore'), 'utf8'), /^\*$/m);
    // A folder that was already there is the person's: nothing is added to it.
    const kept = repo();
    mkdirSync(join(kept, 'artifacts'));
    await make('Board', kept, 'dsh');
    assert.equal(existsSync(join(kept, 'artifacts', '.gitignore')), false);
    // No checkout, no .gitignore.
    const plain = tempDir('oa-plain-');
    assert.equal((await make('Board', plain, 'dsh')).root, join(plain, 'artifacts', 'board'));
    assert.equal(existsSync(join(plain, 'artifacts', '.gitignore')), false);
  });

  test('location, for one artifact: the folder is still named by the daemon, and a chosen workspace is not ignored', async () => {
    const top = repo();
    const inRepo = await make('Deck', top, 'mcp', { location: 'workspace' });
    assert.equal(inRepo.root, join(top, 'artifacts', 'deck'));
    assert.equal(existsSync(join(top, 'artifacts', '.gitignore')), false);
    const atHome = await make('Deck', top, 'dsh', { location: 'home' });
    assert.equal(atHome.root, join(HOME_WS, slugify(basename(top)), 'deck'));
    const bad = await artifact({ action: 'publish', type_url: 'open-artifact://type/design', title: 'x', location: 'desktop' }, top);
    assert.equal(bad.error?.code, 'invalid_argument');
    // folder still wins, as given.
    assert.equal((await make('Deck', top, 'dsh', { folder: 'exact/place', location: 'home' })).root, join(top, 'exact', 'place'));
  });

  test("the person's own setting is theirs: workspace without a .gitignore, home for an app that defaults to the workspace", async () => {
    const top = repo();
    userSettings({ artifactsLocation: 'workspace' });
    assert.equal((await make('Mine', top, 'dsh')).root, join(top, 'artifacts', 'mine'));
    assert.equal(existsSync(join(top, 'artifacts', '.gitignore')), false);
    userSettings({ artifactsLocation: 'home' });
    assert.equal((await make('Mine', top, 'dsh')).root, join(HOME_WS, slugify(basename(top)), 'mine'));
  });

  test("a project's file: its folder, from a session anywhere in the checkout; the person's entry for the project wins", async () => {
    const top = repo();
    const inner = join(top, 'packages', 'app');
    mkdirSync(inner, { recursive: true });
    projectFile(top, { artifactsLocation: 'workspace', artifactsDir: 'docs/decks', cloud: { publish: 'auto' } });
    const made = await make('Roadmap', inner);
    assert.equal(made.root, join(top, 'docs', 'decks', 'roadmap'));
    assert.equal(existsSync(join(top, 'docs', 'decks', '.gitignore')), false);
    userSettings({ projects: { [top]: { artifactsLocation: 'home' } } });
    assert.equal((await make('Roadmap', inner)).root, join(HOME_WS, slugify(basename(top)), 'roadmap'));
  });

  test("the person's own folder for a project is relative to the project, from a session anywhere in it", async () => {
    const top = repo();
    const inner = join(top, 'packages', 'app');
    mkdirSync(inner, { recursive: true });
    userSettings({ projects: { [top]: { artifactsLocation: 'workspace', artifactsDir: 'design/out' } } });
    assert.equal((await make('Mock', inner)).root, join(top, 'design', 'out', 'mock'));
    // Their folder name for every project stays under the session's own folder, as before.
    userSettings({ artifactsLocation: 'workspace', artifactsDir: 'made' });
    assert.equal((await make('Mock', inner)).root, join(inner, 'made', 'mock'));
  });

  test('no working folder: the artifacts folder of the Open Artifact folder', async () => {
    const made = await make('Loose', null);
    assert.equal(made.root, join(HOME_WS, 'artifacts', 'loose'));
    assert.equal(record(made.id).project, undefined);
  });

  test("list mine: the project's artifacts wherever their folders are, from another session and from a worktree", async () => {
    const main = repo();
    const wt = worktree(main);
    const elsewhere = repo();
    const made = await make('Shared plan', main, 'mcp', {}, 'maker');
    assert.ok(made.root.startsWith(HOME_WS));
    const titles = async (workspace: string, session: string): Promise<string[]> => {
      const listed = await artifact({ action: 'list' }, workspace, 'mcp', session);
      return (listed.artifacts as Array<{ title: string }>).map((a) => a.title);
    };
    assert.ok((await titles(main, 'peer')).includes('Shared plan'));
    assert.ok((await titles(wt, 'in-worktree')).includes('Shared plan'));
    assert.equal((await titles(elsewhere, 'stranger')).includes('Shared plan'), false);
    // quickstart finds it as one to reuse, from the worktree too.
    const quick = await artifact({ action: 'quickstart', type: 'design', title: 'Shared plan' }, wt, 'mcp', 'in-worktree');
    assert.ok(JSON.stringify(quick).includes(made.id), JSON.stringify(quick).slice(0, 400));
  });
});
