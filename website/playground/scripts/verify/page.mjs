// The page demo: its checks (see ../verify.mjs).
import { FRAME, IN_FRAME, LAYER, agentRoundTrip, check, cleanRun, openDemo, replay, shot, sleep } from './lib.mjs';

/** The artifact's own page: frame-host's inner shell frames it inside the Shell's frame. */
const STAGE = `${FRAME}?.contentWindow?.document?.querySelector('#stage iframe')`;
const PAGE = `${STAGE}?.contentWindow?.document`;
/** `expr` with `document` the artifact page's. */
const IN_PAGE = (expr) => `(() => { const document = ${PAGE}; if (!document?.body) return null; return (${expr}); })()`;
/** The middle of `selector` in the artifact's page (`fx`: how far along it), in the Shell page's viewport; null if unseen. */
const AT = (selector, fx = 0.5) =>
  `(() => { const document = ${PAGE}; const r = document?.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); if (!r?.width) return null; const outer = ${FRAME}.getBoundingClientRect(); const stage = ${STAGE}.getBoundingClientRect(); return [outer.x + stage.x + r.x + r.width * ${fx}, outer.y + stage.y + r.y + r.height / 2]; })()`;

export default async function pageType(browser) {
  const page = await openDemo(browser, 'page', 5000, STAGE);
  try {
    const store = 'window.__PLAYGROUND__.store';
    const text = (selector) => page.evaluate(IN_PAGE(`document.querySelector(${JSON.stringify(selector)})?.textContent`));
    /** A real click on `selector` of the artifact's page, scrolled into view first. */
    const click = async (selector, fx = 0.5) => {
      await page.evaluate(IN_PAGE(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'nearest' })`));
      const at = await page.evaluate(AT(selector, fx));
      if (at) await page.click(at[0], at[1]);
      else check(`found ${selector} to click`, false);
      await sleep(200);
    };
    check("frame-host's own inner shell runs in the Shell's frame", await page.waitFor(IN_FRAME("!!document.querySelector('#stage iframe') && !!document.querySelector('#comments-ui')"), 10000));
    check('the page renders the seeded methods from the db', await page.waitFor(IN_PAGE("['pour-over', 'french-press', 'aeropress'].every(id => document.querySelector('#method-' + id)) && document.querySelectorAll('.method').length === 3"), 15000));
    check("…opens on today's pick, with its recipe worked out", (await text('.method.is-on b')) === 'Pour-over' && (await text('#dose-out')) === '20' && (await text('#water-out')) === '320');
    check('…and the seeded tasting notes', await page.waitFor(IN_PAGE("document.querySelector('#brews').innerText.includes('Apricot up front') && document.querySelectorAll('#brews li').length === 2"), 5000));

    // The controls, with real clicks: another method, the dose slider, the strength, the timer.
    await click('#method-french-press');
    check('picking a method shows its recipe', (await text('#dose-out')) === '30' && (await text('#water-out')) === '450' && (await text('#ratio')) === '1 : 15');
    await click('#dose', 0.9);
    const dose = Number(await text('#dose-out'));
    check('the dose slider works the water out again', dose > 30 && Number(await text('#water-out')) === dose * 15, `${dose} g`);
    await click('#strength label:nth-child(1)');
    check('…and so does the strength', (await text('#ratio')) === '1 : 14' && Number(await text('#water-out')) === dose * 14);
    await click('#start');
    check('the timer runs', await page.waitFor(IN_PAGE("document.querySelector('#clock').textContent !== '0:00' && document.querySelector('#start').textContent === 'Pause'"), 5000));
    await click('#next');
    check('…and moves on to the next step', await page.waitFor(IN_PAGE("document.querySelector('#steps .is-now b')?.textContent === 'Steep' && document.querySelector('#ring').getAttribute('stroke-dashoffset') < 520"), 3000));
    await shot(page, '20-page-brewing');
    await click('#reset');
    await click('#method-pour-over');

    // A tasting note, saved by the page with its own db.add.
    await click('#rating label:nth-child(5)');
    await click('#note');
    await page.type('Peach and jasmine');
    await page.press('Enter');
    check("saving a tasting note writes it through the page's db", await page.waitFor(`${store}.listDocs('brews').some(d => d.data.note === 'Peach and jasmine' && d.data.rating === 5 && d.data.method === 'pour-over' && d.data.by === 'You')`, 5000));
    check('…and the log shows it first', await page.waitFor(IN_PAGE("document.querySelector('#brews li')?.innerText.includes('Peach and jasmine')"), 5000));
    await page.evaluate(IN_PAGE('document.defaultView.scrollTo(0, 0)'));
    await sleep(300);
    await shot(page, '20-page-loaded');

    // A comment on the Pour-over card: the agent adds a method and makes it today's pick, as data. No reload.
    await agentRoundTrip(page, {
      target: await page.evaluate(AT('#method-pour-over')),
      request: 'Add an iced version of this one',
      changed: `${store}.getDoc('methods/iced-pour-over')?.ice === 0.4 && ${store}.getDoc('guide/main')?.featured === 'iced-pour-over'`,
      shows: IN_PAGE("document.querySelector('.method.is-on b')?.textContent === 'Iced pour-over' && document.querySelector('#water-unit').textContent.includes('128 g ice') && !!document.querySelector('#method-iced-pour-over .pick')"),
      reply: 'I added an iced pour-over',
      working: '21-page-agent-working',
      done: '22-page-agent-done',
    });
    check('the comment is anchored on the card', await page.evaluate("window.__PLAYGROUND__.comments.list()[0]?.anchor.includes('#method-pour-over')"));

    // The agent's next turn rewrites index.html: the page loads again, and what is in the db is still there.
    await page.evaluate("window.__PLAYGROUND__.agent.request('Make the header feel like the launch deck')");
    check('a second agent turn rewrites the page (backend)', await page.waitFor(`${store}.readText('project/index.html').includes('Spring launch edition')`, 8000));
    check('the page loads again with the new header', await page.waitFor(IN_PAGE("document.querySelector('.edition')?.textContent === 'Spring launch edition'"), 10000));
    check('the reloaded page keeps the db state', await page.waitFor(IN_PAGE("document.querySelector('.method.is-on b')?.textContent === 'Iced pour-over' && document.querySelector('#brews')?.innerText.includes('Peach and jasmine')"), 8000));
    const pin = await page.waitFor(`(() => { const outer = ${FRAME}.getBoundingClientRect(); const doc = ${FRAME}.contentWindow.document; const r = doc.querySelector('[data-comment-layer]')?.shadowRoot?.querySelector('[data-comment-pin]')?.getBoundingClientRect(); return r?.width ? [outer.x + r.x + r.width / 2, outer.y + r.y + r.height / 2] : null; })()`, 5000);
    check("the thread's pin is still on the reloaded page", pin);
    await sleep(600);
    await shot(page, '23-page-agent-rewrote');

    // The third turn pins a note, as data again.
    await page.evaluate("window.__PLAYGROUND__.agent.request('Use filtered water')");
    check('a third agent turn pins a note at the top', await page.waitFor(IN_PAGE("!document.querySelector('#pinned').hidden && document.querySelector('#pinned').textContent.includes('Use filtered water') && document.querySelector('.method.is-on b')?.textContent === 'French press'"), 10000));

    // The page's own "Ask" button opens the comment composer on the methods, for the person to send on.
    await click('#ask');
    check("the page's Ask button opens the comment composer", await page.waitFor(`${LAYER}?.querySelector('textarea')`, 5000));
    await page.press('Escape');
    cleanRun(page);
  } finally {
    await page.close();
  }
  await replay('page', {
    built: "document.querySelectorAll('.method').length === 3 && document.querySelector('.method.is-on b')?.textContent === 'Pour-over' && document.querySelectorAll('#brews li .said').length === 2",
    changed: "window.__PLAYGROUND__.store.getDoc('methods/iced-pour-over')?.ice === 0.4 && window.__PLAYGROUND__.store.getDoc('guide/main')?.featured === 'iced-pour-over'",
    shows: "document.querySelectorAll('.method').length === 4 && document.querySelector('.method.is-on b')?.textContent === 'Iced pour-over' && document.querySelector('#water-unit')?.textContent.includes('128 g ice')",
  });
}
