#!/usr/bin/env node
// Drives the playground in headless Chrome over the DevTools protocol (the repo's e2e/lib/browser.mjs) and checks the
// playground end to end: each demo's editor loads in the real Shell from the in-memory backend, a change made through the
// page's own `window.openartifact` reaches the backend, a comment sent to the agent from the page's own comment UI
// makes the simulated agent work, reply in the thread and change the artifact live, and no request leaves the page
// for another host. Screenshots go to `.spike-shots/`.
//
// Every demo is covered: whiteboard, slides, design, design-system, data, motion, page (frame-host's inner shell), and
// docs and sheets, whose artifacts live in the real Docs host and Sheets store (with its WebAssembly engine) running in
// the page.
//
// Each demo opens at its own page, `<base><demo>/`; ROUTES=query opens `demo.html?type=<demo>` instead. The landing page
// and the hint bar above each demo (and its absence with `?embed=1`) are checked too (`landing`).
//
//   node website/playground/scripts/verify.mjs [base URL, default http://127.0.0.1:5190/]
//   ONLY=design,page node website/playground/scripts/verify.mjs   # some demos only
//   node website/playground/scripts/verify.mjs http://127.0.0.1:4330/playground/   # the built website (website/build.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../../../e2e/lib/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, '..', '.spike-shots');
const BASE = new URL(process.argv[2] ?? 'http://127.0.0.1:5190/');
/** A demo's page. */
const demoUrl = (type) => new URL(process.env.ROUTES === 'query' ? `demo.html?type=${type}` : `${type}/`, BASE).href;
const DEMOS = ['slides', 'design', 'design-system', 'whiteboard', 'sheets', 'data', 'docs', 'motion', 'page'];
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}
/** Wait until `expression` is truthy in the Shell page itself (not in any of its frames); false after `ms`. */
async function waitTop(page, expression, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await page.evaluate(`Boolean(${expression})`)) return true;
    await sleep(200);
  }
  return false;
}
const SHELL_IDLE = "!document.querySelector('[role=status]')?.textContent.includes('working')";

async function shot(page, name) {
  const { data } = await page.cdp('Page.captureScreenshot', { format: 'png' });
  const file = path.join(SHOTS, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`     screenshot ${path.relative(process.cwd(), file)}`);
}

/** The editor's frame, from the Shell page (same origin). */
const FRAME = "window.document.querySelector('iframe[name=open-artifact-shell]')";
const IN_FRAME = (expr) => `(() => { const w = ${FRAME}?.contentWindow; const document = w?.document; if (!document) return null; return (${expr}); })()`;
/** The comment layer's shadow root (the one showing a card, if any): `data-comment-layer`, or editor-kit's default mark. */
const LAYER = "(roots => roots.find(r => r.querySelector('[data-comment-card]')) ?? roots[0])([...window.document.querySelectorAll('[data-comment-layer], [data-comments-layer]')].map(e => e.shadowRoot).filter(Boolean))";
const SEND_BOX = `[...(${LAYER})?.querySelectorAll('[data-comment-card] [role=checkbox]') ?? []].find(e => /^Send to /.test(e.textContent.trim()))`;

/** Requests to anything but this server (and data:/blob: URLs) are stray. */
function strayRequests(page) {
  return [...page.urls].filter((u) => !u.startsWith(BASE.origin) && !/^(data|blob|about):/.test(u));
}

/** Opens the comment composer at (x, y) (Shell's Comments toggle, then a click on the page), types, ticks "Send to", sends. */
async function commentToAgent(page, [x, y], text) {
  await page.evaluate("document.querySelector('button[aria-label=Comments]')?.click()");
  await sleep(500);
  await page.click(x, y);
  const composer = await page.waitFor(`${LAYER}?.querySelector('textarea')`, 8000);
  check('comment composer opens on the page', composer);
  if (!composer) return false;
  await page.type(text);
  const box = await page.waitFor(SEND_BOX, 4000);
  check('composer offers "Send to Agent"', box);
  if (box) {
    const ticked = await page.evaluateAll(`(b => b ? (b.getAttribute('aria-checked') === 'true' || b.click(), b.getAttribute('aria-checked')) : null)(${SEND_BOX})`);
    console.log(`     send box: ${JSON.stringify(ticked.filter((v) => v !== null))}`);
  }
  // Watch the Shell's top bar from before the send: the agent's "working" status shows for its think time only.
  // The Shell shows it for pages that report it (slides: "Agent is working…"); the whiteboard shows it on its own Ask
  // button (a pulsing dot).
  await page.evaluate(`(() => {
    window.__sawWorking = false;
    const frame = ${FRAME}.contentWindow.document;
    const look = () => {
      if (document.querySelector('[role=status]')?.textContent.includes('working')) window.__sawWorking = 'shell';
      if ([...frame.querySelectorAll('button')].some(b => /Ask /.test(b.textContent) && b.querySelector('.animate-pulse'))) window.__sawWorking = 'page';
    };
    for (const d of [document, frame]) new MutationObserver(look).observe(d.body, { subtree: true, childList: true, characterData: true, attributes: true });
    window.__agentBusy = false;
    window.__PLAYGROUND__.agent.statusChanges.on(s => { if (s.busy) window.__agentBusy = true; });
  })()`);
  await page.press('Enter');
  return true;
}

