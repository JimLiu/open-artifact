/**
 * The safety check of a slide's inline `<svg>`, read the way the page will read it.
 *
 * The page puts the drawing's source into the slide as markup, so the browser's HTML parser decides
 * what it holds, not the compiler's element tree. The two differ inside an svg: a `<style>` there holds
 * markup, not text, and an HTML tag such as `<img>` or `<p>` ends the svg and starts HTML. So the check
 * reads the source text itself, every tag it can find (inside comments and CDATA too), after decoding
 * character references the way a browser does. Anything it cannot vouch for is a problem: the drawing is
 * then dropped, never placed on the page.
 */
import { decodeEntities } from '@open-artifact/dc/html';

/** Elements a drawing may not hold: code, frames, foreign content, and HTML tags that end the svg. */
const FORBIDDEN_ELEMENTS = new Set([
  'script', 'foreignobject', 'iframe', 'embed', 'object', 'video', 'audio', 'discard', 'handler', 'listener',
  'prefetch', 'tref', 'cursor',
  // HTML that breaks out of the svg.
  'b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol', 'p', 'pre',
  'ruby', 's', 'small', 'span', 'strong', 'strike', 'sub', 'sup', 'table', 'tt', 'u', 'ul', 'var', 'font',
  'math', 'template', 'html', 'frame', 'frameset', 'form', 'input', 'button', 'link', 'base', 'noscript',
  'xmp', 'plaintext',
]);

/** Attributes that load or open something. `href` is handled apart (a local `#id` is fine). */
const RESOURCE_ATTRIBUTES = new Set([
  'src', 'srcset', 'srcdoc', 'data', 'action', 'formaction', 'poster', 'ping', 'codebase', 'background',
  'longdesc', 'manifest', 'cite', 'profile', 'usemap', 'dynsrc', 'lowsrc',
]);

const SMIL_ELEMENTS = new Set(['animate', 'set', 'animatemotion', 'animatetransform', 'animatecolor']);

/** A named reference the slide reader knows (`&amp;`, `&mdash;` …) as its character; undefined for any other name. */
function namedReference(name: string): string | undefined {
  const reference = `&${name};`;
  const decoded = decodeEntities(reference);
  return decoded === reference ? undefined : decoded;
}

