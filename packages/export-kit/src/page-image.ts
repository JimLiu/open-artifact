/**
 * A rendered document as pictures: {@link pageImage} draws a document's
 * viewport (an artboard, a page of a long document), and {@link captureHtml}
 * rewrites an element as standalone HTML with its computed styles inlined,
 * which is what the browser is asked to paint through a `<foreignObject>`.
 *
 * The browser paints the computed HTML, which keeps what only it can draw:
 * shadows, filters, blending, masks, `::before`. Where the canvas cannot be
 * read back afterwards, and for a slice of a long page, dom-to-svg rebuilds
 * the page as SVG shapes instead. Every picture carries the web fonts its
 * document uses, inlined (`embeddedFontCss`): a picture is drawn apart from
 * the page and cannot load them itself.
 *
 * Needs a DOM. Shared by the Design editor (artboards) and the Data editor
 * (the dashboard's PDF).
 */

import { elementSvg, foreignObjectSvg, loadSvgImage, maxCaptureScale, SVG_NS, type CaptureLimits } from './capture.ts';
import { embeddedFontCss, type EmbeddedFonts } from './font-embed.ts';
import { cssUrls } from './fonts.ts';
import { blobToDataUrl } from './pictures.ts';

const PNG_SCALE = 2;
/** How large a capture may be: 12000 px a side, 120 megapixels. */
export const CAPTURE_LIMITS: CaptureLimits = { maxSide: 12000, maxPixels: 120_000_000 };

/** Web fonts inlined into one picture unless the caller sets its own limit, characters of `data:` URL. */
const FONT_BYTES = 64 * 1024 * 1024;

/** The web fonts a document's pictures carry; none when they cannot be read (the picture is still drawn, in fallback fonts). */
export const documentFonts = (doc: Document, maxBytes = FONT_BYTES): Promise<EmbeddedFonts> => embeddedFontCss(doc, { maxBytes }).catch(() => ({ css: '', skipped: [] }));

/* ----------------------------------- SVG ---------------------------------- */

/** Removes what the copy should not carry: scripts, handlers, debug data, external links. */
export function cleanSvg(root: Element): void {
  for (const node of [root, ...root.querySelectorAll('*')]) {
    if (/^(script|foreignObject)$/i.test(node.localName)) {
      node.remove();
      continue;
    }
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      const href = name === 'href' || name === 'xlink:href';
      if (name.startsWith('on') || name.startsWith('data-') || name === 'class' || (href && !(attr.value.startsWith('#') || (node.localName === 'image' && attr.value.startsWith('data:image/'))))) node.removeAttribute(attr.name);
    }
  }
  // Links become plain groups.
  for (const link of [...root.querySelectorAll('a')]) {
    const group = root.ownerDocument.createElementNS(SVG_NS, 'g');
    for (const attr of [...link.attributes]) group.setAttribute(attr.name, attr.value);
    group.append(...link.childNodes);
    link.replaceWith(group);
  }
  // Empty groups and styles (stacking layers with nothing in the captured area).
  for (const node of [...root.querySelectorAll('g, style')].reverse()) {
    if (!node.childNodes.length && !node.id) node.remove();
  }
  root.removeAttribute('aria-owns');
}

/** Figma's Chrome capture reads paint from the definition, losing the
 * currentColor inherited through a use. Specialise simple geometry symbols
 * per instance, keeping the original for other uses and referenced IDs. */
