// Open a board authored in the original on-disk format through the installed type.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { cli, run as runCli } from './lib/cli.mjs';
import { checkFoldCard, clickOn } from './lib/editor.mjs';
import { png, until } from './lib/http.mjs';
import { browserOff, fixtures, install, removeTmp, skipFor, tmpDir, typePath } from './lib/target.mjs';

const noBrowser = browserOff || !findChrome();
const pictureId = '0123456789abcdef0123456789abcdef';
const videoId = 'fedcba9876543210fedcba9876543210';
const bytes = png([34, 204, 117]);
const cell = '[data-wb-row="r2"][data-wb-col="c2"]';
const ready = 'document.querySelector(\'[aria-label="Board tools"]\')';
const webCardHref = 'https://example.org/diagram';
const localArtifactHref = 'open-artifact://artifact/art_0123456789';

describe('whiteboard', { skip: skipFor('whiteboard') }, () => {
  let run, root, url, browser;

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

  it('refuses an Ask over 8000 UTF-8 bytes: the panel stays open with the draft and nothing is queued', { skip: noBrowser, timeout: 60000 }, async () => {
    const waiting = await run.start(['wait', root, '--timeout', '30'], { firstLine: false });
    const p = await browser.load(url, { ready });
    try {
      assert.ok(await until(() => fs.existsSync(path.join(root, '_agent', 'waiting')), 10000), 'wait wrote no heartbeat');
      await clickOn(p, `[...document.querySelectorAll('button')].find(b => /^Ask /.test(b.textContent.trim()))`, 'the Ask button');
      const field = `document.querySelector('textarea[aria-label^="Request for"]')`;
      assert.ok(await p.waitFor(`${field} && !${field}.disabled`, 15000), 'the Ask panel did not open for a waiting agent');
      await p.evaluate(`${field}.focus()`);
      // 2,667 CJK characters are 8,001 bytes, far under the 20,000 characters the panel took before.
      const wide = '蓝'.repeat(2667);
      await p.cdp('Input.insertText', { text: wide });
      await p.press('Enter');
      assert.ok(await p.waitFor("document.body.innerText.includes('That’s too long to send.')", 10000), 'the page does not say the Ask is too long');
      assert.equal(await p.evaluate(`${field}?.value`), wide, 'the panel stays open with the draft');
      const inbox = path.join(root, '_agent', 'inbox');
      assert.ok(!fs.existsSync(inbox) || fs.readdirSync(inbox).length === 0, 'nothing was queued');
      assert.deepEqual(p.problems, []);
    } finally {
      await p.close();
      waiting.child?.kill('SIGTERM');
      await waiting.exited;
    }
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

  it('makes an arrow flow from the Line menu, keeps it after a reload, and stills it with Dashed', { skip: noBrowser }, async () => {
    const flowRoot = tmpDir('whiteboard-flow');
    const elements = {
      s1: { type: 'shape', kind: 'rect', x: 0, y: 0, w: 120, h: 80, color: 'white', text: 'Queue' },
      s2: { type: 'shape', kind: 'rect', x: 420, y: 0, w: 120, h: 80, color: 'white', text: 'Worker' },
      a1: { type: 'arrow', from: 's1', to: 's2', head: 'end', dash: false, color: 'ink' },
      back: { type: 'arrow', from: [0, 220], to: [540, 220], head: 'end', heads: ['arrow', 'none'], dash: true, flow: true, color: 'ink' },
    };
    for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(flowRoot, sub), { recursive: true });
    fs.writeFileSync(path.join(flowRoot, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Flow', order: Object.keys(elements) }));
    for (const [id, el] of Object.entries(elements)) fs.writeFileSync(path.join(flowRoot, 'db/elements', id + '.json'), JSON.stringify(el));
    const { url: flowUrl } = await run.json(['open', flowRoot, '--type', 'whiteboard', '--json']);
    const p = await browser.load(flowUrl + '?open_artifact_bench=1', { ready });
    try {
      const line = id => `document.querySelector('#wb-${id} path.wb-arrow-flow')`;
      const animation = id => `(l => l && getComputedStyle(l).animationName)(${line(id)})`;
      assert.ok(await p.waitFor(`document.querySelector('#wb-a1 .wb-hit')`));
      assert.ok(await p.waitFor(`${line('back')}?.classList.contains('wb-arrow-flow-back')`), 'an arrow pointing back flows the other way');
      assert.equal(await p.evaluate(`${line('a1')}`), null);
      const middle = await p.evaluate(`(() => {
        const path = document.querySelector('#wb-a1 .wb-hit');
        const at = path.getPointAtLength(path.getTotalLength() / 2);
        const m = path.getScreenCTM();
        return [at.x * m.a + at.y * m.c + m.e, at.x * m.b + at.y * m.d + m.f];
      })()`);
      await p.click(...middle);
      assert.ok(await p.waitFor('window.__openArtifactWhiteboard.state().selection[0] === "a1"'), 'the arrow is selected');
      const pick = async style => {
        await clickOn(p, `document.querySelector('button[aria-label="Line"]')`, 'the Line button');
        const radio = `[...document.querySelectorAll('[role=radiogroup][aria-label="Line style"] [role=radio]')].find(b => b.textContent.trim() === ${JSON.stringify(style)})`;
        assert.ok(await p.waitFor(radio), `the Line menu offers ${style}`);
        await clickOn(p, radio, style);
        await p.press('Escape');
      };
      await pick('Flowing');
      const saved = () => JSON.parse(fs.readFileSync(path.join(flowRoot, 'db/elements/a1.json')));
      assert.ok(await until(() => saved().flow === true && saved().dash === true), 'Flowing saves dash and flow');
      assert.ok(await p.waitFor(`${animation('a1')} === 'wb-arrow-flow'`), 'the line runs its animation');
      assert.equal(await p.evaluate(`${line('a1')}.classList.contains('wb-arrow-flow-back')`), false);

      // "Animate lines" in the zoom menu stills them for this viewer only.
      await clickOn(p, `document.querySelector('button[aria-label^="Zoom"]')`, 'the zoom menu');
      const animate = "[...document.querySelectorAll('[role^=menuitem]')].find(e => e.textContent.includes('Animate lines'))";
      assert.ok(await p.waitFor(animate), 'the zoom menu offers Animate lines');
      await clickOn(p, animate, 'Animate lines');
      assert.ok(await p.waitFor(`${animation('a1')} === 'none' && ${animation('back')} === 'none'`), 'Animate lines off stills the lines');
      assert.equal(saved().flow, true, 'the board keeps its flowing arrow');
      await p.cdp('Page.reload', {});
      assert.ok(await p.waitFor(`${line('a1')} && ${animation('a1')} === 'none'`), 'the line still flows after a reload, held still by the viewer\'s choice');
      await clickOn(p, `document.querySelector('button[aria-label^="Zoom"]')`, 'the zoom menu');
      assert.ok(await p.waitFor(animate));
      await clickOn(p, animate, 'Animate lines');
      assert.ok(await p.waitFor(`${animation('a1')} === 'wb-arrow-flow'`), 'Animate lines on moves them again');
      await p.press('Escape');
      await p.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      assert.ok(await p.waitFor(`${animation('a1')} === 'none'`), 'reduced motion stills the lines');
      await p.cdp('Emulation.setEmulatedMedia', { features: [] });
      assert.ok(await p.waitFor(`${animation('a1')} === 'wb-arrow-flow'`));

      const again = await p.evaluate(`(() => {
        const path = document.querySelector('#wb-a1 .wb-hit');
        const at = path.getPointAtLength(path.getTotalLength() / 2);
        const m = path.getScreenCTM();
        return [at.x * m.a + at.y * m.c + m.e, at.x * m.b + at.y * m.d + m.f];
      })()`);
      await p.click(...again);
      assert.ok(await p.waitFor('window.__openArtifactWhiteboard.state().selection[0] === "a1"'));
      await pick('Dashed');
      assert.ok(await until(() => saved().dash === true && saved().flow === undefined), 'Dashed drops flow');
      assert.ok(await p.waitFor(`!${line('a1')} && document.querySelector('#wb-a1 path[stroke-dasharray]')`), 'a still dashed line');
      assert.deepEqual(p.problems, []);
    } finally { await p.close(); }
  });

  it('paints a flowing arrow in the PNG exactly like a still dashed one', { skip: noBrowser }, async () => {
    const p = await browser.load(url + '?open_artifact_bench=1', { ready });
    try {
      const board = flow => JSON.stringify([
        { type: 'shape', id: 's1', kind: 'rect', x: 0, y: 0, w: 120, h: 80, color: 'white', text: 'A' },
        { type: 'shape', id: 's2', kind: 'rect', x: 300, y: 120, w: 120, h: 80, color: 'white', text: 'B' },
        { type: 'arrow', id: 'a1', from: 's1', to: 's2', head: 'end', dash: true, ...(flow ? { flow: true } : {}), color: 'ink', label: 'next' },
      ]);
      const bench = 'window.__openArtifactWhiteboard';
      assert.ok(await p.waitFor(bench));
      await p.evaluate(`${bench}.show(${board(false)})`);
      const still = await p.evaluate(`${bench}.picture('png')`, { timeout: 30000 });
      assert.equal(await p.evaluate(`${bench}.picture('gif')`), null, 'no GIF without a flowing arrow');
      await p.evaluate(`${bench}.show(${board(true)})`);
      const flowing = await p.evaluate(`${bench}.picture('png')`, { timeout: 30000 });
      assert.ok(still && still.length > 1000);
      assert.equal(flowing, still, 'the PNG is the same file');
    } finally { await p.close(); }
  });

  describe('global frame shell', { skip: noBrowser }, () => {
    let daemon, shellUrl, downloads, shellRoot, previous;

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
      const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
      daemon = await startDaemon({ port: 0, idleMs: 0, quiet: true, browse: null, builtinTypesDir: path.dirname(typePath('whiteboard')) });
      shellRoot = tmpDir('whiteboard-shell-board');
      for (const folder of ['db', '_blobs']) fs.cpSync(path.join(root, folder), path.join(shellRoot, folder), { recursive: true });
      const board = daemon.store.create({ root: shellRoot, type: 'whiteboard', title: 'Editable diagram' });
      shellUrl = daemon.viewUrl(board.id);
    });
    after(async () => {
      try { await daemon?.close(); } finally {
        for (const [key, value] of Object.entries(previous ?? {})) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });

    it('opens the board at the element its address names, and follows a change of it', async () => {
      const linksRoot = tmpDir('whiteboard-shell-links');
      const elements = {
        s1: { type: 'container', x: 0, y: 0, w: 600, h: 300, text: 'Overview' },
        s2: { type: 'container', x: 5000, y: 2400, w: 600, h: 300, text: 'Payment DB' },
      };
      for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(linksRoot, sub), { recursive: true });
      fs.writeFileSync(path.join(linksRoot, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Linked board', order: Object.keys(elements) }));
      for (const [id, el] of Object.entries(elements)) fs.writeFileSync(path.join(linksRoot, 'db/elements', id + '.json'), JSON.stringify(el));
      const linked = daemon.store.create({ root: linksRoot, type: 'whiteboard', title: 'Linked board' });
      const inView = id => `(() => {
        const box = document.querySelector('.wb-elements [data-wb-id="${id}"]')?.getBoundingClientRect();
        return !!box && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
      })()`;
      const p = await browser.load(daemon.viewUrl(linked.id) + '#element=s2', { ready });
      try {
        assert.ok(await p.waitFor(inView('s2')), 'the board did not open at "Payment DB"');
        assert.ok(await p.waitFor(`${inView('s2')} && !document.querySelector('[data-wb-jump-back]')`), 'Back shows on a board opened at an element');
        await p.evaluate("location.hash = '#element=s1'; 1");
        assert.ok(await p.waitFor(`${inView('s1')} && !!document.querySelector('[data-wb-jump-back]')`), 'a change of the address did not go to "Overview"');
      } finally { await p.close(); }
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

    it('offers an animated GIF only for a board with flowing arrows, and downloads ten looping frames', async () => {
      const openExport = async page => {
        await page.evaluate("document.querySelector('button[aria-label=Share]').click()");
        assert.ok(await page.waitFor("document.body.innerText.includes('Only this computer')"));
        await page.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Export').click()");
        assert.ok(await page.waitFor(`document.querySelector('[data-export-row="PNG image"]')?.disabled === false`));
      };
      const gifRow = `document.querySelector('[data-export-row="Animated GIF"]')`;
      const still = await browser.load(shellUrl, { ready });
      try {
        await openExport(still);
        assert.equal(await still.evaluate(`Boolean(${gifRow})`), false, 'a board without flowing arrows has no GIF');
      } finally { await still.close(); }

      const flowRoot = tmpDir('whiteboard-shell-flow');
      const elements = {
        s1: { type: 'shape', kind: 'rect', x: 0, y: 0, w: 120, h: 80, color: 'blue', text: 'In' },
        s2: { type: 'shape', kind: 'rect', x: 360, y: 0, w: 120, h: 80, color: 'green', text: 'Out' },
        a1: { type: 'arrow', from: 's1', to: 's2', head: 'end', dash: true, flow: true, color: 'ink' },
      };
      for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(flowRoot, sub), { recursive: true });
      fs.writeFileSync(path.join(flowRoot, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Flowing board', order: Object.keys(elements) }));
      for (const [id, el] of Object.entries(elements)) fs.writeFileSync(path.join(flowRoot, 'db/elements', id + '.json'), JSON.stringify(el));
      const board = daemon.store.create({ root: flowRoot, type: 'whiteboard', title: 'Flowing board' });
      const p = await browser.load(daemon.viewUrl(board.id), { ready });
      try {
        await openExport(p);
        assert.ok(await p.waitFor(`${gifRow}?.disabled === false`), 'the Export tab lists the animated GIF');
        await p.evaluate(gifRow + '.click()');
        const filename = path.join(downloads, 'Flowing board.gif');
        assert.ok(await until(() => fs.existsSync(filename) && fs.statSync(filename).size > 0, 30000), 'a GIF reached the download folder');
        const file = fs.readFileSync(filename);
        assert.equal(file.subarray(0, 6).toString(), 'GIF89a');
        const loop = file.indexOf('NETSCAPE2.0');
        assert.ok(loop > 0, 'the GIF has a loop block');
        assert.equal(file.readUInt16LE(loop + 13), 0, 'it loops for ever');
        const frames = await p.evaluate(`(async () => {
          const bytes = Uint8Array.from(atob('${file.toString('base64')}'), c => c.charCodeAt(0));
          const decoder = new ImageDecoder({ data: bytes, type: 'image/gif' });
          await decoder.tracks.ready;
          const track = decoder.tracks.selectedTrack;
          await decoder.completed;
          const pixels = [];
          const durations = [];
          for (let i = 0; i < track.frameCount; i++) {
            const { image } = await decoder.decode({ frameIndex: i });
            durations.push(image.duration);
            const canvas = new OffscreenCanvas(image.displayWidth, image.displayHeight);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            image.close();
            let hash = 0;
            for (const v of ctx.getImageData(0, 0, canvas.width, canvas.height).data) hash = (hash * 31 + v) | 0;
            pixels.push(hash);
          }
          return { count: track.frameCount, repetition: String(track.repetitionCount), pixels, durations };
        })()`, { timeout: 30000 });
        assert.equal(frames.count, 10, 'ten frames');
        assert.equal(frames.repetition, 'Infinity', 'it loops');
        assert.ok(frames.durations.every(d => d === 50_000), `each frame shows 5/100 s: ${frames.durations}`);
        for (let i = 0; i < frames.count; i++) {
          assert.notEqual(frames.pixels[i], frames.pixels[(i + 1) % frames.count], `frames ${i} and ${(i + 1) % frames.count} differ`);
        }
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('offers an MP4 video only for a board with flowing arrows, and downloads six silent seconds', async t => {
      const openExport = async page => {
        await page.evaluate("document.querySelector('button[aria-label=Share]').click()");
        assert.ok(await page.waitFor("document.body.innerText.includes('Only this computer')"));
        await page.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Export').click()");
        assert.ok(await page.waitFor(`document.querySelector('[data-export-row="PNG image"]')?.disabled === false`));
      };
      const mp4Row = `document.querySelector('[data-export-row="MP4 video"]')`;
      const still = await browser.load(shellUrl, { ready });
      try {
        await openExport(still);
        assert.equal(await still.evaluate(`Boolean(${mp4Row})`), false, 'a board without flowing arrows has no video');
        const encodes = await still.evaluate(`(async () => {
          if (typeof VideoEncoder === 'undefined') return false;
          for (const codec of ['avc1.42001f', 'vp09.00.10.08', 'av01.0.04M.08']) {
            const { supported } = await VideoEncoder.isConfigSupported({ codec, width: 640, height: 360, bitrate: 2_000_000 }).catch(() => ({}));
            if (supported) return true;
          }
          return false;
        })()`);
        if (!encodes) {
          t.skip('this browser has no video encoder');
          return;
        }
      } finally { await still.close(); }

      const flowRoot = tmpDir('whiteboard-shell-flow-video');
      const elements = {
        s1: { type: 'shape', kind: 'rect', x: 0, y: 0, w: 120, h: 80, color: 'blue', text: 'In' },
        s2: { type: 'shape', kind: 'rect', x: 361, y: 0, w: 121, h: 81, color: 'green', text: 'Out' },
        a1: { type: 'arrow', from: 's1', to: 's2', head: 'end', dash: true, flow: true, color: 'ink' },
      };
      for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(flowRoot, sub), { recursive: true });
      fs.writeFileSync(path.join(flowRoot, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Flowing video', order: Object.keys(elements) }));
      for (const [id, el] of Object.entries(elements)) fs.writeFileSync(path.join(flowRoot, 'db/elements', id + '.json'), JSON.stringify(el));
      const board = daemon.store.create({ root: flowRoot, type: 'whiteboard', title: 'Flowing video' });
      const p = await browser.load(daemon.viewUrl(board.id), { ready });
      try {
        await openExport(p);
        assert.ok(await p.waitFor(`${mp4Row}?.disabled === false`), 'the Export tab lists the MP4 video');
        assert.equal(
          await p.evaluate(`[...document.querySelectorAll('[data-export-row]')].map(row => row.dataset.exportRow).slice(0, 4).join('|')`),
          'PNG image|Animated GIF|MP4 video|Board file',
          'the video comes after the GIF',
        );
        await p.evaluate(mp4Row + '.click()');
        const filename = path.join(downloads, 'Flowing video.mp4');
        assert.ok(await until(() => fs.existsSync(filename) && fs.statSync(filename).size > 0, 60000), 'a video reached the download folder');
        const file = fs.readFileSync(filename);
        assert.equal(file.subarray(4, 8).toString(), 'ftyp', 'an MP4 starts with its ftyp box');
        // The top-level boxes, then the movie's length from its mvhd box.
        const boxes = new Map();
        for (let at = 0; at + 8 <= file.length; ) {
          const size = file.readUInt32BE(at);
          boxes.set(file.subarray(at + 4, at + 8).toString(), at);
          if (size < 8) break;
          at += size;
        }
        assert.ok(boxes.has('moov'), 'the file has a moov box');
        const moov = boxes.get('moov');
        const mvhd = file.indexOf('mvhd', moov);
        const version = file[mvhd + 4];
        const timescale = file.readUInt32BE(mvhd + (version === 1 ? 24 : 16));
        const duration = version === 1 ? Number(file.readBigUInt64BE(mvhd + 28)) : file.readUInt32BE(mvhd + 20);
        const seconds = duration / timescale;
        assert.ok(Math.abs(seconds - 6) < 0.15, `about six seconds: ${seconds}`);
        const handlers = [];
        for (let at = file.indexOf('hdlr', moov); at > 0; at = file.indexOf('hdlr', at + 4)) handlers.push(file.subarray(at + 12, at + 16).toString());
        assert.ok(handlers.includes('vide'), `a video track: ${handlers}`);
        assert.ok(!handlers.includes('soun'), 'no sound track');
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

  // 2026-11-23: in a pane about 660 px wide (an agent app's side pane) the zoom stopped at 60%: "Fit the board" left part
  // of the board cut off, "Zoom out" was disabled and ⌘/ctrl + wheel did not zoom out. Narrow views had a larger minimum.
  it('fits the whole board in a narrow pane and zooms out past 60% from the menu and the wheel', { skip: noBrowser }, async () => {
    const p = await browser.load('about:blank', { ready: 'true' });
    try {
      await p.cdp('Emulation.setDeviceMetricsOverride', { width: 660, height: 400, deviceScaleFactor: 1, mobile: false });
      await p.cdp('Page.navigate', { url: url + '?open_artifact_bench=1' });
      const zoom = 'window.__openArtifactWhiteboard?.state().camera.zoom';
      // Every element wholly inside the view.
      const allInView = `(() => {
        const boxes = [...document.querySelectorAll('.wb-elements [data-wb-id]')].map(e => e.getBoundingClientRect());
        return boxes.length > 0 && boxes.every(r => r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight);
      })()`;
      assert.ok(await p.waitFor(`innerWidth === 660 && ${zoom} > 0 && ${zoom} < 0.6 && ${allInView}`, 10000), `the board was not fitted whole on open: zoom ${await p.evaluate(zoom)}`);
      const fitted = await p.evaluate(zoom);

      // The zoom menu: "Zoom out" is there to use, and zooms out.
      const item = name => `[...document.querySelectorAll('[role=menuitem]')].find(e => e.textContent.trim().startsWith(${JSON.stringify(name)}))`;
      const enabled = name => `(() => { const e = ${item(name)}; return !!e && e.getAttribute('aria-disabled') !== 'true' && !e.hasAttribute('data-disabled'); })()`;
      const openMenu = async () => {
        await clickOn(p, "document.querySelector('button[aria-label^=\"Zoom \"]')", 'the zoom readout');
        assert.ok(await p.waitFor(item('Zoom out'), 3000), 'the zoom menu did not open');
      };
      await openMenu();
      assert.ok(await p.evaluate(enabled('Zoom out')), '"Zoom out" is disabled');
      await clickOn(p, item('Zoom out'), 'Zoom out');
      assert.ok(await p.waitFor(`${zoom} < ${fitted} - 0.01`, 3000), `"Zoom out" left the zoom at ${await p.evaluate(zoom)}`);
      const stepped = await p.evaluate(zoom);
      await p.press('Escape');

      // ⌘/ctrl + wheel over the board zooms out further, and back in.
      const wheel = deltaY => p.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 330, y: 200, deltaX: 0, deltaY, modifiers: 2 });
      await wheel(200);
      assert.ok(await p.waitFor(`${zoom} < ${stepped} - 0.01`, 3000), `the wheel did not zoom out: ${await p.evaluate(zoom)}`);
      const wheeled = await p.evaluate(zoom);
      await wheel(-200);
      assert.ok(await p.waitFor(`${zoom} > ${wheeled} + 0.01`, 3000), `the wheel did not zoom in: ${await p.evaluate(zoom)}`);

      // "Fit the board" brings the whole board back.
      await openMenu();
      await clickOn(p, item('Fit the board'), 'Fit the board');
      assert.ok(await p.waitFor(`Math.abs(${zoom} - ${fitted}) < 0.005 && ${allInView}`, 3000), `"Fit the board" left zoom ${await p.evaluate(zoom)}, fitted was ${fitted}`);
    } finally { await p.close(); }
  });

  it('lists the titled sections under "Go to section" and glides the view to the one picked', { skip: noBrowser }, async () => {
    const board = tmpDir('whiteboard-sections');
    const elements = {
      s1: { type: 'container', x: 0, y: 0, w: 600, h: 300, text: 'Overview' },
      s2: { type: 'container', x: 5000, y: 2400, w: 600, h: 300, text: 'Payment DB' },
      s3: { type: 'container', x: 5000, y: -3000, w: 600, h: 300, text: '' },
      n1: { type: 'shape', kind: 'rect', x: 5040, y: 2440, w: 200, h: 100, color: 'blue', text: 'Postgres' },
    };
    fs.mkdirSync(path.join(board, 'db/elements'), { recursive: true });
    fs.mkdirSync(path.join(board, 'db/board'), { recursive: true });
    fs.writeFileSync(path.join(board, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Sections', order: Object.keys(elements) }));
    for (const [id, el] of Object.entries(elements)) fs.writeFileSync(path.join(board, 'db/elements', id + '.json'), JSON.stringify(el));
    const opened = await run.json(['open', board, '--type', 'whiteboard', '--json']);
    const p = await browser.load(opened.url + '?open_artifact_bench=1', { ready });
    try {
      const state = 'window.__openArtifactWhiteboard?.state()';
      assert.ok(await p.waitFor(`${state}?.elementViews === 4`, 10000), 'the board did not draw');
      const item = name => `[...document.querySelectorAll('[role^=menuitem]')].find(e => e.textContent.trim() === ${JSON.stringify(name)})`;
      await clickOn(p, "document.querySelector('button[aria-label^=\"Zoom \"]')", 'the zoom readout');
      await clickOn(p, item('Go to section'), 'Go to section');
      assert.ok(await p.waitFor(item('Payment DB'), 3000), 'the section list did not open');
      // Titled sections only, in reading order.
      const listed = await p.evaluate(`[...document.querySelectorAll('[role=menu]')].at(-1).innerText.split('\\n').map(s => s.trim()).filter(Boolean)`);
      assert.deepEqual(listed, ['Overview', 'Payment DB']);

      await clickOn(p, item('Payment DB'), 'Payment DB');
      // The section and its title are in view, no closer than 100%; the selection is untouched.
      const inView = `(() => {
        const box = document.querySelector('.wb-elements [data-wb-id="s2"]')?.getBoundingClientRect();
        return !!box && box.left >= 0 && box.top >= 28 && box.right <= innerWidth && box.bottom <= innerHeight;
      })()`;
      assert.ok(await p.waitFor(`${inView} && ${state}.camera.zoom <= 1 && ${state}.camera.zoom > 0.5`, 3000),
        `"Payment DB" was not brought into view: ${JSON.stringify(await p.evaluate(`${state}.camera`))}`);
      assert.deepEqual(await p.evaluate(`${state}.selection`), []);
    } finally {
      // No `stop` here: the board shares the type server with the rest of the suite, which `after` stops.
      await p.close();
    }
  });

  it('follows links to elements of the board, goes back, opens at one and keeps them through copy and paste', { skip: noBrowser, timeout: 60000 }, async () => {
    const board = tmpDir('whiteboard-element-links');
    const elements = {
      s1: { type: 'container', x: 0, y: 0, w: 600, h: 300, text: 'Overview' },
      s2: { type: 'container', x: 5000, y: 2400, w: 600, h: 300, text: 'Payment DB' },
      card: { type: 'link', x: 0, y: 400, href: '#element=s2' },
      lost: { type: 'link', x: 0, y: 500, href: '#element=gone', title: 'Old place' },
      words: { type: 'text', x: 0, y: 620, w: 320, text: 'See [the DB](#element=s2)' },
    };
    for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(board, sub), { recursive: true });
    fs.writeFileSync(path.join(board, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Element links', order: Object.keys(elements) }));
    for (const [id, el] of Object.entries(elements)) fs.writeFileSync(path.join(board, 'db/elements', id + '.json'), JSON.stringify(el));
    const opened = await run.json(['open', board, '--type', 'whiteboard', '--json']);
    const state = 'window.__openArtifactWhiteboard?.state()';
    const inView = id => `(() => {
      const box = document.querySelector('.wb-elements [data-wb-id="${id}"]')?.getBoundingClientRect();
      return !!box && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
    })()`;
    const centre = sel => `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;
    const back = '[data-wb-jump-back]';
    const p = await browser.load(opened.url + '?open_artifact_bench=1', { ready });
    try {
      assert.ok(await p.waitFor(`${state}?.elementViews === 5`, 10000), 'the board did not draw');
      // A card to an element shows that element's title and kind; one whose element is gone is greyed with its stored title.
      assert.ok(await p.waitFor("document.querySelector('[data-wb-id=card]')?.innerText.includes('Payment DB')", 3000), 'the card shows its target');
      assert.match(await p.evaluate("document.querySelector('[data-wb-id=card]').innerText"), /Section · On this board/);
      assert.equal(await p.evaluate("!!document.querySelector('.wb-link-gone[data-wb-id=lost], [data-wb-id=lost] .wb-link-gone')"), true, 'the card to a removed element is greyed');
      assert.match(await p.evaluate("document.querySelector('[data-wb-id=lost]').innerText"), /Old place/);

      // Opening the card takes the view there and rings it; Back returns.
      const start = await p.evaluate(`${state}.camera`);
      await p.clickTimes(...await p.evaluate(centre('[data-wb-id=card]')), 2);
      assert.ok(await p.waitFor(`${inView('s2')} && !!document.querySelector('[data-wb-jump-flash="s2"]')`, 4000),
        `the card did not go to "Payment DB": ${JSON.stringify(await p.evaluate(`${state}.camera`))}`);
      assert.ok(await p.waitFor(`!!document.querySelector('${back}')`, 2000), 'no Back after going to it');
      await clickOn(p, `[...document.querySelectorAll('${back} button')].find(b => b.textContent.trim() === 'Back')`, 'Back');
      assert.ok(await p.waitFor(`(() => { const c = ${state}.camera; return Math.abs(c.x - ${start.x}) < 1 && Math.abs(c.y - ${start.y}) < 1 && !document.querySelector('${back}'); })()`, 4000),
        `Back did not return: ${JSON.stringify(await p.evaluate(`${state}.camera`))}`);

      // A text link to an element: its card offers Go to.
      const link = await p.evaluate(centre('[data-wb-id=words] a[data-wb-link]'));
      await p.hover(link[0] - 4, link[1]);
      await p.hover(...link);
      assert.ok(await p.waitFor("document.querySelector('[data-wb-link-card]')?.innerText.includes('Payment DB')", 3000), 'the text link card names its target');
      await clickOn(p, "document.querySelector('[data-wb-link-card] button[aria-label=\"Go to\"]')", 'Go to');
      assert.ok(await p.waitFor(inView('s2'), 4000), 'Go to did not show "Payment DB"');

      // A change of the fragment goes there too, with Back.
      await p.evaluate("location.hash = '#element=s1'; 1");
      assert.ok(await p.waitFor(`${inView('s1')} && !!document.querySelector('${back}')`, 4000), 'the fragment did not go to "Overview"');

      // Copying an element with a card to it: the pasted card points at the pasted element.
      await p.evaluate("history.replaceState(null, '', location.pathname + location.search); 1");
      const mod = process.platform === 'darwin' ? { meta: true } : { ctrl: true };
      await p.click(...await p.evaluate(centre('[data-wb-id=card]')));
      await p.press('a', mod);
      assert.ok(await p.waitFor(`${state}.selection.length === 5`, 2000), 'select all');
      const pasted = await p.evaluate(`(() => {
        const d = new DataTransfer();
        document.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: d }));
        document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: d }));
        return true;
      })()`);
      assert.equal(pasted, true);
      assert.ok(await p.waitFor(`${state}.elements === 10`, 4000), 'the copies did not land');
      const hrefs = await p.evaluate(`(() => {
        const ids = [...document.querySelectorAll('.wb-elements [data-wb-id]')].map(e => e.dataset.wbId);
        const els = window.__openArtifactWhiteboard.elements(ids).filter(Boolean);
        const sections = new Map(els.filter(e => e.type === 'container').map(e => [e.id, e.text]));
        return els.filter(e => e.type === 'link' && e.id !== 'card' && e.id !== 'lost').map(e => ({ href: e.href, target: sections.get(e.href.replace('#element=', '')) }));
      })()`);
      assert.equal(hrefs.length, 2, JSON.stringify(hrefs));
      const copy = hrefs.find(h => h.href !== '#element=gone');
      assert.notEqual(copy.href, '#element=s2', 'the pasted card still points at the original');
      assert.equal(copy.target, 'Payment DB', `the pasted card points at the pasted section: ${JSON.stringify(hrefs)}`);
      assert.deepEqual(p.problems, []);
    } finally {
      // No `stop` here: the board shares the type server with the rest of the suite, which `after` stops.
      await p.close();
    }
    // Opened at an element: it is in view at first, with nothing to go back to.
    const deep = await browser.load(opened.url + '?open_artifact_bench=1#element=s2', { ready });
    try {
      assert.ok(await deep.waitFor(`${state}?.elementViews >= 5 && ${inView('s2')}`, 10000), 'the page did not open at "Payment DB"');
      assert.equal(await deep.evaluate(`!!document.querySelector('${back}')`), false, 'Back shows on a page opened at an element');
    } finally { await deep.close(); }
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

  it('folds the selection bar into More tools in a narrow view: the keyboard opens the card, Escape closes it and keeps the selection', { skip: noBrowser }, async () => {
    const board = tmpDir('whiteboard-fold');
    for (const sub of ['db/elements', 'db/board', '_blobs']) fs.mkdirSync(path.join(board, sub), { recursive: true });
    fs.writeFileSync(path.join(board, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Fold', order: ['box'] }));
    fs.writeFileSync(path.join(board, 'db/elements/box.json'), JSON.stringify({ type: 'shape', kind: 'rect', x: 0, y: 0, w: 160, h: 100, color: 'blue', text: 'Narrow' }));
    const { url: boardUrl } = await run.json(['open', board, '--type', 'whiteboard', '--json']);
    const p = await browser.load('about:blank', { ready: 'true' });
    const bar = `document.querySelector('[data-wb-bar="selection"]')`;
    try {
      await p.cdp('Emulation.setDeviceMetricsOverride', { width: 340, height: 640, deviceScaleFactor: 1, mobile: false });
      await p.cdp('Page.navigate', { url: boardUrl });
      assert.ok(await p.waitFor(`${ready} && document.querySelector('#wb-box')`, 10000));
      // Clicked once the board has fitted itself to the view and the shape holds still.
      await clickOn(p, "document.querySelector('#wb-box')", 'the shape');
      assert.ok(await p.waitFor(bar, 5000), 'the shape is selected');
      await checkFoldCard(p, bar);
      assert.ok(await p.evaluate(`Boolean(${bar})`), 'Escape from the card kept the selection');
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
      assert.deepEqual(p.problems, []);
    } finally { await p.close(); await run.run(['stop', board]); }
  });

  it('shows what changed on disk while its event stream was down, without a reload', { skip: noBrowser }, async () => {
    const board = tmpDir('whiteboard-gap');
    const elements = {
      note: { type: 'shape', kind: 'rect', x: 0, y: 0, w: 200, h: 100, color: 'yellow', text: 'Before' },
      gone: { type: 'shape', kind: 'rect', x: 260, y: 0, w: 200, h: 100, color: 'blue', text: 'Leaving' },
    };
    for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(board, sub), { recursive: true });
    fs.writeFileSync(path.join(board, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Gap', order: Object.keys(elements) }));
    for (const [id, el] of Object.entries(elements)) fs.writeFileSync(path.join(board, 'db/elements', id + '.json'), JSON.stringify(el));
    const { url: boardUrl } = await run.json(['open', board, '--type', 'whiteboard', '--json']);
    // The page's event stream is a WebSocket. Keep each one, and while `__holdStream` is set send new ones to a port
    // nobody listens on, so the page keeps trying to reconnect (every 2 s) and hears nothing.
    const watch = `(() => {
      const Native = window.WebSocket;
      window.__streams = [];
      window.__holdStream = false;
      window.WebSocket = class extends Native {
        constructor(url, protocols) {
          super(window.__holdStream ? 'ws://127.0.0.1:9/' : url, protocols);
          window.__streams.push(this);
        }
      };
    })()`;
    const p = await browser.load(boardUrl, { ready, ignore: [/WebSocket connection to 'ws:\/\/127\.0\.0\.1:9\/' failed/] });
    try {
      await p.cdp('Page.addScriptToEvaluateOnNewDocument', { source: watch });
      await p.cdp('Page.reload', {});
      assert.ok(await p.waitFor(`window.__streams?.some(s => s.readyState === 1) && ${ready} && document.querySelector('#wb-note')?.textContent.includes('Before')`, 15000));
      await p.evaluate('window.__holdStream = true; for (const s of window.__streams) s.close()');
      assert.ok(await p.waitFor('window.__streams.every(s => s.readyState === 3)', 5000));
      // The agent edits one element and removes another while the page hears nothing.
      fs.writeFileSync(path.join(board, 'db/elements/note.json'), JSON.stringify({ ...elements.note, text: 'After' }));
      fs.rmSync(path.join(board, 'db/elements/gone.json'));
      await new Promise(resolve => setTimeout(resolve, 1500)); // the server's watcher has sent its event to no one
      assert.ok(await p.evaluate("document.querySelector('#wb-note').textContent.includes('Before')"), 'nothing heard yet');
      await p.evaluate('window.__holdStream = false');
      assert.ok(await p.waitFor("document.querySelector('#wb-note')?.textContent.includes('After') && !document.querySelector('#wb-gone')", 15000),
        'the reconnected page reads again what it missed');
      assert.deepEqual(p.problems, []);
    } finally { await p.close(); await run.run(['stop', board]); }
  });

  describe('shape libraries', { skip: noBrowser }, () => {
    const library = path.join(fixtures, 'whiteboard/demo.shapes.json');
    const panel = '[data-wb-library-panel]';
    const cells = `document.querySelectorAll('${panel} [data-library-cell]')`;
    const newBoard = (name, elements = {}) => {
      const board = tmpDir(name);
      for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(board, sub), { recursive: true });
      fs.writeFileSync(path.join(board, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Services', order: Object.keys(elements) }));
      for (const [id, el] of Object.entries(elements)) fs.writeFileSync(path.join(board, 'db/elements', id + '.json'), JSON.stringify(el));
      return board;
    };
    const saved = board => fs.readdirSync(path.join(board, 'db/elements')).filter(n => n.endsWith('.json'))
      .map(n => ({ id: n.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(board, 'db/elements', n))) }));
    const libraries = board => {
      const file = path.join(board, 'db/board/shapes.json');
      return fs.existsSync(file) ? Object.values(JSON.parse(fs.readFileSync(file)).libs ?? {}) : [];
    };
    const openPanel = async p => {
      await clickOn(p, `document.querySelector('[aria-label="Board tools"] button[aria-label="Shapes"]')`);
      await clickOn(p, `document.querySelector('.wb-tray button[aria-label="Library"]')`);
      assert.ok(await p.waitFor(`document.querySelector('${panel}')`, 10000), 'the Library panel opens');
    };
    const chooseFiles = async (p, files) => {
      const { root: doc } = await p.cdp('DOM.getDocument', { depth: 0 });
      const { nodeId } = await p.cdp('DOM.querySelector', { nodeId: doc.nodeId, selector: `${panel} input[type="file"]` });
      await p.cdp('DOM.setFileInputFiles', { nodeId, files });
    };

    it('adds a library from a file, places a shape with its name, keeps the library through a reload and the shape after removing it', { timeout: 90000 }, async () => {
      const board = newBoard('whiteboard-library', { target: { type: 'shape', kind: 'rect', x: 400, y: 0, w: 160, h: 100, color: 'blue', text: 'Orders' } });
      const { url: boardUrl } = await run.json(['open', board, '--type', 'whiteboard', '--json']);
      const p = await browser.load(boardUrl, { ready });
      try {
        await openPanel(p);
        assert.ok(await p.waitFor(`document.querySelector('${panel}').innerText.includes('How shape libraries work')`, 3000), 'an empty board explains libraries');
        await chooseFiles(p, [library]);
        assert.ok(await p.waitFor(`${cells}.length === 11`, 10000), 'every shape of the library is listed');
        assert.ok(await p.waitFor(`document.querySelector('[data-wb-library-report]')?.innerText.includes('Added “Demo cloud”: 11 shapes.')`, 3000), 'the panel says what was added');
        assert.ok(await p.evaluate(`[...${cells}].every(b => b.querySelector('img')?.src.startsWith('data:image/svg+xml') && !b.querySelector('svg'))`), 'shapes show as pictures, not markup');
        assert.ok(await until(() => libraries(board).length === 1), 'the board lists the library');
        const [entry] = libraries(board);
        assert.equal(entry.name, 'Demo cloud');
        assert.equal(entry.count, 11);
        assert.equal(entry.license, 'CC0-1.0');
        assert.match(entry.file, /^\/_blob\/[0-9a-f]+$/);
        const stored = await (await fetch(new URL(entry.file, boardUrl))).json();
        assert.equal(stored.format, 'open-artifact-shapes', 'the page reads the stored library back');
        assert.equal(stored.shapes.length, 11);

        // Search by tag, then pick one and click the board.
        await typeIntoSearch(p, 'storage');
        assert.ok(await p.waitFor(`${cells}.length === 1 && ${cells}[0].getAttribute('aria-label') === 'Pick shape: Database'`, 3000), 'a search finds shapes by tag');
        await clickOn(p, `${cells}[0]`);
        assert.ok(await p.waitFor(`!document.querySelector('${panel}')`, 3000), 'picking a shape closes the panel');
        const target = await p.evaluate(`(() => { const r = document.querySelector('[data-wb-id=target]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.left }; })()`);
        await p.click(target.left - 220, target.y);
        assert.ok(await until(() => saved(board).length === 3), 'a picture and its label are added');
        const image = saved(board).find(el => el.type === 'image');
        const label = saved(board).find(el => el.type === 'text');
        assert.equal(image.style, 'plain');
        assert.match(image.src, /^data:image\/svg\+xml,<svg .*<title>Database<\/title>/, 'the picture carries its own drawing');
        assert.equal(image.w, 80);
        assert.equal(image.h, 80);
        assert.equal(label.text, '');
        assert.equal(label.placeholder, 'Database');
        assert.equal(image.groups.length, 1);
        assert.deepEqual(label.groups, image.groups, 'the picture and its label move together');
        assert.ok(label.y > image.y + image.h, 'the label sits under the picture');
        assert.ok(await p.waitFor(`document.querySelector('[data-wb-id="${label.id}"] .wb-text-hint')?.textContent === 'Database'`, 3000), 'the label shows the shape name');

        // An arrow attaches to the placed shape like to any picture.
        await p.press('Escape');
        await clickOn(p, `document.querySelector('[aria-label="Board tools"] button[aria-label="Draw"]')`);
        await clickOn(p, `document.querySelector('.wb-tray button[aria-label="Arrow"]')`);
        const from = await p.evaluate(`(() => { const r = document.querySelector('[data-wb-id="${image.id}"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
        await p.dragMouse(from, [target.x, target.y]);
        assert.ok(await until(() => saved(board).some(el => el.type === 'arrow' && el.from === image.id && el.to === 'target')), 'an arrow joins the placed shape to the box');

        // The library is still there after a reload.
        await p.cdp('Page.reload', {});
        assert.ok(await p.waitFor(ready, 10000));
        await openPanel(p);
        assert.ok(await p.waitFor(`${cells}.length === 11`, 10000), 'the library is listed after a reload');

        // Removing it keeps what was placed.
        await clickOn(p, `document.querySelector('${panel} button[aria-label="Demo cloud: library menu"]')`);
        assert.ok(await p.waitFor(`document.querySelector('${panel}').innerText.includes('Licence: CC0-1.0')`, 3000), 'the menu shows the licence');
        await clickOn(p, `[...document.querySelectorAll('${panel} button')].find(b => b.textContent === 'Remove from this board')`);
        assert.ok(await until(() => libraries(board).length === 0), 'the library is removed from the board');
        assert.ok(await p.waitFor(`${cells}.length === 0 && document.querySelector('${panel}').innerText.includes('How shape libraries work')`, 3000));
        assert.equal(saved(board).length, 4, 'placed shapes and the arrow stay');
        assert.ok(saved(board).some(el => el.id === image.id && el.src === image.src));
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('refuses an SVG with a script and adds nothing', { timeout: 60000 }, async () => {
      const board = newBoard('whiteboard-library-script');
      const bad = path.join(tmpDir('whiteboard-library-files'), 'alarm.svg');
      fs.writeFileSync(bad, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script><circle cx="12" cy="12" r="9"/></svg>');
      const { url: boardUrl } = await run.json(['open', board, '--type', 'whiteboard', '--json']);
      const p = await browser.load(boardUrl, { ready });
      try {
        await openPanel(p);
        await chooseFiles(p, [bad]);
        assert.ok(await p.waitFor(`document.querySelector('[data-wb-library-report]')?.innerText.includes('was not added')`, 10000), 'the panel says the file was not added');
        assert.ok(await p.evaluate(`document.querySelector('[data-wb-library-report]').innerText.includes('alarm: uses <script>')`), 'and names the shape and why');
        assert.equal(await p.evaluate(`${cells}.length`), 0);
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.deepEqual(libraries(board), [], 'no library is listed');
        assert.deepEqual(saved(board), [], 'nothing is placed');
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    const shapeSvg = title => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><title>${title}</title><rect x="3" y="3" width="18" height="18" rx="3"/></svg>`;
    const reportText = () => `document.querySelector('[data-wb-library-report]')?.innerText ?? ''`;
    /** A zip pack: two drawings in folders, plus what a pack carries that is not a shape. */
    const networkPack = () => zipOf([
      ['Network pack/network/Router.svg', shapeSvg('Router')],
      ['Network pack/storage/Disk.svg', shapeSvg('Disk')],
      ['__MACOSX/Network pack/network/._Router.svg', 'resource fork'],
      ['Network pack/.DS_Store', 'finder'],
      ['Network pack/LICENSE.txt', 'CC0'],
    ]);

    it('adds a zip pack of SVG files from the picker, its folders as tags', { timeout: 60000 }, async () => {
      const board = newBoard('whiteboard-library-zip');
      const file = path.join(tmpDir('whiteboard-library-zip-files'), 'Network pack.zip');
      fs.writeFileSync(file, networkPack());
      const { url: boardUrl } = await run.json(['open', board, '--type', 'whiteboard', '--json']);
      const p = await browser.load(boardUrl, { ready });
      try {
        await openPanel(p);
        await chooseFiles(p, [file]);
        assert.ok(await p.waitFor(`${cells}.length === 2`, 10000), 'each SVG file in the pack is a shape');
        assert.ok(await p.waitFor(`(${reportText()}).includes('Added “Network pack”: 2 shapes.')`, 3000), 'files that are not shapes are skipped without a word');
        assert.ok(await until(() => libraries(board).length === 1));
        assert.equal(libraries(board)[0].name, 'Network pack');
        assert.equal(libraries(board)[0].count, 2);
        await typeIntoSearch(p, 'storage');
        assert.ok(await p.waitFor(`${cells}.length === 1 && ${cells}[0].getAttribute('aria-label') === 'Pick shape: Disk'`, 3000), 'a folder name finds its shapes');
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('adds a draw.io library, saying which shapes it could not read', { timeout: 60000 }, async () => {
      const board = newBoard('whiteboard-library-drawio');
      const file = path.join(tmpDir('whiteboard-library-drawio-files'), 'Network.drawio');
      fs.writeFileSync(file, drawioLibrary());
      const { url: boardUrl } = await run.json(['open', board, '--type', 'whiteboard', '--json']);
      const p = await browser.load(boardUrl, { ready });
      try {
        await openPanel(p);
        await chooseFiles(p, [file]);
        assert.ok(await p.waitFor(`${cells}.length === 2`, 10000), 'the SVG pictures in the library are shapes');
        assert.ok(await p.waitFor(`(${reportText()}).includes('Added “Network”: 2 shapes, 1 left out.')`, 3000), 'the panel counts what it left out');
        assert.ok((await p.evaluate(reportText())).includes('Lambda: is drawn in a way boards cannot read'), 'and names it, and why');
        assert.deepEqual(await p.evaluate(`[...${cells}].map(b => b.getAttribute('aria-label'))`), ['Pick shape: Firewall', 'Pick shape: Shape 2']);
        assert.ok(await until(() => libraries(board).length === 1 && libraries(board)[0].count === 2));
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('adds a library from an https:// link after asking, and explains a link the page cannot read', { timeout: 90000 }, async () => {
      const board = newBoard('whiteboard-library-link');
      const { url: boardUrl } = await run.json(['open', board, '--type', 'whiteboard', '--json']);
      const p = await browser.load(boardUrl, { ready });
      // Requests to the made-up site are answered here; none reaches the network.
      const site = 'https://shapes.example.com/';
      const asked = [];
      const answers = {
        'https://shapes.example.com/packs/Network%20pack.zip': { body: networkPack(), cors: true },
        'https://shapes.example.com/closed.shapes.json': { body: fs.readFileSync(library), cors: false },
      };
      const stop = p.onCdp('Fetch.requestPaused', ({ requestId, request }) => {
        asked.push({ url: request.url, cookie: Object.keys(request.headers).some(h => h.toLowerCase() === 'cookie'), referer: Object.keys(request.headers).some(h => h.toLowerCase() === 'referer') });
        const answer = answers[request.url];
        const headers = [{ name: 'Content-Type', value: 'application/octet-stream' }, ...(answer?.cors ?? true ? [{ name: 'Access-Control-Allow-Origin', value: '*' }] : [])];
        p.cdp('Fetch.fulfillRequest', { requestId, responseCode: answer ? 200 : 404, responseHeaders: headers, body: Buffer.from(answer?.body ?? 'not here').toString('base64') }).catch(() => {});
      });
      await p.cdp('Fetch.enable', { patterns: [{ urlPattern: site + '*' }] });
      const form = '[data-wb-library-link]';
      const linkTo = async link => {
        if (await p.evaluate(`!!document.querySelector('${form}')`)) {
          await p.press('Escape');
          assert.ok(await p.waitFor(`!document.querySelector('${form}')`, 3000), 'Escape closes the link field');
        }
        if (!await p.evaluate(`!!document.querySelector('${panel}')`)) await openPanel(p);
        await clickOn(p, `[...document.querySelectorAll('${panel} button')].find(b => b.textContent === 'Add library…')`);
        await clickOn(p, `[...document.querySelectorAll('${panel} button')].find(b => b.textContent === 'From a link…')`);
        assert.ok(await p.waitFor(`document.activeElement === document.querySelector('${form} input[type="url"]')`, 3000), 'the link field takes focus');
        await p.type(link);
        await p.press('Enter');
      };
      const linkError = `document.querySelector('[data-wb-library-link-error]')?.innerText ?? ''`;
      const confirm = '[data-wb-library-confirm]';
      try {
        await openPanel(p);

        // Only https:// links, refused before anything is asked for.
        await linkTo('http://shapes.example.com/packs/Network%20pack.zip');
        assert.ok(await p.waitFor(`(${linkError}) === 'Only https:// links can be added.'`, 3000), 'an http:// link is refused');
        assert.equal(asked.length, 0, 'nothing was fetched');

        // A site that does not let other pages read it: say so, and point to adding the file.
        await linkTo(site + 'closed.shapes.json');
        assert.ok(await p.waitFor(`(${linkError}).includes('could not be read from this page')`, 20000), 'a link the page cannot read is explained');
        assert.ok((await p.evaluate(linkError)).includes('Download the file and add it with “From a file…”'), 'and the way around it is named');
        assert.ok(!await p.evaluate(`!!document.querySelector('${confirm}')`));

        // A missing file names the status.
        await linkTo(site + 'gone.zip');
        assert.ok(await p.waitFor(`(${linkError}).includes('The link answered with status 404.')`, 20000), 'a failed status is named');

        // A readable link: asked about first, nothing stored until Add.
        await linkTo(site + 'packs/Network%20pack.zip');
        assert.ok(await p.waitFor(`!!document.querySelector('${confirm}')`, 20000), 'the panel asks before adding');
        const text = await p.evaluate(`document.querySelector('${confirm}').innerText`);
        assert.ok(text.includes('From shapes.example.com'), 'it says where the library came from');
        assert.ok(text.includes('“Network pack”: 2 shapes will be added.'), 'and what it holds');
        await clickOn(p, `[...document.querySelectorAll('${confirm} button')].find(b => b.textContent === 'Cancel')`);
        assert.ok(await p.waitFor(`!document.querySelector('${confirm}')`, 3000));
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.deepEqual(libraries(board), [], 'Cancel adds nothing');
        assert.equal(await p.evaluate(`${cells}.length`), 0);

        await linkTo(site + 'packs/Network%20pack.zip');
        assert.ok(await p.waitFor(`!!document.querySelector('${confirm}')`, 20000));
        await clickOn(p, `[...document.querySelectorAll('${confirm} button')].find(b => b.textContent === 'Add')`);
        assert.ok(await p.waitFor(`${cells}.length === 2`, 10000), 'Add lists the shapes');
        assert.ok(await until(() => libraries(board).length === 1));
        const [entry] = libraries(board);
        assert.equal(entry.name, 'Network pack');
        assert.equal(entry.source, site + 'packs/Network%20pack.zip', 'the link is kept as where the library came from');
        assert.ok(asked.every(request => !request.cookie && !request.referer), 'links are fetched with no cookies and no referrer');
        const linkProblems = p.problems.filter(problem => !problem.includes('shapes.example.com'));
        assert.deepEqual(linkProblems, []);
      } finally {
        stop();
        await p.close();
      }
    });

    /** Types into the panel's search box. */
    async function typeIntoSearch(p, text) {
      await clickOn(p, `document.querySelector('${panel} input[role="searchbox"]')`);
      await p.type(text);
    }

    /** A zip of `[name, text]` entries, each deflated. */
    function zipOf(entries) {
      const locals = [], centrals = [];
      let offset = 0;
      for (const [entryName, text] of entries) {
        const raw = Buffer.from(text), body = zlib.deflateRawSync(raw), name = Buffer.from(entryName);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
        local.writeUInt32LE(zlib.crc32(raw), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
        central.writeUInt32LE(zlib.crc32(raw), 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
        locals.push(local, name, body);
        centrals.push(central, name);
        offset += 30 + name.length + body.length;
      }
      const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
      return Buffer.concat([...locals, directory, end]);
    }

    /** A draw.io library: an SVG picture, an SVG picture in a compressed graph, and a stencil boards cannot read. */
    function drawioLibrary() {
      const base64 = text => Buffer.from(text).toString('base64');
      const graph = style => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="" style="${style}" vertex="1" parent="1"><mxGeometry width="48" height="48" as="geometry"/></mxCell></root></mxGraphModel>`;
      const packed = xml => zlib.deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString('base64');
      const entries = [
        { data: `data:image/svg+xml;base64,${base64(shapeSvg('Firewall'))}`, w: 48, h: 48, title: 'Firewall' },
        { xml: packed(graph(`shape=image;aspect=fixed;image=data:image/svg+xml,${base64(shapeSvg('Switch'))};`)), w: 48, h: 48 },
        { xml: packed(graph('shape=mxgraph.aws4.lambda;fillColor=#F78E04;')), w: 48, h: 48, title: 'Lambda' },
      ];
      return `<mxlibrary>${JSON.stringify(entries)}</mxlibrary>`;
    }
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

  describe('pen and touch', { skip: noBrowser }, () => {
    let board, boardUrl;
    const elementsDir = () => path.join(board, 'db/elements');
    const stored = () => fs.readdirSync(elementsDir()).map(n => JSON.parse(fs.readFileSync(path.join(elementsDir(), n))));

    before(async () => {
      board = tmpDir('whiteboard-pen');
      const elements = {
        left: { type: 'shape', kind: 'rect', x: 0, y: 0, w: 80, h: 60, color: 'blue', text: 'Left' },
        right: { type: 'shape', kind: 'rect', x: 120, y: 0, w: 80, h: 60, color: 'green', text: 'Right' },
        far: { type: 'shape', kind: 'rect', x: 420, y: 260, w: 80, h: 60, color: 'red', text: 'Far' },
        scribble: { type: 'stroke', x: 300, y: 0, points: [0, 0, 60, 20, 120, 0], color: 'ink', width: 4 },
      };
      for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(board, sub), { recursive: true });
      fs.writeFileSync(path.join(board, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Pen board', order: Object.keys(elements) }));
      for (const [id, el] of Object.entries(elements)) fs.writeFileSync(path.join(elementsDir(), id + '.json'), JSON.stringify(el));
      ({ url: boardUrl } = await run.json(['open', board, '--type', 'whiteboard', '--json']));
    });
    after(async () => { await run?.run(['stop', board]); });

    // A stylus on a touch screen: Chrome reports maxTouchPoints > 0 and pointerType "pen".
    const open = async () => {
      const p = await browser.load(boardUrl, { ready });
      await p.cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await p.cdp('Page.reload', {});
      assert.ok(await p.waitFor(ready));
      assert.ok(await p.waitFor('navigator.maxTouchPoints > 0'));
      return p;
    };
    const pen = (p, type, x, y, extra = {}) => p.cdp('Input.dispatchMouseEvent', {
      type, x, y, pointerType: 'pen', button: type === 'mouseMoved' ? 'none' : 'left',
      buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, force: 0.5, ...extra,
    });
    const centre = (p, selector) => p.evaluate(`(() => {const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];})()`);
    const box = (p, id) => p.evaluate(`(() => {const r = document.querySelector('[data-wb-id="${id}"]').getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height};})()`);

    it('stores the widths of a stroke drawn with pressure', async () => {
      const p = await open();
      try {
        await p.click(...await centre(p, '[aria-label="Board tools"] button[aria-label="Draw"]'));
        const before = stored().filter(el => el.type === 'stroke').length;
        const far = await box(p, 'far');
        const x = far.x - 160, y = far.y + far.h + 40;
        await pen(p, 'mousePressed', x, y, { force: 0.1 });
        for (let i = 1; i <= 12; i++) await pen(p, 'mouseMoved', x + i * 8, y + (i % 3) * 4, { buttons: 1, force: Math.min(1, 0.1 + i * 0.08) });
        await pen(p, 'mouseReleased', x + 96, y, { force: 0 });
        assert.ok(await until(() => stored().filter(el => el.type === 'stroke').length === before + 1), 'the stroke was saved');
        const drawn = stored().filter(el => el.type === 'stroke' && el.widths !== undefined);
        assert.equal(drawn.length, 1, 'only the new stroke has widths');
        assert.equal(drawn[0].widths.length, drawn[0].points.length / 2, 'one width per point');
        assert.match(drawn[0].widths, /^[0-9a-z]+$/);
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('clicks a toolbar button once for a stylus tap and still takes mouse clicks after it', async () => {
      const p = await open();
      try {
        await p.evaluate(`window.__penClicks = 0; document.addEventListener('click', e => { if (e.target.closest('[aria-label="Board tools"] button')) window.__penClicks++; }, true)`);
        const [x, y] = await centre(p, '[aria-label="Board tools"] button[aria-label="Text"]');
        await pen(p, 'mouseMoved', x, y, { buttons: 0 });
        await pen(p, 'mousePressed', x, y);
        await pen(p, 'mouseReleased', x, y);
        assert.ok(await p.waitFor('window.__penClicks >= 1', 2000), 'the tap clicked the button');
        await new Promise(resolve => setTimeout(resolve, 900));
        assert.equal(await p.evaluate('window.__penClicks'), 1, 'one click for one tap');
        await p.click(x, y);
        assert.ok(await p.waitFor('window.__penClicks === 2', 2000), 'a mouse click still lands');
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('selects what a stylus loops around on the empty board', async () => {
      const p = await open();
      try {
        const left = await box(p, 'left');
        const right = await box(p, 'right');
        const x0 = left.x - 20, y0 = left.y - 20, x1 = right.x + right.w + 20, y1 = right.y + right.h + 20;
        const loop = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0 + 4]];
        await pen(p, 'mouseMoved', x0, y0, { buttons: 0 });
        await pen(p, 'mousePressed', x0, y0);
        for (let i = 1; i < loop.length; i++) {
          const [ax, ay] = loop[i - 1], [bx, by] = loop[i];
          for (let s = 1; s <= 8; s++) await pen(p, 'mouseMoved', ax + (bx - ax) * s / 8, ay + (by - ay) * s / 8, { buttons: 1 });
        }
        await pen(p, 'mouseReleased', x0, y0 + 4);
        assert.ok(await p.waitFor("document.querySelector('.wb-announcer')?.textContent.includes('2 items selected')", 3000),
          await p.evaluate("document.querySelector('.wb-announcer')?.textContent ?? ''"));
        assert.ok(await p.waitFor("document.querySelector('.wb-sel-frame')", 3000));
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('rubs a stroke out with the stylus eraser', async () => {
      const p = await open();
      try {
        assert.ok(stored().some(el => el.type === 'stroke' && el.points.length === 6), 'the scribble is there');
        const s = await box(p, 'scribble');
        const x = s.x + s.w / 2, y0 = s.y - 30, y1 = s.y + s.h + 30;
        // The input domain has no eraser button, so the eraser end's events are made in the page.
        await p.evaluate(`(() => {
          const send = (type, y, button, buttons) => document.elementFromPoint(${x}, y).dispatchEvent(new PointerEvent(type,
            { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: ${x}, clientY: y, button, buttons, pressure: 0.5 }));
          send('pointerdown', ${y0}, 5, 32);
          for (let i = 1; i <= 10; i++) send('pointermove', ${y0} + (${y1} - ${y0}) * i / 10, -1, 32);
          send('pointerup', ${y1}, 5, 0);
        })()`);
        assert.ok(await until(() => !fs.existsSync(path.join(elementsDir(), 'scribble.json'))), 'the scribble was erased');
        assert.ok(fs.existsSync(path.join(elementsDir(), 'far.json')), 'nothing else was erased');
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });
  });

  describe('text, menus and keys', { skip: noBrowser }, () => {
    let board, boardUrl, entry;
    const longText = 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
    const els = {
      cut: { type: 'shape', kind: 'rect', x: 0, y: 0, w: 120, h: 60, color: 'white', text: longText },
      under: { type: 'shape', kind: 'rect', x: 0, y: 70, w: 120, h: 40, color: 'blue', text: 'Below' },
      other: { type: 'shape', kind: 'rect', x: 0, y: 260, w: 120, h: 60, color: 'green', text: 'Other' },
    };
    const byId = id => `document.querySelector('#wb-${id}')`;
    const selection = p => p.evaluate('window.__openArtifactWhiteboard.state().selection');
    /** One key down and up through DevTools (`mods`: 2 Ctrl, 4 Meta, 8 Shift). */
    const key = async (p, { key: name, code, keyCode, mods = 0, text }) => {
      await p.cdp('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: name, code, windowsVirtualKeyCode: keyCode, modifiers: mods, text });
      await p.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: keyCode, modifiers: mods });
    };
    const selectOnly = async (p, id) => {
      await p.press('Escape');
      await clickOn(p, byId(id));
      assert.ok(await p.waitFor(`JSON.stringify(window.__openArtifactWhiteboard.state().selection) === '["${id}"]'`, 5000), `${id} selected`);
    };
    const fresh = async () => {
      const p = await browser.load(entry, { ready });
      assert.ok(await p.waitFor(`${byId('cut')} && ${byId('other')}`, 10000));
      return p;
    };

    before(async () => {
      board = tmpDir('whiteboard-text-keys');
      for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(board, sub), { recursive: true });
      ({ url: boardUrl } = await run.json(['open', board, '--type', 'whiteboard', '--json']));
      const all = { ...els, embed: { type: 'html', x: 400, y: 0, w: 320, h: 200,
        html: `<!doctype html><title>Links</title><a href="${new URL('/elsewhere', boardUrl).href}" style="display:block;height:100vh;font-size:32px">Go elsewhere</a>` } };
      fs.writeFileSync(path.join(board, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Text and keys', order: Object.keys(all) }));
      for (const [id, el] of Object.entries(all)) fs.writeFileSync(path.join(board, 'db/elements', id + '.json'), JSON.stringify(el));
      const at = new URL(boardUrl);
      at.searchParams.set('open_artifact_bench', '1');
      entry = at.href;
    });
    after(async () => { await run.run(['stop', board]); });

    it('pans the board with a right-button drag, keeping the selection and opening no menu; a right-click still opens the menu', async () => {
      const p = await fresh();
      const camera = () => p.evaluate('window.__openArtifactWhiteboard.state().camera');
      const centre = id => p.evaluate(`(() => { const r = ${byId(id)}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      try {
        await selectOnly(p, 'cut');
        const start = await camera();
        // Pressed on another shape: a right-click there would select it for its menu.
        const from = await centre('other');
        await p.dragMouse(from, [from[0] + 120, from[1] - 60], { button: 'right' });
        // The camera is the board point at the view's corner: the board follows the pointer, so it goes the other way.
        assert.ok(await p.waitFor(`(c => Math.abs(c.x - ${start.x - 120 / start.zoom}) <= 2 && Math.abs(c.y - ${start.y + 60 / start.zoom}) <= 2)(window.__openArtifactWhiteboard.state().camera)`, 5000),
          `the camera went from ${JSON.stringify(start)} to ${JSON.stringify(await camera())}`);
        assert.equal((await camera()).zoom, start.zoom);
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.equal(await p.evaluate(`Boolean(document.querySelector('[role="menu"]'))`), false, 'a menu opened after the drag');
        assert.deepEqual(await selection(p), ['cut'], 'the drag changed the selection');
        assert.equal(await p.evaluate(`document.querySelector('[data-testid="board-surface"]').hasAttribute('data-wb-grabbing')`), false, 'the board stayed grabbed');

        // Without travel, it is a right-click: the shape under the pointer is selected and its menu opens.
        await p.rightClick(...await centre('other'));
        assert.ok(await p.waitFor(`document.querySelector('[role="menu"] [role="menuitem"]')`, 5000), 'a right-click opened no menu');
        assert.deepEqual(await selection(p), ['other']);
        await p.press('Escape');
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('clips a shape too small for its words and shows them all on a card while it is selected', async () => {
      const p = await fresh();
      try {
        const text = `${byId('cut')}.querySelector('.wb-shape-text')`;
        const look = `(() => { const t = ${text}; const s = getComputedStyle(t); const card = getComputedStyle(t, '::before');
          return { clamp: s.webkitLineClamp, clipped: t.scrollHeight > t.clientHeight + 1, card: card.content !== 'none' && card.display !== 'none',
            open: ${byId('cut')}.hasAttribute('data-wb-open'), h: ${byId('cut')}.getBoundingClientRect().height }; })()`;
        assert.ok(await p.waitFor(`document.fonts.status === 'loaded'`, 10000));
        const shut = await p.evaluate(look);
        assert.notEqual(shut.clamp, 'none', 'the words are cut to the lines that fit');
        assert.equal(shut.clipped, true);
        assert.equal(shut.card, false);
        assert.deepEqual((await p.evaluate(`window.__openArtifactWhiteboard.elements(['cut'])`))[0].h, 60, 'the shape did not grow over its neighbor');
        await selectOnly(p, 'cut');
        const open = await p.evaluate(look);
        assert.equal(open.open, true);
        assert.equal(open.clamp, 'none', 'all the words show');
        assert.equal(open.card, true, 'a card holds the words that run past the shape');
        assert.ok(await p.evaluate(`document.querySelector('.wb-sel-frame[data-bare]') !== null`), 'the selection outline gives way to the card');
        await p.press('Escape');
        assert.ok(await p.waitFor(`!${byId('cut')}.hasAttribute('data-wb-open') && getComputedStyle(${text}).webkitLineClamp !== 'none'`, 5000));
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('keeps a picture panel open on a touch screen until a file is chosen', async () => {
      const p = await fresh();
      const picture = path.join(tmpDir('whiteboard-pick'), 'dot.png');
      fs.writeFileSync(picture, bytes);
      const panel = `document.querySelector('[aria-label="Search stickers"]')`;
      const openPanel = async () => {
        await clickOn(p, `document.querySelector('[aria-label="Board tools"] button[aria-label="Stickers"]')`);
        assert.ok(await p.waitFor(`${panel} && document.querySelector('[aria-label="Upload a picture"]')`, 5000), 'the sticker panel is open');
      };
      try {
        await p.cdp('Page.setInterceptFileChooserDialog', { enabled: true });
        await openPanel();
        await clickOn(p, `document.querySelector('[aria-label="Upload a picture"]')`);
        assert.ok(await p.waitFor(`!${panel}`, 5000), 'with a mouse the panel closes at once');
        await p.cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        assert.ok(await p.waitFor(`matchMedia('(any-pointer: coarse)').matches`, 5000));
        await openPanel();
        await clickOn(p, `document.querySelector('[aria-label="Upload a picture"]')`);
        await new Promise(resolve => setTimeout(resolve, 400));
        assert.ok(await p.evaluate(`${panel} !== null`), 'on touch the panel waits for the picker');
        const before = (await p.evaluate('window.__openArtifactWhiteboard.state()')).elements;
        const { result } = await p.cdp('Runtime.evaluate', { expression: `document.querySelector('input[type="file"]')` });
        await p.cdp('DOM.setFileInputFiles', { files: [picture], objectId: result.objectId });
        assert.ok(await p.waitFor(`!${panel} && window.__openArtifactWhiteboard.state().elements === ${before + 1}`, 10000), 'a chosen file closes it and lands on the board');
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('keeps an embed running when a link in it is clicked', async () => {
      const p = await fresh();
      try {
        assert.ok(await p.waitFor(`${byId('embed')}?.querySelector('iframe')`, 10000));
        await clickOn(p, `${byId('embed')}.querySelector('.wb-html-tab')`);
        assert.ok(await p.waitFor(`${byId('embed')}.hasAttribute('data-wb-live')`, 5000));
        const [left, top, width, height] = await p.evaluate(`(({ left, top, width, height }) => [left, top, width, height])(${byId('embed')}.querySelector('iframe').getBoundingClientRect())`);
        for (const shift of [false, true]) await p.click(left + width / 2, top + height / 2, { shift });
        await new Promise(resolve => setTimeout(resolve, 1500));
        assert.ok(await p.evaluate(`${byId('embed')}.querySelector('.wb-html-stopped') === null && ${byId('embed')}.querySelector('iframe') !== null`), 'the embed was not stopped');
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('reads shortcut letters as typed on Latin layouts and by place on others', async () => {
      const p = await fresh();
      try {
        const mods = (await p.evaluate(`/Mac|iPhone|iPad/.test(navigator.platform)`)) ? 4 : 2;
        await selectOnly(p, 'other');
        await key(p, { key: 'q', code: 'KeyA', keyCode: 81, mods });
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.deepEqual(await selection(p), ['other'], 'Q on a layout that puts it where A is selects nothing more');
        await key(p, { key: 'ф', code: 'KeyA', keyCode: 65, mods });
        assert.ok(await p.waitFor(`(({ selection, elements }) => elements > 1 && selection.length === elements)(window.__openArtifactWhiteboard.state())`, 5000), 'the A key on a Cyrillic layout selects all');
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('leaves Escape to the input method while it composes', async () => {
      const p = await fresh();
      try {
        const search = `document.querySelector('[aria-label="Search stickers"]')`;
        await clickOn(p, `document.querySelector('[aria-label="Board tools"] button[aria-label="Stickers"]')`);
        assert.ok(await p.waitFor(search, 5000));
        await p.evaluate(`${search}.focus()`);
        await key(p, { key: 'Escape', code: 'Escape', keyCode: 229 });
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.ok(await p.evaluate(`${search} !== null`), 'an Escape the input method takes leaves the panel open');
        await key(p, { key: 'Escape', code: 'Escape', keyCode: 27 });
        assert.ok(await p.waitFor(`!${search}`, 5000), 'a plain Escape closes it');
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('puts focus on the first item of a context menu opened from the keyboard', async () => {
      const p = await fresh();
      const focusedItem = `document.activeElement?.getAttribute('role')?.startsWith('menuitem') === true`;
      try {
        await selectOnly(p, 'other');
        await key(p, { key: 'F10', code: 'F10', keyCode: 121, mods: 8 });
        assert.ok(await p.waitFor(`document.querySelector('[role="menu"]')`, 5000), 'Shift+F10 opens the menu');
        assert.ok(await p.waitFor(focusedItem, 2000), 'its first item has focus');
        await p.press('Escape');
        assert.ok(await p.waitFor(`!document.querySelector('[role="menu"]')`, 5000));
        await p.evaluate(`document.querySelector('button[aria-label="More actions"]').focus()`);
        await p.press('Enter');
        assert.ok(await p.waitFor(`document.querySelector('[role="menu"]')`, 5000), 'Enter on More actions opens the menu');
        assert.ok(await p.waitFor(focusedItem, 2000), 'its first item has focus');
        await p.press('Escape');
        assert.ok(await p.waitFor(`!document.querySelector('[role="menu"]')`, 5000));
        const more = `document.querySelector('button[aria-label="More actions"]')`;
        await clickOn(p, more);
        assert.ok(await p.waitFor(`document.querySelector('[role="menu"]')`, 5000));
        await new Promise(resolve => setTimeout(resolve, 200));
        assert.equal(await p.evaluate(focusedItem), false, 'a click leaves focus where Base UI puts it');
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });
  });

  describe('drawing layers', { skip: noBrowser }, () => {
    let board, boardUrl;
    const file = () => path.join(board, 'db/elements/scene.json');
    const svgOf = () => {
      const src = JSON.parse(fs.readFileSync(file())).src;
      const comma = src.indexOf(',');
      return src.slice(0, comma).endsWith(';base64') ? Buffer.from(src.slice(comma + 1), 'base64').toString() : decodeURIComponent(src.slice(comma + 1));
    };
    const layers = () => [...svgOf().matchAll(/<g\b[^>]*?\bid=["']([^"']+)/g)].map(m => m[1]);
    const heard = (p, text) => p.waitFor(`(document.querySelector('.wb-announcer')?.textContent ?? '').includes(${JSON.stringify(text)})`, 3000);
    const mod = process.platform === 'darwin' ? { meta: true } : { ctrl: true };

    const SCENE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240">'
      + '<g id="sky_wash"><rect width="400" height="240" fill="#bfdbfe" fill-opacity=".5"/></g>'
      + '<g id="green-hill"><path d="M0 240 L0 120 Q200 20 400 120 L400 240 Z" fill="#16a34a"/></g>'
      + '<g id="sun"><circle cx="300" cy="80" r="30" fill="#facc15"/></g></svg>';
    const writeScene = (dir, svg) => fs.writeFileSync(path.join(dir, 'db/elements/scene.json'), JSON.stringify({ type: 'image', x: 0, y: 0, w: 400, h: 240, style: 'watercolor', src: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') }));
    const openScene = async (name) => {
      const dir = tmpDir(name);
      for (const sub of ['db/elements', 'db/board']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
      fs.writeFileSync(path.join(dir, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Layers', order: ['scene'] }));
      writeScene(dir, SCENE_SVG);
      const { url } = await run.json(['open', dir, '--type', 'whiteboard', '--json']);
      return { dir, url };
    };
    /** Opens the scene and picks its sun with a double-click. */
    const pickSun = async (url) => {
      const p = await browser.load(url, { ready });
      const img = "document.querySelector('[data-wb-id=\"scene\"] img')";
      assert.ok(await p.waitFor(`${img}?.src.startsWith('blob:') && ${img}.naturalWidth > 0`, 15000), 'the watercolor look is painted');
      const r = await p.evaluate(`(() => {const r = document.querySelector('[data-wb-id="scene"]').getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height};})()`);
      await p.clickTimes(r.x + (300 * r.w) / 400, r.y + (80 * r.h) / 240, 2);
      assert.ok(await p.waitFor("document.querySelector('[data-wb-layer-frame]')", 3000), 'the sun is picked');
      return { p, img };
    };
    const center = (p, selector) => p.evaluate(`(() => {const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];})()`);

    before(async () => {
      ({ dir: board, url: boardUrl } = await openScene('whiteboard-layers'));
    });
    after(async () => { await run?.run(['stop', board]); });

    it('picks a layer with a double-click, moves and hides it, keeps the painting meanwhile, and undoes each', async () => {
      const p = await browser.load(boardUrl, { ready });
      const img = "document.querySelector('[data-wb-id=\"scene\"] img')";
      try {
        assert.ok(await p.waitFor(`${img}?.src.startsWith('blob:') && ${img}.naturalWidth > 0`, 15000), 'the watercolor look is painted');
        const r = await p.evaluate(`(() => {const r = document.querySelector('[data-wb-id="scene"]').getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height};})()`);
        const sun = [r.x + (300 * r.w) / 400, r.y + (80 * r.h) / 240];
        await p.clickTimes(...sun, 2);
        assert.ok(await p.waitFor("document.querySelector('[data-wb-layer-frame]')", 3000), 'the picked layer is framed');
        assert.ok(await heard(p, 'Sun\u2069, layer 3 of 3, selected'), 'the picked layer is announced');
        assert.equal(await p.evaluate("document.querySelector('[data-wb-layer-name]')?.getAttribute('aria-label')"), 'Layer: \u2068Sun\u2069');
        assert.equal(await p.evaluate("document.querySelectorAll('.wb-handle, .wb-turn-knob').length"), 0, 'no handles on a picked layer');

        await p.evaluate(`(() => {
          const node = ${img};
          window.__flat = [];
          new MutationObserver(() => { if (!node.src.startsWith('blob:')) window.__flat.push(node.src.slice(0, 30)); }).observe(node, { attributes: true, attributeFilter: ['src'] });
          window.__firstPaint = node.src;
        })()`);
        const backward = await p.evaluate(`(() => {const r = document.querySelector('[data-wb-layer-action="backward"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];})()`);
        await p.click(...backward);
        assert.ok(await until(() => layers().join() === 'sky_wash,sun,green-hill'), `saved order ${layers()}`);
        assert.ok(await p.waitFor(`${img}.src !== window.__firstPaint && ${img}.src.startsWith('blob:')`, 15000), 'the new painting arrives');
        assert.deepEqual(await p.evaluate('window.__flat'), [], 'the old painting shows until the new one is ready');
        assert.ok(await p.waitFor("document.querySelector('[data-wb-layer-frame]')", 3000), 'the moved layer stays picked');

        await p.press('z', mod);
        assert.ok(await until(() => layers().join() === 'sky_wash,green-hill,sun'), `undone order ${layers()}`);

        await p.evaluate('document.activeElement?.blur()');
        await p.press('Escape');
        assert.ok(await p.waitFor("!document.querySelector('[data-wb-layer-frame]') && !!document.querySelector('.wb-sel-frame')", 3000), 'the whole drawing stays selected');
        assert.ok(await heard(p, 'Whole drawing selected'));

        await p.press('Enter');
        assert.ok(await p.waitFor("document.querySelector('[data-wb-layer-frame]')", 3000), 'Enter picks a layer');
        const picked = await p.evaluate("document.querySelector('[data-wb-layer-name]')?.getAttribute('aria-label')");
        await p.press('Backspace');
        assert.ok(await until(() => /<g\b[^>]*opacity='0'/.test(svgOf())), 'Delete hides the layer');
        assert.ok(fs.existsSync(file()), 'the drawing is kept');
        assert.ok(await p.waitFor("!document.querySelector('[data-wb-layer-frame]') && !!document.querySelector('.wb-sel-frame')", 3000));
        assert.ok(picked?.startsWith('Layer: '));
        await p.press('Backspace');
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.ok(fs.existsSync(file()), 'the Delete right after a hide does not delete the drawing');
        await p.press('z', mod);
        assert.ok(await until(() => !/opacity='0'/.test(svgOf())), 'undo shows the layer again');
        assert.deepEqual(p.problems, []);
      } finally { await p.close(); }
    });

    it('undoes a layer move on that layer alone, keeping a change made on disk since', async () => {
      const { dir, url } = await openScene('whiteboard-layer-undo');
      const read = () => {
        const src = JSON.parse(fs.readFileSync(path.join(dir, 'db/elements/scene.json'))).src;
        const comma = src.indexOf(',');
        return src.slice(0, comma).endsWith(';base64') ? Buffer.from(src.slice(comma + 1), 'base64').toString() : decodeURIComponent(src.slice(comma + 1));
      };
      const order = () => [...read().matchAll(/<g\b[^>]*?\bid=["']([^"']+)/g)].map(m => m[1]).join();
      const { p, img } = await pickSun(url);
      try {
        await p.click(...await center(p, '[data-wb-layer-action="backward"]'));
        assert.ok(await until(() => order() === 'sky_wash,sun,green-hill'), `saved order ${order()}`);
        await p.evaluate(`window.__beforeDisk = ${img}.src`);
        // Another hand hides the sky on disk while the move is the page's last step.
        writeScene(dir, read().replace('<g id="sky_wash">', `<g opacity='0' id="sky_wash">`));
        assert.ok(await p.waitFor(`${img}.src !== window.__beforeDisk && ${img}.src.startsWith('blob:')`, 15000), 'the page shows the change from disk');
        await p.evaluate('document.activeElement?.blur()');
        await p.press('z', mod);
        assert.ok(await until(() => order() === 'sky_wash,green-hill,sun'), `undone order ${order()}`);
        assert.match(read(), /<g opacity='0' id="sky_wash">/, 'the sky hidden on disk stays hidden');
        await p.press('z', { ...mod, shift: true });
        assert.ok(await until(() => order() === 'sky_wash,sun,green-hill'), `redone order ${order()}`);
        assert.match(read(), /<g opacity='0' id="sky_wash">/);
        assert.deepEqual(p.problems, []);
      } finally {
        await p.close();
        await run.run(['stop', dir]);
      }
    });

    it('goes back to the picked layer with Escape from the layer buttons, and to the drawing after Hide', async () => {
      const { dir, url } = await openScene('whiteboard-layer-escape');
      const { p } = await pickSun(url);
      const onBoard = "document.activeElement?.classList.contains('wb-surface') === true";
      try {
        await p.click(...await center(p, '[data-wb-layer-action="backward"]'));
        assert.ok(await p.waitFor("document.activeElement?.closest('[data-wb-region=\"selection\"]') != null", 3000), 'Move keeps the keyboard on its button');
        await p.evaluate("document.querySelector('.wb-announcer').textContent = ''");
        await p.press('Escape');
        assert.ok(await p.waitFor(onBoard, 3000), 'Escape goes back to the board');
        assert.ok(await p.waitFor("!!document.querySelector('[data-wb-layer-frame]')", 3000), 'the layer stays picked');
        assert.ok(await heard(p, 'Sun\u2069, layer 2 of 3, selected'), 'the picked layer is said again');
        await p.press('Escape');
        assert.ok(await p.waitFor("!document.querySelector('[data-wb-layer-frame]') && !!document.querySelector('.wb-sel-frame')", 3000), 'a second Escape ends picking, keeping the drawing selected');

        await p.press('Enter');
        assert.ok(await p.waitFor("!!document.querySelector('[data-wb-layer-action=\"hide\"]')", 3000));
        await p.click(...await center(p, '[data-wb-layer-action="hide"]'));
        assert.ok(await p.waitFor("!document.querySelector('[data-wb-layer-frame]')", 3000), 'Hide ends picking');
        assert.ok(await p.waitFor(onBoard, 3000), 'Hide sends the keyboard back to the drawing');
        await p.press('Escape');
        assert.ok(await p.waitFor("!document.querySelector('.wb-sel-frame')", 3000), 'Escape on the board clears the selection');
        assert.deepEqual(p.problems, []);
      } finally {
        await p.close();
        await run.run(['stop', dir]);
      }
    });
  });
});
