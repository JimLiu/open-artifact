import { DEMO_VIDEO, RELEASES, url } from '../config.mjs';
import { t } from '../i18n.mjs';
import { esc } from '../markdown.mjs';
import { page, href } from '../layout.mjs';
import { mark, icon, typeIcon } from '../icons.mjs';
import { SHOWCASE_ORDER, typeById } from '../data/types.mjs';
import { DEMO_LINES, STAGE_ORDER } from '../data/demos.mjs';
import { APPS, appName } from '../data/apps.mjs';
import { typeCard, installTabs, typeStyle, playground, cmd } from '../components.mjs';

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

/**
 * The live stage: the playground's demos, one tab each, in a frame on the page. The markup alone is links to the
 * demos' own pages plus a poster; site.js makes the frame (`<demo>/?embed=1`) once the page has loaded, so the page
 * itself never waits for an editor.
 */
function liveStage(lang) {
  const g = t(lang).home.stage;
  const first = typeById[STAGE_ORDER[0]];
  const tabs = STAGE_ORDER.map((id, i) => {
    const ty = typeById[id];
    return `<a href="${playground(id)}" data-demo="${id}" data-name="${esc(ty.name)}" data-line="${esc(DEMO_LINES[id][lang])}" style="${typeStyle(ty)}"${i === 0 ? ' aria-current="true"' : ''}><span class="stage-tab-icon">${typeIcon(id, 15)}</span>${esc(ty.name)}</a>`;
  }).join('');
  const steps = g.steps.map(([k, d]) => `<li><b>${esc(k)}</b>${esc(d)}</li>`).join('');
  return `<section class="stage-section" id="live" aria-label="${esc(g.label)}">
  <div class="wrap stage-wrap">
    <div class="stage" data-stage data-base="${url('/playground/')}" data-frame-title="${esc(g.frame)}" style="${typeStyle(first)}">
      <div class="stage-bar">
        <span class="stage-live"><i aria-hidden="true"></i>${esc(g.live)}</span>
        <nav class="stage-tabs" aria-label="${esc(g.label)}">${tabs}</nav>
        <a class="stage-open" data-stage-open href="${playground(first.id)}" target="_blank" rel="noopener" title="${esc(g.open)}">${icon.external(14)}<span>${esc(g.open)}</span></a>
      </div>
      <div class="stage-view" data-stage-view>
        <div class="stage-poster" data-stage-poster>
          <span class="type-icon lg" data-stage-icon>${typeIcon(first.id, 28)}</span>
          <strong data-stage-name>${esc(first.name)}</strong>
          <p data-stage-line>${esc(DEMO_LINES[first.id][lang])}</p>
          <p class="stage-status" role="status"><i aria-hidden="true"></i>${esc(g.loading)}</p>
          <a class="btn btn-type stage-load" data-stage-load href="${playground(first.id)}">${icon.play(13)}${esc(g.load)}</a>
        </div>
        <button class="stage-veil" type="button" data-stage-veil hidden><span>${icon.play(12)}${esc(g.veil)}</span></button>
      </div>
      <div class="stage-foot">
        <ol class="stage-steps">${steps}</ol>
        <span class="stage-note">${esc(g.note)}</span>
      </div>
    </div>
  </div>
</section>`;
}

export function homePage(lang) {
  const s = t(lang);
  const h = s.home;
  const types = SHOWCASE_ORDER.map((id) => typeCard(typeById[id], lang)).join('\n');
  const apps = APPS.map(
    (a) => `<li><a href="${esc(a.guide)}" rel="noopener"><strong>${esc(appName(a, lang))}</strong><span>${esc(a.sub[lang])}</span></a></li>`,
  ).join('');
  const why = h.why
    .map((w) => `<li class="why-item"><span class="why-icon">${icon[w.icon](18)}</span><h3>${esc(w.k)}</h3><p>${esc(w.d)}</p></li>`)
    .join('');

  const body = `
<section class="hero">
  <div class="wrap hero-head">
    <div class="hero-title">
      <p class="eyebrow">${mark(16)} ${esc(h.eyebrow)}</p>
      <h1>${esc(h.pitch)}</h1>
    </div>
    <div class="hero-copy">
      <p class="hero-sub">${esc(h.sub)}</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="${href(lang, '/install/')}">${esc(h.ctaStart)}${icon.arrow(15)}</a>
        <a class="btn btn-ghost" href="#demo-video">${icon.play(13)}${esc(h.ctaVideo)}</a>
      </div>
      <p class="hero-privacy">${icon.lock(14)} ${esc(h.privacy)}</p>
    </div>
  </div>
  <p class="wrap stage-hint">${esc(h.stage.hint)}</p>
</section>

${liveStage(lang)}

<section class="band" id="how">
  <div class="wrap">
    <div class="how-head">
      <div>
        <p class="kicker">${esc(h.loopKicker)}</p>
        <h2 class="section-title">${esc(h.loopTitle)}</h2>
        <p class="section-lead">${esc(h.loopLead)}</p>
      </div>
      <figure class="how-video" id="demo-video">
        <div class="video-frame">
          <video src="${DEMO_VIDEO}" controls muted playsinline preload="metadata" aria-label="${esc(h.videoCaption)}"></video>
        </div>
        <figcaption>${esc(h.videoCaption)} <a href="${DEMO_VIDEO}" rel="noopener">${esc(h.videoFallback)}</a></figcaption>
      </figure>
    </div>
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
