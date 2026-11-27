// The slides demo: its checks (see ../verify.mjs). The deck is Juniper Coffee's spring launch review
// (`showcase/slides/`): eight slides sharing one stylesheet, a chart drawn in SVG, speaker notes on every slide.
import { ANY_TEXT, FRAME, IN_FRAME, agentRoundTrip, check, cleanRun, demoUrl, launch, replay, shot, sleep, waitTop } from './lib.mjs';

const SLIDES = ['cover', 'agenda', 'numbers', 'growth', 'launch', 'timeline', 'quote', 'close'];
const store = 'window.__PLAYGROUND__.store';
const order = `JSON.parse(${store}.readText('project/deck.json')).order`;
const slide = (id) => `${store}.readText('project/slides/${id}.html')`;
/** The slide on the stage, in the editor's frame. */
const STAGE = "document.querySelector('[data-open-artifact-mode=edit]')";
/** The pager's "3 / 8", as [3, 8]. */
const PAGER = "(document.querySelector('[data-open-artifact-pager-count]')?.textContent.match(/(\\d+)\\s*\\/\\s*(\\d+)/) ?? []).slice(1).map(Number)";

export default async function slides(browser) {
  console.log('\n# slides');
  const page = await browser.load(demoUrl('slides'), { ready: STAGE, timeout: 30000, settle: 2500 });
  try {
    check('the cover renders on the stage', await page.waitFor(IN_FRAME(`${STAGE}?.innerText.includes('First Light') && ${STAGE}.innerText.includes('arriving on the same morning')`), 10000));
    check('the slide rail lists all eight slides', await page.waitFor(IN_FRAME("['Three things this morning', 'households start their week', 'Subscriptions grew every month', 'Two launches land', 'Six weeks from roast lock', 'the first warm morning', 'Wednesday, April 14'].every(text => document.body.innerText.includes(text))"), 8000));
    check('the pager counts eight slides', (await page.evaluate(IN_FRAME(PAGER)))?.join('/') === '1/8');
    check('files listed from memory', Object.keys(await page.evaluate(`${store}.list()`)).length === 10);
    check('the deck index names the eight slides', (await page.evaluate(order)).join() === SLIDES.join());
    check('every slide has speaker notes', await page.evaluate(`${JSON.stringify(SLIDES)}.every(id => /<aside>[^<]{20,}<\\/aside>/.test(${store}.readText('project/slides/' + id + '.html')))`));
    check('the chart is drawn in SVG, its labels text over it', await page.waitFor(IN_FRAME("!!document.querySelector('svg[aria-label^=\"Line chart\"]') && document.body.innerText.includes('4,180') && !document.querySelector('svg text')"), 5000));
    await shot(page, '04-slides-loaded');

    // A publish through the page's own runtime: the deck's CSS gets a comment line.
    await page.evaluate(IN_FRAME("w.openartifact.use('artifact').then(async a => { const css = await a.readText('project/deck.css'); const list = await a.list(); return a.publish({ 'project/deck.css': { content: css + '\\n/* touched */\\n', ifMatch: list['project/deck.css'].sha256 } }); })"));
    check('a publish from the page reaches the backend', (await page.evaluate(`${store}.readText('project/deck.css')`)).includes('touched'));

    // Comment on the cover's title → Send to Agent → the cover is rewritten live.
    const target = await page.evaluate(IN_FRAME(`(() => { const f = ${FRAME}.getBoundingClientRect(); const r = [...${STAGE}.querySelectorAll('h1')].find(e => e.textContent.includes('First Light')).getBoundingClientRect(); return [f.x + r.x + r.width * 0.3, f.y + r.y + r.height * 0.55]; })()`));
    check('the cover has no launch date yet', !(await page.evaluate(slide('cover'))).includes('date-pill'));
    await agentRoundTrip(page, {
      target,
      request: 'Put the launch date on the cover, and make the title warmer',
      changed: `${slide('cover')}.includes('date-pill')`,
      shows: IN_FRAME(`${STAGE}.innerText.includes('pre-orders open April 1')`),
      reply: 'The cover now carries the launch date',
      working: '05-slides-agent-working',
      done: '06-slides-agent-done',
    });
    check('the comment hangs on the cover’s title', await page.evaluate("(t => t?.label === 'Slide 1 › First Light' && JSON.parse(t.anchor).slide === 'cover')(window.__PLAYGROUND__.comments.list()[0])"));

    // The agent's next turns: a slide added at the end (deck.json's order changes too), then two slides restyled.
    const ask = (text) => page.evaluate(IN_FRAME(`w.openartifact.use('agent').then(a => a.send({ text: ${JSON.stringify(text)} }))`));
    await ask('Add the pricing');
    check('a second agent turn adds a slide', await page.waitFor(IN_FRAME("document.body.innerText.includes('Launch-week pricing')"), 8000));
    check('…named in the deck index, after the close', (await page.evaluate(order)).join() === [...SLIDES, 'plans-2'].join());
    check('…and the pager counts nine', await page.waitFor(IN_FRAME(`${PAGER}[1] === 9`), 5000));
    await shot(page, '07-slides-agent-added-slide');
    await ask('Calm slide 3 down');
    check('a third turn moves the big number onto forest green', await page.waitFor(`${slide('numbers')}.includes('class="dark"')`, 8000));
    await ask('And the quote');
    check('a fourth turn restyles the quote', await page.waitFor(`${slide('quote')}.includes('class="dark center"')`, 8000));
    check('the Shell shows the agent idle again', await waitTop(page, "!document.querySelector('[role=status]')?.textContent.includes('working')", 8000));
    await shot(page, '07-slides-agent-restyled');
    cleanRun(page);
  } finally {
    await page.close();
  }
  await replay('slides', {
    // The deck is written and the page is back on the cover, the slide the comment goes on.
    built: `${STAGE}?.innerText.includes('arriving on the same morning') && ${PAGER}.join('/') === '1/8'`,
    changed: `${slide('cover')}.includes('date-pill')`,
    shows: ANY_TEXT('pre-orders open April 1'),
  });
  await replayFollows();
}

