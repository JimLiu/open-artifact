// What the playground's checks share (`../verify.mjs` runs them; one file per demo beside this one): the page helpers,
// the comment round trip through a page's own comment UI, and a demo's replay from start to end.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../../../../e2e/lib/browser.mjs';

export { launch };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, '..', '..', '.spike-shots');
export const BASE = new URL(process.argv[2] ?? 'http://127.0.0.1:5190/');
/** A demo's page. */
export const demoUrl = (type) => new URL(process.env.ROUTES === 'query' ? `demo.html?type=${type}` : `${type}/`, BASE).href;
export const DEMOS = ['slides', 'design', 'design-system', 'whiteboard', 'sheets', 'data', 'docs', 'motion', 'page'];
fs.mkdirSync(SHOTS, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const results = [];
export function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}
/** Wait until `expression` is truthy in the Shell page itself (not in any of its frames); false after `ms`. */
export async function waitTop(page, expression, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await page.evaluate(`Boolean(${expression})`)) return true;
    await sleep(200);
  }
  return false;
}
export const SHELL_IDLE = "!document.querySelector('[role=status]')?.textContent.includes('working')";

export async function shot(page, name) {
  const { data } = await page.cdp('Page.captureScreenshot', { format: 'png' });
  const file = path.join(SHOTS, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`     screenshot ${path.relative(process.cwd(), file)}`);
}

/** The editor's frame, from the Shell page (same origin). */
export const FRAME = "window.document.querySelector('iframe[name=open-artifact-shell]')";
export const IN_FRAME = (expr) => `(() => { const w = ${FRAME}?.contentWindow; const document = w?.document; if (!document) return null; return (${expr}); })()`;
/** The comment layer's shadow root (the one showing a card, if any): `data-comment-layer`, or editor-kit's default mark. */
export const LAYER = "(roots => roots.find(r => r.querySelector('[data-comment-card]')) ?? roots[0])([...window.document.querySelectorAll('[data-comment-layer], [data-comments-layer]')].map(e => e.shadowRoot).filter(Boolean))";
export const SEND_BOX = `[...(${LAYER})?.querySelectorAll('[data-comment-card] [role=checkbox]') ?? []].find(e => /^Send to /.test(e.textContent.trim()))`;

/** Requests to anything but this server (and data:/blob: URLs) are stray. */
export function strayRequests(page) {
  return [...page.urls].filter((u) => !u.startsWith(BASE.origin) && !/^(data|blob|about):/.test(u));
}

