/**
 * The address of one of the app's own pages (the window's page, an artifact app's status page, the notice) and the
 * check that a call comes from it. A page is loaded from `pageUrlOf(path)` (`pathToFileURL`: every `#`, `?`, `%`,
 * space and non-ASCII character of the path escaped), and a frame is that page when its address, read back as a
 * path, is that path. Comparing addresses as text broke where the package's own name has such characters (an
 * artifact installed as an app is named after its title: `计划 #2 50%?.app`): Electron's `loadFile` leaves `%` as it
 * is, and `new URL('file://' + path)` reads `#` and `?` as the start of a fragment and a query.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The `file:` address of the page at `path`. */
export const pageUrlOf = (path: string) => pathToFileURL(path).href;

/** Whether `url` (a frame's address) is the page at `path`: a `file:` address with no query or fragment, of that path. */
export function isPageAt(url: unknown, path: string) {
  if (typeof url !== 'string' || !url.startsWith('file:')) return false;
  try {
    const parsed = new URL(url);
    if (parsed.search || parsed.hash) return false;
    return fileURLToPath(parsed) === path;
  } catch {
    return false;
  }
}
