// The design-system demo: its checks (see ../verify.mjs).
import { ANY_TEXT, FRAME, IN_FRAME, agentRoundTrip, check, cleanRun, openDemo, replay, shot, sleep } from './lib.mjs';

/** A color token's own comment item on the page (comments here anchor to a token, a text style, a component…). */
const TOKEN_ITEM = (name) => `[...document.querySelectorAll('[data-comment-item]')].find(e => { try { const a = JSON.parse(e.dataset.commentItem); return a.kind === 'token' && a.family === 'color' && a.name === ${JSON.stringify(name)}; } catch { return false; } })`;
const ACCENT_ITEM = TOKEN_ITEM('accent');
/** A token's swatch is painted `rgb`. */
const PAINTED = (item, rgb) => `[...(${item})?.querySelectorAll('*') ?? []].some(e => getComputedStyle(e).backgroundColor === ${JSON.stringify(rgb)})`;
/** The seeded accent (terracotta, #c2562b) and the one the agent's first answer leaves (clay, #a8563a). */
const TERRACOTTA = 'rgb(194, 86, 43)';
const CLAY = 'rgb(168, 86, 58)';
/** In a component's preview frame (any frame whose document is that preview): `expr` with its `document`. */
const IN_PREVIEW = (title, expr) => `document.title === ${JSON.stringify(title)} && !!document.querySelector('[class^="jp-"]') && (${expr})`;
const PRIMARY_BUTTON = (rgb) => IN_PREVIEW('Button', `getComputedStyle(document.querySelector('.jp-btn--primary')).backgroundColor === ${JSON.stringify(rgb)}`);
/** Picks the theme the component previews show, with the page's own select. */
const PREVIEW_THEME = (theme) => IN_FRAME(`(() => { const s = document.querySelector('select[aria-label="Component preview theme"]'); if (!s) return false; Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(theme)}); s.dispatchEvent(new w.Event('change', { bubbles: true })); return true; })()`);

