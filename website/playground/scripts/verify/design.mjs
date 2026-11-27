// The design demo: its checks (see ../verify.mjs). The showcase is Juniper's spring launch on one canvas: a landing
// hero (a page) and two phone screens joined as a prototype, under a title, beside a sticky note.
import { ANY_TEXT, FRAME, IN_FRAME, agentRoundTrip, check, cleanRun, demoUrl, openDemo, replay, shot, sleep } from './lib.mjs';

const store = 'window.__PLAYGROUND__.store';
const BOARDS = ['Main.dc.html', 'Welcome.dc.html', 'Home.dc.html'];
/** An artboard's frame in the editor, by its file: [x, y, width, height] in the Shell page's viewport. */
const BOARD_BOX = (file) => IN_FRAME(`(() => { const f = ${FRAME}.getBoundingClientRect(); const r = [...document.querySelectorAll('iframe')].find(e => e.title === ${JSON.stringify(file)})?.getBoundingClientRect(); return r?.width ? [f.x + r.x, f.y + r.y, r.width, r.height] : null; })()`);
/** True in the artboard whose `<title>` is `title` when `expression` is. */
const IN_BOARD = (title, expression) => `document.title === ${JSON.stringify(title)} && Boolean(${expression})`;
/** The hero's answer to the comment: a call to action it did not have, and a terracotta headline. */
const CTA = 'Start with First Light';
const WARM = IN_BOARD('Landing hero', "getComputedStyle(document.querySelector('h1')).color === 'rgb(194, 86, 43)'");