function portableSymbolPaints(source: Element, copy: SVGElement): void {
  const originals = source.querySelectorAll('use');
  for (const [i, use] of [...copy.querySelectorAll('use')].entries()) {
    const href = use.getAttribute('href') ?? use.getAttribute('xlink:href');
    if (!href?.startsWith('#')) continue;
    const symbol = copy.querySelector<SVGSymbolElement>('symbol#' + CSS.escape(href.slice(1)));
    if (!symbol || symbol.querySelector('[id], use') || !/currentcolor/i.test(symbol.outerHTML)) continue;
    const instance = symbol.cloneNode(true) as SVGSymbolElement;
    instance.id = 'export-symbol-' + crypto.getRandomValues(new Uint32Array(4)).join('-');
    const paint = source.ownerDocument.defaultView!.getComputedStyle(originals[i]!).color;
    for (const shape of [instance, ...instance.querySelectorAll<SVGElement>('*')]) {
      let color = paint;
      for (let ancestor: SVGElement | null = shape; ancestor; ancestor = ancestor.parentElement as SVGElement | null) {
        const own = ancestor.style.color || ancestor.getAttribute('color');
        if (own && !/^(currentcolor|inherit|unset)$/i.test(own)) { color = own; break; }
      }
      for (const name of ['fill', 'stroke']) {
        if ((shape.style.getPropertyValue(name) || shape.getAttribute(name))?.toLowerCase() === 'currentcolor') {
          shape.style.setProperty(name, color);
          shape.setAttribute(name, color);
        }
      }
    }
    symbol.after(instance);
    use.setAttribute('href', '#' + instance.id);
  }
}

/* ----------------------------------- PNG ---------------------------------- */

export interface RasterOptions {
  scale?: number;
  type?: 'image/png' | 'image/jpeg';
  /** Painted under the drawing (JPEG has no transparency). */
  background?: string;
  /** Only rows `[from, to)` (CSS px) keep the drawing; the rest is painted over with `background`. */
  keep?: { from: number; to: number };
}

export async function rasterize(svg: string, width: number, height: number, { scale = PNG_SCALE, type = 'image/png', background, keep }: RasterOptions = {}): Promise<Blob> {
  scale = Math.min(scale, maxCaptureScale(width, height, CAPTURE_LIMITS));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const image = await loadSvgImage(svg, { error: 'The drawing could not be rendered.', decoding: 'sync' });
  const context = canvas.getContext('2d')!;
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (keep) {
    context.fillStyle = background ?? '#ffffff';
    const k = canvas.height / height;
    const from = Math.max(0, Math.round(keep.from * k));
    const to = Math.min(canvas.height, Math.round(keep.to * k));
    if (from > 0) context.fillRect(0, 0, canvas.width, from);
    if (to < canvas.height) context.fillRect(0, to, canvas.width, canvas.height - to);
  }
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image is empty.'))), type, 0.92));
}

/** dom-to-svg cannot paint CSS masks or SVG use shadow trees. */
export function needsBrowserPaint(element: Element): boolean {
  const selector = 'svg use, [style*="mask"]';
  return element.matches(selector) || !!element.querySelector(selector) || [...element.ownerDocument.styleSheets].some(sheet => {
    try { return [...sheet.cssRules].some(rule => /mask(?:-image)?\s*:/.test(rule.cssText)); } catch { return false; }
  });
}

/**
 * False once this browser refused to read a canvas a `<foreignObject>` was
 * drawn on (Safari): browser paint is then tried only where nothing else
 * can draw the page.
 */
let paintReadable = true;

/** Paint the computed HTML, with embedded images and the fonts of `fontCss`, so shadows, masks and ::before survive. */
export async function browserDrawing(element: Element, width: number, height: number, top = 0, fontCss = '', html?: string): Promise<string> {
  const holder = document.createElement('div');
  holder.innerHTML = html ?? (await captureHtml(element, 'raster'));
  const root = holder.firstElementChild as HTMLElement | SVGElement | null;
  if (root && element !== element.ownerDocument.body) {
    Object.assign(root.style, { position: 'relative', inset: 'auto', margin: '0' });
  }
  holder.style.marginTop = `-${top}px`;
  // Laid out at the device pixels the element was measured at, so its text is as wide in the drawing.
  const zoom = element.ownerDocument.defaultView?.devicePixelRatio ?? 1;
  return foreignObjectSvg(new XMLSerializer().serializeToString(holder), fontCss, { width, height, zoom });
}

/**
 * A frame's page as an image: its viewport (`width` × `height` CSS pixels
 * from the top left) drawn at `scale`, on white.
 *
 * The browser paints it (the page's computed HTML through a
 * `<foreignObject>`), which keeps what only it can draw: shadows, filters,
 * blending, masks. Where the canvas cannot be read back afterwards, and for
 * a `slice` of a long page, dom-to-svg rebuilds the page as SVG shapes
 * instead. Both carry the page's web fonts; call this once they loaded.
 */
