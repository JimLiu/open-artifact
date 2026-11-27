// The data demo: its checks (see ../verify.mjs). The showcase is Juniper Coffee's subscriptions dashboard: three live
// queries on the shop database, answered from the snapshot the artifact carries, and three CSV files stored with it.
import { ANY_TEXT, FRAME, IN_EDITOR_AT, IN_FRAME, agentRoundTrip, check, cleanRun, openDemo, replay, shot } from './lib.mjs';

const store = 'window.__PLAYGROUND__.store';
/** The snapshot the dashboard is built with (through April 19), and the one the agent's first answer lands. */
const BUILT_AT = '2026-04-20T13:00:00Z';
const LATER_AT = '2026-05-04T13:00:00Z';
const LATER = `${store}.getDoc('data/live')?.at === '${LATER_AT}'`;
/** What a drawing wrote (the text of the element it draws into), in the editor's frame. */
const DRAWN = (name) => IN_FRAME(`document.querySelector('[data-draw="${name}"]')?.textContent.trim()`);
/** The trend chart's last point: where the comment goes. */
const LAST_DOT = "[...document.querySelectorAll('[data-draw=trend] svg circle')].find(c => c.getAttribute('r') === '4.5')";
/** True once the page shows the later snapshot: the tiles, the sentence above them and the new roast. */
const SHOWS_LATER = `${ANY_TEXT('1,943')} && ${ANY_TEXT('$120.3k')} && ${ANY_TEXT('56')} && ${ANY_TEXT('First Light')}`;