export default async function design(browser) {
  const page = await openDemo(browser, 'design');
  try {
    check('the canvas lists the three artboards', await page.waitFor(IN_FRAME("['Landing hero', 'Welcome', 'Home'].every(name => document.body.innerText.includes(name))"), 10000));
    check('the landing hero renders', await page.waitFor(ANY_TEXT('Wake up to First Light.'), 10000));
    check('the welcome screen renders', await page.waitFor(ANY_TEXT('Good coffee, right when the day begins.'), 10000));
    check('the home screen renders', await page.waitFor(ANY_TEXT('Good morning, Maya'), 10000));
    check('the canvas shows its title and its sticky note', await page.waitFor(IN_FRAME("document.body.innerText.includes('Juniper · Spring launch') && document.body.innerText.includes('working prototype')"), 10000));
    const boxes = await Promise.all(BOARDS.map((file) => page.evaluate(BOARD_BOX(file))));
    const view = await page.evaluate(`(r => [r.x, r.y, r.right, r.bottom])(${FRAME}.getBoundingClientRect())`);
    check('every artboard is in view, none over another', boxes.every((b) => b && b[0] >= view[0] && b[1] >= view[1] && b[0] + b[2] <= view[2] && b[1] + b[3] <= view[3]) && boxes.every((b, i) => i === 0 || b[0] >= boxes[i - 1][0] + boxes[i - 1][2]), JSON.stringify(boxes?.map((b) => b?.map(Math.round))));
    check('the hero has no call to action yet', !(await page.evaluateAll(ANY_TEXT(CTA))).includes(true) && !(await page.evaluateAll(WARM)).includes(true));
    const listed = Object.keys(await page.evaluate(`${store}.list()`));
    check('files listed from memory', ['project/canvas.json', ...BOARDS.map((file) => `project/${file}`)].every((path) => listed.includes(path)), listed.join(', '));
    await shot(page, '08-design-loaded');

    // A comment on the hero's headline, through the page's own comment UI.
    const hero = boxes[0];
    await agentRoundTrip(page, {
      target: [hero[0] + hero[2] * 0.473, hero[1] + hero[3] * 0.351],
      request: 'Make the headline warmer and add a call to action',
      changed: `${store}.readText('project/Main.dc.html').includes(${JSON.stringify(CTA)})`,
      shows: ANY_TEXT(CTA),
      reply: 'the headline is terracotta now',
      working: '09-design-agent-working',
      done: '10-design-agent-done',
    });
    check('the comment sits on the hero’s headline', await page.evaluate("window.__PLAYGROUND__.comments.list().some(t => t.location?.artboard === 'Main.dc.html' && /h1/.test(t.label))"), await page.evaluate('window.__PLAYGROUND__.comments.list()[0]?.label'));
    check('the headline turns terracotta', await page.waitFor(WARM, 6000));

    // The agent's next two answers, whatever is asked: the hero's evening theme, then the Home screen's roast card.
    await page.evaluate("window.__PLAYGROUND__.agent.request('Try another direction')");
    check('a second ask turns the hero to its evening theme (backend)', await page.waitFor(`/"label":"Evening theme","default":true/.test(${store}.readText('project/Main.dc.html'))`, 8000));
    check('…which the page shows, the call to action kept', await page.waitFor(IN_BOARD('Landing hero', `getComputedStyle(document.querySelector('#top')).backgroundColor === 'rgb(20, 38, 28)' && document.body.innerText.includes(${JSON.stringify(CTA)})`), 8000));
    await page.evaluate("window.__PLAYGROUND__.agent.request('And one more')");
    check('a third ask restyles the Home screen’s roast card (backend)', await page.waitFor(`${store}.readText('project/Home.dc.html').includes('New · This week')`, 8000));
    check('…which the page shows', await page.waitFor(IN_BOARD('Home', "document.body.innerText.toUpperCase().includes('NEW · THIS WEEK')"), 8000));
    check('the agent is idle again', await page.waitFor('!window.__PLAYGROUND__.agent.status().busy', 8000));
    await shot(page, '10-design-agent-next');
    cleanRun(page);
  } finally {
    await page.close();
  }

  // The phone screens are a prototype: Home plays on the canvas, and its brew guide answers a real click.
  const url = demoUrl('design');
  const play = await browser.load(`${url}#play-home`, { ready: `${FRAME}?.contentWindow?.document?.body?.innerText?.length > 0`, timeout: 30000, settle: 2500 });
  try {
    const AEROPRESS = "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'AeroPress')";
    await play.waitFor(IN_BOARD('Home', AEROPRESS), 10000);
    const spot = (await play.evaluateAll(`document.title === 'Home' ? (r => [(r.x + r.width / 2) / innerWidth, (r.y + r.height / 2) / innerHeight])(${AEROPRESS}.getBoundingClientRect()) : null`)).find(Boolean);
    check('the Home artboard plays on the canvas', !!spot && !!(await play.evaluate(BOARD_BOX('Home.dc.html'))) && (await play.evaluateAll(IN_BOARD('Home', "document.body.innerText.includes('250 g')"))).includes(true));
    // The canvas glides to the artboard it plays: click where the button is once the frame has come to rest (and
    // again, should the first click have landed while it still moved).
    const SWITCHED = IN_BOARD('Home', "document.body.innerText.includes('200 g') && document.body.innerText.includes('2:00')");
    let switched = false;
    for (let attempt = 0; spot && !switched && attempt < 3; attempt++) {
      let box = await play.evaluate(BOARD_BOX('Home.dc.html'));
      for (let i = 0; i < 20; i++) {
        await sleep(250);
        const next = await play.evaluate(BOARD_BOX('Home.dc.html'));
        const still = box && next && box.every((v, k) => Math.abs(v - next[k]) < 0.5);
        box = next;
        if (still) break;
      }
      if (box) await play.click(box[0] + spot[0] * box[2], box[1] + spot[1] * box[3]);
      switched = await play.waitFor(SWITCHED, 2500);
    }
    check('its brew guide switches on a click', switched);
    await shot(play, '10-design-play');
    check('no page problems while playing', play.problems.length === 0, play.problems.join(' | '));
  } finally {
    await play.close();
  }

  await replay('design', {
    built: IN_BOARD('Home', "document.body.innerText.includes('Good morning, Maya')"),
    changed: `${store}.readText('project/Main.dc.html').includes(${JSON.stringify(CTA)})`,
    shows: ANY_TEXT(CTA),
  });
}
