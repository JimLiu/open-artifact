// Pieces several pages share.
import { url } from './config.mjs';
import { t } from './i18n.mjs';
import { esc, codeBlock } from './markdown.mjs';
import { typeIcon, icon } from './icons.mjs';
import { href } from './layout.mjs';
import { APPS, appName } from './data/apps.mjs';

export const typeStyle = (ty) => `--tint:${ty.colors.tint};--wash:${ty.colors.wash};--ink:${ty.colors.ink}`;
export const playground = (id) => url(`/playground/${id}/`);

export const betaBadge = (lang) => `<span class="badge-beta">${esc(t(lang).beta)}</span>`;

export function typeCard(ty, lang) {
  const s = t(lang);
  return `<article class="type-card" style="${typeStyle(ty)}">
  <a class="type-card-main" href="${href(lang, `/types/${ty.id}/`)}">
    <span class="type-icon">${typeIcon(ty.id, 22)}</span>
    <span class="type-card-name">${esc(ty.name)}${ty.beta ? betaBadge(lang) : ''}</span>
    <span class="type-card-line">${esc(ty.tagline[lang])}</span>
  </a>
  <div class="type-card-foot">
    <span class="type-exports">${ty.exports.length ? ty.exports.map(esc).join(' · ') : '&nbsp;'}</span>
    <a class="type-try" href="${playground(ty.id)}">${esc(s.tryLive)}${icon.arrow(13)}</a>
  </div>
</article>`;
}

/** Copyable shell lines. */
export const cmd = (code, lang, language = 'bash') => codeBlock(code, language, { copyLabel: t(lang).copy });

/** One agent app's install panel body. */
export function appSteps(app, lang) {
  const steps = app.steps[lang];
  const list = steps.map((x) => `<li>${esc(x)}</li>`).join('');
  return `<ol class="steps">${list}</ol>${app.code ? cmd(app.code, lang) : ''}<p class="app-guide"><a href="${esc(app.guide)}" rel="noopener">${esc(lang === 'zh' ? `${appName(app, lang)} 完整指南` : `Full ${appName(app, lang)} guide`)}${icon.external(13)}</a></p>`;
}

/** Tabbed install picker: tabs work with JS; without it every panel shows, stacked. */
export function installTabs(lang, idPrefix = 'inst') {
  const tabs = APPS.map(
    (a, i) =>
      `<button type="button" role="tab" id="${idPrefix}-tab-${a.id}" aria-controls="${idPrefix}-panel-${a.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(appName(a, lang))}</button>`,
  ).join('');
  const panels = APPS.map(
    (a, i) =>
      `<section class="tab-panel" role="tabpanel" id="${idPrefix}-panel-${a.id}" aria-labelledby="${idPrefix}-tab-${a.id}"${i === 0 ? '' : ' data-hidden'}>
  <h3 class="tab-panel-title">${esc(appName(a, lang))} <small>${esc(a.sub[lang])}</small></h3>
  ${appSteps(a, lang)}
</section>`,
  ).join('\n');
  return `<div class="tabs" data-tabs>
  <div class="tab-list" role="tablist" aria-label="${esc(lang === 'zh' ? 'Agent 应用' : 'Agent apps')}">${tabs}</div>
  <div class="tab-panels">${panels}</div>
</div>`;
}
