// Open a board authored in the original on-disk format through the installed type.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { freePort, zipFolder } from './lib/cloudflare.mjs';
import { clickOn, inFrame, writeNote } from './lib/host-page.mjs';
import { observeRefresh, refreshTrace, savedBoardCopy } from './lib/whiteboard-refresh.mjs';
import { whiteboardLifecycle } from './lib/whiteboard-lifecycle.mjs';
import { cli, run as runCli } from './lib/cli.mjs';
import { expectStatus, png, postJson, until } from './lib/http.mjs';
import { browserOff, fixtures, install, removeTmp, repoRoot, skipFor, tmpDir, typePath } from './lib/target.mjs';

const noBrowser = browserOff || !findChrome();
const pictureId = '0123456789abcdef0123456789abcdef';
const videoId = 'fedcba9876543210fedcba9876543210';
const bytes = png([34, 204, 117]);
const cell = '[data-wb-row="r2"][data-wb-col="c2"]';
const ready = 'document.querySelector(\'[aria-label="Board tools"]\')';
const webCardHref = 'https://example.org/diagram';
const localArtifactHref = 'open-artifact://artifact/art_0123456789';
const latency = (urlPattern, ms) => ({ urlPattern, latency: ms, downloadThroughput: -1, uploadThroughput: -1 });
const delayRequests = (page, rules) => page.cdp('Network.emulateNetworkConditionsByRule', { offline: false, matchedNetworkConditions: rules });
const remoteWrite = async (url, writes) => expectStatus(await postJson(new URL('_api/db/write', url), { client: 'remote-editor', writes }), 200);

