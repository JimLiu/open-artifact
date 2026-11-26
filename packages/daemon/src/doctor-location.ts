/**
 * Doctor's checks of where artifacts go (`docs/settings.md`):
 *  - `artifacts-location`: where a session of the harness asked about, in the folder asked about, keeps new
 *    artifacts, and who chose that. When they go under the person's Open Artifact folder and the app is one that
 *    limits its agent to the working folder, whether the app was told it may write there (read from the app's own
 *    settings where they say so), with the setting to add;
 *  - `project-settings`: the settings file of the project the folder is in, the keys of it that are not used, and the
 *    person's own entry for the project;
 *  - `settings-projects`: the entries of `projects` in the person's settings whose folder is gone;
 *  - `home-workspace`: whether the Open Artifact folder can be written.
 *
 * Everything is read; nothing is made or changed, and no other app's settings are written.
 */

import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { HARNESS_NAME, PROJECT_SETTINGS_KEYS, type ArtifactsLocation, type ProjectSettings } from '@open-artifact/protocol';
import type { DoctorCheck, DoctorFinding } from './doctor.ts';
import { harnessProfile } from './harness-profiles.ts';
import { files, samePath } from './paths.ts';
import { projectPath } from './project.ts';
import { artifactsLocationOf, artifactsPlacement, loadSettings, savedSettings, workspaceArtifactsDir, type SettingSource } from './settings.ts';

type Found = Omit<DoctorFinding, 'id'>;

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const confined = (env: NodeJS.ProcessEnv): boolean => env.OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY === '1';

/** `dir` is `folder` or inside it. */
function within(dir: string, folder: string): boolean {
  if (samePath(dir, folder)) return true;
  const path = relative(resolve(folder), resolve(dir));
  return !!path && !path.startsWith('..') && !isAbsolute(path);
}

const expand = (path: string): string => (path === '~' ? homedir() : path.startsWith('~/') || path.startsWith('~\\') ? join(homedir(), path.slice(2)) : path);

const readText = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/**
 * The apps measured to keep their agent's file tools to the working folder (`docs/settings.md`): what to add so the
 * agent may write `dir`, and, where the app keeps that in a file, the file that already allows it.
 */
const WRITABLE: Record<string, { fix(dir: string): string; allowedIn?(dir: string, workspace: string | null, env: NodeJS.ProcessEnv): string | null }> = {
  'claude-code': {
    fix: (dir) => `Let Claude Code write there: claude --add-dir ${dir}, or add it to permissions.additionalDirectories in ~/.claude/settings.json (its auto mode needs neither).`,
    allowedIn: (dir, workspace, env) => {
      const own = join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json');
      const candidates = [own, ...(workspace ? [join(workspace, '.claude', 'settings.json'), join(workspace, '.claude', 'settings.local.json')] : [])];
      for (const file of candidates) {
        const text = readText(file);
        if (!text) continue;
        try {
          const listed = (JSON.parse(text) as { permissions?: { additionalDirectories?: unknown } })?.permissions?.additionalDirectories;
          if (!Array.isArray(listed)) continue;
          if (listed.some((entry) => typeof entry === 'string' && isAbsolute(expand(entry)) && within(dir, expand(entry)))) return file;
        } catch {
          /* not JSON: says nothing */
        }
      }
      return null;
    },
  },
  codex: {
    fix: (dir) => `Let Codex write there: codex --add-dir ${dir}, or sandbox_workspace_write.writable_roots = ["${dir}"] in ~/.codex/config.toml.`,
    allowedIn: (dir, _workspace, env) => {
      const file = join(env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
      const text = readText(file);
      if (!text) return null;
      for (const [, list] of text.matchAll(/^\s*writable_roots\s*=\s*\[([^\]]*)\]/gm)) {
        for (const [, double, single] of list!.matchAll(/"([^"]*)"|'([^']*)'/g)) {
          const entry = expand(double ?? single ?? '');
          if (isAbsolute(entry) && within(dir, entry)) return file;
        }
      }
      return null;
    },
  },
  copilot: {
    fix: (dir) => `Start Copilot CLI with copilot --add-dir ${dir} (doctor cannot see how it was started).`,
  },
  cursor: {
    fix: () => 'cursor-agent refuses writes outside the working folder unless it runs with --force: keep artifacts in the workspace there (open-artifact config set artifactsLocation workspace).',
  },
};

