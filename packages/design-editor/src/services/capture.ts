/**
 * Copy as PNG / SVG / HTML: captures one rendered element of an artboard.
 *
 * SVG is a real vector drawing (dom-to-svg: boxes, text and images as SVG
 * shapes, no `<foreignObject>`), so it pastes into design tools. PNG captures
 * at 2×, using browser paint for CSS masks and SVG symbols. HTML copies the element
 * with its computed styles inlined (trimmed against browser defaults).
 *
 * `pageImage` (export-kit) draws a whole artboard (exports, and the canvas's
 * snapshots). Every picture carries the web fonts its document uses, inlined
 * (`embeddedFontCss`): a picture is drawn apart from the page and cannot
 * load them itself.
 */

import { blobToDataUrl, browserDrawing, captureHtml, cleanSvg, cssUrls, documentFonts, elementOutline, elementSvg, needsBrowserPaint, outlineReach, rasterize, SVG_NS } from '@open-artifact/export-kit';
import { canWriteClipboard, writeClipboard } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import { useView, type ElementSelection } from '../state/view.ts';
import { frameOf } from './frames.ts';
import { maybeSession } from './session.ts';

export type CaptureFormat = 'png' | 'svg' | 'html';

const TID_ATTRIBUTE = 'data-dc-tpl';
const MAX_HTML = 8 * 1024 * 1024;

/** Drawing a whole artboard and its standalone HTML live in export-kit (the Data editor's PDF uses them too). */
export { captureLimits, pageImage, standaloneHtml } from '@open-artifact/export-kit';

/** True when exactly one element or one artboard is selected. */
export function canCaptureSelection(): boolean {
  const { selection } = useView.getState();
  if (selection.kind === 'elements') return selection.items.length === 1;
  return selection.kind === 'objects' && selection.boards.length === 1 && selection.notes.length === 0;
}

/** True when the formats can go on the clipboard (by the browser, or the Shell framing the editor). */
export function canCopyAs(): boolean {
  return canWriteClipboard(maybeSession()?.shell);
}

/**
 * The rendered element of a selected template element (the clicked
 * instance; inside an SVG, its outermost `<svg>`). `descend` steps into
 * component boundaries, which render as `display: contents`; `svg` takes a
 * shape's outermost `<svg>`.
 */
export function liveElementOf(board: string, item: ElementSelection, { descend = true, svg = true } = {}): Element | null {
  const doc = frameOf(board)?.contentDocument;
  if (!doc) return null;
  const instances = doc.querySelectorAll(`[${TID_ATTRIBUTE}="${item.tid}"]`);
  let element: Element | null = instances[item.instance] ?? instances[0] ?? null;
  if (!element) return null;
  if (descend) while (element && element.ownerDocument.defaultView!.getComputedStyle(element).display === 'contents') element = element.firstElementChild;
  if (!element) return null;
  if (svg) for (let up = element.parentElement; up; up = up.parentElement) if (up.namespaceURI === SVG_NS && up.tagName.toLowerCase() === 'svg') element = up;
  return element;
}

/** The rendered element of the single selected element, or a selected artboard's page. */
function selectedLiveElement(): Element | null {
  const { selection } = useView.getState();
  // A whole artboard: its page.
  if (selection.kind === 'objects' && selection.boards.length === 1 && !selection.notes.length) return frameOf(selection.boards[0]!)?.contentDocument?.body ?? null;
  if (selection.kind !== 'elements' || selection.items.length !== 1) return null;
  return liveElementOf(selection.board, selection.items[0]!);
}

/** Runs a capture with the element's own placement transforms neutralised. */
async function withoutTransform<T>(element: Element, run: () => Promise<T>): Promise<T> {
  const style = (element as HTMLElement).style;
  if (!style) return run();
  const saved = ['transform', 'rotate', 'scale', 'translate'].map((name) => [name, style.getPropertyValue(name), style.getPropertyPriority(name)] as const);
  for (const [name] of saved) style.setProperty(name, 'none', 'important');
  try {
    return await run();
  } finally {
    for (const [name, value, priority] of saved) {
      if (value) style.setProperty(name, value, priority);
      else style.removeProperty(name);
    }
  }
}


/** How far an element's outline reaches past its box: a copy of the element grows by as much on each side. A whole artboard's page does not. */
function outlineRoom(element: Element): number {
  return element === element.ownerDocument.body ? 0 : outlineReach(elementOutline(element));
}

/** The element as SVG markup and its size (its outline included); with `fontCss`, carrying those fonts (a drawing that is rasterized). */
async function captureSvg(element: Element, fontCss?: string): Promise<{ svg: string; width: number; height: number }> {
  return withoutTransform(element, async () => {
    const rect = element.getBoundingClientRect();
    const room = outlineRoom(element);
    const area = { x: rect.x - room, y: rect.y - room, width: rect.width + room * 2, height: rect.height + room * 2 };
    const doc = await elementSvg(element, area, fontCss === undefined ? {} : { fontCss });
    const root = doc.documentElement;
    cleanSvg(root);
    root.setAttribute('width', String(Math.round(area.width * 100) / 100));
    root.setAttribute('height', String(Math.round(area.height * 100) / 100));
    for (const node of [...root.childNodes]) if (node.nodeType === Node.COMMENT_NODE) node.remove();
    return { svg: new XMLSerializer().serializeToString(doc), width: area.width, height: area.height };
  });
}


