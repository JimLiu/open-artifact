import type { ArtifactProblem } from './artifact-window.ts';
import type { TabStatus } from './tabs.ts';
/** Shared data and callback types. No Electron values cross a preload bridge. */
export type Log = (line: string) => void;
export type MaybePromise<T> = T | Promise<T>;
export type Unsubscribe = () => void;
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
export interface SavedState {
  state: 'saved' | 'saving' | 'unsaved' | 'reconnecting' | 'readonly';
  leaveLosesWork: boolean;
}
export interface ArtifactAppManifest {
  schemaVersion: number;
  installId: string;
  artifactId: string;
  home: string;
  templateVersion: string;
}
export interface DaemonHostMarker {
  pid: number;
  startedAt?: string | null;
  exe?: string;
  bin?: string;
  bundlePath?: string | null;
  installId?: string;
}
export interface DaemonHostInfo {
  pid: number;
  paths: string[];
  marker?: DaemonHostMarker | null;
}
export interface SavedFile {
  id: string;
  name: string;
  folder: string;
}
export interface NoticeData {
  id: string | null;
  name: string;
  where: string;
  kind: 'saved' | 'info' | 'error';
  lang: string;
  words: { reveal: string; close: string };
}
export interface AppQuestion {
  id: string;
  title: string;
  body: string;
  yes: string;
  cancel: string;
  kind?: 'close' | 'quit' | 'reload';
}
export interface ArtifactAppState {
  status: TabStatus | 'connecting' | 'problem';
  busy: boolean;
  title: string;
  body: string;
  problem?: ArtifactProblem['kind'];
  actions: { id: string; label: string; primary?: boolean }[];
  ask: AppQuestion | null;
  lang: string;
}
export interface ArtifactSummary {
  id: string;
  title?: string;
  type?: string;
  root?: string;
  folderMissing?: boolean;
  remote?: { url?: string } | null;
}
