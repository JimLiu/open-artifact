// Build the static site into dist/: every page prerendered (EN at /, 简体中文 at /zh/), the docs rendered from the
// repo's own markdown (read in place, never copied into this folder), raw markdown under /llms/ and /llms.txt.
//
//   node scripts/build.mjs            full build (cleans dist/)
//   SITE_BASE=/open-artifact/ ...     serve under a sub-path (GitHub Pages project site)
//   SITE_URL=https://example.org ...  absolute URLs in canonical links, llms.txt and sitemap.xml
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm, cp, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { SITE_DIR, REPO_DIR, OUT_DIR, SITE_URL, VERSION, url, ghFile } from '../src/config.mjs';
import { ASSETS, href } from '../src/layout.mjs';
import { renderMarkdown, stripTags } from '../src/markdown.mjs';
import { FAVICON_SVG } from '../src/icons.mjs';
import { LANGS, t } from '../src/i18n.mjs';
import { DOC_GROUPS, DOC_ITEMS } from '../src/data/docs-manifest.mjs';
import { SHOWCASE_ORDER } from '../src/data/types.mjs';
import { homePage } from '../src/pages/home.mjs';
import { typesIndexPage, typePage } from '../src/pages/types.mjs';
import { installPage, notFoundPage } from '../src/pages/install.mjs';
import { docPage } from '../src/pages/docs.mjs';

const posix = path.posix;
const zhPath = (p) => p.replace(/\.md$/, '.zh-CN.md');
const enPath = (p) => p.replace(/\.zh-CN\.md$/, '.md');
const repoFile = (rel) => path.join(REPO_DIR, rel);
const readRepo = (rel) => readFile(repoFile(rel), 'utf8');

async function walkMd(relDir) {
  const out = [];
  const abs = repoFile(relDir);
  if (!existsSync(abs)) return out;
  for (const e of await readdir(abs, { withFileTypes: true })) {
    const rel = posix.join(relDir, e.name);
    if (e.isDirectory()) out.push(...(await walkMd(rel)));
    else if (e.name.endsWith('.md')) out.push(rel);
  }
  return out.sort();
}

/** Every markdown file served raw under /llms/<repo path>. */
async function mirrorSet() {
  const set = new Set();
  for (const it of DOC_ITEMS) {
    set.add(it.src);
    if (existsSync(repoFile(zhPath(it.src)))) set.add(zhPath(it.src));
  }
  for (const id of SHOWCASE_ORDER) {
    for (const f of await walkMd(`artifact-types/${id}/reference`)) set.add(f);
    for (const f of await walkMd(`artifact-types/${id}/artifact-type/reference`)) set.add(f);
  }
  return set;
}

const routeBySrc = new Map(DOC_ITEMS.map((it) => [it.src, it.slug ? `/docs/${it.slug}/` : '/docs/']));

/** Where a relative link in a repo markdown file should point on the site. */
function makeResolver(fromFile, lang, mirror, mode, { fallback = false } = {}) {
  return (raw) => {
    if (!raw || /^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(raw)) return raw;
    const [p, ...rest] = raw.split('#');
    const hash = rest.length ? '#' + rest.join('#') : '';
    if (!p) return raw;
    let target = posix.normalize(posix.join(posix.dirname(fromFile), decodeURI(p)));
    if (target.startsWith('..')) return raw;
    target = target.replace(/\/$/, '');
    if (mode === 'html') {
      const route = routeBySrc.get(enPath(target));
      // An English page shown under /zh/ keeps English anchors, which only the English page has.
      if (route) return href(fallback && hash ? 'en' : lang, route) + hash;
    }
    if (mirror.has(target)) return mode === 'raw' ? raw : url('llms/' + target) + hash;
    const abs = repoFile(target);
    const isDir = existsSync(abs) && statSync(abs).isDirectory();
    return ghFile(target, { tree: isDir }) + hash;
  };
}