export default async function designSystem(browser) {
  const page = await openDemo(browser, 'design-system');
  try {
    const store = 'window.__PLAYGROUND__.store';
    check('the overview renders the seeded brand book', await page.waitFor(IN_FRAME("document.body.innerText.includes('Juniper Coffee roasts in small batches') && document.body.innerText.includes('Sentence case everywhere')"), 10000));
    check('the cover renders above it', await page.waitFor(ANY_TEXT('Small-batch coffee. One palette, two type families, one scale.'), 10000));
    check('the colors list the seeded tokens', await page.waitFor(IN_FRAME("['surface-raised', 'accent-strong', 'on-forest', 'text-link'].every(name => document.body.innerText.includes('--' + name))"), 10000));
    check('the accent token shows its seeded swatch', await page.waitFor(IN_FRAME(`${ACCENT_ITEM}?.innerText.includes('Terracotta.') && ${PAINTED(ACCENT_ITEM, TERRACOTTA)}`), 5000));
    check('its alias shows the same color', await page.evaluate(IN_FRAME(`${TOKEN_ITEM('accent-focus')}?.innerText.includes('alias of {accent}') && ${PAINTED(TOKEN_ITEM('accent-focus'), TERRACOTTA)}`)));
    check('every contrast pair passes in both themes', await page.evaluate(IN_FRAME("document.body.innerText.includes('Contrast') && ![...document.querySelectorAll('button')].some(b => /Ask agent to fix/.test(b.textContent))")));
    check('type, scales and the motion family are listed', await page.evaluate(IN_FRAME("['.display', '.overline', '--space-4', '--radius-pill', '--shadow-lg', '--ease-settle'].every(name => document.body.innerText.includes(name))")));
    await shot(page, '11-design-system-loaded');
    // The components: previews mount when scrolled near.
    await page.evaluate(IN_FRAME("document.getElementById('ds-page-components')?.scrollIntoView()"));
    check('the components list their cards', await page.waitFor(IN_FRAME("['Button', 'RoastCard', 'Switch', 'TabBar', 'Tabs', 'Tag', 'TextField', 'Toast', 'Wordmark'].every(name => document.getElementById('ds-component-' + name))"), 5000));
    check('a component preview renders from the tokens', await page.waitFor(PRIMARY_BUTTON(TERRACOTTA), 10000));
    await sleep(600);
    await shot(page, '11-design-system-components');
    check('the preview theme can be switched', await page.evaluate(PREVIEW_THEME('dark')));
    check('the previews follow it to the dark theme', await page.waitFor(IN_PREVIEW('Button', "getComputedStyle(document.body).backgroundColor === 'rgb(23, 21, 17)'"), 10000));
    await sleep(600);
    await shot(page, '11-design-system-components-dark');
    await page.evaluate(PREVIEW_THEME('light'));
    check('…and back', await page.waitFor(PRIMARY_BUTTON(TERRACOTTA), 10000));
    // Comment on the accent token (comments here anchor to an item: a token, a text style, a component…).
    await page.evaluate(IN_FRAME(`${ACCENT_ITEM}?.scrollIntoView({ block: 'center' })`));
    await sleep(500);
    const target = await page.evaluate(IN_FRAME(`(() => { const f = ${FRAME}.getBoundingClientRect(); const r = ${ACCENT_ITEM}.getBoundingClientRect(); return [f.x + r.x + 90, f.y + r.y + 20]; })()`));
    await agentRoundTrip(page, {
      target,
      request: 'Make the accent a little calmer',
      changed: `${store}.readText('project/tokens.json').includes('#a8563a')`,
      shows: IN_FRAME(`${PAINTED(ACCENT_ITEM, CLAY)} && ${ACCENT_ITEM}.innerText.includes('a calmer terracotta')`),
      reply: 'The accent is now a calmer clay',
      working: '12-design-system-agent-working',
      done: '13-design-system-agent-done',
    });
    check('the thread is anchored to the token', await page.evaluate(`window.__PLAYGROUND__.comments.list().some(t => t.anchor === '{"kind":"token","family":"color","name":"accent"}' && t.label === 'Color accent')`));
    check('what uses the accent follows: its alias', await page.waitFor(IN_FRAME(PAINTED(TOKEN_ITEM('accent-focus'), CLAY)), 5000));
    check('…and the component previews', await page.waitFor(PRIMARY_BUTTON(CLAY), 10000));
    // The agent's next turns: softer corners, then a new component.
    await page.evaluate(IN_FRAME("w.openartifact.use('agent').then(a => a.send({ text: 'Soften it a little' }))"));
    check('a second agent turn changes the radius scale', await page.waitFor(IN_FRAME("document.querySelector('input[aria-label=\"radius-md value\"]')?.value === '14px'"), 8000));
    await page.evaluate(IN_FRAME("w.openartifact.use('agent').then(a => a.send({ text: 'We need something for launch news' }))"));
    check('a third adds a component', await page.waitFor(IN_FRAME("!!document.getElementById('ds-component-Notice')"), 8000));
    await page.evaluate(IN_FRAME("document.getElementById('ds-component-Notice')?.scrollIntoView()"));
    check('…whose preview renders', await page.waitFor(IN_PREVIEW('Notice', "document.body.innerText.includes('First Light is back')"), 10000));
    await sleep(600);
    await shot(page, '13-design-system-agent-added-component');
    cleanRun(page);
  } finally {
    await page.close();
  }
  await replay('design-system', {
    // The last file the agent writes is the index ("Last change by…"); by then the cover stands above the brand book.
    built: IN_FRAME("document.body.innerText.includes('Last change by Juniper Coffee') && [...document.querySelectorAll('iframe')].some(f => f.contentDocument?.body?.innerText?.includes('Small-batch coffee. One palette, two type families, one scale.'))"),
    changed: "window.__PLAYGROUND__.store.readText('project/tokens.json').includes('#a8563a')",
    shows: IN_FRAME(`${PAINTED(ACCENT_ITEM, CLAY)} && ${PAINTED(TOKEN_ITEM('accent-focus'), CLAY)}`),
  });
}
