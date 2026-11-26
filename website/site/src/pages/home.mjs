import { DEMO_VIDEO, RELEASES, url } from '../config.mjs';
import { t } from '../i18n.mjs';
import { esc } from '../markdown.mjs';
import { page, href } from '../layout.mjs';
import { mark, icon, typeIcon } from '../icons.mjs';
import { TYPES, SHOWCASE_ORDER, typeById } from '../data/types.mjs';
import { APPS, appName } from '../data/apps.mjs';
import { typeCard, installTabs, typeStyle, cmd } from '../components.mjs';

const PROMPTS = {
  en: [
    '/open-artifact slides a 6-slide pitch for this repo',
    '/open-artifact design three landing page options for a coffee shop',
    '/open-artifact whiteboard a retro board for last sprint',
    '/open-artifact sheets a monthly budget with categories and totals',
    '/open-artifact data a dashboard of signups by month from signups.csv',
    '/open-artifact docs a hiring plan for 2027 with roles, budget and timeline',
    '/open-artifact motion a 20-second launch animation for this app',
    '/open-artifact page a team lunch poll that remembers every vote',
  ],
  zh: [
    '/open-artifact slides a 6-slide pitch for this repo',
    '/open-artifact design three landing page options for a coffee shop',
    '/open-artifact whiteboard a retro board for last sprint',
    '/open-artifact sheets 按类别统计并汇总的月度预算表',
    '/open-artifact data 基于 signups.csv 制作按月注册看板',
    '/open-artifact docs 一份 2027 年的招聘计划，包括岗位、预算和时间线',
    '/open-artifact motion a 20-second launch animation for this app',
    '/open-artifact page a team lunch poll that remembers every vote',
  ],
};
export { PROMPTS };

function loopDiagram(lang) {
  const h = t(lang).home;
  const steps = h.loop
    .map(
      (st, i) => `<li class="loop-step">
  <span class="loop-n">${i + 1}</span>
  <h3>${esc(st.k)}</h3>
  <p>${esc(st.d)}</p>
  <code>${esc(st.code)}</code>
</li>`,
    )
    .join('');
  return `<figure class="loop" aria-label="${esc(h.loopTitle)}">
  <ol class="loop-steps">${steps}</ol>
  <div class="loop-back">
    <div class="loop-u" aria-hidden="true"></div>
    <p class="loop-back-label"><strong>${icon.chat(14)} ${esc(h.loopBack)}</strong> <span>${esc(h.loopBackDesc)}</span></p>
  </div>
</figure>`;
}

export function homePage(lang) {
  const s = t(lang);
  const h = s.home;
  const spectrum = SHOWCASE_ORDER.map((id) => {
    const ty = typeById[id];
    return `<a href="${href(lang, `/types/${id}/`)}" style="${typeStyle(ty)}" title="${esc(ty.name)}">${typeIcon(id, 16)}</a>`;
  }).join('');
  const types = SHOWCASE_ORDER.map((id) => typeCard(typeById[id], lang)).join('\n');
  const apps = APPS.map(
    (a) => `<li><a href="${esc(a.guide)}" rel="noopener"><strong>${esc(appName(a, lang))}</strong><span>${esc(a.sub[lang])}</span></a></li>`,
  ).join('');
  const why = h.why
    .map((w) => `<li class="why-item"><span class="why-icon">${icon[w.icon](18)}</span><h3>${esc(w.k)}</h3><p>${esc(w.d)}</p></li>`)
    .join('');

  const body = `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">${mark(16)} ${esc(h.eyebrow)}</p>
      <h1>${esc(h.pitch)}</h1>
      <p class="hero-sub">${esc(h.sub)}</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="${href(lang, '/install/')}">${esc(h.ctaStart)}${icon.arrow(15)}</a>
        <a class="btn btn-ghost" href="${url('/playground/')}">${icon.play(13)}${esc(h.ctaTry)}</a>
      </div>
      <p class="hero-privacy">${icon.lock(14)} ${esc(h.privacy)}</p>
      <nav class="spectrum" aria-label="${esc(s.nav.types)}">${spectrum}</nav>
    </div>
    <figure class="hero-media">
      <div class="video-frame">
        <video src="${DEMO_VIDEO}" controls muted playsinline preload="metadata" aria-label="${esc(h.videoCaption)}"></video>
      </div>
      <figcaption>${esc(h.videoCaption)} <a href="${DEMO_VIDEO}" rel="noopener">${esc(h.videoFallback)}</a></figcaption>
    </figure>
  </div>
</section>

<section class="band" id="how">
  <div class="wrap">
    <p class="kicker">${esc(h.loopKicker)}</p>
    <h2 class="section-title">${esc(h.loopTitle)}</h2>
    <p class="section-lead">${esc(h.loopLead)}</p>
    ${loopDiagram(lang)}
  </div>
</section>

<section class="section" id="types">
  <div class="wrap">
    <p class="kicker">${esc(h.typesKicker)}</p>
    <h2 class="section-title">${esc(h.typesTitle)}</h2>
    <p class="section-lead">${esc(h.typesLead)}</p>
    <div class="type-grid">${types}</div>
  </div>
</section>

<section class="band" id="why">
  <div class="wrap">
    <p class="kicker">${esc(h.whyKicker)}</p>
    <h2 class="section-title">${esc(h.whyTitle)}</h2>
    <ul class="why-grid">${why}</ul>
  </div>
</section>

<section class="section" id="agents">
  <div class="wrap">
    <p class="kicker">${esc(h.appsKicker)}</p>
    <h2 class="section-title">${esc(h.appsTitle)}</h2>
    <p class="section-lead">${esc(h.appsLead)}</p>
    <ul class="app-grid">${apps}</ul>
  </div>
</section>

<section class="band" id="install">
  <div class="wrap install-wrap">
    <div class="install-intro">
      <p class="kicker">${esc(h.installKicker)}</p>
      <h2 class="section-title">${esc(h.installTitle)}</h2>
      <p class="section-lead">${esc(h.installLead)}</p>
      <p class="install-links"><a class="btn btn-ghost btn-sm" href="${RELEASES}" rel="noopener">${icon.export(14)}${esc(h.downloadZip)}</a> <a class="text-link" href="${href(lang, '/install/')}">${esc(h.installAll)}${icon.arrow(13)}</a></p>
      <p class="prompts-label">${esc(h.tryPrompts)}</p>
      <div class="prompts">${cmd(PROMPTS[lang].slice(0, 4).join('\n'), lang, 'text')}</div>
    </div>
    ${installTabs(lang, 'home')}
  </div>
</section>

<section class="cta-band">
  <div class="wrap cta-band-inner">
    ${mark(40, 'cta-mark')}
    <h2>${esc(h.ctaBandTitle)}</h2>
    <p>${esc(h.ctaBandBody)}</p>
    <div class="cta-row">
      <a class="btn btn-primary" href="${href(lang, '/install/')}">${esc(h.ctaStart)}${icon.arrow(15)}</a>
      <a class="btn btn-ghost" href="${href(lang, '/docs/')}">${esc(s.nav.docs)}</a>
    </div>
  </div>
</section>`;
  return page({ lang, route: '/', title: h.title, body, bodyClass: 'home' });
}
