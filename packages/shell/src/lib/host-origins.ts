/**
 * The host origins connected adapters declared (`caps.open.origins`), from the daemon's `GET /api/open-artifact.embed`:
 * the Shell and the home page take `host_hello` only from these while there are any.
 */

import { LIBRARY_ROUTES } from '@open-artifact/protocol';

/** The declared host origins; `null` when they could not be read (a cloud host, a type server's own Shell). */
export async function declaredHosts(): Promise<string[] | null> {
  try {
    const response = await fetch(`/api/open-artifact.${LIBRARY_ROUTES.embed}`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { hosts?: unknown };
    return Array.isArray(body.hosts) ? body.hosts.filter((h): h is string => typeof h === 'string') : null;
  } catch {
    return null;
  }
}

/** The list one `host_hello` is judged by, and whether that hello is still the last one. */
export interface HelloHosts {
  /** This read's list; when it failed, the last list a read returned (`null` while none ever did). */
  hosts: string[] | null;
  /** No `host_hello` came after this one: a later hello's answer must not be overwritten by this one. */
  latest: boolean;
}

/**
 * Reads the list for each `host_hello`, in the order the hellos came. A failed read is judged by the last list that was
 * read, so a host taken as declared stays declared through a refresh that failed (a theme change when the daemon was
 * slow). A failure before any list was read is still `null`: undeclared, as on a cloud host.
 */
export function hostsForHellos(read: () => Promise<string[] | null> = declaredHosts): () => Promise<HelloHosts> {
  let asked = 0;
  let kept: { at: number; hosts: string[] } | null = null;
  return async () => {
    const at = ++asked;
    const hosts = await read();
    if (hosts && (!kept || at > kept.at)) kept = { at, hosts };
    return { hosts: hosts ?? kept?.hosts ?? null, latest: at === asked };
  };
}
