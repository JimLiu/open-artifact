/**
 * The page's thumbnails: a real picture of each artifact, taken from its own editor. The desktop app's right sidebar
 * Browser is an Electron `<webview>` on a lease the app's preload hands out (`dshDesktop.browser`); the page takes one
 * the same way, loads the editor in it out of sight, and takes a picture of the part of the page that is the artifact
 * (types.ts says which), without the editor's toolbars.
 *
 * Only the desktop app has this. Elsewhere (`dsh web`) {@link desktopBrowser} is undefined and the cards keep the drawn
 * picture of their type.
 */
import { captureRecipe } from '@open-artifact/library-page/library';

/** What the app's preload exposes for a Browser guest (`window.dshDesktop.browser`). */
export interface DesktopBrowser {
  acquire(workspace: string): Promise<{ lease: string; partition: string }>;
  release(lease: string): Promise<void>;
}

/** What an Electron NativeImage offers the page: `toPNG`, `toJPEG` and `toBitmap` need a Buffer, which the page has none of. */
interface NativeImageLike {
  isEmpty(): boolean;
  toDataURL(): string;
}

interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>;
  setAudioMuted(muted: boolean): void;
  insertCSS(css: string): Promise<string>;
  executeJavaScript(code: string): Promise<unknown>;
  capturePage(rect?: Rect): Promise<NativeImageLike>;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The desktop app's Browser guests, when the page runs in it. */
export function desktopBrowser(): DesktopBrowser | undefined {
  const carrier = (globalThis as { dshDesktop?: { protocolVersion?: number; browser?: DesktopBrowser } }).dshDesktop;
  return carrier?.protocolVersion === 1 ? carrier.browser : undefined;
}

/**
 * The storage the guests share. The app gives each such name its own partition for as long as it runs, so a thumbnail's
 * page shares nothing with the Browser tab a person has an artifact open in.
 */
const WORKSPACE = 'open-artifact-thumbnails';
/** The picture's width: twice a card's, for a Retina screen. */
const WIDTH = 720;
const QUALITY = 0.82;
/** How long a page has to show its artifact. */
const LOAD_MS = 20_000;
/** After it shows: its fonts, its images. */
const SETTLE_MS = 1_800;
/** A picture of one flat color is a page that had not drawn yet: it gets this much longer, once. */
const BLANK_RETRY_MS = 3_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason as Error);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });

/** A picture at the thumbnail's width, on a canvas. */
async function toCanvas(image: NativeImageLike): Promise<HTMLCanvasElement> {
  const picture = new Image();
  await new Promise<void>((resolve, reject) => {
    picture.onload = () => resolve();
    picture.onerror = () => reject(new Error('the picture did not decode'));
    picture.src = image.toDataURL();
  });
  const scale = Math.min(1, WIDTH / picture.naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('no canvas to draw on');
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Whether every sampled pixel is the same color. */
function isFlat(canvas: HTMLCanvasElement): boolean {
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  const step = Math.max(4, Math.floor(data.length / 4 / 400) * 4);
  for (let i = step; i + 2 < data.length; i += step) {
    if (Math.abs(data[i]! - data[0]!) > 3 || Math.abs(data[i + 1]! - data[1]!) > 3 || Math.abs(data[i + 2]! - data[2]!) > 3) return false;
  }
  return true;
}

/** The expression that measures the artifact's area in the page's own pixels; `null` until it has drawn. */
export function measureScript(find: string): string {
  return `(() => {
    const found = ${find};
    if (!found) return null;
    const r = found.getBoundingClientRect ? found.getBoundingClientRect() : found;
    if (r.width < 80 || r.height < 60) return null;
    const x = Math.max(0, r.x), y = Math.max(0, r.y);
    return { x, y, width: Math.min(r.width, innerWidth - x), height: Math.min(r.height, innerHeight - y) };
  })()`;
}

/** The page's picture, as a JPEG. The guest has to be in the window to be drawn at all, so one pixel of it is. */
export async function captureThumbnail(browser: DesktopBrowser, url: string, type: string, signal: AbortSignal): Promise<Uint8Array> {
  const recipe = captureRecipe(type);
  const { lease, partition } = await browser.acquire(WORKSPACE);
  const guest = document.createElement('webview') as WebviewElement;
  try {
    // The attributes the app's main process checks before it lets a guest attach: the lease's name and partition.
    guest.setAttribute('name', lease);
    guest.setAttribute('partition', partition);
    guest.setAttribute('src', `about:blank#${lease}`);
    guest.setAttribute('aria-hidden', 'true');
    guest.tabIndex = -1;
    guest.style.cssText = `position:fixed;left:calc(100vw - 1px);top:0;width:${recipe.width}px;height:${recipe.height}px;opacity:.01;pointer-events:none;z-index:-1`;
    const ready = new Promise<void>((resolve) => guest.addEventListener('dom-ready', () => resolve(), { once: true }));
    document.body.append(guest);
    await Promise.race([ready, sleep(LOAD_MS, signal)]);
    guest.setAudioMuted(true);
    const loaded = new Promise<void>((resolve) => guest.addEventListener('did-stop-loading', () => resolve(), { once: true }));
    void guest.loadURL(url).catch(() => undefined);
    await Promise.race([loaded, sleep(LOAD_MS, signal)]);

    const measure = measureScript(recipe.find);
    let rect: Rect | null = null;
    const deadline = Date.now() + LOAD_MS;
    while (rect === null && Date.now() < deadline) {
      rect = (await guest.executeJavaScript(measure).catch(() => null)) as Rect | null;
      if (rect === null) await sleep(250, signal);
    }
    await guest.insertCSS('::-webkit-scrollbar{display:none!important}').catch(() => '');
    await guest.executeJavaScript('document.fonts.ready.then(() => true)').catch(() => null);
    await sleep(SETTLE_MS, signal);
    // A board settles into place as its fonts land: measure again.
    rect = ((await guest.executeJavaScript(measure).catch(() => null)) as Rect | null) ?? rect;
    const area = rect && { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };

    const take = async () => {
      const image = await guest.capturePage(area ?? undefined);
      if (image.isEmpty()) throw new Error('the page gave no picture');
      return toCanvas(image);
    };
    let canvas = await take();
    if (isFlat(canvas)) {
      await sleep(BLANK_RETRY_MS, signal);
      canvas = await take();
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (blob === null) throw new Error('the picture did not encode');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    guest.remove();
    await browser.release(lease).catch(() => undefined);
  }
}
