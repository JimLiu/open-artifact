// Where a session's new artifacts go: a real daemon (`open-artifact daemon run`, from source) with a temporary HOME
// and no settings, real Git checkouts (`git init`, `git worktree add`), and the `open-artifact` command line run in
// them as an agent's session would (`artifact '{…}'`) and as the person would (`config set`). `note` is a static user
// type, so nothing has to be built.
//
//  (a) With nothing set, a session of an app without a profile (the command line itself): the artifact goes under the
//      person's Open Artifact folder, `~/OpenArtifact/<project>/<slug>`, and the checkout stays clean.
//  (b) A session of an app whose profile keeps artifacts in the workspace (`--harness claude-code`): the checkout's
//      `artifacts/<slug>`, with a `.gitignore` the daemon wrote, so the checkout stays clean there too.
//  (c) `location`, for one artifact, either way; a `folder` still wins.
//  (d) `open-artifact config set artifactsLocation home`: the person's own choice comes before the app's default, and
//      `config unset` gives the default back. An agent's session may not change it.
//  (e) The project's settings file (`.agents/open-artifact/settings.json`): its folder for everyone, from a folder
//      deep in the checkout; keys that are not a project's are ignored; the person's `--local` entry comes before it.
//  (f) A linked worktree is the same project: the same folder under the Open Artifact folder, and its sessions list
//      the project's artifacts; a session in another checkout does not.
//  (g) Two projects with the same folder name get two folders under the Open Artifact folder.
//  (h) `open-artifact doctor` says where an app's sessions keep new artifacts in a checkout and who chose it, warns
//      when home was chosen for an app that keeps its agent to the working folder, and names a project file's unused keys.
//  (i) In Chrome, the daemon's home page names each artifact's project on its card and narrows the list to one project,
//      telling two projects of one name apart (skipped without Chrome or the built home page).
//
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { until } from './lib/http.mjs';
import { browserOff, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 120000 };
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const skip = spawnSync('git', ['--version']).status === 0 ? false : 'git is not installed';

