import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { build } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { createTypeServer } from '../../packages/type-server/src/server.ts';
import { fixtures, tmpDir } from './target.mjs';
import { until } from './http.mjs';
import { savedBoardCopy } from './whiteboard-refresh.mjs';

const active = 'window.fixture?.board.getState().revealed && fixture.liveBoard()?.getSnapshot().loadState === "live"';
const delayed = (p, route, ms) => p.cdp('Network.emulateNetworkConditionsByRule', {
  offline: false, matchedNetworkConditions: [{ urlPattern: route, latency: ms, downloadThroughput: -1, uploadThroughput: -1 }],
});
const mounted = async p => { await p.evaluateAll('window.fixture?.mount()'); assert.ok(await p.waitFor(active)); };

export function whiteboardLifecycle(getBrowser, skip) {
  describe('whiteboard lifecycle', { skip, timeout: 90_000 }, () => {
    let assets;
    before(async () => {
      assets = tmpDir('lifecycle-assets');
      const root = path.join(fixtures, 'whiteboard-lifecycle');
      const outDir = path.join(assets, 'editors/whiteboard');
      await build({ root, base: './', configFile: false, plugins: [tailwindcss()], logLevel: 'error',
        define: { 'process.env.NODE_ENV': '"development"' }, esbuild: { jsx: 'automatic' },
        build: { outDir, minify: false, target: 'es2022', reportCompressedSize: false } });
      fs.copyFileSync(path.join(root, 'frame.html'), path.join(outDir, 'frame.html'));
    });
    async function open(t, { framed = false, isLocal } = {}) {
      const root = tmpDir('lifecycle-board');
      fs.mkdirSync(path.join(root, 'db/board'), { recursive: true });
      const meta = path.join(root, 'db/board/meta.json');
      fs.writeFileSync(meta, JSON.stringify({ v: 1, order: [], title: 'Original title' }));
      const server = createTypeServer({ assetsDir: assets, secret: 'lifecycle', idleMs: 0, isLocal });
      await server.listen();
      const { id, pageUrl } = await server.open({ root, type: 'whiteboard' });
      const url = framed ? new URL('frame.html', pageUrl).href : pageUrl;
      const p = await getBrowser().load(url, { ready: 'window.fixture', settle: 0 });
      t.after(async () => { await p.close(); await server.stop(); });
      return { p, meta, url, id };
    }

    it('serializes StrictMode remount during an 800ms boot and saves the edited title on disk and reopen', async t => {
      const { p, meta, url } = await open(t);
      await delayed(p, new URL('_api/session', url).href, 800);
      await p.evaluate('fixture.mount()');
      assert.ok(await until(() => [...p.urls].some(url => url.endsWith('/_api/session'))));
      await p.evaluate(`(async () => {
        fixture.unmount(); await new Promise(resolve => setTimeout(resolve, 65)); fixture.mount();
      })()`);
      assert.ok(await p.waitFor(active));
      assert.deepEqual(await p.evaluate('fixture.mounts'), ['mount', 'unmount', 'mount', 'unmount', 'mount', 'unmount', 'mount']);
      await p.evaluate("const titleInput = document.querySelector('[aria-label=\"Board title\"]'); titleInput.focus(); titleInput.select()");
      await p.type('Overlapping remount');
      assert.ok(await until(() => JSON.parse(fs.readFileSync(meta)).title === 'Overlapping remount'));
      assert.deepEqual(await p.evaluate('[titleInput.value, fixture.liveBoard().title()]'), ['Overlapping remount', 'Overlapping remount']);
      const reopened = await getBrowser().load(url, { ready: 'window.fixture' });
      try {
        await mounted(reopened);
        assert.equal(await reopened.evaluate("document.querySelector('[aria-label=\"Board title\"]').value"), 'Overlapping remount');
      } finally { await reopened.close(); }
    });

    it('keeps standalone storage path-based with Shell query parameters and migrates the camera on a framed open', async t => {
      const { p, url, id } = await open(t);
      const standalone = new URL(url);
      standalone.searchParams.set('open_artifact_shell', standalone.origin);
      standalone.searchParams.set('open_artifact_id', id);
      await p.cdp('Page.navigate', { url: standalone.href });
      assert.ok(await p.waitFor(`location.href === ${JSON.stringify(standalone.href)} && window.fixture`));
      await mounted(p);
      await p.evaluate('fixture.camera.getState().setCamera({ x: 22, y: 33, zoom: 0.75 })');
      const pathCamera = "JSON.parse(sessionStorage.getItem('wb-camera:' + location.pathname))";
      assert.ok(await p.waitFor(pathCamera + '?.zoom === 0.75'));
      assert.ok(await p.waitFor(savedBoardCopy));
      const artifactCamera = JSON.stringify('wb-camera:artifact:' + encodeURIComponent(id));
      assert.equal(await p.evaluate(`sessionStorage.getItem(${artifactCamera})`), null);
      assert.deepEqual(await p.evaluate("Object.keys(localStorage).filter(key => key.startsWith('wb-saved-copy:artifact:'))"), []);

      await p.cdp('Page.navigate', { url: new URL('frame.html', url).href });
      assert.ok(await p.waitFor('window.parent !== window && window.fixture'));
      await p.evaluate(`const child = frames[0]; const address = new URL(child.location.href);
        address.searchParams.set('open_artifact_id', ${JSON.stringify(id)});
        child.history.replaceState(null, '', address); child.fixture.mount();`);
      assert.ok(await p.waitFor(active));
      assert.deepEqual(await p.evaluate('frames[0].fixture.camera.getState().camera'), { x: 22, y: 33, zoom: 0.75 });
      assert.deepEqual(await p.evaluate(`JSON.parse(sessionStorage.getItem(${artifactCamera}))`), { x: 22, y: 33, zoom: 0.75 });
    });

    const titleInput = 'document.querySelector(\'[aria-label="Board title"]\')';
    for (const denied of [false, true]) {
      const name = denied ? 'discards a detached cached edit on access refusal and never restores it'
        : 'keeps a cached pending title across an 80ms remount until both the server and a fresh tab see it';
      it(name, async t => {
        let allow = true;
        const { p, meta, url } = await open(t, { isLocal: req => allow || !req.url.includes('/_api/db/list') });
        await mounted(p);
        await p.evaluate('fixture.unmount()');
        assert.ok(await p.waitFor('!fixture.liveBoard() && fixture.savedCopyCache().read()?.length'));
        allow = !denied;
        await delayed(p, new URL('_api/db/list', url).href, 2600);
        await p.evaluate('fixture.mount()');
        assert.ok(await p.waitFor('fixture.board.getState().revealed && fixture.liveBoard()?.getSnapshot().revalidating'));
        await p.evaluate(`${titleInput}.focus(); ${titleInput}.select()`);
        await p.type('Cached pending');
        assert.ok(await p.waitFor('fixture.liveBoard()?.getSnapshot().pending === 1 && fixture.liveBoard().title() === "Cached pending"'));
        assert.deepEqual(await p.evaluate(`[${titleInput}.value, fixture.liveBoard().title(), fixture.liveBoard().getSnapshot().pending]`),
          ['Cached pending', 'Cached pending', 1]);
        assert.equal(JSON.parse(fs.readFileSync(meta)).title, 'Original title');
        await p.evaluate('window.oldBoard = fixture.liveBoard(); fixture.unmount()');
        if (denied) {
          assert.ok(await p.waitFor('!fixture.liveBoard() && oldBoard.getSnapshot().lastError?.code === "not_granted"'));
          assert.equal(await p.evaluate('fixture.savedCopyCache().read() ?? null'), null);
          assert.equal(await p.evaluate('oldBoard.getSnapshot().pending'), 0);
        }
        await p.evaluate('(async () => { await new Promise(resolve => setTimeout(resolve, 80)); fixture.mount(); })()');
        if (denied) {
          assert.ok(await p.waitFor('fixture.liveBoard()?.getSnapshot().loadState === "failed"'));
          assert.equal(await p.evaluate(`${titleInput}.value === 'Cached pending'`), false);
          assert.equal(JSON.parse(fs.readFileSync(meta)).title, 'Original title');
          return;
        }
        assert.ok(await p.waitFor(`fixture.liveBoard()?.getSnapshot().revalidating && ${titleInput}.value === 'Cached pending'`));
        assert.ok(await p.waitFor(active));
        assert.ok(await until(() => JSON.parse(fs.readFileSync(meta)).title === 'Cached pending'));
        assert.deepEqual(await p.evaluate(`[${titleInput}.value, fixture.liveBoard().title()]`), ['Cached pending', 'Cached pending']);
        const fresh = await getBrowser().load(url, { ready: 'window.fixture' });
        try {
          await mounted(fresh);
          assert.equal(await fresh.evaluate(`${titleInput}.value`), 'Cached pending');
        } finally { await fresh.close(); }
      });
    }

    it('releases the rejected title and cache when the write of a detached board is denied', async t => {
      const writes = new Set();
      const { p, url, meta } = await open(t, { isLocal: req => {
        if (!req.url.includes('/_api/db/write')) return true;
        writes.add(req);
        return false;
      } });
      await mounted(p);
      await p.evaluate('fixture.unmount()');
      assert.ok(await p.waitFor('!fixture.liveBoard() && fixture.savedCopyCache().read()?.length'));
      await delayed(p, new URL('_api/db/list', url).href, 1450);
      await p.evaluate('fixture.mount()');
      assert.ok(await p.waitFor('fixture.board.getState().revealed && fixture.liveBoard()?.getSnapshot().revalidating'));
      await p.evaluate(`${titleInput}.focus(); ${titleInput}.select()`);
      await p.type('Rejected draft');
      assert.ok(await p.waitFor('fixture.liveBoard()?.getSnapshot().pending === 1 && fixture.liveBoard().title() === "Rejected draft"'));
      assert.equal(await p.evaluate(`(() => {
        window.oldBoard = fixture.liveBoard(); const state = oldBoard.getSnapshot().loadState;
        fixture.unmount(); return state;
      })()`), 'cached');
      assert.equal(writes.size, 0);
      assert.ok(await p.waitFor('!fixture.liveBoard() && oldBoard.getSnapshot().lastError?.code === "not_granted"'));
      assert.deepEqual(await p.evaluate(`[oldBoard.getSnapshot().loadState, oldBoard.getSnapshot().pending,
        oldBoard.getSnapshot().flights, oldBoard.title(), fixture.savedCopyCache().read() ?? null]`),
        ['live', 0, 0, 'Original title', null]);
      assert.equal(writes.size, 1);
      assert.equal(JSON.parse(fs.readFileSync(meta)).title, 'Original title');
      await mounted(p);
      assert.deepEqual(await p.evaluate(`[fixture.liveBoard() !== oldBoard, ${titleInput}.value, fixture.liveBoard().title()]`),
        [true, 'Original title', 'Original title']);
      assert.equal(writes.size, 1);
    });

    it('opens a fresh list request on remount after revalidation exceeds ten seconds', async t => {
      const { p, url } = await open(t);
      await mounted(p);
      await p.evaluate('fixture.unmount()');
      assert.ok(await p.waitFor('!fixture.liveBoard() && fixture.savedCopyCache().read()?.length'));
      await delayed(p, new URL('_api/db/list', url).href, 25_000);
      await p.evaluate('window.firstMountAt = performance.now(); fixture.mount()');
      assert.ok(await p.waitFor('fixture.liveBoard()?.getSnapshot().revalidating'));
      assert.ok(await p.waitFor('fixture.liveBoard()?.getSnapshot().loadState === "cached" && !fixture.liveBoard().getSnapshot().revalidating', 15_000));
      assert.ok(await p.evaluate('performance.now() - firstMountAt >= 10000'));
      await p.cdp('Network.emulateNetworkConditionsByRule', { offline: false, matchedNetworkConditions: [] });
      await p.evaluate(`(async () => {
        fixture.unmount(); await new Promise(resolve => setTimeout(resolve, 150));
        window.remountAt = performance.now(); fixture.mount();
      })()`);
      assert.ok(await p.waitFor(active, 4000));
      const lists = await p.evaluate(`performance.getEntriesByType('resource')
        .filter(r => new URL(r.name).pathname.endsWith('/_api/db/list')).map(r => [r.startTime - remountAt, r.responseStatus])`);
      const retry = lists.find(([start]) => start >= 0);
      assert.ok(retry && retry[0] < 1000 && retry[1] === 200, JSON.stringify(lists));
      t.diagnostic(`First list after remount started in ${Math.round(retry[0])} ms and returned HTTP ${retry[1]}.`);
      assert.deepEqual(await p.evaluate(`[fixture.liveBoard().title(), fixture.liveBoard().getSnapshot().pending]`), ['Original title', 0]);
    });

    it('retries a failed initial list on a 150ms remount and saves to disk', async t => {
      const { p, meta } = await open(t);
      await p.cdp('Network.setBlockedURLs', { urls: ['*_api/db/list*'] });
      await p.evaluate('fixture.mount()');
      assert.ok(await p.waitFor("fixture.liveBoard()?.getSnapshot().loadState === 'failed'"));
      await p.cdp('Network.setBlockedURLs', { urls: [] });
      await p.evaluate('(async () => { fixture.unmount(); await new Promise(resolve => setTimeout(resolve, 150)); fixture.mount(); })()');
      assert.ok(await p.waitFor(active));
      assert.deepEqual(await p.evaluate(`(async () => {
        const db = openartifact.use('db');
        const sheet = openartifact.use('sheet');
        return [Object.isFrozen(await db), db === openartifact.use('db'), await sheet, sheet === openartifact.use('sheet')];
      })()`), [true, true, null, true]);
      await p.evaluate(`${titleInput}.focus(); ${titleInput}.select()`);
      await p.type('Recovered session');
      assert.ok(await until(() => JSON.parse(fs.readFileSync(meta)).title === 'Recovered session'));
      assert.equal(await p.evaluate('fixture.liveBoard().title()'), 'Recovered session');
    });

    it('opens a fresh session immediately on remount after the initial lookup exceeds ten seconds', async t => {
      const { p, url } = await open(t);
      const session = new URL('_api/session', url).href;
      await delayed(p, session, 25_000);
      await p.evaluate('window.firstMountAt = performance.now(); fixture.mount()');
      assert.ok(await p.waitFor("document.body.innerText.includes('This board could not open')", 15_000));
      assert.ok(p.urls.has(session));
      assert.ok(await p.evaluate('performance.now() - firstMountAt >= 10000'));
      await p.cdp('Network.emulateNetworkConditionsByRule', { offline: false, matchedNetworkConditions: [] });
      await p.evaluate(`(async () => {
        fixture.unmount(); await new Promise(resolve => setTimeout(resolve, 150));
        window.remountAt = performance.now(); fixture.mount();
      })()`);
      assert.ok(await p.waitFor(active, 4000));
      const sessions = await p.evaluate(`performance.getEntriesByName(${JSON.stringify(session)})
        .map(r => [r.startTime - remountAt, r.responseStatus])`);
      const retry = sessions.find(([start]) => start >= 0);
      assert.ok(retry && retry[0] < 1000 && retry[1] === 200, JSON.stringify(sessions));
      assert.deepEqual(await p.evaluate('[fixture.liveBoard().title(), fixture.liveBoard().getSnapshot().pending]'), ['Original title', 0]);
    });

    it('retries a transient initial session error on a 150ms remount and saves to disk', async t => {
      const { p, url, meta } = await open(t);
      await p.cdp('Network.setBlockedURLs', { urls: [new URL('_api/session', url).href] });
      await p.evaluate('fixture.mount()');
      assert.ok(await p.waitFor("document.body.innerText.includes('This board could not open')"));
      await p.cdp('Network.setBlockedURLs', { urls: [] });
      await p.evaluate('(async () => { fixture.unmount(); await new Promise(resolve => setTimeout(resolve, 150)); fixture.mount(); })()');
      assert.ok(await p.waitFor(active));
      await p.evaluate(`${titleInput}.focus(); ${titleInput}.select()`);
      await p.type('Recovered session');
      assert.ok(await until(() => JSON.parse(fs.readFileSync(meta)).title === 'Recovered session'));
      assert.equal(await p.evaluate('fixture.liveBoard().title()'), 'Recovered session');
    });

    it('keeps a refused initial session terminal across remounts of the same page', async t => {
      let allow = false;
      const requests = new Set();
      const { p } = await open(t, { isLocal: req => {
        if (!req.url.includes('/_api/session')) return true;
        requests.add(req);
        return allow;
      } });
      const failed = "document.body.innerText.includes('This board could not open')";
      await p.evaluate('fixture.mount()');
      assert.ok(await p.waitFor(failed));
      assert.equal(requests.size, 1);
      assert.deepEqual(await p.evaluate("performance.getEntriesByType('resource').filter(r => r.name.endsWith('/_api/session')).map(r => r.responseStatus)"), [403]);
      allow = true;
      await p.evaluate('fixture.unmount()');
      assert.ok(await p.waitFor("!document.getElementById('board-mount').childElementCount"));
      await p.evaluate('fixture.mount()');
      assert.ok(await p.waitFor(failed));
      assert.equal(requests.size, 1);
    });

    it('disposes both a partially started board and queued reports before a fresh connection opens', async t => {
      const { p } = await open(t, { framed: true });
      const listeners = async () => (await p.cdp('Runtime.evaluate', { expression:
        "[getEventListeners(frames[0]),getEventListeners(frames[0].document)].flatMap(target => ['message','keydown','keyup','visibilitychange','focusin','beforeunload'].map(k => (target[k] || []).length))", includeCommandLineAPI: true, returnByValue: true })).result.value;
      const before = await listeners();
      const failure = await p.evaluate(`(async () => {
        const f = frames[0].fixture;
        const controller = new AbortController();
        const off = f.board.subscribe(() => { if (f.liveBoard()) controller.abort(new Error('cancelled after sync started')); });
        try { await f.startBoard(controller.signal); }
        catch (error) { return error.message; }
        finally { off(); }
      })()`);
      assert.equal(failure, 'cancelled after sync started');
      assert.ok(await p.waitFor('window.reports?.length && Object.keys(reports.at(-1)).length === 0'));
      assert.deepEqual(await listeners(), before);
      assert.equal(await p.evaluate('frames[0].fixture.liveBoard()'), null);
      await p.evaluate('window.reports.length = 0');
      await mounted(p);
      assert.ok(await p.waitFor('window.reports?.at(-1)?.saved === "saved"'));
      const reports = await p.evaluate('reports');
      assert.ok(reports.every(report => Object.keys(report).length));
      await p.evaluate('frames[0].fixture.unmount()');
      assert.ok(await p.waitFor('window.fixture && !fixture.liveBoard()'));
      assert.deepEqual(await listeners(), before);
    });

    it('clears an old agent after a failed status request and clamps the restored camera to the measured viewport', async t => {
      let sessions = 0;
      const { p } = await open(t, { isLocal: req => {
        if (req.url.includes('/_api/session')) return ++sessions === 1;
        return req.headers.upgrade !== 'websocket';
      } });
      await p.cdp('Emulation.setDeviceMetricsOverride', { width: 700, height: 650, deviceScaleFactor: 1, mobile: false });
      await p.evaluate(`sessionStorage.setItem('wb-agent:' + location.pathname, JSON.stringify({ available: true, name:'Previously connected' }));
        sessionStorage.setItem('wb-camera:' + location.pathname, JSON.stringify({ x: 20, y: 30, zoom: 0.12 }));
        window.agents = []; fixture.agent.subscribe(s => agents.push([s.available, s.busy, s.name])); fixture.mount()`);
      assert.ok(await p.waitFor(active));
      assert.ok(sessions >= 2);
      assert.ok(await p.evaluate("agents.some(s => s[2] === 'Previously connected')"));
      assert.deepEqual(await p.evaluate('agents.at(-1)'), [false, false, 'Agent']);
      assert.equal(await p.evaluate('fixture.camera.getState().camera.zoom'), 0.6);
      assert.equal(await p.evaluate("JSON.parse(sessionStorage.getItem('wb-agent:' + location.pathname)).available"), false);
    });

    it('warns while direct writes are in flight and clears saving after the server confirms them', async t => {
      const { p, meta, url } = await open(t);
      await mounted(p);
      await delayed(p, new URL('_api/db/write', url).href, 1400);
      await p.evaluate(`window.confirmed = fixture.liveBoard().writeNow([{op:'update',path:'board/meta',patch:{title:'Direct write'}}]); true`);
      const warn = "(() => {const e = new Event('beforeunload', {cancelable:true}); dispatchEvent(e); return e.defaultPrevented;})()";
      assert.ok(await p.waitFor('fixture.liveBoard().getSnapshot().flights === 1'));
      assert.equal(await p.evaluate('fixture.liveBoard().getSnapshot().pending'), 0);
      assert.equal(await p.evaluate(warn), true);
      assert.ok(await p.waitFor("document.querySelector('[aria-label=\"Saving…\"]')", 1300));
      await p.evaluate('confirmed');
      assert.equal(await p.evaluate(warn), false);
      assert.equal(JSON.parse(fs.readFileSync(meta)).title, 'Direct write');
    });

    it('shows retry for an initial read failure and an unsaved warning for a rejected write', async t => {
      let acceptWrites = true;
      const { p } = await open(t, { framed: true, isLocal: req => acceptWrites || !req.url.includes('/_api/db/write') });
      await p.cdp('Network.setBlockedURLs', { urls: ['*_api/db/list*'] });
      await p.evaluate('frames[0].fixture.mount()');
      assert.ok(await p.waitFor("window.reports?.at(-1)?.saved === 'loadError'"));
      assert.ok(await p.evaluate("reports.at(-1).actions.some(a => a.id === 'save_now' && !a.disabled)"));
      assert.ok(await p.waitFor("document.body.textContent.includes('Could not load the board') && !document.body.textContent.includes('Could not save')"));
      await p.cdp('Network.setBlockedURLs', { urls: [] });
      await p.evaluate("frames[0].document.querySelector('.wb-pill [role=status] button').click()");
      assert.ok(await p.waitFor(active));
      acceptWrites = false;
      await p.evaluate("frames[0].fixture.liveBoard().setTitle('Unsaved title')");
      assert.ok(await p.waitFor("window.reports?.at(-1)?.saved === 'unsaved'"));
      assert.equal(await p.evaluate('reports.at(-1).leaveLosesWork'), true);
      assert.deepEqual(await p.evaluate('window.oldBoard = frames[0].fixture.liveBoard(); [oldBoard.title(), oldBoard.getSnapshot().pending]'),
        ['Unsaved title', 1]);
      await p.evaluate('frames[0].fixture.unmount()');
      assert.ok(await p.waitFor('!frames[0].fixture.liveBoard() && oldBoard.getSnapshot().pending === 0'));
      assert.equal(await p.evaluate('oldBoard.title()'), 'Original title');
    });

    it('reports a slow direct write and its leave warning to the framing Shell', async t => {
      const { p, url } = await open(t, { framed: true });
      await mounted(p);
      await delayed(p, new URL('_api/db/write', url).href, 1400);
      await p.evaluate(`window.direct = frames[0].fixture.liveBoard().writeNow([
        {op:'update',path:'board/meta',patch:{title:'Framed direct write'}}]); true`);
      assert.ok(await p.waitFor("window.reports?.at(-1)?.leaveLosesWork && reports.at(-1).saved === 'saved'", 750));
      assert.ok(await p.waitFor("window.reports?.at(-1)?.leaveLosesWork && reports.at(-1).saved === 'saving'", 1400));
      await p.evaluate('direct');
      assert.ok(await p.waitFor("window.reports?.at(-1)?.saved === 'saved' && !reports.at(-1).leaveLosesWork"));
    });

    it('prevents a stale second tab from restoring an invalidated local storage copy during shutdown', async t => {
      let allow = true;
      const { p, url } = await open(t, { isLocal: req => allow || !req.url.includes('/_api/db/write') });
      await mounted(p);
      assert.ok(await p.waitFor('fixture.savedCopyCache().read()?.length'));
      const migrated = await p.evaluate(`(() => {
        const legacy = 'wb-saved-copy:' + location.pathname;
        const scoped = Object.keys(localStorage).find(k => k.startsWith(legacy + ':'));
        const copy = localStorage.getItem(scoped);
        localStorage.setItem(legacy, copy); localStorage.removeItem(scoped);
        const documents = fixture.savedCopyCache().read();
        return documents.length > 0 && localStorage.getItem(legacy) === null && localStorage.getItem(scoped) === copy;
      })()`);
      assert.equal(migrated, true);
      const other = await getBrowser().load(url, { ready: 'window.fixture' });
      try {
        await mounted(other);
        assert.ok(await other.waitFor('fixture.savedCopyCache().read()?.length'));
        allow = false;
        await p.evaluate("fixture.liveBoard().setTitle('Access ended')");
        assert.ok(await p.waitFor("fixture.liveBoard().getSnapshot().lastError?.code === 'not_granted'"));
        assert.equal(await other.evaluate('fixture.savedCopyCache().read() ?? null'), null);
        await other.evaluate('fixture.unmount()');
        assert.ok(await other.waitFor('!fixture.liveBoard()'));
        await p.evaluate('fixture.unmount()');
        assert.ok(await p.waitFor('!fixture.liveBoard()'));
        assert.equal(await other.evaluate('fixture.savedCopyCache().read() ?? null'), null);
      } finally { await other.close(); }
    });

    it('reports readonly while a viewer revalidates its saved copy', async t => {
      const { p, url, id } = await open(t, { isLocal: req => !req.headers['x-test-guest'] });
      const shared = await fetch(new URL('/__open-artifact/share', url), { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer lifecycle' },
        body: JSON.stringify({ id, lan: true }) });
      assert.equal(shared.status, 200);
      const share = await shared.json();
      const invite = new URL(new URL(share.links.viewer.url).pathname, url);
      await p.cdp('Network.setExtraHTTPHeaders', { headers: { 'x-test-guest': '1' } });
      await p.cdp('Page.navigate', { url: invite.href });
      assert.ok(await p.waitFor("document.querySelector('input[name=name]')"));
      await p.evaluate("document.querySelector('input').value = 'Reader'; document.querySelector('form').requestSubmit()");
      assert.ok(await p.waitFor('window.fixture'));
      const frame = new URL('frame.html', await p.evaluate('location.href')).href;
      await p.cdp('Page.navigate', { url: frame });
      assert.ok(await p.waitFor('window.fixture'));
      await mounted(p);
      assert.ok(await p.waitFor('window.fixture?.savedCopyCache().read()?.length'));
      await delayed(p, new URL('_api/db/list', frame).href, 1500);
      await p.cdp('Page.reload');
      assert.ok(await p.waitFor('window.fixture && !fixture.liveBoard()'));
      await p.evaluate('frames[0].fixture.mount()');
      assert.ok(await p.waitFor("window.fixture?.board.getState().revealed && fixture.liveBoard()?.getSnapshot().revalidating"));
      assert.ok(await p.waitFor("window.reports?.at(-1)?.saved === 'readonly'"));
      assert.equal(await p.evaluate("reports.some(r => r.saved === 'syncing')"), false);
      assert.equal(await p.evaluate('frames[0].fixture.liveBoard().canEdit()'), false);
    });

    it('revokes the actual worker result when a look service is stopped before paint completes', async t => {
      const { p } = await open(t);
      const result = await p.evaluate(`(async () => {
        const created = [], revoked = [];
        const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
        URL.createObjectURL = blob => { const url = create.call(URL, blob); created.push(url); return url; };
        URL.revokeObjectURL = url => { revoked.push(url); revoke.call(URL, url); };
        try {
          const src = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 90"><rect width="100" height="90" fill="#ff7722"/></svg>');
          const stop = fixture.startDrawingLooks();
          const job = fixture.requestDrawingLook({ src, w:160, h:140, look:'watercolor', scale:1, scheme:'light' });
          stop(); await job;
          return { created, revoked, cached:fixture.looks.getState().painted.size };
        } finally { URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
      })()`);
      assert.ok(result.created.length);
      assert.deepEqual(result.revoked, result.created);
      assert.equal(result.cached, 0);
    });
  });
}
