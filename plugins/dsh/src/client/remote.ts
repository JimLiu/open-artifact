/**
 * Opening an artifact when DSH is used from another device (its web profile on a server, reached over the LAN or a
 * tailnet). The daemon's address is this computer's loopback, which the other device cannot reach, so the page opens
 * what the open route answers with in a window of its own.
 */
import type { PendingWindow } from '@open-artifact/library-page';

/** The name in a Host header (`192.168.1.5:7777`, `[fd00::5]:80`, `box.ts.net`), lower case; '' when there is none. */
export function hostName(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 0 ? value.slice(1, end) : value.slice(1);
  }
  return value.split(':').length === 2 ? value.slice(0, value.indexOf(':')) : value;
}

/** A name that means this computer to whoever uses it: `localhost`, 127.x.x.x, ::1. */
export function isLoopbackName(name: string): boolean {
  const n = name.toLowerCase().replace(/^\[|\]$/g, '');
  return n === 'localhost' || n.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(n) || n === '::1' || n === '0:0:0:0:0:0:0:1' || n === '::ffff:127.0.0.1';
}

/** The app is open on another device: its page is served at an address other than this computer's loopback. */
export function onAnotherDevice(): boolean {
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return false;
  return !isLoopbackName(location.hostname);
}

/** A window opened before its address is known. */
export type { PendingWindow };

/**
 * A window opened at once, while the click still counts as the person's, and sent to the artifact when its address
 * comes: starting a page can take seconds, and a browser blocks a window a page opens that late. Null when the browser
 * blocked this one too.
 */
export function pendingWindow(): PendingWindow | null {
  if (typeof window === 'undefined') return null;
  const opened = window.open('about:blank', '_blank');
  if (!opened) return null;
  try {
    opened.opener = null;
  } catch {
    // Some browsers keep it read-only: the page is of another origin anyway.
  }
  return {
    go: (url) => opened.location.replace(url),
    close: () => opened.close(),
  };
}
