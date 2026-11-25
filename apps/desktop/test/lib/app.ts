import type { DaemonState } from '@open-artifact/protocol';
import type { Protocol } from 'devtools-protocol';
import type { DesktopBridge, DesktopState } from '../../src/contracts.ts';
import type { LibraryResponses } from '../../src/library.ts';
import type { Profile } from '../../src/profile.ts';
import type { Reply } from '../../src/types.ts';
import type { Cdp, Page } from './cdp.ts';
import type { ProcessExit, TestProfile } from './env.ts';
export type TestApp = Awaited<ReturnType<typeof launchApp>>;
export type TestArtifactApp = Awaited<ReturnType<typeof launchArtifactApp>>;
export type RouteResponse<N extends string> = N extends `${infer R}?${string}`
  ? RouteResponse<R>
  : N extends keyof LibraryResponses
    ? LibraryResponses[N]
    : unknown;
export type CommandResult<N extends string> = N extends `new:${string}`
  ? { id: string }
  : N extends 'open-folder' | 'import'
    ? { id: string } | null
    : N extends 'move'
      ? { from: string; to: string; moved: boolean } | null
      : N extends 'relocate'
        ? { id: string; root: string } | null
        : N extends 'doctor'
          ? { counts?: Record<string, number>; ok?: boolean; error?: string }
          : N extends 'zoom-in' | 'zoom-out' | 'zoom-reset'
            ? number
            : boolean;
interface LaunchOptions {
  args?: string[];
  env?: NodeJS.ProcessEnv;
  defaultLocale?: boolean;
  binary?: string | null;
}
/**
 * Starts the built app in test mode (no shown window, no Dock icon, links out only logged, DevTools on a port), with
 * no `node` on PATH and the throwaway profile's environment, and drives it over DevTools.
 */
import { execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { connectCdp } from './cdp.ts';
import { APP, alive, cleanEnv, electronBinary, freePort, sleep, until } from './env.ts';

/** The artifact's Shell page in a view: `/a/<id>` on the daemon. */
export const isShellOf = (id: string) => (info: Protocol.Target.TargetInfo) =>
  info.type === 'page' && new URL(info.url || 'about:blank').pathname === `/a/${id}`;

/**
 * `defaultLocale: false` leaves out the `--locale en` every other launch gets, for a test of the language setting
 * (test mode's `--locale` comes before it). `binary`: the packaged app's executable (`Contents/MacOS/Open Artifact`),
 * started with no app folder; else Electron with this folder. Either way it gets `--home`, `--port`, `--test-mode` and
 * the throwaway profile's environment: the packaged app is never started without them.
 */
export async function launchApp(profile: TestProfile, port: number, { args = [], env = {}, defaultLocale = true, binary = null }: LaunchOptions = {}) {
  const debugPort = await freePort();
  // English unless a test asks for another language: the tests read the app's words.
  const locale = args.includes('--locale') || !defaultLocale ? [] : ['--locale', 'en'];
  if (!profile?.oaHome || !port || port === 4800) throw new Error('launchApp needs a throwaway profile and a port that is not 4800');
  const child = spawn(
    binary ?? electronBinary(),
    [...(binary ? [] : [APP]), '--home', profile.oaHome, '--port', String(port), '--test-mode', '--devtools-port', String(debugPort), ...locale, ...args],
    {
      env: cleanEnv(profile, port, env),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const lines: string[] = [];
  const take = (chunk: Buffer) => {
    for (const line of String(chunk).split('\n')) if (line.trim()) lines.push(line);
    if (process.env.OA_DESKTOP_VERBOSE) process.stdout.write(`  app| ${chunk}`);
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  let exited: ProcessExit | null = null;
  child.on('exit', (code, signal) => (exited = { code, signal }));

  let cdp: Cdp | null = null;
  let chrome: Page | null = null;
  const app = {
    get cdp(): Cdp {
      if (!cdp) throw new Error('connect() first');
      return cdp;
    },
    get chrome(): Page {
      if (!chrome) throw new Error('connect() first');
      return chrome;
    },
    child,
    lines,
    debugPort,
    get exited(): ProcessExit | null {
      return exited;
    },
    /** The first log line matching `pattern`, waiting for it. */
    async line(pattern: RegExp, timeoutMs = 60_000) {
      const found = await until(() => lines.find((line) => pattern.test(line)) ?? (exited ? 'exited' : null), timeoutMs);
      if (!found || found === 'exited')
        throw new Error(`no line ${pattern} (${exited ? `the app exited ${JSON.stringify(exited)}` : 'timed out'}):\n${lines.join('\n')}`);
      return found;
    },
    async connect() {
      cdp = await connectCdp(debugPort);
      const target = await app.cdp.waitTarget((t) => t.type === 'page' && t.url.startsWith('file://') && t.url.endsWith('/renderer/index.html'));
      chrome = await app.cdp.attach(target.targetId);
      await app.chrome.send('Runtime.enable');
      return app;
    },
    /** Opens an artifact in a tab through the bar's bridge, as the home page will. */
    open(id: string) {
      return app.chrome.evaluate<Awaited<ReturnType<DesktopBridge['open']>>>(`desktop.open(${JSON.stringify(id)})`);
    },
    async state(): Promise<DesktopState> {
      const state = await app.chrome.evaluate('desktop.state()');
      if (!state) throw new Error('the desktop is not ready');
      return state;
    },
    /** The view of an artifact's tab, attached. */
    async view(id: string) {
      const target = await app.cdp.waitTarget(isShellOf(id));
      const page = await app.cdp.attach(target.targetId);
      await page.send('Runtime.enable');
      await page.send('Page.enable');
      return page;
    },
    /**
     * Quits: the window closed as the person would (which asks first when a tab has unsaved work), then SIGTERM,
     * then SIGKILL. `force`: the app's test-only quit that lets unsaved work go without asking (a test's cleanup).
     */
    async quit({ force = false, timeoutMs = 15_000 } = {}): Promise<ProcessExit | null> {
      if (!exited) {
        try {
          await chrome?.evaluate(force ? 'desktop.test.quit(true)' : 'window.close(), true');
        } catch {
          /* the window went first */
        }
        await until(() => exited, timeoutMs);
      }
      if (!exited && alive(child.pid)) {
        child.kill('SIGTERM');
        await until(() => exited, 5000);
      }
      if (!exited && alive(child.pid)) {
        child.kill('SIGKILL');
        await until(() => exited, 5000);
      }
      cdp?.close();
      child.stdout?.destroy();
      child.stderr?.destroy();
      await sleep(100);
      return exited;
    },
    /** The app's own `[desktop] profile {…}` line, parsed. */
    async profileLine() {
      const line = await app.line(/\[desktop\] profile \{/);
      return JSON.parse(line.slice(line.indexOf('{'))) as Pick<Profile, 'home' | 'port' | 'packaged' | 'testMode' | 'guarded' | 'paths'>;
    },
    /** A named command of the main process (the menu's), through the test-only bridge. */
    command<N extends string>(name: N, arg?: unknown): Promise<Reply<CommandResult<N>>> {
      return app.chrome.evaluate<Reply<CommandResult<N>>>(`desktop.test.command(${JSON.stringify(name)}, ${JSON.stringify(arg ?? null)})`);
    },
    /** The application menu, as the main process sees it (labels, roles, accelerators, enabled). */
    menu() {
      return app.chrome.evaluate('desktop.test.menu()');
    },
  };
  return app;
}

/** The Library API of the profile's daemon, with its token (as the home page's calls go through the app). */
export async function library<N extends string>(state: DaemonState | null, name: N, body?: unknown): Promise<RouteResponse<N>> {
  if (!state) throw new Error('no daemon');
  const response = await fetch(`${state.url}/api/open-artifact.${name}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${state.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return response.json();
}

/** The status page of an artifact installed as an app: `renderer/artifact-app/index.html`. */
const isArtifactAppPage = (t: Protocol.Target.TargetInfo) =>
  t.type === 'page' && t.url.startsWith('file://') && t.url.endsWith('/renderer/artifact-app/index.html');

/** The bundle id an "install as app" package has: the prefix and an install id (a UUID), nothing else. */
const APP_BUNDLE_ID = /^dev\.openartifact\.app\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The bundle ids of the apps this test process started (`launchArtifactApp`), to forget their preferences. */
const launchedBundleIds = new Set<string>();

/** The bundle id in the `Info.plist` of the package an executable runs from (`<x>.app/Contents/MacOS/<exe>`). */
export function bundleIdOfExecutable(binary: string) {
  const plist = join(dirname(dirname(binary)), 'Info.plist');
  return JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' })).CFBundleIdentifier as string;
}

/**
 * Forgets the preferences macOS keeps for each app this test process started (`launchArtifactApp`): every start of
 * one leaves `~/Library/Preferences/<bundle id>.plist` in the person's own Library (cfprefsd keeps it there whatever
 * HOME says). Only those exact bundle ids, each with `/usr/bin/defaults delete <id>` (no pattern, no file removed by
 * hand); a domain that is not there is not an error. Call it once every app has exited (`after`); it also runs when the
 * test process exits, for a run cut short.
 */
export function forgetLaunchedDefaults() {
  const done: string[] = [];
  for (const id of launchedBundleIds) {
    if (!APP_BUNDLE_ID.test(id)) continue;
    try {
      execFileSync('/usr/bin/defaults', ['delete', id], { stdio: 'ignore' });
      done.push(id);
    } catch {
      // No such domain (the app never wrote one, or it was forgotten already).
    }
    launchedBundleIds.delete(id);
  }
  // Said, so a run's leftovers can be named exactly (macOS keeps an empty `<id>.plist` after `defaults delete`).
  for (const id of done) console.log(`# defaults delete ${id}`);
  return done;
}
process.on('exit', () => forgetLaunchedDefaults());

/**
 * Starts an app made by "install as app" (`binary`: its `Contents/MacOS/Open Artifact`), the way a test may: its
 * executable directly, with `--port` (not 4800), `--test-mode`, `--devtools-port` and the throwaway profile's
 * environment (and `--locale en` unless `defaultLocale: false`). Its home is the one its `artifact-app.json` names (the test made that the throwaway one); `--home` is
 * not passed. Drives it over DevTools through `window.artifactApp.test`.
 */
export async function launchArtifactApp(profile: TestProfile, port: number, { binary, args = [], defaultLocale = true }: LaunchOptions = {}) {
  if (!binary) throw new Error("launchArtifactApp needs the generated app's executable");
  if (!profile?.oaHome || !profile.root || !binary.startsWith(`${profile.root}/`))
    throw new Error(`launchArtifactApp starts only an app inside the throwaway profile, not ${binary}`);
  if (!port || port === 4800) throw new Error('launchArtifactApp needs a port that is not 4800');
  // Its preferences are forgotten after the test (`forgetLaunchedDefaults`): only an id of the app's own form.
  const bundleId = bundleIdOfExecutable(binary);
  if (!APP_BUNDLE_ID.test(bundleId)) throw new Error(`launchArtifactApp starts only an app made by "install as app", not ${bundleId}`);
  launchedBundleIds.add(bundleId);
  const debugPort = await freePort();
  // English unless the test reads the language from the desktop app's settings (`defaultLocale: false`).
  const locale = defaultLocale ? ['--locale', 'en'] : [];
  const child = spawn(binary, ['--port', String(port), '--test-mode', '--devtools-port', String(debugPort), ...locale, ...args], {
    env: cleanEnv(profile, port),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines: string[] = [];
  const take = (chunk: Buffer) => {
    for (const line of String(chunk).split('\n')) if (line.trim()) lines.push(line);
    if (process.env.OA_DESKTOP_VERBOSE) process.stdout.write(`  artifact-app| ${chunk}`);
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  let exited: ProcessExit | null = null;
  child.on('exit', (code, signal) => (exited = { code, signal }));
  let cdp: Cdp | null = null;
  let page: Page | null = null;
  const it = {
    get cdp(): Cdp {
      if (!cdp) throw new Error('connect() first');
      return cdp;
    },
    get page(): Page {
      if (!page) throw new Error('connect() first');
      return page;
    },
    child,
    lines,
    get exited(): ProcessExit | null {
      return exited;
    },
    async line(pattern: RegExp, timeoutMs = 60_000) {
      const found = await until(() => lines.find((line) => pattern.test(line)) ?? (exited ? 'exited' : null), timeoutMs);
      if (!found || found === 'exited')
        throw new Error(`no line ${pattern} (${exited ? `the app exited ${JSON.stringify(exited)}` : 'timed out'}):\n${lines.join('\n')}`);
      return found;
    },
    /** The `[artifact-app] ready {…}` line, parsed. */
    async ready(timeoutMs = 90_000) {
      const line = await it.line(/\[artifact-app\] ready \{/, timeoutMs);
      return JSON.parse(line.slice(line.indexOf('{'))) as {
        problem?: string;
        reason?: string;
        detail?: string;
        artifact?: string;
        status?: string;
        daemon?: { pid: number; url: string; version: string };
        runtime?: string;
        daemonExe?: string;
      };
    },
    async connect() {
      cdp = await connectCdp(debugPort);
      const target = await it.cdp.waitTarget(isArtifactAppPage);
      page = await it.cdp.attach(target.targetId);
      await it.page.send('Runtime.enable');
      return it;
    },
    /** What the app says of itself (`artifactApp.test.info()`). */
    info() {
      return it.page.evaluate('artifactApp.test.info()');
    },
    /** The status page's `data-status` (what it says while there is no view). */
    status() {
      return it.page.evaluate<string | null>(`document.querySelector('[data-testid=status]')?.dataset.status ?? null`);
    },
    async view(id: string) {
      const target = await it.cdp.waitTarget(isShellOf(id));
      const page = await it.cdp.attach(target.targetId);
      await page.send('Runtime.enable');
      await page.send('Page.enable');
      return page;
    },
    /** Quits through the test-only bridge (`force`: unsaved work let go), then SIGTERM, then SIGKILL, by its own pid. */
    async quit({ force = false, timeoutMs = 15_000 } = {}): Promise<ProcessExit | null> {
      if (!exited) {
        try {
          await page?.evaluate(`artifactApp.test.quit(${force ? 'true' : 'false'})`);
        } catch {
          /* gone first */
        }
        await until(() => exited, timeoutMs);
      }
      if (!exited && alive(child.pid)) {
        child.kill('SIGTERM');
        await until(() => exited, 5000);
      }
      if (!exited && alive(child.pid)) {
        child.kill('SIGKILL');
        await until(() => exited, 5000);
      }
      cdp?.close();
      child.stdout?.destroy();
      child.stderr?.destroy();
      await sleep(100);
      return exited;
    },
  };
  return it;
}

/** Exercise the installed-app IPC using the same signatures as its preload. */
export function appsOn(getApp: () => TestApp) {
  type Apps = DesktopBridge['apps'];
  type Value<K extends keyof Apps> = Awaited<ReturnType<Apps[K]>> extends Reply<infer T> ? T : never;
  return async <K extends keyof Apps>(call: K, ...args: Parameters<Apps[K]>): Promise<Value<K>> => {
    const reply = await getApp().chrome.evaluate<Reply<Value<K>>>(`desktop.apps.${call}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`);
    if (!reply.ok) throw new Error(`desktop.apps.${call}: ${reply.error}`);
    return reply.value;
  };
}
