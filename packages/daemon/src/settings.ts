/**
 * `settings.json`: settings shared by every harness on this computer. Only
 * what the person changed is saved; {@link loadSettings} merges the file over
 * the protocol's defaults.
 */

import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  ARTIFACTS_LOCATIONS,
  DEFAULT_SETTINGS,
  PROJECT_SETTINGS_FILE,
  PROJECT_SETTINGS_KEYS,
  type ArtifactsLocation,
  type CloudSettings,
  type OpenArtifactSettings,
  type ProjectSettings,
} from '@open-artifact/protocol';
import { expandHome, files, readJson, writeJson } from './paths.ts';
import type { CloudPreset } from './preset.ts';
import { projectMatcher, projectOf, projectPath, type ProjectInfo } from './project.ts';

/**
 * The settings in effect: the saved file over {@link DEFAULT_SETTINGS}, with
 * `~` expanded. `$OPEN_ARTIFACT_USER_TYPES`, `$OPEN_ARTIFACT_EXTRA_TYPES` (colon separated) and
 * `$OPEN_ARTIFACT_PORT` move the type roots and the port without touching the file
 * (tests, dev checkouts). `$OPEN_ARTIFACT_HOME_WORKSPACE` is the person's Open Artifact folder (`homeWorkspace`) while
 * the file does not set it, so a test never writes into the real one. `preset` (the environment's and `preset.json`'s cloud presets, `preset.ts`) fills
 * `cloud.publish` when the file does not set it: what the person saved wins.
 */
export function loadSettings(preset: Pick<CloudPreset, 'publish'> = {}): OpenArtifactSettings {
  const saved = readJson<Partial<OpenArtifactSettings> | null>(files.settings(), {}) ?? {};
  const merged: OpenArtifactSettings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    typeRoots: { ...DEFAULT_SETTINGS.typeRoots, ...(saved.typeRoots ?? {}) },
    wake: { ...DEFAULT_SETTINGS.wake, ...(saved.wake ?? {}) },
  };
  if (process.env.OPEN_ARTIFACT_USER_TYPES) merged.typeRoots.user = process.env.OPEN_ARTIFACT_USER_TYPES;
  if (process.env.OPEN_ARTIFACT_EXTRA_TYPES) {
    merged.typeRoots.extra = [...merged.typeRoots.extra, ...process.env.OPEN_ARTIFACT_EXTRA_TYPES.split(':').filter(Boolean)];
  }
  merged.typeRoots.user = expandHome(merged.typeRoots.user);
  merged.typeRoots.extra = merged.typeRoots.extra.map(expandHome);
  if (process.env.OPEN_ARTIFACT_HOME_WORKSPACE && typeof saved.homeWorkspace !== 'string') merged.homeWorkspace = process.env.OPEN_ARTIFACT_HOME_WORKSPACE;
  merged.homeWorkspace = expandHome(merged.homeWorkspace);
  merged.trustedProjects = (merged.trustedProjects ?? []).map(expandHome);
  if (process.env.OPEN_ARTIFACT_PORT) merged.serverPort = Number(process.env.OPEN_ARTIFACT_PORT);
  const cloud: CloudSettings = {};
  const savedCloud = saved.cloud && typeof saved.cloud === 'object' ? saved.cloud : {};
  if (typeof savedCloud.default === 'string' && savedCloud.default) cloud.default = savedCloud.default;
  const publish = savedCloud.publish === 'auto' || savedCloud.publish === 'manual' ? savedCloud.publish : preset.publish;
  if (publish) cloud.publish = publish;
  const refresh = savedCloud.dataRefresh;
  if (typeof refresh === 'number' && Number.isFinite(refresh) && refresh >= 0) cloud.dataRefresh = refresh;
  if (Object.keys(cloud).length) merged.cloud = cloud;
  else delete merged.cloud;
  return merged;
}

/** Changes `cloud` in the saved file: a value sets its key, `null` removes it (the default or the preset applies again). */
export function saveCloudSettings(patch: { [K in keyof CloudSettings]?: CloudSettings[K] | null }): void {
  const saved = readJson<Partial<OpenArtifactSettings> | null>(files.settings(), {}) ?? {};
  const cloud: Record<string, unknown> = { ...(saved.cloud ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete cloud[key];
    else if (value !== undefined) cloud[key] = value;
  }
  const next: Partial<OpenArtifactSettings> = { ...saved, cloud: cloud as CloudSettings };
  if (!Object.keys(cloud).length) delete next.cloud;
  writeJson(files.settings(), next);
}

/** Merges `patch` into the saved file (only what the person set is kept there). */
export function saveSettings(patch: Partial<OpenArtifactSettings>): void {
  const saved = readJson<Partial<OpenArtifactSettings> | null>(files.settings(), {}) ?? {};
  writeJson(files.settings(), { ...saved, ...patch });
}

// ---- a project's settings -----------------------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** `artifactsLocation`, when `value` is one. */
export function artifactsLocationOf(value: unknown): ArtifactsLocation | undefined {
  return ARTIFACTS_LOCATIONS.includes(value as ArtifactsLocation) ? (value as ArtifactsLocation) : undefined;
}

/**
 * A project's `artifactsDir`, when `value` may be one: a relative path that stays inside the project (no absolute
 * path, no `~`, no `..` that leads out), so a repository's settings file cannot send artifacts anywhere else.
 */
export function projectArtifactsDirOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const dir = value.trim();
  if (!dir || dir.startsWith('~') || isAbsolute(dir) || /^[A-Za-z]:/.test(dir)) return undefined;
  const base = resolve('project');
  const inside = relative(base, resolve(base, dir));
  if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return undefined;
  return dir;
}

