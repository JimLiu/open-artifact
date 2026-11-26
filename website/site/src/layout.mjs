// The page shell every route shares: <head>, header with nav and language toggle, footer.
import { url, routeFor, GITHUB, NPM, RELEASES, VERSION, SITE_URL, ghFile } from './config.mjs';
import { t } from './i18n.mjs';
import { esc } from './markdown.mjs';
import { mark, icon, GITHUB_ICON } from './icons.mjs';

/** Filled in by the build once the CSS/JS are hashed. */
export const ASSETS = { css: 'assets/site.css', js: 'assets/site.js' };

/** A link to a route in a language. */
export const href = (lang, route) => url(routeFor(lang, route));

const langSwitch = (lang, altHref) => {
  const s = t(lang);
  const other = lang === 'en' ? 'zh' : 'en';
  if (!altHref) return '';
  return `<a class="lang" href="${esc(altHref)}" hreflang="${other === 'zh' ? 'zh-CN' : 'en'}" lang="${other === 'zh' ? 'zh-CN' : 'en'}" data-lang-switch="${other}" title="${esc(s.otherLangLabel)}">${icon.globe(15)}<span>${esc(s.otherLang)}</span></a>`;
};

function header(lang, route, altHref) {
  const s = t(lang);
  const cur = (r) => (route === r || (r !== '/' && route.startsWith(r)) ? ' aria-current="page"' : '');
  return `<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="${href(lang, '/')}" aria-label="Open Artifact">${mark(22, 'brand-mark')}<span>Open Artifact</span></a>
    <nav class="main-nav" id="main-nav" aria-label="Main">
      <a href="${href(lang, '/types/')}"${cur('/types/')}>${esc(s.nav.types)}</a>
      <a href="${href(lang, '/docs/')}"${route.startsWith('/docs/') && !route.startsWith('/docs/agent-guide/') ? ' aria-current="page"' : ''}>${esc(s.nav.docs)}</a>
      <a href="${href(lang, '/install/')}"${cur('/install/')}>${esc(s.nav.install)}</a>
      <a href="${href(lang, '/docs/agent-guide/')}"${cur('/docs/agent-guide/')}>${esc(s.nav.agents)}</a>
      <a class="nav-gh" href="${GITHUB}" rel="noopener">${GITHUB_ICON(16)}<span>${esc(s.nav.github)}</span><span class="ver">v${esc(VERSION)}</span></a>
    </nav>
    <div class="header-tools">
      ${langSwitch(lang, altHref)}
      <button class="menu-btn" type="button" aria-controls="main-nav" aria-expanded="false" aria-label="${esc(s.nav.menu)}">${icon.menu(18)}</button>
    </div>
  </div>
</header>`;
}

function footer(lang) {
  const s = t(lang);
  const f = s.footer;
  const L = (r, label) => `<li><a href="${href(lang, r)}">${esc(label)}</a></li>`;
  const X = (u, label) => `<li><a href="${esc(u)}" rel="noopener">${esc(label)}</a></li>`;
  const zh = lang === 'zh';
  return `<footer class="site-footer">
  <div class="wrap footer-grid">
    <div class="footer-brand">
      <a class="brand" href="${href(lang, '/')}">${mark(22, 'brand-mark')}<span>Open Artifact</span></a>
      <p>${esc(f.tagline)}</p>
    </div>
    <div><h2>${esc(f.product)}</h2><ul>
      ${L('/types/', s.nav.types)}${L('/install/', s.nav.install)}<li><a href="${url('/playground/')}">${esc(s.tryLive)}</a></li>
    </ul></div>
    <div><h2>${esc(f.docs)}</h2><ul>
      ${L('/docs/overview/', zh ? '什么是 Open Artifact' : 'Overview')}${L('/docs/agent-guide/', s.nav.agents)}${L('/docs/hosting/', zh ? '自托管' : 'Self-hosting')}${L('/docs/integrating/', zh ? '接入 Agent 产品' : 'Integrating')}<li><a href="${url('/llms.txt')}">llms.txt</a></li>
    </ul></div>
    <div><h2>${esc(f.project)}</h2><ul>
      ${X(GITHUB, 'GitHub')}${X(NPM, 'npm')}${X(RELEASES, f.releases)}${X(ghFile('CHANGELOG.md'), f.changelog)}${X(ghFile('LICENSE'), f.license)}
    </ul></div>
  </div>
  <div class="wrap footer-base">
    <span>${esc(f.copyright)}</span>
    <span>${esc(f.license)} · ${esc(f.version)} ${esc(VERSION)}</span>
  </div>
</footer>`;
}

/**
 * A full HTML document.
 * @param {{lang:'en'|'zh', route:string, title:string, description?:string, body:string, alt?:string|null, bodyClass?:string, noindex?:boolean}} o
 *   route: the language-neutral route ("/docs/overview/"); alt: override (null for none) of the other-language href.
 */
export function page(o) {
  const { lang, route, title, body } = o;
  const s = t(lang);
  const other = lang === 'en' ? 'zh' : 'en';
  const altHref = o.alt === null ? null : o.alt ?? href(other, route);
  const description = o.description || s.siteDesc;
  const canon = SITE_URL ? SITE_URL + href(lang, route) : '';
  const alternates = o.alt === null ? '' : `
<link rel="alternate" hreflang="en" href="${esc((SITE_URL || '') + href('en', route))}">
<link rel="alternate" hreflang="zh-CN" href="${esc((SITE_URL || '') + href('zh', route))}">
<link rel="alternate" hreflang="x-default" href="${esc((SITE_URL || '') + href('en', route))}">`;
  return `<!doctype html>
<html lang="${s.htmlLang}" data-lang="${lang}"${altHref ? ` data-alt="${esc(altHref)}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1a1a19" media="(prefers-color-scheme: dark)">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Open Artifact">${canon ? `\n<link rel="canonical" href="${esc(canon)}">` : ''}${o.noindex ? '\n<meta name="robots" content="noindex">' : ''}${alternates}
<link rel="icon" href="${url('favicon.svg')}" type="image/svg+xml">
<link rel="icon" href="${url('favicon.ico')}" sizes="32x32">
<link rel="apple-touch-icon" href="${url('apple-touch-icon.png')}">
<link rel="alternate" type="text/plain" title="llms.txt" href="${url('llms.txt')}">
<link rel="stylesheet" href="${url(ASSETS.css)}">
<script>(function(){var d=document.documentElement;d.classList.add('js');try{var p=localStorage.getItem('oa-lang'),a=d.getAttribute('data-alt');if(p&&a&&p!==d.getAttribute('data-lang'))location.replace(a+location.hash)}catch(e){}})()</script>
<script src="${url(ASSETS.js)}" defer></script>
</head>
<body class="${esc(o.bodyClass || '')}">
<a class="skip" href="#main">${esc(s.skip)}</a>
${header(lang, route, altHref)}
<main id="main">
${body}
</main>
${footer(lang)}
</body>
</html>
`;
}