const WHO: Record<SettingSource | 'environment', (harness: string | null) => string> = {
  local: () => 'your setting for this project',
  project: () => "the project's settings file",
  user: () => 'your setting',
  environment: () => 'the environment',
  harness: (harness) => `the default of ${harness}`,
  default: () => 'the default',
};

const location: DoctorCheck = {
  id: 'artifacts-location',
  title: 'Where artifacts go',
  run: ({ harness, workspace, env }): Found => {
    const settings = loadSettings();
    const home = resolve(settings.homeWorkspace);
    const profile = harness && HARNESS_NAME.test(harness) ? harnessProfile(harness) : null;
    const app = profile?.title ?? harness;
    const whose = `A session of ${app ?? 'an app without a profile'}${workspace ? ` in ${workspace}` : ''}`;
    if (confined(env)) {
      return { status: 'ok', message: `${whose} keeps new artifacts in its workspace, under ${settings.artifactsDir || 'artifacts'}/: this daemon is confined to workspaces (OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY=1)` };
    }
    let where: ArtifactsLocation;
    let source: SettingSource;
    let folder: string | null = null;
    if (workspace && !within(workspace, home)) {
      const placement = artifactsPlacement(workspace, profile?.policy?.artifacts);
      where = placement.location;
      source = placement.locationSource;
      folder = workspaceArtifactsDir(workspace, placement);
    } else {
      const user = artifactsLocationOf(savedSettings().artifactsLocation);
      [where, source] = user ? [user, 'user'] : profile?.policy?.artifacts ? [profile.policy.artifacts, 'harness'] : ['home', 'default'];
    }
    const why = `artifactsLocation ${where}: ${WHO[source](harness)}`;
    if (where === 'workspace') {
      return { status: 'ok', message: `${whose} keeps new artifacts in the workspace, ${folder ?? `<workspace>/${settings.artifactsDir || 'artifacts'}`}/<slug> (${why})` };
    }
    const message = `${whose} keeps new artifacts under your Open Artifact folder, ${join(home, '<project>', '<slug>')} (${why})`;
    const limit = harness && profile?.policy?.artifacts === 'workspace' ? WRITABLE[harness] : undefined;
    if (!limit) return { status: 'ok', message };
    const allowed = limit.allowedIn?.(home, workspace, env);
    if (allowed) return { status: 'ok', message: `${message}; ${app} may write there (${allowed})` };
    return { status: 'warn', message: `${message}, which is outside the folder ${app} lets its agent write`, fix: limit.fix(home) };
  },
};

const describe = (settings: ProjectSettings): string => {
  const set = PROJECT_SETTINGS_KEYS.filter((key) => settings[key] !== undefined).map((key) => `${key} ${settings[key]}`);
  return set.length ? set.join(', ') : 'sets nothing';
};

const projectSettings: DoctorCheck = {
  id: 'project-settings',
  title: 'Project settings',
  applies: ({ workspace, env }) => !!workspace && !confined(env),
  run: ({ workspace }): Found[] => {
    const { layers } = artifactsPlacement(workspace!);
    const found: Found[] = [];
    const only = `a project sets only ${PROJECT_SETTINGS_KEYS.join(' and ')}, and artifactsDir is a relative path inside it`;
    if (!layers.file) found.push({ status: 'ok', message: `Project ${layers.info.project}: no settings file of its own` });
    else if (layers.fileBroken) found.push({ status: 'warn', message: `Project settings ${layers.file} is not a JSON object: nothing of it is used`, fix: `Fix or remove ${layers.file}.` });
    else if (layers.projectIgnored.length) {
      found.push({
        status: 'warn',
        message: `Project settings ${layers.file}: ${describe(layers.project)}; not used: ${layers.projectIgnored.join(', ')} (${only})`,
        fix: `Remove ${layers.projectIgnored.length === 1 ? 'that key' : 'those keys'} from the file; your own settings go in ${files.settings()} (open-artifact config set).`,
      });
    } else found.push({ status: 'ok', message: `Project settings ${layers.file}: ${describe(layers.project)}` });
    if (layers.localKey !== null) {
      found.push(
        layers.localIgnored.length
          ? {
              status: 'warn',
              message: `Your settings for the project ${layers.info.project}: ${describe(layers.local)}; not used: ${layers.localIgnored.join(', ')} (${only})`,
              fix: `Remove ${layers.localIgnored.length === 1 ? 'that key' : 'those keys'} from the project's entry under "projects" in ${files.settings()}.`,
            }
          : { status: 'ok', message: `Your settings for the project ${layers.info.project}: ${describe(layers.local)}` },
      );
    }
    return found;
  },
};

