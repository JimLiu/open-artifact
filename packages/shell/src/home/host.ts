/**
 * The home page's side of the host protocol: an app that embeds the home
 * page answers `home_hello` with `host_hello`; with `sessions` it can show
 * an artifact's owner session (`open_session`).
 *
 * `home_hello` and `home_ready` are not in `@open-artifact/protocol` yet;
 * they are defined here.
 */

import { isShellMessage, type HostCaps, type ShellToHost } from '@open-artifact/protocol';
import { HOME_BOOT_GLOBAL, homeBootOf, type HomeBootRead } from '../lib/cloud.ts';
import { useHome } from './store.ts';

/**
 * What the server inlined into the page: a cloud host replaces `HOME_BOOT_PLACEHOLDER` in `index.html` with a
 * {@link HomeBoot} as JSON (`{"cloud": {...}}`); the local daemon serves the file as it is, so it stays `null` and the
 * page is the local one.
 */
export const homeBoot: HomeBootRead = homeBootOf((window as unknown as Record<string, unknown>)[HOME_BOOT_GLOBAL]);

/** The host that embeds the home page. */
export interface HomeHost {
  origin: string;
  caps: HostCaps;
  /** The harness the host belongs to, when it said: its sessions are the ones it can open. */
  harness: string | null;
  agentName: string | null;
}

/** Home → host messages. */
export type HomeToHost = { openArtifact: 'home_hello' } | { openArtifact: 'home_ready' } | Extract<ShellToHost, { openArtifact: 'open_session' | 'new_session' }>;

const embedded = window.parent !== window;

/** Sends a message to the host's origin. Does nothing without a host. */
export function toHost(message: HomeToHost): void {
  const host = useHome.getState().host;
  if (host) window.parent.postMessage(message, host.origin);
}

function onMessage(event: MessageEvent): void {
  const message: unknown = event.data;
  if (!embedded || event.source !== window.parent || !isShellMessage(message) || message.openArtifact !== 'host_hello') return;
  const raw = message as { caps?: unknown; agentName?: unknown; harness?: unknown };
  useHome.getState().setHost({
    origin: event.origin,
    caps: raw.caps && typeof raw.caps === 'object' ? (raw.caps as HostCaps) : {},
    harness: typeof raw.harness === 'string' && raw.harness ? raw.harness : null,
    agentName: typeof raw.agentName === 'string' && raw.agentName ? raw.agentName : null,
  });
  window.parent.postMessage({ openArtifact: 'home_ready' } satisfies HomeToHost, event.origin);
}

/** Starts listening for the host and says hello when framed. Returns a function that stops. */
export function startHost(): () => void {
  window.addEventListener('message', onMessage);
  if (embedded) window.parent.postMessage({ openArtifact: 'home_hello' } satisfies HomeToHost, '*');
  return () => window.removeEventListener('message', onMessage);
}