async function whiteboard(browser) {
  console.log('\n# whiteboard');
  const page = await browser.load(demoUrl('whiteboard'), { ready: "document.querySelector('.wb-surface')", timeout: 30000, settle: 2500 });
  try {
    const store = 'window.__PLAYGROUND__.store';
    check('the board renders the seeded elements', await page.waitFor(IN_FRAME("document.body.innerText.includes('Every element kind, style and option on one board')"), 10000));
    check('the Shell cover is gone', await page.evaluate("!document.querySelector('[data-shell-loading]')"));
    check('db listing served from memory', (await page.evaluate(`${store}.listDocs('elements').length`)) === 66);
    await shot(page, '01-whiteboard-loaded');

    // A change through the page's own runtime (the real broker path): move the "rect" shape.
    const before = await page.evaluate(`${store}.getDoc('elements/e4').x`);
    await page.evaluate(IN_FRAME(`w.openartifact.use('db').then(db => db.write([{ op: 'update', path: 'elements/e4', patch: { x: ${before + 60} } }]))`));
    check('a db write from the page reaches the backend', (await page.evaluate(`${store}.getDoc('elements/e4').x`)) === before + 60);

    // A real UI edit: drag the yellow sticky note a little with the mouse.
    const noteAt = await page.evaluate(IN_FRAME(`(() => { const f = ${FRAME}.getBoundingClientRect(); const el = [...document.querySelectorAll('*')].filter(e => e.textContent.trim().startsWith("A person's sticky note") && e.getBoundingClientRect().width > 0).sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0]; const r = el?.getBoundingClientRect(); return r ? [f.x + r.x + r.width / 2, f.y + r.y + r.height / 2] : null; })()`));
    if (noteAt) {
      const was = await page.evaluate(`${store}.getDoc('elements/e18')`);
      await page.dragMouse(noteAt, [noteAt[0] + 80, noteAt[1] + 40], { steps: 12 });
      await sleep(1500);
      const now = await page.evaluate(`${store}.getDoc('elements/e18')`);
      check('dragging a note with the mouse saves its new place', now.x !== was.x || now.y !== was.y, `(${was.x},${was.y}) → (${now.x},${now.y})`);
    } else check('found the sticky note to drag', false);
    await page.press('Escape');

    // Comment → Send to Agent → the simulated agent works, replies, adds a sticky.
    const sent = await commentToAgent(page, [1250, 690], 'Please summarise this board');
    if (sent) {
      check('the thread reaches the backend', await page.waitFor("window.__PLAYGROUND__.comments.list().some(t => t.messages[0].text === 'Please summarise this board')", 5000));
      check('the thread is handed to the agent', await page.waitFor("window.__PLAYGROUND__.comments.list().some(t => t.agent)", 5000));
      check('the agent shows as working', await page.waitFor('window.__sawWorking', 4000), await page.evaluate('window.__sawWorking'));
      await shot(page, '02-whiteboard-agent-working');
      check('the agent adds a sticky (backend)', await page.waitFor(`${store}.getDoc('elements/agent-note-1')`, 6000));
      check('the sticky shows on the board live', await page.waitFor(IN_FRAME("document.body.innerText.includes('Fixed by the agent')"), 6000));
      check('the agent replies in the thread', await page.waitFor("window.__PLAYGROUND__.comments.list().some(t => t.messages.some(m => m.author.kind === 'agent'))", 6000));
      check('the reply shows in the comment card', await page.waitFor(`${LAYER}?.textContent.includes('I added a sticky note')`, 6000));
      check('the Shell shows the agent idle again', await waitTop(page, SHELL_IDLE, 8000));
      await shot(page, '03-whiteboard-agent-done');
    }
    const history = await page.evaluate(`${store}.history.list().versions.map(v => v.n + ':' + v.author.kind + ':' + v.files.length)`);
    check('history keeps versions of the edits', history.length >= 3, history.join(' '));
    const stray = strayRequests(page);
    check('no request leaves for another host', stray.length === 0, stray.join(', '));
    check('no page problems', page.problems.length === 0, page.problems.join(' | '));
  } finally {
    await page.close();
  }
}