export async function pageImage(
  doc: Document,
  width: number,
  height: number,
  options: {
    scale: number;
    type?: 'image/png' | 'image/jpeg';
    /** Top of the captured area, CSS px from the document's top (the frame is never scrolled). */
    top?: number;
    /** Paper under the drawing (default white). */
    background?: string;
    /** Rows of the image that keep the drawing; the rest shows `background` (a PDF page's break margins). */
    keep?: { from: number; to: number };
    /**
     * One of many images of the same long page (a PDF's paper pages).
     * Browser paint lays the whole page out again for each one, pictures
     * and all, so a slice is rebuilt by dom-to-svg (which only visits what
     * the slice shows) unless the page has something only the browser draws.
     */
    slice?: boolean;
    /** Most web font data to inline, characters of `data:` URL (default 64 MB). */
    fontBytes?: number;
    /** Called with the font families left out: over `fontBytes`, or their files could not be read. */
    onSkippedFonts?: (families: string[]) => void;
    /**
     * Shared by the images of one unchanging document (the pages of a PDF): the document's standalone HTML is made
     * for the first image and kept here for the next ones, instead of reading every computed style again.
     */
    reuse?: { html?: string };
  },
): Promise<Blob> {
  const rasterOptions = { ...options, background: options.background ?? '#ffffff' };
  const fonts = await documentFonts(doc, options.fontBytes);
  if (fonts.skipped.length) options.onSkippedFonts?.(fonts.skipped);
  if (needsBrowserPaint(doc.body) || (paintReadable && !options.slice)) {
    try {
      const html = options.reuse?.html ?? (await captureHtml(doc.body, 'raster'));
      if (options.reuse) options.reuse.html = html;
      const svg = await browserDrawing(doc.body, width, height, options.top ?? 0, fonts.css, html);
      return await rasterize(svg, width, height, rasterOptions);
    } catch (error) {
      // Some browsers disallow reading a foreignObject canvas; a drawing that will not load is rebuilt as shapes too.
      if (error instanceof DOMException && error.name === 'SecurityError') paintReadable = false;
    }
  }
  const svgDoc = await elementSvg(doc.documentElement, { x: 0, y: options.top ?? 0, width, height }, { fontCss: fonts.css });
  const root = svgDoc.documentElement;
  cleanSvg(root);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  for (const node of [...root.childNodes]) if (node.nodeType === Node.COMMENT_NODE) node.remove();
  return rasterize(new XMLSerializer().serializeToString(svgDoc), width, height, rasterOptions);
}

/* ---------------------------------- HTML ---------------------------------- */

/** Properties children inherit: dropped when equal to the parent's. */
const INHERITED = new Set([
  'color', 'cursor', 'direction', 'font-family', 'font-feature-settings', 'font-kerning', 'font-size', 'font-stretch',
  'font-style', 'font-variant', 'font-variant-caps', 'font-variant-ligatures', 'font-variant-numeric', 'font-weight',
  'hyphens', 'letter-spacing', 'line-height', 'list-style-image', 'list-style-position', 'list-style-type', 'orphans',
  'quotes', 'tab-size', 'text-align', 'text-align-last', 'text-indent', 'text-rendering', 'text-shadow',
  'text-transform', 'visibility', 'white-space', 'white-space-collapse', 'text-wrap', 'text-wrap-mode', 'widows',
  'word-break', 'word-spacing', 'overflow-wrap', 'writing-mode', 'caret-color', '-webkit-text-fill-color',
  '-webkit-text-stroke-color', '-webkit-text-stroke-width', 'paint-order', 'fill', 'stroke', 'text-size-adjust',
  '-webkit-font-smoothing', 'border-collapse', 'border-spacing', 'empty-cells', 'caption-side',
]);

