/**
 * The notice: a small transparent `WebContentsView` at the window's bottom right, above the artifact's view
 * (a view is drawn over the window's own page, so a notice the page drew would be hidden). It says the file's name and
 * the folder it was saved in, with Show in Finder and Close; it goes by itself after a few seconds, and stays while the
 * pointer rests on it. It is not focused when it shows (the person keeps typing where they were). It also says how a
 * Move To…, Open Folder… or Import… went while an artifact's tab is in front (`say`): no file, no Show in Finder.
 *
 * Its page (`renderer/notice/`) is the app's own file, sandboxed, with its own preload; it is sent display data only
 * (the id, name and folder name, the words). Show in Finder names the id; `reveal(id)` is the app's.
 */
import { WebContentsView, ipcMain } from 'electron';
import { join } from 'node:path';
import { isPageAt, pageUrlOf } from './page-url.mjs';

const WIDTH = 380;
const HEIGHT = 84;
/** How long a notice stays (ms). */
export const NOTICE_MS = 6000;

export class Notice {
  /** `window`; `dir`: the build's folder (out/); `words()`: `{ saved(folder), reveal, close, lang }`; `reveal(id)`; `log`; `testMode`. */
  constructor({ window, dir, words, reveal, log, testMode = false }) {
    Object.assign(this, { window, words, revealId: reveal, log, testMode });
    this.page = join(dir, 'renderer', 'notice', 'notice.html');
    this.view = null;
    this.loaded = null;
    this.current = null;
    this.timer = null;
    this.hovered = false;
    const mine = (event) => this.view && event.sender === this.view.webContents && isPageAt(event.senderFrame?.url, this.page);
    ipcMain.on('notice:ready', () => {});
    ipcMain.on('notice:reveal', (event, id) => {
      if (!mine(event)) return this.log(`refused notice:reveal from ${event.senderFrame?.url ?? '?'}`);
      this.revealId(String(id));
    });
    ipcMain.on('notice:dismiss', (event) => {
      if (mine(event)) this.hide();
    });
    ipcMain.on('notice:hover', (event, on) => {
      if (!mine(event)) return;
      this.hovered = on === true;
      if (this.hovered) clearTimeout(this.timer);
      else this.arm();
    });
    window.on('resize', () => this.place());
  }

  make() {
    if (this.view) return this.loaded;
    this.view = new WebContentsView({
      webPreferences: {
        preload: join(this.page, '..', '..', '..', 'notice-preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        backgroundThrottling: !this.testMode,
      },
    });
    this.view.setBackgroundColor('#00000000');
    const contents = this.view.webContents;
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.view.setVisible(false);
    this.window.contentView.addChildView(this.view);
    this.loaded = contents.loadURL(pageUrlOf(this.page)).catch((error) => this.log(`notice: ${error?.message ?? error}`));
    return this.loaded;
  }

  place() {
    if (!this.view || this.window.isDestroyed()) return;
    const { width, height } = this.window.getContentBounds();
    const w = Math.min(WIDTH, Math.max(0, width - 16));
    this.view.setBounds({ x: Math.max(0, width - w - 4), y: Math.max(0, height - HEIGHT - 4), width: w, height: HEIGHT });
  }

  /** Keeps the notice above every other view (a tab opened after it showed). */
  raise() {
    if (!this.view || !this.current || this.window.isDestroyed()) return;
    this.window.contentView.addChildView(this.view);
  }

  /** Shows a notice: `{ id, name, folder }`. */
  async show({ id, name, folder }) {
    const words = this.words();
    await this.put({ id, name, where: words.saved(folder), kind: 'saved', lang: words.lang, words: { reveal: words.reveal, close: words.close } });
    this.log(`notice ${JSON.stringify({ id, name, folder })}`);
  }

  /**
   * Says how something went (`kind`: info or error), over the tab's view: Move To…, Open Folder… and Import… while an
   * artifact's tab is in front, where the home page's toast cannot be seen.
   */
  async say({ message, kind = 'info' }) {
    const words = this.words();
    await this.put({ id: null, name: String(message).slice(0, 300), where: '', kind: kind === 'error' ? 'error' : 'info', lang: words.lang, words: { reveal: words.reveal, close: words.close } });
    this.log(`notice says ${JSON.stringify({ message, kind })}`);
  }

  async put(current) {
    await this.make();
    if (this.window.isDestroyed()) return;
    this.current = current;
    this.place();
    this.raise();
    this.view.setVisible(true);
    this.view.webContents.send('notice:show', this.current);
    this.arm();
  }

  arm() {
    clearTimeout(this.timer);
    if (this.hovered || !this.current) return;
    this.timer = setTimeout(() => this.hide(), NOTICE_MS);
  }

  hide() {
    clearTimeout(this.timer);
    if (!this.current) return;
    this.current = null;
    this.hovered = false;
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.view.webContents.send('notice:show', null);
      this.view.setVisible(false);
    }
  }

  /** What a test reads: the notice showing now (or null). */
  state() {
    return this.current ? { id: this.current.id, name: this.current.name, where: this.current.where, kind: this.current.kind, visible: !!this.view?.getVisible?.() } : null;
  }

  close() {
    clearTimeout(this.timer);
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
  }
}