/** Rules over the decoded text. */
const TEXT_RULES: [RegExp, string][] = [
  [/<script\b/i, 'holds a <script> — drawings never run code'],
  [/<foreignObject\b/i, 'holds <foreignObject> — not allowed'],
  [/(?:javascript|vbscript)\s*:/i, 'names javascript: — not allowed'],
  [/<!ENTITY|<!DOCTYPE/i, 'declares entities or a doctype — not allowed'],
  [/@import|(?:-webkit-)?image-set\s*\(|\bsrc\s*\(|cross-fade\s*\(/i, 'styles import or reference an external resource'],
  [/url\(\s*(?:["']\s*)?(?!#)/i, 'url() to anything but a local #id'],
];

/**
 * Decodes numeric references (with or without the `;`, as browsers do) and the names the slide reader knows.
 * Other named references stay as written, for {@link svgMarkupProblem} to refuse: a browser knows them all, and
 * some (`&colon;`, `&sol;`) would hide a scheme from this check.
 */
function decodeReferences(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(?:#x([0-9a-f]+);?|#(\d+);?|([a-z][a-z0-9]*);)/gi, (whole, hex?: string, dec?: string, name?: string) => {
    if (name !== undefined) return namedReference(name) ?? whole;
    const code = hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec!, 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '�';
    return String.fromCodePoint(code);
  });
}

/** CSS escapes (`\75 rl(`, `\@import`) read as the characters they stand for. */
function decodeCssEscapes(text: string): string {
  if (!text.includes('\\')) return text;
  return text.replace(/\\([0-9a-f]{1,6})\s?|\\([^\n0-9a-f])/gi, (_whole, hex?: string, char?: string) => {
    if (char !== undefined) return char;
    const code = Number.parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�';
  });
}

/** What the URL parser ignores: tab, line feed and carriage return anywhere, so `java&#9;script:` is `javascript:`. */
const IGNORED_BY_URLS = /[\t\n\r]/g;

interface Tag {
  closing: boolean;
  name: string;
  attrs: { name: string; value: string | null }[];
}

/** Reads the tag that starts at `<` (index `at`); null when `<` does not start one. `end` is past its `>`. */
function readTag(source: string, at: number): { tag: Tag; end: number } | null {
  const head = /^<(\/?)([a-zA-Z][^\s/>]*)/.exec(source.slice(at, at + 256));
  if (!head) return null;
  const tag: Tag = { closing: head[1] === '/', name: head[2]!.toLowerCase(), attrs: [] };
  let i = at + head[0].length;
  const length = source.length;
  while (i < length) {
    const ch = source[i]!;
    if (ch === '>') return { tag, end: i + 1 };
    if (/[\s/]/.test(ch)) {
      i++;
      continue;
    }
    // An attribute name runs to whitespace, `/`, `>` or `=` (a quote in a name stays part of it, as in HTML).
    let j = i + 1;
    while (j < length && !/[\s/>=]/.test(source[j]!)) j++;
    const name = source.slice(i, j);
    let k = j;
    while (k < length && /\s/.test(source[k]!)) k++;
    if (source[k] !== '=') {
      tag.attrs.push({ name, value: null });
      i = j;
      continue;
    }
    k++;
    while (k < length && /\s/.test(source[k]!)) k++;
    const quote = source[k];
    if (quote === '"' || quote === "'") {
      const close = source.indexOf(quote, k + 1);
      if (close < 0) return { tag, end: length };
      tag.attrs.push({ name, value: source.slice(k + 1, close) });
      i = close + 1;
    } else {
      let e = k;
      while (e < length && !/[\s>]/.test(source[e]!)) e++;
      tag.attrs.push({ name, value: source.slice(k, e) });
      i = e;
    }
  }
  return { tag, end: length };
}

/** The part after a namespace prefix (`xlink:href` → `href`), lowercased. */
const localName = (name: string): string => name.slice(name.lastIndexOf(':') + 1).toLowerCase();

/**
 * Why `markup` (one whole `<svg>…</svg>` as written in the slide) must not reach the page, or undefined when
 * it may. SMIL elements are allowed; one that targets an event handler or `href` is not.
 */
export function svgMarkupProblem(markup: string): string | undefined {
  const decoded = decodeReferences(markup);
  for (const text of [decoded, decoded.replace(IGNORED_BY_URLS, ''), decodeCssEscapes(decoded)]) {
    const rule = TEXT_RULES.find(([pattern]) => pattern.test(text));
    if (rule) return rule[1];
  }
  const named = /&[a-z][a-z0-9]{1,31};/i.exec(decoded);
  if (named) return `holds ${named[0]}, a named character this format does not read — write the character itself, or a number (&#160;)`;
  let depth = 0;
  let closed = false;
  for (let at = markup.indexOf('<'); at >= 0; at = markup.indexOf('<', at + 1)) {
    const read = readTag(markup, at);
    if (!read) continue;
    const { tag } = read;
    if (FORBIDDEN_ELEMENTS.has(tag.name)) return `holds <${tag.name}> — not allowed in a drawing`;
    if (tag.name === 'svg') {
      if (closed) return 'is not one <svg>…</svg> element';
      if (tag.closing) depth--;
      else if (markup[read.end - 2] !== '/') depth++;
      if (depth < 0) return 'is not one <svg>…</svg> element';
      if (depth === 0) closed = true;
    }
    if (!tag.closing) {
      for (const attr of tag.attrs) {
        const name = localName(attr.name);
        const value = decodeReferences(attr.value ?? '').replace(IGNORED_BY_URLS, '').trim();
        if (name.startsWith('on')) return `${attr.name}= — event handlers are not allowed`;
        if (RESOURCE_ATTRIBUTES.has(name)) return `${attr.name}= — drawings load nothing`;
        if (name === 'href' && attr.value !== null && !value.startsWith('#')) {
          return `${attr.name}="${value.slice(0, 60)}" — only local #id references`;
        }
        if (SMIL_ELEMENTS.has(tag.name) && name === 'attributename') {
          const target = localName(value);
          if (target === 'href' || target.startsWith('on')) return `<${tag.name} attributeName="${value.slice(0, 40)}"> — an animation may not set an event handler or a link`;
        }
      }
    }
    at = read.end - 1;
  }
  if (!closed || depth !== 0 || !/<\/svg\s*>\s*$/i.test(markup)) return 'is not one <svg>…</svg> element';
  return undefined;
}
