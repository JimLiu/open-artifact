// End-to-end test of making an artifact without an agent, in Chrome: a real daemon (in this process, from source, in a
// temporary home) and no agent session at all. The home page's "New" makes a blank doc, which opens in its editor
// rather than the empty state with the hand-over prompt; an empty whiteboard made earlier opens on the empty state,
// and its "Start blank" opens the editor. An empty design's hand-over prompt carries what the person types it should be. A blank Design System's "Start by hand" goes to its Colors section. Design stays
// in the "make with an agent" group. What is sent from a blank doc no session owns waits, and a session that adopts it
// later gets it; with a session online, the Ask pane hands the artifact to it and it gets the message at once. A message
// the Ask pane shows as waiting for the session shows as delivered once the session has it.
//
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { until } from './lib/http.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 90000 };
/** The Shell framed the artifact's page, and the empty state is not shown. */
const IN_EDITOR = "location.pathname.startsWith('/a/') && !!document.querySelector('iframe[name]') && !document.querySelector('[data-testid=empty-artifact]')";
/** The Shell's save indicator: '' once nothing waits to be saved. */
const SAVE_STATE = "[...document.querySelectorAll('header [data-shell-save-state]')].map(e => e.dataset.shellSaveState).join(',')";
/** A button (or menu item) by its visible text or its aria-label. */
const buttonNamed = name =>
  `[...document.querySelectorAll('button, [role="menuitem"]')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(name)} || b.textContent.trim() === ${JSON.stringify(name)})`;
/** `expression` in the artifact's own page, the one the Shell frames (the first frame where it is not undefined or null). */
const framed = async (page, expression) => (await page.evaluateAll(`window !== top ? (${expression}) : undefined`).catch(() => [])).find(v => v !== undefined && v !== null);
/** Every file under `dir`, by its path there, with its text. */
function readTree(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir, { recursive: true }).sort()) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isFile()) out[name] = fs.readFileSync(file, 'utf8');
  }
  return out;
}

function skip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  for (const ui of ['shell', 'home']) {
    if (!fs.existsSync(path.join(repoRoot, 'dist', 'daemon', ui, 'index.html'))) return `the ${ui} page is not built (npm run build)`;
  }
  return false;
}

