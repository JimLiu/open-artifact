/**
 * The dashboard as a PDF file, made in the page (no print dialog): a copy of `#dash-root` is laid out in a hidden
 * frame as it prints (the page's `@media print` rules, the light look, the data note under it), cut into paper pages
 * between lines and at `break-before: page`, and each page is drawn as a picture with its words as invisible,
 * selectable text and its web links over it.
 *
 * The copy is as wide as the dashboard shows now (a chart a script sized in pixels fits as it does on screen), never
 * narrower than the paper, and the sheet is scaled to it: upright for a narrow dashboard, on its side for a wide one
 * ({@link pdfPageLayout}).
 *
 * The copy is static: the page's scripts don't run in it. `beforeprint` and `afterprint` are sent to the live page
 * around the copying, so a page that prepares itself for printing is copied prepared.
 */

import {
  CAPTURE_LIMITS,
  PAPER,
  documentBackground,
  documentBands,
  documentBoxes,
  documentHeight,
  documentKeepBlocks,
  documentLinks,
  documentPageBreaks,
  documentWords,
  flowPagesWithBreaks,
  groupLines,
  maxCaptureScale,
  pageImage,
  pageLinks,
  pageRuns,
  type Paper,
} from '@open-artifact/export-kit';
import { buildPdf, PT_PER_PX, type PdfPage } from '@open-artifact/wasm-export';
import { emulatePrintMedia } from './print-media.ts';
import { PRINT_NOTE_ATTRIBUTE } from './print-note.ts';
import { PRINT_CSS, PRINT_PATH_ATTRIBUTE } from './print.ts';

/** Most pages one dashboard exports to; what lies past them is left out. */
export const MAX_PDF_PAGES = 100;
/**
 * Up to this many pages the browser paints each one (shadows, gradients, filters, every chart as drawn). A longer
 * document is rebuilt as shapes page by page instead, which only visits what a page shows.
 */
const BROWSER_PAINT_PAGES = 16;
/** The tallest box (a card) kept on one page, in page heights. */
const MAX_WHOLE_BOX = 0.6;
const FRAME_LOAD_TIMEOUT_MS = 10_000;
const SETTLE_TIMEOUT_MS = 5000;

/** Marks the hidden frame the copy is laid out in, while an export runs. */
export const PRINT_COPY_ATTRIBUTE = 'data-dash-print-copy';

/** Regions whose everyday paper is US Letter; everywhere else it is A4. */
const LETTER_REGIONS = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'CR', 'GT', 'PA', 'DO', 'PR']);

/** The paper a reader in `locale` prints on. */
export function paperForLocale(locale: string | undefined): Paper {
  if (!locale) return 'a4';
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return region !== undefined && LETTER_REGIONS.has(region) ? 'letter' : 'a4';
  } catch {
    return 'a4';
  }
}

/** A dashboard wider than this many papers is laid out on a sheet turned on its side. */
const LANDSCAPE_FROM = 1.2;
/** The widest copy, in widths of the sheet: past it the text would print too small to read, so the rest is cut off. */
const MAX_WIDTH_IN_SHEETS = 2;
/** The most pixels across a page's picture (300 per inch of US Letter). */
const MAX_PICTURE_WIDTH = 2550;

/** How the copy is laid out and what sheet each page is. */
export interface PdfPageLayout {
  /** The copy's width and one page's height, CSS px. */
  width: number;
  height: number;
  /** The sheet, in points. */
  pointWidth: number;
  pointHeight: number;
  landscape: boolean;
}

/**
 * The layout for a dashboard `shownWidth` px wide on `paper`: laid out at its own width, at least one paper wide, on
 * an upright sheet, or one on its side when it is wider than {@link LANDSCAPE_FROM} papers.
 */