async function slides(browser) {
  console.log('\n# slides');
  const page = await browser.load(demoUrl('slides'), { ready: "document.querySelector('[data-open-artifact-mode=edit]')", timeout: 30000, settle: 2500 });
  try {
    const store = 'window.__PLAYGROUND__.store';
    check('the first slide renders', await page.waitFor(IN_FRAME("document.querySelector('[data-open-artifact-mode=edit]')?.textContent.includes('Slides QA')"), 10000));
    check('the slide rail lists both slides', await page.waitFor(IN_FRAME("document.body.innerText.includes('Heading')"), 5000));
    check('files listed from memory', Object.keys(await page.evaluate(`${store}.list()`)).length === 4);
    await shot(page, '04-slides-loaded');

    // A publish through the page's own runtime: the deck's CSS gets a comment line.
    await page.evaluate(IN_FRAME("w.openartifact.use('artifact').then(async a => { const css = await a.readText('project/deck.css'); const list = await a.list(); return a.publish({ 'project/deck.css': { content: css + '\\n/* touched */\\n', ifMatch: list['project/deck.css'].sha256 } }); })"));
    check('a publish from the page reaches the backend', (await page.evaluate(`${store}.readText('project/deck.css')`)).includes('touched'));

    // Comment on the slide → Send to Agent → slide 2 is rewritten live.
    const target = await page.evaluate(IN_FRAME(`(() => { const f = ${FRAME}.getBoundingClientRect(); const r = document.querySelector('[data-open-artifact-mode=edit]').getBoundingClientRect(); return [f.x + r.x + r.width * 0.6, f.y + r.y + r.height * 0.6]; })()`));
    const sent = await commentToAgent(page, target, 'Make the second slide say what this deck is about');
    if (sent) {
      check('the thread reaches the backend', await page.waitFor("window.__PLAYGROUND__.comments.list().some(t => t.agent)", 5000));
      check('the agent shows as working', await page.waitFor('window.__sawWorking', 4000), await page.evaluate('window.__sawWorking'));
      await shot(page, '05-slides-agent-working');
      check('the agent rewrites slide 2 (backend)', await page.waitFor(`${store}.readText('project/slides/s-u7lxj2.html').includes('Updated by the agent')`, 6000));
      check('the rail shows the new slide 2 live', await page.waitFor(IN_FRAME("document.body.innerText.includes('Updated by the agent')"), 8000));
      check('the reply shows in the comment card', await page.waitFor(`${LAYER}?.textContent.includes('I rewrote the second slide')`, 6000));
      await shot(page, '06-slides-agent-done');
    }
    // The agent's next turn adds a slide (deck.json order changes too).
    await page.evaluate(IN_FRAME("w.openartifact.use('agent').then(a => a.send({ text: 'Add a closing slide' }))"));
    check('a second agent turn adds a slide', await page.waitFor(IN_FRAME("document.body.innerText.includes('Thank you')"), 8000));
    await shot(page, '07-slides-agent-added-slide');
    const stray = strayRequests(page);
    check('no request leaves for another host', stray.length === 0, stray.join(', '));
    check('no page problems', page.problems.length === 0, page.problems.join(' | '));
  } finally {
    await page.close();
  }
}

/** Some frame's text (the Shell, the editor, an artboard or page frame nested in it) includes `text`. */
const ANY_TEXT = (text) => `document.body?.innerText?.includes(${JSON.stringify(text)})`;
/**
 * The comment round trip every new demo shares: a comment at `target` sent to the agent reaches the backend and the
 * agent, the agent works, the backend changes (`changed`), the page shows it (`shows`), and the reply (`reply`, a piece
 * of the demo's scripted reply) lands in the thread and in the comment card.
 */
async function agentRoundTrip(page, { target, request, changed, shows, reply, working, done, showsWorking = true, openCard = null }) {
  const sent = await commentToAgent(page, target, request);
  if (!sent) return;
  check('the thread reaches the backend', await page.waitFor(`window.__PLAYGROUND__.comments.list().some(t => t.messages[0].text === ${JSON.stringify(request)})`, 5000));
  check('the thread is handed to the agent', await page.waitFor('window.__PLAYGROUND__.comments.list().some(t => t.agent)', 5000));
  if (showsWorking) check('the agent shows as working', await page.waitFor('window.__sawWorking', 4000), await page.evaluate('window.__sawWorking'));
  else {
    // Degraded on purpose: this editor draws no "working" state of its own and reports none to the Shell.
    check(`the agent works (backend; ${showsWorking === false ? 'the editor shows no working state' : showsWorking})`, await page.waitFor('window.__agentBusy', 4000));
    check('…and the page shows no working state (as in the product)', !(await page.evaluate('window.__sawWorking')));
  }
  await shot(page, working);
  check('the agent changes the artifact (backend)', await page.waitFor(changed, 8000));
  check('the change shows on the page live', await page.waitFor(shows, 10000));
  if (openCard) await openCard();
  check('the agent replies in the thread', await page.waitFor(`window.__PLAYGROUND__.comments.list().some(t => t.messages.some(m => m.author.kind === 'agent' && m.text.includes(${JSON.stringify(reply)})))`, 6000));
  check('the reply shows in the comment card', await page.waitFor(`${LAYER}?.textContent.includes(${JSON.stringify(reply)})`, 6000));
  check('the Shell shows the agent idle again', await waitTop(page, SHELL_IDLE, 8000));
  await shot(page, done);
}

/** What each demo must end with: nothing fetched from another host, no console errors, failed requests or crashes. */
function cleanRun(page) {
  const stray = strayRequests(page);
  check('no request leaves for another host', stray.length === 0, stray.join(', '));
  check('no page problems', page.problems.length === 0, page.problems.join(' | '));
}

async function openDemo(browser, type, settle = 2500, ready = `${FRAME}?.contentWindow?.document?.body?.innerText?.length > 0`) {
  console.log(`\n# ${type}`);
  const page = await browser.load(demoUrl(type), { ready, timeout: 30000, settle });
  check('the Shell cover is gone', await page.waitFor("window.top === window && !document.querySelector('[data-shell-loading]')", 10000));
  return page;
}

async function design(browser) {
  const page = await openDemo(browser, 'design');
  try {
    const store = 'window.__PLAYGROUND__.store';
    check('the canvas lists the seeded artboard', await page.waitFor(IN_FRAME("document.body.innerText.includes('Main')"), 10000));
    check('the artboard renders the seeded card', await page.waitFor(ANY_TEXT('Make things people can comment on'), 10000));
    check('the card is not changed yet', !(await page.evaluateAll(ANY_TEXT('updated by the agent'))).includes(true));
    check('files listed from memory', Object.keys(await page.evaluate(`${store}.list()`)).includes('project/Main.dc.html'));
    await shot(page, '08-design-loaded');
    const target = await page.evaluate(IN_FRAME(`(() => { const f = ${FRAME}.getBoundingClientRect(); const a = [...document.querySelectorAll('iframe')].find(e => e.getBoundingClientRect().width > 100); const r = a.getBoundingClientRect(); return [f.x + r.x + r.width * 0.5, f.y + r.y + r.height * 0.3]; })()`));
    await agentRoundTrip(page, {
      target,
      request: 'Make the headline warmer and add a call to action',
      changed: `${store}.readText('project/Main.dc.html').includes('updated by the agent')`,
      shows: ANY_TEXT('Try it now → (updated by the agent)'),
      reply: 'I warmed the headline up',
      working: '09-design-agent-working',
      done: '10-design-agent-done',
    });
    cleanRun(page);
  } finally {
    await page.close();
  }
}

