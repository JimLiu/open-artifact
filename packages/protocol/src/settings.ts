/**
 * `~/.agents/open-artifact/settings.json`: settings shared by every
 * harness on this computer. Only what the person changed is saved; the
 * daemon merges the file over {@link DEFAULT_SETTINGS}.
 */

/**
 * Where the artifacts a session makes go when the call names no folder: `home`, under the person's Open Artifact
 * folder ({@link OpenArtifactSettings.homeWorkspace}), one folder per project; `workspace`, in the session's own
 * working folder (`<workspace>/<artifactsDir>`).
 */
export type ArtifactsLocation = 'home' | 'workspace';

/** The values of {@link ArtifactsLocation}. */
export const ARTIFACTS_LOCATIONS: readonly ArtifactsLocation[] = ['home', 'workspace'];

/**
 * A project's settings file, relative to the project's folder: the same relative path as the settings file under the
 * person's home folder, and beside the project's types (`.agents/artifact-types`).
 */
export const PROJECT_SETTINGS_FILE = '.agents/open-artifact/settings.json';

/**
 * The settings a project may set: in its own file ({@link PROJECT_SETTINGS_FILE}, which comes from a repository
 * anyone may have written, so only keys that cannot widen what the repository does), and in the person's own
 * {@link OpenArtifactSettings.projects} entry for it. Every other key there is ignored.
 */
export const PROJECT_SETTINGS_KEYS = ['artifactsLocation', 'artifactsDir'] as const;

/** {@link PROJECT_SETTINGS_KEYS}, as an object. `artifactsDir` is relative and stays inside the project. */
export interface ProjectSettings {
  artifactsLocation?: ArtifactsLocation;
  artifactsDir?: string;
}

/** Where `open-artifact config set` writes: the person's settings file, a project's own, or the person's entry for a project. */
export type ConfigScope = 'user' | 'project' | 'local';

/**
 * `POST /api/open-artifact.config.set` (`open-artifact config set | unset`): one key, set to `value` or removed
 * (`null`). `workspace` (absolute) says which project, for the scopes `project` and `local`.
 */
export interface ConfigSetRequest {
  key: string;
  value: string | null;
  scope?: ConfigScope;
  workspace?: string;
}

/** What was written, and where. */
export interface ConfigSetResponse {
  ok: true;
  key: string;
  /** The value as kept (`null`: removed). */
  value: unknown;
  scope: ConfigScope;
  /** The file that changed. */
  file: string;
  /** The project, for the scopes `project` and `local`. */
  project?: string;
}

/**
 * `open-artifact config list`: each setting config knows, with its value in effect and who set it: the person for
 * this project (`local`), the project's file (`project`), the person (`user`), the environment, the session's
 * harness profile (`harness`), or nobody (`default`).
 */
export interface ConfigListResponse {
  /** The person's settings file. */
  file: string;
  workspace: string | null;
  harness: string | null;
  values: Record<string, { value: unknown; source: 'local' | 'project' | 'user' | 'environment' | 'harness' | 'default' }>;
  /** The project the workspace is in. */
  project?: {
    /** The project's folder (its identity: the main working tree's, for a worktree). */
    path: string;
    /** Its settings file, when it has one. */
    file: string | null;
    /** That file is not a JSON object: nothing of it is used. */
    broken?: boolean;
    /** What the file sets. */
    settings: ProjectSettings;
    /** The file's keys that are not used: not a project's to set, or not a usable value. */
    ignored: string[];
    /** What the person's own entry for the project sets. */
    local: ProjectSettings;
    localIgnored: string[];
  };
}

/** A marketplace source. */
export type MarketplaceSource = { source: 'github'; repo: string; ref?: string } | { source: 'git'; url: string; ref?: string } | { source: 'directory'; path: string };

