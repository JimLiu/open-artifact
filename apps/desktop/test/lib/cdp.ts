import type { Protocol } from 'devtools-protocol';
import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js';
import type { ArtifactAppBridge, DesktopBridge } from '../../src/contracts.ts';
import { errorInfo } from '../../src/errors.ts';
type CdpEvent = { [K in keyof ProtocolMapping.Events]: { method: K; params: ProtocolMapping.Events[K][0]; sessionId?: string } }[keyof ProtocolMapping.Events];
type CdpMessage = CdpEvent | { id: number; result?: unknown; error?: { message: string } };
interface PendingCall {
  method: string;
  sessionId?: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
}
type Params<K extends keyof ProtocolMapping.Commands> = ProtocolMapping.Commands[K]['paramsType'][0];
type Answer<K extends keyof ProtocolMapping.Commands> = ProtocolMapping.Commands[K]['returnType'];
export type FrameMatch = (url: string) => boolean;
/**
 * A thin Chrome DevTools Protocol client for driving the app in test mode (its remote debugging port), with Node's own
 * WebSocket. Sessions are flat (`Target.attachToTarget` with `flatten`); a frame inside a page (the editor in the
 * Shell) is reached through an isolated world of that frame, or through its own target when it runs out of process.
 */
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export async function connectCdp(port: number, { timeoutMs = 20_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let version: { webSocketDebuggerUrl: string };
  for (;;) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      break;
    } catch (error) {
      if (Date.now() > deadline) throw new Error(`no DevTools on ${port}: ${errorInfo(error).message}`);
      await sleep(200);
    }
  }
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', () => fail(new Error('DevTools socket failed')), { once: true });
  });
  return new Cdp(socket);
}