/** The accent token's own comment item on the overview (comments here anchor to a token, a text style, a component…). */
const ACCENT_ITEM = "[...document.querySelectorAll('[data-comment-item]')].find(e => { try { const a = JSON.parse(e.dataset.commentItem); return a.kind === 'token' && a.name === 'accent'; } catch { return false; } })";
/** The accent token's swatch is painted blue (#2563eb). */
const ACCENT_BLUE = `[...(${ACCENT_ITEM})?.querySelectorAll('*') ?? []].some(e => getComputedStyle(e).backgroundColor === 'rgb(37, 99, 235)')`;

async function designSystem(browser) {
  const page = await openDemo(browser, 'design-system');
  try {
    const store = 'window.__PLAYGROUND__.store';
    check('the overview renders the seeded system', await page.waitFor(IN_FRAME("document.body.innerText.includes('Warm paper surfaces, one terracotta accent')"), 10000));
    check('the colors list the seeded tokens', await page.waitFor(IN_FRAME("document.body.innerText.includes('surface-100') && document.body.innerText.includes('accent')"), 10000));
    check('the accent token shows its seeded swatch', await page.waitFor(IN_FRAME(`${ACCENT_ITEM}?.innerText.includes('Links and the primary button.') && !(${ACCENT_BLUE})`), 5000));
    await shot(page, '11-design-system-loaded');
    // Comment on the accent token (comments here anchor to an item: a token, a text style, a component…).
    await page.evaluate(IN_FRAME(`${ACCENT_ITEM}?.scrollIntoView({ block: 'center' })`));
    await sleep(500);
    const target = await page.evaluate(IN_FRAME(`(() => { const f = ${FRAME}.getBoundingClientRect(); const r = ${ACCENT_ITEM}.getBoundingClientRect(); return [f.x + r.x + r.width / 2, f.y + r.y + r.height / 2]; })()`));
    await agentRoundTrip(page, {
      target,
      request: 'Make the accent a calmer blue',
      changed: `${store}.readText('project/tokens.json').includes('#2563eb')`,
      shows: IN_FRAME(`${ACCENT_BLUE} && ${ACCENT_ITEM}.innerText.includes('Changed by the agent')`),
      reply: 'I moved the accent token to a deeper blue',
      working: '12-design-system-agent-working',
      done: '13-design-system-agent-done',
    });
    cleanRun(page);
  } finally {
    await page.close();
  }
}

async function data(browser) {
  const page = await openDemo(browser, 'data', 4000);
  try {
    const store = 'window.__PLAYGROUND__.store';
    check('the dashboard renders the seeded snapshot', await page.waitFor(ANY_TEXT('$20,320'), 15000));
    check('the file dataset (a seeded CSV blob) renders', await page.waitFor(ANY_TEXT('240'), 10000));
    check('the snapshot is read from the db in memory', (await page.evaluate(`${store}.getDoc('data/live')?.at`)) === '2026-11-20T09:00:00Z');
    check('the agent note is not there yet', !(await page.evaluateAll(ANY_TEXT('October closed strong'))).includes(true));
    await shot(page, '14-data-loaded');
    const target = await page.evaluate(IN_FRAME(`(() => { const f = ${FRAME}.getBoundingClientRect(); return [f.x + f.width * 0.5, f.y + 260]; })()`));
    await agentRoundTrip(page, {
      target,
      request: 'Pull in the late October orders',
      changed: `${store}.getDoc('data/live')?.at === '2026-11-26T09:00:00Z' && ${store}.getDoc('files/index.html')?.text?.includes('agent-note')`,
      shows: `${ANY_TEXT('$22,320')} && ${ANY_TEXT('October closed strong')}`,
      reply: 'I pulled the late October orders',
      working: '15-data-agent-working',
      done: '16-data-agent-done',
    });
    cleanRun(page);
  } finally {
    await page.close();
  }
}

async function motion(browser) {
  const page = await openDemo(browser, 'motion', 4000);
  try {
    const store = 'window.__PLAYGROUND__.store';
    check('the film renders its first scene', await page.waitFor(ANY_TEXT('Hello motion'), 15000));
    check('the timeline lists the seeded scenes', await page.waitFor(`${ANY_TEXT('Intro')} && ${ANY_TEXT('Outro')}`, 10000));
    check('the narration (a seeded mp3 blob) is listed', await page.waitFor(ANY_TEXT('Motion playback test.'), 10000));
    await shot(page, '17-motion-loaded');
    const target = await page.evaluate(IN_FRAME(`(() => { const f = ${FRAME}.getBoundingClientRect(); return [f.x + f.width * 0.45, f.y + f.height * 0.35]; })()`));
    await agentRoundTrip(page, {
      target,
      request: 'Open on something friendlier',
      changed: `${store}.getDoc('modules/scene-intro.js')?.text?.includes('Made with your agent') && ${store}.getDoc('modules/base.css')?.text?.includes('#e8505b')`,
      shows: ANY_TEXT('Made with your agent'),
      reply: 'The intro now opens on',
      showsWorking: false,
      working: '18-motion-agent-working',
      done: '19-motion-agent-done',
    });
    cleanRun(page);
  } finally {
    await page.close();
  }
}

