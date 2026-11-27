// Exercise the installed Slides editor and its global Shell and the files the Shell exports.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { crashes, findChrome, launch } from './lib/browser.mjs';
import { cli } from './lib/cli.mjs';
import { browserOff, install, removeTmp, skipFor, tmpDir, typePath } from './lib/target.mjs';
import { until } from './lib/http.mjs';

const rail = '[data-open-artifact-thumbs] [data-slide-index]';
const fileNames = ['cover', 'plan', 'end'];
const browserSkip = browserOff || !findChrome();
const inlineSlide = id => `document.querySelector('[data-open-artifact-inline-view] [data-open-artifact-slide="${id}"]')`;
const inlinePager = `document.querySelector('nav[aria-label="Slides"]')`;
const stageNode = at => `document.querySelector('[data-open-artifact-mode="edit"] [data-open-artifact-path="${at}"]')`;
/** What the editor last read out to screen readers. */
const announced = `document.querySelector('[role="status"][aria-atomic="true"]')?.textContent`;
/** How many elements the stage shows selected (one frame each). */
const selectedCount = `[...(document.querySelector('[data-open-artifact-overlay]')?.children ?? [])].filter(el => el.classList.contains('border-accent')).length`;
const resizeHandles = `document.querySelectorAll('[data-open-artifact-overlay] [style*="resize"]').length`;
const propertySections = `[...document.querySelectorAll('[data-open-artifact-properties] h3')].map(h => h.textContent)`;
const menuItem = label => `[...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.trim().startsWith(${JSON.stringify(label)}))`;
const middle = (page, element) => page.evaluate(`(() => { const r = (${element}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);

/**
 * Press a key with modifiers as a keyboard sends it: `code` is the key's place, `key` what it types in the current
 * layout. `mod` is Command on a Mac and Control elsewhere; `held` more presses come as the key repeating.
 */
async function chord(page, key, code, keyCode, { mod = false, alt = false, shift = false, ctrl = false, mac = true, held = 0 } = {}) {
  const modifiers = (alt ? 1 : 0) | (ctrl || (mod && !mac) ? 2 : 0) | (mod && mac ? 4 : 0) | (shift ? 8 : 0);
  const down = { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers };
  await page.cdp('Input.dispatchKeyEvent', down);
  for (let n = 0; n < held; n++) await page.cdp('Input.dispatchKeyEvent', { ...down, autoRepeat: true });
  await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
}

/** A page on an origin of its own that frames `src` (as a chat or a doc embeds a deck), running `script` beside it. */
async function framing(src, script = '') {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><script>${script}</script><iframe id="framed" src="${src}" style="width:800px;height:520px;border:0"></iframe>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }),
  };
}

describe('slides', { skip: skipFor('slides') }, () => {
  let run, root, downloads, url, publicUrl, browser, page, wrapped;
  before(async () => {
    const { dir } = install(typePath('slides'));
    const home = tmpDir('slides-home');
    downloads = path.join(home, 'Downloads');
    run = cli(dir, { HOME: home, OPEN_ARTIFACT_TYPE_SERVER_HOME: tmpDir('slides-state') });
    root = tmpDir('slides-deck');
    const project = path.join(root, 'project');
    fs.mkdirSync(path.join(project, 'slides'), { recursive: true });
    const brand = 'project/ds/fixture';
    fs.mkdirSync(path.join(root, brand), { recursive: true });
    fs.writeFileSync(path.join(root, brand, 'photo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#1870e0"/></svg>');
    fs.writeFileSync(path.join(project, 'deck.json'), JSON.stringify({
      v: 5, lists: 'css', size: '4:3', title: 'Quarterly review', order: fileNames, cover: 'cover',
      format: { v: 1, shared: ['project/deck.css'] }, createdOnFiles: { v: 1, at: '2026-11-15T00:00:00Z' },
      sections: {}, faces: {}, designSystems: [],
    }));
    fs.writeFileSync(path.join(project, 'deck.css'), 'section { background: #ffffff; padding: 128px; } h1 { color: #123456; } ' +
      '@property --total { syntax: "<number>"; inherits: false; initial-value: 0; } ' +
      '@keyframes count { from { --total: 0; } to { --total: 100; } } .metric { animation: count 2s ease-out both; } .gaps li { margin: 12px 0; } ' +
      ':root { --cut: 12px; } .chamfer { position:absolute; top:650px; height:160px; clip-path:polygon(0 0, calc(100% - var(--cut)) 0, 100% var(--cut), 100% 100%, 0 100%); } ' +
      '.polygon { position:absolute; top:850px; width:160px; height:160px; background:#2670a0; }');
    const contents = [
      '<h1>季度回顾</h1><div><p class="fragment">Details after a click</p></div><aside>Opening notes</aside>' +
        '<x-embed style="position:absolute;left:800px;top:600px;width:400px;height:200px"><canvas width="40" height="40"></canvas><script>document.body.style.background="#18aa44";const ctx=document.querySelector("canvas").getContext("2d");ctx.fillStyle="#1122ee";ctx.fillRect(0,0,40,40)</script></x-embed>',
      '<h1>Plan</h1><p class="metric">100%</p><p>Read through the shared sheet.</p>' +
        '<div class="chamfer" style="left:128px;width:160px;background:#2670a0"></div><div class="chamfer" style="left:320px;width:280px;background:#2670a0"></div>' +
        `<img class="chamfer" src="${brand}/photo.svg" alt="Clipped photo" style="left:632px;width:160px;object-fit:cover">` +
        '<div class="chamfer" style="left:824px;width:240px;background:#f3f1eb"><p style="font-size:24px">Clipped group</p></div>' +
        '<div class="polygon" style="left:128px;clip-path:polygon(50% 0, 100% 100%, 0 100%)"></div>' +
        '<div class="polygon" style="left:320px;clip-path:polygon(0 25%, 65% 25%, 65% 0, 100% 50%, 65% 100%, 65% 75%, 0 75%)"></div>',
      '<h1>Close</h1><ul class="gaps"><li>First step</li><li>Second step</li></ul>',
    ];
    for (const [i, id] of fileNames.entries()) fs.writeFileSync(path.join(project, 'slides', id + '.html'), `<section id="${id}">${contents[i]}</section>`);
    ({ url: publicUrl } = await run.json(['open', root, '--json']));
    url = new URL('index.html', publicUrl).href;
    if (!browserSkip) {
      browser = await launch();
      page = await browser.load(url, { ready: `document.querySelectorAll('${rail}').length === 3` });
    }
  });
  after(async () => {
    await browser?.close();
    await run?.run(['stop', root]);
    removeTmp();
  });

  it('checks a shared-CSS 4:3 deck with a live embed and an in-flow build', async () => {
    const checked = await run.run(['check', root]);
    assert.equal(checked.code, 0, checked.stdout);
  });

  it('reports the initial slide, preserves links across reordering, and follows historical page numbers', { skip: browserSkip }, async () => {
    assert.match(await page.evaluate('location.hash'), /^#slide-.+/);
    const count = await page.evaluate('history.length');
    const go = async hash => page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
    const showing = id => page.waitFor(`document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="${id}"]')`);
    const point = await page.evaluate(`(() => {
      const box = document.querySelectorAll('${rail}')[1].getBoundingClientRect();
      return [box.x + box.width / 2, box.y + box.height / 2];
    })()`);
    await page.click(...point);
    assert.ok(await showing('plan'));
    assert.equal(await page.evaluate('history.length'), count);
    const link = await page.evaluate('location.hash');
    const index = path.join(root, 'project/deck.json');
    const original = fs.readFileSync(index, 'utf8');
    try {
      fs.writeFileSync(index, JSON.stringify({ ...JSON.parse(original), order: ['end', 'cover', 'plan'] }));
      // Open the link in a fresh tab after the order changed on disk.
      const reopened = await browser.load(url + link, { ready: 'document.querySelector(\'[data-open-artifact-mode="edit"][data-open-artifact-slide="plan"]\')' });
      try { assert.deepEqual(reopened.problems, []); } finally { await reopened.close(); }
    } finally {
      fs.writeFileSync(index, original);
    }
    await page.cdp('Page.reload', { ignoreCache: true });
    assert.ok(await page.waitFor(`document.querySelectorAll('${rail}').length === 3`));
    await go('#slide-2');
    assert.ok(await showing('plan'));
    await go('#slide-1');
    assert.ok(await showing('cover'));
  });

  it('remembers the last slide and follows an external link while presenting', { skip: browserSkip }, async () => {
    const mac = await page.evaluate("navigator.platform.includes('Mac')");
    await page.press('Enter', { meta: mac, ctrl: !mac });
    assert.ok(await page.waitFor(`document.querySelector('[aria-label="Presentation"]')`));
    await page.press('ArrowRight');
    await page.press('ArrowRight');
    assert.ok(await page.waitFor("location.hash === '#slide-~plan'"));
    await page.evaluate("location.hash = '#slide-~end'");
    assert.ok(await page.waitFor(`!document.querySelector('[aria-label="Presentation"]') && document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="end"]')`));
    const reopened = await browser.load(url, { ready: `document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="end"]')` });
    try { assert.deepEqual(reopened.problems, []); } finally { await reopened.close(); }
    await page.evaluate("location.hash = '#slide-1'");
    assert.ok(await page.waitFor(`document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="cover"]')`));
  });

  it('opens one slide on its own from a .only link, pages whole slides, and returns to the editor', { skip: browserSkip }, async () => {
    const only = `document.querySelector('[data-presenter-only]')`;
    const alone = id => `${only}?.querySelector('[data-open-artifact-slide="${id}"]')`;
    const editing = id => `!${only} && document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="${id}"]')`;
    const viewer = await browser.load(url + '#slide-~cover.only', { ready: alone('cover') });
    try {
      assert.ok(await viewer.waitFor(`location.hash === '#slide-~cover.only.1.3' && /^Slide 1 of 3/.test(${only}.getAttribute('aria-label')) && ${only}.getAttribute('role') === 'group'`));
      assert.equal(await viewer.evaluate(`Boolean(document.querySelector('[data-presenter-controls]'))`), false);
      // Every build is shown at once.
      assert.ok(await viewer.waitFor(`[...${alone('cover')}.querySelectorAll('p')].some(p => p.textContent === 'Details after a click' && getComputedStyle(p).opacity === '1' && getComputedStyle(p).visibility === 'visible')`));
      await viewer.press('ArrowRight');
      assert.ok(await viewer.waitFor(`${alone('plan')} && location.hash === '#slide-~plan.only.2.3'`));
      await viewer.type('f');
      assert.ok(await viewer.waitFor(`!document.fullscreenElement && ${alone('plan')}`));
      await viewer.evaluate(`location.hash = '#slide-~end.only'`);
      assert.ok(await viewer.waitFor(`${alone('end')} && location.hash === '#slide-~end.only.3.3'`));
      await viewer.evaluate(`location.hash = '#slide-~plan'`);
      assert.ok(await viewer.waitFor(editing('plan')));
      // Back returns to the slide on its own.
      await viewer.evaluate('history.back()');
      assert.ok(await viewer.waitFor(`${alone('end')} && location.hash === '#slide-~end.only.3.3'`));
      await viewer.evaluate(`location.hash = '#slide-~gone.only'`);
      assert.ok(await viewer.waitFor(`${alone('end')} && location.hash === '#slide-~end.only.3.3'`));
      await viewer.press('Escape');
      assert.ok(await viewer.waitFor(`${editing('end')} && location.hash === '#slide-~end'`));
      assert.deepEqual(viewer.problems, []);
    } finally {
      await viewer.close();
    }
  });

  /** Picks `item` from the Share menu's Export tab of `shell` (the deck in the global frame by default). */
  async function chooseExport(item, shell) {
    shell ??= wrapped ??= await browser.load(publicUrl + '#slide-~cover', { ready: `document.querySelector('[data-comments-button]')` });
    const share = 'header button[aria-label="Share"]';
    await shell.evaluate(`document.querySelector('${share}').click()`);
    const exportTab = `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Export')`;
    assert.ok(await shell.waitFor(exportTab, 4000), await shell.evaluate('document.body.innerText'));
    await shell.evaluate(exportTab + '.click()');
    const choice = `[...document.querySelectorAll('[data-export-row]')].find(el => el.dataset.exportRow.includes(${JSON.stringify(item)}))`;
    assert.ok(await shell.waitFor(choice, 4000), await shell.evaluate('document.body.innerText'));
    await shell.evaluate(choice + '.click()');
  }

  /** Downloads `item`; with `dialog`, through its options dialog, which `inspect` may look at first. */
  async function download(item, ext, dialog = false, inspect = async () => {}) {
    const previous = new Set(fs.existsSync(downloads) ? fs.readdirSync(downloads) : []);
    await chooseExport(item);
    if (dialog) {
      const submit = `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Download')`;
      assert.ok(await wrapped.waitFor(submit));
      await inspect();
      if (dialog === 'notes') await wrapped.evaluateAll(`document.querySelector('[aria-label="Include speaker notes"]')?.click()`);
      await wrapped.evaluateAll(submit + '?.click()');
    }
    const file = () => fs.existsSync(downloads) && fs.readdirSync(downloads).find(name => name.endsWith(ext) && !previous.has(name));
    assert.ok(await until(file, 30000), await page.evaluate('document.body.innerText'));
    const saved = path.join(downloads, file());
    // Some formats explain which elements were converted.
    await wrapped.evaluateAll(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'OK')?.click()`);
    return saved;
  }

  it('returns cancellation to the global export menu for both option dialogs', { skip: browserSkip }, async () => {
    for (const item of ['PDF', 'Web page']) {
      await chooseExport(item);
      await wrapped.evaluate(`window.lastExport = null; window.addEventListener('message', e => {
        if (e.data?.openArtifact === 'chrome_export') window.lastExport = e.data.state;
      }, { signal: AbortSignal.timeout(5000) })`);
      const cancel = `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Cancel')`;
      assert.ok(await wrapped.waitFor(cancel));
      await wrapped.evaluateAll(cancel + '?.click()');
      assert.ok(await wrapped.waitFor("window.lastExport === 'declined'", 4000));
    }
  });

  it('exports a navigable HTML deck with the same build order', { skip: browserSkip }, async () => {
    const file = await download('Web page', '.html', true);
    const player = await browser.load(pathToFileURL(file).href, { ready: 'document.querySelector(".open-artifact-on")' });
    try {
      const visible = `getComputedStyle([...document.querySelectorAll('p')].find(p => p.textContent === 'Details after a click')).visibility`;
      assert.equal(await player.evaluate(visible), 'hidden');
      await player.press('ArrowRight');
      assert.equal(await player.evaluate(visible), 'visible');
      assert.equal(await player.evaluate('document.querySelector(".open-artifact-on").getAttribute("aria-label")'), 'Slide 1');
      await player.press('ArrowRight');
      assert.equal(await player.evaluate('location.hash'), '#2');
      assert.ok(await player.waitFor("Number.parseFloat(document.querySelector('[data-count]')?.textContent) < 100"));
      assert.ok(await player.waitFor("document.querySelector('[data-count]')?.textContent === '100%'"));
      assert.match(await player.evaluate(`getComputedStyle(document.querySelector('[aria-label="Clipped photo"]')).clipPath`), /calc\(100% - 12px\)/);
      await player.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      assert.ok(await player.waitFor("document.documentElement.classList.contains('open-artifact-reader')"));
      assert.equal(await player.evaluate(visible), 'visible');
      const rectangles = await player.evaluate("Array.from(document.querySelectorAll('.open-artifact-frame'), el => { const r = el.getBoundingClientRect(); return [r.top, r.height, r.width]; })");
      assert.ok(rectangles.every(([, height, width]) => Math.abs(height - width * 3 / 4) < 1), JSON.stringify(rectangles));
      assert.ok(rectangles[2][0] > rectangles[1][0] && rectangles[1][0] > rectangles[0][0]);
      await player.cdp('Emulation.clearDeviceMetricsOverride');
      assert.ok(await player.waitFor("!document.documentElement.classList.contains('open-artifact-reader')"));
      assert.deepEqual(player.problems, []);
    } finally { await player.close(); }
  });

  it('exports the rendered embed into the 4:3 PNG', { skip: browserSkip }, async () => {
    const file = await download('Current slide as image', '.png');
    const data = fs.readFileSync(file);
    assert.deepEqual([data.readUInt32BE(16), data.readUInt32BE(20)], [1440, 1080]);
    const pixels = await page.evaluate(`(async () => {
      const image = new Image(); image.src = 'data:image/png;base64,${data.toString('base64')}'; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d'); return [[900,650],[820,620]].map(([x,y]) => {
        ctx.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      });
    })()`);
    assert.deepEqual(pixels, [[24, 170, 68, 255], [17, 34, 238, 255]], await page.evaluate('document.body.innerText'));
  });
  it('downloads editable PowerPoint with East Asian text, notes and a 4:3 picture deck', { skip: browserSkip }, async () => {
    const xml = (file, name) => execFileSync('unzip', ['-p', file, name], { encoding: 'utf8' });
    for (const option of ['current fonts', 'basic fonts', 'slides as pictures']) {
      const file = await download('PowerPoint, ' + option, '.pptx');
      const first = xml(file, 'ppt/slides/slide1.xml');
      assert.match(first, /<p:pic>/);
      if (option !== 'slides as pictures') {
        assert.match(first, /<a:t>季度回顾<\/a:t>/);
        assert.match(first, /<a:ea typeface="Microsoft YaHei"/);
        // 12px between the items, and the 12px above the first and below the last inside the list's box.
        const list = [1, 2, 3].map(n => xml(file, `ppt/slides/slide${n}.xml`)).join('').match(/<p:sp>(?:(?!<\/p:sp>)[^])*?<a:t>Second step<\/a:t>[^]*?<\/p:sp>/)?.[0] ?? '';
        assert.match(list, /tIns="76200"[^>]*bIns="76200"/);
        assert.match(list, /<a:spcAft><a:spcPts val="600"\/><\/a:spcAft>[^]*?<a:t>First step/);
        const plan = xml(file, 'ppt/slides/slide2.xml');
        // Polygon clips: plain panels become custom shapes, the photo a picture cut to the polygon.
        const custom = [...plan.matchAll(/<p:sp>[^]*?<\/p:sp>/g)].map(([shape]) => shape).filter(shape => shape.includes('<a:custGeom>'));
        const vertices = shape => [...shape.matchAll(/<a:pt x="(-?\d+)" y="(-?\d+)"\/>/g)].map(([, x, y]) => [Number(x), Number(y)]);
        const cut = 12 * 6350;
        const widths = custom.map(shape => Number(/<a:path w="(\d+)"/.exec(shape)[1]))
          .filter((width, i) => custom[i].includes(`<a:lnTo><a:pt x="${width - cut}" y="0"/></a:lnTo>`) && custom[i].includes(`<a:pt x="${width}" y="${cut}"/>`));
        assert.deepEqual(widths.sort((a, b) => a - b), [160 * 6350, 280 * 6350]); // the same 12px cut on both widths
        const outlines = custom.map(shape => JSON.stringify(vertices(shape)));
        assert.ok(outlines.includes(JSON.stringify([[508000, 0], [1016000, 1016000], [0, 1016000]])), 'the triangle');
        assert.ok(outlines.includes(JSON.stringify([[0, 254000], [660400, 254000], [660400, 0], [1016000, 508000], [660400, 1016000], [660400, 762000], [0, 762000]])), 'the concave arrow');
        const pictures = [...plan.matchAll(/<p:pic>[^]*?<\/p:pic>/g)].map(([picture]) => picture);
        const photo = pictures.find(picture => picture.includes('descr="Clipped photo"')) ?? '';
        assert.match(photo, /<a:srcRect l="25000" t="0" r="25000" b="0"\/>/);
        assert.match(photo, new RegExp(`<a:custGeom>[^]*?<a:pt x="1016000" y="${cut}"`));
        assert.ok(pictures.some(picture => picture.includes('name="Clipped element 1"')));
        assert.doesNotMatch(plan, /<a:t>Clipped group<\/a:t>/);
      }
      assert.match(xml(file, 'ppt/notesSlides/notesSlide1.xml'), /Opening notes/);
      const size = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(xml(file, 'ppt/presentation.xml'));
      assert.equal(Number(size[1]) / Number(size[2]), 4 / 3);
    }
  });

  it('downloads a 4:3 PDF with a separate notes page', { skip: browserSkip }, async () => {
    const file = await download('PDF', '.pdf', 'notes');
    const pdf = fs.readFileSync(file).toString('latin1');
    assert.match(pdf, /^%PDF/);
    assert.match(pdf, /\/Count\s+4\b/);
    const boxes = [...pdf.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map(match => match[1].trim().split(/\s+/).map(Number));
    assert.deepEqual(boxes, Array(4).fill([0, 0, 720, 540]));
  });

  it('writes every picture of a web page into it, and says when Best would shrink them', { skip: browserSkip }, async () => {
    const file = await download('Web page', '.html', true, async () => {
      assert.ok(await wrapped.waitFor(`document.querySelector('[role="dialog"]')?.textContent.includes('200 MB')`), 'the Best quality help does not give the limit');
    });
    const html = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(html, /data:,open-artifact-file-/);
    const sources = [...html.matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/g)].map(match => match[1]);
    assert.ok(sources.length > 0, 'no picture in the page');
    assert.ok(sources.every(src => src.startsWith('data:image/')), sources.map(src => src.slice(0, 60)).join('\n'));
  });

  it('previews a historical slide and restores that slide from the editor', { skip: browserSkip }, async () => {
    const file = path.join(root, 'project/slides/cover.html');
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, original.replace('季度回顾', 'Updated cover'));
    const showing = text => `document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="cover"]')?.textContent.includes(${JSON.stringify(text)})`;
    assert.ok(await page.waitFor(showing('Updated cover')));
    await page.evaluate(`document.querySelector('button[aria-label="Version history"]').click()`);
    const versions = '[role="dialog"] button[aria-expanded]';
    assert.ok(await page.waitFor(`document.querySelectorAll('${versions}').length > 1`));
    // The original version holds every file in the deck.
    await page.evaluate(`[...document.querySelectorAll('${versions}')].at(-1).click()`);
    const button = label => `[...document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
    assert.ok(await page.waitFor(button('Preview')));
    await page.evaluate(button('Preview') + '.click()');
    assert.ok(await page.waitFor(`document.querySelector('[aria-label="Read-only slide preview"]')?.innerText.includes('季度回顾')`));
    const restore = `document.querySelector('[aria-label^="Restore "][aria-label*="cover"]')`;
    assert.ok(await page.waitFor(restore));
    await page.evaluate(restore + '.click()');
    assert.ok(await page.waitFor(button('Restore')));
    await page.evaluate(button('Restore') + '.click()');
    assert.ok(await until(() => fs.readFileSync(file, 'utf8') === original));
    await page.press('Escape');
    assert.ok(await page.waitFor(showing('季度回顾')));
  });

  it('edits source text on the stage, saves the same HTML and undoes the change', { skip: browserSkip }, async () => {
    const file = path.join(root, 'project/slides/plan.html');
    const original = fs.readFileSync(file, 'utf8');
    await page.evaluate("location.hash = '#slide-2'");
    const heading = '[data-open-artifact-mode="edit"][data-open-artifact-slide="plan"] h1';
    assert.ok(await page.waitFor(`document.querySelector('${heading}')`));
    const point = await page.evaluate(`(() => {
      const box = document.querySelector('${heading}').getBoundingClientRect();
      return [box.x + 24, box.y + box.height / 2];
    })()`);
    await page.clickTimes(...point, 2);
    assert.ok(await page.waitFor(`document.activeElement?.isContentEditable`));
    const mac = await page.evaluate("navigator.platform.includes('Mac')");
    await page.press('a', { meta: mac, ctrl: !mac, commands: ['selectAll'] });
    await page.type('Revised plan');
    await page.press('Escape');
    assert.ok(await until(() => fs.readFileSync(file, 'utf8') === original.replace('>Plan<', '>Revised plan<')));
    await page.press('z', { meta: mac, ctrl: !mac });
    assert.ok(await until(() => fs.readFileSync(file, 'utf8') === original), fs.readFileSync(file, 'utf8'));
  });

  it('asks the agent about two selected elements: the request keeps the words and the selection at Send', { skip: browserSkip, timeout: 120000 }, async () => {
    const waiting = await run.start(['wait', root, '--timeout', '60'], { firstLine: false });
    try {
      assert.ok(await until(() => fs.existsSync(path.join(root, '_agent', 'waiting')), 10000), 'wait wrote no heartbeat');
      await page.evaluate("location.hash = '#slide-3'");
      const on = selector => `document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="end"] ${selector}')`;
      assert.ok(await page.waitFor(on('h1')));
      const pointAt = selector => page.evaluate(`(() => { const box = ${on(selector)}.getBoundingClientRect(); return [box.x + 12, box.y + box.height / 2]; })()`);
      await page.click(...await pointAt('h1'));
      await page.click(...await pointAt('ul'), { shift: true });
      const field = `document.querySelector('input[aria-label^="Ask "]')`;
      assert.ok(await page.waitFor(field, 15000), 'no Ask field: the page does not see the waiting agent');
      await page.evaluate(`${field}.focus()`);
      assert.ok(await page.waitFor(`${field}.placeholder.includes('about the selection')`, 5000), 'the Ask field does not see the selection');
      await page.type('Make these two blue');
      await page.press('Enter');
      // Right after Send, the selection goes: what was sent stays as it was.
      await page.press('Escape');
      await page.press('Escape');
      const { code } = await waiting.exited;
      assert.equal(code, 0, waiting.stdout());
      assert.match(waiting.stdout(), /^Make these two blue$/m);
      const doneDir = path.join(root, '_agent', 'done');
      const sent = fs.readdirSync(doneDir).map(name => JSON.parse(fs.readFileSync(path.join(doneDir, name), 'utf8'))).find(r => r.userText === 'Make these two blue');
      assert.ok(sent, 'no request with the words in _agent/done');
      assert.ok(sent.text.startsWith(sent.userText));
      assert.equal(sent.selectionSnapshot?.kind, 'elements', JSON.stringify(sent.selectionSnapshot));
      assert.equal(sent.selectionSnapshot.count, 2);
      assert.equal(sent.selectionSnapshot.label, '2 selected elements');
      assert.equal(sent.selectionSnapshot.where, 'Slide 3 of 3');
    } finally {
      waiting.child?.kill('SIGTERM');
    }
  });

  it('refuses an Ask over 8000 UTF-8 bytes with the draft kept, and sends one at the limit whole with its selection', { skip: browserSkip, timeout: 120000 }, async () => {
    const waiting = await run.start(['wait', root, '--timeout', '60'], { firstLine: false });
    try {
      assert.ok(await until(() => fs.existsSync(path.join(root, '_agent', 'waiting')), 10000), 'wait wrote no heartbeat');
      await page.evaluate("location.hash = '#slide-3'");
      const on = selector => `document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="end"] ${selector}')`;
      assert.ok(await page.waitFor(on('h1')));
      const box = await page.evaluate(`(() => { const box = ${on('h1')}.getBoundingClientRect(); return [box.x + 12, box.y + box.height / 2]; })()`);
      await page.click(...box);
      const field = `document.querySelector('input[aria-label^="Ask "]')`;
      assert.ok(await page.waitFor(field, 15000), 'no Ask field: the page does not see the waiting agent');
      await page.evaluate(`${field}.focus()`);
      // 2,667 CJK characters are 8,001 bytes, far under 8000 UTF-16 units: refused, the words kept, nothing sent.
      const wide = '蓝'.repeat(2667);
      await page.cdp('Input.insertText', { text: wide });
      await page.press('Enter');
      assert.ok(await page.waitFor("document.body.innerText.includes('That’s too long to send.')", 10000), 'the page does not say the Ask is too long');
      assert.equal(await page.evaluate(`${field}.value`), wide, 'the draft stays in the field');
      const inbox = path.join(root, '_agent', 'inbox');
      const queued = () => (fs.existsSync(inbox) ? fs.readdirSync(inbox) : []).map(name => fs.readFileSync(path.join(inbox, name), 'utf8'));
      assert.ok(!queued().some(text => text.includes('蓝蓝蓝')), 'the long Ask was not queued');
      // Exactly 8000 bytes, with the element after it: the agent gets every word and the whole fenced selection.
      const words = `Make the title bolder ${'w'.repeat(8000 - 22)}`;
      await page.evaluate(`${field}.select()`);
      await page.cdp('Input.insertText', { text: words });
      await page.press('Enter');
      const { code } = await waiting.exited;
      assert.equal(code, 0, waiting.stdout());
      const doneDir = path.join(root, '_agent', 'done');
      const sent = fs.readdirSync(doneDir).map(name => JSON.parse(fs.readFileSync(path.join(doneDir, name), 'utf8'))).find(r => r.userText === words);
      assert.ok(sent, 'no request with all the words in _agent/done');
      assert.ok(sent.text.startsWith(words), 'the agent reads every word first');
      assert.match(sent.text, /<<<END-UNTRUSTED-DATA-[0-9a-f]+>>>$/, 'the selected element is fenced to the end, nothing cut');
      assert.equal(await page.evaluate(`${field}.value`), '', 'a sent Ask clears the field');
    } finally {
      waiting.child?.kill('SIGTERM');
    }
  });

  it('sets a source paragraph’s margin from the properties panel, saves it on the tag and undoes it', { skip: browserSkip }, async () => {
    const file = path.join(root, 'project/slides/plan.html');
    const original = fs.readFileSync(file, 'utf8');
    await page.evaluate("location.hash = '#slide-2'");
    const line = `[...document.querySelectorAll('[data-open-artifact-mode="edit"][data-open-artifact-slide="plan"] p')].find((p) => p.textContent === 'Read through the shared sheet.')`;
    assert.ok(await page.waitFor(line));
    const point = await page.evaluate(`(() => {
      const box = (${line}).getBoundingClientRect();
      return [box.x + box.width / 2, box.y + box.height / 2];
    })()`);
    await page.click(...point);
    const margin = `document.querySelector('input[aria-label="Margin"]')`;
    assert.ok(await page.waitFor(margin), 'a flow child shows the margin field');
    const field = await page.evaluate(`(() => { const box = ${margin}.getBoundingClientRect(); return [box.x + box.width / 2, box.y + box.height / 2]; })()`);
    await page.click(...field);
    await page.evaluate(`${margin}.select()`);
    await page.type('24');
    await page.press('Enter');
    const spaced = original.replace('<p>Read through', '<p style="margin:24px">Read through');
    assert.notEqual(spaced, original);
    assert.ok(await until(() => fs.readFileSync(file, 'utf8') === spaced), fs.readFileSync(file, 'utf8'));
    await page.evaluate('document.activeElement?.blur()');
    const mac = await page.evaluate("navigator.platform.includes('Mac')");
    await page.press('z', { meta: mac, ctrl: !mac });
    assert.ok(await until(() => fs.readFileSync(file, 'utf8') === original), fs.readFileSync(file, 'utf8'));
    await page.press('Escape');
  });

  it('reaches the card of a link in edited text by keyboard and changes its address', { skip: browserSkip }, async () => {
    const file = path.join(root, 'project/slides/end.html');
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, '<section id="end"><h1>Close</h1><p>Read <a href="https://example.com/docs">the guide</a> first.</p></section>');
    try {
      await page.evaluate("location.hash = '#slide-~end'");
      const link = '[data-open-artifact-mode="edit"][data-open-artifact-slide="end"] a';
      assert.ok(await page.waitFor(`document.querySelector('${link}')`));
      const point = await page.evaluate(`(() => {
        const box = document.querySelector('${link}').getBoundingClientRect();
        return [box.x + box.width / 2, box.y + box.height / 2];
      })()`);
      await page.clickTimes(...point, 2);
      const card = '[data-open-artifact-link-card]';
      assert.ok(await page.waitFor(`document.querySelector('${card} [aria-label="Edit link"]')`), 'no card for the link');
      await page.press('Tab');
      assert.ok(await page.waitFor(`document.activeElement?.closest('${card}')`), 'Tab did not reach the card');
      await page.press('Escape');
      if (!(await page.waitFor('document.activeElement?.isContentEditable', 500))) await page.press('Escape');
      assert.ok(await page.waitFor('document.activeElement?.isContentEditable'), 'Escape did not give the text the focus back');
      await page.press('Tab');
      assert.ok(await page.waitFor(`document.activeElement?.closest('${card}')`));
      await page.evaluate(`document.querySelector('${card} [aria-label="Edit link"]').click()`);
      assert.ok(await page.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Link address'`));
      await page.evaluate('document.activeElement.select()');
      await page.type('example.org/start');
      await page.press('Enter');
      assert.ok(await page.waitFor('document.activeElement?.isContentEditable'));
      await page.press('Escape');
      assert.ok(await until(() => fs.readFileSync(file, 'utf8').includes('<a href="https://example.org/start">the guide</a>')), fs.readFileSync(file, 'utf8'));
    } finally {
      fs.writeFileSync(file, original);
    }
  });

  it('keeps a locked heading and an inline drawing as written when the text beside them changes', { skip: browserSkip }, async () => {
    const file = path.join(root, 'project/slides/end.html');
    const original = fs.readFileSync(file, 'utf8');
    const marked = '<section id="end">\n  <h1 data-locked>Close</h1>\n  <p>Plain line</p>\n' +
      '  <svg data-locked viewBox="0 0 10 10" style="position:absolute;left:1000px;top:128px;width:160px;height:160px"><circle cx="5" cy="5" r="4" fill="#1870e0"/></svg>\n</section>\n';
    fs.writeFileSync(file, marked);
    try {
      await page.evaluate("location.hash = '#slide-~end'");
      const line = `[...document.querySelectorAll('[data-open-artifact-mode="edit"][data-open-artifact-slide="end"] p')].find(p => p.textContent === 'Plain line')`;
      assert.ok(await page.waitFor(`(${line}) && document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="end"] svg circle')`));
      await page.clickTimes(...(await middle(page, line)), 2);
      assert.ok(await page.waitFor('document.activeElement?.isContentEditable'));
      const mac = await page.evaluate("navigator.platform.includes('Mac')");
      await page.press('a', { meta: mac, ctrl: !mac, commands: ['selectAll'] });
      await page.type('Edited line');
      await page.press('Escape');
      assert.ok(await until(() => fs.readFileSync(file, 'utf8') === marked.replace('Plain line', 'Edited line')), fs.readFileSync(file, 'utf8'));
    } finally {
      fs.writeFileSync(file, original);
    }
    await page.evaluate("location.hash = '#slide-1'");
    assert.ok(await page.waitFor(`document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="cover"]')`));
  });

  it('uses the frame to comment on selected text and a dragged slide area', { skip: browserSkip }, async () => {
    const shell = await browser.load(publicUrl + '#slide-~plan', { ready: "document.querySelector('[data-comments-button]')" });
    try {
      const focused = "document.activeElement?.shadowRoot?.activeElement?.matches('textarea')";
      const point = await shell.evaluate(`(() => {
        const frame = document.querySelector('iframe[name="open-artifact-shell"]');
        const heading = frame.contentDocument.querySelector('[data-open-artifact-mode="edit"] h1');
        const outer = frame.getBoundingClientRect(), box = heading.getBoundingClientRect();
        return [outer.left + box.left + 16, outer.top + box.top + box.height / 2];
      })()`);
      await shell.click(...point);
      await shell.evaluate("document.querySelector('[data-comments-button] button[aria-haspopup]').click()");
      const selection = "[...document.querySelectorAll('[role=menuitem]')].find(el => el.textContent.trim() === 'Comment on selection')";
      assert.ok(await shell.waitFor(selection, 4000));
      await shell.evaluate(selection + '.click()');
      assert.ok(await shell.waitFor(focused, 4000));
      await shell.type('Review this heading');
      await shell.press('Enter');
      const readThread = async text => {
        const result = await (await fetch(new URL('_api/comments', publicUrl))).json();
        return result.threads.find(t => t.messages.some(m => m.text === text));
      };
      assert.ok(await until(() => readThread('Review this heading')));
      const heading = JSON.parse((await readThread('Review this heading')).anchor);
      assert.equal(heading.slide, 'plan');
      assert.ok(heading.el);

      const start = await shell.evaluate(`(() => {
        const frame = document.querySelector('iframe[name="open-artifact-shell"]');
        const outer = frame.getBoundingClientRect(), box = frame.contentDocument.querySelector('[data-comment-capture]').getBoundingClientRect();
        return [outer.left + box.left + box.width / 4, outer.top + box.top + box.height * 0.72];
      })()`);
      const [x, y] = start;
      await shell.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await shell.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 60, y: y + 32, buttons: 1 });
      await shell.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 60, y: y + 32, button: 'left', clickCount: 1 });
      assert.ok(await shell.waitFor(focused, 4000));
      await shell.type('Review this area');
      await shell.press('Enter');
      assert.ok(await until(() => readThread('Review this area')));
      const area = JSON.parse((await readThread('Review this area')).anchor);
      assert.equal(area.slide, 'plan');
      assert.ok(area.w > 0 && area.h > 0);
      assert.ok(Math.abs(area.w / area.h - 60 / 32) < 0.05);
    } finally { await shell.close(); }
  });

  /**
   * Opens the deck at `base` (on `slide`) in the global frame, turns comment mode on and comments `text` with a click
   * on the middle of what `selector` finds on the stage; returns the thread as stored.
   */
  async function commentOn(base, slide, selector, text) {
    const shell = await browser.load(`${base}#slide-~${slide}`, { ready: "document.querySelector('[data-comments-button]')" });
    try {
      const target = `document.querySelector('iframe[name="open-artifact-shell"]').contentDocument.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="${slide}"] ${selector}')`;
      assert.ok(await shell.waitFor(target), `no ${selector} on ${slide}`);
      await shell.evaluate(`document.querySelector('[data-comments-button] button[aria-pressed]').click()`);
      assert.ok(await shell.waitFor(`document.querySelector('iframe[name="open-artifact-shell"]').contentDocument.querySelector('[data-comment-capture]')`, 4000), 'comment mode did not start');
      const point = await shell.evaluate(`(() => {
        const outer = document.querySelector('iframe[name="open-artifact-shell"]').getBoundingClientRect(), box = (${target}).getBoundingClientRect();
        return [outer.left + box.left + box.width / 2, outer.top + box.top + box.height / 2];
      })()`);
      await shell.click(...point);
      assert.ok(await shell.waitFor("document.activeElement?.shadowRoot?.activeElement?.matches('textarea')", 4000), 'no comment field after the click');
      await shell.type(text);
      await shell.press('Enter');
      const read = async () => (await (await fetch(new URL('_api/comments', base))).json()).threads.find(t => t.messages.some(m => m.text === text));
      assert.ok(await until(read), 'the comment was not stored');
      return await read();
    } finally { await shell.close(); }
  }

  it('names the list item a comment is dropped on, with its words', { skip: browserSkip }, async () => {
    const thread = await commentOn(publicUrl, 'end', '[data-open-artifact-item="1"]', 'Check this step');
    assert.match(thread.label, /List item 2/, thread.label);
    assert.match(thread.label, /Second step/, thread.label);
    assert.equal(thread.location?.listItem, 2, JSON.stringify(thread.location));
    assert.equal(JSON.parse(thread.anchor).item, 1, thread.anchor);
  });

  it('opens a guest invite in the global frame with the guest’s original role', { skip: browserSkip }, async () => {
    const { createTypeServer } = await import('../packages/type-server/src/index.ts');
    const server = createTypeServer({
      secret: 'guest-flow', idleMs: 0, assetsDir: path.join(typePath('slides'), 'scripts'),
      lanAddresses: () => [], isLocal: req => !req.headers['x-test-guest'],
    });
    let guest, owner;
    try {
      const guestRoot = tmpDir('slides-guest-deck');
      fs.cpSync(path.join(root, 'project'), path.join(guestRoot, 'project'), { recursive: true });
      await server.listen();
      const opened = await server.open({ root: guestRoot, type: 'slides', title: 'Guest review' });
      owner = await browser.load(opened.url + '#slide-~plan', { ready: "document.querySelector('[data-comments-button]')" });
      await owner.evaluate(`Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async text => { window.copied = text } })`);
      await owner.evaluate(`document.querySelector('header button[aria-label="Share"]').click()`);
      const invite = "document.querySelector('[data-share-link=commenter] button')";
      assert.ok(await owner.waitFor(invite, 4000));
      await owner.evaluate(invite + '.click()');
      assert.ok(await owner.waitFor("window.copied?.includes('/s/') && document.querySelector('[data-share-security]')", 5000));
      const join = new URL(await owner.evaluate('window.copied'));
      assert.equal(join.hash, '#slide-~plan');
      const viewerUrl = await owner.evaluate("document.querySelector('[data-share-link=viewer]').title");
      // The test listener has no LAN interface. Deliver the copied invitation to its loopback address.
      join.host = new URL(opened.url).host;
      guest = await browser.load('about:blank');
      await guest.cdp('Network.setExtraHTTPHeaders', { headers: { 'x-test-guest': '1' } });
      await guest.cdp('Page.navigate', { url: join.href });
      assert.ok(await guest.waitFor("document.querySelector('input[name=name]')", 5000));
      await guest.evaluate("document.querySelector('[name=name]').value = 'Reviewer'; document.querySelector('form').requestSubmit()");
      const comment = '[data-comments-button] button[aria-pressed]';
      assert.ok(await guest.waitFor(`document.querySelector('${comment}')`, 5000));
      await guest.evaluate(`document.querySelector('${comment}').click()`);
      assert.ok(await guest.waitFor(`document.querySelector('${comment}')?.getAttribute('aria-pressed') === 'true'`));
      const target = '[data-open-artifact-mode="edit"][data-open-artifact-slide="plan"]';
      assert.ok(await guest.waitFor(`document.querySelector('${target}')`));
      const point = await guest.evaluate(`(() => {
        const frame = document.querySelector('iframe[name="open-artifact-shell"]');
        const outer = frame.getBoundingClientRect(), slide = frame.contentDocument.querySelector('${target}').getBoundingClientRect();
        return [outer.x + slide.x + slide.width / 2, outer.y + slide.y + slide.height / 2];
      })()`);
      await guest.click(...point);
      assert.ok(await guest.waitFor("document.activeElement?.shadowRoot?.activeElement?.matches('textarea')", 4000));
      await guest.type('Check the plan with finance');
      await guest.press('Enter');
      const list = "document.querySelector('[data-comments-panel-layer]')?.shadowRoot?.querySelector('[data-comments-panel]')";
      await guest.evaluate(`document.querySelector('[data-comments-button] button[aria-haspopup]').click()`);
      const showAll = `[...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.includes('Show all comments'))`;
      assert.ok(await guest.waitFor(showAll));
      await guest.evaluate(showAll + '.click()');
      assert.ok(await guest.waitFor(`${list}?.textContent.includes('Check the plan with finance')`, 5000));
      const threads = await (await fetch(new URL('_api/comments', opened.url))).json();
      const thread = threads.threads.find(t => t.messages.some(m => m.text === 'Check the plan with finance'));
      assert.ok(thread);
      assert.equal(JSON.parse(thread.anchor).slide, 'plan');
      await guest.evaluate(`Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async text => { window.copied = text } })`);
      await guest.evaluate(`document.querySelector('header button[aria-label="Share"]').click()`);
      assert.ok(await guest.waitFor(`document.querySelector('[role="dialog"]')`));
      assert.equal(await guest.evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Export')`), false);
      const copy = `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Copy link')`;
      await guest.evaluate(copy + '.click()');
      assert.ok(await guest.waitFor(`window.copied === ${JSON.stringify(join.href)}`));
      assert.equal(await guest.evaluate("window.__OPEN_ARTIFACT_BOOT__.typeServer.role"), 'commenter');
      assert.equal(await guest.evaluate("fetch('_api/frame/share').then(r => r.status)"), 403);

      // Joining the read-only link must switch this browser from commenter to viewer.
      const viewerLink = new URL(new URL(viewerUrl).pathname, opened.url);
      await guest.cdp('Page.navigate', { url: viewerLink.href });
      assert.ok(await guest.waitFor("document.querySelector('input[name=name]')", 5000));
      await guest.evaluate("document.querySelector('form').requestSubmit()");
      assert.ok(await guest.waitFor(`document.querySelector('${comment}')`, 5000));
      await guest.evaluate(`document.querySelector('${comment}').click()`);
      assert.ok(await guest.waitFor(`${list}?.textContent.includes('Check the plan with finance')`, 5000));
      assert.equal(await guest.evaluate("window.__OPEN_ARTIFACT_BOOT__.typeServer.role"), 'viewer');
      await guest.click(...point);
      assert.ok((await guest.evaluateAll("!!document.activeElement?.shadowRoot?.activeElement?.matches('textarea')")).every(focused => !focused));
    } finally { await guest?.close(); await owner?.close(); await server.stop(); }
  });

  it('opens a linked deck in the real Shell, keeps the frame and address bar in sync, and frames it inline', { skip: browserSkip }, async () => {
    const overrides = {
      OPEN_ARTIFACT_HOME: tmpDir('slides-daemon'),
      OPEN_ARTIFACT_TYPE_SERVER_HOME: tmpDir('slides-shell-state'),
      OPEN_ARTIFACT_USER_TYPES: tmpDir('slides-user-types'),
      OPEN_ARTIFACT_BROWSER: 'none',
    };
    const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
    Object.assign(process.env, overrides);
    let daemon, shell;
    try {
      const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
      const { api, readDaemon } = await import('../packages/daemon/src/client.ts');
      daemon = await startDaemon({ port: 0, idleMs: 0, quiet: true, builtinTypesDir: path.dirname(typePath('slides')) });
      const state = await readDaemon();
      const made = await api(state, 'tools.call', {
        name: 'Artifact', arguments: { action: 'publish', type_url: 'open-artifact://type/slides', title: 'Slide links' },
        caller: { harness: 'e2e', session: 'slide-links', workspace: tmpDir('slides-workspace') },
      });
      assert.equal(made.error, undefined, JSON.stringify(made.error));
      const id = made.url.split('/').at(-1);
      fs.cpSync(path.join(root, 'project'), path.join(daemon.store.require(id).root, 'project'), { recursive: true });
      const stage = slide => `document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="${slide}"]')`;
      shell = await browser.load(state.url + '/a/' + id + '#slide-~plan', { ready: stage('plan') });
      assert.ok(await shell.waitFor(stage('plan')));
      const initial = await shell.evaluate('history.length');
      await shell.evaluateAll(`if (document.querySelector('${rail}')) document.querySelector('${rail}').focus()`);
      await shell.evaluateAll(`if (document.querySelector('${rail}')) location.hash = '#slide-~end'`);
      assert.ok(await until(async () => (await shell.evaluate('location.hash')) === '#slide-~end'));
      assert.equal(await shell.evaluate('history.length'), initial + 1); // The explicit frame hash navigation added one entry.
      await shell.evaluate("location.hash = '#slide-1'");
      assert.ok(await shell.waitFor(stage('cover')));
      assert.equal(await shell.evaluate('location.hash'), '#slide-~cover');
      await shell.evaluate(`Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async text => { window.copied = text } })`);
      // Copy link to slide (⌘⌥L) gives the Export tab's link with the slide: an invite link at the network address, not
      // this computer's 127.0.0.1 page, and copying it shares the deck on the network (the note says so).
      await shell.evaluateAll(`document.querySelector('${rail}')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', metaKey: true, altKey: true, bubbles: true }))`);
      assert.ok(await shell.waitFor(`window.copied?.includes('/s/') && document.body.innerText.includes('shared on your network now')`, 8000), 'the slide link is ' + await shell.evaluate('window.copied'));
      const slideLink = await shell.evaluate('window.copied');
      assert.ok(!slideLink.includes('/a/'), slideLink);
      assert.equal(new URL(slideLink).hash, '#slide-~cover');
      // The title menu's Copy link gives the same link.
      await shell.evaluate(`window.copied = ''; document.querySelector('header button[aria-label="Artifact options"]').click()`);
      const menuCopy = `[...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.trim() === 'Copy link')`;
      assert.ok(await shell.waitFor(menuCopy));
      await shell.evaluate(menuCopy + '.click()');
      assert.ok(await shell.waitFor('window.copied', 8000));
      const fromMenu = await shell.evaluate('window.copied');
      assert.equal(fromMenu, slideLink);
      await shell.evaluate(`document.querySelector('header button[aria-label="Share"]').click()`);
      assert.ok(await shell.waitFor(`[...document.querySelectorAll('[role="dialog"] button')].some(b => b.textContent.trim() === 'Export')`));
      await shell.evaluate(`window.copied = ''; [...document.querySelectorAll('[role="dialog"] [role="tab"], [role="dialog"] button')].find(b => b.textContent.trim() === 'Export').click()`);
      const exportCopy = `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Copy link')`;
      assert.ok(await shell.waitFor(exportCopy));
      await shell.evaluate(exportCopy + '.click()');
      assert.ok(await shell.waitFor('window.copied'));
      assert.equal(await shell.evaluate('window.copied'), fromMenu);
      await shell.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      assert.deepEqual(shell.problems, []);
      // Framed by another page at #view-inline: no bar, the read-only view, and slide links the framing page follows.
      const host = await framing(`${state.url}/a/${id}#view-inline`);
      try {
        const framed = await browser.load(host.url, { ready: inlineSlide('cover') });
        try {
          assert.deepEqual((await framed.evaluateAll(`Boolean(document.querySelector('header button[aria-label="Share"]'))`)).filter(Boolean), []);
          await framed.evaluate(`document.getElementById('framed').src = ${JSON.stringify(`${state.url}/a/${id}#slide-~end`)}`);
          assert.ok(await framed.waitFor(`${inlineSlide('end')} && ${inlinePager}?.textContent.includes('3 / 3')`));
          assert.deepEqual(framed.problems, []);
        } finally {
          await framed.close();
        }
      } finally {
        await host.close();
      }
      // A host that said hello hears where the deck is, and can send it to a place.
      const placing = await framing(`${state.url}/a/${id}#slide-~plan`, `window.places = [];
        addEventListener('message', event => {
          const message = event.data;
          if (message?.openArtifact === 'shell_hello') event.source.postMessage({ openArtifact: 'host_hello', caps: {} }, event.origin);
          if (message?.openArtifact === 'place') places.push(message.hash);
        });
        window.goto = hash => document.getElementById('framed').contentWindow.postMessage({ openArtifact: 'goto', hash }, '*');`);
      try {
        const hosted = await browser.load(placing.url, { ready: `window.places?.at(-1) === '#slide-~plan'` });
        try {
          await hosted.evaluate(`goto('#slide-~end.only')`);
          assert.ok(await hosted.waitFor(`places.at(-1) === '#slide-~end.only.3.3'`));
          const heard = await hosted.evaluate('places.length');
          await hosted.evaluate(`goto('#slide-~gone')`);
          assert.ok(await hosted.waitFor(`places.length > ${heard} && places.at(-1) === '#slide-~end.only.3.3'`));
          const again = await hosted.evaluate('places.length');
          await hosted.evaluate(`goto('#view-inline')`);
          assert.ok(await hosted.waitFor(`places.length > ${again} && places.at(-1) === '#slide-~end.only.3.3'`));
          await hosted.evaluate(`goto('#slide-~cover')`);
          assert.ok(await hosted.waitFor(`places.at(-1) === '#slide-~cover'`));
          assert.deepEqual(hosted.problems, []);
        } finally {
          await hosted.close();
        }
      } finally {
        await placing.close();
      }
    } finally {
      await shell?.close();
      await daemon?.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('shows a framed deck read only at #view-inline: one slide with every build, a pager, and changes on disk in place', { skip: browserSkip }, async () => {
    const project = path.join(root, 'project');
    const names = ['deck.json', ...fileNames.map(id => `slides/${id}.html`)];
    const files = () => Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(project, name), 'utf8')]));
    const original = files();
    const host = await framing(url + '#view-inline');
    const viewer = await browser.load(host.url, { ready: inlineSlide('cover') });
    try {
      assert.deepEqual((await viewer.evaluateAll(`document.querySelectorAll('${rail}').length`)).filter(n => n > 0), []);
      // The in-flow build is shown, not waiting for a click.
      assert.ok(await viewer.waitFor(`[...(${inlineSlide('cover')}?.querySelectorAll('p') ?? [])].some(p => p.textContent === 'Details after a click' && getComputedStyle(p).opacity === '1' && getComputedStyle(p).visibility === 'visible')`));
      assert.ok(await viewer.waitFor(`${inlinePager}?.textContent.includes('1 / 3') && ${inlinePager}.querySelector('[aria-label="Previous slide"]').disabled`));
      await viewer.evaluateAll(`document.querySelector('[aria-label="Next slide"]')?.click()`);
      assert.ok(await viewer.waitFor(inlineSlide('plan')));
      await viewer.evaluateAll(`document.querySelector('[aria-label="Next slide"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
      assert.ok(await viewer.waitFor(`${inlineSlide('end')} && ${inlinePager}.querySelector('[aria-label="Next slide"]').disabled && /^Slide 3 of 3/.test(${inlinePager}.querySelector('[role="status"]').textContent)`));
      assert.deepEqual(files(), original);
      // An agent's change shows on the same slide, without reloading the page; a skipped slide leaves the pager.
      await viewer.evaluateAll(`if (document.querySelector('[data-open-artifact-inline-view]')) window.inlineMarker = true`);
      fs.writeFileSync(path.join(project, 'slides/end.html'), '<section id="end"><h1>Thanks</h1></section>');
      assert.ok(await viewer.waitFor(`window.inlineMarker && ${inlineSlide('end')}?.textContent.includes('Thanks')`));
      fs.writeFileSync(path.join(project, 'slides/plan.html'), original['slides/plan.html'].replace('<section id="plan"', '<section id="plan" hidden'));
      assert.ok(await viewer.waitFor(`window.inlineMarker && ${inlineSlide('end')} && ${inlinePager}?.textContent.includes('2 / 2')`));
      assert.deepEqual(viewer.problems, []);
    } finally {
      for (const [name, text] of Object.entries(original)) fs.writeFileSync(path.join(project, name), text);
      await viewer.close();
      await host.close();
    }
  });

  it('reads the first slide out as a framed deck appears, and pages with the arrow keys from anywhere in it', { skip: browserSkip }, async () => {
    const host = await framing(url + '#view-inline');
    const viewer = await browser.load(host.url, { ready: inlineSlide('cover') });
    try {
      assert.ok(await viewer.waitFor(`/^Slide 1 of 3/.test(${inlinePager}?.querySelector('[role="status"]').textContent)`));
      const buttons = (await viewer.evaluateAll(`${inlinePager} ? [...${inlinePager}.querySelectorAll('button')].map(b => {
        const r = b.getBoundingClientRect();
        return [b.getAttribute('aria-label'), b.getAttribute('aria-keyshortcuts'), Math.round(r.width), Math.round(r.height)];
      }) : null`)).filter(Boolean);
      assert.deepEqual(buttons, [[['Previous slide', 'ArrowLeft', 40, 40], ['Next slide', 'ArrowRight', 40, 40]]]);
      // A click on the slide, not on the pager: the keys still turn the page.
      const point = await viewer.evaluate(`(() => { const r = document.getElementById('framed').getBoundingClientRect(); return [r.x + r.width / 2, r.y + 120]; })()`);
      await viewer.click(...point);
      await viewer.press('ArrowRight');
      assert.ok(await viewer.waitFor(`${inlineSlide('plan')} && ${inlinePager}.textContent.includes('2 / 3') && /^Slide 2 of 3/.test(${inlinePager}.querySelector('[role="status"]').textContent)`));
      await viewer.press('ArrowLeft');
      assert.ok(await viewer.waitFor(`${inlineSlide('cover')} && ${inlinePager}.textContent.includes('1 / 3')`));
      assert.deepEqual(viewer.problems, []);
    } finally {
      await viewer.close();
      await host.close();
    }
  });

  it('shows a reload card, not a blank page, when the editor fails to draw', { skip: browserSkip }, async () => {
    const broken = await browser.load(url, { ready: `document.querySelectorAll('${rail}').length === 3` });
    try {
      // A state update whose updater throws fails the render of a component inside the editor.
      await broken.evaluate(`(() => {
        const root = document.getElementById('root');
        let fiber = root[Object.keys(root).find((k) => k.startsWith('__reactContainer$'))].child;
        while (fiber && !(fiber.tag === 1 && fiber.memoizedState && 'crashed' in fiber.memoizedState)) fiber = fiber.child;
        const stack = [fiber.child];
        while (stack.length) {
          const node = stack.pop();
          if (!node) continue;
          for (let hook = typeof node.type === 'function' ? node.memoizedState : null; hook && typeof hook === 'object' && 'next' in hook; hook = hook.next) {
            if (hook.queue?.dispatch) return hook.queue.dispatch(() => { throw new Error('render failed on purpose'); });
          }
          stack.push(node.sibling, node.child);
        }
      })()`);
      assert.ok(await broken.waitFor(`document.querySelector('[data-testid="slides-crashed"] button')?.textContent.trim() === 'Reload'`));
      assert.match(await broken.crashed(), /slides-crashed/);
      assert.ok((await crashes()).some((what) => what.includes('slides-crashed')));
    } finally {
      await broken.close();
    }
  });

  it('never runs a refused drawing: the slide is held and the svg comes up empty, in the stage and the rail', { skip: browserSkip }, async () => {
    const deck = tmpDir('slides-unsafe-svg');
    fs.mkdirSync(path.join(deck, 'project', 'slides'), { recursive: true });
    fs.writeFileSync(path.join(deck, 'project', 'deck.json'), JSON.stringify({
      v: 5, lists: 'css', title: 'Unsafe drawing', order: ['bad'], createdOnFiles: { v: 1, at: '2026-11-26T00:00:00Z' },
      sections: {}, faces: {}, designSystems: [],
    }));
    // In an svg a <style> holds markup, and <img> leaves the svg for HTML: a tree that reads <style> as text sees no handler.
    fs.writeFileSync(path.join(deck, 'project', 'slides', 'bad.html'), '<section id="bad"><h1>Drawing</h1>' +
      '<svg viewBox="0 0 10 10" style="width:200px;height:200px"><style><img src="x" onerror="window.__ran=(window.__ran||0)+1"></style><rect width="10" height="10"/></svg></section>');
    const checked = await run.run(['check', deck]);
    assert.notEqual(checked.code, 0, 'check passed a drawing that holds an HTML tag');
    assert.match(checked.stdout + checked.stderr, /<svg> holds <img>/);
    const { url: deckUrl } = await run.json(['open', deck, '--json']);
    const shown = await browser.load(new URL('index.html', deckUrl).href, { ready: `document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="bad"]')` });
    try {
      assert.ok(await shown.waitFor(`document.body.innerText.includes("This slide's file has errors")`), 'the slide is not held');
      // Give a broken-out <img> time to fail to load and fire its handler.
      await new Promise(resolve => setTimeout(resolve, 1000));
      const state = await shown.evaluate(`({
        ran: window.__ran ?? 0,
        handlers: document.querySelectorAll('[onerror]').length,
        titles: [...document.querySelectorAll('h1')].filter(h => h.textContent === 'Drawing').length,
        drawings: document.querySelectorAll('[data-open-artifact-kind="svg"]').length,
        images: document.querySelectorAll('img[src="x"]').length,
      })`);
      assert.equal(state.ran, 0, 'the drawing ran code');
      assert.equal(state.handlers, 0);
      assert.equal(state.images, 0, 'the <img> broke out of the svg');
      // The held slide still draws (its title is on the stage and in the rail); only the refused drawing is gone.
      assert.ok(state.titles >= 2, `the held slide is not drawn in the stage and the rail: ${state.titles}`);
      assert.equal(state.drawings, 0, 'a refused drawing kept its markup');
    } finally {
      await shown.close();
      await run.run(['stop', deck]);
    }
  });

  describe('elements on an inline-style deck', { skip: browserSkip }, () => {
    // Written as the editor saves them, so a save that changes one thing changes nothing else in the file.
    const SHAPES = '<section id="shapes" style="background:#ffffff">\n' +
      '  <div id="back" style="position:absolute;left:200px;top:200px;width:400px;height:300px;background:#cc3333"></div>\n' +
      '  <div id="front" style="position:absolute;left:500px;top:300px;width:400px;height:300px;background:#3355cc"></div>\n' +
      '  <p id="caption" style="position:absolute;left:200px;top:700px;width:800px;font-size:48px">Caption text</p>\n</section>\n';
    const GRID = '<section id="grid" style="background:#ffffff"><table style="position:absolute;left:200px;top:200px;width:800px;font-size:32px">' +
      '<tr><td>A1</td><td>B1</td></tr><tr><td>A2</td><td>B2</td></tr></table></section>';
    const LOCKED = SHAPES.replace('<div id="back"', '<div id="back" data-locked');
    let deck, deckPublic, deckUrl, mac;
    const shapesFile = () => path.join(deck, 'project/slides/shapes.html');
    const shapes = () => fs.readFileSync(shapesFile(), 'utf8');
    const order = () => shapes().match(/ id="[a-z0-9-]+"/g).slice(1).join('');
    const back = stageNode(0);

    before(async () => {
      deck = tmpDir('slides-layers');
      fs.mkdirSync(path.join(deck, 'project/slides'), { recursive: true });
      fs.writeFileSync(path.join(deck, 'project/deck.json'), JSON.stringify({
        v: 5, lists: 'css', title: 'Layers', order: ['shapes', 'grid'], cover: 'shapes',
        createdOnFiles: { v: 1, at: '2026-11-15T00:00:00Z' }, sections: {}, faces: {}, designSystems: [],
      }));
      fs.writeFileSync(path.join(deck, 'project/slides/grid.html'), GRID);
      fs.writeFileSync(shapesFile(), SHAPES);
      deckPublic = (await run.json(['open', deck, '--json'])).url;
      deckUrl = new URL('index.html', deckPublic).href;
    });

    /** The deck in a tab of its own, on `slide`, with the shapes slide as written above (or as `written`). */
    async function openDeck(slide = 'shapes', written = SHAPES) {
      fs.writeFileSync(shapesFile(), written);
      const tab = await browser.load(`${deckUrl}#slide-~${slide}`, { ready: `document.querySelector('[data-open-artifact-mode="edit"][data-open-artifact-slide="${slide}"] [data-open-artifact-path]')` });
      mac = await tab.evaluate("navigator.platform.includes('Mac')");
      return tab;
    }
    const selectBack = async tab => {
      await tab.click(...(await middle(tab, back)));
      assert.ok(await tab.waitFor(`${selectedCount} === 1`));
    };
    const lockKey = (tab, held = 0) => chord(tab, 'L', 'KeyL', 76, { mod: true, shift: true, mac, held });
    const undoKey = tab => tab.press('z', { meta: mac, ctrl: !mac });
    const caption = stageNode(2);
    const stage = `document.querySelector('[data-open-artifact-stage]')`;
    const strip = `document.querySelector('[data-open-artifact-format-bar]')`;
    /** ⌘\: the properties panel off or on (remembered for the origin: tests that use it forget it after). */
    const propertiesKey = tab => chord(tab, '\\', 'Backslash', 220, { mod: true, mac });
    const forgetView = tab => tab.evaluate(`localStorage.removeItem('open-artifact-slides:view')`).catch(() => {});
    /** The Space bar pressed down or let go, as a keyboard sends it (a press types a space where typing goes). */
    const space = (tab, down) => tab.cdp('Input.dispatchKeyEvent', down
      ? { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' }
      : { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    /** Alt (Option) pressed down or let go. */
    const alt = (tab, down) => tab.cdp('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: down ? 1 : 0 });
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    /** ⌘= a step at a time until the slide is 300px wider than the stage; false (with the scale it got to) if it never is. */
    const zoomIn = async tab => {
      const wide = `${stage}.scrollWidth > ${stage}.clientWidth + 300`;
      for (let n = 0; n < 8 && !(await tab.evaluate(wide)); n++) {
        await chord(tab, '=', 'Equal', 187, { mod: true, mac });
        await tab.waitFor(wide, 1000);
      }
      return (await tab.evaluate(wide)) || tab.evaluate(`JSON.stringify([${stage}.scrollWidth, ${stage}.clientWidth, document.activeElement?.outerHTML.slice(0, 80)])`);
    };

    it('locks an element from its menu: the file gains a bare data-locked, and the element holds still until it is unlocked', async () => {
      const tab = await openDeck();
      try {
        await selectBack(tab);
        assert.ok(await tab.waitFor(`${resizeHandles} > 0 && ${propertySections}.includes('Size')`));
        await tab.rightClick(...(await middle(tab, back)));
        assert.ok(await tab.waitFor(`${menuItem('Lock')}?.textContent.trim().startsWith('Lock')`));
        await tab.evaluate(`${menuItem('Lock')}.click()`);
        assert.ok(await until(() => shapes() === LOCKED), shapes());
        assert.ok(await tab.waitFor(`${announced} === 'Element locked'`));
        // No handles and no size fields for a locked element.
        assert.ok(await tab.waitFor(`${resizeHandles} === 0 && !${propertySections}.includes('Size') && ${propertySections}.includes('Appearance')`));

        // Delete, held down: the element stays, and one notice says why.
        await chord(tab, 'Delete', 'Delete', 46, { held: 2 });
        const notices = `[...document.querySelectorAll('[data-toast]')].filter(t => /unlock/i.test(t.textContent)).length`;
        assert.ok(await tab.waitFor(`${notices} === 1`));
        assert.equal(await tab.evaluate(`document.querySelectorAll('[data-open-artifact-mode="edit"] [data-open-artifact-path]').length`), 3);
        assert.equal(await tab.evaluate(notices), 1);

        // A drag that starts on it draws a selection box and leaves it where it is.
        const before = await tab.evaluate(`${back}.getAttribute('style')`);
        const corner = await tab.evaluate(`(() => { const r = ${back}.getBoundingClientRect(); return [r.x + 6, r.y + 6]; })()`);
        await tab.dragMouse(corner, [corner[0] + 80, corner[1] + 80]);
        assert.equal(await tab.evaluate(`${back}.getAttribute('style')`), before);

        // Select all passes over it.
        await tab.press('Escape');
        await tab.press('a', { meta: mac, ctrl: !mac });
        assert.ok(await tab.waitFor(`${selectedCount} === 2`));
        await tab.press('Escape');

        // ⇧⌘L held down unlocks once; the file is as it was before the lock.
        await selectBack(tab);
        await lockKey(tab, 3);
        assert.ok(await tab.waitFor(`${announced} === 'Element unlocked'`));
        assert.ok(await until(() => shapes() === SHAPES), shapes());
        assert.ok(await tab.waitFor(`${resizeHandles} > 0 && ${propertySections}.includes('Size')`));
        assert.deepEqual(tab.problems, []);
      } finally {
        await tab.close();
      }
    });

    it('duplicates, copies and pastes a locked element as unlocked copies, and undoes back to the written file', async () => {
      const tab = await openDeck();
      try {
        await selectBack(tab);
        await lockKey(tab);
        assert.ok(await until(() => shapes() === LOCKED), shapes());
        await tab.press('d', { meta: mac, ctrl: !mac });
        assert.ok(await until(() => shapes().includes('<div id="back-2" style=')), shapes());
        assert.equal(shapes().match(/data-locked/g).length, 1);
        // The copy sits over most of the original: pick the original by its uncovered corner.
        await tab.press('Escape');
        const corner = await tab.evaluate(`(() => { const r = ${back}.getBoundingClientRect(); return [r.x + 4, r.y + 4]; })()`);
        await tab.click(...corner);
        assert.ok(await tab.waitFor(`${selectedCount} === 1 && ${resizeHandles} === 0`));
        await tab.press('c', { meta: mac, ctrl: !mac, commands: ['copy'] });
        await tab.press('v', { meta: mac, ctrl: !mac, commands: ['paste'] });
        assert.ok(await until(() => shapes().includes('<div id="back-3" style=')), shapes());
        assert.equal(shapes().match(/data-locked/g).length, 1);
        await tab.press('Escape');
        for (const step of [s => !s.includes('back-3'), s => s === LOCKED, s => s === SHAPES]) {
          await undoKey(tab);
          assert.ok(await until(() => step(shapes())), shapes());
        }
        assert.deepEqual(tab.problems, []);
      } finally {
        await tab.close();
      }
    });

    it('restacks with ⌘] and ⌥⌘] by the key’s place, undoes on another layout, and leaves ⌥⌘D and ⌘[ in text alone', async () => {
      const tab = await openDeck();
      try {
        assert.equal(order(), ' id="back" id="front" id="caption"');
        await selectBack(tab);
        await chord(tab, ']', 'BracketRight', 221, { mod: true, mac });
        assert.ok(await tab.waitFor(`${announced} === 'Element moved up one layer'`));
        assert.ok(await until(() => order() === ' id="front" id="back" id="caption"'), shapes());
        // To the front: ⌥⌘] on a Mac, where the key types ‘ (Ctrl+Shift+] elsewhere).
        if (mac) await chord(tab, '‘', 'BracketRight', 221, { mod: true, alt: true, mac });
        else await chord(tab, '}', 'BracketRight', 221, { ctrl: true, shift: true, mac });
        assert.ok(await tab.waitFor(`${announced} === 'Element moved to the front'`));
        assert.ok(await until(() => order() === ' id="front" id="caption" id="back"'), shapes());
        // ⌘Z where the Z key types я.
        await chord(tab, 'я', 'KeyZ', 90, { mod: true, mac });
        assert.ok(await until(() => order() === ' id="front" id="back" id="caption"'), shapes());
        await chord(tab, 'я', 'KeyZ', 90, { mod: true, mac });
        assert.ok(await until(() => shapes() === SHAPES), shapes());

        if (mac) {
          // ⌥⌘D duplicates neither the element nor the slide; the ⌘] after it is the only change saved.
          await selectBack(tab);
          await chord(tab, '∂', 'KeyD', 68, { mod: true, alt: true, mac });
          await chord(tab, ']', 'BracketRight', 221, { mod: true, mac });
          assert.ok(await tab.waitFor(`${announced} === 'Element moved up one layer'`));
          assert.ok(await until(() => order() === ' id="front" id="back" id="caption"'), shapes());
          assert.equal(shapes(), SHAPES.replace(/(  <div id="back".*\n)(  <div id="front".*\n)/, '$2$1'));
          assert.deepEqual(JSON.parse(fs.readFileSync(path.join(deck, 'project/deck.json'), 'utf8')).order, ['shapes', 'grid']);
          assert.equal(await tab.evaluate(`document.querySelectorAll('${rail}').length`), 2);
          await undoKey(tab);
          assert.ok(await until(() => shapes() === SHAPES), shapes());
        }

        // ⌘[ while typing in the caption: still typing, the page stays, the layers stay.
        await tab.press('Escape');
        await tab.clickTimes(...(await middle(tab, stageNode(2))), 2);
        assert.ok(await tab.waitFor('document.activeElement?.isContentEditable'));
        const hash = await tab.evaluate('location.hash');
        await chord(tab, '[', 'BracketLeft', 219, { mod: true, mac });
        await tab.press('End');
        await tab.type('!');
        await tab.press('Escape');
        assert.ok(await until(() => shapes() === SHAPES.replace('Caption text<', 'Caption text!<')), shapes());
        assert.equal(await tab.evaluate('location.hash'), hash);
        await undoKey(tab);
        assert.ok(await until(() => shapes() === SHAPES), shapes());
        assert.deepEqual(tab.problems, []);
      } finally {
        await tab.close();
      }
    });

    it('outlines the table cell its menu acts on while the menu is open', async () => {
      const tab = await openDeck('grid');
      try {
        const cell = `document.querySelector('[data-open-artifact-mode="edit"] [data-open-artifact-cell="1:0"]')`;
        const outline = `document.querySelector('[data-open-artifact-menu-cell]')`;
        await tab.clickTimes(...(await middle(tab, cell)), 2);
        assert.ok(await tab.waitFor(`${cell}.isContentEditable`));
        assert.equal(await tab.evaluate(`Boolean(${outline})`), false);
        await tab.rightClick(...(await middle(tab, cell)));
        assert.ok(await tab.waitFor(`${menuItem('Insert row above')} && ${outline}?.getAttribute('data-open-artifact-menu-cell') === '1:0'`));
        const gap = await tab.evaluate(`(() => {
          const a = ${outline}.firstElementChild.getBoundingClientRect(), b = ${cell}.getBoundingClientRect();
          return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
        })()`);
        assert.ok(gap < 2, `the outline is ${gap}px off the cell`);
        // Escape closes the menu once the menu has the focus.
        assert.ok(await tab.waitFor(`document.activeElement?.closest('[role="menu"]')`));
        await tab.press('Escape');
        assert.ok(await tab.waitFor(`!document.querySelector('[role="menu"]') && !${outline}`));
        assert.deepEqual(tab.problems, []);
      } finally {
        await tab.close();
      }
    });

    it('says why the opacity field turns down a minus sign and a value past 100', async () => {
      const tab = await openDeck();
      try {
        await selectBack(tab);
        const field = `document.querySelector('input[aria-label="Opacity"]')`;
        assert.ok(await tab.waitFor(field));
        await tab.click(...(await middle(tab, field)));
        await tab.evaluate(`${field}.select()`);
        await tab.type('-');
        assert.ok(await tab.waitFor(`${announced} === "Opacity can't be negative"`));
        assert.equal(await tab.evaluate(`${field}.value`), '100');
        await tab.evaluate(`${field}.select()`);
        await tab.type('50');
        await tab.press('Enter');
        assert.ok(await until(() => shapes().includes('opacity:0.5')), shapes());
        await tab.evaluate(`${field}.select()`);
        await tab.type('250');
        await tab.press('Tab');
        assert.ok(await tab.waitFor(`${announced} === 'Opacity is now at its maximum, 100%' && ${field}.value === '100'`));
        assert.ok(await until(() => shapes() === SHAPES), shapes());
        assert.deepEqual(tab.problems, []);
      } finally {
        await tab.close();
      }
    });

    it('steps the properties panel through its widths from the keyboard', async () => {
      const tab = await openDeck();
      const handle = `document.querySelector('[role="separator"][aria-label="Resize the properties panel"]')`;
      const width = `Number(${handle}.getAttribute('aria-valuenow'))`;
      try {
        assert.ok(await tab.waitFor(`${width} === 304`));
        const [min, max] = await tab.evaluate(`[${handle}.getAttribute('aria-valuemin'), ${handle}.getAttribute('aria-valuemax')].map(Number)`);
        assert.ok(min < 304 && max > 304, `${min}–${max}`);
        await tab.evaluate(`${handle}.focus()`);
        for (const [key, expected] of [['Enter', max], ['Enter', min], ['Enter', 304], ['Home', min], ['End', max]]) {
          await tab.press(key);
          assert.ok(await tab.waitFor(`${width} === ${expected}`), `${key} gave ${await tab.evaluate(width)}, not ${expected}`);
        }
        assert.ok(await tab.waitFor(`Math.round(document.querySelector('[data-open-artifact-properties]').getBoundingClientRect().width) >= ${max - 2}`));
        assert.deepEqual(tab.problems, []);
      } finally {
        await tab.evaluate(`localStorage.removeItem('open-artifact-slides:properties-width')`).catch(() => {});
        await tab.close();
      }
    });

    it('keeps the focus where it was when a toolbar tooltip is pressed', async () => {
      const tab = await openDeck();
      try {
        await selectBack(tab);
        const field = `document.querySelector('input[aria-label="Opacity"]')`;
        await tab.click(...(await middle(tab, field)));
        assert.ok(await tab.waitFor(`document.activeElement === ${field}`));
        const [x, y] = await middle(tab, `document.querySelector('[role="toolbar"][aria-label="Insert"] button[aria-label="Text"]')`);
        await tab.hover(x, y);
        const tip = `[...document.querySelectorAll('[data-side]')].filter(el => el.textContent.startsWith('Text')).at(-1)`;
        assert.ok(await tab.waitFor(tip, 4000), 'no tooltip on the Text button');
        const [tx, ty] = await middle(tab, tip);
        await tab.hover(tx, ty);
        assert.ok(await tab.evaluate(`Boolean((${tip})?.contains(document.elementFromPoint(${tx}, ${ty})))`), 'the press would miss the tooltip');
        await tab.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: tx, y: ty, button: 'left', buttons: 1, clickCount: 1 });
        assert.equal(await tab.evaluate(`document.activeElement === ${field}`), true);
        await tab.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', buttons: 0, clickCount: 1 });
        assert.equal(await tab.evaluate(`document.activeElement === ${field}`), true);
        assert.deepEqual(tab.problems, []);
      } finally {
        await tab.close();
      }
    });

    it('keeps the bottom toolbar on a deck without slides: inserting waits for a slide, asking the agent works', async () => {
      const blank = tmpDir('slides-blank');
      const opened = await run.json(['open', blank, '--type', 'slides', '--title', 'Blank start', '--json']);
      const waiting = await run.start(['wait', blank, '--timeout', '60'], { firstLine: false });
      const tab = await browser.load(new URL('index.html', opened.url).href, { ready: `document.querySelector('[role="toolbar"][aria-label="Insert"]')` });
      try {
        const tools = `[...document.querySelectorAll('[role="toolbar"][aria-label="Insert"] button')].filter(b => !b.closest('form')).map(b => [b.getAttribute('aria-label'), b.getAttribute('aria-disabled') === 'true'])`;
        assert.deepEqual(await tab.evaluate(tools), [['Text', true], ['Image or video', true], ['Table', true], ['Shapes', true]]);
        const ask = `document.querySelector('[role="toolbar"] input[aria-label^="Ask "]')`;
        assert.ok(await tab.waitFor(`${ask} && !${ask}.disabled`), 'no Ask field while the agent waits');
        await tab.evaluate(`${ask}.focus()`);
        await tab.type('Make three slides');
        await tab.press('Enter');
        assert.ok(await until(() => waiting.stdout().includes('Make three slides'), 15000), waiting.stdout() + waiting.stderr());
        assert.deepEqual(tab.problems, []);
      } finally {
        waiting.child.kill();
        await tab.close();
      }
    });

    it('tells why the insert tools wait on a deck without slides, by hover and by keyboard', async () => {
      const blank = tmpDir('slides-blank-tip');
      const opened = await run.json(['open', blank, '--type', 'slides', '--title', 'Blank tips', '--json']);
      const tab = await browser.load(new URL('index.html', opened.url).href, { ready: `document.querySelector('[role="toolbar"][aria-label="Insert"]')` });
      try {
        const [x, y] = await middle(tab, `document.querySelector('[role="toolbar"][aria-label="Insert"] button[aria-label="Text"]')`);
        await tab.hover(x, y);
        assert.ok(await tab.waitFor(`[...document.querySelectorAll('[data-side]')].some(el => el.textContent.includes('Add a slide first'))`, 4000));
        const text = `document.querySelector('[role="toolbar"][aria-label="Insert"] button[aria-label="Text"]')`;
        assert.equal(await tab.evaluate(`document.getElementById(${text}.getAttribute('aria-describedby'))?.textContent`), 'Add a slide first');
        await tab.evaluate(`${text}.click()`);
        assert.equal(await tab.evaluate(`${text}.getAttribute('aria-pressed')`), null, 'the text tool armed on a deck without slides');
        await tab.hover(1, 1);
        await tab.evaluate(`${text}.focus()`);
        await tab.press('ArrowRight');
        assert.ok(await tab.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Image or video'`), 'the arrow keys skip the unavailable insert tools');
        assert.ok(await tab.waitFor(`[...document.querySelectorAll('[data-side]')].some(el => el.textContent.includes('Image or video. Add a slide first'))`, 4000), 'no tip on the focused insert tool');
        assert.deepEqual(tab.problems, []);
      } finally {
        await tab.close();
      }
    });

    it('centers the format strip over the selected text, and keeps it 8px inside the stage', async () => {
      const tab = await openDeck();
      try {
        await tab.click(...(await middle(tab, caption)));
        assert.ok(await tab.waitFor(`${selectedCount} === 1`));
        assert.equal(await tab.evaluate(`Boolean(${strip})`), false, 'a format strip beside the properties panel');
        await propertiesKey(tab);
        assert.ok(await tab.waitFor(`!document.querySelector('[data-open-artifact-properties]')`), '⌘\\ left the properties panel open');
        assert.ok(await tab.waitFor(strip), 'no format strip over the caption');
        const across = `(() => {
          const s = ${strip}.getBoundingClientRect(), c = (${caption}).getBoundingClientRect(), band = ${stage}.getBoundingClientRect();
          return { off: s.left + s.width / 2 - (c.left + c.width / 2), left: s.left - band.left, right: band.right - s.right };
        })()`;
        // The stage widens as the panel goes: the strip follows the caption there.
        await tab.waitFor(`Math.abs(${across}.off) <= 1`, 4000);
        const centered = await tab.evaluate(across);
        assert.ok(Math.abs(centered.off) <= 1, `the strip is ${centered.off}px off the caption's middle`);
        assert.ok(centered.left >= 8 && centered.right >= 8, JSON.stringify(centered));
        // Zoomed in, with the caption's middle 20px inside the stage's left edge: the strip stops 8px inside it.
        assert.equal(await zoomIn(tab), true, 'zooming in left nothing to scroll');
        await tab.evaluate(`(() => {
          const c = (${caption}).getBoundingClientRect(), band = ${stage}.getBoundingClientRect();
          ${stage}.scrollLeft += c.left + c.width / 2 - (band.left + 20);
        })()`);
        assert.ok(await tab.waitFor(`(() => { const c = (${caption}).getBoundingClientRect(); return Math.abs(c.left + c.width / 2 - ${stage}.getBoundingClientRect().left - 20) <= 1; })()`), 'the stage did not scroll there');
        assert.ok(await tab.waitFor(`${strip} && Math.abs(${strip}.getBoundingClientRect().left - ${stage}.getBoundingClientRect().left - 8) <= 1`), JSON.stringify(await tab.evaluate(across)));
        assert.deepEqual(tab.problems, []);
      } finally {
        await forgetView(tab);
        await tab.close();
      }
    });

    it('drags the zoomed stage while Space is held, without touching the selection, and leaves Space to a field', async () => {
      const tab = await openDeck();
      try {
        await selectBack(tab);
        assert.equal(await zoomIn(tab), true, 'zooming in left nothing to scroll');
        const scroll = () => tab.evaluate(`[${stage}.scrollLeft, ${stage}.scrollTop]`);
        const frame = `[...document.querySelector('[data-open-artifact-overlay]').children].find(el => el.classList.contains('border-accent'))`;
        const offBack = `(() => { const f = (${frame}).getBoundingClientRect(), b = (${back}).getBoundingClientRect(); return Math.max(Math.abs(f.left - b.left), Math.abs(f.top - b.top)); })()`;
        assert.ok(await tab.evaluate(`${offBack} < 3`));
        await space(tab, true);
        assert.ok(await tab.waitFor(`${stage}.getAttribute('data-open-artifact-pan') === 'ready'`), 'Space held did not ready the stage for a drag');
        // Pressed on another element: the drag scrolls the stage toward where it has room (across, and down when it can).
        const [left, top] = await scroll();
        const room = await tab.evaluate(`${stage}.scrollHeight - ${stage}.clientHeight`);
        const dx = left > 150 ? 120 : -120, dy = room < 60 ? 0 : top > 50 ? 40 : -40;
        const from = await middle(tab, stageNode(1));
        await tab.dragMouse(from, [from[0] + dx, from[1] + dy]);
        const [afterLeft, afterTop] = await scroll();
        assert.ok(Math.abs(afterLeft - (left - dx)) <= 2 && Math.abs(afterTop - (top - dy)) <= 2, `scrolled from ${[left, top]} to ${[afterLeft, afterTop]} by ${[dx, dy]}`);
        assert.ok(await tab.waitFor(`${selectedCount} === 1 && ${offBack} < 3`), 'the drag changed the selection');
        assert.equal(shapes(), SHAPES);
        assert.equal(await tab.evaluate(`${stage}.getAttribute('data-open-artifact-pan')`), 'ready');
        await space(tab, false);
        assert.ok(await tab.waitFor(`!${stage}.hasAttribute('data-open-artifact-pan')`), 'letting go of Space left the stage ready to drag');

        // In a field Space types a space.
        await chord(tab, 'f', 'KeyF', 70, { mod: true, mac });
        const find = `document.querySelector('input[aria-label="Find in presentation"]')`;
        assert.ok(await tab.waitFor(`document.activeElement === ${find}`));
        await tab.type('Caption');
        await space(tab, true);
        assert.equal(await tab.evaluate(`${stage}.hasAttribute('data-open-artifact-pan')`), false);
        await space(tab, false);
        await tab.type('text');
        assert.equal(await tab.evaluate(`${find}.value`), 'Caption text');
        await tab.press('Escape');
        assert.deepEqual(tab.problems, []);
      } finally {
        await tab.close();
      }
    });

    it('drags the zoomed stage with the middle button, keeping the selection and opening no menu', async () => {
      const tab = await openDeck();
      try {
        await selectBack(tab);
        assert.equal(await zoomIn(tab), true, 'zooming in left nothing to scroll');
        const frame = `[...document.querySelector('[data-open-artifact-overlay]').children].find(el => el.classList.contains('border-accent'))`;
        const offBack = `(() => { const f = (${frame}).getBoundingClientRect(), b = (${back}).getBoundingClientRect(); return Math.max(Math.abs(f.left - b.left), Math.abs(f.top - b.top)); })()`;
        const left = await tab.evaluate(`${stage}.scrollLeft`);
        const dx = left > 150 ? 120 : -120;
        // Pressed on another element, with no key held.
        const [x, y] = await middle(tab, stageNode(1));
        const mouse = (type, at, buttons) => tab.cdp('Input.dispatchMouseEvent', { type, x: at, y, button: 'middle', buttons, clickCount: 1 });
        await tab.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await mouse('mousePressed', x, 4);
        assert.ok(await tab.waitFor(`${stage}.getAttribute('data-open-artifact-pan') === 'drag'`), 'the middle button did not start a drag of the stage');
        for (let n = 1; n <= 10; n++) {
          await mouse('mouseMoved', x + (dx * n) / 10, 4);
          await pause(16);
        }
        await mouse('mouseReleased', x + dx, 0);
        const after = await tab.evaluate(`${stage}.scrollLeft`);
        assert.ok(Math.abs(after - (left - dx)) <= 2, `scrolled from ${left} to ${after} by ${dx}`);
        assert.ok(await tab.waitFor(`!${stage}.hasAttribute('data-open-artifact-pan')`), 'the stage stayed in a drag after the button was let go');
        assert.ok(await tab.waitFor(`${selectedCount} === 1 && ${offBack} < 3`), 'the drag changed the selection');
        assert.equal(await tab.evaluate(`Boolean(document.querySelector('[role="menu"]'))`), false, 'a menu opened');
        assert.equal(shapes(), SHAPES);
        assert.deepEqual(tab.problems, []);
      } finally {
        await tab.close();
      }
    });

    it('leaves Space alone while a menu is open anywhere on the page', async () => {
      const tab = await openDeck();
      try {
        await selectBack(tab);
        // A menu that has not taken the focus: Space pressed on the stage still is not the stage's.
        await tab.evaluate(`(() => { const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); menu.id = 'e2e-open-menu'; document.body.append(menu); })()`);
        await space(tab, true);
        await pause(100);
        assert.equal(await tab.evaluate(`${stage}.hasAttribute('data-open-artifact-pan')`), false, 'Space readied a drag of the stage with a menu open');
        await space(tab, false);
        await tab.evaluate(`document.getElementById('e2e-open-menu').remove()`);
        await space(tab, true);
        assert.ok(await tab.waitFor(`${stage}.getAttribute('data-open-artifact-pan') === 'ready'`), 'Space did not ready the stage once the menu was gone');
        await space(tab, false);
        assert.deepEqual(tab.problems, []);
      } finally {
        await tab.close();
      }
    });

    it('keeps the format strip where it was while the Scale dialog is open, and centers it again once it closes', async () => {
      const tab = await openDeck();
      const off = `(() => { const s = ${strip}.getBoundingClientRect(), c = (${caption}).getBoundingClientRect(); return s.left + s.width / 2 - (c.left + c.width / 2); })()`;
      const stripMiddle = `(() => { const s = ${strip}.getBoundingClientRect(); return s.left + s.width / 2; })()`;
      try {
        await tab.click(...(await middle(tab, caption)));
        assert.ok(await tab.waitFor(`${selectedCount} === 1`));
        await propertiesKey(tab);
        assert.ok(await tab.waitFor(`${strip} && Math.abs(${off}) <= 1`, 4000), 'no format strip centered over the caption');
        await chord(tab, 'k', 'KeyK', 75, { mac });
        assert.ok(await tab.waitFor(`[...document.querySelectorAll('[role="dialog"]')].some(d => d.textContent.includes('Scale'))`), 'K did not open the Scale dialog');
        const before = await tab.evaluate(stripMiddle);
        const width = await tab.evaluate(`(${caption}).getBoundingClientRect().width`);
        // The caption grows on disk while the dialog is open: the strip stays.
        fs.writeFileSync(shapesFile(), SHAPES.replace('width:800px;font-size:48px', 'width:1200px;font-size:48px'));
        assert.ok(await tab.waitFor(`(${caption}).getBoundingClientRect().width > ${width} + 20`, 5000), 'the wider caption never showed');
        await pause(500);
        const held = await tab.evaluate(stripMiddle);
        assert.ok(Math.abs(held - before) <= 1, `the strip moved from ${before} to ${held} with the dialog open`);
        await tab.press('Escape');
        assert.ok(await tab.waitFor(`![...document.querySelectorAll('[role="dialog"]')].some(d => d.textContent.includes('Scale'))`), 'Escape left the Scale dialog open');
        assert.ok(await tab.waitFor(`${strip} && Math.abs(${off}) <= 1`, 2000), `the strip stayed ${await tab.evaluate(off)}px off the caption's middle`);
        assert.deepEqual(tab.problems, []);
      } finally {
        await forgetView(tab);
        await tab.close();
      }
    });

    it('measures from the selection to the hovered element while Alt is held, with the format strip faded', async () => {
      const tab = await openDeck();
      const distances = `[...document.querySelectorAll('[data-open-artifact-distance]')].map(el => el.getAttribute('data-open-artifact-distance'))`;
      try {
        await tab.click(...(await middle(tab, caption)));
        assert.ok(await tab.waitFor(`${selectedCount} === 1`));
        await propertiesKey(tab);
        assert.ok(await tab.waitFor(strip), 'no format strip over the caption');
        assert.equal(await tab.evaluate(`${distances}.length`), 0);
        const [x, y] = await middle(tab, back);
        await alt(tab, true);
        await tab.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers: 1 });
        assert.ok(await tab.waitFor(`${distances}.length > 0`), 'no distances with Alt held over another element');
        const values = await tab.evaluate(distances);
        assert.ok(values.every(value => /^\d+$/.test(value)), values.join());
        assert.ok(await tab.waitFor(`${strip}?.hasAttribute('data-measuring') && getComputedStyle(${strip}).opacity === '0'`), 'the strip does not step aside');
        await alt(tab, false);
        assert.ok(await tab.waitFor(`${distances}.length === 0 && !${strip}?.hasAttribute('data-measuring')`), 'the distances stay after Alt is let go');
        assert.deepEqual(tab.problems, []);
      } finally {
        await forgetView(tab);
        await tab.close();
      }
    });

    it('links the words selected while typing with ⌘K, and gives the text the focus back', async () => {
      const tab = await openDeck();
      try {
        assert.ok(await tab.waitFor(`document.querySelector('[data-open-artifact-properties]')`));
        await tab.clickTimes(...(await middle(tab, caption)), 2);
        assert.ok(await tab.waitFor('document.activeElement?.isContentEditable'));
        const pick = (word, collapse = false) => tab.evaluate(`(() => {
          const walker = document.createTreeWalker(document.activeElement, NodeFilter.SHOW_TEXT);
          for (let text = walker.nextNode(); text; text = walker.nextNode()) {
            const at = text.data.indexOf(${JSON.stringify(word)});
            if (at < 0) continue;
            const range = document.createRange();
            range.setStart(text, at);
            range.setEnd(text, ${collapse} ? at : at + ${word.length});
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            return true;
          }
          return false;
        })()`);
        const linkKey = () => chord(tab, 'k', 'KeyK', 75, { mod: true, mac });
        const field = `document.activeElement?.getAttribute('aria-label') === 'Link address'`;
        assert.ok(await pick('Caption'));
        await linkKey();
        assert.ok(await tab.waitFor(field), '⌘K did not open the link field');
        await tab.type('https://example.com/caption');
        await tab.press('Enter');
        assert.ok(await tab.waitFor(`document.activeElement?.isContentEditable && !document.querySelector('input[aria-label="Link address"]')`), 'the text did not get the focus back');
        // Escape closes the field and returns to the text as well.
        assert.ok(await pick('text'));
        await linkKey();
        assert.ok(await tab.waitFor(field));
        await tab.press('Escape');
        assert.ok(await tab.waitFor(`document.activeElement?.isContentEditable && !document.querySelector('input[aria-label="Link address"]')`), 'Escape did not give the text the focus back');
        // With only a caret there is nothing to link.
        assert.ok(await pick('text', true));
        await linkKey();
        await pause(500);
        assert.equal(await tab.evaluate(`Boolean(document.querySelector('input[aria-label="Link address"]'))`), false, '⌘K opened the link field for a caret');
        assert.ok(await tab.evaluate('document.activeElement?.isContentEditable'));
        await tab.press('Escape');
        assert.ok(await until(() => shapes().includes('<a href="https://example.com/caption">Caption</a> text<')), shapes());
        assert.deepEqual(tab.problems, []);
      } finally {
        await tab.close();
      }
    });

    it('names the table cell a comment is dropped on, with its words', async () => {
      const thread = await commentOn(deckPublic, 'grid', '[data-open-artifact-cell="1:0"]', 'Check this cell');
      assert.match(thread.label, /Row 2, column 1/, thread.label);
      assert.match(thread.label, /A2/, thread.label);
      assert.deepEqual(thread.location?.cell, { row: 2, column: 1 }, JSON.stringify(thread.location));
      assert.deepEqual(JSON.parse(thread.anchor).cell, [1, 0], thread.anchor);
    });

    it('keeps the focus on the page when a banner goes or the find bar closes', async () => {
      const first = await openDeck();
      // Unsaved changes from an earlier visit: the next one offers them back.
      await first.evaluate(`localStorage.setItem('open-artifact-slides:recovery:' + location.pathname, ${JSON.stringify(JSON.stringify({ at: Date.now(), slides: { shapes: SHAPES.replace('Caption text', 'Unsaved caption') } }))})`);
      await first.close();
      const tab = await openDeck();
      const forgetRecovery = () => tab.evaluate(`localStorage.removeItem('open-artifact-slides:recovery:' + location.pathname)`).catch(() => {});
      try {
        const discard = `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Discard')`;
        assert.ok(await tab.waitFor(discard), 'no banner offering the unsaved changes');
        await tab.click(...(await middle(tab, discard)));
        assert.ok(await tab.waitFor(`!(${discard})`));
        const onPage = `document.activeElement && document.activeElement !== document.body && document.activeElement !== document.documentElement`;
        assert.ok(await tab.waitFor(onPage, 2000), 'the focus fell to the page after Discard');
        for (const close of ['key', 'button']) {
          await chord(tab, 'f', 'KeyF', 70, { mod: true, mac });
          assert.ok(await tab.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Find in presentation'`));
          if (close === 'key') await tab.press('Escape');
          else await tab.evaluate(`document.querySelector('[role="search"] button[aria-label="Close"]').click()`);
          assert.ok(await tab.waitFor(`!document.querySelector('[role="search"]')`));
          assert.ok(await tab.waitFor(onPage, 2000), `the focus fell to the page after the find bar closed by ${close}`);
        }
        assert.equal(shapes(), SHAPES);
        assert.deepEqual(tab.problems, []);
      } finally {
        await forgetRecovery();
        await tab.close();
      }
    });

    it('holds each collapsible properties heading around its button, and keeps the focus in the panel when a removed shadow takes its row', async () => {
      const shadowed = SHAPES.replace('background:#cc3333"', 'background:#cc3333;box-shadow:0px 4px 12px rgba(0,0,0,0.25)"');
      const tab = await openDeck('shapes', shadowed);
      try {
        await selectBack(tab);
        assert.ok(await tab.waitFor(`document.querySelector('[data-open-artifact-properties] h3 > button[aria-expanded]')`), 'no heading holds a section button');
        const remove = `document.querySelector('[data-open-artifact-properties] button[aria-label^="Remove"][aria-label$="shadow"]')`;
        assert.ok(await tab.waitFor(remove), 'no button removes the shadow');
        await tab.evaluate(`${remove}.focus()`);
        await tab.press('Enter');
        assert.ok(await until(() => !shapes().includes('box-shadow')), shapes());
        assert.ok(await tab.waitFor(`!${remove}`));
        assert.ok(await tab.waitFor(`document.activeElement !== document.body && document.activeElement?.closest('[data-open-artifact-properties]')`, 2000),
          `the focus went to ${await tab.evaluate('document.activeElement?.outerHTML.slice(0, 120)')}`);
        assert.deepEqual(tab.problems, []);
      } finally {
        await tab.close();
      }
    });
  });

  // Last, after the tests on the main deck: this opens a deck of its own on the same server and writes into it.
  it('warns in the PDF options while the deck is still being written, and says when every slide is in', { skip: browserSkip }, async () => {
    const deck = tmpDir('slides-writing');
    fs.mkdirSync(path.join(deck, 'project', 'slides'), { recursive: true });
    fs.writeFileSync(path.join(deck, 'project', 'deck.json'), JSON.stringify({
      v: 5, lists: 'css', title: 'Half written', order: ['first', 'second'], createdOnFiles: { v: 1, at: '2026-11-26T00:00:00Z' },
      sections: {}, faces: {}, designSystems: [],
    }));
    const slideFile = id => path.join(deck, 'project', 'slides', id + '.html');
    fs.writeFileSync(slideFile('first'), '<section id="first"><h1>First</h1></section>');
    const { url: deckPublic } = await run.json(['open', deck, '--json']);
    const shell = await browser.load(deckPublic + '#slide-~first', { ready: `document.querySelector('[data-comments-button]')` });
    try {
      // A file changed on disk: the agent is at work, and the outline still lists a slide it has not written.
      fs.writeFileSync(slideFile('first'), '<section id="first"><h1>First slide</h1></section>');
      assert.ok(await shell.waitFor(`document.querySelector('[data-open-artifact-mode="edit"] h1')?.textContent === 'First slide'`));
      await chooseExport('PDF', shell);
      const warning = `document.querySelector('[role="dialog"] [data-testid="slides-download-warning"]')`;
      const buttons = `[...document.querySelectorAll('[role="dialog"] button')].map(b => b.textContent.trim())`;
      assert.ok(await shell.waitFor(`${warning}?.textContent.includes('1 of 2')`), 'no warning that a slide is missing');
      assert.ok(await shell.waitFor(`${buttons}.includes('Download anyway') && !${buttons}.includes('Download')`));
      assert.ok(await shell.waitFor(`document.activeElement?.closest('[role="dialog"]') && document.activeElement.textContent.trim() === 'Cancel'`), 'the dialog does not open on Cancel');
      fs.writeFileSync(slideFile('second'), '<section id="second"><h1>Second</h1></section>');
      const status = `document.querySelector('[role="dialog"] [data-testid="slides-download-warning-status"]')`;
      assert.ok(await shell.waitFor(`${status}?.textContent.includes('Every slide is written') && ${warning}?.textContent.includes('Every slide is written')`), 'the dialog does not say the warning is gone');
      assert.ok(await shell.waitFor(`${buttons}.includes('Download')`));
      await shell.evaluateAll(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Cancel')?.click()`);
      assert.deepEqual(shell.problems, []);
    } finally {
      // Not stopped: the deck under test shares its server (the suite stops it at the end).
      await shell.close();
    }
  });
});
