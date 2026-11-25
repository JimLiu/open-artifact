/**
 * Starts the built app in test mode (no shown window, no Dock icon, links out only logged, DevTools on a port), with
 * no `node` on PATH and the throwaway profile's environment, and drives it over DevTools.
 */
import { spawn } from 'node:child_process';
import { APP, alive, cleanEnv, electronBinary, freePort, sleep, until } from './env.mjs';
import { connectCdp } from './cdp.mjs';

/** The artifact's Shell page in a view: `/a/<id>` on the daemon. */
export const isShellOf = (id) => (info) => info.type === 'page' && new URL(info.url || 'about:blank').pathname === `/a/${id}`;

/**
 * `defaultLocale: false` leaves out the `--locale en` every other launch gets, for a test of the language setting
 * (test mode's `--locale` comes before it). `binary`: the packaged app's executable (`Contents/MacOS/Open Artifact`),
 * started with no app folder; else Electron with this folder. Either way it gets `--home`, `--port`, `--test-mode` and
 * the throwaway profile's environment: the packaged app is never started without them.
 */
export async function launchApp(profile, port, { args = [], env = {}, defaultLocale = true, binary = null } = {}) {
  const debugPort = await freePort();
  // English unless a test asks for another language: the tests read the app's words.
  const locale = args.includes('--locale') || !defaultLocale ? [] : ['--locale', 'en'];
  if (!profile?.oaHome || !port || port === 4800) throw new Error('launchApp needs a throwaway profile and a port that is not 4800');
  const child = spawn(binary ?? electronBinary(), [...(binary ? [] : [APP]), '--home', profile.oaHome, '--port', String(port), '--test-mode', '--devtools-port', String(debugPort), ...locale, ...args], {
    env: cleanEnv(profile, port, env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = [];
  const take = (chunk) => {
    for (const line of String(chunk).split('\n')) if (line.trim()) lines.push(line);
    if (process.env.OA_DESKTOP_VERBOSE) process.stdout.write(`  app| ${chunk}`);
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  let exited = null;
  child.on('exit', (code, signal) => (exited = { code, signal }));

  const app = {
    child,
    lines,
    debugPort,
    get exited() {
      return exited;
    },
    /** The first log line matching `pattern`, waiting for it. */
    async line(pattern, timeoutMs = 60_000) {
      const found = await until(() => lines.find((line) => pattern.test(line)) ?? (exited ? 'exited' : null), timeoutMs);
      if (!found || found === 'exited') throw new Error(`no line ${pattern} (${exited ? `the app exited ${JSON.stringify(exited)}` : 'timed out'}):\n${lines.join('\n')}`);
      return found;
    },
    async connect() {
      app.cdp = await connectCdp(debugPort);
      const chrome = await app.cdp.waitTarget((t) => t.type === 'page' && t.url.startsWith('file://') && t.url.endsWith('/renderer/index.html'));
      app.chrome = await app.cdp.attach(chrome.targetId);
      await app.chrome.send('Runtime.enable');
      return app;
    },
    /** Opens an artifact in a tab through the bar's bridge, as the home page will. */
    open(id) {
      return app.chrome.evaluate(`desktop.open(${JSON.stringify(id)})`);
    },
    state() {
      return app.chrome.evaluate('desktop.state()');
    },
    /** The view of an artifact's tab, attached. */
    async view(id) {
      const target = await app.cdp.waitTarget(isShellOf(id));
      const page = await app.cdp.attach(target.targetId);
      await page.send('Runtime.enable');
      await page.send('Page.enable');
      return page;
    },
    /** Quits the app as the person would (its window closes), then waits for it to exit. */
    async quit(timeoutMs = 15_000) {
      if (!exited) {
        try {
          await app.chrome?.evaluate('window.close(), true');
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
      app.cdp?.close();
      child.stdout?.destroy();
      child.stderr?.destroy();
      await sleep(100);
      return exited;
    },
    /** The app's own `[desktop] profile {…}` line, parsed. */
    async profileLine() {
      const line = await app.line(/\[desktop\] profile \{/);
      return JSON.parse(line.slice(line.indexOf('{')));
    },
    /** A named command of the main process (the menu's), through the test-only bridge. */
    command(name, arg) {
      return app.chrome.evaluate(`desktop.test.command(${JSON.stringify(name)}, ${JSON.stringify(arg ?? null)})`);
    },
    /** The application menu, as the main process sees it (labels, roles, accelerators, enabled). */
    menu() {
      return app.chrome.evaluate('desktop.test.menu()');
    },
  };
  return app;
}

/** The Library API of the profile's daemon, with its token (as the home page's calls go through the app). */
export async function library(state, name, body) {
  const response = await fetch(`${state.url}/api/open-artifact.${name}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${state.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return response.json();
}