/** Settings. */
export interface OpenArtifactSettings {
  /** Where types are looked for. `~` is expanded. */
  typeRoots: { user: string; project: string; extra: string[] };
  marketplaces: Record<string, { source: MarketplaceSource; autoUpdate?: boolean }>;
  /** When set, only these marketplaces may be added. */
  allowedMarketplaces: string[] | null;
  /** Type ids that are installed but turned off. */
  disabledTypes: string[];
  /** Feature flags by name, over each type's defaults. */
  flags: Record<string, boolean>;
  wake: {
    /** What to do with a wake for a session nobody can reach. */
    fallback: 'ask' | 'inbox';
  };
  /** Preferred daemon port. */
  serverPort: number;
  /** Folder under a workspace where new artifacts go ({@link artifactsLocation} `workspace`, and under {@link homeWorkspace}). */
  artifactsDir: string;
  /**
   * Where a session's new artifacts go when the call names no folder. Unset (the default): what the session's harness
   * profile says (`policy.artifacts`), else `home`. A project's settings file and the person's {@link projects} entry
   * for the project come before it.
   */
  artifactsLocation?: ArtifactsLocation;
  /**
   * The person's Open Artifact folder: the workspace of artifacts made without a session (the home page, under
   * `<homeWorkspace>/<artifactsDir>`), and where each project's artifacts go when their location is `home`
   * (`<homeWorkspace>/<project>/<slug>`).
   */
  homeWorkspace: string;
  /**
   * The person's own settings for one project, by the project's folder (absolute, `~` is expanded): they come before
   * the project's own settings file, so a person can differ from what a repository says without touching it. Only
   * {@link PROJECT_SETTINGS_KEYS}. Read only from the person's settings file, never from a project's.
   */
  projects?: Record<string, ProjectSettings>;
  /** Project folders whose `.agents/artifact-types` may run code. */
  trustedProjects: string[];
  /** Type ids whose `openArtifact.offer` goes into the agent prompt: the agent may offer them unasked. */
  offers: string[];
  /**
   * Per cloud remote (by its name in `remotes.json`): `agentMayPublish` lets the agent's `Artifact {action: "share",
   * cloud: "<name>"}` publish an artifact there (off by default: only the person publishes).
   */
  remotes?: Record<string, { agentMayPublish?: boolean }>;
  /**
   * Publishing to the cloud as a whole. A sibling of {@link remotes} rather than a key inside it, so it can never
   * collide with a remote's name (a remote may well be called `default`). Only a person changes it (the CLI's
   * `remote default` / `remote auto`, or the Share panel), never an agent's tool.
   */
  cloud?: CloudSettings;
  /**
   * The person's "open agents' artifacts in the app" (Open Artifact Desktop's settings, `desktop.settings`): a page an
   * agent opens that would go to this computer's browser goes to the app instead. Off when unset.
   */
  openInDesktop?: boolean;
}

/** {@link OpenArtifactSettings.cloud}. */
export interface CloudSettings {
  /**
   * The remote (its name in `remotes.json`) used when none is named: `open-artifact publish <id>`, the Share panel's
   * Publish and automatic publishing. Unset: the only remote, when there is exactly one. The first remote added
   * becomes it.
   */
  default?: string;
  /**
   * `manual` (the default): only what a person publishes goes to the cloud. `auto`: every artifact created from then on
   * (by an agent, the home page or adopt) is published to the default remote by itself, in the background; artifacts
   * made before, and any the person unpublished, are left alone. Preset by `OPEN_ARTIFACT_PUBLISH` or `preset.json`
   * when the file does not set it.
   */
  publish?: CloudPublishMode;
  /**
   * How often, in minutes, the daemon runs a published dashboard's live queries again for its host while it is linked
   * ({@link DEFAULT_DATA_REFRESH_MINUTES} when unset); `0` never does (it still does when the dashboard is published and
   * when someone asks).
   */
  dataRefresh?: number;
}

/**
 * {@link CloudSettings.dataRefresh}'s default: every 6 hours. Each refresh runs every live query of every published
 * dashboard on the owner's warehouse (billed per query on most), so the timer is a safety net, not a live feed; people
 * who need newer figures press Refresh.
 */
export const DEFAULT_DATA_REFRESH_MINUTES = 360;

/** {@link CloudSettings.publish}. */
export type CloudPublishMode = 'manual' | 'auto';

/** Defaults. */
export const DEFAULT_SETTINGS: OpenArtifactSettings = {
  typeRoots: { user: '~/.agents/artifact-types', project: '.agents/artifact-types', extra: [] },
  marketplaces: {
    'open-artifact': { source: { source: 'github', repo: 'JimLiu/open-artifact' }, autoUpdate: true },
  },
  allowedMarketplaces: null,
  disabledTypes: [],
  flags: {},
  wake: { fallback: 'ask' },
  serverPort: 4800,
  artifactsDir: 'artifacts',
  homeWorkspace: '~/OpenArtifact',
  trustedProjects: [],
  offers: [],
};