async function selectionPng(element: Element): Promise<Blob> {
  const fonts = await documentFonts(element.ownerDocument);
  if (needsBrowserPaint(element)) {
    try {
      return await withoutTransform(element, async () => {
        const { width, height } = element.getBoundingClientRect();
        const room = Math.ceil(outlineRoom(element));
        return rasterize(await browserDrawing(element, width, height, 0, fonts.css, undefined, room), width + room * 2, height + room * 2);
      });
    } catch { /* Fall back to native SVG shapes when foreignObject is unavailable. */ }
  }
  const { svg, width, height } = await captureSvg(element, fonts.css);
  if (width < 1 || height < 1) throw new Error('The element has no size.');
  return rasterize(svg, width, height);
}


/** The extension paints a centred SVG mask at its intrinsic size. Give fitted
 * masks that size in the asset itself, keeping the paths and the CSS mask. */
export async function captureFigmaHtml(element: Element): Promise<string> {
  const html = await captureHtml(element, 'figma');
  if (!html.includes('mask-image:')) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const node of template.content.querySelectorAll<HTMLElement>('[style*="mask-image:"]')) {
    const style = node.style;
    if (style.maskSize !== 'contain' || style.maskRepeat !== 'no-repeat' || style.maskPosition !== '50% 50%') continue;
    const urls = cssUrls(style.maskImage);
    if (urls.length !== 1 || !urls[0]!.url.startsWith('data:image/svg+xml')) continue;
    const w = parseFloat(style.width), h = parseFloat(style.height);
    if (!(w > 0 && h > 0) || !style.width.endsWith('px') || !style.height.endsWith('px')) continue;
    try {
      const data = await (await fetch(urls[0]!.url)).text();
      const svg = new DOMParser().parseFromString(data, 'image/svg+xml').documentElement;
      if (svg.localName !== 'svg') continue;
      const sw = svg.getAttribute('width'), sh = svg.getAttribute('height');
      if (!sw || !sh || !/^\d+(?:\.\d+)?(?:px)?$/.test(sw) || !/^\d+(?:\.\d+)?(?:px)?$/.test(sh)) continue;
      const intrinsicW = parseFloat(sw), intrinsicH = parseFloat(sh);
      if (!intrinsicH || Math.abs(intrinsicW / intrinsicH - w / h) > 0.0001) continue;
      if (!svg.hasAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${intrinsicW} ${intrinsicH}`);
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      const url = await blobToDataUrl(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
      style.maskImage = `url("${url}")`;
    } catch {
      // Leave any mask we cannot resize in its original embedded form.
    }
  }
  return template.innerHTML;
}

/* --------------------------------- command -------------------------------- */

let busy = false;

/** Copies the single selected element in a format. */
export async function copyAs(format: CaptureFormat): Promise<void> {
  if (busy) {
    toast.add({ title: 'Still copying…' });
    return;
  }
  const element = selectedLiveElement();
  if (!element) {
    toast.add({ title: `Select just one element to copy it as ${format.toUpperCase()}` });
    return;
  }
  if (!canCopyAs()) {
    toast.add({ title: 'This browser cannot copy images or markup to the clipboard.' });
    return;
  }
  busy = true;
  // Start the clipboard write on the press; the content can finish later. Where
  // the browser keeps the clipboard from the framed editor, the Shell writes it.
  const content: Promise<Blob | string> = format === 'png' ? selectionPng(element)
    : format === 'svg' ? captureSvg(element).then(({ svg }) => svg)
      : captureHtml(element).then((html) => {
        if (!html.trim()) throw new Error('The element is empty.');
        if (html.length > MAX_HTML) throw new Error('The element is too large to copy as HTML.');
        return html;
      });
  const as = (type: string): Promise<Blob> => {
    const blob = content.then((value) => (value instanceof Blob ? value : new Blob([value], { type })));
    blob.catch(() => undefined); // reported below, from `content`
    return blob;
  };
  const items: Record<string, Promise<Blob>> = format === 'png' ? { 'image/png': as('image/png') }
    : format === 'svg' ? { 'text/plain': as('text/plain'), ...(typeof ClipboardItem === 'undefined' || ClipboardItem.supports?.('image/svg+xml') ? { 'image/svg+xml': as('image/svg+xml') } : {}) }
      : { 'text/html': as('text/html'), 'text/plain': as('text/plain') };
  try {
    await writeClipboard(items, maybeSession()?.shell);
    toast.add({ title: `Copied as ${format.toUpperCase()}` });
  } catch (error) {
    // Say what went wrong with the content, rather than how the clipboard took it.
    const reason = await content.then(() => error, (failure: unknown) => failure);
    toast.add({ title: `Couldn’t copy as ${format.toUpperCase()}`, description: reason instanceof Error ? reason.message : String(reason) });
  } finally {
    busy = false;
  }
}
