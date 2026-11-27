// The landing page and the hint bar above each demo: its checks (see ../verify.mjs).
import { BASE, DEMOS, IN_FRAME, check, cleanRun, demoUrl } from './lib.mjs';

/** The landing page lists every demo and links to its own page; a demo's page has the hint bar and its way back. */
export default async function landing(browser) {
  console.log('\n# landing');
  const page = await browser.load(BASE.href, { ready: "document.querySelector('.type-grid')", timeout: 20000, settle: 500 });
  try {
    const links = await page.evaluate("[...document.querySelectorAll('a[data-demo-link]')].map(a => a.href)");
    check('the landing page lists the nine demos', links.length === DEMOS.length && DEMOS.every((t) => links.includes(new URL(`${t}/`, BASE).href)), `${links.length} cards`);
    check('the landing page links back to the site', (await page.evaluate("document.querySelector('a.brand').href")) === new URL('../', BASE).href);
    await page.evaluate("document.querySelector('[data-lang-toggle]').click()");
    check('the language toggle switches the landing page to Chinese', await page.evaluate("document.documentElement.dataset.lang === 'zh' && document.querySelector('h1').innerText.includes('产物类型') && document.querySelector('a.brand').href.endsWith('/zh/')"));
    await page.evaluate("document.querySelector('[data-lang-toggle]').click()");
    check('…and back to English', await page.evaluate("document.documentElement.dataset.lang === 'en' && localStorage.getItem('oa-lang') === 'en'"));
    cleanRun(page);
  } finally {
    await page.close();
  }
  const demo = await browser.load(demoUrl('slides'), { ready: "document.querySelector('iframe[name=open-artifact-shell]')", timeout: 30000, settle: 1500 });
  try {
    check('a demo page shows the hint bar above the Shell', await demo.evaluate("(b => !!b && !b.hidden && b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().bottom <= document.getElementById('root').getBoundingClientRect().top + 1)(document.getElementById('pg-hint'))"));
    check('…which links to all demos and to the site', (await demo.evaluate("[...document.querySelectorAll('#pg-hint [data-pg-href]')].map(a => a.href).join(' ')")) === `${BASE.href} ${new URL('../', BASE).href}`);
  } finally {
    await demo.close();
  }
  // The site's home page frames a demo at `?embed=1` and says what it is itself: the Shell alone.
  const sep = demoUrl('slides').includes('?') ? '&' : '?';
  const embed = await browser.load(`${demoUrl('slides')}${sep}embed=1`, { ready: "document.querySelector('iframe[name=open-artifact-shell]')", timeout: 30000, settle: 1500 });
  try {
    check('a demo page opened with embed=1 has no hint bar', await embed.evaluate("getComputedStyle(document.getElementById('pg-hint')).display === 'none' && document.getElementById('root').getBoundingClientRect().top === 0"));
  } finally {
    await embed.close();
  }
  if (process.env.ROUTES !== 'query') {
    const legacy = await browser.load(new URL('demo.html?type=whiteboard', BASE).href, { ready: "document.querySelector('iframe[name=open-artifact-shell]')", timeout: 30000, settle: 1500 });
    try {
      check('demo.html?type= still opens a demo', await legacy.waitFor(IN_FRAME("!!document.querySelector('.wb-surface')"), 15000));
    } finally {
      await legacy.close();
    }
  }
}
