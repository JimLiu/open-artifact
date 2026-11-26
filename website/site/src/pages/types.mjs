import { ghFile } from '../config.mjs';
import { t } from '../i18n.mjs';
import { esc } from '../markdown.mjs';
import { page, href } from '../layout.mjs';
import { icon, typeIcon } from '../icons.mjs';
import { SHOWCASE_ORDER, typeById } from '../data/types.mjs';
import { typeCard, typeStyle, playground, betaBadge, cmd } from '../components.mjs';

/** Wrap the comment part of a file-tree line so it can be dimmed. */
const treeHtml = (tree) =>
  tree
    .split('\n')
    .map((line) => {
      const m = /^(.*?)(\s+#\s.*)?$/.exec(line);
      const main = esc(m[1]).replace(/^([│├└─\s]*)/, '<span class="tree-rule">$1</span>');
      return main + (m[2] ? `<span class="tree-note">${esc(m[2])}</span>` : '');
    })
    .join('\n');

const CHOOSE = {
  en: [
    ['Slides vs. Docs', 'Slides to present in stages on a fixed screen with speaker notes; Docs for long-form reading, multi-tab plans, tracked suggestions, or Word and Markdown.'],
    ['Design vs. Whiteboard', 'Design when visual craft, pixel-accurate layout, prototypes or print fidelity matter; Whiteboard for spatial brainstorming, flowcharts and freeform team work.'],
    ['Data vs. Sheets', 'Data for dashboards, d3 charts, scroll stories or live connector queries; Sheets when people need cells, formulas, filters, dropdowns or an Excel workbook.'],
    ['Motion vs. Slides', 'Motion when time, choreography, music and an MP4 or GIF are the point; Slides when a speaker drives the pace.'],
    ['Page last', 'Page only when nothing else fits: a small tool, calculator, mini game or explainer written as one HTML page.'],
    ['Design System first', 'With brand guidelines or a product codebase, build a Design System first so Design, Slides, Data and Motion reuse it.'],
  ],
  zh: [
    ['Slides 还是 Docs', '要在固定画面上分步演示、带演讲者备注，用 Slides；长篇阅读、多标签页计划、修订建议、导出 Word 或 Markdown，用 Docs。'],
    ['Design 还是 Whiteboard', '看重视觉、像素级布局、原型或印刷效果，用 Design；空间化头脑风暴、流程图、自由协作，用 Whiteboard。'],
    ['Data 还是 Sheets', '看板、d3 图表、滚动故事或连接器实时查询，用 Data；需要单元格、公式、筛选、下拉或 Excel 工作簿，用 Sheets。'],
    ['Motion 还是 Slides', '时间、动效编排、音乐和 MP4/GIF 才是重点，用 Motion；由讲者控制节奏，用 Slides。'],
    ['最后才是 Page', '其他都不合适时才用 Page：写成一张 HTML 页面的小工具、计算器、小游戏或解释页。'],
    ['先做设计系统', '有品牌规范或产品代码库，先做 Design System，Design、Slides、Data 和 Motion 都能复用。'],
  ],
};

export function typesIndexPage(lang) {
  const s = t(lang);
  const cards = SHOWCASE_ORDER.map((id) => typeCard(typeById[id], lang)).join('\n');
  const choose = CHOOSE[lang].map(([k, d]) => `<li><h3>${esc(k)}</h3><p>${esc(d)}</p></li>`).join('');
  const body = `<section class="page-head"><div class="wrap">
  <h1>${esc(s.typesIndex.title)}</h1>
  <p class="section-lead">${esc(s.typesIndex.lead)}</p>
</div></section>
<section class="section section-tight"><div class="wrap">
  <div class="type-grid">${cards}</div>
</div></section>
<section class="band"><div class="wrap">
  <h2 class="section-title">${esc(s.typesIndex.choose)}</h2>
  <ul class="choose-grid">${choose}</ul>
  <p><a class="text-link" href="${href(lang, '/docs/artifact-types/')}">${esc(s.typePage.guide)}${icon.arrow(13)}</a></p>
</div></section>`;
  return page({ lang, route: '/types/', title: `${s.typesIndex.title} · Open Artifact`, body });
}

export function typePage(id, lang) {
  const s = t(lang);
  const p = s.typePage;
  const ty = typeById[id];
  const features = ty.features
    .map((f) => `<li><h3>${esc(f[lang][0])}</h3><p>${esc(f[lang][1])}</p></li>`)
    .join('');
  const exportsList = ty.exports.length
    ? `<ul class="chips">${ty.exports.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    : `<p class="muted">${esc(p.noExports)}</p>`;
  const others = SHOWCASE_ORDER.filter((x) => x !== id)
    .map((x) => {
      const o = typeById[x];
      return `<li><a href="${href(lang, `/types/${x}/`)}" style="${typeStyle(o)}"><span class="type-icon sm">${typeIcon(x, 16)}</span>${esc(o.name)}</a></li>`;
    })
    .join('');
  const skillPath = `artifact-types/${id}/SKILL.md`;
  const body = `<section class="type-hero" style="${typeStyle(ty)}">
  <div class="wrap type-hero-grid">
    <div>
      <p class="crumbs"><a href="${href(lang, '/types/')}">${esc(p.allTypes)}</a> / <code>${esc(id)}</code></p>
      <h1><span class="type-icon lg">${typeIcon(id, 30)}</span>${esc(ty.name)}${ty.beta ? betaBadge(lang) : ''}</h1>
      <p class="type-tagline">${esc(ty.tagline[lang])}</p>
      <p class="type-summary">${esc(ty.summary[lang])}</p>
      <div class="cta-row">
        <a class="btn btn-type" href="${playground(id)}">${icon.play(13)}${esc(s.tryLive)}</a>
        <a class="btn btn-ghost" href="${href(lang, `/docs/types/${id}/`)}">${esc(p.guide)}${icon.arrow(15)}</a>
      </div>
      ${ty.beta ? `<p class="beta-note">${esc(p.betaNote)}</p>` : ''}
    </div>
    <div class="type-hero-art" aria-hidden="true">${typeIcon(id, 160)}</div>
  </div>
</section>

<section class="section"><div class="wrap">
  <h2 class="section-title">${esc(p.features)}</h2>
  <ul class="feature-grid" style="${typeStyle(ty)}">${features}</ul>
</div></section>

<section class="band"><div class="wrap split split-type">
  <div>
    <h2 class="section-title">${esc(p.storage)}</h2>
    <p class="section-lead">${esc(p.storageLead)}</p>
    <pre class="tree" style="${typeStyle(ty)}"><code>${treeHtml(ty.tree)}</code></pre>
  </div>
  <div class="type-side">
    <h2 class="section-title">${esc(p.exports)}</h2>
    ${exportsList}
    ${ty.exportsNote ? `<p class="muted">${esc(ty.exportsNote[lang])}</p>` : ''}
    ${ty.usesDS ? `<p class="ds-note">${typeIcon('design-system', 16)} <a href="${href(lang, '/types/design-system/')}">${esc(p.usesDS)}</a></p>` : ''}
    <h2 class="section-title">${esc(p.prompt)}</h2>
    <div class="prompts">${cmd(ty.prompts[lang].join('\n'), lang, 'text')}</div>
    <p class="type-links">
      <a class="text-link" href="${href(lang, `/docs/types/${id}/`)}">${esc(p.guide)}${icon.arrow(13)}</a>
      <a class="text-link" href="${href(lang, `/docs/skills/${id}/`)}">${esc(p.skill)}${icon.arrow(13)}</a>
      <a class="text-link" href="${ghFile(skillPath)}" rel="noopener">GitHub${icon.external(13)}</a>
    </p>
  </div>
</div></section>

<section class="section section-tight"><div class="wrap">
  <h2 class="section-title small">${esc(p.other)}</h2>
  <ul class="other-types">${others}</ul>
</div></section>`;
  return page({ lang, route: `/types/${id}/`, title: `${ty.name} · Open Artifact`, description: ty.summary[lang], body });
}
