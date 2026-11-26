import { url, ghFile } from '../config.mjs';
import { t } from '../i18n.mjs';
import { esc } from '../markdown.mjs';
import { page, href } from '../layout.mjs';
import { icon, mark } from '../icons.mjs';
import { DOC_GROUPS } from '../data/docs-manifest.mjs';

const docRoute = (slug) => (slug ? `/docs/${slug}/` : '/docs/');

/**
 * @param {object} d  one prepared doc: { item, lang, title, titleHtml, html, toc, srcPath, fallback, meta, prev, next, labels }
 *   labels: slug -> { en, zh } sidebar label (already resolved from headings when the manifest has none)
 */
export function docPage(d) {
  const { item, lang } = d;
  const s = t(lang);
  const ds = s.docs;
  const route = docRoute(item.slug);

  const sidebar = DOC_GROUPS.map((g) => {
    const open = g.items.some((x) => x.slug === item.slug);
    const links = g.items
      .map((x) => {
        const cur = x.slug === item.slug ? ' aria-current="page"' : '';
        const label = d.labels[x.slug][lang];
        return `<li><a href="${href(lang, docRoute(x.slug))}"${cur}${x.mono ? ' class="mono"' : ''}>${esc(label)}</a></li>`;
      })
      .join('');
    return `<details class="nav-group"${open || g.id === 'start' ? ' open' : ''}><summary>${esc(g.title[lang])}</summary><ul>${links}</ul></details>`;
  }).join('');

  const toc = d.toc.length > 1
    ? `<nav class="toc" aria-label="${esc(ds.onThisPage)}"><p>${esc(ds.onThisPage)}</p><ul>${d.toc
        .map((h) => `<li class="d${h.depth}"><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`)
        .join('')}</ul></nav>`
    : '';

  const group = DOC_GROUPS.find((g) => g.id === item.group);
  const lead = d.meta && d.meta.description ? `<p class="doc-lead">${esc(d.meta.description)}</p>` : '';
  const agentsBox = item.slug === ''
    ? `<aside class="callout callout-agents">${mark(18)}<div><strong>${esc(ds.agentsBox)}</strong><p>${esc(ds.agentsBody)}</p><p class="callout-links"><a href="${url('llms.txt')}"><code>/llms.txt</code></a> <a href="${url('llms-full.txt')}"><code>/llms-full.txt</code></a> <a href="${href(lang, '/docs/agent-guide/')}">${esc(s.nav.agents)}${icon.arrow(12)}</a></p></div></aside>`
    : '';
  const fallback = d.fallback ? `<p class="callout callout-note">${esc(ds.fallback)}</p>` : '';
  const pn = (x, cls, label) =>
    x ? `<a class="pn ${cls}" href="${href(lang, docRoute(x.slug))}"><small>${esc(label)}</small><span>${esc(d.labels[x.slug][lang])}</span></a>` : '<span></span>';

  const body = `<div class="wrap docs-layout">
  <aside class="docs-sidebar">
    <details class="docs-nav-toggle" data-docs-nav>
      <summary>${icon.book(15)} ${esc(ds.title)}: ${esc(d.labels[item.slug][lang])}</summary>
      <nav class="docs-nav" aria-label="${esc(ds.title)}">${sidebar}</nav>
    </details>
  </aside>
  <article class="doc">
    <p class="crumbs"><a href="${href(lang, '/docs/')}">${esc(ds.title)}</a> / ${esc(group.title[lang])}</p>
    <h1 class="doc-title">${d.titleHtml || esc(d.title)}</h1>
    ${lead}
    ${fallback}
    ${agentsBox}
    <div class="prose">
${d.html}
    </div>
    <footer class="doc-foot">
      <p class="doc-source">
        <a href="${url('llms/' + d.srcPath)}">${icon.file(14)}${esc(ds.viewMarkdown)}</a>
        <a href="${ghFile(d.srcPath).replace('/blob/', '/edit/')}" rel="noopener">${icon.external(14)}${esc(ds.editOnGithub)}</a>
      </p>
      <nav class="prev-next">${pn(d.prev, 'prev', ds.prev)}${pn(d.next, 'next', ds.next)}</nav>
    </footer>
  </article>
  ${toc ? `<aside class="docs-toc">${toc}</aside>` : '<aside class="docs-toc"></aside>'}
</div>`;
  const title = item.slug === '' ? `${ds.title} · Open Artifact` : `${d.title} · Open Artifact`;
  return page({ lang, route, title, description: d.description, body, bodyClass: 'docs' });
}