/** A TCP port nobody listens on now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

describe('making an artifact without an agent', { skip: skip() }, () => {
  const ctx = {};
  /** A real click in the middle of the element `selector` of the top page, once it has stopped moving. */
  const clickOn = async (page, selector) => {
    const box = await page.evaluate(`(async () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      let last = null;
      for (let i = 0; i < 20; i++) {
        await frame();
        const r = el.getBoundingClientRect();
        const now = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        if (last && last.x === now.x && last.y === now.y) return now;
        last = now;
      }
      return last;
    })()`);
    assert.ok(box, `nothing matches ${selector}`);
    await page.click(box.x, box.y);
  };
  /** Where the Shell draws the artifact's frame. */
  const frameOrigin = page => page.evaluate("(() => { const r = document.querySelector('iframe[name]').getBoundingClientRect(); return [r.x, r.y]; })()");
  /** The middle of `element` (an expression) in the framed page, in the tab's viewport, once it has a box. */
  const pointInFrame = async (page, element, ms = 10000) => {
    let at = null;
    await until(async () => (at = await framed(page, `(() => { const e = ${element}; if (!e) return null; e.scrollIntoView?.({ block: 'nearest' }); const r = e.getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null; })()`)), ms).catch(() => {});
    assert.ok(at, `nothing in the framed page matches ${element}`);
    const [fx, fy] = await frameOrigin(page);
    return [fx + at[0], fy + at[1]];
  };
  /** A real click on `element` (an expression) in the framed page. */
  const clickInFrame = async (page, element) => page.click(...(await pointInFrame(page, element)));
  /** Waits for the Shell to say everything is saved. */
  const saved = async page => assert.ok(await page.waitFor(`${SAVE_STATE} === ''`, 15000), `still saving: ${await page.evaluate(SAVE_STATE)}`);

  /**
   * The home page's New: picks `typeId` in the "start by hand" group, names it `title` and makes it. Resolves the page
   * (in the editor, still open) and the new artifact's id, once it is checked as owned by nobody.
   */
  const newFromHome = async (typeId, title) => {
    const page = await ctx.browser.load(`${ctx.daemon.origin}/`, { ready: "!!document.querySelector('[data-testid=new-artifact]:not([disabled])')", ignore: [/favicon\.ico/] });
    assert.deepEqual(page.problems, []);
    await clickOn(page, '[data-testid=new-artifact]');
    assert.ok(await page.waitFor("!!document.querySelector('[data-testid=create-form]')", 10000), 'the dialog opened');
    assert.equal(await page.evaluate(`!!document.querySelector('[data-testid=create-group-blank] [data-type-id=${typeId}]')`), true, `${typeId} is in the "start by hand" group`);
    await clickOn(page, `[data-testid=create-type][data-type-id=${typeId}]`);
    assert.ok(await page.waitFor(`document.querySelector('[data-testid=create-type][data-type-id=${typeId}]')?.getAttribute('aria-checked') === 'true'`, 5000), `${typeId} is chosen`);
    await clickOn(page, '[data-testid=create-form] input[name=title]');
    await page.type(title);
    await clickOn(page, '[data-testid=create-form] button[type=submit]');
    assert.ok(await page.waitFor(IN_EDITOR, 30000), `not in the editor: ${await page.evaluate("location.href + ' ' + (document.querySelector('[role=alert]')?.textContent ?? '') + (document.querySelector('[data-testid=empty-artifact]') ? ' (empty state)' : '')")}`);
    const id = await page.evaluate("location.pathname.split('/')[2]");
    const record = ctx.daemon.store.require(id);
    assert.equal(record.type, typeId);
    assert.equal(record.owner, null);
    assert.equal(record.createdBy, null);
    assert.ok(record.root.startsWith(ctx.workspace), record.root);
    return { page, id, root: record.root };
  };
  /** How many elements the whiteboard draws (undefined until it draws). */
  const countNotes = page => framed(page, "document.querySelector('.wb-elements') ? document.querySelectorAll('.wb-elements [data-wb-id]').length : undefined");
  /** What waits in the unowned inbox for `id`. */
  const waitingFor = (id) => ctx.daemon.inbox.peek('unowned').filter((m) => m.artifactId === id);
  /** The artifact's page in the Shell again, as after a reload: a new tab, `ready` an expression in the framed page. */
  const reopen = async (id, ready, show = 'document.body.innerText.slice(0, 300)') => {
    const page = await ctx.browser.load(`${ctx.daemon.origin}/a/${id}`, { ready: "!!document.querySelector('iframe[name]')", ignore: [/favicon\.ico/] });
    assert.ok(await until(() => framed(page, `(${ready}) || null`), 30000), `after the reload, not shown: ${ready}; the page shows ${await framed(page, show)}`);
    return page;
  };

  before(async () => {
    const tmp = tmpDir('home-new');
    ctx.home = path.join(tmp, 'home');
    ctx.workspace = path.join(tmp, 'home-workspace');
    fs.mkdirSync(ctx.home, { recursive: true });
    // The home page creates in the home workspace: here, not ~/OpenArtifact.
    fs.writeFileSync(path.join(ctx.home, 'settings.json'), JSON.stringify({ homeWorkspace: ctx.workspace }));
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION', 'OPEN_ARTIFACT_TRUST_PROJECTS']) delete process.env[name];
    const port = await freePort();
    Object.assign(process.env, {
      OPEN_ARTIFACT_HOME: ctx.home,
      OPEN_ARTIFACT_USER_TYPES: path.join(tmp, 'types'),
      OPEN_ARTIFACT_INSTALLED_TYPES: path.join(tmp, 'installed-types'),
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmp, 'servers'),
      OPEN_ARTIFACT_PORT: String(port),
    });
    const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
    ctx.daemon = await startDaemon({ port, idleMs: 0, quiet: true, browse: null });
    ctx.browser = await launch({ width: 1100, height: 800 });
  });

  after(async () => {
    await ctx.browser?.close();
    await ctx.daemon?.close();
    removeTmp();
  });

  it('New → Docs makes a blank doc and opens its editor, owned by nobody', T, async () => {
    const { page, root } = await newFromHome('docs', 'Meeting notes');
    try {
      assert.ok(fs.existsSync(path.join(root, 'doc', 'doc.json')), 'the doc has its starting files');
    } finally {
      await page.close();
    }
    // Design is offered too, in the "make with an agent" group.
    const home = await ctx.browser.load(`${ctx.daemon.origin}/`, { ready: "!!document.querySelector('[data-testid=new-artifact]:not([disabled])')", ignore: [/favicon\.ico/] });
    try {
      await clickOn(home, '[data-testid=new-artifact]');
      assert.ok(await home.waitFor("!!document.querySelector('[data-testid=create-form]')", 10000));
      assert.equal(await home.evaluate("!!document.querySelector('[data-testid=create-group-agent] [data-type-id=design]')"), true);
    } finally {
      await home.close();
    }
  });

  // The way out of this stage, in a browser with no agent at all: make a doc, write in it, comment and send that to the
  // agent; it is all still there after a reload; a session that takes the doc later gets the comment, once.
  it('no agent: New → Docs, write, comment and Send to agent; a reload keeps both; a session that adopts it gets the comment once', T, async () => {
    const words = 'The ferry leaves at nine.';
    const comment = 'Say when the last one leaves';
    const { page, id, root } = await newFromHome('docs', 'Ferry notes');
    try {
      // Write a line in the blank doc.
      await clickInFrame(page, "document.querySelector('.doc-text p')");
      await page.type(words);
      assert.ok(await page.waitFor(`document.querySelector('.doc-text')?.innerText.includes(${JSON.stringify(words)})`, 5000), 'the line is not in the doc');
      await saved(page);
      assert.ok(await until(() => Object.values(readTree(path.join(root, 'doc'))).some(text => text.includes(words)), 10000), 'the line is not on disk');
      // Comment on it, sent to the agent.
      await page.press('Home');
      await page.press('End', { shift: true });
      await clickInFrame(page, buttonNamed('Comment'));
      const field = 'textarea[aria-label="Add a comment"]';
      assert.ok(await page.waitFor(`document.activeElement?.matches('${field}')`, 5000), 'no comment box');
      const sendBox = "document.querySelector('[data-comment-card=new] [data-send-to-agent] input')";
      assert.ok(await page.waitFor(`!!${sendBox}`, 5000), '"Send to agent" is not offered on an artifact no session owns');
      if (!(await framed(page, `${sendBox}?.checked`))) await clickInFrame(page, sendBox);
      assert.ok(await page.waitFor(`${sendBox}?.checked === true`, 5000), '"Send to agent" did not check');
      await page.type(comment);
      await page.press('Enter');
      assert.ok(await page.waitFor(`!document.querySelector('${field}')`, 5000), 'the comment was not posted');
      // Nobody owns the doc: the comment waits for whoever takes it (after the merge window).
      assert.ok(await until(() => waitingFor(id).length === 1, 10000), `waiting: ${waitingFor(id).length}`);
      assert.equal(ctx.daemon.store.require(id).owner, null);
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
    const again = await reopen(id, `document.querySelector('.doc-text')?.innerText.includes(${JSON.stringify(words)})`);
    try {
      assert.ok(await until(() => framed(again, `[...document.querySelectorAll('[data-comment-card]')].some(c => c.innerText.includes(${JSON.stringify(comment)})) || null`), 10000), 'the comment is not shown after the reload');
      assert.deepEqual(again.problems, []);
    } finally {
      await again.close();
    }
    const waiting = waitingFor(id);
    assert.equal(waiting.length, 1, 'still once, after the reload');
    // Docs sends a comment thread as an edit request.
    assert.match(waiting[0].text, /^\[Artifact (comment|edit request) sent to agent\]/);
    // Later, a session adopts the doc: its result carries the comment, once.
    const caller = { harness: 'e2e-agent', session: 'takes-the-doc', workspace: ctx.workspace };
    const adopted = await ctx.daemon.tools.call('Artifact', { action: 'adopt', url: `open-artifact://artifact/${id}` }, caller);
    assert.equal(adopted.error, undefined, JSON.stringify(adopted.error));
    assert.equal(adopted.messages?.length, 1, JSON.stringify(adopted.messages));
    assert.match(adopted.messages[0], /^\[Open Artifact\] The person made .* it is yours now/);
    assert.match(adopted.messages[0], /\n\[Artifact (comment|edit request) sent to agent\]/);
    assert.ok(adopted.messages[0].includes(comment), adopted.messages[0]);
    assert.equal(waitingFor(id).length, 0);
    assert.equal((await ctx.daemon.tools.call('Artifact', { action: 'list' }, caller)).messages, undefined, 'not a second time');
    // What it reads is what the person wrote.
    const threads = await ctx.daemon.tools.call('ArtifactComments', { action: 'read', url: `open-artifact://artifact/${id}` }, caller);
    assert.ok(JSON.stringify(threads).includes(comment), JSON.stringify(threads).slice(0, 400));
  });

  it('New → Sheets: a cell typed in the blank sheet is still there after a reload', T, async () => {
    const { page, id, root } = await newFromHome('sheets', 'Exit budget');
    const text = 'Ferry fares';
    const cell = "document.querySelector('[role=gridcell]')";
    try {
      const before = JSON.stringify(readTree(path.join(root, 'sheet')));
      await clickInFrame(page, cell);
      await page.type(text);
      await page.press('Enter');
      assert.ok(await page.waitFor(`${cell}?.textContent === ${JSON.stringify(text)}`, 5000), 'A1 does not show the text');
      await saved(page);
      assert.ok(await until(() => JSON.stringify(readTree(path.join(root, 'sheet'))) !== before, 10000), 'nothing was written to the sheet on disk');
      assert.ok(await until(() => JSON.stringify(readTree(root)).includes(text), 10000), `the text is not on disk: ${JSON.stringify(readTree(path.join(root, 'sheet'))).slice(0, 600)}`);
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
    const again = await reopen(id, `${cell}?.textContent === ${JSON.stringify(text)}`, "JSON.stringify([...document.querySelectorAll('[role=gridcell]')].slice(0, 4).map(c => c.textContent))");
    try {
      assert.deepEqual(again.problems, []);
    } finally {
      await again.close();
    }
    assert.equal(ctx.daemon.store.require(id).owner, null, 'editing by hand made nobody its owner');
  });

  it('New → Slides: a slide added to the blank deck is still there after a reload', T, async () => {
    const { page, id, root } = await newFromHome('slides', 'Exit deck');
    const deckFile = path.join(root, 'project', 'deck.json');
    const order = () => JSON.parse(fs.readFileSync(deckFile, 'utf8')).order ?? [];
    try {
      assert.deepEqual(order(), [], 'the blank deck has no slides');
      assert.ok(await page.waitFor(`!!${buttonNamed('Add slide')}`, 15000), 'no Add slide');
      await clickInFrame(page, buttonNamed('Add slide'));
      // Adding may ask for a layout first.
      const layout = "document.querySelector('[role=dialog] [data-layout], [role=menu] [role=menuitem], [role=listbox] [role=option]')";
      if (await page.waitFor(`!!${layout}`, 2000)) await clickInFrame(page, layout);
      assert.ok(await until(() => order().length === 1, 10000), `deck order: ${JSON.stringify(order())}`);
      await saved(page);
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
    const slideFile = path.join(root, 'project', 'slides', `${order()[0]}.html`);
    assert.ok(fs.existsSync(slideFile), `${slideFile} was written`);
    const again = await reopen(id, `document.querySelectorAll('[data-open-artifact-thumbs] [data-slide-index]').length === 1`);
    try {
      assert.equal(order().length, 1);
      assert.deepEqual(again.problems, []);
    } finally {
      await again.close();
    }
    assert.equal(ctx.daemon.store.require(id).owner, null);
  });

  it('an empty whiteboard opens on the empty state; Start blank opens its editor, and a note added there is kept', T, async () => {
    // Made empty, as artifacts.create without blank makes one (what New did before for every type).
    const made = await fetch(`${ctx.daemon.origin}/api/open-artifact.artifacts.create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ctx.daemon.origin },
      body: JSON.stringify({ type: 'whiteboard', title: 'Retro' }),
    }).then((r) => r.json());
    assert.ok(made.id, JSON.stringify(made));
    const page = await ctx.browser.load(`${ctx.daemon.origin}/a/${made.id}`, { ready: "!!document.querySelector('[data-testid=start-blank]')", ignore: [/favicon\.ico/] });
    try {
      assert.deepEqual(page.problems, []);
      assert.equal(await page.evaluate("!!document.querySelector('[data-testid=empty-artifact-prompt]')?.value"), true, 'the hand-over prompt is there too');
      await clickOn(page, '[data-testid=start-blank]');
      assert.ok(await page.waitFor(IN_EDITOR, 30000), `not in the editor: ${await page.evaluate("document.querySelector('[data-testid=empty-artifact] [role=status]')?.textContent ?? ''")}`);
      const record = ctx.daemon.store.require(made.id);
      assert.equal(record.owner, null);
      assert.ok(fs.existsSync(path.join(record.root, 'db', 'board', 'meta.json')), 'the board has its starting files');
      // A note from the board's own menu, on an empty spot: it is written, and still there after a reload.
      assert.equal(await until(async () => (await countNotes(page)) === 0, 15000), true, 'the board is not drawn empty');
      const stored = () => JSON.stringify(readTree(path.join(record.root, 'db')));
      const start = stored();
      const spot = `(() => {
        if (!document.querySelector('.wb-elements')) return undefined;
        // Nearest the middle first: the corners hold the board's own panels.
        const spots = [];
        for (let py = 140; py < innerHeight - 140; py += 40) for (let px = 60; px < innerWidth - 60; px += 40) spots.push([px, py]);
        spots.sort((a, b) => Math.hypot(a[0] - innerWidth / 2, a[1] - innerHeight / 2) - Math.hypot(b[0] - innerWidth / 2, b[1] - innerHeight / 2));
        for (const [px, py] of spots) if (document.elementFromPoint(px, py)?.matches('.wb-surface')) return [px, py];
        return null;
      })()`;
      let empty = null;
      await until(async () => (empty = await framed(page, spot)), 10000);
      assert.ok(empty, `no empty spot on the board: ${await framed(page, "document.querySelector('.wb-elements') ? document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.outerHTML.slice(0, 300) : undefined")}`);
      const [fx, fy] = await frameOrigin(page);
      const item = "[...document.querySelectorAll('[role=menuitem]')].find(e => e.textContent.trim().startsWith('Add a note here'))";
      // Right away: the board's page has only just loaded (a right-click in its first second once opened nothing).
      await page.rightClick(fx + empty[0], fy + empty[1]);
      const menu = await until(() => framed(page, `${item} ? true : undefined`), 5000);
      assert.ok(menu, `no "Add a note here" in the board menu: ${await framed(page, `document.querySelector('.wb-elements') ? [...document.querySelectorAll('[role=menu]')].map(e => e.textContent).join('|') || 'no menu' : undefined`)}`);
      await clickInFrame(page, item);
      assert.ok(await until(async () => (await countNotes(page)) === 1, 5000), 'the note was not added');
      await page.type('Keep the ferry');
      await page.press('Escape');
      assert.ok(await until(() => stored() !== start, 10000), 'the note was not written to the board');
      await saved(page);
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
    const again = await reopen(made.id, "document.querySelectorAll('.wb-elements [data-wb-id]').length === 1");
    try {
      assert.ok(await until(() => framed(again, "document.querySelector('.wb-elements')?.innerText.includes('Keep the ferry') || null"), 10000), 'the note text is not shown after the reload');
      assert.deepEqual(again.problems, []);
    } finally {
      await again.close();
    }
    assert.equal(ctx.daemon.store.require(made.id).owner, null);
  });

  it('a blank Design System: its welcome page\'s Start by hand goes to the Colors section', T, async () => {
    const made = await fetch(`${ctx.daemon.origin}/api/open-artifact.artifacts.create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ctx.daemon.origin },
      body: JSON.stringify({ type: 'design-system', title: 'Brand', blank: true }),
    }).then((r) => r.json());
    assert.ok(made.id, JSON.stringify(made));
    const button = "document.querySelector('[data-testid=ds-start-by-hand]')";
    const colorsTop = "document.getElementById('ds-page-colors')?.getBoundingClientRect().top";
    const page = await ctx.browser.load(`${ctx.daemon.origin}/a/${made.id}`, { ready: `!!${button}`, ignore: [/favicon\.ico/] });
    try {
      assert.deepEqual(page.problems, []);
      const inFrame = async (expression) => (await page.evaluateAll(`${button} ? (${expression}) : undefined`)).find((v) => v !== undefined);
      const before = await inFrame(colorsTop);
      assert.ok(before > 300, `Colors starts below the welcome page (${before})`);
      await inFrame(`(${button}.click(), true)`);
      assert.ok(await page.waitFor(`${button} && ${colorsTop} < 200`, 10000), `Colors is not in view: ${await inFrame(colorsTop)}`);
    } finally {
      await page.close();
    }
  });

  /** A blank doc made the way the home page makes one: owned by nobody. */
  const blankDoc = async (title) => {
    const made = await fetch(`${ctx.daemon.origin}/api/open-artifact.artifacts.create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ctx.daemon.origin },
      body: JSON.stringify({ type: 'docs', title, blank: true }),
    }).then((r) => r.json());
    assert.ok(made.id, JSON.stringify(made));
    assert.equal(ctx.daemon.store.require(made.id).owner, null);
    return made.id;
  };
  /** What the Ask pane says under each message it sent ("just now · delivered", ...). */
  const SENT_STATE = "[...document.querySelectorAll('aside ol li span')].map(s => s.textContent).join(' | ')";
  /** Types `text` in the Ask pane's box and sends it. */
  const sendFromPane = async (page, text) => {
    await clickOn(page, 'aside form textarea');
    await page.type(text);
    await clickOn(page, 'aside form button[type=submit]');
  };
  it('Send to agent from a blank doc with no agent: the message waits, and a session that adopts it later gets it once', T, async () => {
    const id = await blankDoc('Plan');
    const page = await ctx.browser.load(`${ctx.daemon.origin}/a/${id}?ask=1`, { ready: "!!document.querySelector('[data-testid=assign-none]')", ignore: [/favicon\.ico/] });
    try {
      assert.deepEqual(page.problems, []);
      // No session online: the pane offers the take-over prompt.
      assert.match(await page.evaluate("document.querySelector('[data-testid=assign-none] textarea').value"), /Artifact \{action: "adopt"/);
      await sendFromPane(page, 'Add a summary at the top');
      const waited = await page.waitFor("!!document.querySelector('aside ol li')", 10000);
      assert.ok(waited, 'the pane shows it was sent');
    } finally {
      await page.close();
    }
    const waiting = waitingFor(id);
    assert.equal(waiting.length, 1, 'it waits in the unowned inbox');
    assert.match(waiting[0].text, /Add a summary at the top/);
    // Later, an agent session adopts it: the adopt's result carries the message, and only it.
    const caller = { harness: 'e2e-agent', session: 'adopts-later', workspace: ctx.workspace };
    const adopted = await ctx.daemon.tools.call('Artifact', { action: 'adopt', url: `open-artifact://artifact/${id}` }, caller);
    assert.equal(adopted.error, undefined, JSON.stringify(adopted.error));
    assert.equal(adopted.messages?.length, 1, JSON.stringify(adopted.messages));
    assert.match(adopted.messages[0], /The person made .* it is yours now/);
    assert.match(adopted.messages[0], /Add a summary at the top/);
    assert.equal(waitingFor(id).length, 0);
    assert.equal((await ctx.daemon.tools.call('Artifact', { action: 'list' }, caller)).messages, undefined, 'not a second time');
  });

  it('with a session online, the Ask pane hands the artifact to it, and it gets what was sent at once', T, async () => {
    const id = await blankDoc('Brief');
    const ref = { harness: 'e2e-agent', session: 'online-now', workspace: ctx.workspace };
    const page = await ctx.browser.load(`${ctx.daemon.origin}/a/${id}?ask=1`, { ready: "!!document.querySelector('[data-testid=assign-none]')", ignore: [/favicon\.ico/] });
    try {
      await sendFromPane(page, 'Make the title shorter');
      assert.ok(await page.waitFor("!!document.querySelector('aside ol li')", 10000));
      // A session comes online: the pane lists it.
      const { key } = ctx.daemon.harnesses.pollAttach({ harness: ref.harness, session: ref.session, workspace: ref.workspace });
      assert.ok(await page.waitFor(`document.querySelector('[data-testid=assign-session]')?.value === ${JSON.stringify(key)}`, 10000), 'the online session is offered');
      await clickOn(page, '[data-testid=assign-button]');
      const polled = await ctx.daemon.harnesses.pollWait({ ...ref, timeoutMs: 10000 });
      assert.equal(polled.messages.length, 1);
      assert.match(polled.messages[0].text, /The person picked this session/);
      assert.match(polled.messages[0].text, /Make the title shorter/);
      assert.deepEqual(ctx.daemon.store.require(id).owner, ref);
      // The pane now shows the owner, not the choice, and the message as delivered.
      assert.ok(await page.waitFor("!document.querySelector('[data-testid=assign-box]')", 10000), 'the choice is gone');
      assert.ok(await page.waitFor(`${SENT_STATE}.endsWith('delivered')`, 10000), `the pane says ${await page.evaluate(SENT_STATE)}`);
      assert.equal(waitingFor(id).length, 0);
      ctx.daemon.harnesses.pollDetach(ref);
    } finally {
      await page.close();
    }
  });

  it('the owner session is away: the message waits, and shows as delivered once the session takes it', T, async () => {
    const id = await blankDoc('Away');
    const owner = { harness: 'e2e-agent', session: 'away-now', workspace: ctx.workspace };
    await ctx.daemon.tools.call('Artifact', { action: 'adopt', url: `open-artifact://artifact/${id}` }, owner);
    const page = await ctx.browser.load(`${ctx.daemon.origin}/a/${id}?ask=1`, { ready: "!!document.querySelector('aside form textarea')", ignore: [/favicon\.ico/] });
    try {
      await sendFromPane(page, 'Add a summary at the top');
      assert.ok(await page.waitFor(`${SENT_STATE}.endsWith('waiting for the session')`, 10000), `the pane says ${await page.evaluate(SENT_STATE)}`);
      // The session comes back and makes a call: the call's result carries the message.
      const result = await ctx.daemon.tools.call('Artifact', { action: 'list' }, owner);
      assert.equal(result.messages?.length, 1);
      assert.ok(await page.waitFor(`${SENT_STATE}.endsWith('delivered')`, 10000), `the pane says ${await page.evaluate(SENT_STATE)}`);
      // A reload keeps it.
      await page.evaluate('location.reload()');
      assert.ok(await page.waitFor(`!!document.querySelector('aside ol li') && ${SENT_STATE}.endsWith('delivered')`, 15000), `after a reload, the pane says ${await page.evaluate(SENT_STATE).catch(() => '?')}`);
    } finally {
      await page.close();
    }
  });

  it('an empty design shows no Start blank: an agent builds it from what the person says it should be', T, async () => {
    const made = await fetch(`${ctx.daemon.origin}/api/open-artifact.artifacts.create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ctx.daemon.origin },
      body: JSON.stringify({ type: 'design', title: 'Landing' }),
    }).then((r) => r.json());
    const page = await ctx.browser.load(`${ctx.daemon.origin}/a/${made.id}`, { ready: "!!document.querySelector('[data-testid=empty-artifact]')", ignore: [/favicon\.ico/] });
    try {
      assert.equal(await page.evaluate("!!document.querySelector('[data-testid=start-blank]')"), false);
      // The prompt alone tells the agent to ask what it should be: a pasted one with no subject is not a dead end.
      const PROMPT = "document.querySelector('[data-testid=empty-artifact-prompt]').value";
      const bare = await page.evaluate(PROMPT);
      assert.match(bare, /^Take over artifact open-artifact:\/\/artifact\//);
      assert.match(bare, /ask the person in one short question what it should be, and build it once they answer\.$/);
      // What the person types it should be goes before it, in what Copy and a new session send.
      await clickOn(page, '[data-testid=empty-artifact-brief]');
      await page.type('A landing page for a note-taking app');
      assert.ok(await page.waitFor(`${PROMPT}.startsWith('A landing page for a note-taking app\\n\\nTake over artifact ')`, 5000), `the prompt is ${await page.evaluate(PROMPT)}`);
      assert.ok((await page.evaluate(PROMPT)).endsWith(bare), 'the hand-over prompt follows it unchanged');
    } finally {
      await page.close();
    }
  });
});
