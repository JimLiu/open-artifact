/**
 * The playground's own pages around the demos, for vite.config.ts:
 *
 * - `index.html` (the landing page) is a template: its `<!--demos-->` and `<!--mark-->` slots are filled with a card per
 *   demo, in the site's look (type colors, type icons and the mark come from `../site/src/`, so the two never drift).
 * - `<type>/index.html` is one real page per demo, so `/playground/<type>/` deep-links on any static host: the built
 *   `demo.html` with the demo named on `<html data-demo>` and the playground's root in `<meta name=playground-root>`.
 *   The dev and preview servers answer the same routes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_SRC = path.resolve(HERE, '..', 'site', 'src');

type Lang = 'en' | 'zh';
interface SiteType {
  id: string;
  name: string;
  colors: { wash: string; ink: string; tint: string };
  beta: boolean;
}
interface SiteData {
  types: SiteType[];
  typeIcon: (id: string, size: number) => string;
  mark: (size: number, cls: string) => string;
  favicon: string;
  icon: Record<string, (size: number) => string>;
}

/** What each demo holds, in both languages (the site's taglines describe the type, these describe the demo). */
const DEMO_LINES: Record<string, Record<Lang, string>> = {
  slides: { en: 'A two-slide deck: retype text, move things, add speaker notes.', zh: '一份两页的演示文稿：改文字、挪元素、写演讲者备注。' },
  design: { en: 'A launch card on a canvas, one artboard you can edit directly.', zh: '画布上的一张发布卡片，一个可以直接编辑的画板。' },
  'design-system': { en: 'Tokens, a text style and a Button component.', zh: '设计令牌、一个文字样式和一个按钮组件。' },
  whiteboard: { en: 'A board with one of every element kind: notes, shapes, connectors, frames.', zh: '一块白板，每种元素都有：便利贴、形状、连线、框架。' },
  sheets: { en: 'A sales workbook whose formulas the real Sheets engine (WebAssembly) works out in your browser.', zh: '一份销售工作簿，公式由真正的 Sheets 引擎（WebAssembly）在浏览器里计算。' },
  data: { en: 'A sales and signups dashboard from a saved snapshot and a CSV.', zh: '一个销售与注册看板，数据来自保存的快照和一个 CSV。' },
  docs: { en: 'A living doc with three tabs, run by the real Docs engine in your browser.', zh: '一份有三个标签页的文档，由真正的 Docs 引擎在浏览器里运行。' },
  motion: { en: 'A five-second film with two scenes and narration.', zh: '一段五秒的短片，两个场景，带旁白。' },
  page: { en: 'A packing checklist: a free HTML page with its own database.', zh: '一份行李清单：一个自带数据库的自由 HTML 页面。' },
};

let site: Promise<SiteData> | undefined;
/** The site's type list and icons (plain modules without imports). */
function siteData(): Promise<SiteData> {
  site ??= (async () => {
    const from = (rel: string): Promise<Record<string, unknown>> => import(pathToFileURL(path.join(SITE_SRC, rel)).href);
    const types = await from('data/types.mjs');
    const icons = await from('icons.mjs');
    return { types: types.TYPES, typeIcon: icons.typeIcon, mark: icons.mark, favicon: icons.FAVICON_SVG, icon: icons.icon } as SiteData;
  })();
  return site;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const both = (t: Record<Lang, string>): string => `<span data-l="en">${esc(t.en)}</span><span data-l="zh">${esc(t.zh)}</span>`;

/** The landing page's demo cards, in the site's type order. */
async function cards(demoTypes: string[]): Promise<string> {
  const { types, typeIcon, icon } = await siteData();
  const known = new Set(types.map((t) => t.id));
  const missing = demoTypes.filter((t) => !known.has(t));
  if (missing.length) throw new Error(`No site entry (../site/src/data/types.mjs) for demo type(s): ${missing.join(', ')}`);
  return types
    .filter((t) => demoTypes.includes(t.id))
    .map((t) => {
      const line = DEMO_LINES[t.id] ?? { en: `A ${t.name} artifact.`, zh: `一个 ${t.name} 产物。` };
      const style = `--tint:${t.colors.tint};--wash:${t.colors.wash};--ink:${t.colors.ink}`;
      return `<article class="type-card" style="${style}">
  <a class="type-card-main" href="./${t.id}/" data-demo-link="${t.id}">
    <span class="type-icon">${typeIcon(t.id, 22)}</span>
    <span class="type-card-name">${esc(t.name)}${t.beta ? `<span class="badge-beta">${both({ en: 'Beta', zh: 'Beta' })}</span>` : ''}</span>
    <span class="type-card-line">${both(line)}</span>
  </a>
  <div class="type-card-foot">
    <a class="type-about" href="../types/${t.id}/" data-site-href="types/${t.id}/">${both({ en: `About ${t.name}`, zh: `了解 ${t.name}` })}</a>
    <a class="type-try" href="./${t.id}/">${both({ en: 'Open demo', zh: '打开演示' })}${icon.arrow!(13)}</a>
  </div>
</article>`;
    })
    .join('\n');
}

/** Fills the landing page's slots (a no-op for every other page). */
export async function landingHtml(html: string, demoTypes: string[]): Promise<string> {
  if (!html.includes('<!--demos-->')) return html;
  const { mark, favicon } = await siteData();
  const icon = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(favicon.trim())}" />`;
  return html
    .replace('<!--demos-->', await cards(demoTypes))
    .replaceAll('<!--mark-->', mark(22, 'brand-mark'))
    .replace('<!--favicon-->', icon);
}

/**
 * A demo's own page from the Shell page (`demo.html`, built or dev): the demo on `<html data-demo>`, the root in the
 * meta tag, and, for a relative base, every `./` URL one folder up.
 */
export function demoPageHtml(html: string, type: string, base: string): string {
  const relative = !base.startsWith('/');
  let out = html.replace(/<html([^>]*)>/, `<html$1 data-demo="${esc(type)}">`);
  out = out.replace(/(<meta name="playground-root" content=")[^"]*(")/, `$1${relative ? '../' : base}$2`);
  if (relative) out = out.replace(/((?:src|href)=")\.\//g, '$1../');
  // The hint bar's links before its script runs: the landing page, and the site one folder above it.
  const root = relative ? '../' : base;
  const siteRoot = relative ? '../../' : path.posix.join(base, '..').replace(/\/?$/, '/');
  return out.replace(/(data-pg-href="" href=")[^"]*/, `$1${root}`).replace(/(data-pg-href="\.\.\/" href=")[^"]*/, `$1${siteRoot}`);
}

/** Writes `<type>/index.html` for every demo next to the built `demo.html`. */
export function writeDemoPages(outDir: string, demoTypes: string[], base: string): void {
  const html = fs.readFileSync(path.join(outDir, 'demo.html'), 'utf8');
  for (const type of demoTypes) {
    fs.mkdirSync(path.join(outDir, type), { recursive: true });
    fs.writeFileSync(path.join(outDir, type, 'index.html'), demoPageHtml(html, type, base));
  }
}
