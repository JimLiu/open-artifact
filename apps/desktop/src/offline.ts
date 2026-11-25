import type { OnBeforeRequestListenerDetails, Session } from 'electron';
/**
 * Test mode's `--offline`: every request a page of the app makes to an address that is not this computer is refused
 * and logged (`[desktop] offline: blocked <url>`), in every session the app has (the window's own, the artifact views',
 * the thumbnails'), so a test can run a type with no network and list what it would have fetched.
 *
 * This computer is `localhost` and `*.localhost` (the editors' frame origins), `127.0.0.0/8` and `::1`. Requests the
 * daemon and its type servers make themselves are not pages' and are not seen here: the offline test points those
 * processes at a refusing proxy of its own instead.
 */

/** Whether `address` is on this computer (or is not a network address at all: `file:`, `blob:`, `data:`, the app's own schemes). */
export function onThisComputer(address: string) {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return true;
  }
  if (!/^(https?|wss?):$/.test(url.protocol)) return true;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** Refuses every request of `ses` that leaves this computer; `blocked(url, details)` hears each one. */
export function blockOffline(ses: Session, blocked: (url: string, details: OnBeforeRequestListenerDetails) => void) {
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (onThisComputer(details.url)) return callback({});
    blocked(details.url, details);
    callback({ cancel: true });
  });
}