export class Cdp {
  socket: WebSocket;
  next = 1;
  waiting = new Map<number, PendingCall>();
  listeners = new Set<(event: CdpEvent) => void>();
  constructor(socket: WebSocket) {
    this.socket = socket;
    this.next = 1;
    this.waiting = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', (message: MessageEvent<unknown>) => {
      const data = JSON.parse(String(message.data)) as CdpMessage;
      if ('id' in data && this.waiting.has(data.id)) {
        const { resolve, reject, method } = this.waiting.get(data.id)!;
        this.waiting.delete(data.id);
        if (data.error) reject(new Error(`${method}: ${data.error.message}`));
        else resolve(data.result);
      } else if ('method' in data) {
        // A target that goes away never answers what was sent to it: fail those calls now, not after their timeout.
        if (data.method === 'Target.detachedFromTarget') this.drop(data.params.sessionId, `the target was removed (${data.params.targetId ?? 'detached'})`);
        for (const listener of this.listeners) listener(data);
      }
    });
    socket.addEventListener('close', () => this.drop(undefined, 'the DevTools socket closed'));
  }

  /** Fails every waiting call of `sessionId` (every call at all when it is undefined). */
  drop(sessionId: string | undefined, why: string) {
    for (const [id, call] of this.waiting) {
      if (sessionId !== undefined && call.sessionId !== sessionId) continue;
      this.waiting.delete(id);
      call.reject(new Error(`${call.method}: ${why}`));
    }
  }

  send<K extends keyof ProtocolMapping.Commands>(method: K, params?: Params<K>, sessionId?: string, timeoutMs = 30_000): Promise<Answer<K>> {
    const id = this.next++;
    const payload = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`${method}: no answer in ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiting.set(id, {
        method,
        sessionId,
        resolve: (value) => (clearTimeout(timer), resolve(value as Answer<K>)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      });
      this.socket.send(JSON.stringify(payload));
    });
  }

  on(listener: (event: CdpEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async targets() {
    return (await this.send('Target.getTargets')).targetInfos;
  }

  /** The first target `match(info)` accepts, waiting for one. */
  async waitTarget(match: (target: Protocol.Target.TargetInfo) => boolean, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = (await this.targets()).find(match);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`no such target; there are: ${(await this.targets()).map((t) => `${t.type} ${t.url}`).join(', ')}`);
      await sleep(200);
    }
  }

  async attach(targetId: string) {
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    return new Page(this, sessionId, targetId);
  }

  close() {
    try {
      this.socket.close();
    } catch {
      /* gone */
    }
  }
}

/** One attached page (or frame) target. */
export class Page {
  cdp: Cdp;
  sessionId: string;
  targetId: string;
  worlds = new Map<string, number>();
  frameTargets = new Map<string, Page>();
  constructor(cdp: Cdp, sessionId: string, targetId: string) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.worlds = new Map();
  }

  send<K extends keyof ProtocolMapping.Commands>(method: K, params?: Params<K>): Promise<Answer<K>> {
    return this.cdp.send(method, params, this.sessionId);
  }

  evaluate(expression: `desktop.state(${string})`, contextId?: number): ReturnType<DesktopBridge['state']>;
  evaluate(expression: `desktop.open(${string})`, contextId?: number): ReturnType<DesktopBridge['open']>;
  evaluate(expression: `desktop.select(${string})`, contextId?: number): ReturnType<DesktopBridge['select']>;
  evaluate(expression: `desktop.close(${string})`, contextId?: number): ReturnType<DesktopBridge['close']>;
  evaluate(expression: `desktop.reload(${string})`, contextId?: number): ReturnType<DesktopBridge['reload']>;
  evaluate(expression: `desktop.back(${string})`, contextId?: number): ReturnType<DesktopBridge['back']>;
  evaluate(expression: `desktop.forward(${string})`, contextId?: number): ReturnType<DesktopBridge['forward']>;
  evaluate(expression: `desktop.setSidebarCollapsed(${string})`, contextId?: number): ReturnType<DesktopBridge['setSidebarCollapsed']>;
  evaluate(expression: `desktop.setOverlay(${string})`, contextId?: number): ReturnType<DesktopBridge['setOverlay']>;
  evaluate(expression: `desktop.answer(${string})`, contextId?: number): ReturnType<DesktopBridge['answer']>;
  evaluate(expression: `desktop.settings.get(${string})`, contextId?: number): ReturnType<DesktopBridge['settings']['get']>;
  evaluate(expression: `desktop.settings.set(${string})`, contextId?: number): ReturnType<DesktopBridge['settings']['set']>;
  evaluate(expression: `desktop.settings.chooseFolder(${string})`, contextId?: number): ReturnType<DesktopBridge['settings']['chooseFolder']>;
  evaluate(expression: `desktop.settings.revealHome(${string})`, contextId?: number): ReturnType<DesktopBridge['settings']['revealHome']>;
  evaluate(expression: `desktop.service.get(${string})`, contextId?: number): ReturnType<DesktopBridge['service']['get']>;
  evaluate(expression: `desktop.service.do(${string})`, contextId?: number): ReturnType<DesktopBridge['service']['do']>;
  evaluate(expression: `desktop.runtime.get(${string})`, contextId?: number): ReturnType<DesktopBridge['runtime']['get']>;
  evaluate(expression: `desktop.runtime.do(${string})`, contextId?: number): ReturnType<DesktopBridge['runtime']['do']>;
  evaluate(expression: `desktop.servers.get(${string})`, contextId?: number): ReturnType<DesktopBridge['servers']['get']>;
  evaluate(expression: `desktop.servers.do(${string})`, contextId?: number): ReturnType<DesktopBridge['servers']['do']>;
  evaluate(expression: `desktop.apps.state(${string})`, contextId?: number): ReturnType<DesktopBridge['apps']['state']>;
  evaluate(expression: `desktop.apps.install(${string})`, contextId?: number): ReturnType<DesktopBridge['apps']['install']>;
  evaluate(expression: `desktop.apps.open(${string})`, contextId?: number): ReturnType<DesktopBridge['apps']['open']>;
  evaluate(expression: `desktop.apps.reveal(${string})`, contextId?: number): ReturnType<DesktopBridge['apps']['reveal']>;
  evaluate(expression: `desktop.apps.uninstall(${string})`, contextId?: number): ReturnType<DesktopBridge['apps']['uninstall']>;
  evaluate(expression: `desktop.apps.refresh(${string})`, contextId?: number): ReturnType<DesktopBridge['apps']['refresh']>;
  evaluate(expression: `desktop.apps.repair(${string})`, contextId?: number): ReturnType<DesktopBridge['apps']['repair']>;
  evaluate(expression: `desktop.apps.forget(${string})`, contextId?: number): ReturnType<DesktopBridge['apps']['forget']>;
  evaluate(expression: `desktop.test.menu(${string})`, contextId?: number): ReturnType<DesktopBridge['test']['menu']>;
  evaluate(expression: `desktop.test.notice(${string})`, contextId?: number): ReturnType<DesktopBridge['test']['notice']>;
  evaluate(expression: `desktop.test.blocked(${string})`, contextId?: number): ReturnType<DesktopBridge['test']['blocked']>;
  evaluate(expression: `desktop.test.downloads(${string})`, contextId?: number): ReturnType<DesktopBridge['test']['downloads']>;
  evaluate(expression: `desktop.test.tabInfo(${string})`, contextId?: number): ReturnType<DesktopBridge['test']['tabInfo']>;
  evaluate(expression: `desktop.test.servers(${string})`, contextId?: number): ReturnType<DesktopBridge['test']['servers']>;
  evaluate(expression: `artifactApp.state(${string})`, contextId?: number): ReturnType<ArtifactAppBridge['state']>;
  evaluate(expression: `artifactApp.test.menu(${string})`, contextId?: number): ReturnType<ArtifactAppBridge['test']['menu']>;
  evaluate(expression: `artifactApp.test.info(${string})`, contextId?: number): ReturnType<ArtifactAppBridge['test']['info']>;
  evaluate<T = unknown>(expression: string, contextId?: number): Promise<T>;
  async evaluate<T = unknown>(expression: string, contextId?: number): Promise<T> {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
    if (result.exceptionDetails) throw new Error(`evaluate: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result.value as T;
  }

  async waitFor<T = unknown>(expression: string, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    let last: T | Error | undefined;
    for (;;) {
      try {
        last = await this.evaluate<T>(expression);
        if (last) return last;
      } catch (error) {
        last = error instanceof Error ? error : new Error(String(error));
      }
      if (Date.now() > deadline) return last instanceof Error ? false : last;
      await sleep(150);
    }
  }

  /** Every frame of the page: `{ id, url }`. */
  async frames() {
    const { frameTree } = await this.send('Page.getFrameTree');
    const out: { id: string; url: string }[] = [];
    const walk = (node: Protocol.Page.FrameTree) => {
      out.push({ id: node.frame.id, url: node.frame.url });
      for (const child of node.childFrames ?? []) walk(child);
    };
    walk(frameTree);
    return out;
  }

  /**
   * Evaluates in the first frame `match(url)` accepts: an isolated world of it (it shares the DOM), or, when that frame
   * runs in a process of its own, its own target. `undefined` when no such frame exists yet.
   */
  async inFrame<T = unknown>(match: FrameMatch, expression: string) {
    const frame = (await this.frames()).find((f) => match(f.url));
    if (frame) {
      try {
        let contextId = this.worlds.get(frame.id);
        if (!contextId) {
          ({ executionContextId: contextId } = await this.send('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'oa-desktop-test' }));
          this.worlds.set(frame.id, contextId);
        }
        return await this.evaluate<T>(expression, contextId);
      } catch (error) {
        this.worlds.delete(frame.id);
        if (!/frame|context|Cannot find/i.test(errorInfo(error).message)) throw error;
      }
    }
    const target = (await this.cdp.targets()).find((t) => t.type === 'iframe' && match(t.url));
    if (!target) return undefined;
    const page = (this.frameTargets ??= new Map()).get(target.targetId) ?? (await this.cdp.attach(target.targetId));
    this.frameTargets.set(target.targetId, page);
    return page.evaluate<T>(expression);
  }

  async waitInFrame<T = unknown>(match: FrameMatch, expression: string, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    let last: T | Error | undefined;
    for (;;) {
      try {
        last = await this.inFrame<T>(match, expression);
        if (last) return last;
      } catch (error) {
        last = error instanceof Error ? error : new Error(String(error));
      }
      if (Date.now() > deadline) return last instanceof Error ? `error: ${last.message}` : last;
      await sleep(200);
    }
  }

  /** Text into whatever has focus, as an input method commits it. */
  type(text: string) {
    return this.send('Input.insertText', { text });
  }

  /** A real mouse click at (x, y) of the page's viewport (Chromium finds the frame there). `button`: left or right. */
  async click(x: number, y: number, { button = 'left' }: { button?: 'left' | 'right' } = {}) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const type of ['mousePressed', 'mouseReleased'] as const) await this.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1 });
  }

  /**
   * Clicks `element` (an expression in the page's own world) once it has a box that holds still and nothing covers
   * it (a menu still opening moves its rows): the element's own `click()` (a window that is never shown gets no real
   * mouse). Throws when there is nothing to click in `timeoutMs`.
   */
  async clickOn(element: string, { timeoutMs = 10_000 } = {}) {
    const middle = `(() => { const el = (${element}); const r = el?.getBoundingClientRect(); if (!r?.width) return null;
      const x = r.x + r.width / 2, y = r.y + r.height / 2; const hit = document.elementFromPoint(x, y);
      return hit && (hit === el || el.contains(hit)) ? [x, y] : null; })()`;
    const deadline = Date.now() + timeoutMs;
    let was: [number, number] | null = null;
    for (;;) {
      const at = await this.evaluate<[number, number] | null>(middle).catch(() => null);
      if (at && was && at[0] === was[0] && at[1] === was[1]) return this.evaluate(`(${element}).click(), true`);
      was = at;
      if (Date.now() > deadline) throw new Error(`nothing to click: ${element}`);
      await sleep(100);
    }
  }
}

/** A button or menu item by its words or its aria-label (an expression for `clickOn`). */
export const buttonNamed = (name: string) =>
  `[...document.querySelectorAll('button, [role="menuitem"]')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(name)} || b.textContent.trim() === ${JSON.stringify(name)})`;
