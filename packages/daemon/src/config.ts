/**
 * `open-artifact config`: one place to read and set the settings that are plain values, in each of the three places
 * they are kept: the person's settings file, a project's own settings file, and the person's entry for one project.
 *
 * Settings with a command of their own (trusting a project, the default site, the runtime policy…) stay with it:
 * those commands check and confirm what a bare value cannot.
 */

import { existsSync, rmSync, rmdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import {
  OpenArtifactError,
  PROJECT_SETTINGS_FILE,
  PROJECT_SETTINGS_KEYS,
  type ArtifactsLocation,
  type ConfigListResponse,
  type ConfigScope,
  type ConfigSetRequest,
  type ConfigSetResponse,
} from '@open-artifact/protocol';
import { files, readJson, samePath, writeJson } from './paths.ts';
import { projectMatcher, projectOf, projectPath } from './project.ts';
import { artifactsLocationOf, artifactsPlacement, loadSettings, projectArtifactsDirOf, savedSettings } from './settings.ts';

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const bad = (message: string, fix?: string): OpenArtifactError => new OpenArtifactError('invalid_argument', message, fix ? { fix } : undefined);

/** The keys `config set` sets, each with what its value must be. `project`: a project may set it too. */
const KEYS: Record<string, { project: boolean; parse(value: string, scope: ConfigScope): unknown }> = {
  artifactsLocation: {
    project: true,
    parse: (value) => artifactsLocationOf(value) ?? fail('artifactsLocation is home or workspace.'),
  },
  artifactsDir: {
    project: true,
    parse: (value, scope) => {
      const dir = value.trim();
      if (scope === 'user') return dir || fail('artifactsDir is a folder name.');
      return projectArtifactsDirOf(dir) ?? fail("A project's artifactsDir is a relative path inside the project.");
    },
  },
  homeWorkspace: {
    project: false,
    parse: (value) => {
      const dir = value.trim();
      return dir.startsWith('~') || isAbsolute(dir) ? dir : fail('homeWorkspace is an absolute path (or ~/...).');
    },
  },
  serverPort: {
    project: false,
    parse: (value) => {
      const port = Number(value);
      return Number.isInteger(port) && port > 0 && port < 65536 ? port : fail('serverPort is a port number.');
    },
  },
};

/** Settings another command sets (it checks or confirms what a value alone cannot). */
const ELSEWHERE: Record<string, string> = {
  trustedProjects: 'open-artifact types trust | untrust',
  disabledTypes: 'open-artifact types enable | disable',
  cloud: 'open-artifact remote default | auto',
  remotes: 'open-artifact remote add | remove',
  runtime: 'open-artifact runtime policy | pin',
  projects: 'open-artifact config set <key> <value> --local, in the project',
  openInDesktop: "the Open Artifact Desktop app's settings",
};

function fail(message: string): never {
  throw bad(message);
}

/** The keys `config set` knows, for messages. */
export const CONFIG_KEYS = Object.keys(KEYS);

function keyOf(name: unknown, scope: ConfigScope): string {
  const key = typeof name === 'string' ? name.trim() : '';
  if (ELSEWHERE[key]) throw bad(`${key} is set with ${ELSEWHERE[key]}.`);
  const known = KEYS[key];
  if (!known) throw bad(`${JSON.stringify(key)} is not a key config sets.`, `Keys: ${CONFIG_KEYS.join(', ')}.`);
  if (scope !== 'user' && !known.project) throw bad(`${key} is not a project's to set.`, `A project sets: ${PROJECT_SETTINGS_KEYS.join(', ')}.`);
  return key;
}

function workspaceOf(request: ConfigSetRequest): string {
  if (typeof request.workspace !== 'string' || !isAbsolute(request.workspace)) throw bad('workspace: the folder of the project (absolute).');
  return request.workspace;
}

/**
 * Sets (`value` a string) or removes (`value: null`) one key: in the person's settings file (`scope: "user"`, the
 * default), in the settings file of the project `workspace` is in (`project`), or in the person's `projects` entry for
 * that project (`local`). Only what is asked changes; every other key of the file stays as it is.
 */
export function configSet(request: ConfigSetRequest): ConfigSetResponse {
  const scope: ConfigScope = request.scope ?? 'user';
  if (scope !== 'user' && scope !== 'project' && scope !== 'local') throw bad('scope: user, project or local.');
  const key = keyOf(request.key, scope);
  const value = request.value === null || request.value === undefined ? null : KEYS[key]!.parse(String(request.value), scope);
  if (scope === 'user') {
    const saved = savedSettings();
    if (value === null) delete saved[key];
    else saved[key] = value;
    writeJson(files.settings(), saved);
    return { ok: true, key, value, scope, file: files.settings() };
  }
  const info = projectOf(workspaceOf(request));
  if (scope === 'local') {
    const saved = savedSettings();
    const entries = isObject(saved.projects) ? { ...saved.projects } : {};
    const same = projectMatcher(info.project);
    const name = Object.keys(entries).find((entry) => same(projectPath(entry))) ?? info.project;
    const entry = isObject(entries[name]) ? { ...(entries[name] as Record<string, unknown>) } : {};
    if (value === null) delete entry[key];
    else entry[key] = value;
    if (Object.keys(entry).length) entries[name] = entry;
    else delete entries[name];
    if (Object.keys(entries).length) saved.projects = entries;
    else delete saved.projects;
    writeJson(files.settings(), saved);
    return { ok: true, key, value, scope, file: files.settings(), project: info.project };
  }
  const file = join(info.dir, PROJECT_SETTINGS_FILE);
  if (samePath(file, files.settings())) throw bad('This folder has no project settings file of its own: that path is your own settings file.', 'Leave out --project.');
  const raw = existsSync(file) ? readJson<unknown>(file, null) : {};
  if (!isObject(raw)) throw bad(`${file} is not a JSON object.`, 'Fix or remove it first.');
  if (value === null) delete raw[key];
  else raw[key] = value;
  if (Object.keys(raw).length) writeJson(file, raw);
  else if (existsSync(file)) {
    // Nothing left: no empty file stays in the repository, nor the folder made for it.
    rmSync(file);
    try {
      rmdirSync(dirname(file));
    } catch {
      /* the folder holds other things */
    }
  }
  return { ok: true, key, value, scope, file, project: info.project };
}

/**
 * The settings in effect for a session of `harness` in `workspace`, each with where it comes from, and what of the
 * project's files is not used. `harnessDefault`: the harness profile's `policy.artifacts`.
 */
export function configList(workspace: string | null, harness: string | null, harnessDefault?: ArtifactsLocation): ConfigListResponse {
  const settings = loadSettings();
  const saved = savedSettings();
  const from = (key: string): 'user' | 'default' => (key in saved ? 'user' : 'default');
  const values: ConfigListResponse['values'] = {
    homeWorkspace: {
      value: settings.homeWorkspace,
      source: typeof saved.homeWorkspace === 'string' ? 'user' : process.env.OPEN_ARTIFACT_HOME_WORKSPACE ? 'environment' : 'default',
    },
    serverPort: { value: settings.serverPort, source: process.env.OPEN_ARTIFACT_PORT ? 'environment' : from('serverPort') },
  };
  if (!workspace) {
    const user = artifactsLocationOf(saved.artifactsLocation);
    return {
      file: files.settings(),
      workspace: null,
      harness,
      values: {
        artifactsLocation: user ? { value: user, source: 'user' } : harnessDefault ? { value: harnessDefault, source: 'harness' } : { value: 'home', source: 'default' },
        artifactsDir: { value: settings.artifactsDir, source: from('artifactsDir') },
        ...values,
      },
    };
  }
  const placement = artifactsPlacement(workspace, harnessDefault);
  const { layers } = placement;
  return {
    file: files.settings(),
    workspace,
    harness,
    values: {
      artifactsLocation: { value: placement.location, source: placement.locationSource },
      artifactsDir: { value: placement.artifactsDir, source: placement.artifactsDirSource },
      ...values,
    },
    project: {
      path: layers.info.project,
      file: layers.file,
      ...(layers.fileBroken ? { broken: true } : {}),
      settings: layers.project,
      ignored: layers.projectIgnored,
      local: layers.local,
      localIgnored: layers.localIgnored,
    },
  };
}