export default async function data(browser) {
  const page = await openDemo(browser, 'data', 4000);
  try {
    check('the dashboard renders the seeded snapshot', await page.waitFor(`${ANY_TEXT('1,748')} && ${ANY_TEXT('$108.8k')}`, 15000));
    const tiles = await Promise.all(['kpi-subscribers', 'kpi-mrr', 'kpi-churn', 'kpi-order'].map((name) => page.evaluate(DRAWN(name))));
    check('the four tiles show their figures', tiles.join(' ') === '1,748 $108.8k 4.6% $30.19', tiles.join(' '));
    check('the file datasets (seeded CSV blobs) render', await page.waitFor(`${ANY_TEXT('$240')} && ${ANY_TEXT('4 bags / wk')} && ${ANY_TEXT('83 behind the path to 2,000 by May 25')}`, 10000));
    check('the charts are drawn', await page.waitFor(IN_FRAME("!!document.querySelector('[data-draw=trend] svg path') && document.querySelectorAll('[data-draw=roasts] .jc-bar').length === 5"), 10000));
    check('the latest orders are listed', await page.waitFor(IN_FRAME("document.querySelectorAll('#orders-table tbody tr').length === 8 && document.querySelector('#orders-table').innerText.includes('JC-21480')"), 10000));
    check('the snapshot is read from the db in memory', (await page.evaluate(`${store}.getDoc('data/live')?.at`)) === BUILT_AT);
    check('the page says how fresh the data is', await page.waitFor(ANY_TEXT('Data as of Apr 2'), 10000));
    check('launch week is not there yet', !(await page.evaluateAll(`${ANY_TEXT('1,943')} || ${ANY_TEXT('First Light')}`)).includes(true));
    await shot(page, '14-data-loaded');

    // The plan filter narrows the tiles and the trend, and comes back.
    const pick = (plan) => page.evaluate(IN_FRAME(`(s => { s.value = ${JSON.stringify(plan)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })(document.querySelector('[data-draw="plan-filter"]'))`));
    await pick('Office');
    check('the plan filter narrows the figures', await page.waitFor(IN_FRAME("document.querySelector('[data-draw=\"kpi-subscribers\"]')?.textContent.trim() === '138' && document.querySelector('#plans-table tr[aria-selected=true]')?.dataset.key === 'Office'"), 6000), String(await page.evaluate(DRAWN('kpi-subscribers'))));
    check('…and the sentence, the roasts and the orders with them', await page.waitFor(IN_FRAME("document.querySelector('#summary').innerText.trim().endsWith('up 10 since Feb 2.') && document.querySelector('[data-draw=roasts] .jc-bar').innerText.includes('245') && [...document.querySelectorAll('#orders-table tbody tr')].every(tr => tr.innerText.includes('Office'))"), 6000), String(await page.evaluate(IN_FRAME("document.querySelector('#summary')?.innerText"))));
    await shot(page, '14-data-filtered');
    await pick('');
    check('…and all plans come back', await page.waitFor(IN_FRAME("document.querySelector('[data-draw=\"kpi-subscribers\"]')?.textContent.trim() === '1,748'"), 6000));

    // A comment on the trend chart, through the page's own comment UI.
    const dot = await page.evaluate(IN_EDITOR_AT(LAST_DOT));
    check('the trend chart ends in view', !!dot, JSON.stringify(dot));
    await agentRoundTrip(page, {
      target: [dot[0] - 30, dot[1] + 4],
      request: 'This stops at April 19. Pull in the late-April orders so launch week shows',
      changed: LATER,
      shows: SHOWS_LATER,
      reply: 'I ran the shop queries again',
      working: '15-data-agent-working',
      done: '16-data-agent-done',
    });
    check('the comment sits on the trend chart', await page.evaluate("window.__PLAYGROUND__.comments.list().some(t => t.anchor === '#subscribers-chart' && /^Chart/.test(t.label))"), await page.evaluate('window.__PLAYGROUND__.comments.list()[0]?.label'));
    check('the sentence turns from behind to ahead', await page.waitFor(IN_FRAME("document.querySelector('#summary').innerText.includes('56 ahead of')"), 6000), String(await page.evaluate(IN_FRAME("document.querySelector('#summary')?.innerText"))));
    check('the new roast ranks second, the orders are the late ones', await page.waitFor(IN_FRAME("document.querySelectorAll('[data-draw=roasts] .jc-bar')[1]?.innerText.includes('First Light') && document.querySelector('#orders-table').innerText.includes('JC-23512')"), 6000));
    check('the page says the data is newer', await page.waitFor(`${ANY_TEXT('Data as of May ')} && ${ANY_TEXT(', 2026')}`, 6000));

    // The agent's next two answers, whatever is asked: a goal bar with the launch marked, then the warmer look.
    await page.evaluate("window.__PLAYGROUND__.agent.request('Show how far we are from the goal')");
    check('a second ask adds the spring goal bar (backend)', await page.waitFor(`${store}.getDoc('files/index.html')?.text?.includes('id="spring-goal"') && !!${store}.getDoc('files/goal.js')?.text`, 8000));
    check('…which the page shows, the launch marked on the chart', await page.waitFor(IN_FRAME("/97%/.test(document.querySelector('#spring-goal')?.innerText ?? '') && !!document.querySelector('[data-draw=trend] .jc-marklabel')"), 8000), String(await page.evaluate(IN_FRAME("document.querySelector('#spring-goal')?.innerText"))));
    await shot(page, '16-data-agent-goal');
    await page.evaluate("window.__PLAYGROUND__.agent.request('Make it warmer')");
    check('a third ask changes the look (backend)', await page.waitFor(`${store}.getDoc('dash/look')?.light?.charts?.[0] === '#c2562b'`, 8000));
    check('…which the page shows', await page.waitFor(IN_FRAME("getComputedStyle(document.querySelector('#dash-root')).getPropertyValue('--dash-chart-1').trim() === '#c2562b'"), 8000), String(await page.evaluate(IN_FRAME("getComputedStyle(document.querySelector('#dash-root')).getPropertyValue('--dash-chart-1')"))));
    check('the agent is idle again', await page.waitFor('!window.__PLAYGROUND__.agent.status().busy', 8000));
    await shot(page, '16-data-agent-look');
    cleanRun(page);
  } finally {
    await page.close();
  }

  await replay('data', {
    built: `${ANY_TEXT('1,748')} && ${ANY_TEXT('JC-21480')}`,
    changed: LATER,
    shows: SHOWS_LATER,
  });
}
