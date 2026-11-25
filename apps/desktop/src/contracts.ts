/** The three sandboxed preloads expose data-only APIs, shared with their pages and IPC handlers. */
import type { EmbedSavedState } from '@open-artifact/harness-kit/embed';
import type { ArtifactList, DeleteAnswer, PageArtifact } from '@open-artifact/library-page';
import type { ArtifactWindowSnapshot } from './artifact-window.ts';
import type { InstallOutcome, InstalledAppState, RebuildOptions } from './installed-app-types.ts';
import type { InstalledApps } from './installed-apps.ts';
import type { MenuSnapshot } from './menu.ts';
import type { moveArtifact } from './move.ts';
import type { RuntimeUpdates, RuntimeView } from './runtime.ts';
import type { Servers, ServersView } from './servers.ts';
import type { Service, ServiceView } from './service.ts';
import type { SettingsValues } from './settings.ts';
import type { TabSnapshot, TabsSnapshot } from './tabs.ts';
import type { ArtifactAppState, NoticeData, Reply, Unsubscribe } from './types.ts';
export type DesktopCommandValue =
  | boolean
  | number
  | { id: string }
  | { id: string; root: string }
  | Awaited<ReturnType<typeof moveArtifact>>
  | { counts: Record<'ok' | 'warn' | 'fail' | 'n/a', number>; ok: boolean }
  | { error: string }
  | null;
export type QuestionKind = 'close' | 'quit' | 'reload';
export interface DesktopQuestion {
  id: string;
  kind: QuestionKind;
  names: string[];
}
export interface SettingsSnapshot {
  theme: SettingsValues['theme'];
  locale: SettingsValues['locale'];
  choices: { theme: readonly SettingsValues['theme'][]; locale: readonly SettingsValues['locale'][] };
  forced: { theme: string | null; locale: string | null };
  running: { theme: string; locale: string; language: string };
  restartNeeded: boolean;
  artifactsFolder: string;
  libraryFolder: string;
  home: string;
  versions: { app: string; electron: string; chrome: string; runtime: string | null };
}
export interface DesktopState extends TabsSnapshot {
  canBack: boolean;
  canForward: boolean;
  sidebarCollapsed: boolean;
  look: { theme: 'light' | 'dark'; platform: NodeJS.Platform; locale: 'en' | 'zh' };
  settings: SettingsSnapshot;
  service: ServiceView['state'];
  thumbnails: boolean;
  ask: DesktopQuestion | null;
  overlay: boolean;
}
export type PageCommand =
  | { name: 'settings' | 'new-dialog' | 'service' | 'servers'; arg?: never }
  | { name: 'install-app'; arg: { id: string } }
  | { name: 'toast'; arg: { message: string; kind?: 'info' | 'error' } };