/**
 * What the slides replay adds to the page (`src/replay/types/slides.ts`), in a window the size of the replay check's:
 * the properties panel closes, the page follows the agent (each slide shows as it is written, after the planned
 * outline), and it stops following, back on the cover, when the deck is done.
 */
async function replayFollows() {
  console.log('\n# slides: replay, the page follows the agent');
  const browser = await launch({ width: 1200, height: 720 });
  try {
    const page = await browser.load(`${demoUrl('slides')}${demoUrl('slides').includes('?') ? '&' : '?'}replay=1`, { ready: "window.top === window && !!document.querySelector('.pg-replay')", timeout: 30000, settle: 0 });
    try {
      const seen = { planned: false, following: false, shown: new Set(), last: null };
      const until = Date.now() + 60000;
      while (Date.now() < until) {
        const now = await page.evaluate(IN_FRAME(`({ planned: document.body.innerText.includes('8 slides planned'), following: /Following .*Esc to stop/.test(document.body.textContent), pager: ${PAGER}, cover: !!${STAGE}?.innerText.includes('arriving on the same morning') })`)).catch(() => null);
        if (now) {
          seen.planned ||= now.planned;
          seen.following ||= now.following;
          if (now.pager.length) seen.shown.add(now.pager[0]);
          seen.last = now;
        }
        // The agent says what it made: the deck is written.
        if (await page.evaluate("!!document.querySelector('.pg-said')")) break;
        await sleep(120);
      }
      check('the outline shows as planned slides before the first is written', seen.planned);
      check('the page follows the agent', seen.following, seen.following ? '' : `last seen: ${JSON.stringify(seen.last)}`);
      check('each slide shows as the agent writes it', seen.shown.size >= 6, `slides shown: ${[...seen.shown].join(' ')}`);
      check('the page is back on the cover once the deck is written', await page.waitFor(IN_FRAME(`${PAGER}.join('/') === '1/8' && ${STAGE}.innerText.includes('arriving on the same morning')`), 5000));
      check('…and no longer follows the agent', await page.waitFor(IN_FRAME("!/Following .*Esc to stop/.test(document.body.textContent)"), 5000));
      check('the properties panel is closed for the replay', await page.evaluate(IN_FRAME("document.querySelector('button[aria-label=\"Properties\"][aria-pressed]')?.getAttribute('aria-pressed') === 'false'")));
      check('…and the editor’s remembered panels are as they were', await page.evaluate("localStorage.getItem('open-artifact-slides:view') === null"));
      check('no page problems', page.problems.length === 0, page.problems.join(' | '));
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
