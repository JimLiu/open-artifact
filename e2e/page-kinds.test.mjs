// End-to-end tests of the kinds of page people ask for, in Chrome: a real daemon (in this process, from source, in a
// temporary home), each page made the way an agent makes one (Artifact publish with the capabilities it declares, then
// the fixture's files from e2e/fixtures/page-kinds/), used in the Shell the way a person and the agent use it.
//
//   multi-file    a page with a stylesheet, a module that imports another, an image and a JSON file beside it
//   checklist     a tool used with the real mouse and keyboard; db shared with the agent's ArtifactData
//   files         assets (upload, list, delete, served to <img>) and downloads (a file the browser saves)
//   feedback      comments the page places and sends to the agent; the agent's reply reaches the page
//   self-edit     artifact.publish of files beside the page (with ifMatch) and of the page itself
//   capabilities  what use() gives for stubs, unknown and undeclared names; room sub-rooms between two views
//
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { filesIn, nextDownload } from './lib/downloads.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 90000 };
const FIXTURES = path.join(repoRoot, 'e2e', 'fixtures', 'page-kinds');
/** In a page's own frame. */
const IN_PAGE = "location.hostname.endsWith('.frame.localhost')";

function skip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  return fs.existsSync(path.join(repoRoot, 'dist', 'daemon', 'shell', 'index.html')) ? false : 'the Shell is not built (npm run build)';
}

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

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value || Date.now() > end) return value;
    await sleep(100);
  }
}

/** A fixture folder's files, by their path in it. */
function fixtureFiles(name) {
  const dir = path.join(FIXTURES, name);
  return Object.fromEntries(fs.readdirSync(dir, { recursive: true }).filter(f => fs.statSync(path.join(dir, f)).isFile()).map(f => [f.split(path.sep).join('/'), fs.readFileSync(path.join(dir, f), 'utf8')]));
}