/** A TCP port nobody listens on now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

describe('where new artifacts go: the Open Artifact folder, the workspace, and the settings that choose', { skip }, () => {
  const ctx = {};

  const git = (cwd, ...args) => {
    const r = spawnSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  /** A checkout with one commit, in a folder called `name`. */
  const checkout = (name) => {
    const dir = path.join(tmpDir('location'), name);
    fs.mkdirSync(dir);
    git(dir, 'init', '-q');
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n`);
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'first');
    return dir;
  };
  /** What `git status` shows as changed or untracked. */
  const dirty = (dir) => git(dir, 'status', '--porcelain').trim();

  /** The command line, run in `cwd`. `env` adds variables (an agent app's, to run it as an agent would). */
  const cli = (cwd, args, env = {}) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...ctx.env, ...env }, encoding: 'utf8', timeout: 60000 });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  /** An `Artifact` call from a session working in `cwd`; `harness` is the app (none: the command line's own `cli`). */
  const artifact = (cwd, args, { harness, session = 's1' } = {}) => {
    const r = cli(cwd, ['artifact', JSON.stringify(args), '--session', session, ...(harness ? ['--harness', harness] : [])]);
    let result;
    try {
      result = JSON.parse(r.stdout);
    } catch {
      assert.fail(`artifact ${JSON.stringify(args)}: ${r.stdout}${r.stderr}`);
    }
    return result;
  };
  const make = (cwd, title, who = {}, extra = {}) => {
    const made = artifact(cwd, { action: 'publish', type_url: 'open-artifact://type/note', title, open: 'never', ...extra }, who);
    assert.equal(made.error, undefined, JSON.stringify(made.error));
    return made;
  };
  const titles = (cwd, who = {}) => (artifact(cwd, { action: 'list' }, who).artifacts ?? []).map(a => a.title).sort();
  const config = (cwd, ...args) => {
    const r = cli(cwd, ['config', ...args]);
    assert.equal(r.code, 0, `config ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };

  before(async () => {
    const root = tmpDir('location-daemon');
    ctx.home = path.join(root, 'home');
    ctx.userHome = path.join(root, 'user-home');
    ctx.openArtifact = path.join(ctx.userHome, 'OpenArtifact');
    const types = path.join(root, 'types');
    const note = path.join(types, 'note');
    fs.mkdirSync(note, { recursive: true });
    fs.mkdirSync(ctx.userHome);
    fs.writeFileSync(path.join(note, 'artifact-type.json'), JSON.stringify({ name: 'Note', description: 'A one-page note as a local HTML file.', when: 'The person wants a short note.' }));
    fs.writeFileSync(path.join(note, 'index.html'), '<!doctype html><meta charset="utf-8"><title>note</title><h1>A note</h1>\n');

    ctx.port = await freePort();
    ctx.env = {
      ...process.env,
      HOME: ctx.userHome,
      USERPROFILE: ctx.userHome,
      OPEN_ARTIFACT_HOME: ctx.home,
      OPEN_ARTIFACT_USER_TYPES: types,
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(root, 'type-servers'),
      OPEN_ARTIFACT_BROWSER: 'none',
      OPEN_ARTIFACT_IDLE_MS: '0',
    };
    // The defaults are what is tested: nothing names the Open Artifact folder, the app or the session.
    for (const name of [
      'OPEN_ARTIFACT_HOME_WORKSPACE',
      'OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY',
      'OPEN_ARTIFACT_EXTRA_TYPES',
      'OPEN_ARTIFACT_SHELL_DIR',
      'OPEN_ARTIFACT_HOME_DIR',
      'OPEN_ARTIFACT_REMOTE',
      'OPEN_ARTIFACT_REMOTE_TOKEN',
      'OPEN_ARTIFACT_HARNESS',
      'OPEN_ARTIFACT_SESSION',
      'OPEN_ARTIFACT_PORT',
    ])
      delete ctx.env[name];
    ctx.log = '';
    ctx.daemon = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', String(ctx.port)], { env: ctx.env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.daemon.stdout.on('data', chunk => (ctx.log += chunk));
    ctx.daemon.stderr.on('data', chunk => (ctx.log += chunk));
    ctx.stop = () => ctx.daemon.exitCode === null && ctx.daemon.kill('SIGKILL');
    process.on('exit', ctx.stop);
    assert.ok(await until(() => fs.existsSync(path.join(ctx.home, 'daemon.json')), 30000), `the daemon did not start:\n${ctx.log}`);
  });

  after(async () => {
    if (ctx.daemon?.exitCode === null) {
      const exited = new Promise(resolve => ctx.daemon.once('exit', resolve));
      ctx.daemon.kill('SIGTERM');
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    ctx.stop?.();
  });

  it("(a) nothing set, an app without a profile: under the person's Open Artifact folder, and the checkout stays clean", T, () => {
    const repo = checkout('shop');
    const inner = path.join(repo, 'packages', 'app');
    fs.mkdirSync(inner, { recursive: true });
    const made = make(inner, 'Launch plan');
    assert.equal(made.root, path.join(ctx.openArtifact, 'shop', 'launch-plan'));
    assert.ok(fs.existsSync(path.join(made.root, '.artifact.json')));
    assert.match((made.notes ?? []).join('\n'), /outside your working folder/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ctx.openArtifact, 'shop', '.open-artifact-project.json'), 'utf8')), { project: repo });
    assert.equal(dirty(repo), '');
    assert.equal(fs.existsSync(path.join(repo, 'artifacts')), false);
    assert.equal(config(inner, 'get', 'artifactsLocation'), 'home');
    // The session finds it again, from any folder of the project.
    assert.deepEqual(titles(repo), ['Launch plan']);
  });

  it("(b) an app whose profile keeps artifacts in the workspace: the checkout's artifacts/, kept out of git", T, () => {
    const repo = checkout('site');
    const who = { harness: 'claude-code' };
    const made = make(repo, 'Home page', who);
    assert.equal(made.root, path.join(repo, 'artifacts', 'home-page'));
    assert.doesNotMatch((made.notes ?? []).join('\n'), /outside your working folder/);
    assert.match(fs.readFileSync(path.join(repo, 'artifacts', '.gitignore'), 'utf8'), /^\*$/m);
    assert.equal(dirty(repo), '', 'the artifacts folder ignores itself');
    assert.equal(fs.existsSync(path.join(ctx.openArtifact, 'site')), false);
    assert.equal(config(repo, 'get', 'artifactsLocation', '--harness', 'claude-code'), 'workspace');
    // A folder the person already keeps (and tracks) is theirs: nothing is added to it.
    const kept = checkout('kept');
    fs.mkdirSync(path.join(kept, 'artifacts'));
    make(kept, 'Board', who);
    assert.equal(fs.existsSync(path.join(kept, 'artifacts', '.gitignore')), false);
    assert.match(dirty(kept), /artifacts\//);
  });

  it('(c) location, for one artifact, either way; an exact folder still wins', T, () => {
    const repo = checkout('docs-site');
    const inRepo = make(repo, 'Deck', {}, { location: 'workspace' });
    assert.equal(inRepo.root, path.join(repo, 'artifacts', 'deck'));
    assert.equal(fs.existsSync(path.join(repo, 'artifacts', '.gitignore')), false, 'asked for: not hidden from git');
    const atHome = make(repo, 'Deck', { harness: 'claude-code' }, { location: 'home' });
    assert.equal(atHome.root, path.join(ctx.openArtifact, 'docs-site', 'deck'));
    assert.equal(make(repo, 'Deck', { harness: 'claude-code' }, { location: 'home', folder: 'design/deck' }).root, path.join(repo, 'design', 'deck'));
    assert.equal(artifact(repo, { action: 'publish', type_url: 'open-artifact://type/note', title: 'x', location: 'desktop' }).error?.code, 'invalid_argument');
  });

  it("(d) config set artifactsLocation: the person's choice comes before the app's default, and only the person sets it", T, () => {
    const repo = checkout('api');
    const who = { harness: 'claude-code' };
    const refused = cli(repo, ['config', 'set', 'artifactsLocation', 'home'], { CLAUDECODE: '1' });
    assert.notEqual(refused.code, 0);
    assert.equal(fs.existsSync(path.join(ctx.home, 'settings.json')), false, 'nothing was saved');

    assert.match(config(repo, 'set', 'artifactsLocation', 'home'), /artifactsLocation = home in your settings/);
    assert.deepEqual(JSON.parse(config(repo, 'list', '--harness', 'claude-code')).values.artifactsLocation, { value: 'home', source: 'user' });
    assert.equal(make(repo, 'Spec', who).root, path.join(ctx.openArtifact, 'api', 'spec'));
    assert.equal(dirty(repo), '');

    config(repo, 'set', 'artifactsLocation', 'workspace');
    assert.equal(make(repo, 'Spec', {}).root, path.join(repo, 'artifacts', 'spec'));
    assert.equal(fs.existsSync(path.join(repo, 'artifacts', '.gitignore')), false, 'the person chose the checkout: git shows it');

    config(repo, 'unset', 'artifactsLocation');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ctx.home, 'settings.json'), 'utf8')), {});
    assert.equal(make(repo, 'Spec two', {}).root, path.join(ctx.openArtifact, 'api', 'spec-two'));
  });

  it("(e) the project's settings file: its folder for everyone; other keys are ignored; the person's --local entry comes first", T, () => {
    const repo = checkout('handbook');
    const inner = path.join(repo, 'chapters', 'one');
    fs.mkdirSync(inner, { recursive: true });
    assert.match(config(inner, 'set', 'artifactsLocation', 'workspace', '--project'), /this project's settings/);
    config(inner, 'set', 'artifactsDir', 'docs/artifacts', '--project');
    const file = path.join(repo, '.agents', 'open-artifact', 'settings.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { artifactsLocation: 'workspace', artifactsDir: 'docs/artifacts' });
    // What a repository may not decide for the person: trust, the Open Artifact folder, publishing.
    fs.writeFileSync(file, JSON.stringify({ artifactsLocation: 'workspace', artifactsDir: 'docs/artifacts', trustedProjects: [repo], homeWorkspace: path.join(repo, 'elsewhere'), cloud: { publish: 'auto' } }));

    const made = make(inner, 'Chapter map');
    assert.equal(made.root, path.join(repo, 'docs', 'artifacts', 'chapter-map'));
    assert.equal(fs.existsSync(path.join(repo, 'docs', 'artifacts', '.gitignore')), false, 'the project keeps them: git shows them');
    const listed = JSON.parse(config(inner, 'list'));
    assert.deepEqual(listed.values.artifactsLocation, { value: 'workspace', source: 'project' });
    assert.deepEqual(listed.values.artifactsDir, { value: 'docs/artifacts', source: 'project' });
    assert.deepEqual(listed.project.ignored.sort(), ['cloud', 'homeWorkspace', 'trustedProjects']);
    assert.equal(listed.values.homeWorkspace.source, 'default');
    assert.equal(fs.existsSync(path.join(repo, 'elsewhere')), false);

    // The person differs for this project, without touching the repository's file.
    const before = fs.readFileSync(file, 'utf8');
    assert.match(config(inner, 'set', 'artifactsLocation', 'home', '--local'), /your settings for the project/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal(make(inner, 'Chapter two').root, path.join(ctx.openArtifact, 'handbook', 'chapter-two'));
    assert.equal(JSON.parse(config(inner, 'list')).values.artifactsLocation.source, 'local');
    config(inner, 'unset', 'artifactsLocation', '--local');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ctx.home, 'settings.json'), 'utf8')), {});
    assert.equal(make(inner, 'Chapter three').root, path.join(repo, 'docs', 'artifacts', 'chapter-three'));
  });

  it('(f) a linked worktree is the same project: the same folder, and its sessions list the project\'s artifacts', T, () => {
    const repo = checkout('engine');
    const tree = path.join(tmpDir('location-worktree'), 'engine-fix');
    git(repo, 'worktree', 'add', '-q', '-b', 'fix', tree);
    const fromMain = make(repo, 'Design notes', { session: 'main-1' });
    const fromTree = make(tree, 'Fix plan', { session: 'tree-1' });
    assert.equal(fromMain.root, path.join(ctx.openArtifact, 'engine', 'design-notes'));
    assert.equal(fromTree.root, path.join(ctx.openArtifact, 'engine', 'fix-plan'));
    assert.equal(dirty(repo), '');
    assert.equal(dirty(tree), '');
    // Each session sees both; a third one in the worktree, which made neither, does too.
    assert.deepEqual(titles(repo, { session: 'main-1' }), ['Design notes', 'Fix plan']);
    assert.deepEqual(titles(tree, { session: 'tree-2' }), ['Design notes', 'Fix plan']);
    // Another checkout's session sees none of them.
    const other = checkout('unrelated');
    assert.deepEqual(titles(other, { session: 'other-1' }), []);
  });

  it('(h) doctor: the location in effect and who chose it, the setting an app needs, and a project file\'s unused keys', T, () => {
    const repo = checkout('portal');
    const doctor = (...args) => {
      // The apps' own settings are looked for under the temporary HOME: there are none.
      const r = cli(repo, ['doctor', '--json', ...args]);
      const report = JSON.parse(r.stdout);
      return { report, find: id => report.findings.filter(f => f.id === id) };
    };
    let d = doctor('--harness', 'claude-code');
    assert.equal(d.find('artifacts-location')[0].status, 'ok');
    assert.ok(d.find('artifacts-location')[0].message.includes(`${path.join(repo, 'artifacts')}/<slug> (artifactsLocation workspace: the default of claude-code)`));
    assert.match(d.find('home-workspace')[0].message, /not made yet|Open Artifact folder/);
    assert.equal(d.find('project-settings')[0].message, `Project ${repo}: no settings file of its own`);

    config(repo, 'set', 'artifactsLocation', 'home', '--local');
    d = doctor('--harness', 'claude-code');
    const warned = d.find('artifacts-location')[0];
    assert.equal(warned.status, 'warn');
    assert.match(warned.message, /artifactsLocation home: your setting for this project/);
    assert.ok(warned.fix.includes(`claude --add-dir ${ctx.openArtifact}`));
    // Claude Code's own settings allow the folder: no warning.
    fs.mkdirSync(path.join(ctx.userHome, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(ctx.userHome, '.claude', 'settings.json'), JSON.stringify({ permissions: { additionalDirectories: ['~/OpenArtifact'] } }));
    assert.equal(doctor('--harness', 'claude-code').find('artifacts-location')[0].status, 'ok');
    fs.rmSync(path.join(ctx.userHome, '.claude'), { recursive: true });
    // An app nothing stops needs nothing.
    assert.equal(doctor('--harness', 'pi').find('artifacts-location')[0].status, 'ok');
    config(repo, 'unset', 'artifactsLocation', '--local');

    fs.mkdirSync(path.join(repo, '.agents', 'open-artifact'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.agents', 'open-artifact', 'settings.json'), JSON.stringify({ artifactsLocation: 'workspace', trustedProjects: [repo] }));
    d = doctor('--workspace', repo);
    assert.equal(d.find('project-settings')[0].status, 'warn');
    assert.match(d.find('project-settings')[0].message, /artifactsLocation workspace; not used: trustedProjects/);
    assert.equal(d.report.counts.fail, 0);
  });

  it('(g) two projects with the same folder name get two folders', T, () => {
    const first = checkout('app');
    const second = checkout('app');
    const one = make(first, 'Notes', { session: 'app-1' });
    const two = make(second, 'Notes', { session: 'app-2' });
    assert.equal(one.root, path.join(ctx.openArtifact, 'app', 'notes'));
    assert.match(path.basename(path.dirname(two.root)), /^app-[0-9a-f]{4}$/);
    assert.equal(path.basename(two.root), 'notes');
    // The same project again goes to the same folder.
    assert.equal(path.dirname(make(second, 'More notes', { session: 'app-2' }).root), path.dirname(two.root));
    assert.deepEqual(titles(first, { session: 'app-3' }), ['Notes']);
    assert.deepEqual(titles(second, { session: 'app-3' }), ['More notes', 'Notes']);
  });

  const noHomePage = () => {
    if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
    return fs.existsSync(path.join(repoRoot, 'dist', 'daemon', 'home', 'index.html')) ? false : 'the home page is not built (npm run build)';
  };

  it("(i) the home page names each artifact's project and narrows the list to one", { ...T, skip: noHomePage() }, async () => {
    // Two projects of one name (as in (g)), each with artifacts in the person's Open Artifact folder.
    const first = checkout('gallery');
    const second = checkout('gallery');
    make(first, 'Plan', { session: 'gallery-1' });
    make(second, 'Launch', { session: 'gallery-2' });
    make(second, 'Review', { session: 'gallery-2' });
    const browser = await launch({ width: 1200, height: 900 });
    try {
      const page = await browser.load(`http://127.0.0.1:${ctx.port}/`, { ready: "!!document.querySelector('[data-testid=project-filter]')", ignore: [/favicon\.ico/] });
      assert.deepEqual(page.problems, []);
      /** The filter's choices: [project folder or '*', its text, whether it is the one picked]. */
      const choices = () =>
        page.evaluate("[...document.querySelectorAll('[data-home-project-filter]')].map(b => [b.dataset.homeProjectFilter, b.textContent, b.getAttribute('aria-checked') === 'true'])");
      /** The cards shown: [title, the project its chip names (its folder), the chip's text]. */
      const cards = () =>
        page.evaluate(
          "[...document.querySelectorAll('[data-home-project]')].map(chip => [chip.closest('.group').querySelector('a').textContent, chip.dataset.homeProject, chip.textContent])",
        );
      const all = await cards();
      const sites = (await choices()).filter(([folder]) => path.basename(folder) === 'gallery');
      assert.equal(sites.length, 2, JSON.stringify(await choices()));
      // Two projects of one name are told apart by the folder each is in; each says how many artifacts it has.
      const labels = sites.map(([, text]) => text).sort();
      assert.deepEqual(labels, [`gallery (${path.basename(path.dirname(first))})1`, `gallery (${path.basename(path.dirname(second))})2`].sort());
      assert.deepEqual((await choices())[0].slice(1), [`All${all.length}`, true]);
      // Every card of a session's artifact names its project by the folder's name.
      const mine = all.filter(([, folder]) => sites.some(([site]) => site === folder));
      assert.deepEqual(mine.map(([title, , chip]) => [title, chip]).sort(), [['Launch', 'gallery'], ['Plan', 'gallery'], ['Review', 'gallery']]);

      // One project: its artifacts only, wherever their folders are.
      const two = sites.find(([, text]) => text.endsWith('2'))[0];
      const click = async folder => {
        const at = await page.evaluate(
          `(() => { const b = [...document.querySelectorAll('[data-home-project-filter]')].find(e => e.dataset.homeProjectFilter === ${JSON.stringify(folder)}); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
        );
        await page.click(...at);
      };
      await click(two);
      assert.ok(await page.waitFor(`document.querySelectorAll('[data-home-project]').length === 2`, 10000), JSON.stringify(await cards()));
      assert.deepEqual((await cards()).map(([title, folder]) => [title, folder]).sort(), [['Launch', two], ['Review', two]]);
      assert.deepEqual((await choices()).filter(([, , on]) => on).map(([folder]) => folder), [two]);
      // And back to all of them.
      await click('*');
      assert.ok(await page.waitFor(`document.querySelectorAll('[data-home-project]').length === ${all.length}`, 10000), JSON.stringify(await cards()));
      assert.deepEqual(page.problems, []);
    } finally {
      await browser.close();
    }
  });
});