/** Rewrite markdown links in a raw copy: links inside the mirror stay relative, the rest go to GitHub. */
function rewriteRaw(src, fromFile, mirror) {
  const resolve = makeResolver(fromFile, 'en', mirror, 'raw');
  let fence = false;
  return src
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fence = !fence;
        return line;
      }
      if (fence) return line;
      return line
        .replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (_, h, title) => `](${resolve(h)}${title})`)
        .replace(/^(\s*\[[^\]]+\]:\s+)(\S+)/, (_, a, h) => a + resolve(h));
    })
    .join('\n');
}

const firstSentence = (html) => {
  const m = /<p>([\s\S]*?)<\/p>/.exec(html);
  if (!m) return '';
  const text = stripTags(m[1]).replace(/\s+/g, ' ').trim();
  return text.length > 180 ? text.slice(0, 177).replace(/\s+\S*$/, '') + '…' : text;
};

async function write(rel, content) {
  const file = path.join(OUT_DIR, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}
const writeRoute = (lang, route, html) => {
  const r = (lang === 'zh' ? '/zh' : '') + route;
  return write(r.endsWith('/') ? r + 'index.html' : r, html);
};

/** An .ico holding one PNG (Vista+ ICO may carry PNG data). */
function pngToIco(png, size) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  head.writeUInt8(size >= 256 ? 0 : size, 6);
  head.writeUInt8(size >= 256 ? 0 : size, 7);
  head.writeUInt8(0, 8);
  head.writeUInt8(0, 9);
  head.writeUInt16LE(1, 10);
  head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}

async function assets() {
  for (const [key, name] of [['css', 'site.css'], ['js', 'site.js']]) {
    const src = await readFile(path.join(SITE_DIR, 'src/assets', name));
    const hash = createHash('sha256').update(src).digest('hex').slice(0, 10);
    const [base, ext] = name.split('.');
    ASSETS[key] = `assets/${base}.${hash}.${ext}`;
    await write(ASSETS[key], src);
  }
  const pub = path.join(SITE_DIR, 'public');
  if (existsSync(pub)) await cp(pub, OUT_DIR, { recursive: true });
  await write('favicon.svg', FAVICON_SVG);
  const png32 = path.join(pub, 'favicon-32.png');
  if (existsSync(png32)) await write('favicon.ico', pngToIco(await readFile(png32), 32));
  await write('.nojekyll', '');
}

async function docs(mirror) {
  // Render every doc in both languages first, so sidebar labels can come from headings.
  const rendered = [];
  const labels = {};
  for (const item of DOC_ITEMS) {
    labels[item.slug] = {};
    for (const lang of LANGS) {
      const zh = zhPath(item.src);
      const useZh = lang === 'zh' && existsSync(repoFile(zh));
      const srcPath = useZh ? zh : item.src;
      const src = await readRepo(srcPath);
      const out = renderMarkdown(src, { resolveLink: makeResolver(srcPath, lang, mirror, 'html', { fallback: lang === 'zh' && !useZh }), copyLabel: t(lang).copy });
      labels[item.slug][lang] = item.label ? item.label[lang] : out.title;
      rendered.push({ item, lang, srcPath, fallback: lang === 'zh' && !useZh, ...out, description: out.meta.description || firstSentence(out.html) });
    }
  }
  for (const d of rendered) {
    const i = DOC_ITEMS.findIndex((x) => x.slug === d.item.slug);
    d.prev = DOC_ITEMS[i - 1] || null;
    d.next = DOC_ITEMS[i + 1] || null;
    d.labels = labels;
    await writeRoute(d.lang, d.item.slug ? `/docs/${d.item.slug}/` : '/docs/', docPage(d));
  }
  return { rendered, labels };
}

