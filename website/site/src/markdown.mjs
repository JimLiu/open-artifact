// Build-time markdown: marked (GFM) + highlight.js, GitHub-style heading ids, links rewritten by the caller.
import { Marked } from 'marked';
import hljs from 'highlight.js/lib/common';
import { icon } from './icons.mjs';

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export const stripTags = (html) => decode(String(html).replace(/<[^>]+>/g, ''));

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens. */
export function slugger() {
  const seen = new Map();
  return (text) => {
    let base = text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
      .replace(/\s/g, '-');
    if (!base) base = 'section';
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

/** Split YAML-ish front matter (name, description) off a SKILL.md. */
export function frontMatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let [, k, v] = kv;
    if (v === '>-' || v === '>' || v === '|' || v === '') {
      const parts = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) parts.push(lines[++i].trim());
      v = parts.join(' ');
    }
    meta[k] = v.replace(/^["']|["']$/g, '');
  }
  return { meta, body: src.slice(m[0].length) };
}

/** The "[中文](x.zh-CN.md) · [All artifact types](…)" line under each doc's title: the site has its own toggle. */
const isLangLine = (t) => t.type === 'paragraph' && /^\s*\[(中文|English|英文|简体中文)\]\([^)]*\)/.test(t.raw);

export const highlight = (code, lang) => {
  const l = (lang || '').toLowerCase().split(/\s/)[0];
  const alias = { sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', jsonc: 'json', json5: 'json', mjs: 'javascript', js: 'javascript', ts: 'typescript', tsx: 'typescript', yml: 'yaml', html: 'xml' };
  const name = alias[l] || l;
  if (name && name !== 'text' && name !== 'plaintext' && hljs.getLanguage(name)) {
    try {
      return { html: hljs.highlight(code, { language: name, ignoreIllegals: true }).value, lang: name };
    } catch {}
  }
  return { html: esc(code), lang: l || 'text' };
};

export const codeBlock = (code, lang, { copyLabel = 'Copy' } = {}) => {
  const h = highlight(code, lang);
  return `<div class="code" data-lang="${esc(h.lang)}"><button class="copy" type="button" aria-label="${esc(copyLabel)}" title="${esc(copyLabel)}">${icon.copy(14)}</button><pre><code class="hljs language-${esc(h.lang)}">${h.html}</code></pre></div>`;
};

/**
 * Render one markdown file.
 * @param {string} src markdown source
 * @param {{ resolveLink: (href: string) => string, copyLabel?: string }} opts
 * @returns {{ html: string, title: string, titleHtml: string, toc: {depth:number,id:string,text:string}[], meta: object }}
 */
export function renderMarkdown(src, { resolveLink, copyLabel }) {
  const { meta, body } = frontMatter(src);
  const slug = slugger();
  const toc = [];
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = stripTags(inner);
        const id = slug(text);
        if (depth === 2 || depth === 3) toc.push({ depth, id, text });
        return `<h${depth} id="${esc(id)}"><a class="anchor" href="#${esc(id)}" aria-hidden="true" tabindex="-1">#</a>${inner}</h${depth}>\n`;
      },
      code({ text, lang }) {
        return codeBlock(text, lang, { copyLabel });
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const ext = /^https?:\/\//.test(href);
        return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}${ext ? ' rel="noopener"' : ''}>${inner}</a>`;
      },
    },
  });

  const tokens = md.lexer(body);
  md.walkTokens(tokens, (token) => {
    if (token.type === 'link' && token.href) token.href = resolveLink(token.href);
  });
  // Pull the first H1 out as the page title, and drop the language-switch line under it.
  let titleHtml = '';
  const h1 = tokens.findIndex((t) => t.type === 'heading' && t.depth === 1);
  if (h1 !== -1 && h1 < 3) {
    titleHtml = md.parseInline(tokens[h1].text);
    tokens.splice(h1, 1);
  }
  for (let i = 0; i < Math.min(tokens.length, 4); i++) {
    if (isLangLine(tokens[i])) {
      tokens.splice(i, 1);
      break;
    }
  }
  let html = md.parser(tokens);
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  return { html, titleHtml, title: stripTags(titleHtml) || meta.name || '', toc, meta };
}
