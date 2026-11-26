import { RELEASES, GITHUB } from '../config.mjs';
import { t } from '../i18n.mjs';
import { esc } from '../markdown.mjs';
import { page, href } from '../layout.mjs';
import { icon } from '../icons.mjs';
import { APPS, appName } from '../data/apps.mjs';
import { installTabs, cmd } from '../components.mjs';
import { PROMPTS } from './home.mjs';

export function installPage(lang) {
  const s = t(lang);
  const i = s.install;
  const rows = APPS.map(
    (a) => `<tr><th scope="row"><a href="${esc(a.guide)}" rel="noopener">${esc(appName(a, lang))}</a><small>${esc(a.sub[lang])}</small></th><td>${a.steps[lang].map(esc).join(' ')}${a.code ? `<code class="block">${esc(a.code)}</code>` : ''}</td></tr>`,
  ).join('');
  const body = `<section class="page-head"><div class="wrap">
  <h1>${esc(i.title)}</h1>
  <p class="section-lead">${esc(i.lead)}</p>
</div></section>

<section class="section section-tight"><div class="wrap install-steps">
  <ol class="big-steps">
    <li>
      <h2>${esc(i.req)}</h2>
      <p>${esc(i.reqBody)}</p>
    </li>
    <li>
      <h2>${esc(i.step1)}</h2>
      <p>${esc(i.step1Body)}</p>
      <p><a class="btn btn-primary btn-sm" href="${RELEASES}" rel="noopener">${icon.export(14)}${esc(s.home.downloadZip)}</a></p>
    </li>
    <li>
      <h2>${esc(i.step2)}</h2>
      ${installTabs(lang, 'page')}
    </li>
    <li>
      <h2>${esc(i.step3)}</h2>
      <p>${esc(i.step3Body)}</p>
      <div class="prompts">${cmd(PROMPTS[lang].join('\n'), lang, 'text')}</div>
      <p class="muted">${esc(i.showArtifact)}</p>
    </li>
  </ol>
</div></section>

<section class="band"><div class="wrap">
  <h2 class="section-title">${esc(i.table)}</h2>
  <div class="table-wrap"><table class="apps-table">
    <thead><tr><th>${esc(i.app)}</th><th>${esc(i.how)}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</div></section>

<section class="section"><div class="wrap split">
  <div>
    <h2 class="section-title">${esc(i.upgrade)}</h2>
    <p>${esc(i.upgradeBody)}</p>
  </div>
  <div>
    <h2 class="section-title">${esc(i.source)}</h2>
    <p>${esc(i.sourceBody)}</p>
    ${cmd(`git clone ${GITHUB}.git\ncd open-artifact\nnpm ci\nnpm run build\nnode scripts/build-plugins.mjs   # dist/plugins/ stands in for the extracted ZIP`, lang)}
  </div>
</div></section>`;
  return page({ lang, route: '/install/', title: `${i.title} · Open Artifact`, body });
}

export function notFoundPage(lang) {
  const n = t(lang).notFound;
  const en = t('en').notFound;
  const zh = t('zh').notFound;
  // One 404.html serves every path, so it says it in both languages.
  const body = `<section class="not-found"><div class="wrap">
  <p class="nf-code">404</p>
  <h1>${esc(en.title)} <span lang="zh-CN">· ${esc(zh.title)}</span></h1>
  <p>${esc(en.body)}</p>
  <p lang="zh-CN">${esc(zh.body)}</p>
  <div class="cta-row">
    <a class="btn btn-primary" href="${href('en', '/')}">${esc(en.home)}</a>
    <a class="btn btn-ghost" href="${href('en', '/docs/')}">${esc(en.docs)}</a>
    <a class="btn btn-ghost" href="${href('zh', '/')}" lang="zh-CN">${esc(zh.home)}</a>
  </div>
</div></section>`;
  return page({ lang, route: '/404.html', title: `404 · ${n.title} · Open Artifact`, body, alt: null, noindex: true });
}
