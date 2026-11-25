import type { ArtifactAppManifest, ArtifactSummary, DaemonHostInfo, Log, MaybePromise } from './types.ts';

export type InstallPhase = 'installing' | 'installed' | 'uninstalling' | 'refreshing';
/** Persisted journal, including the optional fields of an interrupted install/rebuild. */
export interface InstallRecord {
  schemaVersion: number;
  installId: string;
  artifactId: string;
  home: string;
  bundleId: string;
  bundlePath: string;
  displayName: string;
  templateVersion: string;
  phase: InstallPhase;
  installedAt: string | null;
  cloned?: boolean;
  templatePath?: string;
  artifactType?: string | null;
  tempPath?: string;
  targetVersion?: string;
  refreshedAt?: string;
  before?: InstallPhase;
  uninstallAskedAt?: string;
}
export type PlistEdit = { op: 'replace'; key: string; type: 'string'; value: string } | { op: 'remove'; key: string };
export type LaunchOutcome = 'opened' | 'failed' | 'skipped';
export interface AppOperations {
  exists(path: string): boolean;
  readManifest(bundle: string): ArtifactAppManifest | null;
  prepareDir(staging: string): void;
  sameVolume(template: string, dir: string): boolean;
  canClone(template: string, staging: string): boolean;
  copyBundle(template: string, dest: string, options: { clone: boolean }): void;
  clearQuarantine(bundle: string): void;
  editInfoPlist(bundle: string, edits: PlistEdit[]): void;
  writeIcon(bundle: string, type: string | null | undefined, iconFile: string): void;
  writeManifest(bundle: string, manifest: ArtifactAppManifest): void;
  sign(bundle: string): void;
  verify(bundle: string): boolean;
  place(temp: string, target: string): void;
  removeEmpty?(path: string): void;
  remove(path: string): void;
  moveAside(from: string, to: string): void;
  trash(path: string): MaybePromise<string>;
  forgetDefaults?(bundleId: string): boolean;
  sizeOf?(path: string): number | null;
  launch(bundle: string): Promise<LaunchOutcome>;
}
export interface InstallType {
  id: string;
  title?: string;
  remote?: boolean;
}
export interface InstalledAppsOptions {
  home: string;
  installDir?: string;
  template: { bundlePath: string; executable?: string; version(): string };
  packaged: boolean;
  platform?: NodeJS.Platform;
  library: { record(id: string): Promise<ArtifactSummary | null>; types(): Promise<{ types: InstallType[] }> };
  ops: AppOperations;
  checkpoint?: (step: string) => MaybePromise<void>;
  isRunning?: ((record: InstallRecord) => number | null) | null;
  alive?: (pid: number) => boolean;
  quitTimeoutMs?: number;
  pollMs?: number;
  log?: Log;
  randomId?: () => string;
  now?: () => Date;
  daemonHost?: () => MaybePromise<DaemonHostInfo | null>;
  releaseDaemon?: () => Promise<boolean>;
}
export type InstalledAppState =
  | { state: 'unavailable'; reason: string }
  | { state: 'available'; suggestedName: string; needsCopy: boolean; installDir: string; copyBytes?: number | null }
  | { state: 'installing' }
  | { state: 'busy'; task: 'uninstalling' | 'refreshing' }
  | { state: 'installed'; installId: string; displayName: string; bundlePath: string; stale: boolean; running: boolean }
  | { state: 'needsRepair'; installId: string; reason: string; repairable: boolean };
export interface ReconcileVerdict {
  action: 'committed' | 'cleaned' | 'forgotten' | 'claimed' | 'restored' | 'refreshed' | 'ok' | 'repair';
  reason?: string;
  detail?: string;
  bundlePath?: string;
}
export type ArtifactSupport = { ok: true; artifact: ArtifactSummary; type: InstallType | null } | { ok: false; reason: string; detail?: string };
export interface RebuildOptions {
  allowCopy?: boolean;
  releaseDaemon?: boolean;
}
export interface RebuildOutcome {
  rebuilt: boolean;
  stillRunning?: boolean;
  needsCopy?: boolean;
  daemonInUse?: boolean;
  notOurs?: boolean;
  error?: string;
}
export interface UninstallOutcome {
  removed: boolean;
  stillRunning?: boolean;
  daemonInUse?: boolean;
  left?: 'not-ours';
  error?: string;
}
export interface InstallOutcome {
  state: InstalledAppState;
  launch: LaunchOutcome;
  reused?: boolean;
  nameChanged?: boolean;
  conflict?: boolean;
  needsCopy?: boolean;
  error?: string;
}
export type LaunchCheck =
  | { ok: true; record: InstallRecord; reason?: never; detail?: never }
  | { ok: false; reason: string; detail: string; record?: InstallRecord };