const projectEntries: DoctorCheck = {
  id: 'settings-projects',
  title: 'Settings for single projects',
  run: (): Found[] => {
    const entries = savedSettings().projects;
    if (entries === undefined) return [];
    const file = files.settings();
    if (!isObject(entries)) return [{ status: 'warn', message: `"projects" in ${file} is not an object: nothing of it is used`, fix: `Remove "projects" from ${file}; open-artifact config set <key> <value> --local writes it again.` }];
    const keys = Object.keys(entries);
    const unusable = keys.filter((key) => !projectPath(key));
    const gone = keys.filter((key) => {
      const path = projectPath(key);
      return !!path && !existsSync(path);
    });
    const found: Found[] = [];
    if (unusable.length) {
      found.push({ status: 'warn', message: `"projects" in ${file} names ${unusable.length === 1 ? 'a project' : 'projects'} by something that is not an absolute path: ${unusable.join(', ')}`, fix: `Name each project by its folder (absolute, or ~/...) in ${file}.` });
    }
    if (gone.length) {
      found.push({
        status: 'warn',
        message: `"projects" in ${file} keeps settings for ${gone.length === 1 ? 'a folder that is' : `${gone.length} folders that are`} gone: ${gone.join(', ')}`,
        fix: `Remove ${gone.length === 1 ? 'that entry' : 'those entries'} from "projects" in ${file}; in a project that moved, set it again with open-artifact config set <key> <value> --local.`,
      });
    }
    const kept = keys.length - unusable.length - gone.length;
    if (!found.length) found.push({ status: 'ok', message: `Your own settings for ${kept} project${kept === 1 ? '' : 's'} ("projects" in ${file})` });
    return found;
  },
};

const homeWorkspace: DoctorCheck = {
  id: 'home-workspace',
  title: 'Open Artifact folder',
  run: (): Found => {
    const folder = resolve(loadSettings().homeWorkspace);
    const fix = `Give your user write access to it, or choose another folder: open-artifact config set homeWorkspace <folder>.`;
    const writable = (dir: string): boolean => {
      try {
        accessSync(dir, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    };
    if (existsSync(folder)) {
      if (!statSync(folder).isDirectory()) return { status: 'fail', message: `The Open Artifact folder ${folder} is not a folder`, fix: `Move that file away, or choose another folder: open-artifact config set homeWorkspace <folder>.` };
      return writable(folder) ? { status: 'ok', message: `Open Artifact folder ${folder}` } : { status: 'fail', message: `The Open Artifact folder ${folder} is not writable`, fix };
    }
    // Not made yet: it is made with the first artifact kept there, in the nearest folder that exists.
    let parent = dirname(folder);
    while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent);
    return writable(parent)
      ? { status: 'ok', message: `Open Artifact folder ${folder} (not made yet: the first artifact kept there makes it)` }
      : { status: 'fail', message: `The Open Artifact folder ${folder} cannot be made: ${parent} is not writable`, fix };
  },
};

/** The checks of where artifacts go, in the order they run. */
export const LOCATION_CHECKS: readonly DoctorCheck[] = [homeWorkspace, location, projectSettings, projectEntries];
