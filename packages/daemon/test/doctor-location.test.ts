/**
 * Doctor's checks of where artifacts go (`doctor-location.ts`): the location in effect and who chose it, whether an
 * app that keeps its agent to the working folder was told it may write the Open Artifact folder, a project's settings
 * file and what of it is not used, entries for projects that are gone, and the Open Artifact folder itself.
 */
import { TEST_HOME, tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, test } from 'node:test';
import { PROJECT_SETTINGS_FILE } from '@open-artifact/protocol';
import { runDoctor, type DoctorFinding, type DoctorReport } from '../src/doctor.ts';
import { LOCATION_CHECKS } from '../src/doctor-location.ts';
import { files } from '../src/paths.ts';

const BIN = fileURLToPath(new URL('../src/bin/open-artifact.ts', import.meta.url));
const HOME_WS = process.env.OPEN_ARTIFACT_HOME_WORKSPACE!;

function repo(): string {
  const dir = tempDir('oa-doctor-repo-');
  mkdirSync(join(dir, '.git'));
  return dir;
}
const userSettings = (settings: unknown): void => writeFileSync(files.settings(), JSON.stringify(settings));
function projectFile(dir: string, text: string): string {
  const file = join(dir, PROJECT_SETTINGS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}
/** The apps' own settings are looked for in empty folders unless a test says otherwise, never in the real ones. */
const NO_APP_SETTINGS = { CLAUDE_CONFIG_DIR: tempDir('oa-no-claude-'), CODEX_HOME: tempDir('oa-no-codex-') };
const doctor = (options: { harness?: string; workspace?: string | null; env?: Record<string, string> }): Promise<DoctorReport> =>
  runDoctor({ checks: LOCATION_CHECKS, harness: options.harness ?? null, workspace: options.workspace ?? null, env: { ...process.env, ...NO_APP_SETTINGS, ...options.env } });
const one = (report: DoctorReport, id: string): DoctorFinding => {
  const found = report.findings.filter((f) => f.id === id);
  assert.equal(found.length, 1, `${id}: ${JSON.stringify(report.findings)}`);
  return found[0]!;
};
const wellFormed = (report: DoctorReport): void => {
  for (const f of report.findings) {
    assert.ok(!f.message.includes('\n'), `${f.id}: one line`);
    if (f.status === 'warn' || f.status === 'fail') assert.ok(f.fix && !f.fix.includes('\n'), `${f.id} says what to do in one line`);
  }
};

beforeEach(() => rmSync(files.settings(), { force: true }));

test('with nothing set: the Open Artifact folder for an app without a profile, the workspace for one that keeps to it', async () => {
  const top = repo();
  let report = await doctor({ workspace: top });
  assert.equal(report.ok, true);
  assert.deepEqual(report.counts, { ok: 3, warn: 0, fail: 0, 'n/a': 0 });
  assert.equal(one(report, 'home-workspace').message, `Open Artifact folder ${HOME_WS}`);
  const where = one(report, 'artifacts-location');
  assert.equal(where.status, 'ok');
  assert.ok(where.message.includes(`an app without a profile in ${top}`));
  assert.ok(where.message.includes(join(HOME_WS, '<project>', '<slug>')));
  assert.match(where.message, /artifactsLocation home: the default\)/);
  assert.equal(one(report, 'project-settings').message, `Project ${top}: no settings file of its own`);
  assert.equal(report.findings.some((f) => f.id === 'settings-projects'), false);

  report = await doctor({ workspace: join(top), harness: 'claude-code' });
  const inRepo = one(report, 'artifacts-location');
  assert.equal(inRepo.status, 'ok');
  assert.ok(inRepo.message.includes(`${join(top, 'artifacts')}/<slug>`), inRepo.message);
  assert.match(inRepo.message, /artifactsLocation workspace: the default of claude-code\)/);

  // No folder asked about: the same answer, without a project.
  report = await doctor({ harness: 'codex' });
  assert.match(one(report, 'artifacts-location').message, /<workspace>\/artifacts\/<slug> \(artifactsLocation workspace: the default of codex\)/);
  assert.equal(report.findings.some((f) => f.id === 'project-settings'), false);
  wellFormed(report);
});