/** Opens the comment composer at (x, y) (Shell's Comments toggle, then a click on the page), types, ticks "Send to", sends. */
export async function commentToAgent(page, [x, y], text) {
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

/** Some frame's text (the Shell, the editor, an artboard or page frame nested in it) includes `text`. */
export const ANY_TEXT = (text) => `document.body?.innerText?.includes(${JSON.stringify(text)})`;
/**
 * The comment round trip every new demo shares: a comment at `target` sent to the agent reaches the backend and the
 * agent, the agent works, the backend changes (`changed`), the page shows it (`shows`), and the reply (`reply`, a piece
 * of the demo's scripted reply) lands in the thread and in the comment card.
 */
export async function agentRoundTrip(page, { target, request, changed, shows, reply, working, done, showsWorking = true, openCard = null }) {
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
export function cleanRun(page) {
  const stray = strayRequests(page);
  check('no request leaves for another host', stray.length === 0, stray.join(', '));
  check('no page problems', page.problems.length === 0, page.problems.join(' | '));
}

export async function openDemo(browser, type, settle = 2500, ready = `${FRAME}?.contentWindow?.document?.body?.innerText?.length > 0`) {
  console.log(`\n# ${type}`);
  const page = await browser.load(demoUrl(type), { ready, timeout: 30000, settle });
  check('the Shell cover is gone', await page.waitFor("window.top === window && !document.querySelector('[data-shell-loading]')", 10000));
  return page;
}


/** Where `element` (an expression in the editor frame's document) is, in the Shell page's viewport; null if unseen. */
export const IN_EDITOR_AT = (element) => `(() => { const f = ${FRAME}; const document = f?.contentWindow?.document; const r = document && (${element})?.getBoundingClientRect(); if (!r?.width) return null; const o = f.getBoundingClientRect(); return [o.x + r.x + r.width / 2, o.y + r.y + r.height / 2]; })()`;
/** A button of the editor frame by its label or text. */
export const EDITOR_BUTTON = (name) => `[...document.querySelectorAll('button, [role=menuitem]')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(name)} || b.textContent.trim() === ${JSON.stringify(name)})`;

/** Clicks `element` in the editor frame once it shows; false when it never did. */
export async function clickInEditor(page, element, ms = 8000) {
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
export async function watchAgent(page) {
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

const REPLAY = "document.querySelector('.pg-replay')";
/** A demo's page with its replay (`?replay=1`). */
const replayUrl = (type) => `${demoUrl(type)}${demoUrl(type).includes('?') ? '&' : '?'}replay=1`;

/**
 * A demo's replay (`<demo>/?replay=1`), in a window about the size of the home page's stage (1200 × 720), start to end:
 * the request types itself into the session, the agent creates the artifact and builds it, a comment is left, sent and
 * answered, and the page is free. Then once more with a skip, which must end with the same. `changed`: an expression
 * true (in some frame) once the agent's answer to the comment has changed the artifact in the backend; `shows`: one
 * true once the page shows that change; `built`: one true once the page shows the artifact the build ends with.
 * Screenshots: `replay-<type>-1-building`, `-2-built`, `-3-comment`, `-4-done`, `-5-skipped`.
 */
export async function replay(type, { built, changed, shows } = {}) {
  console.log(`\n# ${type}: replay`);
  const browser = await launch({ width: 1200, height: 720 });
  try {
    const page = await browser.load(replayUrl(type), { ready: `window.top === window && !!${REPLAY}`, timeout: 30000, settle: 0 });
    try {
      check('the replay starts with the page covered', await page.evaluate(`${REPLAY}.dataset.state === 'playing' && !document.querySelector('.pg-shield').hidden`));
      check('the request types itself into the session', await waitTop(page, `document.querySelector('.pg-user')?.textContent.includes('/open-artifact ${type} ')`, 15000));
      check('the agent creates the artifact and the page shows', await waitTop(page, "document.querySelector('.pg-cover').hasAttribute('data-gone')", 20000));
      await sleep(1500);
      await shot(page, `replay-${type}-1-building`);
      check('the agent says what it made', await waitTop(page, "!!document.querySelector('.pg-said')", 40000));
      if (built) check('the page shows what the agent built', await page.waitFor(built, 10000));
      await shot(page, `replay-${type}-2-built`);
      check('a comment card opens over the page', await waitTop(page, "(n => n && !n.hidden)(document.querySelector('.pg-note'))", 10000));
      check('the comment is sent to the agent', await waitTop(page, 'window.__PLAYGROUND__.comments.list().some(t => t.agent)', 20000));
      await sleep(400);
      await shot(page, `replay-${type}-3-comment`);
      check('the replay ends with the page free', await waitTop(page, `${REPLAY}.dataset.state === 'done' && document.querySelector('.pg-shield').hidden`, 30000));
      check('the agent answered the comment', await page.evaluate("window.__PLAYGROUND__.comments.list().some(t => t.agent?.status === 'replied' && t.messages.some(m => m.author.kind === 'agent'))"));
      check('the session shows the agent’s turn', await page.evaluate("!!document.querySelector('.pg-event') && document.querySelectorAll('.pg-tool').length > 4 && !document.querySelector('.pg-tool[data-run]')"));
      if (changed) check('the agent changed the artifact (backend)', await page.waitFor(changed, 5000));
      if (shows) check('the change shows on the page', await page.waitFor(shows, 10000));
      await sleep(800);
      await shot(page, `replay-${type}-4-done`);
      cleanRun(page);
    } finally {
      await page.close();
    }
    const skipped = await browser.load(replayUrl(type), { ready: `window.top === window && !!${REPLAY}`, timeout: 30000, settle: 300 });
    try {
      await skipped.evaluate("document.querySelector('.pg-skip').click()");
      check('a skip ends the replay at once', await waitTop(skipped, `${REPLAY}.dataset.state === 'done' && document.querySelector('.pg-shield').hidden`, 15000));
      check('…with the comment answered', await skipped.evaluate("window.__PLAYGROUND__.comments.list().some(t => t.agent?.status === 'replied')"));
      if (changed) check('…and the artifact as the agent left it (backend)', await skipped.waitFor(changed, 5000));
      if (shows) check('…which the page shows', await skipped.waitFor(shows, 15000));
      await sleep(800);
      await shot(skipped, `replay-${type}-5-skipped`);
      check('no page problems after a skip', skipped.problems.length === 0, skipped.problems.join(' | '));
    } finally {
      await skipped.close();
    }
  } finally {
    await browser.close();
  }
}