export type LibraryChange = { type: 'connected' | 'disconnected' | 'types/changed' } | { type: 'artifacts/changed'; id: string; removed: boolean };
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;
export interface ServiceResults {
  restart: Result<Service['restart']>;
  stop: Result<Service['stop']>;
  start: Result<Service['start']>;
  'restart-type': Result<Service['restartType']>;
  logs: boolean;
  'reveal-home': boolean;
  doctor: Result<Service['runDoctor']>;
  others: Result<Service['others']>;
}
export interface RuntimeResults {
  check: Result<RuntimeUpdates['check']>;
  update: Result<RuntimeUpdates['update']>;
  later: void;
  reopen: void;
  close: void;
  checking: Result<RuntimeUpdates['setChecking']>;
}
export interface ServerArguments {
  add: { host: string; name?: string; insecure?: boolean };
  cancel: undefined;
  dismiss: undefined;
  default: { name: string };
  publish: { on: boolean };
  'answer-ask': { on: boolean };
  remove: { name: string; force?: boolean };
  home: { name: string };
  'approve-page': undefined;
  'open-in-desktop': { on: boolean };
}
export interface ServerResults {
  add: Result<Servers['add']>;
  cancel: boolean;
  dismiss: void;
  default: Result<Servers['setDefault']>;
  publish: Result<Servers['setPublish']>;
  'answer-ask': Result<Servers['answerAsk']>;
  remove: Result<Servers['remove']>;
  home: { id: string };
  'approve-page': boolean;
  'open-in-desktop': ServersView;
}
export interface TabInfo {
  kind: TabSnapshot['kind'];
  server: string | null;
  url: string;
  partition: string;
  preload: string | null;
  preloads: string[];
  sandbox: boolean;
  nodeIntegration: boolean;
  ticket: string | null;
}
export interface BlockedRequest {
  session: string;
  url: string;
  type: string;
}
export interface Handoff {
  to: string;
  what: 'artifact' | 'library';
  id: string | null;
  home: string;
  exe: string | null;
}
export interface ArtifactAppInfo extends ArtifactWindowSnapshot {
  windowTitle: string;
  home: string;
  installId: string;
  artifactId: string;
  harness: string;
  handoffs: Handoff[];
  bundlePath: string | null;
  launch: string;
  view: ArtifactAppState;
  daemonExe: string;
  runtimeDir: string;
  locale: string;
  theme: string;
  page: Omit<TabInfo, 'kind' | 'server' | 'preloads'> | null;
}
export interface DesktopBridge {
  open(ref: string): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  select(id: string): Promise<boolean>;
  close(id: string): Promise<boolean>;
  reload(id: string): Promise<boolean>;
  back(): Promise<boolean>;
  forward(): Promise<boolean>;
  setSidebarCollapsed(collapsed: boolean): Promise<boolean>;
  setOverlay(on: boolean): Promise<boolean>;
  settings: {
    get(): Promise<SettingsSnapshot>;
    set<K extends 'theme' | 'locale' | 'artifactsFolder'>(name: K, value: SettingsValues[K]): Promise<SettingsSnapshot>;
    chooseFolder(): Promise<SettingsSnapshot>;
    revealHome(): Promise<boolean>;
  };
  relaunch(): Promise<boolean>;
  service: {
    get(refresh?: boolean): Promise<ServiceView>;
    do<K extends keyof ServiceResults>(act: K, arg?: string): Promise<Reply<ServiceResults[K]>>;
    onChange(listener: (view: ServiceView) => void): Unsubscribe;
  };
  runtime: {
    get(refresh?: boolean): Promise<RuntimeView>;
    do<K extends keyof RuntimeResults>(act: K, arg?: boolean): Promise<Reply<RuntimeResults[K]>>;
    onChange(listener: (view: RuntimeView) => void): Unsubscribe;
  };
  servers: {
    get(refresh?: boolean): Promise<ServersView>;
    do<K extends keyof ServerResults>(act: K, arg?: ServerArguments[K]): Promise<Reply<ServerResults[K]>>;
    onChange(listener: (view: ServersView) => void): Unsubscribe;
  };
  onCommand(listener: (command: PageCommand) => void): Unsubscribe;
  apps: {
    state(id: string): Promise<Reply<InstalledAppState>>;
    install(id: string, options?: { confirmedName?: string; allowCopy?: boolean }): Promise<Reply<InstallOutcome>>;
    open(id: string, installId: string): Promise<Reply<Result<InstalledApps['open']>>>;
    reveal(id: string, installId: string): Promise<Reply<boolean>>;
    uninstall(id: string, installId: string): Promise<Reply<Result<InstalledApps['uninstall']>>>;
    refresh(id: string, installId: string, options?: RebuildOptions): Promise<Reply<Result<InstalledApps['refresh']>>>;
    repair(id: string, installId: string, options?: RebuildOptions): Promise<Reply<Result<InstalledApps['repair']>>>;
    forget(id: string, installId: string): Promise<Reply<Result<InstalledApps['forgetRecord']>>>;
  };
  artifactDo(act: 'reveal' | 'move' | 'relocate', id: string): Promise<Reply<DesktopCommandValue>>;
  answer(id: string, yes: boolean): Promise<boolean>;
  test: {
    command(name: string, arg?: unknown): Promise<Reply<DesktopCommandValue>>;
    saved(id: string, saved: EmbedSavedState | null): Promise<boolean>;
    pickNext(path: string): Promise<number>;
    openUrl(url: string): Promise<boolean>;
    quit(force?: boolean): Promise<boolean>;
    closeWindow(): Promise<boolean>;
    menu(): Promise<MenuSnapshot[] | null>;
    notice(): Promise<{ id: string | null; name: string; where: string; kind: NoticeData['kind']; visible: boolean } | null>;
    blocked(): Promise<BlockedRequest[]>;
    downloads(): Promise<string>;
    tabInfo(id: string): Promise<TabInfo | null>;
    servers(): Promise<{ view: ServersView; servers: string[] }>;
    appsHold(step: string): Promise<boolean>;
    appsRelease(): Promise<boolean>;
  };
  focus(): Promise<boolean>;
  state(): Promise<DesktopState | null>;
  onState(listener: (state: DesktopState) => void): Unsubscribe;
  library: {
    list(): Promise<Reply<ArtifactList>>;
    update(id: string, patch: { title?: string; pinned?: boolean }): Promise<Reply<PageArtifact>>;
    remove(id: string): Promise<Reply<DeleteAnswer>>;
    restore(trash: string): Promise<Reply<PageArtifact>>;
    create(type: string, title?: string): Promise<Reply<{ id: string; title: string }>>;
    capture(id: string, type: string): Promise<Reply<Uint8Array<ArrayBuffer>>>;
    saveThumbnail(id: string, version: string, jpeg: Uint8Array<ArrayBuffer>): Promise<Reply<string | null>>;
    copy(text: string): Promise<Reply<boolean>>;
    onEvent(listener: (event: LibraryChange) => void): Unsubscribe;
  };
}
export interface ArtifactAppBridge {
  state(): Promise<ArtifactAppState>;
  onState(listener: (view: ArtifactAppState) => void): Unsubscribe;
  act(id: string): Promise<boolean>;
  answer(id: string, yes: boolean): Promise<boolean>;
  test: {
    command(name: string, arg?: unknown): Promise<Reply<boolean | number>>;
    menu(): Promise<MenuSnapshot[] | null>;
    info(): Promise<ArtifactAppInfo>;
    saved(saved: EmbedSavedState | null): Promise<boolean>;
    closeWindow(): Promise<boolean>;
    quit(force?: boolean): Promise<boolean>;
  };
}
export interface NoticeBridge {
  onShow(listener: (notice: NoticeData | null) => void): void;
  ready(): void;
  reveal(id: string): void;
  dismiss(): void;
  hover(on: boolean): void;
}

