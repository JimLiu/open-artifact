/**
 * Cleaning HTML pasted from outside the editor before it goes into a
 * template: no scripts, frames, event handlers, unsafe URLs or template
 * syntax (holes, components, structure tags).
 */

import { escapeAttribute, escapeText, parseHtml, RAW_TEXT_ELEMENTS, VOID_ELEMENTS, type HtmlNode } from '@open-artifact/dc';

/** Removed with their content. */
const DROPPED = new Set([
  'script', 'style', 'link', 'meta', 'base', 'iframe', 'frame', 'frameset', 'portal', 'embed', 'object', 'applet',
  'noembed', 'noscript', 'noframes', 'plaintext', 'xmp', 'template', 'foreignobject', 'math', 'annotation-xml',
  'head', 'title', 'x-import', 'dc-import', 'helmet', 'sc-helmet', 'sc-for', 'sc-if', 'x-dc', 'html',
]);

/** Kept as their children only. */
const UNWRAPPED = new Set(['body', 'html']);

const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'poster', 'data', 'cite', 'background', 'xlink:href', 'formaction', 'longdesc', 'usemap']);
const DROPPED_ATTRIBUTES = new Set(['srcdoc', 'contenteditable', 'formaction', 'ping', 'is', 'data-dc-script']);
const UNSAFE_VALUE = /<script|data-dc-script|<x-dc|<!--/i;
const MAX_STYLE = 8192;

/** True for a URL the template may keep. */
function safeUrl(value: string, name: string, tag: string): boolean {
  const url = value.trim().replace(/[\u0000-\u001f\s]+/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (!scheme) return true;
  if (['http', 'https', 'mailto', 'tel'].includes(scheme)) return true;
  if (scheme === 'data') return /^data:image\//i.test(url) && (name === 'src' || name === 'poster' || (tag === 'image' && /href$/.test(name)));
  return false;
}

/** Keeps the safe declarations of a style attribute. */
function cleanStyle(value: string): string | null {
  if (value.length > MAX_STYLE) return null;
  const kept = value
    .split(';')
    .map((decl) => decl.trim())
    .filter((decl) => decl && decl.includes(':') && !/[<>{}\\]|\/\*|expression\(|-moz-binding|behavior\s*:|javascript:|@/i.test(decl));
  return kept.length ? kept.join('; ') : null;
}

/** Breaks `{{` so text can never become a template hole. */
const noHoles = (text: string) => text.replace(/\{\{/g, '{​{').replace(/\}\}/g, '}​}');

function serialize(nodes: readonly HtmlNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'comment') continue;
    if (node.type === 'text') {
      out += escapeText(noHoles(node.value));
      continue;
    }
    const tag = node.tag;
    if (DROPPED.has(tag) && !UNWRAPPED.has(tag)) continue;
    if (UNWRAPPED.has(tag) || tag.includes(':')) {
      out += serialize(node.children);
      continue;
    }
    if (node.attrs.some((attr) => attr.name.toLowerCase() === 'is')) continue;
    let start = `<${tag}`;
    for (const attr of node.attrs) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name.startsWith('sc-') || name.startsWith('hint-') || DROPPED_ATTRIBUTES.has(name)) continue;
      let value = attr.value;
      if (value !== null) {
        if (UNSAFE_VALUE.test(value)) continue;
        if (URL_ATTRIBUTES.has(name) && !safeUrl(value, name, tag)) continue;
        if (name === 'srcset' && !value.split(',').every((entry) => safeUrl(entry.trim().split(/\s+/)[0] ?? '', 'src', tag))) continue;
        if (name === 'style') {
          value = cleanStyle(value);
          if (value === null) continue;
        }
        value = noHoles(value);
      }
      start += value === null ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`;
    }
    start += '>';
    if (VOID_ELEMENTS.has(tag)) {
      out += start;
      continue;
    }
    const inner = RAW_TEXT_ELEMENTS.has(tag) ? escapeText(noHoles(node.children.map((child) => (child.type === 'text' ? child.value : '')).join(''))) : serialize(node.children);
    out += `${start}${inner}</${tag}>`;
  }
  return out;
}

/** Sanitized markup of an HTML fragment. */
export function sanitizeHtml(html: string): string {
  return serialize(parseHtml(html)).trim();
}

/** True when pasted plain text looks like markup rather than prose. */
export function looksLikeHtml(text: string): boolean {
  return /^\s*<[a-z!][\s\S]*>\s*$/i.test(text);
}

/** Past this many line breaks a pasted text keeps them with `white-space: pre-line` instead of `<br>`s. */
const MAX_BREAKS = 500;

/**
 * Plain text as paragraphs (a blank line starts the next one). Its `{{`
 * is broken with `<wbr>`, so pasted text never reads as a binding.
 */
export function textParagraphs(text: string): string {
  const escape = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{\{/g, '{<wbr>{');
  const blocks = text.trim().split(/\n{2,}/);
  const breaks = blocks.reduce((sum, block) => sum + (block.match(/\n/g)?.length ?? 0), 0);
  if (breaks > MAX_BREAKS) return blocks.map((block) => `<p style="margin: 0; white-space: pre-line">${escape(block)}</p>`).join('\n');
  return blocks.map((block) => `<p style="margin: 0">${escape(block).replace(/\n/g, '<br>')}</p>`).join('\n');
}
