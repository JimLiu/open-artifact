/**
 * `~/.agents/open-artifact/settings.json`: settings shared by every
 * harness on this computer. Only what the person changed is saved; the
 * daemon merges the file over {@link DEFAULT_SETTINGS}.
 */

/** A marketplace source. */
export type MarketplaceSource = { source: 'github'; repo: string; ref?: string } | { source: 'git'; url: string; ref?: string } | { source: 'directory'; path: string };

/** Public gateway configuration; both origins null disables the listener. */
export interface HostingSettings {
  publicShellOrigin: string | null;
  /** HTTPS origin with `{artifactId}` as its first, complete hostname label. */
  frameOriginTemplate: string | null;
  /** Concrete non-loopback interface used by the authenticated gateway. */
  listenHost: string | null;
  port: number;
}

/** Public hosting configuration and the daemon's actual support status. */
export interface HostingResponse {
  settings: HostingSettings;
  remote: { supported: boolean; enabled: boolean; reason?: string; error?: string; restartRequired?: boolean };
}

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
  /** Shared hosting preferences; remote support must be checked separately. */
  hosting: HostingSettings;
  /** Preferred daemon port. */
  serverPort: number;
  /** Folder under a workspace where new artifacts go. */
  artifactsDir: string;
  /** Workspace of artifacts made without a session (from the home page). */
  homeWorkspace: string;
  /** Project folders whose `.agents/artifact-types` may run code. */
  trustedProjects: string[];
  /** Type ids whose `openArtifact.offer` goes into the agent prompt: the agent may offer them unasked. */
  offers: string[];
}

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
  hosting: { publicShellOrigin: null, frameOriginTemplate: null, listenHost: null, port: 4801 },
  serverPort: 4800,
  artifactsDir: 'artifacts',
  homeWorkspace: '~/OpenArtifact',
  trustedProjects: [],
  offers: [],
};
