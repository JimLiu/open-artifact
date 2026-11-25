/**
 * A thin Chrome DevTools Protocol client for driving the app in test mode (its remote debugging port), with Node's own
 * WebSocket. Sessions are flat (`Target.attachToTarget` with `flatten`); a frame inside a page (the editor in the
 * Shell) is reached through an isolated world of that frame, or through its own target when it runs out of process.
 */
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export async function connectCdp(port, { timeoutMs = 20_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let version;
  for (;;) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      break;
    } catch (error) {
      if (Date.now() > deadline) throw new Error(`no DevTools on ${port}: ${error.message}`);
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

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.next = 1;
    this.waiting = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', (message) => {
      const data = JSON.parse(message.data);
      if (data.id && this.waiting.has(data.id)) {
        const { resolve, reject, method } = this.waiting.get(data.id);
        this.waiting.delete(data.id);
        if (data.error) reject(new Error(`${method}: ${data.error.message}`));
        else resolve(data.result);
      } else if (data.method) {
        for (const listener of this.listeners) listener(data);
      }
    });
  }

  send(method, params = {}, sessionId, timeoutMs = 30_000) {
    const id = this.next++;
    const payload = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`${method}: no answer in ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiting.set(id, {
        method,
        resolve: (value) => (clearTimeout(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      });
      this.socket.send(JSON.stringify(payload));
    });
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async targets() {
    return (await this.send('Target.getTargets')).targetInfos;
  }

  /** The first target `match(info)` accepts, waiting for one. */
  async waitTarget(match, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = (await this.targets()).find(match);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`no such target; there are: ${(await this.targets()).map((t) => `${t.type} ${t.url}`).join(', ')}`);
      await sleep(200);
    }
  }

  async attach(targetId) {
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
  constructor(cdp, sessionId, targetId) {
    Object.assign(this, { cdp, sessionId, targetId });
    this.worlds = new Map();
  }

  send(method, params) {
    return this.cdp.send(method, params, this.sessionId);
  }

  async evaluate(expression, contextId) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
    if (result.exceptionDetails) throw new Error(`evaluate: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result.value;
  }

  async waitFor(expression, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    for (;;) {
      try {
        last = await this.evaluate(expression);
        if (last) return last;
      } catch (error) {
        last = error;
      }
      if (Date.now() > deadline) return last instanceof Error ? false : last;
      await sleep(150);
    }
  }

  /** Every frame of the page: `{ id, url }`. */
  async frames() {
    const { frameTree } = await this.send('Page.getFrameTree');
    const out = [];
    const walk = (node) => {
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
  async inFrame(match, expression) {
    const frame = (await this.frames()).find((f) => match(f.url));
    if (frame) {
      try {
        let contextId = this.worlds.get(frame.id);
        if (!contextId) {
          ({ executionContextId: contextId } = await this.send('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'oa-desktop-test' }));
          this.worlds.set(frame.id, contextId);
        }
        return await this.evaluate(expression, contextId);
      } catch (error) {
        this.worlds.delete(frame.id);
        if (!/frame|context|Cannot find/i.test(error.message)) throw error;
      }
    }
    const target = (await this.cdp.targets()).find((t) => t.type === 'iframe' && match(t.url));
    if (!target) return undefined;
    const page = (this.frameTargets ??= new Map()).get(target.targetId) ?? (await this.cdp.attach(target.targetId));
    this.frameTargets.set(target.targetId, page);
    return page.evaluate(expression);
  }

  async waitInFrame(match, expression, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    for (;;) {
      try {
        last = await this.inFrame(match, expression);
        if (last) return last;
      } catch (error) {
        last = error;
      }
      if (Date.now() > deadline) return last instanceof Error ? `error: ${last.message}` : last;
      await sleep(200);
    }
  }

  /** Text into whatever has focus, as an input method commits it. */
  type(text) {
    return this.send('Input.insertText', { text });
  }
}