async function llms(mirror, { rendered, labels }) {
  for (const rel of mirror) await write(posix.join('llms', rel), rewriteRaw(await readRepo(rel), rel, mirror));

  const abs = (rel) => (SITE_URL || '') + url(rel);
  const en = new Map(rendered.filter((d) => d.lang === 'en').map((d) => [d.item.slug, d]));
  const entry = (it) => {
    const d = en.get(it.slug);
    const desc = d.description ? `: ${d.description}` : '';
    return `- [${labels[it.slug].en}](${abs('llms/' + it.src)})${desc}`;
  };
  const lines = [
    '# Open Artifact',
    '',
    `> ${t('en').home.pitch} An agent writes a plain folder of files (a slide deck, a UI design, a design system, a whiteboard, a spreadsheet, a data dashboard, a doc, a short animated film or a free HTML page); a local daemon opens it in a real editor where people edit, comment and export, and "Send to agent" returns their comments to the agent's session.`,
    '',
    `Version ${VERSION}. Source: https://github.com/JimLiu/open-artifact (Apache-2.0). Everything runs locally: no account, no upload, no specific model or vendor.`,
    '',
    `Every link below is raw Markdown, served under ${url('llms/')} at its path in the repository, so relative links between these files work. A Chinese version, where one exists, has the same path ending in .zh-CN.md. The HTML site mirrors these pages at ${abs('docs/')} (English) and ${abs('zh/docs/')} (简体中文). ${abs('llms-full.txt')} has the main English docs in one file.`,
    '',
  ];
  for (const g of DOC_GROUPS) {
    lines.push(`## ${g.title.en}`, '');
    for (const it of g.items) lines.push(entry(it));
    if (g.id === 'agents') {
      lines.push('', '### Type references', '');
      for (const rel of [...mirror].filter((r) => r.startsWith('artifact-types/') && r.includes('/reference/')).sort()) {
        lines.push(`- [${rel.replace(/^artifact-types\//, '').replace(/\.md$/, '')}](${abs('llms/' + rel)})`);
      }
    }
    lines.push('');
  }
  lines.push('## Optional', '');
  for (const it of DOC_ITEMS) {
    const zh = zhPath(it.src);
    if (mirror.has(zh)) lines.push(`- [${labels[it.slug].zh}（简体中文）](${abs('llms/' + zh)})`);
  }
  lines.push('');
  await write('llms.txt', lines.join('\n'));

  const full = [];
  for (const g of DOC_GROUPS) {
    for (const it of g.items) {
      if (it.src.startsWith('artifact-types/')) continue;
      full.push(`<!-- ${abs('llms/' + it.src)} -->\n\n` + rewriteRaw(await readRepo(it.src), it.src, new Set()).trim());
    }
  }
  await write('llms-full.txt', `# Open Artifact documentation (English, v${VERSION})\n\n` + full.join('\n\n---\n\n') + '\n');
}

async function meta(routes) {
  const robots = ['User-agent: *', 'Allow: /', ''];
  if (SITE_URL) {
    robots.push(`Sitemap: ${SITE_URL}${url('sitemap.xml')}`, '');
    const items = routes
      .map((r) => `  <url><loc>${SITE_URL}${href('en', r)}</loc><xhtml:link rel="alternate" hreflang="en" href="${SITE_URL}${href('en', r)}"/><xhtml:link rel="alternate" hreflang="zh-CN" href="${SITE_URL}${href('zh', r)}"/></url>\n  <url><loc>${SITE_URL}${href('zh', r)}</loc></url>`)
      .join('\n');
    await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${items}\n</urlset>\n`);
  }
  await write('robots.txt', robots.join('\n'));
}

export async function build({ clean = true } = {}) {
  const t0 = Date.now();
  if (clean) await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  await assets();

  const routes = ['/', '/types/', '/install/', ...SHOWCASE_ORDER.map((id) => `/types/${id}/`)];
  for (const lang of LANGS) {
    await writeRoute(lang, '/', homePage(lang));
    await writeRoute(lang, '/types/', typesIndexPage(lang));
    for (const id of SHOWCASE_ORDER) await writeRoute(lang, `/types/${id}/`, typePage(id, lang));
    await writeRoute(lang, '/install/', installPage(lang));
  }
  await write('404.html', notFoundPage('en'));

  const mirror = await mirrorSet();
  const docsOut = await docs(mirror);
  await llms(mirror, docsOut);
  await meta([...routes, ...DOC_ITEMS.map((it) => (it.slug ? `/docs/${it.slug}/` : '/docs/'))]);

  const pages = routes.length * 2 + DOC_ITEMS.length * 2 + 1;
  console.log(`built ${pages} pages, ${mirror.size} raw markdown files into ${path.relative(process.cwd(), OUT_DIR) || OUT_DIR} in ${Date.now() - t0} ms`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  build({ clean: !process.argv.includes('--no-clean') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