/** Request/response signatures are the same on the main and preload sides. */
export interface DesktopIpc {
  'desktop:open': DesktopBridge['open'];
  'desktop:select': DesktopBridge['select'];
  'desktop:close': DesktopBridge['close'];
  'desktop:reload': DesktopBridge['reload'];
  'desktop:back': DesktopBridge['back'];
  'desktop:forward': DesktopBridge['forward'];
  'desktop:sidebar': DesktopBridge['setSidebarCollapsed'];
  'desktop:overlay': DesktopBridge['setOverlay'];
  'desktop:settings': DesktopBridge['settings']['get'];
  'desktop:setting': DesktopBridge['settings']['set'];
  'desktop:choose-folder': DesktopBridge['settings']['chooseFolder'];
  'desktop:reveal-home': DesktopBridge['settings']['revealHome'];
  'desktop:relaunch': DesktopBridge['relaunch'];
  'desktop:service': DesktopBridge['service']['get'];
  'desktop:service-do': DesktopBridge['service']['do'];
  'desktop:runtime': DesktopBridge['runtime']['get'];
  'desktop:runtime-do': DesktopBridge['runtime']['do'];
  'desktop:servers': DesktopBridge['servers']['get'];
  'desktop:servers-do': DesktopBridge['servers']['do'];
  'desktop:apps.state': DesktopBridge['apps']['state'];
  'desktop:apps.install': DesktopBridge['apps']['install'];
  'desktop:apps.open': DesktopBridge['apps']['open'];
  'desktop:apps.reveal': DesktopBridge['apps']['reveal'];
  'desktop:apps.uninstall': DesktopBridge['apps']['uninstall'];
  'desktop:apps.refresh': DesktopBridge['apps']['refresh'];
  'desktop:apps.repair': DesktopBridge['apps']['repair'];
  'desktop:apps.forget': DesktopBridge['apps']['forget'];
  'desktop:artifact-do': DesktopBridge['artifactDo'];
  'desktop:answer': DesktopBridge['answer'];
  'desktop:focus': DesktopBridge['focus'];
  'desktop:state': DesktopBridge['state'];
  'library:list': DesktopBridge['library']['list'];
  'library:update': DesktopBridge['library']['update'];
  'library:remove': DesktopBridge['library']['remove'];
  'library:restore': DesktopBridge['library']['restore'];
  'library:create': (request: { type: string; title?: string }) => ReturnType<DesktopBridge['library']['create']>;
  'library:capture': DesktopBridge['library']['capture'];
  'library:save-thumbnail': DesktopBridge['library']['saveThumbnail'];
  'library:copy': DesktopBridge['library']['copy'];
  'test:command': DesktopBridge['test']['command'];
  'test:saved': DesktopBridge['test']['saved'];
  'test:pick-next': DesktopBridge['test']['pickNext'];
  'test:open-url': DesktopBridge['test']['openUrl'];
  'test:quit': DesktopBridge['test']['quit'];
  'test:close-window': DesktopBridge['test']['closeWindow'];
  'test:menu': DesktopBridge['test']['menu'];
  'test:notice': DesktopBridge['test']['notice'];
  'test:blocked': DesktopBridge['test']['blocked'];
  'test:downloads': DesktopBridge['test']['downloads'];
  'test:tab-info': DesktopBridge['test']['tabInfo'];
  'test:servers': DesktopBridge['test']['servers'];
  'test:apps-hold': DesktopBridge['test']['appsHold'];
  'test:apps-release': DesktopBridge['test']['appsRelease'];
}
export interface ArtifactAppIpc {
  'artifact-app:state': ArtifactAppBridge['state'];
  'artifact-app:act': ArtifactAppBridge['act'];
  'artifact-app:answer': ArtifactAppBridge['answer'];
  'test:command': ArtifactAppBridge['test']['command'];
  'test:menu': ArtifactAppBridge['test']['menu'];
  'test:artifact-app': ArtifactAppBridge['test']['info'];
  'test:saved': ArtifactAppBridge['test']['saved'];
  'test:close-window': ArtifactAppBridge['test']['closeWindow'];
  'test:quit': ArtifactAppBridge['test']['quit'];
}
