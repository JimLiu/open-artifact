/**
 * The home page's thumbnails.
 *
 * Shown: the page's `<img>` asks for `oa-thumbnail://artifact/<id>?v=<stamp>`, a scheme only the window's own session
 * answers (the artifact views are in another partition and never see it); this process fetches the daemon's thumbnail
 * with the token and hands back the bytes.
 *
 * Taken: the page's store decides which artifact needs a new picture (the package's own rule: its thumbnail is not of
 * its last change) and asks for it; this process loads the type's preview page in a window that is never shown
 * (offscreen rendering, its own in-memory partition with no permissions, nothing loaded but that page's origin), takes
 * a picture of the part that is the artifact (`captureRecipe`), and gives the page the JPEG to save. The page then
 * saves it with the version it was taken at.
 */
import { BrowserWindow, protocol, session as electronSession } from 'electron';
import { captureRecipe } from '@open-artifact/library-page/library';
import { httpish, subframeAllowed } from './navigation.mjs';
import { artifactIdOf } from './navigation.mjs';

export const THUMBNAIL_SCHEME = 'oa-thumbnail';
/** The picture windows' storage: nothing kept, nothing shared with the tabs. */
const CAPTURE_PARTITION = 'open-artifact-thumbnails';
/** The picture's width: twice a card's, for a Retina screen (as the DSH plugin takes them). */
const WIDTH = 720;
const QUALITY = 82;
const LOAD_MS = 20_000;
const SETTLE_MS = 1_800;
const BLANK_RETRY_MS = 3_000;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Before the app is ready: the scheme is a standard, secure one (an `<img>` of a file:// page may load it). */
export function registerThumbnailScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: THUMBNAIL_SCHEME, privileges: { standard: true, secure: true } }]);
}

/** The page's address for a thumbnail. */
export const thumbnailAddress = (id, version) => `${THUMBNAIL_SCHEME}://artifact/${encodeURIComponent(id)}?v=${encodeURIComponent(version ?? '')}`;

/** Answers the scheme on the window's session, from the daemon (`library.thumbnail`). */
export function serveThumbnails(library, log) {
  electronSession.defaultSession.protocol.handle(THUMBNAIL_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const id = url.hostname === 'artifact' ? artifactIdOf(decodeURIComponent(url.pathname.slice(1))) : null;
      if (!id) return new Response('not found', { status: 404 });
      const answer = await library.thumbnail(id, url.searchParams.get('v') ?? '');
      if (!answer.ok) return new Response('no thumbnail yet', { status: 404 });
      return new Response(await answer.arrayBuffer(), { headers: { 'content-type': 'image/jpeg', 'cache-control': answer.headers.get('cache-control') ?? 'no-store' } });
    } catch (error) {
      log(`thumbnail ${request.url}: ${error?.message ?? error}`);
      return new Response('unavailable', { status: 502 });
    }
  });
}

/** Whether every sampled pixel of a picture is the same color: a page that had not drawn yet. */
function isFlat(image) {
  const data = image.toBitmap();
  if (data.length < 8) return true;
  const step = Math.max(4, Math.floor(data.length / 4 / 400) * 4);
  for (let i = step; i + 2 < data.length; i += step) {
    if (Math.abs(data[i] - data[0]) > 3 || Math.abs(data[i + 1] - data[1]) > 3 || Math.abs(data[i + 2] - data[2]) > 3) return false;
  }
  return true;
}

/** The expression that measures the artifact's area; null until it has drawn (as the DSH plugin measures it). */
function measureScript(find) {
  return `(() => {
    const found = ${find};
    if (!found) return null;
    const r = found.getBoundingClientRect ? found.getBoundingClientRect() : found;
    if (r.width < 80 || r.height < 60) return null;
    const x = Math.max(0, r.x), y = Math.max(0, r.y);
    return { x, y, width: Math.min(r.width, innerWidth - x), height: Math.min(r.height, innerHeight - y) };
  })()`;
}

/** Takes pictures, one at a time, of preview pages. `allowlist`: the views' `OriginAllowlist`, for the page's frames. */
export class Photographer {
  constructor({ allowlist, log }) {
    Object.assign(this, { allowlist, log });
    this.busy = Promise.resolve();
    this.windows = new Set();
    const ses = electronSession.fromPartition(CAPTURE_PARTITION);
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
  }

  /** A JPEG of the preview page at `url` of an artifact of `type`. */
  take(url, type) {
    const run = this.busy.then(() => this.capture(url, type));
    this.busy = run.catch(() => undefined);
    return run;
  }

  async capture(url, type) {
    if (!httpish(url)) throw new Error('not a page address');
    const origin = new URL(url).origin;
    const recipe = captureRecipe(type);
    const window = new BrowserWindow({
      show: false,
      width: recipe.width,
      height: recipe.height,
      useContentSize: true,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        offscreen: true,
        partition: CAPTURE_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        backgroundThrottling: false,
      },
    });
    this.windows.add(window);
    const contents = window.webContents;
    try {
      contents.setAudioMuted(true);
      const sameOrigin = (address) => {
        try {
          return new URL(address).origin === origin;
        } catch {
          return false;
        }
      };
      contents.on('will-navigate', (event) => !sameOrigin(event.url) && event.preventDefault());
      contents.on('will-redirect', (event) => event.isMainFrame !== false && !sameOrigin(event.url) && event.preventDefault());
      contents.on('will-frame-navigate', (event) => {
        if (event.isMainFrame || sameOrigin(event.url) || subframeAllowed(event.url, this.allowlist)) return;
        event.preventDefault();
      });
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-attach-webview', (event) => event.preventDefault());
      contents.setFrameRate(15);

      await Promise.race([contents.loadURL(url).catch(() => undefined), sleep(LOAD_MS)]);
      const measure = measureScript(recipe.find);
      let rect = null;
      const deadline = Date.now() + LOAD_MS;
      while (rect === null && Date.now() < deadline) {
        rect = await contents.executeJavaScript(measure).catch(() => null);
        if (rect === null) await sleep(250);
        // A type without a recipe of its own is taken whole: there is nothing to wait for.
        if (recipe.find === 'null') break;
      }
      await contents.insertCSS('::-webkit-scrollbar{display:none!important}').catch(() => '');
      await contents.executeJavaScript('document.fonts.ready.then(() => true)').catch(() => null);
      await sleep(SETTLE_MS);
      rect = (await contents.executeJavaScript(measure).catch(() => null)) ?? rect;
      const area = rect ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : undefined;

      const shoot = async () => {
        const image = await contents.capturePage(area);
        if (image.isEmpty()) throw new Error('the page gave no picture');
        return image;
      };
      let image = await shoot();
      if (isFlat(image)) {
        await sleep(BLANK_RETRY_MS);
        image = await shoot();
      }
      const size = image.getSize();
      const scaled = size.width > WIDTH ? image.resize({ width: WIDTH, quality: 'best' }) : image;
      return new Uint8Array(scaled.toJPEG(QUALITY));
    } finally {
      this.windows.delete(window);
      if (!window.isDestroyed()) window.destroy();
    }
  }

  closeAll() {
    for (const window of this.windows) if (!window.isDestroyed()) window.destroy();
    this.windows.clear();
  }
}
