import { shell } from 'electron';
import { externalTarget } from './navigation.ts';
import type { Log } from './types.ts';

/**
 * The one place the desktop app opens a link in the system browser. Callers (`tabs`, the artifact window, a view's
 * `setWindowOpenHandler`, the sign-in approval page) do not check the scheme themselves. A link that is not http(s)
 * is refused, and the log line never carries the userinfo or the query.
 */
export function openExternal(url: string, log: Log, { testMode = false } = {}): boolean {
  const target = externalTarget(url);
  if (!target) {
    log('blocked external');
    return false;
  }
  log(`external ${target.log}`);
  if (!testMode) void shell.openExternal(target.href);
  return true;
}