/**
 * What a project may set, out of `raw` (a project's settings file, or the person's `projects` entry for it): the
 * keys of {@link PROJECT_SETTINGS_KEYS} with the expected shape. `ignored` names every other key, and each of those
 * keys whose value is not usable.
 */
export function projectSettingsOf(raw: unknown): { settings: ProjectSettings; ignored: string[] } {
  const settings: ProjectSettings = {};
  const ignored: string[] = [];
  if (!isObject(raw)) return { settings, ignored };
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'artifactsLocation' && artifactsLocationOf(value)) settings.artifactsLocation = artifactsLocationOf(value);
    else if (key === 'artifactsDir' && projectArtifactsDirOf(value)) settings.artifactsDir = projectArtifactsDirOf(value);
    else ignored.push(key);
  }
  return { settings, ignored };
}

/** The settings of one project, by where they come from. */
export interface ProjectLayers {
  info: ProjectInfo;
  /** The project's own settings file, when there is one. */
  file: string | null;
  /** That file is not a JSON object: nothing of it is used. */
  fileBroken: boolean;
  /** What the project's file sets (only what a project may). */
  project: ProjectSettings;
  /** The keys of the project's file that are not used: not a project's to set, or not a usable value. */
  projectIgnored: string[];
  /** The key of the person's `projects` entry for this project, when there is one. */
  localKey: string | null;
  /** What the person's `projects` entry for this project sets. */
  local: ProjectSettings;
  localIgnored: string[];
}

/** The person's saved settings file as it is (not merged over the defaults), or `{}`. */
export function savedSettings(): Record<string, unknown> {
  const saved = readJson<unknown>(files.settings(), {});
  return isObject(saved) ? saved : {};
}

/**
 * The settings of the project `workspace` is in: its own file ({@link PROJECT_SETTINGS_FILE}, found by
 * {@link projectOf}) and the person's `projects` entry for it. Read from disk each time, so a change is in effect at
 * the next call with no restart.
 */
export function projectLayers(workspace: string): ProjectLayers {
  const info = projectOf(workspace);
  const file = info.configDir ? join(info.configDir, PROJECT_SETTINGS_FILE) : null;
  const raw = file ? readJson<unknown>(file, null) : undefined;
  const fromFile = projectSettingsOf(raw);
  const same = projectMatcher(info.project);
  const entries = savedSettings().projects;
  let localKey: string | null = null;
  let fromEntry = projectSettingsOf(undefined);
  if (isObject(entries)) {
    for (const [key, value] of Object.entries(entries)) {
      const path = projectPath(key);
      if (path && same(path)) {
        localKey = key;
        fromEntry = projectSettingsOf(value);
        break;
      }
    }
  }
  return {
    info,
    file,
    fileBroken: !!file && !isObject(raw),
    project: fromFile.settings,
    projectIgnored: fromFile.ignored,
    localKey,
    local: fromEntry.settings,
    localIgnored: fromEntry.ignored,
  };
}

/** Where a setting's value comes from, highest first. */
export type SettingSource = 'local' | 'project' | 'user' | 'harness' | 'default';

/** Where a session's new artifacts go, and why. */
export interface ArtifactsPlacement {
  location: ArtifactsLocation;
  /**
   * Who chose {@link location}: the person for this project (`local`), the project's file (`project`), the person for
   * every project (`user`), the session's harness profile (`harness`), or nobody (`default`).
   */
  locationSource: SettingSource;
  /** The folder new artifacts go under, in a workspace. */
  artifactsDir: string;
  artifactsDirSource: Exclude<SettingSource, 'harness'>;
  layers: ProjectLayers;
}

/**
 * Where the artifacts a session in `workspace` makes go. `artifactsLocation`: the person's entry for the project,
 * then the project's file, then the person's own setting (only when their file sets it), then what the session's
 * harness says (`harnessDefault`, its profile's `policy.artifacts`), then `home`. `artifactsDir` likewise, without
 * the harness.
 */
export function artifactsPlacement(workspace: string, harnessDefault?: ArtifactsLocation): ArtifactsPlacement {
  const layers = projectLayers(workspace);
  const saved = savedSettings();
  const user = artifactsLocationOf(saved.artifactsLocation);
  const [location, locationSource]: [ArtifactsLocation, SettingSource] = layers.local.artifactsLocation
    ? [layers.local.artifactsLocation, 'local']
    : layers.project.artifactsLocation
      ? [layers.project.artifactsLocation, 'project']
      : user
        ? [user, 'user']
        : harnessDefault
          ? [harnessDefault, 'harness']
          : ['home', 'default'];
  const userDir = typeof saved.artifactsDir === 'string' && saved.artifactsDir.trim() ? saved.artifactsDir.trim() : undefined;
  const [artifactsDir, artifactsDirSource]: [string, ArtifactsPlacement['artifactsDirSource']] = layers.local.artifactsDir
    ? [layers.local.artifactsDir, 'local']
    : layers.project.artifactsDir
      ? [layers.project.artifactsDir, 'project']
      : userDir
        ? [userDir, 'user']
        : [DEFAULT_SETTINGS.artifactsDir, 'default'];
  return { location, locationSource, artifactsDir, artifactsDirSource, layers };
}

/** The keys a project may set, for messages. */
export const PROJECT_KEYS_TEXT = PROJECT_SETTINGS_KEYS.join(', ');