export function pdfPageLayout(shownWidth: number, paper: Paper): PdfPageLayout {
  const upright = PAPER[paper];
  const shown = Number.isFinite(shownWidth) ? Math.ceil(shownWidth) : 0;
  const landscape = shown > upright.width * LANDSCAPE_FROM;
  const sheet = landscape ? { width: upright.height, height: upright.width } : upright;
  const width = Math.min(Math.max(shown, upright.width), sheet.width * MAX_WIDTH_IN_SHEETS);
  return {
    width,
    height: Math.round((width * sheet.height) / sheet.width),
    pointWidth: sheet.width * PT_PER_PX,
    pointHeight: sheet.height * PT_PER_PX,
    landscape,
  };
}

/**
 * The copy never animates: an entrance animation would start over in it and be drawn part-way. With no duration an
 * animation that keeps its last frame shows it, and a transition is already at its end.
 */
const STILL_CSS = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;scroll-behavior:auto!important}';

function copyAttributes(from: Element, to: Element): void {
  for (const attribute of from.attributes) {
    try {
      to.setAttribute(attribute.name, attribute.value);
    } catch {
      // A name the copy's document refuses is left out.
    }
  }
}

function ruleText(sheet: CSSStyleSheet): string | null {
  try {
    return [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
  } catch {
    return null;
  }
}

/** The live document's stylesheets, in order, into the copy's head. Resolves once the linked ones loaded (or failed). */
function copyStyleSheets(from: Document, to: Document): Promise<void> {
  const loads: Promise<void>[] = [];
  const addText = (text: string, media: string): void => {
    const style = to.createElement('style');
    if (media) style.media = media;
    style.textContent = text;
    to.head.append(style);
  };
  for (const sheet of from.styleSheets) {
    const owner = sheet.ownerNode;
    if (owner instanceof HTMLLinkElement && owner.href) {
      // A linked sheet keeps its own address, which its relative `url(…)`s resolve against.
      const link = to.createElement('link');
      link.rel = 'stylesheet';
      if (owner.media) link.media = owner.media;
      if (owner.crossOrigin !== null) link.crossOrigin = owner.crossOrigin;
      loads.push(
        new Promise((resolve) => {
          link.addEventListener('load', () => resolve(), { once: true });
          link.addEventListener('error', () => resolve(), { once: true });
        }),
      );
      link.href = owner.href;
      to.head.append(link);
      continue;
    }
    // The rules as they are now (a page may have added some by script), else the element's text.
    const text = ruleText(sheet) ?? (owner instanceof Element ? owner.textContent : null);
    if (text) addText(text, sheet.media.mediaText);
  }
  for (const sheet of from.adoptedStyleSheets ?? []) {
    const text = ruleText(sheet);
    if (text) addText(text, sheet.media.mediaText);
  }
  return Promise.all(loads).then(() => undefined);
}

/** What the markup doesn't say: the drawings on canvases and what form fields hold now. */
function copyLiveState(live: Element, copy: Element): void {
  const originals = [live, ...live.querySelectorAll('*')];
  const twins = [copy, ...copy.querySelectorAll('*')];
  for (const [index, original] of originals.entries()) {
    const twin = twins[index];
    if (twin === undefined || twin.localName !== original.localName) continue;
    if (original instanceof HTMLCanvasElement) {
      try {
        (twin as HTMLCanvasElement).getContext('2d')?.drawImage(original, 0, 0);
      } catch {
        // A canvas that can't be read stays an empty box of its size.
      }
    } else if (original instanceof HTMLInputElement) {
      if (original.type === 'checkbox' || original.type === 'radio') twin.toggleAttribute('checked', original.checked);
      else if (original.type !== 'file' && original.type !== 'password') twin.setAttribute('value', original.value);
    } else if (original instanceof HTMLTextAreaElement) twin.textContent = original.value;
    else if (original instanceof HTMLOptionElement) twin.toggleAttribute('selected', original.selected);
    // A picture below the first page would never load lazily in a frame that isn't scrolled.
    else if (original instanceof HTMLImageElement) twin.removeAttribute('loading');
  }
  for (const script of [...copy.querySelectorAll('script')]) script.remove();
}

/**
 * Copies the page element into the frame's document under copies of the elements that hold it (so the rules that
 * reach it through them still do), with the data note beside it, all marked as the print path. Returns the copy.
 */
function copyPrintPath(root: HTMLElement, doc: Document): Element {
  const path: Element[] = [];
  for (let element: Element | null = root; element !== null; element = element.parentElement) path.unshift(element);
  const html = path[0];
  const body = path[1];
  if (html === undefined || body === undefined || path.length < 3) throw new Error('The dashboard isn’t showing yet.');
  copyAttributes(html, doc.documentElement);
  copyAttributes(body, doc.body);
  doc.documentElement.setAttribute(PRINT_PATH_ATTRIBUTE, '');
  doc.body.setAttribute(PRINT_PATH_ATTRIBUTE, '');
  let holder: Element = doc.body;
  let copied: Element = doc.body;
  for (let depth = 2; depth < path.length; depth++) {
    const live = path[depth]!;
    for (const child of path[depth - 1]!.children) {
      if (child === live) {
        copied = doc.importNode(live, live === root);
        copied.setAttribute(PRINT_PATH_ATTRIBUTE, '');
        holder.append(copied);
      } else if (child.hasAttribute(PRINT_NOTE_ATTRIBUTE)) holder.append(doc.importNode(child, true));
    }
    holder = copied;
  }
  copyLiveState(root, copied);
  return copied;
}

const nextFrame = (view: Window): Promise<void> => new Promise((resolve) => view.requestAnimationFrame(() => resolve()));
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for the copy's fonts and pictures (at most five seconds), then two frames of rendering. */
async function settle(doc: Document): Promise<void> {
  const pictures = [...doc.images]
    .filter((image) => !image.complete)
    .map(
      (image) =>
        new Promise<void>((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        }),
    );
  await Promise.race([Promise.all([doc.fonts?.ready, ...pictures]), wait(SETTLE_TIMEOUT_MS)]);
  const view = doc.defaultView;
  // Frames aren't promised to a hidden frame: a timer stands in for one that doesn't come.
  if (view) await Promise.race([nextFrame(view).then(() => nextFrame(view)), wait(250)]);
  await wait(60);
}

/**
 * Paper doesn't scroll: a box of the copy that scrolls up and down (a long table in a short card) is let grow to
 * all it holds, as far as its own height was what cut it. Returns whether anything changed.
 */
function growScrollers(doc: Document): boolean {
  const view = doc.defaultView;
  if (!view) return false;
  let grew = false;
  for (const element of doc.body.querySelectorAll<HTMLElement>('*')) {
    if (!(element.scrollHeight > element.clientHeight + 1) || element.clientHeight === 0) continue;
    const overflow = view.getComputedStyle(element).overflowY;
    if (overflow !== 'auto' && overflow !== 'scroll') continue;
    element.style.setProperty('height', 'auto', 'important');
    element.style.setProperty('max-height', 'none', 'important');
    element.style.setProperty('flex-shrink', '0', 'important');
    grew = true;
  }
  return grew;
}

/** Tells the live page a print starts and ends (some pages lay themselves out for it), around `run`. */
function aroundPrintEvents<T>(run: () => T): T {
  window.dispatchEvent(new Event('beforeprint'));
  try {
    return run();
  } finally {
    window.dispatchEvent(new Event('afterprint'));
  }
}

/**
 * Runs `capture` on a copy of the page element laid out as it prints, `size.width` px wide, in a hidden frame whose
 * viewport is one page. The frame is removed afterwards.
 */
export async function withPrintCopy<T>(root: HTMLElement, size: { width: number; height: number }, capture: (doc: Document) => Promise<T>): Promise<T> {
  const live = root.ownerDocument;
  const iframe = live.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('data-uncommentable', '');
  iframe.setAttribute(PRINT_COPY_ATTRIBUTE, '');
  iframe.tabIndex = -1;
  // In the viewport (browsers pause frames far off screen), but invisible.
  Object.assign(iframe.style, { position: 'fixed', left: '0', top: '0', width: `${size.width}px`, height: `${size.height}px`, border: '0', opacity: '0', pointerEvents: 'none', zIndex: '-1' });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The page took too long to lay out.')), FRAME_LOAD_TIMEOUT_MS);
      iframe.addEventListener(
        'load',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      // Standards mode, as the page itself is laid out.
      iframe.srcdoc = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
      live.body.append(iframe);
    });
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('The page can’t be laid out here.');
    const base = doc.createElement('base');
    base.href = live.baseURI;
    doc.head.append(base);
    const sheets = copyStyleSheets(live, doc);
    const own = doc.createElement('style');
    own.textContent = PRINT_CSS + STILL_CSS;
    doc.head.append(own);
    aroundPrintEvents(() => copyPrintPath(root, doc));
    await Promise.race([sheets, wait(SETTLE_TIMEOUT_MS)]);
    emulatePrintMedia(doc);
    await settle(doc);
    if (growScrollers(doc)) await settle(doc);
    return await capture(doc);
  } finally {
    iframe.remove();
  }
}