test('home chosen for an app that keeps its agent to the working folder: a warning with the setting, until the app allows it', async () => {
  const top = repo();
  userSettings({ artifactsLocation: 'home' });

  let report = await doctor({ workspace: top, harness: 'claude-code' });
  let where = one(report, 'artifacts-location');
  assert.equal(where.status, 'warn');
  assert.match(where.message, /artifactsLocation home: your setting\), which is outside the folder .* lets its agent write/);
  assert.ok(where.fix!.includes(`claude --add-dir ${HOME_WS}`));
  assert.equal(report.ok, true, 'a warning, not a failure');
  wellFormed(report);

  // Its own settings allow the folder (or a folder it is in).
  const claude = tempDir('oa-claude-');
  writeFileSync(join(claude, 'settings.json'), JSON.stringify({ permissions: { additionalDirectories: ['/somewhere/else', dirname(HOME_WS)] } }));
  where = one(await doctor({ workspace: top, harness: 'claude-code', env: { CLAUDE_CONFIG_DIR: claude } }), 'artifacts-location');
  assert.equal(where.status, 'ok');
  assert.ok(where.message.endsWith(`may write there (${join(claude, 'settings.json')})`), where.message);
  // Or the project's.
  mkdirSync(join(top, '.claude'));
  writeFileSync(join(top, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { additionalDirectories: [HOME_WS] } }));
  where = one(await doctor({ workspace: top, harness: 'claude-code' }), 'artifacts-location');
  assert.equal(where.status, 'ok');
  assert.ok(where.message.includes(join(top, '.claude', 'settings.local.json')));

  where = one(await doctor({ workspace: top, harness: 'codex' }), 'artifacts-location');
  assert.equal(where.status, 'warn');
  assert.ok(where.fix!.includes(`writable_roots = ["${HOME_WS}"]`));
  const codex = tempDir('oa-codex-');
  writeFileSync(join(codex, 'config.toml'), `model = "x"\n\n[sandbox_workspace_write]\nwritable_roots = ["/tmp/other", '${HOME_WS}']\n`);
  where = one(await doctor({ workspace: top, harness: 'codex', env: { CODEX_HOME: codex } }), 'artifacts-location');
  assert.equal(where.status, 'ok');
  writeFileSync(join(codex, 'config.toml'), `[sandbox_workspace_write]\nwritable_roots = ["/tmp/other"]\n`);
  assert.equal(one(await doctor({ workspace: top, harness: 'codex', env: { CODEX_HOME: codex } }), 'artifacts-location').status, 'warn');

  // Apps whose setting cannot be seen, or that have none.
  where = one(await doctor({ workspace: top, harness: 'copilot' }), 'artifacts-location');
  assert.equal(where.status, 'warn');
  assert.ok(where.fix!.includes(`copilot --add-dir ${HOME_WS}`));
  where = one(await doctor({ workspace: top, harness: 'cursor' }), 'artifacts-location');
  assert.equal(where.status, 'warn');
  assert.match(where.fix!, /--force/);
  // Not measured, or nothing stops the write: no warning.
  for (const harness of ['dsh', 'zcode', 'pi', 'mcp']) assert.equal(one(await doctor({ workspace: top, harness }), 'artifacts-location').status, 'ok', harness);

  // The person's entry for one project is named as such.
  userSettings({ projects: { [top]: { artifactsLocation: 'home' } } });
  where = one(await doctor({ workspace: top, harness: 'copilot' }), 'artifacts-location');
  assert.match(where.message, /artifactsLocation home: your setting for this project\)/);
});