async function pageType(browser) {
  const page = await openDemo(browser, 'page', 5000, `${FRAME}?.contentWindow?.document?.querySelector('#stage iframe')`);
  try {
    const store = 'window.__PLAYGROUND__.store';
    const PAGE = `${FRAME}?.contentWindow?.document?.querySelector('#stage iframe')?.contentWindow?.document`;
    check("frame-host's own inner shell runs in the Shell's frame", await page.waitFor(IN_FRAME("!!document.querySelector('#stage iframe') && !!document.querySelector('#comments-ui')"), 10000));
    check('the page renders the seeded items from the db', await page.waitFor(`${PAGE}?.body?.innerText?.includes('Passport') && ${PAGE}?.body?.innerText?.includes('A good book')`, 15000));
    // A real click in the page: tick "Phone charger", which the page saves with its own db update.
    const box = await page.evaluate(`(() => { const outer = ${FRAME}.getBoundingClientRect(); const stage = ${FRAME}.contentWindow.document.querySelector('#stage iframe').getBoundingClientRect(); const li = [...(${PAGE}).querySelectorAll('li')].find(l => l.textContent.includes('Phone charger')); const r = li?.querySelector('input')?.getBoundingClientRect(); return r ? [outer.x + stage.x + r.x + r.width / 2, outer.y + stage.y + r.y + r.height / 2] : null; })()`);
    if (box) {
      await page.click(box[0], box[1]);
      check("ticking an item saves it through the page's db", await page.waitFor(`${store}.getDoc('items/a2')?.done === true`, 5000));
    } else check('found the item to tick', false);
    await shot(page, '20-page-loaded');
    const target = await page.evaluate(`(() => { const outer = ${FRAME}.getBoundingClientRect(); const stage = ${FRAME}.contentWindow.document.querySelector('#stage iframe').getBoundingClientRect(); const r = (${PAGE}).querySelector('h1').getBoundingClientRect(); return [outer.x + stage.x + r.x + r.width / 2, outer.y + stage.y + r.y + r.height / 2]; })()`);
    await agentRoundTrip(page, {
      target,
      request: 'Make this my weekend trip list',
      changed: `${store}.readText('project/index.html').includes('Weekend trip')`,
      shows: `${PAGE}?.querySelector('h1')?.textContent === 'Weekend trip: packing list' && ${PAGE}?.body?.innerText?.includes('Make this my weekend trip list')`,
      reply: 'I retitled the page for the weekend trip',
      // The agent's publish reloads the page, which closes the open card (frame-host's own behavior): open its pin.
      openCard: async () => {
        const pin = await page.evaluate(`(() => { const outer = ${FRAME}.getBoundingClientRect(); const doc = ${FRAME}.contentWindow.document; const r = doc.querySelector('[data-comment-layer]')?.shadowRoot?.querySelector('[data-comment-pin]')?.getBoundingClientRect(); return r ? [outer.x + r.x + r.width / 2, outer.y + r.y + r.height / 2] : null; })()`);
        check("the thread's pin is still on the reloaded page", pin);
        if (pin) await page.click(pin[0], pin[1]);
      },
      working: '21-page-agent-working',
      done: '22-page-agent-done',
    });
    check('the reloaded page keeps the db state', await page.waitFor(`[...(${PAGE})?.querySelectorAll('li.done') ?? []].some(l => l.textContent.includes('Phone charger'))`, 5000));
    cleanRun(page);
  } finally {
    await page.close();
  }
}

/** Where `element` (an expression in the editor frame's document) is, in the Shell page's viewport; null if unseen. */
const IN_EDITOR_AT = (element) => `(() => { const f = ${FRAME}; const document = f?.contentWindow?.document; const r = document && (${element})?.getBoundingClientRect(); if (!r?.width) return null; const o = f.getBoundingClientRect(); return [o.x + r.x + r.width / 2, o.y + r.y + r.height / 2]; })()`;
/** A button of the editor frame by its label or text. */
const EDITOR_BUTTON = (name) => `[...document.querySelectorAll('button, [role=menuitem]')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(name)} || b.textContent.trim() === ${JSON.stringify(name)})`;

/** Clicks `element` in the editor frame once it shows; false when it never did. */
async function clickInEditor(page, element, ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const at = await page.evaluate(IN_EDITOR_AT(element));
    if (at) {
      await page.click(at[0], at[1]);
      return true;
    }
    await sleep(200);
  }
  return false;
}

/** Records whether the agent went busy (backend) and whether the Shell or the page said it was working. */
async function watchAgent(page) {
  await page.evaluate(`(() => {
    window.__sawWorking = false;
    window.__agentBusy = false;
    const frame = ${FRAME}.contentWindow.document;
    const look = () => {
      if (document.querySelector('[role=status]')?.textContent.includes('working')) window.__sawWorking = 'shell';
    };
    for (const d of [document, frame]) new MutationObserver(look).observe(d.body, { subtree: true, childList: true, characterData: true, attributes: true });
    window.__PLAYGROUND__.agent.statusChanges.on(s => { if (s.busy) window.__agentBusy = true; });
  })()`);
}

