/**
 * The page demo's inner shell (`page-shell.html`, framed by the demo Shell): frame-host's own `shell.js` and
 * `comments.js`, unchanged, with what they would ask frame-host over HTTP answered from the demo artifact instead
 * ({@link FrameBackend}). Before they load, this page's `fetch` answers `api/frame/*`, its `WebSocket` answers the
 * event stream (`api/frame/events`), and its frames load the artifact's page as a `srcdoc` where the inner shell points
 * them at frame-host's page address (`<origin>/_f/<ver>/`). Everything else goes out as usual.
 */

import { FrameBackend } from '../provider/frame-backend.ts';
import type { DemoArtifact } from '../provider/demo-provider.ts';
import type { FrameEvent } from '../../../../packages/server-sdk/src/frame/wire.ts';

const API = '/api/frame/';
const asset = (name: string): string => new URL(`frame-host/${name}`, location.href).href;

/** The demo Shell's artifact (the parent page, same origin); null when this page is opened by itself. */
function demoOfParent(): DemoArtifact | null {
  try {
    return window.parent !== window ? (window.parent.__PLAYGROUND__ ?? null) : null;
  } catch {
    return null;
  }
}

/** The inner shell's event stream, in place of a WebSocket to frame-host: `hello` first, then the backend's events. */
class EventStream {
  readyState = 0;
  readonly protocol = 'baoyu-sse';
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private stop: (() => void) | null = null;

  constructor(
    readonly url: string,
    backend: FrameBackend,
  ) {
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen?.(new Event('open'));
      const deliver = (event: FrameEvent): void => {
        if (this.readyState === 1) this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }));
      };
      deliver(backend.hello());
      this.stop = backend.events.on(deliver);
    }, 0);
  }

  send(): void {
    // The inner shell never sends on its stream.
  }

  close(): void {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.stop?.();
    this.onclose?.(new CloseEvent('close', { code: 1000 }));
  }
}

function install(backend: FrameBackend): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    const at = url.pathname.indexOf(API);
    if (url.origin !== location.origin || at < 0) return realFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = undefined;
      }
    }
    const out = await backend.request(url.pathname.slice(at + API.length), method, body);
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'content-type': 'application/json' } });
  };

  const RealWebSocket = window.WebSocket;
  window.WebSocket = new Proxy(RealWebSocket, {
    construct(target, args: ConstructorParameters<typeof WebSocket>) {
      const url = String(args[0]);
      if (url.includes(`${API}events`)) return new EventStream(url, backend) as unknown as WebSocket;
      return Reflect.construct(target, args) as WebSocket;
    },
  });

  // The inner shell points its page frame at frame-host's page address; here the page is a srcdoc of the artifact's.
  const src = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')!;
  Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
    configurable: true,
    enumerable: src.enumerable,
    get(this: HTMLIFrameElement): string {
      return src.get!.call(this) as string;
    },
    set(this: HTMLIFrameElement, value: string) {
      if (/\/_f\/[^/]*\//.test(String(value))) {
        this.removeAttribute('src');
        this.srcdoc = backend.pageDocument();
        return;
      }
      src.set!.call(this, value);
    },
  });
}

/** Loads frame-host's own client files, in order (comments.js first: shell.js mounts its views). */
function loadClient(): void {
  for (const name of ['comments.css', 'shell.css']) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = asset(name);
    document.head.append(link);
  }
  for (const name of ['comments.js', 'shell.js']) {
    const script = document.createElement('script');
    script.src = asset(name);
    script.async = false;
    document.head.append(script);
  }
}

/**
 * frame-host's inner shell learns that the agent is working by polling `activity` every ten seconds, which misses a
 * simulated turn of a few seconds. When the agent starts or stops here, the inner shell is asked to look now, with the
 * message its page may send it for that (`__frame_agent_activity_ask`), as from the page frame.
 */
function nudgeActivity(demo: DemoArtifact): void {
  demo.agent.statusChanges.on(() => {
    const page = document.querySelector<HTMLIFrameElement>('#stage iframe')?.contentWindow;
    if (!page) return;
    window.dispatchEvent(new MessageEvent('message', { data: { __frame_agent_activity_ask: true }, source: page, origin: location.origin }));
  });
}

const demo = demoOfParent();
if (demo) {
  install(new FrameBackend(demo, location.origin, asset('runtime.js')));
  nudgeActivity(demo);
}
loadClient();
