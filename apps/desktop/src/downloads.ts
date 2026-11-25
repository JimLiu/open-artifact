import type { Session } from 'electron';
import type { OriginAllowlist } from './navigation.ts';
import type { Log, SavedFile } from './types.ts';
export interface DownloadsOptions {
  allowlist: Pick<OriginAllowlist, 'allows'>;
  notify: (notice: SavedFile) => void;
  reveal: (path: string) => boolean;
  log: Log;
  folder?: string;
}
/**
 * Files the artifact views save, and the notice the window shows when one is saved.
 *
 * Two ways a file arrives, both ending in the same notice ("Saved <name>", with Show in Finder):
 *
 * - **The page's server saved it.** An editor's export (Docs' Markdown or Word, Sheets' Excel or CSV, Slides' PPTX or
 *   PDF, Whiteboard's PNG…) goes through the page's `downloads` capability: its type server writes it into the
 *   downloads folder of the account the daemon runs as (`~/Downloads`, made unique with ` (2)`, ` (3)`…), and the Shell
 *   tells the host where (`saved_file`, the kit's `onSavedFile`). Nothing is downloaded by the view then.
 * - **The view downloads it.** What the Shell leaves to the browser (the artifact's folder as a zip, an export of a
 *   page with no server) and a page's own `blob:` or `data:` download: Electron's `will-download` on the views'
 *   session. It is saved, with no dialog, into the same folder under the same naming (` (2)`…); a download from an
 *   origin the views may not show is cancelled and logged, and so is any download in another session (the window's
 *   own page, the thumbnails' offscreen pages).
 *
 * The downloads folder is `<HOME>/Downloads` (`os.homedir()`, which reads HOME), the rule the type servers use, so both
 * ways land in one folder; a test's throwaway HOME has its own. The page is sent a notice's id, name and folder; Show
 * in Finder names the id, and only a path recorded here is ever shown.
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join } from 'node:path';

/** The folder downloads go to: `<HOME>/Downloads`, as the type servers save there. */
export const downloadsFolder = (home = homedir()) => join(home, 'Downloads');

/**
 * Whether a view's download from `url` may be saved: an address on an origin the views may show (`allowlist`), a
 * `blob:` address made by such an origin, or a `data:` address made by a page on one (`pageUrl`: the downloading
 * view's own address). Anything else (another program's loopback server, the web, `file:`) is not.
 */
export function downloadAllowed(url: string, allowlist: Pick<OriginAllowlist, 'allows'>, pageUrl = '') {
  const text = String(url ?? '');
  if (text.startsWith('blob:')) {
    const inner = text.slice(5);
    // `blob:null/…` (an opaque origin) has no origin to check.
    return /^https?:\/\//i.test(inner) && allowlist.allows(inner);
  }
  if (text.startsWith('data:')) return allowlist.allows(String(pageUrl ?? ''));
  return allowlist.allows(text);
}

/** A file name a download may be saved under: no folders, nothing a file system refuses; `download` when empty. */
export function safeName(name: unknown) {
  const cleaned = basename(String(name ?? ''))
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return cleaned || 'download';
}

/** `name` in `dir`, or `stem (2).ext`, `stem (3).ext`… when it is taken (on disk, or by a download under way). */
export function freeTarget(dir: string, name: string, taken: ReadonlySet<string> = new Set()) {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let target = join(dir, name);
  for (let n = 2; existsSync(target) || taken.has(target); n++) target = join(dir, `${stem} (${n})${ext}`);
  return target;
}

/**
 * The downloads of the app: `attach(session)` for the views' session, `refuse(session)` for the others; `fromShell(path)`
 * for a file a page's server saved. `notify(notice)` shows a notice (`{ id, name, folder }`: the file's name and its folder's); `reveal(id)` shows
 * a notice's file in the Finder (the `system.reveal` given). `log(line)`.
 */
export class Downloads {
  allowlist: DownloadsOptions['allowlist'];
  notify: DownloadsOptions['notify'];
  revealPath: DownloadsOptions['reveal'];
  log: Log;
  folder: string;
  saved = new Map<string, string>();
  pending = new Set<string>();
  next = 1;
  constructor({ allowlist, notify, reveal, log, folder = downloadsFolder() }: DownloadsOptions) {
    this.allowlist = allowlist;
    this.notify = notify;
    this.revealPath = reveal;
    this.log = log;
    this.folder = folder;
    /** Notice id → the file's path. */
    this.saved = new Map();
    /** Paths of downloads under way. */
    this.pending = new Set();
    this.next = 1;
  }

  /** Saves the views' downloads into the folder, and cancels those from elsewhere. */
  attach(ses: Session) {
    ses.on('will-download', (_event, item, contents) => {
      const url = item.getURL();
      const pageUrl = contents && !contents.isDestroyed() ? contents.getURL() : '';
      if (!downloadAllowed(url, this.allowlist, pageUrl)) {
        item.cancel();
        this.log(`download cancelled: ${url.slice(0, 200)} is not from a page the views may show`);
        return;
      }
      mkdirSync(this.folder, { recursive: true });
      const target = freeTarget(this.folder, safeName(item.getFilename()), this.pending);
      this.pending.add(target);
      item.setSavePath(target);
      this.log(`download ${url.slice(0, 200)} to ${target}`);
      item.once('done', (_e, state) => {
        this.pending.delete(target);
        if (state === 'completed') this.done(target, 'download');
        else this.log(`download ${state}: ${target}`);
      });
    });
  }

  /** A session whose pages never download (the window's own, the thumbnails'): every download is cancelled. */
  refuse(ses: Session, name: string) {
    ses.on('will-download', (_event, item) => {
      item.cancel();
      this.log(`download cancelled in ${name}: ${item.getURL().slice(0, 200)}`);
    });
  }

  /** A file a page's server saved (the Shell's `saved_file`): an absolute path to a file that is there. */
  fromShell(path: unknown) {
    if (typeof path !== 'string' || !isAbsolute(path)) return this.log(`saved file ignored: not an absolute path`);
    let file = false;
    try {
      file = statSync(path).isFile();
    } catch {
      // Not there.
    }
    if (!file) return this.log(`saved file ignored: no file at ${path}`);
    this.done(path, 'shell');
  }

  done(path: string, via: 'download' | 'shell') {
    const id = `n${this.next++}`;
    this.saved.set(id, path);
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      // Gone already.
    }
    this.log(`saved ${JSON.stringify({ id, path, size, via })}`);
    this.notify({ id, name: basename(path), folder: basename(join(path, '..')) });
  }

  /** Shows a notice's file in the Finder (only a path recorded here). */
  reveal(id: string) {
    const path = this.saved.get(String(id));
    if (!path) return false;
    return this.revealPath(path);
  }
}