/** The text of one tab of the docs demo, from the Docs host itself (by the tab's name). */
const DOC_TAB_TEXT = (name) => `(() => { const h = window.__PLAYGROUND__.engines.doc.host; const tab = h.project().files.find(f => f.name === ${JSON.stringify(name)}); const lines = []; const walk = bs => { for (const b of bs ?? []) { lines.push((b.inline ?? []).map(i => i.text ?? '').join('')); walk(b.children); } }; walk(h.read(tab.id, { id: 'verify', name: 'verify', role: 'owner' }).doc.blocks); return lines.join('\\n'); })()`;

async function docs(browser) {
  const started = Date.now();
  const page = await openDemo(browser, 'docs', 2500, IN_FRAME("document.body.innerText.includes('Browser smoke test')"));
  try {
    const store = 'window.__PLAYGROUND__.store';
    console.log(`     the Docs editor showed the seeded doc ${Date.now() - started} ms after the page was asked for (settle included)`);
    check('the editor renders the seeded first tab', await page.waitFor(IN_FRAME("document.body.innerText.includes('Docs Browser QA') && document.body.innerText.includes('Second goal')"), 10000));
    check('the tab list names the seeded tabs (Docs host session)', await page.waitFor("window.__PLAYGROUND__.engines.doc.host.project().files.map(f => f.name).sort().join('|') === 'Browser QA Scratch|Review Notes|Tab 1'", 5000));
    check('the engine module loaded on this demo only (its own chunk)', [...page.urls].some((u) => /\/assets\/docHost-[\w-]+\.js$/.test(u)) && ![...page.urls].some((u) => /sheetHost/.test(u)));
    check('the doc is not changed by the agent yet', !(await page.evaluate(`${DOC_TAB_TEXT('Tab 1')}.includes('Updated by the agent')`)) && !(await page.evaluateAll("document.body?.innerText?.includes('Updated by the agent')")).includes(true));
    check('the artifact keeps the seeded doc files', Object.keys(await page.evaluate(`${store}.list()`)).filter((p) => p.startsWith('doc/')).length === 6);
    await shot(page, '23-docs-loaded');

    // A real edit in the editor: type at the end of "Second goal"; the page writes it through doc.call (brokered).
    const goal = "[...document.querySelectorAll('[contenteditable] li, [contenteditable] p')].find(e => e.textContent.trim() === 'Second goal')";
    const at = await page.evaluate(`(() => { const f = ${FRAME}; const r = f.contentWindow.document && (d => (${goal.replaceAll('document', 'd')})?.getBoundingClientRect())(f.contentWindow.document); const o = f.getBoundingClientRect(); return r ? [o.x + r.right - 2, o.y + r.y + r.height / 2] : null; })()`);
    if (at) {
      await page.click(at[0], at[1]);
      await page.press('End');
      await page.type(' typed in the playground');
      check('typing in the editor saves through the Docs host', await page.waitFor(`${DOC_TAB_TEXT('Tab 1')}.includes('Second goal typed in the playground')`, 8000));
      check("the person's edit becomes a version in the artifact's history", await page.waitFor(`${store}.history.list().versions.some(v => v.author.kind === 'person' && v.files.some(f => f.path.startsWith('doc/tabs/')))`, 6000));
      check('the editor says the doc is saved', await page.waitFor(IN_FRAME("document.body.innerText.includes('All changes saved')"), 8000));
    } else check('found "Second goal" to type after', false);

    // Comment on the "Goals" heading from the editor's own comment UI, with "Send to Agent" ticked.
    const heading = "[...document.querySelectorAll('[contenteditable] h1, [contenteditable] h2, [contenteditable] h3, [contenteditable] p')].find(e => e.textContent.trim() === 'Goals')";
    const request = 'Add a line about what this doc is for';
    const placed = await clickInEditor(page, heading);
    check('found the "Goals" heading to comment on', placed);
    await page.press('Home');
    await page.press('End', { shift: true });
    check('the selection toolbar offers Comment', await clickInEditor(page, EDITOR_BUTTON('Comment')));
    const field = "document.querySelector('textarea[aria-label=\"Add a comment\"]')";
    check('the comment composer opens in the editor', await page.waitFor(IN_FRAME(`${field} && document.activeElement === ${field}`), 6000));
    await page.type(request);
    const sendBox = "document.querySelector('[data-send-to-agent] input[type=checkbox]')";
    check('the composer offers "Send to Agent"', await page.waitFor(IN_FRAME(sendBox), 4000), await page.evaluate(IN_FRAME(`${sendBox}?.parentElement?.textContent`)));
    if (!(await page.evaluate(IN_FRAME(`${sendBox}?.checked`)))) await clickInEditor(page, sendBox, 2000);
    check('"Send to Agent" is ticked', await page.evaluate(IN_FRAME(`${sendBox}?.checked === true`)));
    await watchAgent(page);
    // Send with the composer's own Comment button (the nearest one around the text box).
    const submit = `(b => { for (let e = ${field}; e; e = e.parentElement) { const b = e.querySelector('button[aria-label="Comment"]'); if (b) return b; } return null; })()`;
    // The card settles into its place beside the heading after it opens; a click while it still moves can miss the
    // send, so wait for the button to stand still first, and click once more if the card is still open with the text.
    let last = null;
    for (let i = 0; i < 20; i++) {
      const now = JSON.stringify(await page.evaluate(IN_EDITOR_AT(submit)));
      if (now !== 'null' && now === last) break;
      last = now;
      await sleep(250);
    }
    check("the composer's Comment button sends it", await clickInEditor(page, submit, 3000));
    const sentThread = `window.__PLAYGROUND__.comments.list().some(t => t.messages[0].text.includes(${JSON.stringify(request)}))`;
    let reached = await page.waitFor(sentThread, 2500);
    if (!reached && (await page.evaluate(IN_FRAME(`${field}?.value === ${JSON.stringify(request)}`)))) {
      console.log('     (the first click on Comment did not send; clicking it again)');
      await clickInEditor(page, submit, 2000);
      reached = await page.waitFor(sentThread, 5000);
    }
    check('the thread reaches the backend', reached);
    check("the thread is anchored in the doc (the tab's id in its location)", await page.evaluate(`(() => { const t = window.__PLAYGROUND__.comments.list()[0]; const tab = window.__PLAYGROUND__.engines.doc.host.project().files.find(f => f.name === 'Tab 1'); return t?.location?.tab === tab.id; })()`));
    check('the thread is handed to the agent', await page.waitFor('window.__PLAYGROUND__.comments.list().some(t => t.agent)', 5000));
    check('the agent works (backend)', await page.waitFor('window.__agentBusy', 4000));
    await shot(page, '24-docs-agent-working');
    check('the agent writes in the doc through the Docs host', await page.waitFor(`${DOC_TAB_TEXT('Tab 1')}.includes('Updated by the agent: ${request}')`, 8000));
    check('…right under the title line', await page.evaluate(`${DOC_TAB_TEXT('Tab 1')}.split('\\n')[1] === 'Updated by the agent: ${request}'`));
    check("the agent's paragraph shows in the editor live", await page.waitFor(IN_FRAME(`document.body.innerText.includes('Updated by the agent: ${request}')`), 10000));
    check("the person's typing is kept beside it", await page.evaluate(IN_FRAME("document.body.innerText.includes('Second goal typed in the playground')")));
    const reply = 'I added a note near the top of “Tab 1”';
    check('the agent replies in the thread', await page.waitFor(`window.__PLAYGROUND__.comments.list().some(t => t.messages.some(m => m.author.kind === 'agent' && m.text.includes(${JSON.stringify(reply)})))`, 6000));
    check("the reply shows in the editor's comment card", await page.waitFor(IN_FRAME(`document.body.innerText.includes(${JSON.stringify(reply)})`), 8000));
    check("the agent's edit is a version in the Docs host's own history", await page.evaluate(`(async () => { const d = window.__PLAYGROUND__.engines.doc; const tab = d.host.project().files.find(f => f.name === 'Tab 1'); const h = await d.capability.history(tab.id); return h.versions.some(v => v.by === 'agent'); })()`));
    check("…and in the artifact's history", await page.waitFor(`${store}.history.list().versions.some(v => v.author.kind === 'agent')`, 4000));
    check('the Shell shows the agent idle again', await waitTop(page, SHELL_IDLE, 8000));
    await shot(page, '25-docs-agent-done');

    // The agent's next turn writes in another tab.
    await page.evaluate(IN_FRAME("w.openartifact.use('agent').then(a => a.send({ text: 'Note the follow-up in the review notes' }))"));
    check('a second agent turn writes at the end of "Review Notes"', await page.waitFor(`${DOC_TAB_TEXT('Review Notes')}.endsWith('Follow-up from the agent: Note the follow-up in the review notes')`, 8000));
    // The editor's own version history panel (the Shell's History button) opens over the engine's history.
    const historyButton = "document.querySelector('header button[aria-label=\"Version history\"]')";
    if (await page.waitFor(`${historyButton} && !${historyButton}.disabled`, 4000)) {
      await page.evaluate(`${historyButton}.click()`);
      check("the doc's version history opens from the Shell", await page.waitFor(IN_FRAME("[...document.querySelectorAll('aside, [role=dialog], [role=complementary]')].some(e => /history|version/i.test(e.getAttribute('aria-label') ?? '') || /Version history|Current version/.test(e.textContent))"), 6000));
      await shot(page, '26-docs-history');
    } else check('the Shell offers version history', false);
    cleanRun(page);
  } finally {
    await page.close();
  }
}