describe('whiteboard', { skip: skipFor('whiteboard') }, () => {
  let run, root, url, browser;
  whiteboardLifecycle(() => browser, noBrowser);

  before(async () => {
    const { dir } = install(typePath('whiteboard'));
    const home = tmpDir('whiteboard-home');
    run = cli(dir, { HOME: home, OPEN_ARTIFACT_TYPE_SERVER_HOME: tmpDir('whiteboard-state') });
    root = tmpDir('whiteboard-board');
    const elements = {
      table1: { type: 'table', x: 0, y: 0, head: true, color: 'white', cols: { c1: { at: 1 }, c2: { at: 2 } },
        rows: { r1: { at: 1, c1: 'First', c2: 'Second' }, r2: { at: 2, c1: 'A', c2: 'B' } } },
      picture: { type: 'image', x: 350, y: 0, w: 130, h: 120, src: '_blob/' + pictureId, href: 'https://example.org/' },
      card: { type: 'link', x: 0, y: 160, href: webCardHref, title: 'Diagram', kind: 'whiteboard' },
      native: { type: 'link', x: 520, y: 180, href: localArtifactHref, title: 'Local board' },
      video: { type: 'image', x: 560, y: 0, w: 160, h: 100, src: '_blob/' + pictureId, video: '_blob/' + videoId },
      overlay: { type: 'shape', kind: 'rect', x: 550, y: -15, w: 60, h: 60, color: 'green', text: 'Top' },
      box: { type: 'shape', kind: 'database', x: 300, y: 180, w: 120, h: 90, text: 'Store', color: 'blue', by: 'agent' },
      plain: { type: 'text', x: 350, y: 300, size: 'large', text: '**上线日 周二**' },
      resizeCard: { type: 'shape', kind: 'rounded', x: 0, y: 345, w: 260, h: 150, color: 'yellow', size: 'body', text: '**上线日 周二**\n保留发布说明和检查项' },
    };
    for (const sub of ['db/elements', 'db/board', '_blobs']) fs.mkdirSync(path.join(root, sub), { recursive: true });
    fs.writeFileSync(path.join(root, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Editable diagram', order: Object.keys(elements) }));
    for (const [id, el] of Object.entries(elements)) fs.writeFileSync(path.join(root, 'db/elements', id + '.json'), JSON.stringify(el));
    fs.writeFileSync(path.join(root, '_blobs', pictureId), bytes);
    fs.writeFileSync(path.join(root, '_blobs', pictureId + '.json'), JSON.stringify({ name: 'diagram.png', contentType: 'image/png', bytes: bytes.length }));
    const movie = fs.readFileSync(path.join(fixtures, 'whiteboard/blue.webm'));
    fs.writeFileSync(path.join(root, '_blobs', videoId), movie);
    fs.writeFileSync(path.join(root, '_blobs', videoId + '.json'), JSON.stringify({ name: 'blue.webm', contentType: 'video/webm', bytes: movie.length }));
    ({ url } = await run.json(['open', root, '--type', 'whiteboard', '--json']));
    if (!noBrowser) browser = await launch({ width: 1200, height: 800 });
  });
  after(async () => {
    await browser?.close();
    await run?.run(['stop', root]);
    removeTmp();
  });

  it('keeps the owner viewport and revalidates one saved copy when a Node cloud host rotates the page token', { skip: noBrowser }, async t => {
    const { parseConfig } = await import('../packages/host/src/core/config.ts');
    const { parseNodeEnv, startHost } = await import('../packages/host/src/node/index.ts');
    const port = await freePort();
    const app = `http://localhost:${port}`;
    const env = {
      OA_APP_ORIGIN: app, OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}`,
      OA_DATA_DIR: tmpDir('whiteboard-cloud'), OA_BIND: '127.0.0.1', OA_PORT: String(port),
      OA_OWNER_KEY: crypto.randomUUID(), OA_SIGNING_KEYS: crypto.randomUUID(),
    };
    const host = await startHost({ config: parseConfig(env), env: parseNodeEnv(env), uiDir: path.join(repoRoot, 'dist/daemon') });
    t.after(() => host.stop());
    const p = await browser.load(app + '/auth/sign-in#key=' + env.OA_OWNER_KEY, {
      ready: "document.getElementById('key')?.value.length > 0", ignore: [/favicon\.ico/],
    });
    try {
      await clickOn(p, "document.querySelector('form[action=\"/auth/owner-key\"] button[type=submit]')");
      assert.ok(await p.waitFor("location.pathname === '/'"));
      const zip = await zipFolder(path.join(repoRoot, 'test-artifacts/whiteboard/elements'));
      const { status, artifact } = await p.evaluate(`(async () => {
        const response = await fetch('/api/open-artifact.artifacts.import', {
          method: 'POST', headers: { 'content-type': 'application/zip' },
          body: Uint8Array.fromBase64(${JSON.stringify(zip.toString('base64'))}),
        });
        return { status: response.status, artifact: await response.json() };
      })()`);
      assert.equal(status, 201);
      assert.equal(artifact.role, 'owner');
      await p.cdp('Page.navigate', { url: app + '/a/' + artifact.id });
      assert.ok(await p.waitFor(`window.parent !== window && ${ready} && !document.querySelector('[data-wb-veil]')`));
      const viewer = await inFrame(p, "async base => (await (await fetch(base + '_api/session')).json()).viewer");
      assert.equal(viewer.role, 'owner');
      const scope = 'artifact:' + encodeURIComponent(artifact.id);
      const cameraKey = JSON.stringify('wb-camera:' + scope);
      const copyKey = 'wb-saved-copy:' + scope + ':' + encodeURIComponent(viewer.id) + ':' + viewer.role;
      const boardState = `() => ({
        origin: location.origin, path: location.pathname, camera: JSON.parse(sessionStorage.getItem(${cameraKey})),
        zoom: new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.wb-layer')).transform).a,
        copies: Object.keys(localStorage).filter(key => key.startsWith('wb-saved-copy:')),
      })`;
      assert.notEqual((await inFrame(p, boardState)).zoom, 0.5, 'the sample auto-fits at a different scale');
      await inFrame(p, `() => document.querySelector('button[aria-label^=Zoom]').click()`);
      const half = "[...document.querySelectorAll('[role^=menuitem]')].find(el => el.textContent.trim() === '50%')";
      assert.ok(await p.waitFor(half));
      await inFrame(p, `() => (${half}).click()`);
      assert.ok(await p.waitFor(`JSON.parse(sessionStorage.getItem(${cameraKey}))?.zoom === 0.5`));
      assert.ok(await p.waitFor(savedBoardCopy));
      const before = await inFrame(p, boardState);
      assert.equal(before.zoom, 0.5);
      assert.deepEqual(before.copies, [copyKey]);

      await p.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(${observeRefresh})()` });
      await delayRequests(p, [latency(before.origin + '/whiteboard/*/_api/db/list', 1800)]);
      await new Promise(resolve => setTimeout(resolve, 1200));
      await p.cdp('Page.reload');
      assert.ok(await p.waitFor(`window.parent !== window && location.pathname !== ${JSON.stringify(before.path)}
        && new URLSearchParams(location.search).get('open_artifact_id') === ${JSON.stringify(artifact.id)}
        && document.querySelector('.wb-layer') && !document.querySelector('[data-wb-veil]')`));
      assert.ok(await p.waitFor("window.refreshTrace?.reports.includes('saved')"));
      const trace = await p.evaluate('window.refreshTrace');
      assert.equal(trace.firstReadySaved, 'syncing', JSON.stringify(trace.reports));
      assert.deepEqual(trace.reports, ['loading', 'syncing', 'saved']);
      const after = await inFrame(p, boardState);
      assert.notEqual(after.path, before.path, 'the real host must issue a new editor URL');
      assert.equal(after.zoom, 0.5);
      assert.deepEqual(after.camera, before.camera);

      // Observe a fresh persisted write before counting copies, so the delayed cache writer has run.
      assert.equal(await writeNote(p, 'refresh-check', 'Revalidated copy'), 200);
      assert.ok(await p.waitFor(`JSON.parse((${savedBoardCopy}) || '[]').some(doc => doc.path === 'elements/refresh-check')`));
      assert.deepEqual((await inFrame(p, boardState)).copies, [copyKey]);
      t.diagnostic('Editor path changed; zoom 50% → 50%; first ready report syncing → saved; persisted copies 1 → 1.');
    } finally { await p.close(); }
  });

  it('checks the board and serves the original image bytes, MIME and ranges', async () => {
    const check = await run.run(['check', root, '--type', 'whiteboard']);
    assert.equal(check.code, 0, check.stdout + check.stderr);
    const image = new URL('/_blob/' + pictureId, url);
    const response = await fetch(image);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    const part = await fetch(image, { headers: { Range: 'bytes=0-7' } });
    assert.equal(part.status, 206);
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(0, 8));
  });

  it('keeps board text visible and on whole device pixels throughout a pan', { skip: noBrowser }, async () => {
    const entry = new URL(url);
    entry.searchParams.set('open_artifact_bench', '1');
    const p = await browser.load(entry.href, { ready });
    try {
      await p.cdp('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
      await p.evaluate('window.__openArtifactWhiteboard.setCamera({ x: -100, y: -100, zoom: 0.6 })');
      assert.ok(await p.waitFor(`(() => {
        const transform = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.wb-layer')).transform);
        return transform.a === 0.6 && transform.e === 60 && transform.f === 60;
      })()`), 'the requested camera has been painted');
      const readPositions = `(() => {
        const text = document.querySelector('.wb-layer #wb-plain');
        const card = document.querySelector('.wb-layer #wb-card');
        if (!text || !card) return null;
        const a = text.getBoundingClientRect();
        const b = card.getBoundingClientRect();
        const t = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.wb-layer')).transform);
        return { x: a.x, y: a.y, cardX: b.x, cardY: b.y, e: t.e, f: t.f, visibility: getComputedStyle(text).visibility };
      })()`;
      const initial = await p.evaluate(readPositions);
      const start = await p.evaluate(`(() => {
        const r = document.querySelector('[data-testid="board-surface"]').getBoundingClientRect();
        return { x: r.left + 850, y: r.top + 450 };
      })()`);
      const onDevicePixel = (v) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-6;
      await p.cdp('Input.dispatchMouseEvent', { ...start, type: 'mousePressed', button: 'middle', buttons: 4, clickCount: 1 });
      const steps = [[40.18, 16.32], [40.42, 16.38], [40.7, 16.42], [56.95, 30.7]];
      for (const [i, [dx, dy]] of steps.entries()) {
        // 2026-11-20: Chrome can drop the capture while the button is still down, which ended the pan.
        if (i === 2) await p.evaluate(`document.querySelector('[data-testid="board-surface"]').dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1, pointerType: 'mouse', buttons: 4 }))`);
        await p.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + dx, y: start.y + dy, buttons: 4 });
        assert.ok(await p.waitFor(`(() => {
          const current = ${readPositions};
          return Math.abs(current?.x - ${initial.x + dx}) <= 0.26 && Math.abs(current?.y - ${initial.y + dy}) <= 0.26;
        })()`, 3000), 'the text follows the pointer to within half a device pixel');
        const current = await p.evaluate(readPositions);
        assert.equal(current.visibility, 'visible', 'text stays visible while the camera moves');
        assert.ok(onDevicePixel(current.e) && onDevicePixel(current.f), 'the camera layer sits on whole device pixels');
        assert.ok(Math.abs((current.x - current.cardX) - (initial.x - initial.cardX)) <= 0.01, 'horizontal spacing stays fixed');
        assert.ok(Math.abs((current.y - current.cardY) - (initial.y - initial.cardY)) <= 0.01, 'vertical spacing stays fixed');
      }
      const end = await p.evaluate(readPositions);
      const [endX, endY] = steps.at(-1);
      await p.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x + endX, y: start.y + endY, button: 'middle', buttons: 0, clickCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.deepEqual(await p.evaluate(readPositions), end, 'the text stays in place when the pan ends');
      assert.deepEqual(p.problems, []);
    } finally { await p.close(); }
  });

  it('keeps the card text painted through move and resize previews', { skip: noBrowser }, async () => {
    const entry = new URL(url);
    entry.searchParams.set('open_artifact_bench', '1');
    const p = await browser.load(entry.href, { ready });
    try {
      const card = '#wb-resizeCard';
      const readCard = `(() => {
        const element = document.querySelector('${card}');
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, w: box.width, h: box.height,
          text: element.querySelector('.wb-shape-text')?.textContent };
      })()`;
      const ink = async ({ x, y, w, h }) => {
        const { data } = await p.cdp('Page.captureScreenshot', {
          format: 'png', captureBeyondViewport: false,
          clip: { x: Math.ceil(x) + 8, y: Math.ceil(y) + 8, width: Math.floor(w) - 16, height: Math.floor(h) - 16, scale: 1 },
        });
        return p.evaluate(`(async () => {
          const image = new Image();
          image.src = 'data:image/png;base64,${data}';
          await image.decode();
          const ctx = new OffscreenCanvas(image.width, image.height).getContext('2d');
          ctx.drawImage(image, 0, 0);
          const { data: rgba } = ctx.getImageData(0, 0, image.width, image.height);
          let ink = 0;
          for (let i = 0; i < rgba.length; i += 4) {
            if (rgba[i] + rgba[i + 1] + rgba[i + 2] < 420) ink++;
          }
          return ink;
        })()`);
      };
      const pointer = (type, x, y, buttons) => p.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
      assert.ok(await p.waitFor(`(${readCard})?.text`));
      const initial = await p.evaluate(readCard);
      const initialInk = await ink(initial);
      assert.ok(initialInk > 100, 'the text is present in the composed pixels');
      const x = initial.x + initial.w / 2;
      const y = initial.y + initial.h / 2;
      await pointer('mousePressed', x, y, 1);
      await pointer('mouseMoved', x + 30, y, 1);
      assert.ok(await p.waitFor(`(${readCard})?.x > ${initial.x + 15}`, 3000), 'the rendered card moves while held');
      const moved = await p.evaluate(readCard);
      assert.equal(moved.text, initial.text);
      assert.ok(await ink(moved) >= initialInk * 0.8, 'the moving card still paints its text');
      await pointer('mouseReleased', x + 30, y, 0);

      const handle = '.wb-handle[data-handle="se"]';
      assert.ok(await p.waitFor(`document.querySelector('${handle}')`));
      const corner = await p.evaluate(`(() => {
        const box = document.querySelector('${handle}').getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      })()`);
      await pointer('mousePressed', corner.x, corner.y, 1);
      let priorWidth = moved.w;
      for (const dx of [24, -28, -50]) {
        await pointer('mouseMoved', corner.x + dx, corner.y + 16, 1);
        const changed = dx > 0 ? `> ${priorWidth + 8}` : `< ${priorWidth - 8}`;
        assert.ok(await p.waitFor(`(${readCard})?.w ${changed}`, 3000), 'the displayed width follows the resize handle before release');
        const preview = await p.evaluate(readCard);
        priorWidth = preview.w;
        assert.ok(Math.abs(preview.x - moved.x) < 0.04, 'the opposite edge stays fixed');
        assert.equal(preview.text, initial.text);
        assert.ok(await ink(preview) >= initialInk * 0.8, 'the preview keeps painting the original words');
      }
      const last = await p.evaluate(readCard);
      await pointer('mouseReleased', corner.x - 50, corner.y + 16, 0);
      const stored = () => JSON.parse(fs.readFileSync(path.join(root, 'db/elements/resizeCard.json')));
      assert.ok(await until(() => stored().w < 240));
      assert.equal(stored().text, '**上线日 周二**\n保留发布说明和检查项');
      assert.equal(stored().size, 'body');
      assert.deepEqual(await p.evaluate(readCard), last, 'releasing the pointer keeps the final preview');
      assert.deepEqual(p.problems, []);
    } finally { await p.close(); }
  });

  it('undoes a drag with repeated positions and a pause in one step', { skip: noBrowser }, async () => {
    const dragRoot = tmpDir('whiteboard-drag-undo');
    for (const folder of ['db', '_blobs']) fs.cpSync(path.join(root, folder), path.join(dragRoot, folder), { recursive: true });
    const { url: dragUrl } = await run.json(['open', dragRoot, '--type', 'whiteboard', '--json']);
    const p = await browser.load(dragUrl, { ready });
    try {
      const card = "document.querySelector('#wb-resizeCard')";
      assert.ok(await p.waitFor(card));
      const start = await p.evaluate(`(() => {
        const box = ${card}.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      })()`);
      const position = () => p.evaluate(`${card}.style.left`);
      const original = await position();
      const pointer = (type, dx, buttons) => p.cdp('Input.dispatchMouseEvent', { type, x: start.x + dx, y: start.y, button: 'left', buttons, clickCount: 1 });
      await pointer('mousePressed', 0, 1);
      await pointer('mouseMoved', 40, 1);
      assert.ok(await p.waitFor(`${card}.style.left !== ${JSON.stringify(original)}`));
      const first = await position();
      await pointer('mouseMoved', 40, 1);
      await new Promise(resolve => setTimeout(resolve, 1650));
      const remoteText = 'Updated by another editor';
      await run.json(['write-db', dragRoot, JSON.stringify([{ op: 'update', path: 'elements/resizeCard', data: { text: remoteText } }])]);
      const text = `${card}.querySelector('.wb-shape-text').textContent`;
      assert.ok(await p.waitFor(`${text} === ${JSON.stringify(remoteText)}`));
      await pointer('mouseMoved', 117, 1);
      assert.ok(await p.waitFor(`${card}.style.left !== ${JSON.stringify(first)}`));
      await pointer('mouseReleased', 117, 0);
      const final = await position();
      assert.notEqual(final, original);

      const mod = process.platform === 'darwin' ? { meta: true } : { ctrl: true };
      await p.press('z', mod);
      assert.equal(await position(), original, 'one undo restores the start of the drag');
      assert.equal(await p.evaluate(text), remoteText, 'undo leaves the edit received during the drag');
      await p.press('z', { ...mod, shift: true });
      assert.equal(await position(), final, 'one redo restores the final drop');
      const saved = () => JSON.parse(fs.readFileSync(path.join(dragRoot, 'db/elements/resizeCard.json'))).x;
      assert.ok(await until(() => Math.abs(saved() - parseFloat(final)) < 0.01), `saved position ${saved()} should match ${final}`);

      await pointer('mousePressed', 117, 1);
      await pointer('mouseMoved', 155, 1);
      assert.ok(await p.waitFor(`${card}.style.left !== ${JSON.stringify(final)}`));
      const intermediate = await position();
      // On a horizontal drag, Shift recomputes the same position without moving the pointer.
      await p.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', modifiers: 8 });
      await p.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft' });
      assert.equal(await position(), intermediate);
      await pointer('mouseMoved', 193, 1);
      assert.ok(await p.waitFor(`${card}.style.left !== ${JSON.stringify(intermediate)}`));
      await pointer('mouseReleased', 193, 0);
      await p.press('z', mod);
      assert.equal(await position(), final, 'a second drag undoes separately even after no-op frames');
      await p.press('z', mod);
      assert.equal(await position(), original);
      assert.deepEqual(p.problems, []);
    } finally { await p.close(); }
  });

  it('edits a non-first cell, saves it, and reopens it', { skip: noBrowser }, async () => {
    const p = await browser.load(url, { ready });
    try {
      assert.ok(await p.waitFor(`document.querySelector('${cell}')`));
      assert.equal(await p.evaluate("document.querySelector('#wb-card a').href"), webCardHref);
      assert.ok(await p.waitFor("document.querySelector('#wb-picture img')?.naturalWidth === 2"));
      const point = await p.evaluate(`(() => { const r = document.querySelector('${cell}').getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
      await p.clickTimes(...point, 2);
      assert.ok(await p.waitFor(`document.querySelector('${cell} [contenteditable=true]')`, 3000), 'editor opens inside the clicked cell');
      await p.type('Edited');
      await p.press('Escape');
      const saved = () => JSON.parse(fs.readFileSync(path.join(root, 'db/elements/table1.json'))).rows.r2;
      assert.ok(await until(() => saved().c2.includes('Edited')));
      assert.equal(saved().c1, 'A');
      await p.cdp('Page.reload', {});
      assert.ok(await p.waitFor(`document.querySelector('${cell}')?.innerText.includes('Edited')`));
      assert.deepEqual(p.problems, []);
    } finally { await p.close(); }
  });

  it('plays and pauses an imported video from the canvas', { skip: noBrowser }, async () => {
    const p = await browser.load(url, { ready });
    try {
      assert.ok(await p.waitFor("document.querySelector('.wb-layer #wb-overlay')"));
      const top = await p.evaluate(`(() => {
        const r = document.querySelector('#wb-overlay').getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-wb-id]')?.dataset.wbId;
      })()`);
      assert.equal(top, 'overlay', 'a shape in front of the video still receives the press');
      const play = '#wb-video [data-video-play]';
      assert.ok(await p.waitFor(`document.querySelector('${play}')`));
      const point = await p.evaluate(`(() => {const r = document.querySelector('${play}').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];})()`);
      await p.click(...point);
      assert.ok(await p.waitFor("document.querySelector('#wb-video video')?.currentTime > 0.65"));
      await p.click(...point);
      assert.ok(await p.waitFor("document.querySelector('#wb-video video')?.paused === true", 3000));
    } finally { await p.close(); }
  });

  it('decodes a server-added viewport image before the first revealed frame', { skip: noBrowser }, async t => {
    const dir = tmpDir('refresh-images');
    const second = 'a'.repeat(32);
    fs.mkdirSync(path.join(dir, '_blobs'));
    for (const id of [pictureId, second]) {
      fs.copyFileSync(path.join(root, '_blobs', pictureId), path.join(dir, '_blobs', id));
      fs.copyFileSync(path.join(root, '_blobs', pictureId + '.json'), path.join(dir, '_blobs', id + '.json'));
    }
    const { url: address } = await run.json(['open', dir, '--type', 'whiteboard', '--json']);
    const picture = (id, x) => ({ type: 'image', src: '_blob/' + id, x, y: 0, w: 140, h: 100 });
    await remoteWrite(address, [{ op: 'set', path: 'board/meta', data: { v: 1, title: 'Viewport', order: ['a'] } },
      { op: 'set', path: 'elements/a', data: picture(pictureId, 0) }]);
    const p = await browser.load(address, { ready });
    try {
      assert.ok(await p.waitFor(savedBoardCopy));
      const firstSrc = await p.evaluate("document.querySelector('#wb-a img').src");
      const listUrl = new URL([...p.urls].find(url => new URL(url).pathname.endsWith('/_api/db/list')));
      await p.cdp('Page.navigate', { url: 'about:blank' });
      assert.ok(await p.waitFor("location.href === 'about:blank'"));
      await remoteWrite(address, [{ op: 'set', path: 'elements/b', data: picture(second, 150) }]);
      await p.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(${observeRefresh})()` });
      await p.cdp('Network.setCacheDisabled', { cacheDisabled: true });
      await delayRequests(p, [latency(listUrl.origin + listUrl.pathname, 300),
        latency(firstSrc, 650), latency(firstSrc.replace(pictureId, second), 850)]);
      await p.cdp('Page.navigate', { url: address });
      assert.ok(await p.waitFor('window.refreshTrace?.firstFrame'));
      const first = await p.evaluate('refreshTrace.firstFrame');
      const timings = await p.evaluate("performance.getEntriesByType('resource').filter(r => /db\\/list|_blob/.test(r.name)).map(r => [r.name,r.startTime,r.responseEnd])");
      assert.deepEqual(first.imageStates.map(item => item.id).sort(), ['a', 'b'], JSON.stringify(timings));
      assert.ok(first.imageStates.every(item => item.complete && item.width > 0));
      assert.equal(first.decoded, 2);
      for (const [suffix, ms] of [[pictureId, 650], [second, 850]]) {
        const request = timings.find(([name]) => name.endsWith(suffix));
        assert.ok(request && request[2] - request[1] >= ms - 30 && request[2] <= first.at, JSON.stringify(timings));
      }
      await remoteWrite(address, [{ op: 'set', path: 'elements/c', data: picture(second, 300) }]);
      assert.ok(await p.waitFor("document.querySelector('#wb-c img')?.naturalWidth"));
      assert.deepEqual(await p.evaluate('refreshTrace.veil'), [true, false]);

      assert.ok(await p.waitFor(`JSON.parse((${savedBoardCopy}) || '[]').some(doc => doc.path === 'elements/c')`));
      await p.cdp('Page.navigate', { url: 'about:blank' });
      assert.ok(await p.waitFor("location.href === 'about:blank'"));
      await remoteWrite(address, [{ op: 'set', path: 'elements/late', data: picture(second, 450) }]);
      await delayRequests(p, [latency(listUrl.origin + listUrl.pathname, 720)]);
      await p.cdp('Page.navigate', { url: address });
      assert.ok(await p.waitFor("window.refreshTrace?.firstFrame && document.querySelector('#wb-late img')?.naturalWidth"));
      const cached = await p.evaluate('refreshTrace.firstFrame');
      const listed = await p.evaluate("performance.getEntriesByType('resource').filter(r => new URL(r.name).pathname.endsWith('/_api/db/list')).map(r => r.responseEnd)");
      assert.deepEqual(cached.imageStates.map(item => item.id).sort(), ['a', 'b', 'c']);
      assert.equal(cached.decoded, 3);
      assert.ok(listed.length === 2 && listed.every(at => at > cached.at), JSON.stringify({ cached: cached.at, listed }));
      assert.deepEqual(await p.evaluate('refreshTrace.veil'), [true, false]);
      t.diagnostic(`cached images decoded at ${Math.round(cached.at)} ms, first list response at ${Math.round(Math.min(...listed))} ms`);
    } finally { await p.close(); }
  });

  it('reveals visible fallback text within the font budget and upgrades to the actual Inter font', { skip: noBrowser }, async t => {
    const dir = tmpDir('slow-font');
    const { url: address } = await run.json(['open', dir, '--type', 'whiteboard', '--json']);
    await remoteWrite(address, [
      { op: 'set', path: 'board/meta', data: { v: 1, title: 'Font timing', order: ['fontbudget'] } },
      { op: 'set', path: 'elements/fontbudget', data: { type: 'text', x: 0, y: 0, size: 'large', text: '**Visible board text**' } },
    ]);
    const assets = path.join(typePath('whiteboard'), 'scripts/editors/whiteboard/assets');
    const file = fs.readdirSync(assets).find(name => /^inter-latin-wght-normal-.*\.woff2$/.test(name));
    assert.ok(file);
    const fontUrl = new URL('assets/' + file + '?font-budget', address).href;
    const p = await browser.load('about:blank', { settle: 0 });
    try {
      await p.cdp('DOM.enable');
      await p.cdp('CSS.enable');
      await p.cdp('Network.setCacheDisabled', { cacheDisabled: true });
      await delayRequests(p, [latency(fontUrl, 1150)]);
      await p.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
        (${observeRefresh})();
        addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style');
          style.textContent = '#wb-fontbudget, #wb-fontbudget * {font-family: "Board Inter", monospace !important}';
          document.head.append(style);
          const face = new FontFace('Board Inter', 'url(' + ${JSON.stringify(fontUrl)} + ')', { display: 'swap', weight: '100 900' });
          document.fonts.add(face);
          const timing = window.fontTiming = {};
          document.fonts.load('bold 24px "Board Inter"').then(() => { timing.loaded = performance.now(); });
          new MutationObserver(() => {
            if (document.querySelector('#wb-fontbudget strong')) timing.text ??= performance.now();
            if (refreshTrace.firstFrame && !timing.first) {
              const camera = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.wb-layer')).transform);
              timing.first = { status: face.status, at: refreshTrace.firstFrame.at,
                translation: [camera.e * devicePixelRatio, camera.f * devicePixelRatio] };
            }
          }).observe(document, {subtree:true, childList:true, attributes:true});
        }, {once:true});
      ` });
      await p.cdp('Page.navigate', { url: address });
      assert.ok(await p.waitFor('window.fontTiming?.first'));
      const fontsUsed = async () => {
        const { root: documentNode } = await p.cdp('DOM.getDocument');
        const { nodeId } = await p.cdp('DOM.querySelector', { nodeId: documentNode.nodeId, selector: '#wb-fontbudget strong' });
        return (await p.cdp('CSS.getPlatformFontsForNode', { nodeId })).fonts.filter(font => font.glyphCount > 0);
      };
      const first = await p.evaluate('({ ...fontTiming, layout: refreshTrace.firstFrame.laidOutText })');
      assert.equal(first.first.status, 'loading', JSON.stringify(first));
      assert.equal(first.layout, 1);
      assert.ok(first.first.translation.every(n => Math.abs(n - Math.round(n)) < 0.01), JSON.stringify(first));
      assert.ok(first.first.at - first.text >= 430 && first.first.at < 900, JSON.stringify(first));
      const fallback = await fontsUsed();
      assert.ok(fallback.length && fallback.every(font => !font.isCustomFont), JSON.stringify(fallback));
      assert.ok(await p.waitFor('window.fontTiming?.loaded'));
      const final = await p.evaluate(`({ ...fontTiming, duration: performance.getEntriesByName(${JSON.stringify(fontUrl)})[0].duration, veil: refreshTrace.veil })`);
      assert.ok(final.duration >= 1100 && final.first.at < final.loaded, JSON.stringify(final));
      assert.deepEqual(final.veil, [true, false]);
      const inter = await fontsUsed();
      assert.ok(inter.some(font => font.isCustomFont && /Inter/i.test(font.familyName)), JSON.stringify(inter));
      t.diagnostic(`fallback ${fallback[0].familyName} at ${Math.round(first.first.at)} ms, font wait ${Math.round(first.first.at - first.text)} ms, Inter loaded at ${Math.round(final.loaded)} ms`);
    } finally { await p.close(); }
  });

  describe('global frame shell', { skip: noBrowser }, () => {
    let daemon, shellBoard, shellUrl, downloads, shellRoot, previous;

    before(async () => {
      const home = tmpDir('whiteboard-shell-home');
      downloads = path.join(home, 'Downloads');
      const env = {
        HOME: home,
        OPEN_ARTIFACT_HOME: path.join(home, 'daemon'),
        OPEN_ARTIFACT_USER_TYPES: path.join(home, 'types'),
        OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(home, 'servers'),
      };
      previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
      Object.assign(process.env, env);
      const staticType = path.join(env.OPEN_ARTIFACT_USER_TYPES, 'refresh-static');
      fs.mkdirSync(staticType, { recursive: true });
      fs.copyFileSync(path.join(fixtures, 'design-system/project/components/Button/preview.html'), path.join(staticType, 'index.html'));
      const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
      const installed = install(typePath('whiteboard'), 'shell-whiteboard');
      const editorAssets = path.join(installed.dir, 'scripts/editors/whiteboard');
      fs.copyFileSync(path.join(staticType, 'index.html'), path.join(editorAssets, 'navigation.html'));
      fs.copyFileSync(path.join(fixtures, 'whiteboard-lifecycle/slow-static.html'), path.join(editorAssets, 'slow-static.html'));
      fs.writeFileSync(path.join(editorAssets, 'navigation.png'), bytes);
      daemon = await startDaemon({ port: 0, idleMs: 0, quiet: true, browse: null, builtinTypesDir: installed.work });
      shellRoot = tmpDir('whiteboard-shell-board');
      for (const folder of ['db', '_blobs']) fs.cpSync(path.join(root, folder), path.join(shellRoot, folder), { recursive: true });
      shellBoard = daemon.store.create({ root: shellRoot, type: 'whiteboard', title: 'Editable diagram' });
      shellUrl = daemon.viewUrl(shellBoard.id);
    });
    after(async () => {
      try { await daemon?.close(); } finally {
        for (const [key, value] of Object.entries(previous ?? {})) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });

    it('opens sharing and downloads PNG and portable JSON from Share → Export', async () => {
      const p = await browser.load(shellUrl, { ready });
      try {
        const exportFromShell = async label => {
          await p.evaluate("document.querySelector('button[aria-label=Share]').click()");
          assert.ok(await p.waitFor("document.body.innerText.includes('Only this computer') && document.body.innerText.includes('Invite links')"));
          await p.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Export').click()");
          const row = `document.querySelector('[data-export-row="${label}"]')`;
          assert.ok(await p.waitFor(row + '?.disabled === false'));
          await p.evaluate(row + '.click()');
        };
        await exportFromShell('PNG image');
        const name = () => fs.existsSync(downloads) && fs.readdirSync(downloads).find(f => f.endsWith('.png'));
        assert.ok(await until(name, 15000), 'a PNG reached the download folder');
        const file = fs.readFileSync(path.join(downloads, name()));
        assert.equal(file.subarray(1, 4).toString(), 'PNG');
        assert.ok(file.readUInt32BE(16) > 350 && file.readUInt32BE(20) > 160);
        const samples = await p.evaluate(`(async () => {
          const img = new Image();
          img.src = 'data:image/png;base64,${file.toString('base64')}';
          await img.decode();
          const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d');
          ctx.drawImage(img, 0, 0);
          const { data } = ctx.getImageData(0, 0, img.width, img.height);
          let count = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] === 34 && data[i + 1] === 204 && data[i + 2] === 117) count++;
          }
          return count;
        })()`);
        assert.ok(samples > 10, 'the exported board contains the pixels of the original upload');
        await exportFromShell('Board file');
        const filename = path.join(downloads, 'Editable diagram.json');
        assert.ok(await until(() => fs.existsSync(filename), 15000));
        const exported = JSON.parse(fs.readFileSync(filename));
        assert.equal(exported.format, 'open-artifact-whiteboard');
        const embedded = exported.items.find(el => el.id === 'picture').src;
        assert.ok(embedded.startsWith('data:image/'));
        assert.equal(await p.evaluate(`(async () => {
          const img = new Image(); img.src = ${JSON.stringify(embedded)}; await img.decode(); return img.naturalWidth;
        })()`), 2);
        assert.equal(exported.items.find(el => el.id === 'video').video, undefined);
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('routes the board shortcut through the shell and keeps download out of the zoom menu', async () => {
      const p = await browser.load(shellUrl, { ready });
      try {
        await p.evaluateAll("document.querySelector('.wb-foot') && document.querySelector('button[aria-label^=Zoom]').click()");
        const shortcuts = "[...document.querySelectorAll('[role^=menuitem]')].find(e => e.textContent.includes('Single-key tool shortcuts'))";
        assert.ok(await p.waitFor(shortcuts));
        assert.ok(await p.waitFor("document.querySelector('.wb-foot [aria-label=Select]') && !document.body.innerText.includes('Download board')"));
        await p.evaluateAll(shortcuts + '?.click()');
        await p.click(420, 320);
        await p.evaluate(`addEventListener('message', e => {
          if (e.source === document.querySelector('iframe').contentWindow && e.data?.openArtifact === 'request_comment_mode') window.requestedOn = e.data.on;
        })`);
        await p.type('c');
        assert.ok(await p.waitFor("window.requestedOn === true && document.querySelector('button[aria-label=Comments]')?.getAttribute('aria-pressed') === 'true'"));
        assert.ok(await p.waitFor("document.querySelector('.wb-surface.wb-commenting')"));
      } finally { await p.close(); }
    });

    it('creates a pinned comment from the header and reads it in the global comments list', async () => {
      const p = await browser.load(shellUrl, { ready });
      try {
        const toggle = "document.querySelector('button[aria-label=Comments]')";
        assert.ok(await p.waitFor(toggle));
        assert.ok(await p.waitFor("document.querySelector('.wb-foot') && !document.querySelector('button[aria-label=Comment]')"));
        await p.evaluate(toggle + '.click()');
        assert.ok(await p.waitFor("document.querySelector('.wb-surface.wb-commenting')"));
        await p.click(420, 320);
        const layer = "document.querySelector('[data-comment-layer]')?.shadowRoot";
        assert.ok(await p.waitFor(layer + "?.querySelector('textarea')"));
        assert.ok(await p.waitFor("(t => Boolean(t) && getComputedStyle(t).maxHeight.endsWith('px'))(" + layer + "?.querySelector('textarea'))"), 'a long draft scrolls in its box');
        await p.type('Review this spot');
        await p.press('Enter');
        assert.ok(await until(() => fs.existsSync(path.join(shellRoot, 'comments.json')) && fs.readFileSync(path.join(shellRoot, 'comments.json'), 'utf8').includes('Review this spot')));
        await p.evaluate("document.querySelector('button[aria-label=\"Comment options\"]').click()");
        const list = "[...document.querySelectorAll('[role=menuitem]')].find(e => e.textContent.includes('Show all comments'))";
        assert.ok(await p.waitFor(list));
        assert.match(await p.evaluate(list + '.textContent'), /1/);
        await p.evaluate(list + '.click()');
        assert.ok(await p.waitFor("document.querySelector('[data-comments-panel-layer]')?.shadowRoot?.textContent.includes('Review this spot')"));
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('resolves a new thread from its card, which closes', async () => {
      const p = await browser.load(shellUrl, { ready });
      try {
        const toggle = "document.querySelector('button[aria-label=Comments]')";
        assert.ok(await p.waitFor(toggle));
        await p.evaluate(toggle + '.click()');
        assert.ok(await p.waitFor("document.querySelector('.wb-surface.wb-commenting')"));
        await p.click(520, 380);
        const layer = "document.querySelector('[data-comment-layer]')?.shadowRoot";
        assert.ok(await p.waitFor(layer + "?.querySelector('textarea')"));
        await p.type('Resolve me');
        await p.press('Enter');
        const resolve = layer + "?.querySelector('[data-comment-card] button[aria-label=Resolve]')";
        assert.ok(await p.waitFor(resolve));
        // The comments layer is in the board's frame.
        assert.ok((await p.evaluateAll(`(b => Boolean(b) && (b.click(), true))(${resolve})`)).includes(true));
        assert.ok(await p.waitFor(`${layer} && !${layer}.querySelector('[data-comment-card]')`), 'the card closes on Resolve');
        const saved = () => JSON.parse(fs.readFileSync(path.join(shellRoot, 'comments.json'), 'utf8')).threads.find(t => t.messages[0]?.text === 'Resolve me');
        assert.ok(await until(() => saved()?.status === 'resolved'));
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('places zoom beside the toolbar and above it when space runs out', async () => {
      const p = await browser.load(shellUrl, { ready });
      try {
        assert.ok(await p.waitFor(`document.querySelector('#wb-native a')?.href === '${daemon.origin}/a/art_0123456789'`));
        const layout = test => `(() => {
          const c = document.querySelector('.wb-corner-zoom')?.getBoundingClientRect();
          const f = document.querySelector('.wb-foot')?.getBoundingClientRect();
          return c && f && (${test});
        })()`;
        assert.ok(await p.waitFor(layout('c.left >= f.right && Math.abs(c.bottom - f.bottom) < 2'), 5000), 'zoom follows the available toolbar space');
        await p.evaluate("document.querySelector('iframe').style.width = '400px'");
        assert.ok(await p.waitFor(layout('c.bottom <= f.top - 6 && c.right <= 400'), 3000), 'zoom follows the available toolbar space');
      } finally { await p.close(); }
    });

    it('reveals a static HTML page just after its frame loads without a chrome report', async () => {
      const entry = daemon.store.create({ root: tmpDir('static-artifact'), type: 'refresh-static', title: 'Static page' });
      const p = await browser.load('about:blank', { settle: 0 });
      try {
        await p.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `if (window === top) {
          const timing = window.staticTiming = { covered: false, reports: 0 };
          document.addEventListener('load', event => {
            if (event.target.matches?.('iframe')) timing.load = performance.now();
          }, true);
          addEventListener('message', e => { if (e.data?.openArtifact === 'chrome_report') timing.reports++; });
          new MutationObserver(() => {
            if (document.querySelector('[data-shell-loading]')) timing.covered = true;
            else if (timing.covered) timing.reveal ??= performance.now();
          }).observe(document, { childList: true, subtree: true });
        }` });
        await p.cdp('Page.navigate', { url: daemon.viewUrl(entry.id) });
        assert.ok(await p.waitFor('window.staticTiming?.reveal'));
        const { load, reveal, reports } = await p.evaluate('window.staticTiming');
        assert.equal(reports, 0);
        assert.ok(reveal >= load && reveal - load < 250, `revealed ${reveal - load} ms after load`);
        assert.ok(await p.waitFor("document.querySelector('button')?.textContent === 'Smoke button'"));
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('clears ready tools on an internal static navigation and restores them on return in the same iframe', { timeout: 20000 }, async () => {
      const p = await browser.load(shellUrl, { ready });
      try {
        const history = 'document.querySelector(\'header button[aria-label="Version history"]\')';
        assert.ok(await p.waitFor(history + '?.disabled === false'));
        const editor = await p.evaluate(`(() => {
          const frame = window.originalFrame = document.querySelector('iframe');
          const timing = window.internalNavigation = {};
          frame.addEventListener('load', () => { timing.load = performance.now(); }, {once:true, capture:true});
          const observer = new MutationObserver(() => {
            if (timing.load && !${history} && !document.querySelector('[data-shell-loading]')) {
              timing.clear = performance.now(); observer.disconnect();
            }
          });
          observer.observe(document.body, {subtree:true, childList:true, attributes:true});
          return frame.src;
        })()`);
        const dest = new URL('navigation.html', editor).href;
        const link = (from, to) => p.evaluateAll(`(() => {
          if (window === top || !document.querySelector(${JSON.stringify(from)})) return;
          const a = document.createElement('a'); a.href = ${JSON.stringify(to)};
          a.textContent = 'Open page'; document.body.append(a); setTimeout(() => a.click(), 50);
        })()`);
        await link('.wb-root', dest);
        assert.ok(await p.waitFor("document.querySelector('button')?.textContent === 'Smoke button'"));
        assert.ok(await p.waitFor(`window === top && !${history} && !document.querySelector('[data-shell-loading]')`, 1000));
        const nav = await p.evaluate('internalNavigation');
        assert.ok(nav.clear >= nav.load && nav.clear - nav.load < 250, JSON.stringify(nav));
        assert.deepEqual(await p.evaluate("Object.keys(sessionStorage).filter(k => k.startsWith('oa-shell-chrome:'))"), []);
        await link('button', editor);
        assert.ok(await p.waitFor(history + '?.disabled === false'));
        assert.equal(await p.evaluate("document.querySelector('iframe') === originalFrame"), true);
      } finally { await p.close(); }
    });

    it('clears cross-origin editor commands before a slow static image finishes loading', async t => {
      const p = await browser.load(shellUrl, { ready });
      const history = 'document.querySelector(\'header button[aria-label="Version history"]\')';
      try {
        assert.ok(await p.waitFor(history + '?.disabled === false'));
        const editor = await p.evaluate(`(() => {
          const frame = document.querySelector('iframe');
          const timing = window.slowNavigation = { loads: 0 };
          const now = () => performance.timeOrigin + performance.now();
          frame.addEventListener('load', () => timing.loads++);
          addEventListener('message', e => {
            if (e.origin === new URL(frame.src).origin && e.data?.openArtifact === 'chrome_leaving') {
              timing.leaving = now(); timing.id = e.data.documentId;
              timing.source = e.source === null ? 'detached' : e.source === frame.contentWindow ? 'frame' : 'other';
            }
          });
          new MutationObserver(() => {
            if (${history}?.disabled !== false) timing.disabled ??= now();
          }).observe(document.body, {subtree:true, attributes:true, childList:true});
          return frame.src;
        })()`);
        assert.notEqual(new URL(editor).origin, new URL(shellUrl).origin);
        const [documentId] = (await p.evaluateAll("window !== top && document.querySelector('.wb-root') && performance.timeOrigin")).filter(Boolean);
        const follow = href => p.evaluateAll(`(() => {
          if (window === top || !document.querySelector('.wb-root')) return;
          const link = document.createElement('a'); link.href = ${JSON.stringify(href)}; link.textContent = 'Open'; document.body.append(link);
          link.click();
        })()`);
        await follow('#current-board');
        assert.ok(await p.waitFor("window !== top && location.hash === '#current-board'"));
        assert.deepEqual(await p.evaluate(`[slowNavigation.loads, !!slowNavigation.leaving, ${history}?.disabled]`), [0, false, false]);
        const pngUrl = new URL('navigation.png', editor).href;
        await delayRequests(p, [latency(pngUrl, 1150)]);
        await follow(new URL('slow-static.html', editor).href);
        assert.ok(await p.waitFor("document.querySelector('#static-body') && document.readyState === 'interactive' && !document.querySelector('img').complete"));
        const [bodyAt] = (await p.evaluateAll("document.querySelector('#static-body') && performance.timeOrigin + performance.getEntriesByType('navigation')[0].domContentLoadedEventStart")).filter(Boolean);
        const state = await p.evaluate(`({ ...slowNavigation, enabled: ${history}?.disabled === false })`);
        assert.equal(state.id, documentId, JSON.stringify({ state, bodyAt, shellUrl, editor }));
        assert.equal(state.loads, 0);
        assert.equal(state.enabled, false, JSON.stringify({ bodyAt, state }));
        assert.ok(state.disabled <= bodyAt + 100 && Math.abs(state.disabled - state.leaving) < 150, JSON.stringify({ bodyAt, state }));
        assert.ok(await p.waitFor("document.querySelector('#static-body') && document.querySelector('img').naturalWidth > 0"));
        const [duration] = (await p.evaluateAll(`performance.getEntriesByName(${JSON.stringify(pngUrl)})[0]?.duration`)).filter(Boolean);
        assert.ok(duration >= 1100, String(duration));
        assert.ok(await p.waitFor(`window === top && !${history} && !document.querySelector('[data-shell-loading]')`));
        t.diagnostic(`history disabled ${Math.round(state.disabled - state.leaving)} ms after leaving, document source ${state.source}, static image ${Math.round(duration)} ms`);
      } finally { await p.close(); }
    });

    for (const mode of ['direct', 'toolbar=0', 'toolbar=1']) {
      it('announces a slow board and guards focus and editing until reveal in ' + mode, async () => {
        const dir = tmpDir('slow-input');
        fs.mkdirSync(path.join(dir, 'db/elements'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'db/board'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Slow board', order: ['only'] }));
        fs.writeFileSync(path.join(dir, 'db/elements/only.json'), JSON.stringify({ type: 'note', text: 'Select me', x: 0, y: 0, w: 120, h: 90 }));
        const entry = daemon.store.create({ root: dir, type: 'whiteboard', title: 'Slow board' });
        const address = mode === 'direct' ? (await run.json(['open', dir, '--type', 'whiteboard', '--json'])).url : daemon.viewUrl(entry.id) + '?' + mode;
        const pageAddress = mode === 'direct' ? address : (await daemon.openPage(entry)).page_url;
        const p = await browser.load('about:blank', { settle: 0 });
        const focusRegion = "document.activeElement?.closest('[data-wb-region]')?.dataset.wbRegion";
        const count = () => fs.readdirSync(path.join(dir, 'db/elements')).length;
        const keys = async () => {
          await p.press('a', { meta: true });
          await p.press('d', { meta: true });
          for (const type of ['rawKeyDown', 'keyUp']) await p.cdp('Input.dispatchKeyEvent', { type, key: 'F6', code: 'F6', windowsVirtualKeyCode: 117 });
        };
        try {
          await delayRequests(p, [latency(new URL('_api/db/list', pageAddress).href, 4800)]);
          await p.cdp('Page.navigate', { url: address });
          const announced = `document.querySelector('.wb-veil[role=status]')?.checkVisibility() &&
            document.querySelector('.wb-veil').textContent.trim() && document.querySelector('.wb-surface')?.closest('[inert]') &&
            !document.querySelector('.wb-veil').closest('[inert]')`;
          assert.ok(await p.waitFor(announced, 5000), JSON.stringify([p.problems, [...p.urls].filter(u => u.includes('/_api/')), await p.evaluateAll('document.body.innerText.slice(0,140)')]));
          if (mode !== 'direct') {
            assert.ok(await p.waitFor("window === top && performance.now() >= 2600 && document.querySelector('iframe')?.inert && document.querySelector('[data-shell-loading]')"));
            assert.equal(await p.evaluate("!!document.querySelector('header')"), mode === 'toolbar=1');
          }
          assert.ok(await p.waitFor(announced, 500));
          await p.click(500, 350);
          await keys();
          assert.ok(!(await p.evaluateAll(focusRegion)).some(Boolean));
          assert.ok(!(await p.evaluateAll("!!document.querySelector('.wb-sel-frame')")).includes(true));
          assert.equal(count(), 1);
          assert.ok(await p.waitFor("document.querySelector('#wb-only') && !document.querySelector('.wb-veil')"));
          if (mode !== 'direct') assert.ok(await p.waitFor("window === top && !document.querySelector('iframe').inert && !document.querySelector('[data-shell-loading]')"));
          await p.evaluateAll("document.querySelector('.wb-surface')?.focus()");
          await keys();
          assert.ok(await until(() => count() === 2));
          assert.ok((await p.evaluateAll(focusRegion)).some(region => region && region !== 'canvas'));
        } finally { await p.close(); }
      });
    }

    for (const mode of ['direct', 'shell']) {
      it('keeps the remembered Ask button in place while refreshing the agent status in ' + mode, async () => {
        const address = mode === 'shell' ? shellUrl : (await daemon.openPage(shellBoard)).page_url;
        const p = await browser.load(address, { ready });
        try {
          const cached = "JSON.parse(sessionStorage.getItem('wb-agent:' + location.pathname))";
          assert.ok(await p.waitFor(cached + '?.available'));
          const [agent] = (await p.evaluateAll(cached)).filter(Boolean);
          assert.equal(Object.hasOwn(agent, 'busy'), false);
          const [session] = (await p.evaluateAll(`${ready} && new URL('_api/session', location.href).href`)).filter(Boolean);
          assert.ok(p.urls.has(session));
          await p.cdp('Network.emulateNetworkConditionsByRule', { offline: false, matchedNetworkConditions: [
            { urlPattern: session, latency: 700, downloadThroughput: -1, uploadThroughput: -1 },
          ] });
          await p.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `{
            const trace = window.agentToolbar = { positions: [] };
            const sample = () => {
              const toolbar = document.querySelector('[aria-label="Board tools"]');
              if (toolbar) {
                const ask = [...toolbar.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify('Ask ' + agent.name)});
                const x = ask?.getBoundingClientRect().left ?? null;
                if (trace.positions.at(-1) !== x) trace.positions.push(x);
                trace.last = performance.timeOrigin + performance.now();
                trace.first ??= trace.last;
              }
              requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          }` });
          await p.cdp('Page.reload');
          const timing = `(() => {
            const trace = window.agentToolbar;
            if (!trace) return;
            const responses = performance.getEntriesByName(${JSON.stringify(session)});
            const end = responses.at(-1)?.responseEnd;
            const statusAt = responses.length >= 2 && end > 0 ? performance.timeOrigin + end : null;
            return { top: window === top, toolbar: ${ready} ? trace : null, statusAt };
          })()`;
          let trace, statusAt;
          assert.ok(await until(async () => {
            const frames = (await p.evaluateAll(timing)).filter(Boolean);
            const board = frames.find(frame => frame.toolbar?.first);
            trace = board?.toolbar;
            // In a brokered page, the Shell can own the board's HTTP requests.
            statusAt = board?.statusAt ?? (mode === 'shell' ? frames.find(frame => frame.top)?.statusAt : null);
            return Number.isFinite(statusAt) && trace?.last >= statusAt;
          }, 10_000), 'the toolbar must be sampled after the reloaded session response');
          assert.ok(Number.isFinite(statusAt));
          assert.ok(trace.first < statusAt, 'the button is already present before the refreshed status arrives');
          assert.equal(trace.positions.length, 1, JSON.stringify(trace));
          assert.equal(typeof trace.positions[0], 'number');
          assert.deepEqual(p.problems, []);
        } finally { await p.close(); }
      });
    }

    it('keeps the camera, decoded pictures and toolbar slots on immediate reload and drag', async () => {
      const p = await browser.load(shellUrl, { ready });
      try {
        assert.ok(await p.waitFor(savedBoardCopy));
        await p.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(${observeRefresh})()` });
        const listUrl = new URL([...p.urls].find(url => new URL(url).pathname.endsWith('/_api/db/list')));
        const delayRoute = (urlPattern, latency) => ({ urlPattern, latency, downloadThroughput: -1, uploadThroughput: -1 });
        const listDelay = delayRoute(listUrl.origin + listUrl.pathname, 550);
        await p.cdp('Network.emulateNetworkConditionsByRule', { offline: false, matchedNetworkConditions: [listDelay] });
        for (const zoom of [50, 34]) {
          await p.evaluateAll(`(() => {
            const layer = document.querySelector('.wb-layer');
            if (!layer) return;
            let changed;
            window.zoomApplied = new Promise(resolve => {
              const observer = new MutationObserver(() => {
                if (Math.round(new DOMMatrixReadOnly(getComputedStyle(layer).transform).a * 100) !== ${zoom}) return;
                changed = performance.now();
                observer.disconnect();
                resolve(true);
              });
              observer.observe(layer, { attributes: true, attributeFilter: ['style'] });
            });
            addEventListener('pagehide', () => sessionStorage.setItem('zoom-to-reload', performance.now() - changed), { once: true });
          })()`);
          if (zoom === 50) {
            await p.evaluateAll("document.querySelector('button[aria-label^=Zoom]')?.click()");
            const option = "[...document.querySelectorAll('[role^=menuitem]')].find(el => el.textContent.trim() === '50%')";
            assert.ok(await p.waitFor(option));
            await p.evaluateAll(option + '?.click()');
          } else {
            // A real attachment holds iframe.onload past the editor's initial reports.
            const image = new URL('/_blob/' + pictureId + '?load-order', listUrl).href;
            await p.cdp('Network.emulateNetworkConditionsByRule', { offline: false, matchedNetworkConditions: [
              listDelay, delayRoute(image, 1100),
            ] });
            await p.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `if (window !== top) {
              document.addEventListener('DOMContentLoaded', () => {
                const image = new Image(); image.hidden = true; image.src = ${JSON.stringify(image)}; document.body.append(image);
              }, { once: true });
            }` });
            for (const deltaY of [20, -100 * Math.log(0.34 / 0.5) - 20]) {
              await p.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 400, deltaX: 0, deltaY, modifiers: 2 });
            }
          }
          assert.ok((await p.evaluateAll('window.zoomApplied')).includes(true));
          await p.cdp('Page.reload');
          assert.ok(await p.waitFor(`window.refreshTrace?.firstFrame && Math.round(window.refreshTrace.firstFrame.zoom * 100) === ${zoom}`, 10000));
          assert.ok(await p.waitFor("window.refreshTrace?.reports.includes('saved')"));
          assert.ok(await p.waitFor("window.refreshTrace?.frameLoaded"));
          const { board, shell } = await refreshTrace(p);
          assert.deepEqual(shell.readiness, [false, true]);
          const [elapsed] = (await p.evaluateAll("sessionStorage.getItem('zoom-to-reload')")).filter(Boolean);
          assert.ok(elapsed != null && Number(elapsed) >= 0 && Number(elapsed) < 250, `reload after ${elapsed} ms`);
          assert.ok(board.images > 0);
          assert.equal(board.decoded, board.images);
          assert.ok(board.text > 0);
          assert.equal(board.laidOutText, board.text);
          assert.ok(shell.states.includes('loading') && shell.states.includes('syncing'), JSON.stringify(shell.states));
          if (zoom === 34) {
            assert.ok(shell.beforeLoad.includes('loading') && shell.beforeLoad.includes('saved'), JSON.stringify(shell.beforeLoad));
          }
          const [first] = shell.slots;
          assert.deepEqual(first.slice(2), [true, true, true]);
          assert.deepEqual(shell.slots.at(-1).slice(2), [false, false, false]);
          assert.ok(shell.slots.every(slot => slot[0] === first[0] && slot[1] === first[1]), JSON.stringify(shell.slots));
          assert.deepEqual(shell.slots.map(slot => slot.slice(2)), [[true, true, true], [false, false, false]]);
          assert.equal(shell.reports.slice(shell.reports.indexOf('syncing')).includes('loading'), false);
        }
        const [point] = (await p.evaluateAll(`(() => {
          const r = document.querySelector('#wb-resizeCard')?.getBoundingClientRect();
          return r && [r.x + r.width / 2, r.y + r.height / 2];
        })()`)).filter(Boolean);
        const frame = await p.evaluate("document.querySelector('iframe').getBoundingClientRect().toJSON()");
        const [x, y] = [frame.x + point[0], frame.y + point[1]];
        const file = path.join(shellRoot, 'db/elements/resizeCard.json');
        const initial = JSON.parse(fs.readFileSync(file)).x;
        await p.dragMouse([x, y], [x + 74, y + 32]);
        assert.ok(await until(() => JSON.parse(fs.readFileSync(file)).x !== initial));
        const { reports, states } = await p.evaluate('window.refreshTrace');
        assert.ok(!reports.includes('unsaved') && !states.includes('unsaved'));
        // A real, slower write should show Saving… and then clear.
        const writeUrl = new URL('write', listUrl);
        await p.cdp('Network.emulateNetworkConditionsByRule', { offline: false, matchedNetworkConditions: [delayRoute(writeUrl.href, 1150)] });
        await p.dragMouse([x + 74, y + 32], [x + 105, y + 56]);
        assert.ok(await p.waitFor("document.querySelector('[data-shell-save-state=saving]')"));
        assert.ok(await p.waitFor("window.refreshTrace?.reports.at(-1) === 'saved' && !document.querySelector('[data-shell-save-state]')"));
        assert.ok(!(await p.evaluate('window.refreshTrace.reports')).includes('unsaved'));
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });
  });

  // 2026-11-20: a board opened while its pane was still narrow kept that zoom once the pane widened, most of it off screen.
  it('fits the board again when the view widens before anyone uses the page, and not after', { skip: noBrowser }, async () => {
    const p = await browser.load('about:blank', { ready: 'true' });
    try {
      await p.cdp('Emulation.setDeviceMetricsOverride', { width: 420, height: 320, deviceScaleFactor: 1, mobile: false });
      await p.cdp('Page.navigate', { url: url + '?open_artifact_bench=1' });
      const zoom = 'window.__openArtifactWhiteboard?.state().camera.zoom';
      assert.ok(await p.waitFor(`${zoom} > 0 && ${zoom} < 0.9`, 10000), 'fitted to the narrow view');
      const narrow = await p.evaluate(zoom);
      await p.cdp('Emulation.clearDeviceMetricsOverride');
      assert.ok(await p.waitFor(`${zoom} > ${narrow} + 0.05`, 5000), `fitted again to the wide view, zoom ${await p.evaluate(zoom)}`);
      const wide = await p.evaluate(zoom);
      await p.press('Escape');
      await p.cdp('Emulation.setDeviceMetricsOverride', { width: 420, height: 320, deviceScaleFactor: 1, mobile: false });
      assert.ok(await p.waitFor('innerWidth === 420'));
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.equal(await p.evaluate(zoom), wide, 'the view is the viewer\'s once they used the page');
    } finally { await p.close(); }
  });

  it('recovers after an interrupted load and restores pictures on request', { skip: noBrowser }, async () => {
    const p = await browser.load(url, { ready });
    try {
      // Seed the marker only after the previous healthy load has released ownership. That takes 5 s of frames with no
      // gap over 2 s, and a frame stall on a busy machine (another suite running) starts the count again.
      assert.ok(await p.waitFor("!localStorage.getItem('wb-load:' + location.pathname)", 30000));
      await p.evaluate("localStorage.setItem('wb-load:' + location.pathname, '1')");
      await p.cdp('Page.reload', {});
      assert.ok(await p.waitFor("document.querySelector('#wb-picture.wb-paused-media')"));
      assert.equal(await p.evaluate("document.querySelector('#wb-picture img')"), null);
      await p.evaluate("window.recoveredInPlace = true; document.querySelector('.wb-recovery button').click()");
      assert.ok(await p.waitFor("document.querySelector('#wb-picture img')?.naturalWidth === 2"));
      assert.equal(await p.evaluate("Boolean(document.querySelector('.wb-recovery'))"), false);
      assert.equal(await p.evaluate('window.recoveredInPlace'), true);
    } finally { await p.close(); }
  });

  it('resumes media after a renderer crash without covering the revealed board again', { skip: noBrowser }, async () => {
    const recoveryRoot = tmpDir('whiteboard-recovery');
    fs.cpSync(root, recoveryRoot, { recursive: true });
    const { url: recoveryUrl } = await run.json(['open', recoveryRoot, '--type', 'whiteboard', '--json']);
    const marker = "localStorage.getItem('wb-load:' + location.pathname)";
    let interrupted, recovered;
    try {
      interrupted = await browser.load(recoveryUrl, { ready, settle: 0 });
      await interrupted.cdp('Page.bringToFront');
      assert.equal(await interrupted.evaluate(marker), '1');
      assert.ok(await interrupted.waitFor('!' + marker, 30000), 'a healthy visible load releases its marker');
      await interrupted.cdp('Page.reload');
      assert.ok(await interrupted.waitFor(marker));
      await assert.rejects(interrupted.cdp('Page.crash'), /the tab went away|target crashed/i);
      recovered = await browser.load(recoveryUrl, { ready });
      assert.ok(await recovered.waitFor("document.querySelector('#wb-picture.wb-paused-media') && !document.querySelector('[data-wb-veil]')"));
      assert.equal(await recovered.evaluate("document.querySelector('#wb-picture img')"), null);
      await recovered.evaluate(`(() => {
        window.recoveryCovers = 0;
        new MutationObserver(records => {
          for (const record of records) for (const node of record.addedNodes) {
            if (node.matches?.('[data-wb-veil]') || node.querySelector?.('[data-wb-veil]')) window.recoveryCovers++;
          }
        }).observe(document.body, { childList: true, subtree: true });
        document.querySelector('.wb-recovery button').click();
      })()`);
      assert.ok(await recovered.waitFor("document.querySelector('#wb-picture img')?.naturalWidth === 2"));
      assert.equal(await recovered.evaluate("Boolean(document.querySelector('.wb-recovery'))"), false);
      assert.equal(await recovered.evaluate('window.recoveryCovers'), 0);
      assert.deepEqual(recovered.problems, []);
    } finally {
      await recovered?.close();
      await interrupted?.close();
    }
  });
  it('pastes a local artifact link as a card and syncs undo and redo to another tab', { skip: noBrowser }, async () => {
    const writer = await browser.load(url, { ready });
    const reader = await browser.load(url, { ready });
    try {
      const count = "document.querySelectorAll('[data-wb-type=link]').length";
      const before = await reader.evaluate(count);
      const transfer = `const d = new DataTransfer(); d.setData('text/plain', ${JSON.stringify(localArtifactHref)});`;
      await writer.evaluate(`(() => { ${transfer} document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: d })); })()`);
      assert.ok(await reader.waitFor(`${count} === ${before + 1}`, 5000));
      const mod = process.platform === 'darwin' ? { meta: true } : { ctrl: true };
      await writer.press('z', mod);
      assert.ok(await reader.waitFor(`${count} === ${before}`, 5000));
      await writer.press('z', { ...mod, shift: true });
      assert.ok(await reader.waitFor(`${count} === ${before + 1}`, 5000));
    } finally { await writer.close(); await reader.close(); }
  });

  it('shares a running and paused timer across two tabs', { skip: noBrowser }, async () => {
    const first = await browser.load(url, { ready });
    const second = await browser.load(url, { ready });
    try {
      await first.evaluate("document.querySelector('[data-wb-timer] button').click()");
      assert.ok(await first.waitFor("document.querySelector('button[aria-label=Start]')"));
      await first.evaluate("document.querySelector('button[aria-label=Start]').click()");
      assert.ok(await second.waitFor("document.querySelector('[data-wb-clock=running]')"));
      await second.evaluate("document.querySelector('[data-wb-clock=running]').click()");
      assert.ok(await second.waitFor("document.querySelector('button[aria-label=Pause]')"));
      await second.evaluate("document.querySelector('button[aria-label=Pause]').click()");
      assert.ok(await first.waitFor("document.querySelector('[data-wb-clock=held]')"));
    } finally { await first.close(); await second.close(); }
  });

  it('places a section from the Shapes tray using touch', { skip: noBrowser }, async () => {
    const p = await browser.load(url, { ready });
    const tap = async (x, y) => {
      await p.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await p.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const button = async label => {
      const selector = `button[aria-label="${label}"]`;
      assert.ok(await p.waitFor(`document.querySelector('${selector}')`, 3000));
      assert.ok(await p.waitFor(`(() => {const b=document.querySelector('${selector}'); const r=b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`, 3000));
      const point = await p.evaluate(`(() => {const r = document.querySelector('${selector}').getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2];})()`);
      await tap(...point);
    };
    try {
      await p.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 2, mobile: true });
      await p.cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      assert.ok(await p.waitFor("matchMedia('(pointer: coarse) and (max-width:599px)').matches"));
      await p.cdp('Page.reload', {});
      assert.ok(await p.waitFor(ready));
      await button('Shapes');
      await button('Section');
      await tap(112, 225);
      const sections = () => fs.readdirSync(path.join(root, 'db/elements')).filter(n =>
        JSON.parse(fs.readFileSync(path.join(root, 'db/elements', n))).type === 'container');
      assert.ok(await until(() => sections().length > 0));
      assert.deepEqual(p.problems, []);
    } finally { await p.close(); }
  });

  it('tints table cells by heat map and fill, removes a column heat map from the menu and sets a cell color', { skip: noBrowser }, async () => {
    const board = tmpDir('whiteboard-tints');
    const table = { type: 'table', x: 0, y: 0, head: true, color: 'white', cols: { c1: { at: 1 }, c2: { at: 2 } },
      rows: { r1: { at: 1, c1: 'Item', c2: 'Cost' }, r2: { at: 2, c1: 'A', c2: '$10' }, r3: { at: 3, c1: 'B', c2: '$30' } }, heat: { cols: { c2: 'blue' } } };
    const file = path.join(board, 'db/elements/tints.json');
    for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(board, sub), { recursive: true });
    fs.writeFileSync(path.join(board, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Costs', order: ['tints'] }));
    fs.writeFileSync(file, JSON.stringify(table));
    const saved = () => JSON.parse(fs.readFileSync(file));
    const at = selector => `document.querySelector('${selector}')`;
    const cellAt = (row, col) => `[data-wb-row="${row}"][data-wb-col="${col}"]`;
    const center = selector => `(() => { const r = ${at(selector)}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;
    const { url: boardUrl } = await run.json(['open', board, '--type', 'whiteboard', '--json']);
    const p = await browser.load(boardUrl, { ready });
    try {
      assert.ok(await p.waitFor(`${at(cellAt('r3', 'c2'))}?.dataset.wbTint`), 'the heat-mapped column is tinted');
      assert.ok(await p.evaluate(`${at(cellAt('r2', 'c2'))}.dataset.wbTint !== ${at(cellAt('r3', 'c2'))}.dataset.wbTint`), 'by value');
      assert.equal(await p.evaluate(`${at(cellAt('r1', 'c2'))}.hasAttribute('data-wb-tint')`), false, 'the header row is not shaded');

      fs.writeFileSync(file, JSON.stringify({ ...table, fills: { r2: { c1: 'pink' } } }));
      assert.ok(await p.waitFor(`${at(cellAt('r2', 'c1'))}?.dataset.wbTint`, 5000), 'a fill the agent writes shows at once');

      await p.rightClick(...await p.evaluate(center(cellAt('r3', 'c2'))));
      const menuItem = label => `[...document.querySelectorAll('[role=menuitem], [role=menuitemcheckbox]')].find(e => e.textContent.trim() === '${label}')`;
      assert.ok(await p.waitFor(menuItem('Remove column heat map'), 3000));
      assert.equal(await p.evaluate(`Boolean(${menuItem('Heat map this row')})`), true);
      await p.evaluate(`${menuItem('Remove column heat map')}.click()`);
      assert.ok(await until(() => saved().heat?.cols?.c2 === undefined), 'the column heat map is gone from the file');
      assert.ok(await p.waitFor(`!${at(cellAt('r3', 'c2'))}.hasAttribute('data-wb-tint')`));

      await p.clickTimes(...await p.evaluate(center(cellAt('r2', 'c1'))), 2);
      assert.ok(await p.waitFor(at(`${cellAt('r2', 'c1')} [contenteditable=true]`), 3000));
      assert.ok(await p.waitFor(at('button[aria-label="Cell color"]'), 3000));
      await p.evaluate(`${at('button[aria-label="Cell color"]')}.click()`);
      const green = '[role=radiogroup][aria-label="Cell color"] [aria-label="Green"]';
      assert.ok(await p.waitFor(at(green), 3000));
      await p.evaluate(`${at(green)}.click()`);
      assert.ok(await until(() => saved().fills?.r2?.c1 === 'green'), 'the picked cell color is saved');
      assert.deepEqual(p.problems, []);
    } finally { await p.close(); await run.run(['stop', board]); }
  });

  it('shows a text\'s placeholder, edits it on one click and saves what is typed', { skip: noBrowser }, async () => {
    const board = tmpDir('whiteboard-hint');
    const file = path.join(board, 'db/elements/hint.json');
    for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(board, sub), { recursive: true });
    fs.writeFileSync(path.join(board, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Ideas', order: ['hint'] }));
    fs.writeFileSync(file, JSON.stringify({ type: 'text', x: 0, y: 0, text: '', placeholder: 'First idea' }));
    const hint = '[data-wb-id="hint"]';
    const { url: boardUrl } = await run.json(['open', board, '--type', 'whiteboard', '--json']);
    const p = await browser.load(boardUrl, { ready });
    try {
      assert.ok(await p.waitFor(`document.querySelector('${hint} .wb-text-hint')?.textContent === 'First idea'`, 5000), 'the hint shows');
      const at = await p.evaluate(`(() => { const r = document.querySelector('${hint}').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      await p.click(...at);
      assert.ok(await p.waitFor(`document.activeElement?.isContentEditable && document.querySelector('${hint}')?.contains(document.activeElement)`, 3000), 'one click starts typing');
      await p.type('Launch plan');
      await p.press('Escape');
      assert.ok(await until(() => JSON.parse(fs.readFileSync(file)).text === 'Launch plan'), 'the typed text is saved');
      assert.deepEqual(p.problems, []);
    } finally { await p.close(); await run.run(['stop', board]); }
  });

  it('shows a link\'s card on hover, copies it, opens it after a click and not on a double click', { skip: noBrowser }, async () => {
    const board = tmpDir('whiteboard-links');
    for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(board, sub), { recursive: true });
    fs.writeFileSync(path.join(board, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Links', order: ['words'] }));
    fs.writeFileSync(path.join(board, 'db/elements/words.json'), JSON.stringify({ type: 'text', x: 0, y: 200, w: 320, text: 'Read [the guide](https://example.org/docs/guide) first' }));
    const centre = sel => `(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;
    const linkCard = '[data-wb-link-card]';
    const { url: boardUrl } = await run.json(['open', board, '--type', 'whiteboard', '--json']);
    const p = await browser.load(boardUrl, { ready });
    try {
      await p.cdp('Browser.grantPermissions', { origin: new URL(boardUrl).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
      await p.evaluate('window.opened = []; window.open = (href) => { window.opened.push(href); return null; }; 1');
      assert.ok(await p.waitFor("document.querySelector('[data-wb-id=words] a[data-wb-link]')", 5000));
      const link = await p.evaluate(centre('[data-wb-id=words] a[data-wb-link]'));
      await p.hover(link[0] - 4, link[1]);
      await p.hover(...link);
      assert.ok(await p.waitFor(`document.querySelector('${linkCard}')?.innerText.includes('example.org')`, 3000), 'the card shows the domain');
      await p.hover(...await p.evaluate(centre(`${linkCard} button[aria-label="Copy link"]`)));
      await p.click(...await p.evaluate(centre(`${linkCard} button[aria-label="Copy link"]`)));
      assert.ok(await p.waitFor(`document.querySelector('${linkCard} button[aria-label="Link copied"]')`, 2000), 'the button says the link was copied');
      assert.equal(await p.evaluate('navigator.clipboard.readText()'), 'https://example.org/docs/guide');

      await p.click(...link);
      assert.deepEqual(await p.evaluate('window.opened'), [], 'a plain click waits');
      assert.ok(await p.waitFor('window.opened.length === 1', 2000), 'a plain click opens after the delay');
      assert.equal(await p.evaluate('window.opened[0]'), 'https://example.org/docs/guide');

      await p.evaluate('window.opened = []; 1');
      await new Promise(resolve => setTimeout(resolve, 800));
      await p.clickTimes(...link, 2);
      assert.ok(await p.waitFor("!!document.querySelector('[data-wb-id=words] [contenteditable=true]')", 3000), 'a double click starts typing');
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.deepEqual(await p.evaluate('window.opened'), [], 'a double click does not open the link');
      assert.deepEqual(p.problems, []);
    } finally { await p.close(); await run.run(['stop', board]); }
  });

  it('adds a shape and no arrow from a shape\'s side dot, and gives a text no side dots', { skip: noBrowser }, async () => {
    const board = tmpDir('whiteboard-dots');
    const dir = path.join(board, 'db/elements');
    for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(board, sub), { recursive: true });
    const items = {
      step: { type: 'shape', kind: 'rect', x: 0, y: 0, w: 160, h: 100, color: 'blue', text: 'Step' },
      label: { type: 'text', x: 0, y: 260, w: 200, text: 'A caption' },
    };
    fs.writeFileSync(path.join(board, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Dots', order: Object.keys(items) }));
    for (const [id, el] of Object.entries(items)) fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(el));
    const saved = () => fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => ({ id: n.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(dir, n))) }));
    const centre = sel => `(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;
    const { url: boardUrl } = await run.json(['open', board, '--type', 'whiteboard', '--json']);
    const p = await browser.load(boardUrl, { ready });
    try {
      assert.ok(await p.waitFor("document.querySelector('[data-wb-id=label]') && document.querySelector('[data-wb-id=step]')", 5000));
      await p.click(...await p.evaluate(centre('[data-wb-id=label]')));
      assert.ok(await p.waitFor("document.querySelector('.wb-sel-frame')", 3000));
      await p.press('Escape');
      await p.hover(...await p.evaluate(centre('[data-wb-id=label]')));
      assert.equal(await p.evaluate("document.querySelectorAll('.wb-side-dot').length"), 0, 'a text has no side dots');
      await p.click(...await p.evaluate(centre('[data-wb-id=step]')));
      const dot = '.wb-sel .wb-side-dot[data-side=right]';
      assert.ok(await p.waitFor(`document.querySelector('${dot}')`, 3000), 'a selected shape has side dots');
      assert.equal(await p.evaluate(`document.querySelector('${dot}').title`), 'Click to add a shape\nDrag to connect');
      await p.click(...await p.evaluate(centre(dot)));
      assert.ok(await until(() => saved().length === 3), 'one item is added');
      const added = saved().find(el => !(el.id in items));
      assert.equal(added.type, 'shape');
      assert.equal(added.kind, 'rect');
      assert.ok(added.x > 160, 'the new shape sits to the right');
      assert.equal(added.by, undefined);
      assert.ok(saved().every(el => el.type !== 'arrow'), 'no arrow joins them');
      assert.deepEqual(p.problems, []);
    } finally { await p.close(); await run.run(['stop', board]); }
  });

  it('drops the rest of a double click on a menu row and keeps a typed-into panel open on a press outside', { skip: noBrowser }, async () => {
    const board = tmpDir('whiteboard-follow-up');
    const dir = path.join(board, 'db/elements');
    for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(board, sub), { recursive: true });
    fs.writeFileSync(path.join(board, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Menus', order: ['only'] }));
    fs.writeFileSync(path.join(dir, 'only.json'), JSON.stringify({ type: 'shape', kind: 'rect', x: 0, y: 0, w: 120, h: 80, color: 'blue', text: 'Only' }));
    const count = () => fs.readdirSync(dir).filter(n => n.endsWith('.json')).length;
    const centre = sel => `(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;
    const menuItem = label => `[...document.querySelectorAll('[role=menuitem]')].find(e => e.textContent.includes('${label}'))`;
    const { url: boardUrl } = await run.json(['open', board, '--type', 'whiteboard', '--json']);
    const p = await browser.load(boardUrl, { ready });
    try {
      assert.ok(await p.waitFor("document.querySelector('[data-wb-id=only]')", 5000));
      const spot = await p.evaluate("(() => { const r = document.querySelector('[data-wb-id=only]').getBoundingClientRect(); return [Math.round(r.right + 200), Math.round(r.bottom + 120)]; })()");
      await p.rightClick(...spot);
      assert.ok(await p.waitFor(menuItem('Select all'), 3000), 'the board menu opens');
      const row = await p.evaluate(`(() => { const r = ${menuItem('Select all')}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      await p.clickTimes(...row, 2);
      assert.ok(await p.waitFor("!document.querySelector('[role=menu]')", 3000), 'the first click runs the row and closes the menu');
      await new Promise(resolve => setTimeout(resolve, 600));
      assert.equal(count(), 1, 'the second click adds no text to the board beneath');

      await p.evaluate("document.querySelector('[data-wb-timer] button').click()");
      assert.ok(await p.waitFor("document.querySelector('input[aria-label=Minutes]')", 3000));
      await p.click(...await p.evaluate(centre('input[aria-label=Minutes]')));
      await p.type('7');
      await p.click(...spot);
      await new Promise(resolve => setTimeout(resolve, 300));
      assert.ok(await p.evaluate("Boolean(document.querySelector('.wb-timer-panel'))"), 'a panel typed into stays open');
      await p.press('Escape');
      assert.ok(await p.waitFor("!document.querySelector('.wb-timer-panel')", 3000), 'Escape still closes it');
      assert.deepEqual(p.problems, []);
    } finally { await p.close(); await run.run(['stop', board]); }
  });

  it('moves between the page\'s regions with F6 and cancels a crop with Command-Z', { skip: noBrowser }, async () => {
    const board = tmpDir('whiteboard-keys');
    const dir = path.join(board, 'db/elements');
    for (const sub of ['db/elements', 'db/board', '_blobs']) fs.mkdirSync(path.join(board, sub), { recursive: true });
    fs.writeFileSync(path.join(board, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Keys', order: ['pic'] }));
    fs.writeFileSync(path.join(dir, 'pic.json'), JSON.stringify({ type: 'image', x: 0, y: 0, w: 240, h: 200, src: '_blob/' + pictureId }));
    fs.writeFileSync(path.join(board, '_blobs', pictureId), bytes);
    fs.writeFileSync(path.join(board, '_blobs', pictureId + '.json'), JSON.stringify({ name: 'diagram.png', contentType: 'image/png', bytes: bytes.length }));
    const saved = () => JSON.parse(fs.readFileSync(path.join(dir, 'pic.json')));
    const centre = sel => `(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;
    const region = "document.activeElement?.closest('[data-wb-region]')?.dataset.wbRegion";
    const { url: boardUrl } = await run.json(['open', board, '--type', 'whiteboard', '--json']);
    const p = await browser.load(boardUrl, { ready });
    const f6 = async (shift = false) => {
      for (const type of ['rawKeyDown', 'keyUp']) await p.cdp('Input.dispatchKeyEvent', { type, key: 'F6', code: 'F6', windowsVirtualKeyCode: 117, modifiers: shift ? 8 : 0 });
    };
    try {
      assert.ok(await p.waitFor("document.querySelector('#wb-pic img')?.naturalWidth === 2", 5000));
      await p.evaluate("document.querySelector('.wb-surface').focus(); 1");
      assert.equal(await p.evaluate(region), 'canvas');
      const steps = [];
      for (let step = 0; step < 3 && steps.at(-1) !== 'zoom'; step++) {
        await f6();
        steps.push(await p.evaluate(region));
      }
      assert.equal(steps.at(-1), 'zoom', `F6 from the board reaches the zoom bar (went ${steps.join(' → ')})`);
      await f6(true);
      assert.equal(await p.evaluate(region), steps.length > 1 ? steps.at(-2) : 'canvas', 'Shift-F6 goes back');
      await p.evaluate("document.querySelector('.wb-surface').focus(); 1");
      await f6(true);
      assert.equal(await p.evaluate(region), 'toolbar', 'Shift-F6 from the board reaches the toolbar');

      await p.clickTimes(...await p.evaluate(centre('#wb-pic')), 2);
      assert.ok(await p.waitFor("document.querySelector('.wb-crop-handle[data-handle=e]')", 3000), 'a double click crops the picture');
      const [x, y] = await p.evaluate(centre('.wb-crop-handle[data-handle=e]'));
      await p.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await p.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      for (const dx of [-20, -40, -60]) await p.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx, y, button: 'left', buttons: 1 });
      await p.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x - 60, y, button: 'left', buttons: 0, clickCount: 1 });
      assert.ok(await until(() => saved().crop !== undefined), 'the crop is saved as it is dragged');
      await p.press('z', process.platform === 'darwin' ? { meta: true } : { ctrl: true });
      assert.ok(await p.waitFor("!document.querySelector('.wb-crop')", 3000), 'Command-Z leaves crop mode');
      assert.ok(await until(() => saved().crop === undefined), 'the picture gets back its crop from before');
      assert.ok(await p.waitFor("document.querySelector('.wb-announcer')?.textContent === 'Cropping cancelled.'", 2000));
      assert.deepEqual(p.problems, []);
    } finally { await p.close(); await run.run(['stop', board]); }
  });

  it('shows a viewer a Read-only badge beside the zoom', { skip: noBrowser }, async () => {
    const { createTypeServer } = await import('../packages/type-server/src/index.ts');
    const server = createTypeServer({
      secret: 'whiteboard-viewer', idleMs: 0, assetsDir: path.join(typePath('whiteboard'), 'scripts'),
      lanAddresses: () => [], isLocal: req => !req.headers['x-test-guest'],
    });
    const board = tmpDir('whiteboard-viewer');
    for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(board, sub), { recursive: true });
    fs.writeFileSync(path.join(board, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Shared', order: ['note1'] }));
    fs.writeFileSync(path.join(board, 'db/elements/note1.json'), JSON.stringify({ type: 'note', x: 0, y: 0, text: 'Hello' }));
    let guest;
    try {
      await server.listen();
      const { id, url: ownerUrl } = await server.open({ root: board, type: 'whiteboard', title: 'Shared' });
      const share = new URL('/__open-artifact/share', ownerUrl);
      const headers = { 'content-type': 'application/json', authorization: 'Bearer whiteboard-viewer' };
      const view = await (await fetch(share, { method: 'POST', headers, body: JSON.stringify({ id, lan: true }) })).json();
      const link = new URL(new URL(view.links.viewer.url).pathname, ownerUrl);
      guest = await browser.load('about:blank');
      await guest.cdp('Network.setExtraHTTPHeaders', { headers: { 'x-test-guest': '1' } });
      await guest.cdp('Page.navigate', { url: link.href });
      assert.ok(await guest.waitFor("document.querySelector('input[name=name]')"));
      await guest.evaluate("document.querySelector('[name=name]').value = 'Guest'; document.querySelector('form').requestSubmit()");
      const badge = "document.querySelector('[data-wb-read-only][role=status]')";
      assert.ok(await guest.waitFor(`${badge}?.textContent === 'Read-only'`, 15000), 'the viewer sees the badge');
      assert.ok(await guest.waitFor(`${badge}?.querySelector('svg') && ${badge}.getAttribute('aria-label').includes('not change it')`), 'with a lock and the reason');
      assert.ok(await guest.waitFor(`${badge}?.closest('.wb-corner-zoom, .wb-pill')?.querySelector('button[aria-label^=Zoom]')`), 'beside the zoom');
      assert.deepEqual(guest.problems, []);
    } finally { await guest?.close(); await server.stop(); }
  });

  it('paints a watercolor drawing and draws a draft one unlike a plain one', { skip: noBrowser }, async () => {
    const board = tmpDir('whiteboard-looks');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" fill="none" stroke="currentColor" stroke-width="3">'
      + '<rect x="20" y="20" width="90" height="70" rx="8" fill="#60a5fa"/><circle cx="150" cy="60" r="30" fill="#f59e0b"/><path d="M20 105H180"/></svg>';
    const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    const elements = {
      wash: { type: 'image', x: 0, y: 0, w: 300, h: 180, src, style: 'watercolor' },
      small: { type: 'image', x: 0, y: 205, w: 90, h: 54, src, style: 'watercolor' },
      medium: { type: 'image', x: 130, y: 205, w: 150, h: 90, src, style: 'watercolor' },
      sketch: { type: 'image', x: 340, y: 0, w: 300, h: 180, src, style: 'draft' },
      clean: { type: 'image', x: 680, y: 0, w: 300, h: 180, src, style: 'plain' },
    };
    for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(board, sub), { recursive: true });
    fs.writeFileSync(path.join(board, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Looks', order: Object.keys(elements) }));
    for (const [id, el] of Object.entries(elements)) fs.writeFileSync(path.join(board, 'db/elements', id + '.json'), JSON.stringify(el));
    const { url: boardUrl } = await run.json(['open', board, '--type', 'whiteboard', '--json']);
    const p = await browser.load(boardUrl, { ready });
    const img = id => `document.querySelector('#wb-${id} img')`;
    try {
      assert.ok(await p.waitFor(`${img('wash')}?.src.startsWith('blob:') && ${img('wash')}.naturalWidth > 0`, 15000), 'the watercolor look is painted');
      assert.ok(await p.waitFor(`${img('sketch')}?.complete && ${img('clean')}?.complete`, 5000));
      assert.ok(await p.evaluate(`${img('sketch')}.src.startsWith('data:image/svg+xml') && ${img('sketch')}.src !== ${img('clean')}.src`), 'draft and plain differ');
      await p.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(${observeRefresh})()` });
      await p.cdp('Page.reload');
      assert.ok(await p.waitFor('window.refreshTrace?.firstFrame'));
      const frame = await p.evaluate('window.refreshTrace.firstFrame');
      assert.equal(frame.paintedLooks, 3);
      assert.equal(frame.decoded, frame.images);
      const idleChanges = await p.evaluate(`(async () => {
        let changes = 0;
        const observer = new MutationObserver(records => { changes += records.length; });
        for (const id of ['wash', 'medium', 'small']) observer.observe(document.querySelector('#wb-' + id + ' img'),
          { attributes: true, attributeFilter: ['src'] });
        await new Promise(resolve => setTimeout(resolve, 800));
        observer.disconnect(); return changes;
      })()`);
      assert.equal(idleChanges, 0);
      const point = await p.evaluate(`(() => {
        const image = ${img('wash')};
        window.lookSources = [image.src];
        new MutationObserver(records => {
          for (const rec of records) lookSources.push(rec.oldValue);
          lookSources.push(image.src);
        }).observe(image, { attributes: true, attributeFilter: ['src'], attributeOldValue: true });
        const r = image.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      for (let i = 0; i < 4; i++) {
        await p.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: -20, modifiers: 2 });
      }
      assert.ok(await p.waitFor("new Set(window.lookSources).size > 1"));
      assert.ok(await p.evaluate("window.lookSources.every(src => src.startsWith('blob:'))"));
      await p.evaluate('window.lookSources.length = 0');
      await remoteWrite(boardUrl, [{ op: 'update', path: 'elements/wash', patch: { w: 140, h: 280 } }]);
      assert.ok(await p.waitFor("window.lookSources.some(src => src.startsWith('data:image/svg+xml')) && window.lookSources.at(-1)?.startsWith('blob:')"));
      assert.deepEqual(p.problems, []);
    } finally { await p.close(); await run.run(['stop', board]); }
  });

  // Opt in with the published reference CLI path. The normal suite has no dependency on another checkout.
  const reference = process.env.E2E_WHITEBOARD_REFERENCE;
  it('exchanges an editable shape in both directions with the reference editor', { skip: noBrowser || !reference }, async () => {
    const referenceRoot = tmpDir('whiteboard-reference-board');
    fs.cpSync(path.join(root, 'db'), path.join(referenceRoot, 'db'), { recursive: true });
    fs.cpSync(path.join(root, '_blobs'), path.join(referenceRoot, '_blobs'), { recursive: true });
    const env = { ...process.env, HOME: tmpDir('whiteboard-reference-home') };
    const refCli = args => runCli(reference, args, { env, cwd: referenceRoot });
    const opened = await refCli(['open', referenceRoot]);
    assert.equal(opened.code, 0, opened.stderr);
    let original, current;
    const exchange = async (from, to, destination) => {
      const label = "[...document.querySelectorAll('.wb-shape')].find(e => e.textContent.includes('Store'))";
      assert.ok(await from.waitFor(label));
      const point = await from.evaluate(`(() => {const r = (${label}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];})()`);
      await from.click(...point);
      const html = await from.evaluate(`(() => {const d = new DataTransfer(); document.dispatchEvent(new ClipboardEvent('copy', {bubbles: true, clipboardData: d})); return d.getData('text/html');})()`);
      assert.match(html, /data-appifact-object=/);
      const stores = () => fs.readdirSync(destination).map(n => JSON.parse(fs.readFileSync(path.join(destination, n)))).filter(el => el.type === 'shape' && el.text === 'Store').length;
      const before = stores();
      await to.evaluate(`(() => {const d = new DataTransfer(); d.setData('text/html', ${JSON.stringify(html)}); document.dispatchEvent(new ClipboardEvent('paste', {bubbles: true, clipboardData: d}));})()`);
      assert.ok(await until(() => stores() === before + 1), 'the pasted shape reached the destination board');
    };
    try {
      original = await browser.load(opened.json.url, { ready });
      current = await browser.load(url, { ready });
      await exchange(original, current, path.join(root, 'db/elements'));
      await exchange(current, original, path.join(referenceRoot, 'db/elements'));
    } finally { await current?.close(); await original?.close(); await refCli(['stop', referenceRoot]); }
  });
});