export interface DashboardPdfOptions {
  root: HTMLElement;
  title: string;
  paper?: Paper;
  /** Called with the font families the pictures could not carry (their text is drawn in a fallback font). */
  onSkippedFonts?: (families: string[]) => void;
}

/** The pages of the dashboard, measured and drawn from its print copy. */
export async function dashboardPdfPages({ root, title, paper = paperForLocale(globalThis.navigator?.language), onSkippedFonts }: DashboardPdfOptions): Promise<PdfPage[]> {
  const layout = pdfPageLayout(root.getBoundingClientRect().width, paper);
  const { width, height } = layout;
  const ptPerPx = layout.pointWidth / width;
  return withPrintCopy(root, { width, height }, async (doc) => {
    const lines = groupLines(documentWords(doc));
    const links = documentLinks(doc);
    // A card stays on one page while it is at most this tall; a taller one is cut between its lines.
    const boxes = documentBoxes(doc, height * MAX_WHOLE_BOX);
    const slices = flowPagesWithBreaks(
      { contentHeight: Math.max(height, documentHeight(doc)), bands: [...documentBands(doc), ...boxes], blocks: documentKeepBlocks(doc) },
      height,
      documentPageBreaks(doc),
      MAX_PDF_PAGES,
    );
    const background = documentBackground(doc);
    const scale = Math.min(2, MAX_PICTURE_WIDTH / width, maxCaptureScale(width, height, CAPTURE_LIMITS));
    const reuse: { html?: string } = {};
    const pages: PdfPage[] = [];
    for (const [index, slice] of slices.entries()) {
      const jpeg = await pageImage(doc, width, height, {
        scale,
        type: 'image/jpeg',
        top: slice.top - slice.offset,
        background,
        keep: { from: slice.offset, to: slice.offset + slice.bottom - slice.top },
        slice: slices.length > BROWSER_PAINT_PAGES,
        reuse,
        ...(onSkippedFonts ? { onSkippedFonts } : {}),
      });
      pages.push({
        jpeg,
        pixelWidth: Math.max(1, Math.round(width * scale)),
        pixelHeight: Math.max(1, Math.round(height * scale)),
        width: layout.pointWidth,
        height: layout.pointHeight,
        text: pageRuns(lines, slice, width, ptPerPx),
        links: pageLinks(links, slice, width, ptPerPx),
        ...(index === 0 ? { bookmark: title } : {}),
      });
    }
    return pages;
  });
}

/** The dashboard as the bytes of a PDF. */
export async function buildDashboardPdf(options: DashboardPdfOptions): Promise<Blob> {
  const bytes = await buildPdf(await dashboardPdfPages(options), { title: options.title });
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}
