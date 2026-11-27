// The whiteboard demo: its checks (see ../verify.mjs).
import { ANY_TEXT, FRAME, IN_FRAME, agentRoundTrip, check, cleanRun, replay, shot, sleep, demoUrl } from './lib.mjs';

/** The board's documents: Juniper Coffee's launch week (`showcase/whiteboard`). */
const GOAL = 'elements/e27'; // "2,000 subs", in Goals
const NOTE = 'elements/e43'; // a person's sticky in Risks
const NOTE_TEXT = 'App review slips past Wednesday';
const RISKS = 'e6'; // the "Risks & open questions" section
const ANSWER = 'Payments throttled on launch morning';

/** The middle of the sticky note that says `text`, in the Shell page's viewport; null if unseen. */
const NOTE_AT = (text) =>
  IN_FRAME(`(() => { const f = ${FRAME}.getBoundingClientRect(); const el = [...document.querySelectorAll('.wb-el')].filter(e => e.textContent.trim().startsWith(${JSON.stringify(text)}) && e.getBoundingClientRect().width > 0)[0]; const r = el?.getBoundingClientRect(); return r ? [f.x + r.x + r.width / 2, f.y + r.y + r.height / 2] : null; })()`);
/** A point beside the Risks section's title (open board: a comment there pins to the board), in the Shell page's viewport. */
const BESIDE_RISKS = IN_FRAME(`(() => { const f = ${FRAME}.getBoundingClientRect(); const r = document.getElementById('wb-${RISKS}')?.getBoundingClientRect(); return r ? [f.x + r.x + r.width * 0.68, f.y + r.y - r.height * 0.2] : null; })()`);

export default async function whiteboard(browser) {
  console.log('\n# whiteboard');
  const page = await browser.load(demoUrl('whiteboard'), { ready: "document.querySelector('.wb-surface')", timeout: 30000, settle: 2500 });
  try {
    const store = 'window.__PLAYGROUND__.store';
    check('the board renders the seeded elements', await page.waitFor(IN_FRAME("['First Light', 'Launch week', 'Customer journey', 'Risks & open questions', 'Go / no-go', 'Support macros'].every(t => document.body.innerText.includes(t))"), 10000));
    check('the Shell cover is gone', await page.evaluate("!document.querySelector('[data-shell-loading]')"));
    check('db listing served from memory', (await page.evaluate(`${store}.listDocs('elements').length`)) === 60);
    check('every element is in the board’s order', await page.evaluate(`(o => o.length === 60 && o.every(id => ${store}.getDoc('elements/' + id)))(${store}.getDoc('board/meta').order)`));
    check('the drawing and the stickers show', await page.waitFor(IN_FRAME("document.querySelectorAll('.wb-sticker').length === 7 && document.querySelectorAll('.wb-el img, .wb-el svg, .wb-el canvas').length > 0"), 10000));
    await shot(page, '01-whiteboard-loaded');

    // A change through the page's own runtime (the real broker path): move a goal.
    const before = await page.evaluate(`${store}.getDoc('${GOAL}').y`);
    await page.evaluate(IN_FRAME(`w.openartifact.use('db').then(db => db.write([{ op: 'update', path: '${GOAL}', patch: { y: ${before + 6} } }]))`));
    check('a db write from the page reaches the backend', (await page.evaluate(`${store}.getDoc('${GOAL}').y`)) === before + 6);

    // A real UI edit: drag a sticky note a little with the mouse.
    const noteAt = await page.evaluate(NOTE_AT(NOTE_TEXT));
    if (noteAt) {
      const was = await page.evaluate(`${store}.getDoc('${NOTE}')`);
      await page.dragMouse(noteAt, [noteAt[0] + 14, noteAt[1] + 9], { steps: 12 });
      await sleep(1500);
      const now = await page.evaluate(`${store}.getDoc('${NOTE}')`);
      check('dragging a note with the mouse saves its new place', now.x !== was.x || now.y !== was.y, `(${was.x},${was.y}) → (${now.x},${now.y})`);
    } else check('found the sticky note to drag', false);
    await page.press('Escape');

    // Comment → Send to Agent → the simulated agent works, replies, adds the risks the board did not have.
    const target = await page.evaluate(BESIDE_RISKS);
    check('found the Risks section to comment by', !!target);
    await agentRoundTrip(page, {
      target,
      request: 'What risks are we missing?',
      changed: `${store}.getDoc('elements/e101') && ${store}.getDoc('elements/e102') && ${store}.getDoc('board/meta').order.includes('e102')`,
      shows: IN_FRAME(`document.body.innerText.includes(${JSON.stringify(ANSWER)})`),
      reply: 'the yellow notes in Risks',
      working: '02-whiteboard-agent-working',
      done: '03-whiteboard-agent-done',
    });
    const history = await page.evaluate(`${store}.history.list().versions.map(v => v.n + ':' + v.author.kind + ':' + v.files.length)`);
    check('history keeps versions of the edits', history.length >= 3, history.join(' '));
    cleanRun(page);
  } finally {
    await page.close();
  }
  await replay('whiteboard', {
    built: ANY_TEXT('Support macros'),
    changed: "window.__PLAYGROUND__.store.getDoc('elements/e101') && window.__PLAYGROUND__.store.getDoc('elements/e102')",
    shows: ANY_TEXT(ANSWER),
  });
}