describe('kinds of page', { skip: skip() }, () => {
  const ctx = {};
  const call = async (tool, args) => {
    const out = await ctx.daemon.tools.call(tool, args, ctx.caller);
    assert.equal(out.error, undefined, JSON.stringify(out.error));
    return out;
  };
  /** The page's own frame answers `expression` (awaited), or undefined. */
  const inPage = async (page, expression) => (await page.evaluateAll(`${IN_PAGE} ? (${expression}) : undefined`).catch(() => [])).find(v => v !== undefined);
  /** A page artifact made from a fixture, open in its own tab once `ready` holds in the page. */
  async function makePage(fixture, capabilities, ready = "document.getElementById('status')?.textContent === 'ready'") {
    const made = await call('Artifact', { action: 'publish', type_url: 'open-artifact://type/page', title: 'Untitled page', capabilities, open: 'never' });
    await call('Artifact', { action: 'publish', url: made.url, files: fixtureFiles(fixture) });
    const id = ctx.daemon.store.require(made.url).id;
    const view = `${ctx.daemon.origin}/a/${id}`;
    const page = await ctx.browser.load(view, { ready: `${IN_PAGE} && (${ready})`, ignore: [/favicon\.ico/] });
    return { ...made, id, view, page };
  }
  /**
   * Where an element of the page is on the tab: its centre in the page's frame, moved by each frame that holds it (the
   * Shell's frame, then the frame host's). For real mouse input.
   */
  async function pointOf(page, selector) {
    const rects = await page.evaluateAll(`(() => {
      if (${IN_PAGE}) { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && { page: [r.x + r.width / 2, r.y + r.height / 2] }; }
      const f = document.querySelector('iframe'); if (!f) return undefined;
      const r = f.getBoundingClientRect(); return { frame: [r.x + f.clientLeft, r.y + f.clientTop], top: window === window.top };
    })()`);
    const inner = rects.find(r => r?.page)?.page;
    assert.ok(inner, `no ${selector} in the page`);
    const frames = rects.filter(r => r?.frame);
    assert.equal(frames.length, 2, `the page sits in two frames: ${JSON.stringify(rects)}`);
    return frames.reduce(([x, y], f) => [x + f.frame[0], y + f.frame[1]], inner);
  }

  before(async () => {
    const tmp = tmpDir('page-kinds');
    const workspace = path.join(tmp, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION']) delete process.env[name];
    Object.assign(process.env, {
      OPEN_ARTIFACT_HOME: path.join(tmp, 'home'),
      OPEN_ARTIFACT_USER_TYPES: path.join(tmp, 'types'),
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmp, 'servers'),
    });
    const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
    ctx.daemon = await startDaemon({ port: await freePort(), idleMs: 0, quiet: true, browse: null });
    ctx.caller = { harness: 'dsh', session: 'e2e-page-kinds', workspace };
    ctx.downloads = path.join(tmp, 'downloads');
    fs.mkdirSync(ctx.downloads);
    ctx.browser = await launch({ width: 1100, height: 800 });
    await ctx.browser.downloadsTo(ctx.downloads);
  });

  after(async () => {
    await ctx.browser?.close();
    await ctx.daemon?.close();
    removeTmp();
  });

  it('multi-file: a stylesheet, a module importing a module, an image and a JSON file beside the page all load', T, async () => {
    const made = await makePage('multi-file', {});
    const { page } = made;
    assert.deepEqual(page.problems, [], 'nothing failed to load');
    assert.equal(await inPage(page, "document.getElementById('miles').textContent"), '3.11', 'app.js ran with lib/units.js');
    assert.equal(await inPage(page, "document.querySelectorAll('#presets li').length"), 3, 'data/presets.json was read');
    assert.equal(await inPage(page, 'getComputedStyle(document.body).backgroundColor'), 'rgb(250, 249, 245)', 'style.css applied');
    assert.equal(await inPage(page, "document.getElementById('logo').naturalWidth"), 32, 'images/logo.svg loaded');
    assert.equal(ctx.daemon.store.require(made.url).title, 'Unit converter');
    // The files are the fixture's, at their paths; nothing else is written beside them.
    const info = await call('Artifact', { action: 'call', url: made.url, name: 'info' });
    assert.deepEqual(info.info.files.map(f => f.path).sort(), Object.keys(fixtureFiles('multi-file')).sort());
    // A snapshot in the dark scheme takes the page's own dark tokens.
    const snap = await call('Artifact', { action: 'call', url: made.url, name: 'snapshot', args: { width: 360, height: 640, scheme: 'dark' } });
    assert.ok(fs.statSync(snap.image).size > 0);
    await page.close();
  });

  it('checklist: typed and clicked like a person, the items land in db; the agent adds one and it shows', T, async () => {
    const made = await makePage('checklist', { db: true }, "document.getElementById('status')?.textContent === '0 items'");
    const { page } = made;
    for (const text of ['Passport', 'Charger']) {
      await page.click(...(await pointOf(page, '#text')));
      await page.type(text);
      await page.click(...(await pointOf(page, '#add')));
      assert.ok(await page.waitFor(`${IN_PAGE} && [...document.querySelectorAll('#items span')].some(s => s.textContent === ${JSON.stringify(text)})`, 10000), `${text} shows`);
    }
    await page.click(...(await pointOf(page, '#items li:first-child input')));
    assert.ok(await page.waitFor(`${IN_PAGE} && document.querySelector('#items li:first-child')?.className === 'done'`, 10000), 'the first item is ticked');
    // What the agent reads is what the person did.
    const listed = await until(async () => {
      const out = await call('ArtifactData', { action: 'list', url: made.url, collection: 'items' });
      return out.docs.some(d => d.data.done) && out;
    });
    assert.ok(listed, 'the tick reached db');
    assert.deepEqual(listed.docs.map(d => [d.data.text, d.data.done]).sort(), [['Charger', false], ['Passport', true]]);
    // The agent's write shows in the open page, and a stale if_match is refused.
    const passport = listed.docs.find(d => d.data.text === 'Passport');
    await call('ArtifactData', { action: 'set', url: made.url, path: 'items/agent', data: { text: 'Adapter', done: false, at: Date.now() } });
    assert.ok(await page.waitFor(`${IN_PAGE} && document.getElementById('status')?.textContent === '3 items'`, 10000), "the agent's item shows");
    await call('ArtifactData', { action: 'update', url: made.url, path: `items/${passport.id}`, data: { text: 'Passport and visa' }, if_match: passport.sha256 });
    const stale = await ctx.daemon.tools.call('ArtifactData', { action: 'update', url: made.url, path: `items/${passport.id}`, data: { text: 'Old' }, if_match: passport.sha256 }, ctx.caller);
    assert.equal(stale.error?.code, 'conflict', JSON.stringify(stale));
    assert.ok(await page.waitFor(`${IN_PAGE} && [...document.querySelectorAll('#items span')].some(s => s.textContent === 'Passport and visa')`, 10000), "the agent's edit shows");
    assert.deepEqual(page.problems, []);
    await page.close();
  });

  it('files: an upload is stored under _blobs and drawn from its url, listed and deleted; a download reaches the browser', T, async () => {
    const made = await makePage('files', { assets: true, downloads: true });
    const { page } = made;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#2f6f4f"/></svg>';
    const added = await inPage(page, `window.board.add(new Blob([${JSON.stringify(svg)}], { type: 'image/svg+xml' }))`);
    assert.equal(added.contentType, 'image/svg+xml');
    assert.equal(added.sizeBytes, Buffer.byteLength(svg));
    assert.equal(fs.readFileSync(path.join(made.root, '_blobs', added.id), 'utf8'), svg, 'the bytes are on disk');
    assert.ok(await page.waitFor(`${IN_PAGE} && document.querySelector('#grid img')?.naturalWidth === 40`, 10000), 'the image draws from its url');
    const listed = await inPage(page, 'window.board.list()');
    assert.deepEqual(listed.assets.map(a => a.id), [added.id]);
    assert.equal(listed.usage.files, 1);
    // The same bytes again are the same asset.
    const again = await inPage(page, `window.board.add(new Blob([${JSON.stringify(svg)}], { type: 'image/svg+xml' }))`);
    assert.equal(again.id, added.id);
    // The export button hands the viewer a file.
    const seen = filesIn(ctx.downloads);
    await page.click(...(await pointOf(page, '#export')));
    const file = await nextDownload(ctx.downloads, seen, 20000);
    assert.ok(file, 'a file was downloaded');
    assert.equal(file.name, 'photo-board.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(file.path, 'utf8')), [{ id: added.id, type: 'image/svg+xml', bytes: Buffer.byteLength(svg) }]);
    // Deleted: gone from the list, the page and the disk.
    assert.deepEqual(await inPage(page, `window.board.remove(${JSON.stringify(added.id)})`), { deleted: true });
    assert.equal((await inPage(page, 'window.board.list()')).assets.length, 0);
    assert.equal(await inPage(page, "document.querySelectorAll('#grid img').length"), 0);
    assert.equal(fs.existsSync(path.join(made.root, '_blobs', added.id)), false);
    assert.deepEqual(page.problems, []);
    await page.close();
  });

  it('feedback: a thread the page sends reaches the agent, and the agent\'s reply reaches the page', T, async () => {
    const made = await makePage('feedback', { comments: true });
    const { page } = made;
    const asked = await inPage(page, "window.feedback.ask('Is 3 March firm, or a target?')");
    assert.equal(asked.can, 'available');
    const read = await call('ArtifactComments', { action: 'read', url: made.url });
    const thread = read.threads.find(t => t.id === asked.threadId);
    assert.ok(thread, JSON.stringify(read));
    assert.equal(thread.where, 'Headline');
    assert.equal(thread.messages[0].text, 'Is 3 March firm, or a target?');
    assert.ok(thread.agent?.status, 'the thread was sent to the agent');
    assert.ok(fs.existsSync(path.join(made.root, 'comments.json')));
    await call('ArtifactComments', { action: 'reply', url: made.url, thread_id: asked.threadId, text: 'A target: the date moves if QA finds blockers.' });
    const answered = await until(async () => {
      const t = await inPage(page, `window.feedback.thread(${JSON.stringify(asked.threadId)})`);
      return t?.messages?.length === 2 && t;
    });
    assert.ok(answered, 'the reply reached the page');
    assert.equal(answered.messages[1].author.kind, 'agent');
    assert.equal(answered.messages[1].text, 'A target: the date moves if QA finds blockers.');
    await page.close();
  });

  it('self-edit: files written beside the page keep the view; ifMatch refuses a stale write; publishing the page reloads every view', T, async () => {
    const made = await makePage('self-edit', {});
    const { page } = made;
    await inPage(page, '(window.__kept = 1)');
    const saved = await inPage(page, "window.note.save('first')");
    assert.ok(saved.shas['notes/today.txt'], JSON.stringify(saved));
    assert.equal(fs.readFileSync(path.join(made.root, 'notes', 'today.txt'), 'utf8'), 'first');
    await sleep(500);
    assert.equal(await inPage(page, 'window.__kept'), 1, 'the view kept running');
    const sha = saved.shas['notes/today.txt'];
    const next = await inPage(page, `window.note.save('second', { 'notes/today.txt': ${JSON.stringify(sha)} })`);
    assert.ok(next.shas['notes/today.txt']);
    const stale = await inPage(page, `window.note.save('third', { 'notes/today.txt': ${JSON.stringify(sha)} }).catch(e => ({ code: e.code }))`);
    assert.deepEqual(stale, { code: 'conflict' });
    assert.equal(fs.readFileSync(path.join(made.root, 'notes', 'today.txt'), 'utf8'), 'second');
    // The page replaces itself: every view reloads with the new heading, and index.html holds no runtime of ours.
    const other = await ctx.browser.load(made.view, { ready: `${IN_PAGE} && document.getElementById('status')?.textContent === 'ready'`, ignore: [/favicon\.ico/] });
    // After this view's own file writes: its publish(html) is not refused as stale. The view may reload before the
    // answer comes; an answer that does come is the write's, not an error.
    const replaced = await inPage(page, "window.note.replace('Second version').then(r => ({ version: typeof r.version }), e => ({ code: e.code, message: e.message }))");
    assert.ok(replaced === undefined || replaced.version === 'string', `publish(html) answered ${JSON.stringify(replaced)}`);
    for (const view of [page, other]) {
      assert.ok(await view.waitFor(`${IN_PAGE} && document.getElementById('heading')?.textContent === 'Second version' && document.getElementById('status')?.textContent === 'ready'`, 15000), 'the view reloaded with the new page');
    }
    const html = fs.readFileSync(path.join(made.root, 'index.html'), 'utf8');
    assert.match(html, /^<!doctype html>\n<html lang="en"><head>\n<meta charset="utf-8">/, 'the page as it was, without the runtime served in its <head>');
    assert.match(html, /<h1 id="heading">Second version<\/h1>/);
    assert.doesNotMatch(html, /_runtime\/|open-artifact-frame/, 'the injected runtime was not written into the page');
    assert.equal((html.match(/<script>/g) ?? []).length, 1, 'one script, the page\'s own');
    assert.deepEqual([...page.problems, ...other.problems], []);
    await other.close();
    await page.close();
  });

  it('capabilities: stubs answer with their codes, unknown and undeclared names give null; sub-rooms stay apart between two views', T, async () => {
    const made = await makePage('capabilities', { mcp: true, sample: true, tts: true, paste: true, bogus: true, user: true, room: true });
    const { page } = made;
    const report = await inPage(page, 'window.report');
    assert.deepEqual({ ...report, calls: undefined, permissions: undefined, me: undefined }, {
      db: null, assets: null, mcp: 'namespace', sample: 'namespace', tts: 'namespace', paste: 'namespace', bogus: null, user: 'namespace', room: 'namespace',
      selfIsArtifact: true, calls: undefined, permissions: undefined, me: undefined,
    });
    assert.deepEqual(report.calls, { mcp: 'server_not_connected', sample: 'tools_unavailable', tts: 'capability_disabled', paste: 'capability_disabled' });
    assert.equal(report.permissions.user, 'granted');
    assert.equal(report.permissions.db, undefined, 'db is not declared');
    assert.equal(report.me.isOwner, true);
    assert.equal(report.me.canEdit, true);
    assert.equal(report.me.email, null);
    // The calls that reject were caught by the page: no uncaught error.
    assert.deepEqual(page.problems, []);
    // Two views: a message on a sub-room reaches the same sub-room only.
    const other = await ctx.browser.load(made.view, { ready: `${IN_PAGE} && document.getElementById('status')?.textContent === 'ready'`, ignore: [/favicon\.ico/] });
    await inPage(page, `window.openArtifact.use('room').then(room => {
      window.heard = [];
      room.on('note', d => window.heard.push(['root', d.n]));
      room.join('team').on('note', d => window.heard.push(['team', d.n]));
      room.join('other').on('note', d => window.heard.push(['other', d.n]));
      return true;
    })`);
    assert.ok(await other.waitFor(`${IN_PAGE} && window.openArtifact.room.peers().length === 2`, 10000), 'the second view sees both');
    await inPage(other, "window.openArtifact.use('room').then(async room => { await room.join('team').emit('note', { n: 1 }); await room.emit('note', { n: 2 }); return true; })");
    assert.ok(await page.waitFor(`${IN_PAGE} && window.heard.length === 2`, 10000), 'both messages arrived');
    await sleep(300);
    assert.deepEqual(await inPage(page, 'window.heard'), [['team', 1], ['root', 2]]);
    await other.close();
    await page.close();
  });
});