/** Shorthand-free duplicates (logical properties mirror physical ones). */
const SKIPPED = /^(inline-size|block-size|min-inline-size|min-block-size|max-inline-size|max-block-size|margin-(block|inline)|padding-(block|inline)|border-(block|inline)|inset-(block|inline)|border-(start|end)-|overflow-(block|inline)|contain-intrinsic|-webkit-(?!text-fill|text-stroke|font-smoothing)|transition|animation|will-change|view-transition|anchor|position-(try|anchor|visibility)|user-select|pointer-events|cursor|perspective-origin|transform-origin)/;

/**
 * What a stylesheet says about a shape or a label inside an `<svg>`, written on its copy (which has no stylesheet):
 * the paints, and the type a `<text>` is set in (a label a class makes smaller would be drawn at its parent's size,
 * wider than the room the chart left for it).
 */
const SVG_STYLED = [
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-rule', 'fill-opacity',
  'stroke-opacity', 'opacity', 'color', 'stop-color', 'stop-opacity', 'font-family', 'font-size', 'font-weight',
  'font-style', 'font-stretch', 'font-variant-numeric', 'letter-spacing', 'word-spacing', 'text-anchor',
  'dominant-baseline', 'visibility',
];

const KEPT_ATTRIBUTES = new Set(['alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'dir', 'lang', 'start', 'reversed', 'value', 'span']);
const DROPPED_TAGS = new Set(['script', 'style', 'link', 'meta', 'template', 'noscript', 'iframe', 'object', 'embed', 'audio', 'source', 'track']);

let defaultsFrame: HTMLIFrameElement | null = null;
const defaultsCache = new Map<string, Map<string, string>>();

/** Browser-default computed styles of a tag, from a blank frame. */
function defaultsOf(tag: string): Map<string, string> {
  const cached = defaultsCache.get(tag);
  if (cached) return cached;
  if (!defaultsFrame) {
    defaultsFrame = document.createElement('iframe');
    defaultsFrame.setAttribute('aria-hidden', 'true');
    defaultsFrame.style.cssText = 'position:fixed;left:-10000px;top:0;width:100px;height:100px;visibility:hidden;border:0';
    document.body.append(defaultsFrame);
  }
  const doc = defaultsFrame.contentDocument!;
  const probe = doc.createElement(tag);
  doc.body.append(probe);
  const style = defaultsFrame.contentWindow!.getComputedStyle(probe);
  const map = new Map<string, string>();
  for (const name of style) map.set(name, style.getPropertyValue(name));
  probe.remove();
  defaultsCache.set(tag, map);
  return map;
}

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (text: string) => escapeText(text).replace(/"/g, '&quot;');

/** A style value the copy can carry. */
const portable = (value: string) => !/var\(|env\(|attr\(/.test(value) && !/url\((?!\s*["']?data:image\/)/.test(value);

/** Fetches an image as a data URL (so the copy does not point at this server). */
async function dataUrl(url: string): Promise<string | null> {
  if (url.startsWith('data:')) return url;
  try {
    const blob = await (await fetch(url)).blob();
    if (!blob.type.startsWith('image/')) return null;
    return await blobToDataUrl(blob).catch(() => null);
  } catch {
    return null;
  }
}

export type CaptureHtmlMode = 'clipboard' | 'raster' | 'figma';

const IMAGE_TOKEN = /\u0000img:([\s\S]*?)\u0000/g;

/**
 * The element as standalone HTML with inline computed styles (trimmed
 * against browser defaults). Image sources come back as tokens, with the
 * set of sources they stand for.
 */
function standalone(element: Element, mode: CaptureHtmlMode = 'clipboard'): { html: string; images: Set<string> } {
  const keepPosition = mode !== 'clipboard';
  const view = element.ownerDocument.defaultView!;
  const images = new Set<string>();
  const imageToken = (src: string) => {
    images.add(src);
    return `\u0000img:${encodeURIComponent(src)}\u0000`;
  };

  const styleOf = (node: Element, tag: string, parent: CSSStyleDeclaration | null, root: boolean, pseudo?: string): string => {
    const computed = view.getComputedStyle(node, pseudo);
    const defaults = defaultsOf(tag);
    const out: string[] = [];
    for (const name of computed) {
      if (name.startsWith('--') || SKIPPED.test(name)) continue;
      let value = computed.getPropertyValue(name);
      if (!value) continue;
      if (keepPosition && value.includes('url(')) {
        for (const { match, url } of cssUrls(value)) {
          if (url.startsWith('data:') || url.startsWith('#')) continue;
          const resolved = new URL(url, node.baseURI);
          if (resolved.origin === location.origin || resolved.protocol === 'blob:') value = value.replace(match, () => `url('${imageToken(resolved.href)}')`);
        }
      }
      if (!portable(value.replace(IMAGE_TOKEN, 'data:image/embedded'))) continue;
      // A drawn side's width is always said: a side that is `solid` but 0 px wide (a reset's `border: 0 solid`)
      // computes to the default's 0 px, and left unsaid the copy would draw it `medium` wide.
      const drawnSide = /^(border-(?:top|right|bottom|left)|outline)-width$/.exec(name);
      const drawnWidth = drawnSide !== null && computed.getPropertyValue(`${drawnSide[1]}-style`) !== 'none';
      if (INHERITED.has(name) && parent) {
        if (parent.getPropertyValue(name) === value) continue;
      } else if (!drawnWidth && defaults.get(name) === value) continue;
      if (root && !keepPosition && /^(margin-|top$|left$|right$|bottom$|transform$|rotate$|scale$|translate$)/.test(name)) continue;
      // A side or outline that is not drawn needs no color or width.
      const side = /^(border-(?:top|right|bottom|left)|outline)-(?:color|width)$/.exec(name);
      if (side && computed.getPropertyValue(`${side[1]}-style`) === 'none') continue;
      out.push(`${name}: ${value}`);
    }
    if (root && !keepPosition) {
      if (computed.position === 'static' || computed.position === 'absolute' || computed.position === 'fixed') out.push('position: relative');
      out.push('margin: 0');
    }
    // Keep the rendered size of replaced and sized boxes.
    return out.filter((decl) => !(root && decl === 'position: static')).join('; ');
  };

  const walk = (node: Node, parent: CSSStyleDeclaration | null, root: boolean): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as Element;
    const computed = view.getComputedStyle(el);
    if (computed.display === 'none') return '';
    if (el.namespaceURI === SVG_NS) {
      const copy = el.cloneNode(true) as SVGElement;
      // A symbol is styled in the shadow tree of each <use>. Keep inherited
      // paints as currentColor so the same definition can serve different colours.
      const originals = [el, ...el.querySelectorAll('*')];
      const twins = [copy, ...copy.querySelectorAll<SVGElement>('*')];
      for (const [i, original] of originals.entries()) {
        const source = original as SVGElement;
        const styles = view.getComputedStyle(source);
        const inherited = source.parentElement && view.getComputedStyle(source.parentElement);
        for (const name of SVG_STYLED) {
          let value = styles.getPropertyValue(name);
          if (!value || (name !== 'opacity' && inherited?.getPropertyValue(name) === value)) continue;
          if ((name === 'fill' || name === 'stroke') && value === styles.color) {
            const color = source.style.getPropertyValue('color'), priority = source.style.getPropertyPriority('color');
            const probe = value === 'rgb(1, 2, 3)' ? 'rgb(3, 2, 1)' : 'rgb(1, 2, 3)';
            try {
              source.style.setProperty('color', probe, 'important');
              if (styles.getPropertyValue(name) === probe) value = 'currentColor';
            } finally {
              if (color) source.style.setProperty('color', color, priority);
              else source.style.removeProperty('color');
            }
          }
          twins[i]!.style.setProperty(name, value);
        }
      }
      if (mode === 'figma') portableSymbolPaints(el, copy);
      cleanSvg(copy);
      if (el.localName === 'svg') {
        copy.setAttribute('xmlns', SVG_NS);
        if (!root || keepPosition) copy.setAttribute('style', styleOf(el, 'svg', parent, false));
      }
      return new XMLSerializer().serializeToString(copy).replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
    }
    let tag = keepPosition && el.localName === 'body' ? 'div' : el.localName;
    if (DROPPED_TAGS.has(tag)) return '';
    if (computed.display === 'contents') return [...el.childNodes].map((child) => walk(child, parent, root)).join('');
    const pseudo = (name: string): string => {
      if (!keepPosition) return '';
      const css = view.getComputedStyle(el, name);
      const content = css.content;
      if (!content || content === 'none' || content === 'normal' || css.display === 'none') return '';
      const text = /^["'].*["']$/.test(content) ? content.slice(1, -1) : '';
      return `<span aria-hidden="true" style="${escapeAttr(styleOf(el, 'span', computed, false, name))}">${escapeText(text)}</span>`;
    };
    const children = () => pseudo('::before') + [...el.childNodes].map((child) => walk(child, computed, false)).join('') + pseudo('::after');
    let inner: string | null = null;
    let attrs = keepPosition && el.id ? ` id="${escapeAttr(el.id)}"` : '';
    switch (tag) {
      case 'input': {
        const input = el as HTMLInputElement;
        if (input.type === 'checkbox' || input.type === 'radio') {
          tag = 'span';
          inner = input.checked ? '☑' : '☐';
        } else {
          tag = 'span';
          inner = escapeText(input.value || input.placeholder);
        }
        break;
      }
      case 'textarea':
        tag = 'div';
        inner = escapeText((el as HTMLTextAreaElement).value || (el as HTMLTextAreaElement).placeholder);
        break;
      case 'select':
        tag = 'span';
        inner = escapeText((el as HTMLSelectElement).selectedOptions[0]?.text ?? '');
        break;
      case 'canvas':
        tag = 'img';
        try {
          attrs += ` src="${(el as HTMLCanvasElement).toDataURL('image/png')}"`;
        } catch {
          // Tainted canvas: an empty box of the same size.
          tag = 'div';
        }
        break;
      case 'video':
        tag = 'div';
        inner = '';
        break;
      case 'img': {
        const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src;
        if (src) attrs += ` src="${imageToken(src)}"`;
        break;
      }
      case 'a': {
        const href = el.getAttribute('href') ?? '';
        if (/^(https?:|mailto:|#)/i.test(href)) attrs += ` href="${escapeAttr(href)}"`;
        break;
      }
    }
    for (const attr of el.attributes) if (KEPT_ATTRIBUTES.has(attr.name) && !(tag !== el.localName && attr.name === 'value')) attrs += ` ${attr.name}="${escapeAttr(attr.value)}"`;
    // The language picks the fonts of Han text (and so how wide it is): the copy's root says the one it had from
    // an element above it (`<html lang>`), which the copy leaves behind.
    if (root && !el.hasAttribute('lang')) {
      const lang = el.parentElement?.closest('[lang]')?.getAttribute('lang');
      if (lang) attrs += ` lang="${escapeAttr(lang)}"`;
    }
    const style = styleOf(el, el.localName === tag ? tag : 'div', parent, root);
    if (style) attrs += ` style="${escapeAttr(style)}"`;
    if (tag === 'img' || tag === 'br' || tag === 'hr' || tag === 'wbr') return `<${tag}${attrs}>`;
    return `<${tag}${attrs}>${inner ?? children()}</${tag}>`;
  };

  // The root inherits from its real parent, so its own inherited values are kept unless default.
  return { html: walk(element, null, true), images };
}

/** The element as standalone HTML, images by URL (for a synchronous clipboard write). */
export function standaloneHtml(element: Element): string {
  return standalone(element).html.replace(IMAGE_TOKEN, (_m, encoded: string) => escapeAttr(decodeURIComponent(encoded)));
}

/** The element as standalone HTML, images inlined as data URLs. */
export async function captureHtml(element: Element, mode: CaptureHtmlMode = 'clipboard'): Promise<string> {
  const { html, images } = standalone(element, mode);
  const urls = new Map(await Promise.all([...images].map(async (src) => [src, await dataUrl(src)] as const)));
  return html.replace(IMAGE_TOKEN, (_m, encoded: string) => {
    const src = decodeURIComponent(encoded);
    return escapeAttr(urls.get(src) ?? src);
  });
}