/** A grid cell of the sheets editor by its exact text (in the editor frame's document). */
const GRID_CELL = (text) => `[...document.querySelectorAll('[role=gridcell]')].find(c => c.textContent.trim() === ${JSON.stringify(text)})`;
/** A cell's value, from the Sheets store itself (an agent read). */
const SHEET_VALUE = (sheet, cell) => `(r => { const v = Object.values(r.rows ?? {})[0]?.[0]; return v && typeof v === 'object' ? v.value : v; })(window.__PLAYGROUND__.engines.sheet.agentRead({ kind: 'readCells', sheet: ${JSON.stringify(sheet)}, range: ${JSON.stringify(cell)} }))`;

async function sheets(browser) {
  const started = Date.now();
  const page = await openDemo(browser, 'sheets', 2500, IN_FRAME("document.body.innerText.includes('Notebook')"));
  try {
    const store = 'window.__PLAYGROUND__.store';
    console.log(`     the Sheets editor showed the seeded workbook ${Date.now() - started} ms after the page was asked for (settle included)`);
    check('the grid renders the seeded workbook', await page.waitFor(IN_FRAME("document.body.innerText.includes('Notebook') && document.body.innerText.includes('Folder') && document.body.innerText.includes('Summary')"), 15000));
    check("the editor's engine works the total out (240)", await page.waitFor(IN_FRAME(`!!${GRID_CELL('240')}`), 10000));
    check('the store (WebAssembly in the page) agrees: Sales!B5 and Summary!B1 are 240', (await page.evaluate(SHEET_VALUE('Sales', 'B5'))) === 240 && (await page.evaluate(SHEET_VALUE('Summary', 'B1'))) === 240);
    const wasm = [...page.urls].filter((u) => u.endsWith('.wasm'));
    check("the store and the editor's worker load one engine file (the editor's own)", wasm.length >= 1 && wasm.every((u) => /\/editors\/sheets\/assets\/open_artifact_sheets_bg-[\w-]+\.wasm$/.test(u)), wasm.join(', '));
    check('the engine module loaded on this demo only (its own chunk)', [...page.urls].some((u) => /\/assets\/sheetHost-[\w-]+\.js$/.test(u)) && ![...page.urls].some((u) => /docHost/.test(u)));
    check('the agent has not changed anything yet', !(await page.evaluateAll(`document.body?.innerText?.includes('1125')`)).includes(true));
    await shot(page, '27-sheets-loaded');

    // A real edit in the grid: Pen's amount 45 → 50; the page sends it (brokered), and the total follows (245).
    if (await clickInEditor(page, GRID_CELL('45'))) {
      await page.type('50');
      await page.press('Enter');
      check('typing in a cell saves through the Sheets store', await page.waitFor(`${SHEET_VALUE('Sales', 'B3')} === 50`, 8000));
      check('…and the formulas follow: the total is 245', await page.waitFor(`${SHEET_VALUE('Sales', 'B5')} === 245`, 4000) && (await page.waitFor(IN_FRAME(`!!${GRID_CELL('245')}`), 6000)));
      check("the person's edit becomes a version in the artifact's history", await page.waitFor(`${store}.history.list().versions.some(v => v.author.kind === 'person' && v.files.some(f => f.path === 'sheet/edits.jsonl'))`, 6000));
    } else check('found the cell "45" to edit', false);
    await page.press('Escape');

    // Comment on the Notebook amount, sent to the agent; it sets Sales!B2 to 1000, so the total becomes 1125.
    const target = await page.evaluate(IN_EDITOR_AT(GRID_CELL('120')));
    if (!target) check('found the cell "120" to comment on', false);
    else
      await agentRoundTrip(page, {
        target,
        request: 'Use the October figure for notebooks',
        changed: `${SHEET_VALUE('Sales', 'B2')} === 1000 && ${SHEET_VALUE('Sales', 'B5')} === 1125 && ${SHEET_VALUE('Summary', 'B1')} === 1125`,
        shows: IN_FRAME(`!!${GRID_CELL('1000')} && !!${GRID_CELL('1125')}`),
        reply: 'the sales total went from 245 to 1,125',
        // The sheets editor reports no working state to the Shell (it says "Sent to Agent" and marks the agent's cells).
        showsWorking: false,
        working: '28-sheets-agent-working',
        done: '29-sheets-agent-done',
      });
    // Close the card: the recalculated total shows under it.
    await page.press('Escape');
    await sleep(600);
    check('the new total shows in the grid', await page.waitFor(IN_FRAME(`(c => !!c && c.getBoundingClientRect().width > 0)(${GRID_CELL('1125')})`), 4000));
    await shot(page, '30-sheets-agent-total');
    // The agent's next turn: Folder 75 → 300, the total 1125 → 1350, worked out by the page's engine too.
    await page.evaluate(IN_FRAME("w.openartifact.use('agent').then(a => a.send({ text: 'Folders sold better than that' }))"));
    check('a second agent turn changes another amount (backend total 1350)', await page.waitFor(`${SHEET_VALUE('Sales', 'B4')} === 300 && ${SHEET_VALUE('Sales', 'B5')} === 1350`, 8000));
    check('…and the grid shows the new total live', await page.waitFor(IN_FRAME(`!!${GRID_CELL('1350')}`), 8000));
    check("the agent's edit is a revision by the agent in the store's log", await page.evaluate("(() => { const f = window.__PLAYGROUND__.engines.sheet.files(); const lines = new TextDecoder().decode(f['sheet/edits.jsonl']).trim().split('\\n'); return JSON.parse(lines.at(-1)).by === 'agent'; })()"));
    check("…and a version in the artifact's history", await page.waitFor(`${store}.history.list().versions.some(v => v.author.kind === 'agent')`, 4000));
    // The editor's own version history (the Shell's History button) reads the store's versions.
    const historyButton = "document.querySelector('header button[aria-label=\"Version history\"]')";
    if (await page.waitFor(`${historyButton} && !${historyButton}.disabled`, 4000)) {
      await page.evaluate(`${historyButton}.click()`);
      check("the workbook's version history opens from the Shell", await page.waitFor(IN_FRAME("/Version history|Current version|versions/i.test(document.body.innerText)"), 6000));
      await shot(page, '31-sheets-history');
    } else check('the Shell offers version history', false);
    cleanRun(page);
  } finally {
    await page.close();
  }
}

/** The landing page lists every demo and links to its own page; a demo's page has the hint bar and its way back. */
async function landing(browser) {
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

const ONLY = process.env.ONLY?.split(',');
const RUNS = { landing, whiteboard, slides, design, 'design-system': designSystem, data, motion, page: pageType, docs, sheets };
const browser = await launch({ width: 1440, height: 900 });
try {
  for (const [type, run] of Object.entries(RUNS)) if (!ONLY || ONLY.includes(type)) await run(browser);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