test("a project's settings file: what it sets, what of it is not used, and the person's own entry", async () => {
  const top = repo();
  const inner = join(top, 'src');
  mkdirSync(inner);
  const file = projectFile(top, JSON.stringify({ artifactsLocation: 'workspace', artifactsDir: 'docs/artifacts' }));
  let report = await doctor({ workspace: inner });
  assert.deepEqual(one(report, 'project-settings'), { id: 'project-settings', status: 'ok', message: `Project settings ${file}: artifactsLocation workspace, artifactsDir docs/artifacts` });
  const where = one(report, 'artifacts-location');
  assert.ok(where.message.includes(`${join(top, 'docs', 'artifacts')}/<slug>`), where.message);
  assert.match(where.message, /artifactsLocation workspace: the project's settings file\)/);

  projectFile(top, JSON.stringify({ artifactsLocation: 'workspace', artifactsDir: '../out', trustedProjects: [top], cloud: { publish: 'auto' } }));
  report = await doctor({ workspace: inner });
  let found = one(report, 'project-settings');
  assert.equal(found.status, 'warn');
  assert.match(found.message, /artifactsLocation workspace; not used: artifactsDir, trustedProjects, cloud/);
  assert.match(found.fix!, /open-artifact config set/);
  wellFormed(report);

  projectFile(top, '[1, 2');
  found = one(await doctor({ workspace: inner }), 'project-settings');
  assert.equal(found.status, 'warn');
  assert.match(found.message, /not a JSON object/);

  projectFile(top, '{}');
  userSettings({ projects: { [top]: { artifactsLocation: 'home' } } });
  report = await doctor({ workspace: inner });
  let both = report.findings.filter((f) => f.id === 'project-settings');
  assert.deepEqual(both.map((f) => [f.status, f.message]), [
    ['ok', `Project settings ${file}: sets nothing`],
    ['ok', `Your settings for the project ${top}: artifactsLocation home`],
  ]);
  assert.equal(one(report, 'settings-projects').message, `Your own settings for 1 project ("projects" in ${files.settings()})`);

  userSettings({ projects: { [top]: { artifactsLocation: 'home', homeWorkspace: '/x' } } });
  both = (await doctor({ workspace: inner })).findings.filter((f) => f.id === 'project-settings');
  assert.equal(both[1]!.status, 'warn');
  assert.match(both[1]!.message, /not used: homeWorkspace/);
});

test('entries for projects that are gone, or named by something that is no folder', async () => {
  const top = repo();
  const gone = join(tempDir('oa-doctor-gone-'), 'moved-away');
  userSettings({ projects: { [top]: { artifactsLocation: 'home' }, [gone]: { artifactsLocation: 'workspace' }, 'my-app': {} } });
  const report = await doctor({});
  const found = report.findings.filter((f) => f.id === 'settings-projects');
  assert.equal(found.length, 2);
  assert.ok(found.every((f) => f.status === 'warn'));
  assert.match(found[0]!.message, /not an absolute path: my-app/);
  assert.ok(found[1]!.message.endsWith(`a folder that is gone: ${gone}`), found[1]!.message);
  assert.match(found[1]!.fix!, /--local/);
  assert.equal(report.ok, true);
  wellFormed(report);

  userSettings({ projects: ['nope'] });
  assert.match(one(await doctor({}), 'settings-projects').message, /is not an object/);
});

test('the Open Artifact folder: not made yet is fine, a file or a folder that cannot be written fails', async (t) => {
  const parent = tempDir('oa-doctor-homews-');
  userSettings({ homeWorkspace: join(parent, 'not', 'yet') });
  let report = await doctor({});
  assert.equal(one(report, 'home-workspace').status, 'ok');
  assert.match(one(report, 'home-workspace').message, /not made yet/);

  writeFileSync(join(parent, 'a-file'), 'x');
  userSettings({ homeWorkspace: join(parent, 'a-file') });
  report = await doctor({});
  assert.equal(report.ok, false);
  assert.match(one(report, 'home-workspace').message, /is not a folder/);
  wellFormed(report);

  if (process.platform === 'win32' || process.getuid?.() === 0) return t.diagnostic('read-only folders are not checked here');
  const locked = join(parent, 'locked');
  mkdirSync(locked);
  chmodSync(locked, 0o555);
  try {
    userSettings({ homeWorkspace: locked });
    report = await doctor({});
    const found = one(report, 'home-workspace');
    assert.equal(found.status, 'fail');
    assert.match(found.message, /is not writable/);
    assert.match(found.fix!, /open-artifact config set homeWorkspace/);
    userSettings({ homeWorkspace: join(locked, 'inside') });
    assert.match(one(await doctor({}), 'home-workspace').message, /cannot be made/);
  } finally {
    chmodSync(locked, 0o755);
  }
});

test('a daemon confined to workspaces: the workspace, whatever is set, and no project file is read', async () => {
  const top = repo();
  projectFile(top, JSON.stringify({ artifactsLocation: 'home' }));
  userSettings({ artifactsLocation: 'home' });
  const report = await doctor({ workspace: top, harness: 'claude-code', env: { OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY: '1' } });
  const where = one(report, 'artifacts-location');
  assert.equal(where.status, 'ok');
  assert.match(where.message, /keeps new artifacts in its workspace, under artifacts\/: this daemon is confined to workspaces/);
  assert.equal(report.findings.some((f) => f.id === 'project-settings'), false);
});

test('the command line: doctor answers for the folder it runs in, or --workspace', async () => {
  const top = repo();
  projectFile(top, JSON.stringify({ artifactsLocation: 'workspace', nope: 1 }));
  const run = (args: string[], cwd: string): Promise<{ status: number | null; stdout: string }> =>
    new Promise((done) => {
      const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, ...NO_APP_SETTINGS, OPEN_ARTIFACT_HOME: TEST_HOME } });
      let stdout = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.on('close', (status) => done({ status, stdout }));
    });
  for (const [args, cwd] of [
    [['doctor', '--json'], top],
    [['doctor', '--json', '--workspace', top], tempDir('oa-doctor-elsewhere-')],
  ] as const) {
    const shown = await run([...args], cwd);
    const report = JSON.parse(shown.stdout) as DoctorReport;
    const found = one(report, 'project-settings');
    assert.equal(found.status, 'warn');
    assert.match(found.message, /not used: nope/);
    assert.match(one(report, 'artifacts-location').message, /artifactsLocation workspace: the project's settings file/);
    assert.equal(one(report, 'home-workspace').status, 'ok');
  }
  const text = await run(['doctor', '--harness', 'pi'], top);
  assert.match(text.stdout, /ok {4}A session of Pi in .* keeps new artifacts in the workspace/);
  assert.match(text.stdout, /warn {2}Project settings .*not used: nope/);
});
