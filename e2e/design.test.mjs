// End-to-end tests of the design type: the shared main path (lib/editor.mjs), plus what only a design has: boards
// in canvas.json, pages, image notes, the "Ask agent to fix" button on a board that throws, and an unreadable
// canvas.json the editor must leave alone.
//
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createTypeServer } from '../packages/type-server/src/server.ts';
import { buttonNamed, clickOn, editorSuite, middleOf, startWait, textIn, typeInto } from './lib/editor.mjs';
import { blockFont } from './lib/font.mjs';
import { png, until } from './lib/http.mjs';
import { copyFixture, fixtures, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 90000 };
const BOARD = 'project/Main.dc.html';
const canvasOf = root => JSON.parse(fs.readFileSync(path.join(root, 'project', 'canvas.json'), 'utf8'));

// Run the real frame shell and its daemon with the installed type under test.
async function withDesignShell(ctx, root, ready, check) {
  const home = tmpDir('design-frame-shell');
  const env = {
    ...process.env, HOME: ctx.userHome, OPEN_ARTIFACT_HOME: home, OPEN_ARTIFACT_PORT: '0',
    OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(home, 'type-server'),
    OPEN_ARTIFACT_BUILTIN_TYPES: path.dirname(ctx.typeDir),
    OPEN_ARTIFACT_SHELL_DIR: path.join(repoRoot, 'dist/daemon/shell'),
  };
  const bin = path.join(repoRoot, 'packages/daemon/src/bin/open-artifact.ts');
  const run = (...args) => promisify(execFile)(process.execPath, [bin, ...args], { cwd: repoRoot, env, timeout: 30000 });
  try {
    const { stdout } = await run('artifact', JSON.stringify({ action: 'publish', type_url: 'open-artifact://type/design', folder: root, title: 'Design test' }), '--workspace', path.dirname(root));
    const browser = await ctx.browser();
    await browser.downloadsTo(ctx.downloads);
    const page = await browser.load(JSON.parse(stdout).view_url, { ready });
    try {
      assert.ok(await page.waitFor(ready), 'Design loaded in the frame shell');
      await check(page);
    } finally { await page.close(); }
  } finally { await run('daemon', 'stop'); }
}

// An artboard whose first line, "....", is set in the block font (lib/font.mjs) from the project's own files, through an
// inline @font-face: a solid bar from (20, 20) to (180, 60) in INK. In a fallback font the dots sit at the foot of the
// line and the top of it stays PAPER. With `han`, the font also draws 2000 ideographs and the bar is "丂丂丂丂" (U+4E02,
// which no list counter makes), so a picture of it carries a subset of the font.
const INK = [200, 20, 50];
const PAPER = [255, 247, 214];
function webFontBoard(root, entry = {}, { han = false } = {}) {
  copyFixture('design', root);
  fs.mkdirSync(path.join(root, 'project/fonts'));
  fs.writeFileSync(path.join(root, 'project/fonts/Block.ttf'), blockFont('Block', { han }));
  const index = canvasOf(root);
  Object.assign(index.boards['Main.dc.html'], { title: 'Web font', ...entry });
  fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(index));
  const template = `<x-dc><helmet><style>
    @font-face{font-family:"Block";src:url("fonts/Block.ttf") format("truetype")}
    body{margin:0}
  </style></helmet><div style="width:880px;height:560px;background:rgb(${PAPER});position:relative">
    <p id="block" style="position:absolute;left:20px;top:20px;margin:0;font:40px/40px Block,monospace;color:rgb(${INK})">${han ? '丂丂丂丂' : '....'}</p>
    <p style="position:absolute;left:20px;top:100px;margin:0;font:16px sans-serif">Set in a web font</p></div></x-dc>`;
  const file = path.join(root, BOARD);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/<x-dc>[\s\S]*?<\/x-dc>/, template));
}
// The artboard's frame loaded the block font (so a picture without it lost it on the way).
const WEB_FONT_LOADED = `[...(document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.fonts ?? [])].some(face => face.family.replace(/["']/g, '') === 'Block' && face.status === 'loaded')`;
// Whether a pixel is nearly a colour (JPEG moves it a little).
const near = (pixel, colour) => pixel.every((value, i) => Math.abs(value - colour[i]) <= 24);
// Pixels of a picture (a `source` expression for an image: a URL in quotes, or an element), at points given at 1×.
const pixelsOf = (page, source, points, scale = 1) => page.evaluate(`(async () => {
  let image = ${source};
  if (typeof image === 'string') { const url = image; image = new Image(); image.src = url; }
  await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const g = canvas.getContext('2d'); g.drawImage(image, 0, 0);
  return { width: canvas.width, height: canvas.height, pixels: ${JSON.stringify(points)}.map(([x, y]) => [...g.getImageData(x * ${scale}, y * ${scale}, 1, 1).data].slice(0, 3)) };
})()`);
// The first page of an exported PDF: its picture is stored as the JPEG it was drawn as.
function pdfPagePicture(file) {
  const pdf = fs.readFileSync(file);
  const at = pdf.indexOf('/DCTDecode');
  assert.ok(at > 0, 'the PDF holds no JPEG page');
  const length = Number(/\/Length (\d+)/.exec(pdf.subarray(at, at + 200).toString('latin1'))?.[1]);
  const start = pdf.indexOf('stream\n', at) + 'stream\n'.length;
  return `'data:image/jpeg;base64,${pdf.subarray(start, start + length).toString('base64')}'`;
}

async function shellExport(page, label) {
  await clickOn(page, buttonNamed('Share'));
  assert.ok(await page.waitFor("document.querySelector('[data-share-link=viewer]')"), 'global Share panel has role links');
  await clickOn(page, buttonNamed('Export'));
  const row = `document.querySelector('[data-export-row="' + ${JSON.stringify(label)} + '"]:not(:disabled)')`;
  assert.ok(await page.waitFor(row), label);
  await page.evaluate(`(${row}).scrollIntoView({block: 'center'})`);
  await clickOn(page, row, label);
}

/**
 * The comment box stops at 4,096 characters (its maxLength), and a comment over 4,096 bytes of UTF-8 that fits it is
 * not sent: the page says so and keeps the draft, as claude.ai's comment boxes do. Leaves the box empty.
 */
async function refuseLongComment(shell, root) {
  // The comment layer is in a frame of the Shell: read the focused box in whichever frame has it.
  const value = async () => (await shell.evaluateAll("document.activeElement?.shadowRoot?.activeElement?.value")).find(v => typeof v === 'string');
  const clear = async () => {
    await shell.press('a', { meta: true, commands: ['selectAll'] });
    await shell.press('Backspace');
    assert.equal(await value(), '');
  };
  await shell.cdp('Input.insertText', { text: 'x'.repeat(4097) });
  assert.equal((await value())?.length, 4096, 'the comment box stops at its maxLength');
  await clear();
  // 1,366 CJK characters are 4,098 bytes, though under the maxLength: refused, the draft kept, nothing saved.
  const wide = '蓝'.repeat(1366);
  await shell.cdp('Input.insertText', { text: wide });
  await shell.press('Enter');
  const told = "[...document.querySelectorAll('[data-toast], [role=status], [role=alert], .toast')].some(el => el.textContent.includes('That comment is too long.'))";
  assert.ok(await shell.waitFor(told, 10000), 'the page says the comment is too long');
  assert.equal(await value(), wide, 'the draft stays in the box');
  const file = path.join(root, 'comments.json');
  assert.ok(!fs.existsSync(file) || !fs.readFileSync(file, 'utf8').includes(wide), 'the long comment is not saved');
  await clear();
}

async function postShellComment(shell, root) {
  assert.ok(await shell.waitFor("document.querySelector('[data-comments-button]')"));
  await clickOn(shell, buttonNamed('Comments'));
  assert.ok(await shell.waitFor("document.querySelector('[data-comment-capture]')"));
  const point = await shell.evaluate(`(() => {
    const r = document.querySelector('iframe').getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  })()`);
  await shell.click(...point);
  assert.ok(await shell.waitFor("document.activeElement?.shadowRoot?.activeElement?.matches('textarea')"));
  await refuseLongComment(shell, root);
  await shell.type('Frame shell review');
  await shell.press('Enter');
  const file = path.join(root, 'comments.json');
  assert.ok(await until(() => fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('Frame shell review')), 'anchored comment saved');
  await clickOn(shell, buttonNamed('Comment options'));
  await clickOn(shell, "[...document.querySelectorAll('[role=menuitem]')].find(el => el.textContent.includes('Show all comments'))");
  assert.ok(await shell.waitFor("document.querySelector('[data-comments-panel-layer]')?.shadowRoot?.querySelector('[data-comments-panel]')?.innerText.includes('Frame shell review')"));
}

editorSuite({
  type: 'design',
  make: (ctx, root) => copyFixture('design', root),
  broken: (ctx, root) => {
    copyFixture('design', root);
    const board = path.join(root, BOARD);
    fs.writeFileSync(board, fs.readFileSync(board, 'utf8').replace('<script src="./support.js"></script>\n', ''));
  },
  pageText: 'Smoke canvas',
  save: { file: BOARD, edit: text => text.replace('An artboard the smoke test opens.', 'An artboard the page saved.') },
  diskEdit: {
    apply: ctx => {
      const board = path.join(ctx.root, BOARD);
      fs.writeFileSync(board, fs.readFileSync(board, 'utf8').replace('>Smoke canvas</h1>', '>Edited on disk</h1>'));
    },
    text: 'Edited on disk',
  },

  offline(ctx) {
    it('check names the support.js line a board leaves out', T, async () => {
      const bad = path.join(tmpDir('design-nosupport'), 'artifact');
      ctx.spec.broken(ctx, bad);
      const out = await ctx.cli.run(['check', bad, '--json']);
      assert.equal(out.code, 1);
      const error = out.json.findings.find(f => f.level === 'error' && f.file === 'Main.dc.html');
      assert.ok(error, out.stdout);
      assert.match(error.message, /<script src="\.\/support\.js"><\/script>/);
    });

    it('check flags a board that canvas.json does not place', T, async () => {
      const root = path.join(tmpDir('design-unplaced'), 'artifact');
      copyFixture('design', root);
      fs.copyFileSync(path.join(root, BOARD), path.join(root, 'project', 'Loose.dc.html'));
      const out = await ctx.cli.run(['check', root, '--json']);
      assert.equal(out.code, 1, out.stdout);
      assert.ok(out.json.findings.some(f => f.level === 'error' && /Loose\.dc\.html/.test(`${f.file} ${f.message}`)), out.stdout);
    });

    it('list finds the design systems under the folders given, and none where there are none', T, async () => {
      const shelf = tmpDir('design-shelf');
      copyFixture('design-system', path.join(shelf, 'Smoke System'));
      const found = await ctx.cli.json(['list', shelf]);
      assert.equal(found.systems.length, 1, JSON.stringify(found));
      const [system] = found.systems;
      assert.equal(system.title, 'Smoke System');
      assert.equal(system.namespace, 'SmokeSystem');
      assert.equal(system.root, path.join(shelf, 'Smoke System'));
      const none = await ctx.cli.json(['list', tmpDir('design-noshelf')]);
      assert.deepEqual(none.systems, []);
    });
  },

  chrome(ctx) {
    it('Refresh picks up a missed file change without losing the canvas, selection or Ask draft', T, async () => {
      const root = tmpDir('design-refresh');
      copyFixture('design', root);
      const board = `document.querySelector('[data-board-title="Main.dc.html"]')`;
      await withDesignShell(ctx, root, board, async page => {
        const bounds = async () => (await page.evaluateAll(`(() => {
          const rect = ${board}?.getBoundingClientRect();
          return rect && [rect.x, rect.y, rect.width];
        })()`)).find(Boolean);
        const [x, y, width] = await bounds();
        const top = await page.evaluate(`document.querySelector('iframe[name="open-artifact-shell"]').getBoundingClientRect().top`);
        await page.click(x + 12, top + y + 8);
        assert.ok(await page.waitFor(`${board}?.querySelector('.text-accent')`), 'the board was selected');
        await page.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 400, deltaX: 36, deltaY: 62 });
        assert.ok(await until(async () => (await bounds())[1] !== y));
        await page.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 400, deltaX: 0, deltaY: -80, modifiers: 2 });
        assert.ok(await until(async () => (await bounds())[2] !== width));
        await page.evaluateAll(`[...document.querySelectorAll('[aria-label="Canvas tools"] button')].find(b => /^Ask /i.test(b.textContent.trim()))?.click()`);
        const draft = `document.querySelector('textarea[placeholder]')`;
        assert.ok(await page.waitFor(`${draft} && document.activeElement === ${draft}`));
        await page.cdp('Input.insertText', { text: 'Keep this draft' });
        // A writer does not receive its own change event. Leave a real change on disk that the editor missed.
        await page.evaluateAll(`(async () => {
          if (!${board}) return;
          const artifact = await window.openartifact.use('artifact');
          const path = 'project/canvas.json';
          const canvas = JSON.parse(await artifact.readText(path));
          canvas.boards['Main.dc.html'].title = 'Updated on disk';
          const boardPath = 'project/Main.dc.html';
          const source = await artifact.readText(boardPath);
          await artifact.publish({
            [path]: { content: JSON.stringify(canvas) },
            [boardPath]: { content: source.replace('>Smoke canvas</h1>', '>Updated artboard</h1>') },
          });
        })()`);
        assert.equal(canvasOf(root).boards['Main.dc.html'].title, 'Updated on disk');
        assert.ok(!(await page.evaluateAll(`${board}?.textContent.includes('Updated on disk')`)).includes(true));

        const camera = await bounds();
        await clickOn(page, buttonNamed('Artifact options'));
        await clickOn(page, buttonNamed('Refresh'));
        assert.ok(await page.waitFor(`${board}?.textContent.includes('Updated on disk')`), 'the editor reread the file');
        assert.ok((await page.evaluateAll(`${draft}?.value`)).includes('Keep this draft'), 'the draft survived Refresh');
        assert.deepEqual(await bounds(), camera, 'the camera stayed in place');
        assert.ok(await page.waitFor(`${board}?.querySelector('.text-accent')`), 'the board stayed selected');
        assert.ok(await page.waitFor(textIn('Updated artboard')), 'the editor rendered the changed board source');
        assert.ok(await page.waitFor(textIn('Artifact refreshed')));
      });
    });

    for (const renderer of ['default', 'dom']) {
      it(`link cards and prototype navigation in the ${renderer} canvas`, T, async () => {
        const { root, url } = await ctx.openNew('prototype', (_ctx, root) => {
          copyFixture('design', root);
          const canvas = canvasOf(root);
          const entry = canvas.boards['Main.dc.html'];
          Object.assign(entry, { is_interactive: true, guides: [{ kind: 'columns', count: 3 }, { kind: 'rows', hidden: true }] });
          canvas.boards['Next.dc.html'] = { ...entry, title: 'Next', x: 960, guides: [] };
          canvas.order.push('Next.dc.html');
          canvas.notes.deck = { x: 0, y: 660, kind: 'link', title: 'Menu deck', href: 'https://example.com/menu' };
          fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(canvas));
          const source = fs.readFileSync(path.join(root, BOARD), 'utf8');
          fs.writeFileSync(path.join(root, BOARD), source.replace('</p>', '</p><a href="Next.dc.html">Continue</a>'));
          fs.writeFileSync(path.join(root, 'project/Next.dc.html'), source.replace('>Smoke canvas</h1>', '>Next screen</h1><a href="#end">Jump down</a><div style="height:1500px"></div><p id="end">End</p>'));
        });
        const browser = await ctx.browser();
        const address = new URL('index.html', url);
        if (renderer === 'dom') address.searchParams.set('open_artifact_engine', 'off');
        const page = await browser.load(address.href, { ready: textIn('Smoke canvas') });
        try {
          assert.ok(await page.waitFor(textIn('Menu deck')));
          assert.equal(await page.evaluate("document.querySelectorAll('[data-layout-guide]').length"), 1);
          const clickTitle = name => page.evaluate(`document.querySelector('[data-board-title="Main.dc.html"] button[aria-label="${name}"]').click()`);
          await clickTitle('Play on canvas');
          assert.ok(await page.waitFor(`document.querySelector('[aria-label="Stop playing"]') && !document.querySelector('[data-layout-guide]')`));
          const at = await page.evaluate(`(() => {
            const frame = document.querySelector('iframe[data-board="Main.dc.html"]');
            const rect = frame.getBoundingClientRect();
            const link = frame.contentDocument.querySelector('a[href="Next.dc.html"]').getBoundingClientRect();
            const zoom = rect.width / frame.offsetWidth;
            return { x: rect.left + (link.left + 10) * zoom, y: rect.top + (link.top + link.height / 2) * zoom };
          })()`);
          await page.click(at.x, at.y);
          assert.ok(await page.waitFor(`document.querySelector('[data-board-title="Next.dc.html"] button[aria-label="Stop playing"]')`));
          await clickOn(page, buttonNamed('Stop playing'));
          assert.ok(await page.waitFor(`document.querySelector('[data-layout-guide="columns"]')`));
          await clickTitle('Tweaks');
          await clickOn(page, buttonNamed('Properties'));
          await clickOn(page, buttonNamed('Hide guide'));
          assert.ok(await until(() => canvasOf(root).boards['Main.dc.html'].guides[0].hidden, 10000));
          await page.evaluate(`(${buttonNamed('Add guide')}).scrollIntoView({ block: 'center' })`);
          await clickOn(page, buttonNamed('Add guide'));
          assert.ok(await until(() => canvasOf(root).boards['Main.dc.html'].guides.length === 3, 10000));
          await clickOn(page, buttonNamed('Close panel'));
          if (renderer === 'dom') return;
          assert.equal(await page.evaluate(`document.querySelector('[aria-label="Export"],[aria-label="Export canvas"],[aria-label="Comment"]') !== null`), false);
          await withDesignShell(ctx, root, textIn('Menu deck'), async shell => {
            const dir = ctx.downloads;
            await shellExport(shell, 'HTML · Standalone web page (all artboards on this page)');
            const file = path.join(dir, 'Smoke canvas.html');
            assert.ok(await until(() => fs.existsSync(file), 30000), 'the standalone export was not saved');
            const server = createServer((_req, res) => {
              res.setHeader('content-type', 'text/html');
              fs.createReadStream(file).pipe(res);
            });
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            try {
              for (const address of [pathToFileURL(file).href, `http://127.0.0.1:${server.address().port}/design.html`]) {
                const exported = await browser.load(address, { ready: textIn('Next screen') });
                try {
                  assert.equal(await exported.evaluate("document.querySelectorAll('iframe').length"), 2);
                  await exported.evaluateAll(`document.querySelector('a[href="Next.dc.html"]')?.click()`);
                  assert.ok(await exported.waitFor(`document.querySelector('iframe')?.srcdoc.includes('Jump down')`));
                  await exported.evaluateAll(`document.querySelector('a[href="#end"]')?.click()`);
                  assert.ok(await exported.waitFor('document.scrollingElement.scrollTop > 100'));
                  assert.deepEqual(exported.problems, []);
                } finally { await exported.close(); }
              }
            } finally { await new Promise(resolve => server.close(resolve)); }
            await shellExport(shell, 'HTML · All artboards on this page for Figma');
            const figma = path.join(dir, 'Smoke canvas.figma.html');
            assert.ok(await until(() => fs.existsSync(figma), 30000));
            const flat = fs.readFileSync(figma, 'utf8');
            assert.equal((flat.match(/<section class="artboard"/g) ?? []).length, 2);
            assert.doesNotMatch(flat, /<iframe|<script|data-layout-guide/i);
            assert.match(flat, /Next screen/);
            await postShellComment(shell, root);
          });
          assert.deepEqual(page.problems, []);
        } finally { await page.close(); }
      });
    }

    it('the CLI opens the global shell and copies a link to the selected design page', T, async () => {
      const { url } = await ctx.openNew('design-page-share', (_ctx, root) => {
        copyFixture('design', root);
        const index = canvasOf(root);
        index.pages = [{ id: 'first', name: 'First page' }, { id: 'review', name: 'Review page' }];
        fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(index));
      });
      const browser = await ctx.browser();
      const pageButton = 'button[aria-label^="Pages:"]';
      const onPage = name => `document.querySelector('${pageButton}')?.innerText.includes(${JSON.stringify(name)})`;
      const shell = await browser.load(url + '#page=review', { ready: onPage('Review page') });
      try {
        assert.ok(await shell.waitFor(onPage('Review page')), 'opened the linked page');
        const clickEditorButton = async expression => {
          const point = await shell.evaluate(`(() => {
            const frame = document.querySelector('iframe[name="open-artifact-shell"]');
            const doc = frame.contentDocument;
            const button = ${expression};
            const bounds = button.getBoundingClientRect();
            const offset = frame.getBoundingClientRect();
            return [bounds.x + offset.x + bounds.width / 2, bounds.y + offset.y + bounds.height / 2];
          })()`);
          await shell.click(...point);
        };
        await clickEditorButton(`doc.querySelector('${pageButton}')`);
        const first = `[...doc.querySelectorAll('button')].find(el => el.textContent.trim() === 'First page')`;
        assert.ok(await shell.waitFor(buttonNamed('First page')));
        await clickEditorButton(first);
        assert.ok(await shell.waitFor("window === top && location.hash === '#page=first'"));
        await shell.cdp('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
        await clickOn(shell, buttonNamed('Share'));
        await clickOn(shell, buttonNamed('Copy link'));
        assert.ok(await shell.waitFor(buttonNamed('Copied')));
        const link = await shell.evaluate('navigator.clipboard.readText()');
        assert.equal(link, url + '#page=first');
        const reopened = await browser.load(link, { ready: onPage('First page') });
        try {
          assert.ok(await reopened.waitFor(onPage('First page')));
          assert.ok(await reopened.evaluate("Boolean(document.querySelector('header [data-comments-button]'))"));
        } finally { await reopened.close(); }
      } finally { await shell.close(); }
    });

    it('readable links open an artboard on its page, or run it, and settle on the page link', T, async () => {
      const { url } = await ctx.openNew('design-place-links', (_ctx, root) => {
        copyFixture('design', root);
        const index = canvasOf(root);
        index.pages = [{ id: 'first', name: 'First page' }, { id: 'review', name: 'Review page' }];
        index.boards['Main.dc.html'].page = 'review';
        fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(index));
      });
      const browser = await ctx.browser();
      const onPage = name => `document.querySelector('button[aria-label^="Pages:"]')?.innerText.includes(${JSON.stringify(name)})`;
      const shell = await browser.load(url + '#artboard-main', { ready: onPage('Review page') });
      try {
        assert.ok(await shell.waitFor(onPage('Review page')), 'opened the artboard\'s page');
        assert.ok(await shell.waitFor("window === top && location.hash === '#page=review'"), 'the address names the page');
        assert.ok(await shell.waitFor(`document.querySelector('[data-board-title="Main.dc.html"] .text-accent')`), 'the artboard is selected');
        assert.deepEqual(shell.problems, []);
      } finally { await shell.close(); }
      const playing = await browser.load(url + '#play-main-dc-html', { ready: onPage('Review page') });
      try {
        assert.ok(await playing.waitFor(buttonNamed('Stop playing')), 'the artboard runs on the canvas');
      } finally { await playing.close(); }
      const unknown = await browser.load(url + '#artboard-nowhere', { ready: onPage('First page') });
      try {
        assert.ok(await unknown.waitFor(onPage('First page')), 'an unknown name opens the canvas as usual');
      } finally { await unknown.close(); }
    });

    it('guest links open the global comment controls with the guest role', T, async () => {
      const root = tmpDir('design-guest-frame');
      copyFixture('design', root);
      const index = canvasOf(root);
      index.pages = [{ id: 'first', name: 'First page' }, { id: 'review', name: 'Review page' }];
      fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(index));
      const server = createTypeServer({ assetsDir: path.join(ctx.typeDir, 'scripts'), idleMs: 0, secret: 'test-owner',
        lanAddresses: () => [], isLocal: req => req.headers['x-test-owner'] === 'yes' });
      await server.listen();
      try {
        const opened = await server.open({ root, type: 'design' });
        const response = await fetch(new URL('/__open-artifact/share', opened.url), { method: 'POST',
          headers: { authorization: 'Bearer test-owner', 'content-type': 'application/json', 'x-test-owner': 'yes' },
          body: JSON.stringify({ id: opened.id, lan: true }) });
        assert.equal(response.status, 200);
        const { links } = await response.json();
        for (const role of ['commenter', 'viewer']) {
          const page = await (await ctx.browser()).load(links[role].url + '#page=review', { ready: "document.querySelector('input[name=name]')" });
          try {
            await typeInto(page, "document.querySelector('input[name=name]')", role);
            await page.press('Enter');
            assert.ok(await page.waitFor("document.querySelector('header [data-comments-button]')"));
            assert.ok(await page.waitFor("document.querySelector('button[aria-label^=Pages]')?.innerText.includes('Review page')"), 'invite retains the page through sign-in');
            await clickOn(page, buttonNamed('Share'));
            assert.ok(await page.waitFor(buttonNamed('Copy link')));
            assert.equal(await page.evaluate("Boolean(document.querySelector('[data-share-link=viewer]'))"), false);
            assert.equal(await page.evaluate(`Boolean(${buttonNamed('Export')})`), false);
            await page.press('Escape');
            if (role === 'commenter') await postShellComment(page, root);
            else {
              await clickOn(page, buttonNamed('Comments'));
              assert.ok(await page.waitFor("document.querySelector('[data-comments-panel-layer]')?.shadowRoot?.querySelector('[data-comments-panel]')?.innerText.includes('Frame shell review')"));
            }
          } finally { await page.close(); }
        }
      } finally { await server.stop(); }
    });

    it('a served board in a nested export folder follows a prototype link up one level', T, async () => {
      const source = fs.readFileSync(path.join(fixtures, 'design', BOARD), 'utf8');
      const runtime = fs.readFileSync(path.join(ctx.typeDir, 'scripts/support.js'));
      const server = createServer((req, res) => {
        const url = req.url;
        if (url === '/site/flow/support.js' || url === '/site/support.js') {
          res.setHeader('content-type', 'text/javascript');
          return res.end(runtime);
        }
        res.setHeader('content-type', 'text/html');
        if (url === '/site/flow/Start.dc.html') return res.end(source.replace('</p>', '</p><a href="../End.dc.html">Go up</a>'));
        if (url === '/site/End.dc.html') return res.end(source.replace('>Smoke canvas</h1>', '>End screen</h1>'));
        res.writeHead(404); res.end();
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const page = await (await ctx.browser()).load(`http://127.0.0.1:${server.address().port}/site/flow/Start.dc.html`, { ready: "document.querySelector('a[href]')" });
        try {
          await page.evaluate('document.querySelector("a[href]").click()');
          assert.ok(await page.waitFor("location.pathname === '/site/End.dc.html' && document.querySelector('h1')?.textContent === 'End screen'"));
        } finally { await page.close(); }
      } finally { await new Promise(resolve => server.close(resolve)); }
    });

    it('PNG and Figma exports preserve SVG use colours, CSS masks and label positions', T, async () => {
      const { root } = await ctx.openNew('design-icon-export', (_ctx, root) => {
        copyFixture('design', root);
        const index = canvasOf(root);
        index.launch = { view: 'focused', file: 'Main.dc.html' };
        Object.assign(index.boards['Main.dc.html'], { title: 'Icon samples', w: 180, h: 60 });
        fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(index));
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 40 40"><path fill-rule="evenodd" d="M0 0h40v40H0z M10 10v20h20V10z"/></svg>';
        const id = 'abcdeabcdeabcdeabcdeabcdeabcde12';
        fs.mkdirSync(path.join(root, 'project/assets'));
        fs.writeFileSync(path.join(root, 'project/assets', id + '.svg'), svg);
        const file = path.join(root, BOARD);
        const template = `<x-dc><helmet><style>
          body{margin:0}.icon{position:absolute;top:0;width:40px;height:40px}
          .outline{fill:none;stroke:currentColor;stroke-width:4}.disc path{fill:currentColor}
          .mask,.pseudo::before{background:#1674c8;mask:url("/_blob/${id}") center / contain no-repeat}
          .pseudo::before{content:"";position:absolute;inset:0}
        </style></helmet><div style="width:180px;height:60px;background:#fff7d6;color:#333;position:relative">
          <svg class="icon" viewBox="0 0 40 40"><defs><symbol id="outline" class="outline"><rect x="4" y="4" width="32" height="32"/></symbol></defs><use href="#outline" style="color:#c81432"/></svg>
          <div class="icon mask" style="left:40px"></div><div class="icon pseudo" style="left:80px"></div>
          <svg class="icon" style="left:120px" viewBox="0 0 40 40"><defs><symbol id="disc" class="disc"><path d="M0 0h40v40H0z"/></symbol></defs><use href="#disc" style="color:#1e8c3c"/></svg>
          <span id="caption" style="position:absolute;left:6px;top:40px">Icon labels</span></div></x-dc>`;
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/<x-dc>[\s\S]*?<\/x-dc>/, template));
      });
      const browser = await ctx.browser();
      await withDesignShell(ctx, root, textIn('Icon labels'), async page => {
        const download = async (label, name) => {
          await shellExport(page, label);
          const file = path.join(ctx.downloads, name);
          assert.ok(await until(() => fs.existsSync(file), 30000), name);
          return file;
        };
        const file = await download('PNG · Selected artboard, 1×', 'Icon samples.png');
        const png = fs.readFileSync(file).toString('base64');
        const pixels = await page.evaluate(`(async () => {
          const image = new Image(); image.src = 'data:image/png;base64,${png}'; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const g = canvas.getContext('2d'); g.drawImage(image, 0, 0);
          return [4,20,45,60,85,100,140].map(x => [...g.getImageData(x,20,1,1).data].slice(0,3));
        })()`);
        const paper = [255,247,214], blue = [22,116,200];
        assert.deepEqual(pixels, [[200,20,50], paper, blue, paper, blue, paper, [30,140,60]]);
        await page.evaluateAll(`(${buttonNamed('Fill')})?.click()`);
        assert.ok(await page.waitFor(buttonNamed('Preview width')));
        const [width] = (await page.evaluateAll(`parseInt((${buttonNamed('Preview width')})?.textContent)`)).filter(Number.isFinite);
        assert.ok(width > 180);
        const preview = await download(`PNG · Preview width (${width} px), 2×`, `Icon samples ${width}w@2x.png`);
        assert.equal(fs.readFileSync(preview).readUInt32BE(16), 2 * width, 'PNG matches the focused viewport at 2×');
        const flat = await download('HTML · Selected artboard as one page for Figma’s capture extension', 'Icon samples.figma.html');
        assert.doesNotMatch(fs.readFileSync(flat, 'utf8'), /<iframe|<script|\/_blob\//i);
        const capture = await browser.load(pathToFileURL(flat).href, { ready: "document.querySelector('#caption')" });
        try {
          const state = await capture.evaluate(`(async () => {
            const section = document.querySelector('section.artboard'), r = section.getBoundingClientRect();
            const label = document.querySelector('#caption').getBoundingClientRect();
            const symbols = [...section.querySelectorAll('use')].map(use => document.querySelector(use.getAttribute('href')));
            const masks = [...section.querySelectorAll('div,span')].map(el => getComputedStyle(el).maskImage).filter(mask => mask.startsWith('url('));
            const sizes = await Promise.all(masks.map(async mask => {
              const url = mask.slice(5, -2);
              const svg = new DOMParser().parseFromString(await (await fetch(url)).text(), 'image/svg+xml').documentElement;
              return [svg.getAttribute('width'), svg.getAttribute('height'), svg.getAttribute('viewBox')];
            }));
            return { label: [label.x-r.x, label.y-r.y], stroke: symbols[0].style.stroke, fill: symbols[1].querySelector('path').style.fill, sizes };
          })()`);
          assert.deepEqual(state, {
            label: [6, 40], stroke: 'rgb(200, 20, 50)', fill: 'rgb(30, 140, 60)',
            sizes: [['40', '40', '0 0 40 40'], ['40', '40', '0 0 40 40']],
          });
        } finally { await capture.close(); }
      });
    });
    
    it('PNG and PDF exports draw an artboard in its web font', T, async () => {
      const browser = await ctx.browser();
      fs.mkdirSync(ctx.downloads, { recursive: true });
      await browser.downloadsTo(ctx.downloads);
      const menuItem = text => `[...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent.trim().endsWith(${JSON.stringify(text)}) && item.getAttribute('aria-disabled') !== 'true')`;
      // Inside the bar at both ends, and the paper under it.
      const points = [[30, 26], [170, 26], [30, 80]];
      const exported = async (page, item, name) => {
        const file = path.join(ctx.downloads, name);
        fs.rmSync(file, { force: true });
        await clickOn(page, buttonNamed('Export'));
        assert.ok(await page.waitFor(menuItem(item)), `the Export menu lists ${item}`);
        await clickOn(page, menuItem(item), item);
        assert.ok(await until(() => fs.existsSync(file) && fs.statSync(file).size > 0, 30000), `${name} was not saved: ${fs.readdirSync(ctx.downloads)}`);
        return file;
      };
      const focus = async url => {
        const page = await browser.load(new URL('index.html', url).href, { ready: `document.querySelector('[data-board-title="Main.dc.html"]')`, settle: 800 });
        assert.ok(await page.waitFor(WEB_FONT_LOADED, 20000), 'the artboard loaded its web font');
        await clickOn(page, `document.querySelector('[data-board-title="Main.dc.html"] button[aria-label="Focus"], [data-board-title="Main.dc.html"] button[aria-label="Play full screen"]')`, 'Focus');
        assert.ok(await page.waitFor(buttonNamed('Back to canvas')), 'the focused view opened');
        return page;
      };

      const { url } = await ctx.openNew('web-font-export', (_ctx, root) => webFontBoard(root));
      const page = await focus(url);
      try {
        const png = await exported(page, 'Selected artboard, 1×', 'Web font.png');
        const image = await pixelsOf(page, `'data:image/png;base64,${fs.readFileSync(png).toString('base64')}'`, points);
        assert.deepEqual(image, { width: 880, height: 560, pixels: [INK, INK, PAPER] }, 'the PNG lost the web font');
        // A PDF page is the artboard at 2×.
        const pdf = await pixelsOf(page, pdfPagePicture(await exported(page, 'Selected artboard', 'Web font.pdf')), points, 2);
        assert.equal(pdf.width, 1760);
        assert.ok(near(pdf.pixels[0], INK) && near(pdf.pixels[1], INK) && near(pdf.pixels[2], PAPER), `the PDF lost the web font: ${JSON.stringify(pdf.pixels)}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }

      // A Flow artboard is cut into paper pages, each rebuilt as SVG shapes: those carry the font too.
      const flow = await ctx.openNew('web-font-flow', (_ctx, root) => webFontBoard(root, { print: 'flow', paper: 'letter' }));
      const paged = await focus(flow.url);
      try {
        const pdf = await pixelsOf(paged, pdfPagePicture(await exported(paged, 'Selected artboard', 'Web font.pdf')), points, 2);
        assert.ok(near(pdf.pixels[0], INK) && near(pdf.pixels[1], INK) && near(pdf.pixels[2], PAPER), `the paged PDF lost the web font: ${JSON.stringify(pdf.pixels)}`);
        assert.deepEqual(paged.problems, []);
      } finally { await paged.close(); }
    });

    it('zoomed out, an artboard shows a sharp snapshot in its web font, and keeps its frame for zooming back in', T, async () => {
      const { url } = await ctx.openNew('web-font-snapshot', (_ctx, root) => webFontBoard(root));
      // The DOM canvas shows a snapshot as an image the test can read (the engine draws it into its own canvas).
      const page = await (await ctx.browser()).load(new URL('index.html?open_artifact_engine=off', url).href, { ready: 'window.__openArtifactLive', settle: 0 });
      const live = expression => `(live => ${expression})(window.__openArtifactLive())`;
      const frame = `document.querySelector('iframe[data-board="Main.dc.html"]')`;
      const snapshot = `document.querySelector('[data-board="Main.dc.html"] img[data-board-snapshot]')`;
      const zoomUntil = async (deltaY, done) => {
        for (let i = 0; i < 120 && !(await page.evaluate(live(done))); i++) await page.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY, modifiers: 2 });
        assert.ok(await page.evaluate(live(done)), `the canvas did not zoom: ${JSON.stringify(await page.evaluate(live('live.camera')))}`);
      };
      try {
        assert.ok(await page.waitFor(WEB_FONT_LOADED, 20000), 'the artboard loaded its web font');
        assert.ok(await page.waitFor(live('live.snapshots === 1 && live.live.length === 1 && live.resting.length === 0'), 20000), 'the live artboard got its snapshot');
        const booted = await page.evaluate(`${frame}.contentWindow.performance.timeOrigin`);

        // Below 30 % the snapshot stands for the artboard; its frame rests behind it.
        await zoomUntil(12, 'live.camera.zoom < 0.25');
        assert.ok(await page.waitFor(`${live('live.resting.length === 1')} && ${snapshot}?.complete`, 10000), 'the artboard did not go to its snapshot');
        assert.equal(await page.evaluate(`getComputedStyle(${frame}).visibility`), 'hidden', 'the resting frame is hidden');
        // At the artboard's own size (880 × 560 is small enough), in the web font.
        assert.deepEqual((await pixelsOf(page, snapshot, [[30, 26], [170, 26], [30, 80]])).width, 880);
        const { pixels } = await pixelsOf(page, snapshot, [[30, 26], [170, 26], [30, 80]]);
        assert.ok(near(pixels[0], INK) && near(pixels[1], INK) && near(pixels[2], PAPER), `the snapshot lost the web font: ${JSON.stringify(pixels)}`);

        // Back in: the same frame shows again, nothing loaded a second time.
        await zoomUntil(-12, 'live.camera.zoom > 0.4');
        assert.ok(await page.waitFor(`${live('live.resting.length === 0 && live.live.length === 1')} && !${snapshot}`, 10000), 'the frame did not take over again');
        assert.equal(await page.evaluate(`getComputedStyle(${frame}).visibility`), 'visible');
        assert.equal(await page.evaluate(`${frame}.contentWindow.performance.timeOrigin`), booted, 'the artboard booted again');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('zoomed out, an artboard set in a big CJK web font shows its snapshot in a subset of the font', T, async () => {
      const { url } = await ctx.openNew('web-font-subset', (_ctx, root) => webFontBoard(root, {}, { han: true }));
      const page = await (await ctx.browser()).load(new URL('index.html?open_artifact_engine=off', url).href, { ready: 'window.__openArtifactLive', settle: 0 });
      const live = expression => `(live => ${expression})(window.__openArtifactLive())`;
      const snapshot = `document.querySelector('[data-board="Main.dc.html"] img[data-board-snapshot]')`;
      try {
        assert.ok(await page.waitFor(WEB_FONT_LOADED, 20000), 'the artboard loaded its web font');
        assert.ok(await page.waitFor(live('live.snapshots === 1'), 20000), 'the artboard got its snapshot');
        for (let i = 0; i < 120 && !(await page.evaluate(live('live.camera.zoom < 0.25'))); i++) await page.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY: 12, modifiers: 2 });
        assert.ok(await page.waitFor(`${live('live.resting.length === 1')} && ${snapshot}?.complete`, 10000), 'the artboard did not go to its snapshot');
        // The ideographs of the bar are in the subset: a solid bar, as on the page.
        const { pixels } = await pixelsOf(page, snapshot, [[30, 26], [170, 26], [30, 80]]);
        assert.ok(near(pixels[0], INK) && near(pixels[1], INK) && near(pixels[2], PAPER), `the snapshot lost the web font: ${JSON.stringify(pixels)}`);
        const fonts = await page.evaluate(live('live.fonts'));
        assert.ok(fonts.subsets >= 1, `the font was not inlined as a subset: ${JSON.stringify(fonts)}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('pastes foreign artboards with their display names and connected imports', T, async () => {
      const { root, url } = await ctx.openNew('paste-artboards');
      const original = fs.readFileSync(path.join(root, BOARD), 'utf8');
      const wrap = original.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, '<dc-import name="Hero 2"></dc-import>');
      const boards = [{ stem: 'Hero 2', src: original, dx: 0 }, { stem: 'Wrap', src: wrap, dx: 960 }].map(b => ({ ...b, dy: 0, w: 880, h: 560 }));
      const encoded = Buffer.from(JSON.stringify({ appifact: 1, kind: 'design-artboards', data: { artboards: boards } })).toString('base64');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas') });
      try {
        await page.evaluate(`(() => { const data = new DataTransfer(); data.setData('text/html', '<span data-appifact-object="${encoded}">Boards</span>'); window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data })); })()`);
        await clickOn(page, buttonNamed('Paste with code'));
        assert.ok(await until(() => canvasOf(root).boards['Wrap.dc.html'], 10000));
        assert.equal(canvasOf(root).boards['Hero-2.dc.html'].title, 'Hero 2');
        assert.match(fs.readFileSync(path.join(root, 'project/Wrap.dc.html'), 'utf8'), /<dc-import name="Hero-2">/);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('Send to agent: the composer’s request reaches wait', T, async () => {
      const page = ctx.page();
      assert.ok(page, 'the page did not open');
      const w = await startWait(ctx, ctx.root, 60);
      try {
        await clickOn(page, `[...document.querySelectorAll('button')].find(b => /^Ask /.test(b.textContent.trim()))`, 'the Ask button');
        const area = `document.querySelector('textarea[placeholder^="Describe the change"]')`;
        assert.ok(await page.waitFor(area, 10000), 'the composer did not open, or does not see the waiting agent');
        await typeInto(page, area, 'Make the heading terracotta.');
        await clickOn(page, buttonNamed('Send'));
        const { code, stdout } = await w.done;
        assert.equal(code, 0, stdout);
        assert.match(stdout, /^\[Artifact edit request sent to agent\] /m);
        assert.match(stdout, /^Make the heading terracotta\.$/m);
        assert.ok(await page.waitFor(`!(${area})`, 5000), 'the composer stayed open after sending');
      } finally {
        w.child.kill('SIGTERM');
      }
    });

    it('Send to agent with two elements selected: the request keeps the words as typed and the selection at Send', T, async () => {
      const { root, url } = await ctx.openNew('request-parts');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      const pointAt = selector => page.evaluate(`(() => {
        const frame = document.querySelector('iframe[data-board="Main.dc.html"]');
        const rect = frame.getBoundingClientRect();
        const box = frame.contentDocument.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        const zoom = rect.width / frame.offsetWidth;
        return [rect.left + (box.left + box.width / 2) * zoom, rect.top + (box.top + box.height / 2) * zoom];
      })()`);
      const w = await startWait(ctx, root, 60);
      try {
        await page.click(...await pointAt('h1'));
        await page.click(...await pointAt('p'), { shift: true });
        await clickOn(page, `[...document.querySelectorAll('button')].find(b => /^Ask /.test(b.textContent.trim()))`, 'the Ask button');
        const area = `document.querySelector('textarea[placeholder^="Describe the change"]')`;
        assert.ok(await page.waitFor(area, 10000), 'the composer did not open');
        await typeInto(page, area, 'Make these terracotta');
        await page.press('Enter');
        await page.type('and a little larger');
        await clickOn(page, buttonNamed('Send'));
        // The selection changes right after Send: what was sent stays as it was.
        await page.press('Escape');
        await page.press('Escape');
        const { code, stdout } = await w.done;
        assert.equal(code, 0, stdout);
        assert.match(stdout, /^Make these terracotta\nand a little larger$/m);
        const doneDir = path.join(root, '_agent', 'done');
        const sent = fs.readdirSync(doneDir).map(name => JSON.parse(fs.readFileSync(path.join(doneDir, name), 'utf8'))).find(r => r.title === 'Send to agent');
        assert.ok(sent, 'no request in _agent/done');
        assert.equal(sent.userText, 'Make these terracotta\nand a little larger');
        assert.ok(sent.text.startsWith(sent.userText), 'the agent reads the words first');
        assert.equal(sent.selectionSnapshot?.kind, 'elements');
        assert.equal(sent.selectionSnapshot.count, 2);
        assert.equal(sent.selectionSnapshot.label, '2 selected elements');
        assert.equal(sent.selectionSnapshot.where, undefined, 'the fixture canvas names no page, so the snapshot says none');
        assert.equal(sent.selectionSnapshot.items.length, 2);
        assert.ok(sent.selectionSnapshot.items.some(item => /Smoke canvas/.test(item.label ?? '')), JSON.stringify(sent.selectionSnapshot));
        assert.deepEqual(page.problems, []);
      } finally {
        w.child.kill('SIGTERM');
        await page.close();
      }
    });

    it('Send to agent over 8000 UTF-8 bytes is refused: the composer stays open with the draft and nothing is queued', T, async () => {
      const { root, url } = await ctx.openNew('ask-too-long');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      try {
        await clickOn(page, `[...document.querySelectorAll('button')].find(b => /^Ask /.test(b.textContent.trim()))`, 'the Ask button');
        const area = `document.querySelector('textarea[placeholder]')`;
        assert.ok(await page.waitFor(area, 10000), 'the composer did not open');
        await page.evaluate(`(${area}).focus()`);
        // 2,667 CJK characters are 8,001 bytes, far under 8000 UTF-16 units.
        const wide = '蓝'.repeat(2667);
        await page.cdp('Input.insertText', { text: wide });
        await clickOn(page, buttonNamed('Send'));
        assert.ok(await page.waitFor("document.body.innerText.includes('That’s too long to send.')", 10000), 'the page does not say the request is too long');
        assert.equal(await page.evaluate(`(${area})?.value`), wide, 'the composer stays open with the draft');
        const inbox = path.join(root, '_agent', 'inbox');
        assert.ok(!fs.existsSync(inbox) || fs.readdirSync(inbox).length === 0, 'nothing was queued');
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    const throwing = (ctx_, root) => {
      copyFixture('design', root);
      const board = path.join(root, BOARD);
      fs.writeFileSync(board, fs.readFileSync(board, 'utf8').replace("return { accent: this.props.accent ?? '#666666' };", "throw new Error('e2e board error');"));
    };

    it('a board that throws shows its error, and "Ask agent to fix" sends it', { timeout: 120000 }, async () => {
      const { root, url } = await ctx.openNew('throwing', throwing);
      const w = await startWait(ctx, root, 90);
      // A board that throws draws nothing: the page is ready once it shows the board's error.
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Ask agent to fix'), settle: 1000, ignore: [/e2e board error/] });
      try {
        assert.ok(await page.waitFor(textIn('Ask agent to fix'), 1000), 'the board shows no error, or no "Ask agent to fix"');
        await clickOn(page, buttonNamed('Ask agent to fix'));
        const { code, stdout } = await w.done;
        assert.equal(code, 0, stdout);
        assert.match(stdout, /^\[Artifact edit request sent to agent\] Ask agent to fix$/m);
        assert.match(stdout, /Fix the errors in Main\.dc\.html\./);
        assert.match(stdout, /e2e board error/);
        assert.deepEqual(page.problems, []);
      } finally {
        w.child.kill('SIGTERM');
        await page.close();
      }
    });

    it('"1 error" lists the artboards with errors and asks for all of them; a closed notice leaves a mark that brings it back', { timeout: 120000 }, async () => {
      const { root, url } = await ctx.openNew('throwing-list', throwing);
      const notice = `document.querySelector('[data-error-notice="Main.dc.html"]')`;
      const mark = `document.querySelector('[data-error-mark="Main.dc.html"]')`;
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `Boolean(${notice})`, settle: 1000, ignore: [/e2e board error/] });
      let w = null;
      try {
        // The notice under the artboard, and the count at the top right.
        assert.match(await page.evaluate(`${notice}.textContent`), /1 error/);
        assert.ok(await page.evaluate(`Boolean(${buttonNamed('1 error on 1 artboard')})`), 'no "1 error" at the top right');

        // Closing the notice leaves a mark in the artboard's name strip; the mark brings it back.
        await clickOn(page, buttonNamed('Dismiss error notice on artboard Main'));
        assert.ok(await page.waitFor(`!${notice} && Boolean(${mark})`, 5000), 'the notice did not close into a mark');
        await clickOn(page, mark);
        assert.ok(await page.waitFor(`Boolean(${notice}) && !${mark}`, 5000), 'the mark did not bring the notice back');

        // The list names the artboard and its message, and asks for all of them.
        await clickOn(page, buttonNamed('1 error on 1 artboard'));
        assert.ok(await page.waitFor(`${textIn('Artboards with errors')} && [...document.querySelectorAll('[role="menu"]')].some(m => m.textContent.includes('e2e board error'))`, 5000), 'the list shows no error');
        w = await startWait(ctx, root, 90);
        await clickOn(page, `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find(b => b.textContent.trim() === 'Ask agent to fix')`, 'the list\'s "Ask agent to fix"');
        const { code, stdout } = await w.done;
        assert.equal(code, 0, stdout);
        assert.match(stdout, /^\[Artifact edit request sent to agent\] Ask agent to fix$/m);
        assert.match(stdout, /Fix the errors in Main\.dc\.html\./);
        assert.match(stdout, /\[\w+\] e2e board error/, 'each message goes with its kind in brackets');
        assert.deepEqual(page.problems, []);
      } finally {
        w?.child.kill('SIGTERM');
        await page.close();
      }
    });

    it('a pasted image becomes an image note, uploaded and saved in canvas.json', T, async () => {
      const { root, url } = await ctx.openNew('paste');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      try {
        const bytes = [...png([1, 2, 3])];
        await page.evaluate(`(() => {
          const dt = new DataTransfer();
          dt.items.add(new File([new Uint8Array(${JSON.stringify(bytes)})], 'pasted.png', { type: 'image/png' }));
          document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        })()`);
        let note;
        assert.ok(
          await until(() => (note = Object.values(canvasOf(root).notes).find(n => n.kind === 'image' || n.type === 'image' || n.src)), 15000),
          `no image note in canvas.json: ${JSON.stringify(canvasOf(root).notes)}`,
        );
        assert.match(note.src, /^\/_blob\/[0-9a-f]{32}$/, JSON.stringify(note));
        const served = await fetch(new URL(note.src, url));
        assert.equal(served.status, 200);
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('pastes a clipboard image at the clicked point inside an artboard', T, async () => {
      const { root, url } = await ctx.openNew('board-image-paste');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas') });
      try {
        await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
          read: async () => [{ types: ['image/png'], getType: async () => new Blob([new Uint8Array(${JSON.stringify([...png([4, 5, 6])])})], {type:'image/png'}) }]
        } })`);
        const at = await page.evaluate(`(() => {
          const rect = document.querySelector('iframe[data-board="Main.dc.html"]').getBoundingClientRect();
          return { x: rect.x + rect.width * 0.4, y: rect.y + rect.height * 0.5 };
        })()`);
        await page.rightClick(at.x, at.y);
        await clickOn(page, `[...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.trim().startsWith('Paste⌘V'))`);
        assert.ok(await until(() => /<img src="\/_blob\//.test(fs.readFileSync(path.join(root, BOARD), 'utf8')), 10000));
        assert.equal(Object.keys(canvasOf(root).notes).length, 0);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('property fields: font search, Enter keeps focus, ⌘Z undoes; a linked element shows its link; menus fit a short window', T, async () => {
      const { root, url } = await ctx.openNew('fields', (_ctx, root) => {
        copyFixture('design', root);
        const board = path.join(root, BOARD);
        fs.writeFileSync(board, fs.readFileSync(board, 'utf8').replace('</p>', '</p><a href="https://example.com/docs?ref=1" style="font-size: 24px">Read the docs</a>'));
      });
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const pointAt = selector => page.evaluate(`(() => {
        const frame = document.querySelector('iframe[data-board="Main.dc.html"]');
        const rect = frame.getBoundingClientRect();
        const box = frame.contentDocument.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        const zoom = rect.width / frame.offsetWidth;
        return [rect.left + (box.left + box.width / 2) * zoom, rect.top + (box.top + box.height / 2) * zoom];
      })()`);
      const boardText = () => fs.readFileSync(path.join(root, BOARD), 'utf8');
      try {
        // A linked element shows a card with its address; an unlinked one shows none.
        await page.hover(...await pointAt('a'));
        assert.ok(await page.waitFor(`document.querySelector('[data-hover-link]')?.innerText.includes('example.com/docs')`), 'the link card shows');
        assert.ok(await page.evaluate(`!!document.querySelector('[data-hover-link] [aria-label="Open https://example.com/docs?ref=1"]')`));
        await page.hover(...await pointAt('p'));
        assert.ok(await page.waitFor(`!document.querySelector('[data-hover-link]')`, 5000), 'the card goes once the pointer leaves the link');

        await page.click(...await pointAt('h1'));
        await clickOn(page, buttonNamed('Properties'));
        assert.ok(await page.waitFor(buttonNamed('Font')), 'the properties panel shows the text fields');
        await clickOn(page, buttonNamed('Font'));
        assert.ok(await page.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Search fonts'`));
        await page.type('Helv');
        assert.ok(await page.waitFor(`(() => { const shown = [...document.querySelectorAll('[role=option]')]; return shown.length === 1 && /helv/i.test(shown[0].textContent); })()`), 'the search narrows the list');
        await page.press('Enter');
        assert.ok(await until(() => /<h1 style=.[^>]*font-family:[^;>]*Helvetica Neue/.test(boardText()), 10000), 'the font searched for is saved');

        const size = `document.querySelector('input[aria-label="Font size"]')`;
        await clickOn(page, size);
        await page.evaluate(`${size}.select()`);
        await page.type('40');
        await page.press('Enter');
        assert.ok(await until(() => /<h1 style=.[^>]*font-size: 40px/.test(boardText()), 10000), 'Enter commits the size');
        assert.ok(await page.waitFor(`document.activeElement === ${size}`), 'Enter keeps the field focused');
        await page.press('z', mod);
        assert.ok(await until(() => !/font-size: 40px/.test(boardText()), 10000), '⌘Z in the committed field undoes the edit');
        assert.ok(await until(() => /font-family:[^;>]*Helvetica Neue/.test(boardText()), 2000), 'only the last edit is undone');

        await page.press('Escape');
        await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1000, height: 273, deviceScaleFactor: 1, mobile: false });
        await page.waitFor('innerHeight === 273');
        const inBoard = await page.evaluate(`(() => {
          const rect = document.querySelector('iframe[data-board="Main.dc.html"]').getBoundingClientRect();
          const top = Math.max(rect.top, 0), bottom = Math.min(rect.bottom, innerHeight);
          return [Math.max(rect.left, 0) + 40, (top + bottom) / 2];
        })()`);
        await page.rightClick(...inBoard);
        const menu = `document.querySelector('[role=menu]')`;
        assert.ok(await page.waitFor(menu));
        const fit = await page.evaluate(`(() => { const el = ${menu}; return { bottom: el.getBoundingClientRect().bottom, top: el.getBoundingClientRect().top, overflow: getComputedStyle(el).overflowY, scrolls: el.scrollHeight > el.clientHeight }; })()`);
        assert.ok(fit.top >= -1 && fit.bottom <= 274, JSON.stringify(fit));
        assert.equal(fit.overflow, 'auto');
        assert.ok(fit.scrolls, 'the long menu scrolls inside the short window');
        await page.cdp('Emulation.clearDeviceMetricsOverride', {});
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('number fields hold a value at their limits, refuse a minus sign, and say so', T, async () => {
      const { root, url } = await ctx.openNew('field-limits', (_ctx, root) => copyFixture('design', root));
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      const boardText = () => fs.readFileSync(path.join(root, BOARD), 'utf8');
      const status = phrase => `[...document.querySelectorAll('[role=status][aria-live]')].some(el => el.textContent.includes(${JSON.stringify(phrase)}))`;
      const field = label => `document.querySelector('input[aria-label="${label}"]')`;
      const reach = async label => {
        await page.evaluate(`${field(label)}.scrollIntoView({ block: 'center' })`);
        await clickOn(page, field(label));
      };
      const typeIn = async (label, text) => {
        await reach(label);
        await page.evaluate(`${field(label)}.select()`);
        await page.type(text);
        await page.press('Enter');
      };
      try {
        const h1 = await page.evaluate(`(() => {
          const frame = document.querySelector('iframe[data-board="Main.dc.html"]');
          const rect = frame.getBoundingClientRect();
          const box = frame.contentDocument.querySelector('h1').getBoundingClientRect();
          const zoom = rect.width / frame.offsetWidth;
          return [rect.left + (box.left + box.width / 2) * zoom, rect.top + (box.top + box.height / 2) * zoom];
        })()`);
        await page.click(...h1);
        await clickOn(page, buttonNamed('Properties'));
        assert.ok(await page.waitFor(field('Opacity')), 'the properties panel shows');

        await typeIn('Opacity', '40');
        assert.ok(await until(() => /<h1 style=.[^>]*opacity: 0.4/.test(boardText()), 10000), 'a value inside the limits is kept');
        await typeIn('Opacity', '150');
        assert.ok(await page.waitFor(status('Changed to 100 %. Opacity can’t go higher.'), 5000), 'the limit is said');
        // 100 % is no inline opacity: the field shows it in grey.
        assert.ok(await page.waitFor(`(${field('Opacity')}.value || ${field('Opacity')}.placeholder) === '100'`, 5000), 'the field shows 100');
        assert.ok(await until(() => !/opacity:/.test(boardText()), 10000), 'the value is held at 100 %');

        await typeIn('Opacity', 'half');
        assert.ok(await page.waitFor(status('Nothing changed. Opacity takes a number in %.'), 5000), 'text that is no number is refused');
        assert.equal(await page.evaluate(`${field('Opacity')}.value`), '');

        // Pasted text that starts with a minus sign: the number is kept without it.
        await reach('Padding');
        await page.evaluate(`(() => {
          const input = ${field('Padding')};
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '−8');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        await page.press('Enter');
        assert.ok(await page.waitFor(status('Minus sign ignored. Padding doesn’t take negative numbers.'), 5000), 'the minus sign is said');
        assert.ok(await until(() => /<h1 style=.[^>]*padding: 8px/.test(boardText()), 10000), 'the number is kept without its minus sign');
        await page.evaluate(`${field('Padding')}.setSelectionRange(0, 0)`);
        await page.type('-');
        assert.equal(await page.evaluate(`${field('Padding')}.value`), '8', 'the minus key types nothing');
        await page.press('Escape');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('the opacity slider: a cancelled drag ends and is one undo step; keys step it', T, async () => {
      const { root, url } = await ctx.openNew('opacity-slider', (_ctx, root) => copyFixture('design', root));
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      const boardText = () => fs.readFileSync(path.join(root, BOARD), 'utf8');
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const slider = `document.querySelector('[role=slider][aria-label="Opacity slider"], [aria-label="Opacity slider"] [role=slider], input[type=range][aria-label="Opacity slider"]')`;
      try {
        const h1 = await page.evaluate(`(() => {
          const frame = document.querySelector('iframe[data-board="Main.dc.html"]');
          const rect = frame.getBoundingClientRect();
          const box = frame.contentDocument.querySelector('h1').getBoundingClientRect();
          const zoom = rect.width / frame.offsetWidth;
          return [rect.left + (box.left + box.width / 2) * zoom, rect.top + (box.top + box.height / 2) * zoom];
        })()`);
        await page.click(...h1);
        await clickOn(page, buttonNamed('Properties'));
        assert.ok(await page.waitFor(slider), 'the opacity slider shows');
        await page.evaluate(`${slider}.scrollIntoView({ block: 'center' })`);
        const track = await page.evaluate(`(() => {
          const control = ${slider}.closest('[data-orientation]')?.parentElement ?? ${slider}.parentElement;
          const box = control.getBoundingClientRect();
          return { left: box.left, width: box.width, y: box.top + box.height / 2 };
        })()`);
        const at = share => track.left + track.width * share;
        await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at(0.95), y: track.y });
        await page.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: at(0.95), y: track.y, button: 'left', buttons: 1, clickCount: 1 });
        for (const share of [0.8, 0.65, 0.5]) {
          await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at(share), y: track.y, button: 'left', buttons: 1 });
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        // The pointer is cancelled (a system gesture): the drag ends and is written.
        await page.evaluate(`${slider}.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }))`);
        assert.ok(await until(() => /<h1 style=.[^>]*opacity: 0\.[3-6]/.test(boardText()), 10000), 'the drag is written');
        await page.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at(0.2), y: track.y, button: 'left', buttons: 0, clickCount: 1 });
        await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at(0.1), y: track.y });
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.ok(/<h1 style=.[^>]*opacity: 0\.[3-6]/.test(boardText()), 'moves after the cancel change nothing');
        await page.evaluate('document.activeElement?.blur()');
        await page.press('z', mod);
        assert.ok(await until(() => !/opacity:/.test(boardText()), 10000), 'one undo takes the whole drag back');

        // Keys: Home to 0, PageUp ten steps.
        await page.evaluate(`${slider}.focus()`);
        await page.press('Home');
        assert.ok(await until(() => /<h1 style=.[^>]*opacity: 0[;"']/.test(boardText()), 10000), 'Home goes to 0');
        await page.press('ArrowUp');
        // PageUp has no key code in the helper: press it raw.
        await page.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 });
        await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 });
        assert.ok(await until(() => /<h1 style=.[^>]*opacity: 0\.11/.test(boardText()), 10000), 'PageUp moves ten steps');
        assert.equal(await page.evaluate(`${slider}.getAttribute('aria-valuetext')`), '11%');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('a shape note’s style: a border outside the edge is an outline, an oval has no radius, a new rectangle takes the last radius', T, async () => {
      const { root, url } = await ctx.openNew('note-style', (_ctx, root) => {
        copyFixture('design', root);
        const file = path.join(root, 'project', 'canvas.json');
        const canvas = JSON.parse(fs.readFileSync(file, 'utf8'));
        canvas.notes = { r: { x: 0, y: 620, w: 160, h: 100, kind: 'rect', title: 'Box shape' }, o: { x: 240, y: 620, w: 160, h: 100, kind: 'oval', title: 'Round shape' } };
        fs.writeFileSync(file, JSON.stringify(canvas));
      });
      const page = await (await ctx.browser()).load(new URL('index.html?open_artifact_engine=off', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      const field = label => `document.querySelector('input[aria-label="${label}"]')`;
      const typeIn = async (label, text) => {
        await page.evaluate(`${field(label)}.scrollIntoView({ block: 'center' })`);
        await clickOn(page, field(label));
        await page.evaluate(`${field(label)}.select()`);
        await page.type(text);
        await page.press('Enter');
      };
      const pick = async (label, option) => {
        await page.evaluate(`document.querySelector('[aria-label="${label}"]').scrollIntoView({ block: 'center' })`);
        await clickOn(page, `document.querySelector('[aria-label="${label}"]')`);
        await clickOn(page, `[...document.querySelectorAll('[role=option]')].find(o => o.textContent.trim() === ${JSON.stringify(option)})`);
      };
      const note = id => `document.querySelector('[data-note="${id}"]')`;
      const row = text => `[...document.querySelectorAll('[role=tree][aria-label="Layers"] [role=treeitem]')].find(el => el.textContent.includes(${JSON.stringify(text)}))`;
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      try {
        await page.press('\\', mod);
        assert.ok(await page.waitFor(row('Box shape'), 5000), 'the layers list shows the rectangle');
        await clickOn(page, row('Box shape'), 'the rectangle’s row');
        assert.ok(await page.waitFor(field('Border width'), 5000), 'a rectangle shows its border rows');
        await typeIn('Border width', '2');
        await pick('Border style', 'Dashed');
        await pick('Border alignment', 'Outside');
        assert.ok(await until(() => {
          const css = canvasOf(root).notes.r?.css;
          return css?.['border-width'] === '2px' && css['border-style'] === 'dashed' && css['border-position'] === 'outside';
        }, 10000), `the css is written: ${JSON.stringify(canvasOf(root).notes.r)}`);
        assert.ok(await page.waitFor(`(() => { const body = ${note('r')}.querySelector('[data-note-look="dom"]') ?? ${note('r')}; const s = getComputedStyle(body); return s.outlineStyle === 'dashed' && s.outlineWidth === '2px' && s.borderTopStyle === 'none'; })()`, 5000), 'it is drawn as an outline');

        await typeIn('Object radius', '12');
        assert.ok(await until(() => canvasOf(root).notes.r?.css?.['border-radius'] === '12px', 10000), 'the radius is written');

        await clickOn(page, row('Round shape'), 'the oval’s row');
        assert.ok(await page.waitFor(`document.querySelector('[data-reason="radius"]')?.textContent === 'An oval is always round'`, 5000), 'an oval has no radius to set');

        // A new rectangle takes the radius set last.
        const box = await noteBox(page, 'o');
        await page.evaluate(`document.querySelector('[data-canvas-surface]').focus()`);
        await page.press('r');
        const start = { x: box.x + box.w + 80, y: box.y };
        await pointer(page).drag(start, { x: start.x + 100, y: start.y + 60 });
        assert.ok(await until(() => Object.entries(canvasOf(root).notes).some(([id, n]) => id !== 'r' && n.kind === 'rect' && n.css?.['border-radius'] === '12px'), 10000), `the new rectangle has the radius: ${JSON.stringify(canvasOf(root).notes)}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('an artboard link selects the artboard, and Shift+Cmd+C copies it as a PNG', T, async () => {
      const { url } = await ctx.openNew('copy-png');
      const editor = new URL('index.html', url);
      const page = await (await ctx.browser()).load(editor.href + '#artboard-main', { ready: `document.querySelector('[data-board-title="Main.dc.html"] .text-accent')`, settle: 800 });
      try {
        assert.equal(await page.evaluate('location.hash'), '');
        await page.cdp('Browser.grantPermissions', { origin: editor.origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
        await page.press('c', { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin', shift: true });
        assert.ok(await page.waitFor(textIn('Copied as PNG'), 20000), 'the copy finished');
        const types = await page.evaluate('navigator.clipboard.read().then(items => items.flatMap(item => item.types))');
        assert.deepEqual(types, ['image/png']);
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('without a Shell, the focused artboard has its own Export menu', T, async () => {
      const { url } = await ctx.openNew('focused-export');
      const browser = await ctx.browser();
      // The host saves exports to the Downloads folder; a browser download lands there too.
      const dir = ctx.downloads;
      fs.mkdirSync(dir, { recursive: true });
      await browser.downloadsTo(dir);
      const pngs = () => fs.readdirSync(dir).filter(name => name.endsWith('.png'));
      const before = pngs().length;
      const page = await browser.load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      try {
        await clickOn(page, `document.querySelector('[data-board-title="Main.dc.html"] button[aria-label="Focus"], [data-board-title="Main.dc.html"] button[aria-label="Play full screen"]')`, 'Focus');
        assert.ok(await page.waitFor(buttonNamed('Back to canvas')), 'the focused view opened');
        await clickOn(page, buttonNamed('Export'));
        const item = `[...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent.includes('Selected artboard, 1×') && item.getAttribute('aria-disabled') !== 'true')`;
        assert.ok(await page.waitFor(item), 'the menu lists the PNG of this artboard');
        await clickOn(page, item, 'PNG 1×');
        assert.ok(await until(() => pngs().length > before, 30000), `no PNG saved: ${fs.readdirSync(dir)}`);
        await clickOn(page, buttonNamed('Back to canvas'));
        assert.ok(await page.waitFor(`!(${buttonNamed('Export')})`), 'the canvas has no Export menu');
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('where the browser keeps the clipboard from the framed editor, the Shell copies the PNG', T, async () => {
      const { url } = await ctx.openNew('copy-png-shell');
      const browser = await ctx.browser();
      const shell = await browser.load(url + '#artboard-main', { ready: `document.querySelector('[data-board-title="Main.dc.html"] .text-accent')` });
      const frame = `document.querySelector('iframe[name="open-artifact-shell"]')`;
      try {
        assert.ok(await shell.waitFor(`document.querySelector('[data-board-title="Main.dc.html"] .text-accent')`), 'the artboard is selected');
        await shell.cdp('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
        // Act like a browser that refuses framed pages whatever the frame's allow says.
        await shell.evaluate(`(() => {
          const win = ${frame}.contentWindow;
          win.refused = 0;
          const refuse = async () => { win.refused++; throw new win.DOMException('Write permission denied.', 'NotAllowedError'); };
          win.navigator.clipboard.write = refuse;
          win.navigator.clipboard.writeText = refuse;
          win.focus();
        })()`);
        await shell.evaluate('navigator.clipboard.writeText("before")');
        await shell.press('c', { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin', shift: true });
        assert.ok(await shell.waitFor(textIn('Copied as PNG'), 20000), 'the copy finished');
        assert.equal(await shell.evaluate(`${frame}.contentWindow.refused`), 1, 'the editor tried the clipboard itself first');
        const types = await shell.evaluate('navigator.clipboard.read().then(items => items.flatMap(item => item.types))');
        assert.deepEqual(types, ['image/png']);
        const size = await shell.evaluate(`navigator.clipboard.read().then(items => items[0].getType('image/png')).then(blob => blob.size)`);
        assert.ok(size > 1000, `a real image (${size} bytes)`);
        assert.deepEqual(shell.problems, []);
      } finally { await shell.close(); }
    });

    it('Pages → Add page writes the page to canvas.json', T, async () => {
      const { root, url } = await ctx.openNew('pages');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      try {
        await clickOn(page, `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Page 1')`, 'the Pages menu');
        await clickOn(page, buttonNamed('New page'), 'New page');
        assert.ok(await until(() => canvasOf(root).pages.length === 2, 10000), `canvas.json pages: ${JSON.stringify(canvasOf(root).pages)}`);
        assert.deepEqual(
          canvasOf(root).pages.map(p => p.name),
          ['Page 1', 'Page 2'],
        );
        assert.deepEqual(page.problems, []);
      } finally {
        await page.close();
      }
    });

    it('a sideways swipe in the focused view steps to the next and back to the previous artboard', T, async () => {
      const twoBoards = (ctx_, root) => {
        copyFixture('design', root);
        fs.copyFileSync(path.join(root, BOARD), path.join(root, 'project', 'Second.dc.html'));
        const file = path.join(root, 'project', 'canvas.json');
        const canvas = JSON.parse(fs.readFileSync(file, 'utf8'));
        canvas.boards['Second.dc.html'] = { x: 1000, y: 0, w: 880, h: 560 };
        canvas.order.push('Second.dc.html');
        fs.writeFileSync(file, JSON.stringify(canvas));
      };
      const { url } = await ctx.openNew('swipe', twoBoards);
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      const title = `document.querySelector('header h1')?.textContent.trim()`;
      const swipe = async (dx, frame) => {
        const at = await page.evaluate(`(() => {
          const r = document.querySelector(${JSON.stringify(frame ? 'iframe' : 'header + div')}).getBoundingClientRect();
          return { x: r.left + r.width / 2, y: ${frame ? 'r.top + r.height / 2' : 'r.bottom - 12'} };
        })()`);
        await page.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
        for (let n = 1; n <= 5; n++) await page.cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at.x + (dx * n) / 5, y: at.y + n }] });
        await page.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      try {
        await clickOn(page, `document.querySelector('[data-board-title="Main.dc.html"] button[aria-label="Focus"], [data-board-title="Main.dc.html"] button[aria-label="Play full screen"]')`, 'Focus');
        assert.ok(await page.waitFor(`${title} === 'Main'`), 'the focused view opened on Main');
        await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        assert.ok(await page.waitFor(`document.querySelector('iframe')?.contentDocument?.querySelector('h1')`), 'the artboard runs');
        await swipe(-160, true);
        assert.ok(await page.waitFor(`${title} === 'Second'`, 5000), `a swipe left in the artboard did not step on: ${await page.evaluate(title)}`);
        assert.ok(await page.waitFor(`document.querySelector('iframe')?.contentDocument?.querySelector('h1')`), 'the next artboard runs');
        await swipe(160, false);
        assert.ok(await page.waitFor(`${title} === 'Main'`, 5000), `a swipe right on the backdrop did not step back: ${await page.evaluate(title)}`);
        await swipe(-20, true);
        await new Promise(resolve => setTimeout(resolve, 400));
        assert.equal(await page.evaluate(title), 'Main', 'a short move paged');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('Pages: Move up and a dragged row reorder the pages, and what was on the first page stays there', T, async () => {
      const threePages = (ctx_, root) => {
        copyFixture('design', root);
        const file = path.join(root, 'project', 'canvas.json');
        const canvas = JSON.parse(fs.readFileSync(file, 'utf8'));
        canvas.pages = [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }, { id: 'three', name: 'Three' }];
        fs.writeFileSync(file, JSON.stringify(canvas));
      };
      const { root, url } = await ctx.openNew('page-order', threePages);
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      const order = () => canvasOf(root).pages.map(p => p.id);
      const pill = `document.querySelector('button[aria-label^="Pages:"]')`;
      const row = name => `[...document.querySelectorAll('[data-page-row] > button')].find(b => b.getAttribute('aria-label')?.startsWith(${JSON.stringify(name + ',')}))`;
      try {
        await clickOn(page, pill, 'the Pages menu');
        assert.ok(await page.waitFor(`(${row('Two')})?.getAttribute('aria-label') === 'Two, artboards: 0'`), 'a page row says how many artboards it holds');
        await clickOn(page, buttonNamed('Actions for Two'), 'the page’s actions');
        await clickOn(page, buttonNamed('Move up'), 'Move up');
        assert.ok(await until(() => order().join() === 'two,one,three', 10000), `pages after Move up: ${order()}`);
        assert.equal(canvasOf(root).boards['Main.dc.html'].page, 'one', 'the artboard left on the old first page moved with the new one');

        if (!(await page.evaluate(`Boolean(${row('Three')})`))) await clickOn(page, pill, 'the Pages menu');
        const from = await middleOf(page, row('Three'));
        const top = await page.evaluate(`(${row('Two')}).getBoundingClientRect().top`);
        await page.dragMouse([from.x, from.y], [from.x, top + 2]);
        assert.ok(await until(() => order().join() === 'three,two,one', 10000), `pages after the drag: ${order()}`);
        assert.equal(canvasOf(root).boards['Main.dc.html'].page, 'one');
        assert.ok(await page.waitFor(`${pill}?.textContent.trim().endsWith('One')`, 3000), `the drop also switched pages: ${await page.evaluate(`${pill}?.textContent`)}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('"Delete page “Two”?" ignores an Enter pressed as it opens, and takes one pressed later', T, async () => {
      const twoPages = (ctx_, root) => {
        copyFixture('design', root);
        const file = path.join(root, 'project', 'canvas.json');
        const canvas = JSON.parse(fs.readFileSync(file, 'utf8'));
        canvas.pages = [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }, { id: 'three', name: 'Three' }];
        // Only a page with something on it asks first.
        canvas.boards['Main.dc.html'].page = 'two';
        canvas.notes = { ...canvas.notes, held: { x: 0, y: 0, text: 'Held', page: 'three' } };
        fs.writeFileSync(file, JSON.stringify(canvas));
      };
      const { root, url } = await ctx.openNew('page-delete', twoPages);
      // The first page is empty: wait for the Pages menu rather than the canvas.
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('button[aria-label^="Pages:"]')`, settle: 800 });
      const pages = () => canvasOf(root).pages.map(p => p.id).join();
      try {
        await clickOn(page, `document.querySelector('button[aria-label^="Pages:"]')`, 'the Pages menu');
        await clickOn(page, buttonNamed('Actions for Two'), 'the page’s actions');
        await clickOn(page, buttonNamed('Delete'), 'Delete');
        await page.press('Enter');
        assert.ok(await page.waitFor(textIn('Delete page “Two”?'), 3000), 'the dialog closed on the early Enter');
        await new Promise(resolve => setTimeout(resolve, 800));
        assert.equal(pages(), 'one,two,three', 'the early Enter deleted the page');
        await page.evaluate(`[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Delete').focus()`);
        // Held down: the Enter's repeats after the dialog closes press nothing else.
        const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
        await page.cdp('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', ...enter });
        for (let i = 0; i < 6; i++) {
          await new Promise(resolve => setTimeout(resolve, 60));
          await page.cdp('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', autoRepeat: true, ...enter });
        }
        await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...enter });
        assert.ok(await until(() => pages() === 'one,three', 10000), `a later Enter did not delete: ${pages()}`);
        await new Promise(resolve => setTimeout(resolve, 800));
        assert.equal(pages(), 'one,three', 'the held Enter went on to delete more');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('answering the recovery banner from the keyboard leaves focus on the toolbar, not the page', T, async () => {
      const { root, url } = await ctx.openNew('recovery-focus');
      const browser = await ctx.browser();
      const first = await browser.load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      try {
        // A copy of unsaved work left by an earlier visit.
        const source = fs.readFileSync(path.join(root, BOARD), 'utf8').replace('</h1>', ' (edited)</h1>');
        await first.evaluate(`localStorage.setItem('open-artifact-design:recovery:' + location.pathname, ${JSON.stringify(JSON.stringify({ v: 1, at: Date.now(), title: 'Smoke canvas', boards: { 'Main.dc.html': source } }))})`);
      } finally { await first.close(); }
      const page = await browser.load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      try {
        assert.ok(await page.waitFor(buttonNamed('Discard'), 10000), 'no recovery banner');
        await page.evaluate(`(${buttonNamed('Discard')}).focus()`);
        await page.press('Enter');
        assert.ok(await page.waitFor(`!(${buttonNamed('Discard')})`, 5000), 'Enter did not answer the banner');
        assert.ok(await page.waitFor(`document.activeElement?.hasAttribute('data-focus-landing')`, 3000), `focus went to ${await page.evaluate('document.activeElement?.tagName')}`);
        assert.ok(!fs.readFileSync(path.join(root, BOARD), 'utf8').includes('(edited)'), 'Discard restored the copy');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('pasted plain text off an artboard becomes a text note', T, async () => {
      const { root, url } = await ctx.openNew('paste-text');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      try {
        await page.evaluate(`(() => {
          const dt = new DataTransfer();
          dt.setData('text/plain', '\\n\\nFirst line\\r\\nSecond line  ');
          document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        })()`);
        let note;
        assert.ok(await until(() => (note = Object.values(canvasOf(root).notes)[0]), 10000), 'no note in canvas.json');
        assert.equal(note.kind, 'title1', JSON.stringify(note));
        assert.equal(note.size, 'm', JSON.stringify(note));
        assert.equal(note.text, 'First line\nSecond line');
        assert.ok(!fs.readFileSync(path.join(root, BOARD), 'utf8').includes('First line'), 'the text went into the artboard');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    // The middle of an element of Main.dc.html in the editor's viewport.
    const elementAt = (page, selector) => page.evaluate(`(() => {
      const frame = document.querySelector('iframe[data-board="Main.dc.html"]');
      const rect = frame.getBoundingClientRect();
      const box = frame.contentDocument.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      const zoom = rect.width / frame.offsetWidth;
      return [rect.left + (box.left + box.width / 2) * zoom, rect.top + (box.top + box.height / 2) * zoom];
    })()`);

    it('Enter on the Artboard tool places an artboard and puts the cursor in its name', T, async () => {
      const { root, url } = await ctx.openNew('board-enter');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      try {
        const before = Object.keys(canvasOf(root).boards).length;
        await page.evaluate(`(${buttonNamed('Artboard')}).focus()`);
        await page.press('Enter');
        assert.ok(await until(() => Object.keys(canvasOf(root).boards).length === before + 1, 10000), `no artboard added: ${JSON.stringify(canvasOf(root).boards)}`);
        assert.ok(await page.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Artboard name'`, 5000), `focus is on ${await page.evaluate(`document.activeElement?.outerHTML.slice(0, 120)`)}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('a ring marks the artboard under the mouse, and with Alt held the gap to the hovered element is measured', T, async () => {
      const { url } = await ctx.openNew('hover-measure');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      try {
        const heading = await elementAt(page, 'h1');
        const paragraph = await elementAt(page, 'p');
        await page.hover(...paragraph);
        assert.ok(await page.waitFor(`document.querySelector('[data-hover-ring]')`, 5000), 'no ring on the hovered artboard');
        await page.click(...heading);
        assert.ok(await page.waitFor(buttonNamed('Lock')), 'the heading is selected');
        assert.equal(await page.evaluate(`!!document.querySelector('[data-measure]')`), false, 'measured without Alt');
        for (const dy of [0, 1]) await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: paragraph[0], y: paragraph[1] + dy, modifiers: 1 });
        assert.ok(await page.waitFor(`[...document.querySelectorAll('[data-measure] div')].some(d => d.textContent.trim() === '24')`, 5000),
          `the 24px gap was not measured: ${await page.evaluate(`document.querySelector('[data-measure]')?.textContent ?? 'nothing'`)}`);
        await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: paragraph[0], y: paragraph[1] });
        assert.ok(await page.waitFor(`!document.querySelector('[data-measure]')`, 5000), 'the distances stayed after Alt came up');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('a right-button drag pans the canvas, keeping the selection and opening no menu; a right-click still opens the menu', T, async () => {
      const { url } = await ctx.openNew('right-drag-pan');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      const camera = () => page.evaluate('window.__openArtifactLive().camera');
      // Where the selection bar sits from the heading: it stands at the box of what is selected.
      const barFromHeading = `(() => {
        const bar = document.querySelector('[data-selection-bar]')?.getBoundingClientRect();
        const frame = document.querySelector('iframe[data-board="Main.dc.html"]');
        const rect = frame.getBoundingClientRect(), zoom = rect.width / frame.offsetWidth;
        const heading = frame.contentDocument.querySelector('h1').getBoundingClientRect();
        return bar ? [Math.round(bar.left - (rect.left + heading.left * zoom)), Math.round(bar.top - (rect.top + heading.top * zoom))] : null;
      })()`;
      try {
        await page.click(...await elementAt(page, 'h1'));
        assert.ok(await page.waitFor(buttonNamed('Lock'), 5000), 'the heading is selected');
        const before = { camera: await camera(), bar: await page.evaluate(barFromHeading) };
        assert.ok(before.bar, 'no selection bar');
        // Pressed on another element of the artboard: a right-click there would select it for its menu.
        const from = await elementAt(page, 'p');
        await page.dragMouse(from, [from[0] + 120, from[1] + 60], { button: 'right' });
        assert.ok(await page.waitFor(`(c => Math.abs(c.x - ${before.camera.x + 120}) <= 2 && Math.abs(c.y - ${before.camera.y + 60}) <= 2)(window.__openArtifactLive().camera)`, 5000),
          `the camera went from ${JSON.stringify(before.camera)} to ${JSON.stringify(await camera())}`);
        assert.equal((await camera()).zoom, before.camera.zoom);
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.equal(await page.evaluate(`Boolean(document.querySelector('[role="menu"]'))`), false, 'a menu opened after the drag');
        assert.deepEqual(await page.evaluate(barFromHeading), before.bar, 'the drag changed the selection');
        assert.equal(await page.evaluate(`document.documentElement.hasAttribute('data-right-drag-pan')`), false, 'the canvas stayed grabbed');

        // Without travel, it is a right-click: the menu opens for what is under the pointer.
        await page.rightClick(...await elementAt(page, 'p'));
        assert.ok(await page.waitFor(`document.querySelector('[role="menu"] [role="menuitem"]')`, 5000), 'a right-click opened no menu');
        await page.press('Escape');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('on a touch screen, Delete on the selection bar and the Undo or redo button work, and a locked element has no Delete', T, async () => {
      const { root, url } = await ctx.openNew('touch-delete');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const headings = () => [...fs.readFileSync(path.join(root, BOARD), 'utf8').matchAll(/<h1\b[^>]*>/g)].map(m => m[0]);
      const deleteButton = `document.querySelector('button[aria-label="Delete"]')`;
      try {
        assert.equal(await page.evaluate(`!!${deleteButton} || !!document.querySelector('button[aria-label="Undo or redo"]')`), false, 'touch buttons with a mouse');
        await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        assert.ok(await page.waitFor(`document.querySelector('button[aria-label="Undo or redo"]')`, 5000), 'no Undo or redo button on a touch screen');
        await page.click(...await elementAt(page, 'h1'));
        assert.ok(await page.waitFor(deleteButton, 5000), 'no Delete on the selection bar');
        await clickOn(page, deleteButton, 'Delete');
        assert.ok(await until(() => headings().length === 0, 10000), 'Delete left the heading');
        await clickOn(page, `document.querySelector('button[aria-label="Undo or redo"]')`, 'Undo or redo');
        await clickOn(page, `[...document.querySelectorAll('[role="menuitem"]')].find(m => m.textContent.trim().startsWith('Undo'))`, 'Undo');
        assert.ok(await until(() => headings().length === 1, 10000), 'Undo did not bring the heading back');

        await page.click(...await elementAt(page, 'h1'));
        assert.ok(await page.waitFor(buttonNamed('Lock')), 'the heading is selected again');
        await page.press('l', mod);
        assert.ok(await page.waitFor(`(${buttonNamed('Lock')})?.getAttribute('aria-pressed') === 'true'`, 5000), 'not locked');
        assert.ok(await page.waitFor(`!${deleteButton}`, 5000), 'a locked element still offers Delete');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('⌘L locks an element: saved as data-locked, Delete is refused, ⌘L unlocks it, a duplicate is unlocked', T, async () => {
      const { root, url } = await ctx.openNew('lock-element');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const boardText = () => fs.readFileSync(path.join(root, BOARD), 'utf8');
      const headings = () => [...boardText().matchAll(/<h1\b[^>]*>/g)].map(m => m[0]);
      try {
        const at = await page.evaluate(`(() => {
          const frame = document.querySelector('iframe[data-board="Main.dc.html"]');
          const rect = frame.getBoundingClientRect();
          const box = frame.contentDocument.querySelector('h1').getBoundingClientRect();
          const zoom = rect.width / frame.offsetWidth;
          return [rect.left + (box.left + box.width / 2) * zoom, rect.top + (box.top + box.height / 2) * zoom];
        })()`);
        await page.click(...at);
        assert.ok(await page.waitFor(buttonNamed('Lock')), 'the selection bar offers Lock');
        await page.press('l', mod);
        assert.ok(await until(() => /data-locked="true"/.test(headings()[0] ?? ''), 10000), `not locked: ${headings()}`);
        assert.ok(await page.waitFor(`(${buttonNamed('Lock')})?.getAttribute('aria-pressed') === 'true'`), 'the Lock button shows the lock');

        await page.press('Delete');
        assert.ok(await page.waitFor(textIn('Locked: unlock first.'), 5000), 'Delete says the element is locked');
        assert.equal(headings().length, 1, 'the locked heading was deleted');

        await page.press('l', mod);
        assert.ok(await until(() => !boardText().includes('data-locked'), 10000), '⌘L again removes data-locked');
        await page.press('l', mod);
        assert.ok(await until(() => /data-locked="true"/.test(headings()[0] ?? ''), 10000), 'locked again');
        await page.press('d', mod);
        assert.ok(await until(() => headings().length === 2, 10000), 'Duplicate made no copy');
        assert.deepEqual(headings().map(tag => tag.includes('data-locked')), [true, false], 'only the heading copied from keeps its lock');

        // A click on the locked heading goes through it to what is under it.
        const below = await page.evaluate(`(() => { const r = document.querySelector('iframe[data-board="Main.dc.html"]').getBoundingClientRect(); return [r.left + r.width / 2, Math.min(r.bottom + 40, innerHeight - 10)]; })()`);
        await page.click(...below);
        await page.click(...at);
        const pressed = `(${buttonNamed('Lock')})?.getAttribute('aria-pressed')`;
        assert.ok(await page.waitFor(`${pressed} === 'false'`, 5000), `the click selected the locked heading (Lock pressed: ${await page.evaluate(pressed)})`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('copying a locked element puts no data-locked on the clipboard', T, async () => {
      const { root, url } = await ctx.openNew('lock-copy');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      try {
        const at = await page.evaluate(`(() => {
          const frame = document.querySelector('iframe[data-board="Main.dc.html"]');
          const rect = frame.getBoundingClientRect();
          const box = frame.contentDocument.querySelector('h1').getBoundingClientRect();
          const zoom = rect.width / frame.offsetWidth;
          return [rect.left + (box.left + box.width / 2) * zoom, rect.top + (box.top + box.height / 2) * zoom];
        })()`);
        await page.click(...at);
        assert.ok(await page.waitFor(buttonNamed('Lock')), 'the selection bar offers Lock');
        await page.press('l', mod);
        assert.ok(await until(() => /<h1\b[^>]*data-locked="true"/.test(fs.readFileSync(path.join(root, BOARD), 'utf8')), 10000), 'not locked');
        const copied = await page.evaluate(`(() => {
          const dt = new DataTransfer();
          document.body.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
          return { html: dt.getData('text/html'), text: dt.getData('text/plain') };
        })()`);
        assert.match(copied.html, /<h1\b/i, `nothing copied: ${copied.html.slice(0, 200)}`);
        assert.ok(!copied.html.includes('data-locked'), `the clipboard carries the lock: ${copied.html.slice(0, 400)}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    // An artboard of three blocks in a column: a heading, a paragraph and a red box with a blue border.
    const paintBoard = (_ctx, root) => {
      copyFixture('design', root);
      const file = path.join(root, BOARD);
      const template = `<x-dc><helmet><style>body{margin:0}</style></helmet><div style="width: 880px; height: 560px; padding: 40px; box-sizing: border-box; display: flex; flex-direction: column; gap: 24px">
<h1 style="margin: 0; font-size: 40px">Heading</h1>
<p style="margin: 0; font-size: 20px">Paragraph</p>
<div id="box" style="width: 160px; height: 80px; background-color: rgb(200, 0, 0); border: 4px solid rgb(0, 0, 200)"></div>
</div></x-dc>`;
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/<x-dc>[\s\S]*?<\/x-dc>/, template));
    };
    // Where on the page an element of the artboard is (its middle).
    const boardMiddle = selector => `(() => {
      const frame = document.querySelector('iframe[data-board="Main.dc.html"]');
      const rect = frame.getBoundingClientRect();
      const box = frame.contentDocument.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      const zoom = rect.width / frame.offsetWidth;
      return [rect.left + (box.left + box.width / 2) * zoom, rect.top + (box.top + box.height / 2) * zoom];
    })()`;

    it('Copy and Paste properties: a box’s fill and border land on a shape as fill and stroke, a component instance takes none, ⌘Z undoes a paste in one step', T, async () => {
      const { root, url } = await ctx.openNew('paste-properties', (_ctx, root) => {
        copyFixture('design', root);
        const main = fs.readFileSync(path.join(root, BOARD), 'utf8');
        fs.writeFileSync(path.join(root, 'project/Chip.dc.html'), main.replace(/<x-dc>[\s\S]*?<\/x-dc>/, '<x-dc><div style="width: 80px; height: 40px; background: #eee">Chip</div></x-dc>'));
        const template = `<x-dc><helmet><style>body{margin:0}</style></helmet><div style="width: 880px; height: 560px; padding: 40px; box-sizing: border-box; display: flex; flex-direction: column; gap: 24px">
<p id="para" style="margin: 0; font-size: 20px">Paragraph</p>
<div id="box" style="width: 160px; height: 80px; background-color: rgb(200, 0, 0); border: 4px solid rgb(0, 0, 200)"></div>
<svg id="art" viewBox="0 0 120 60" style="width: 120px; height: 60px"><rect x="0" y="0" width="120" height="60" fill="#888888"></rect></svg>
<dc-import name="Chip" style="display: block; width: 80px; height: 40px"></dc-import>
</div></x-dc>`;
        fs.writeFileSync(path.join(root, BOARD), main.replace(/<x-dc>[\s\S]*?<\/x-dc>/, template));
      });
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.querySelector('#art rect')`, settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const withAlt = { ...mod, alt: true };
      const boardText = () => fs.readFileSync(path.join(root, BOARD), 'utf8');
      const tagOf = id => boardText().match(id === 'shape' ? /<rect [^>]*>/ : new RegExp(`<[a-z]+ id="${id}"[^>]*>`))?.[0] ?? '';
      const say = async text => assert.ok(await page.waitFor(textIn(text), 5000), `it says “${text}”`);
      const chip = `[...document.querySelector('iframe[data-board="Main.dc.html"]').contentDocument.querySelectorAll('*')].find(el => el.textContent === 'Chip' && !el.children.length)`;
      try {
        await page.click(...await page.evaluate(boardMiddle('#box')));
        assert.ok(await page.waitFor(buttonNamed('Lock')), 'the box is selected');
        await page.press('c', withAlt);
        await say('Properties copied');

        await page.click(...await page.evaluate(boardMiddle('#art rect')));
        await new Promise(resolve => setTimeout(resolve, 300));
        await page.evaluate(`document.querySelector('[data-canvas-surface]').focus()`);
        await page.press('v', withAlt);
        assert.ok(await until(() => /fill: #c80000/.test(tagOf('shape')) && /stroke: #0000c8/.test(tagOf('shape')) && /stroke-width: 4px/.test(tagOf('shape')), 10000), `the shape took a fill and a stroke: ${tagOf('shape')}`);
        await say('Properties pasted');

        // A component instance takes none of it.
        const [cx, cy] = await page.evaluate(`(() => { const frame = document.querySelector('iframe[data-board="Main.dc.html"]'); const rect = frame.getBoundingClientRect(); const box = ${chip}.getBoundingClientRect(); const zoom = rect.width / frame.offsetWidth; return [rect.left + (box.left + box.width / 2) * zoom, rect.top + (box.top + box.height / 2) * zoom]; })()`);
        await page.click(cx, cy);
        await new Promise(resolve => setTimeout(resolve, 300));
        await page.evaluate(`document.querySelector('[data-canvas-surface]').focus()`);
        await page.press('v', withAlt);
        await say('The copied properties can’t be pasted onto this element.');

        // Three selected, one can’t take them; one ⌘Z takes the paste back.
        const para = tagOf('para');
        await page.click(...await page.evaluate(boardMiddle('#para')));
        await page.click(...await page.evaluate(boardMiddle('#box')), { shift: true });
        await page.click(cx, cy, { shift: true });
        await new Promise(resolve => setTimeout(resolve, 300));
        await page.evaluate(`document.querySelector('[data-canvas-surface]').focus()`);
        await page.press('v', withAlt);
        await say('Properties pasted. 1 element couldn’t take them.');
        assert.ok(await until(() => /background-color: rgb\(200, 0, 0\)/.test(tagOf('para')) && /border: 4px solid/.test(tagOf('para')), 10000), `the paragraph took the fill and border: ${tagOf('para')}`);
        await page.evaluate(`document.querySelector('[data-canvas-surface]').focus()`);
        await page.press('z', mod);
        assert.ok(await until(() => tagOf('para') === para, 10000), `one ⌘Z takes it back: ${tagOf('para')}`);
        assert.ok(/fill: #c80000/.test(tagOf('shape')), 'the earlier paste stays');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('stacking keys move an element one step or to the end, ⌘Z undoes by the physical key, and a locked element stays', T, async () => {
      const { root, url } = await ctx.openNew('stacking', paintBoard);
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.querySelector('#box')`, settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      // Option on a Mac, Shift elsewhere, takes it to the end.
      const toEnd = process.platform === 'darwin' ? { ...mod, alt: true } : { ...mod, shift: true };
      const boardText = () => fs.readFileSync(path.join(root, BOARD), 'utf8');
      const order = () => ['<h1', '<p', '<div id="box"'].map(tag => boardText().indexOf(tag)).map((at, i, all) => all.filter(other => other < at).length).join('');
      try {
        await page.click(...await page.evaluate(boardMiddle('p')));
        assert.ok(await page.waitFor(buttonNamed('Lock')), 'the paragraph is selected');
        await page.press('[', mod);
        assert.ok(await until(() => order() === '102', 10000), `⌘[ moves the paragraph one earlier: ${order()}`);
        assert.ok(await page.waitFor(textIn('Sent backward'), 5000), 'the move is announced');
        await page.press(']', toEnd);
        assert.ok(await until(() => order() === '021', 10000), `to the end puts it last: ${order()}`);
        await page.press('z', mod);
        assert.ok(await until(() => order() === '102', 10000), `⌘Z undoes the move: ${order()}`);
        await page.press('z', { ...mod, shift: true });
        assert.ok(await until(() => order() === '021', 10000), `⇧⌘Z redoes it: ${order()}`);

        await page.press('l', mod);
        assert.ok(await until(() => /<p [^>]*data-locked="true"/.test(boardText()), 10000), 'the paragraph is locked');
        await page.press('[', mod);
        assert.ok(await page.waitFor(textIn('Locked: unlock first.'), 5000), 'stacking a locked element says why not');
        assert.equal(order(), '021', 'the locked paragraph moved');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('bare ] and [ take an element to the front or back, ⇧⌘] does nothing on a Mac, and Ctrl+Y redoes where ⌘Y does not', T, async () => {
      const { root, url } = await ctx.openNew('stacking-bare', paintBoard);
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.querySelector('#box')`, settle: 800 });
      const mac = process.platform === 'darwin';
      const mod = { meta: mac, ctrl: !mac };
      const boardText = () => fs.readFileSync(path.join(root, BOARD), 'utf8');
      const order = () => ['<h1', '<p', '<div id="box"'].map(tag => boardText().indexOf(tag)).map((at, i, all) => all.filter(other => other < at).length).join('');
      const still = async (want, why) => {
        await new Promise(resolve => setTimeout(resolve, 600));
        assert.equal(order(), want, why);
      };
      try {
        await page.click(...await page.evaluate(boardMiddle('p')));
        assert.ok(await page.waitFor(buttonNamed('Lock')), 'the paragraph is selected');
        await page.press(']');
        assert.ok(await until(() => order() === '021', 10000), `] brings it to the front: ${order()}`);
        assert.ok(await page.waitFor(textIn('Brought to the front'), 5000), 'the move is announced');
        await page.press('[');
        assert.ok(await until(() => order() === '102', 10000), `[ sends it to the back: ${order()}`);
        if (mac) {
          await page.press(']', { meta: true, shift: true });
          await still('102', '⇧⌘] moved the paragraph');
        }
        await page.press('z', mod);
        assert.ok(await until(() => order() === '021', 10000), `⌘Z undoes: ${order()}`);
        if (mac) {
          await page.press('y', { meta: true });
          await still('021', '⌘Y redid on a Mac');
        }
        await page.press('y', { ctrl: true });
        assert.ok(await until(() => order() === '102', 10000), `Ctrl+Y redoes: ${order()}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('artboards stack: ⌘] brings the lower one over the other, saved as the order in canvas.json, and ⌘Z puts it back', T, async () => {
      const { root, url } = await ctx.openNew('board-stack', (_ctx, root) => {
        copyFixture('design', root);
        const canvas = canvasOf(root);
        const entry = canvas.boards['Main.dc.html'];
        canvas.boards['Over.dc.html'] = { ...entry, title: 'Over', x: entry.x + 300, y: entry.y + 200 };
        canvas.order.push('Over.dc.html');
        fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(canvas));
        fs.copyFileSync(path.join(root, BOARD), path.join(root, 'project/Over.dc.html'));
      });
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('[data-board-title="Over.dc.html"]')`, settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const order = () => canvasOf(root).order.join();
      try {
        await clickOn(page, `document.querySelector('[data-board-title="Main.dc.html"]')`, 'the artboard title');
        await page.press(']', mod);
        assert.ok(await until(() => order() === 'Over.dc.html,Main.dc.html', 10000), `⌘] left the order: ${order()}`);
        assert.ok(await page.waitFor(textIn('Brought forward'), 5000), 'the move is announced');
        await page.press('z', mod);
        assert.ok(await until(() => order() === 'Main.dc.html,Over.dc.html', 10000), `⌘Z left the order: ${order()}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('a field committed with Enter hands ⇧X to the canvas and ⌘Z to the history; ⌘S saves at once', T, async () => {
      const { root, url } = await ctx.openNew('committed-field', paintBoard);
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.querySelector('#box')`, settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const boxTag = () => /<div id="box"[^>]*>/.exec(fs.readFileSync(path.join(root, BOARD), 'utf8'))?.[0] ?? '';
      const width = `document.querySelector('input[aria-label="width"]')`;
      try {
        await page.click(...await page.evaluate(boardMiddle('#box')));
        assert.ok(await page.waitFor(buttonNamed('Lock')), 'the box is selected');
        await clickOn(page, buttonNamed('Properties'));
        assert.ok(await page.waitFor(width), 'the properties panel shows the width');
        await clickOn(page, width);
        await page.evaluate(`${width}.select()`);
        await page.type('200');
        await page.press('Enter');
        assert.ok(await until(() => /width:\s*200px/.test(boxTag()), 10000), `Enter commits the width: ${boxTag()}`);
        assert.ok(await page.waitFor(`document.activeElement === ${width}`), 'Enter keeps the field focused');
        await page.press('x', { shift: true });
        assert.ok(await until(() => /background-color:\s*rgb\(0, 0, 200\)/.test(boxTag()), 10000), `⇧X from the committed field swaps: ${boxTag()}`);
        assert.equal(await page.evaluate(`${width}.value`), '200', '⇧X typed into the field');
        await page.press('z', mod);
        assert.ok(await until(() => /background-color:\s*rgb\(200, 0, 0\)/.test(boxTag()), 10000), `⌘Z undoes the swap: ${boxTag()}`);
        await page.press('z', mod);
        assert.ok(await until(() => /width:\s*160px/.test(boxTag()), 10000), `a second ⌘Z undoes the width: ${boxTag()}`);
        // ⌘S in a field writes what was typed, and the browser does not offer to save the page.
        await clickOn(page, width);
        await page.evaluate(`${width}.select()`);
        await page.type('180');
        await page.press('s', mod);
        assert.ok(await until(() => /width:\s*180px/.test(boxTag()), 10000), `⌘S commits the field: ${boxTag()}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('with an artboard’s text box open, ⌘D writes the words and then duplicates, and ⌘X only writes them', T, async () => {
      const { root, url } = await ctx.openNew('text-handoff', paintBoard);
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.querySelector('#box')`, settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const boardText = () => fs.readFileSync(path.join(root, BOARD), 'utf8');
      const editing = `document.querySelector('iframe[data-board="Main.dc.html"]').contentDocument.activeElement?.isContentEditable`;
      try {
        await page.clickTimes(...await page.evaluate(boardMiddle('p')), 2);
        assert.ok(await page.waitFor(editing, 5000), 'double-click opens the text box');
        await page.press('End');
        await page.type(' more');
        // The selection bar takes the focus; the box stays open.
        await page.evaluate(`document.querySelector('[data-focus-region="selection"] button').focus()`);
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.ok(await page.evaluate(`!!document.querySelector('iframe[data-board="Main.dc.html"]').contentDocument.querySelector('[contenteditable="true"], [contenteditable="plaintext-only"]')`), 'the text box closed when the bar took the focus');
        await page.press('x', mod);
        assert.ok(await until(() => /Paragraph more</.test(boardText()), 10000), '⌘X wrote the words');
        assert.ok(await page.waitFor(textIn('Text updated. Press'), 5000), '⌘X says to press it again');
        assert.ok(/<p /.test(boardText()), '⌘X cut the paragraph');
        await page.clickTimes(...await page.evaluate(boardMiddle('p')), 2);
        assert.ok(await page.waitFor(editing, 5000), 'the text box opens again');
        await page.press('End');
        await page.type('!');
        await page.evaluate(`document.querySelector('[data-focus-region="selection"] button').focus()`);
        await page.press('d', mod);
        assert.ok(await until(() => (boardText().match(/Paragraph more!</g) ?? []).length === 2, 10000), `⌘D wrote the words, then duplicated: ${boardText()}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('F6 steps through the regions and wraps, Escape in the selection bar goes home, and F6 leaves an artboard’s text box', T, async () => {
      const { url } = await ctx.openNew('focus-regions', paintBoard);
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.querySelector('#box')`, settle: 800 });
      const region = `(document.activeElement?.closest('[data-focus-region]')?.getAttribute('data-focus-region') ?? null)`;
      try {
        // A click on the canvas, then a key, shows no focus ring round it.
        await page.click(...await page.evaluate(`[innerWidth / 2, innerHeight - 40]`));
        await page.press('ArrowLeft');
        const ringed = `getComputedStyle(document.querySelector('[data-canvas-surface]')).outlineStyle !== 'none'`;
        assert.equal(await page.evaluate(ringed), false, 'the canvas shows a focus ring after a click');
        await page.click(...await page.evaluate(boardMiddle('#box')));
        assert.ok(await page.waitFor(buttonNamed('Lock')), 'the box is selected');
        await page.press('F6');
        assert.ok(await page.waitFor(`${region} === 'selection'`, 5000), `F6 from the canvas: ${await page.evaluate(region)}`);
        assert.ok(await page.evaluate(`document.activeElement === document.querySelector('[data-focus-region="selection"] button')`), 'the focus is on the bar’s first button');
        await page.press('Escape');
        assert.ok(await page.waitFor(`${region} === 'canvas'`, 5000), `Escape in the bar: ${await page.evaluate(region)}`);
        assert.ok(await page.evaluate(ringed), 'the canvas shows no ring when the focus comes home');
        assert.ok(await page.evaluate(`!!(${buttonNamed('Lock')})`), 'Escape in the bar kept the selection');
        const seen = [];
        for (let i = 0; i < 6; i++) {
          await page.press('F6');
          seen.push(await page.evaluate(region));
          if (seen.at(-1) === 'canvas') break;
        }
        assert.deepEqual(seen, ['selection', 'top', 'tools', 'canvas'], 'F6 goes round the regions and back home');
        await page.press('F6', { shift: true });
        assert.equal(await page.evaluate(region), 'tools', '⇧F6 steps back');
        assert.equal(await page.evaluate(`document.activeElement.getAttribute('aria-pressed')`), 'true', 'the tools land on the tool in use');
        await page.clickTimes(...await page.evaluate(boardMiddle('p')), 2);
        assert.ok(await page.waitFor(`document.querySelector('iframe[data-board="Main.dc.html"]').contentDocument.activeElement?.isContentEditable`, 5000), 'the text box opens');
        await page.press('F6');
        assert.ok(await page.waitFor(`${region} === 'selection'`, 5000), `F6 in the text box: ${await page.evaluate(region)}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('on a touch screen, Delete on the selection bar writes an open text box first, then deletes', T, async () => {
      const { root, url } = await ctx.openNew('touch-delete-editing', paintBoard);
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.querySelector('#box')`, settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const boardText = () => fs.readFileSync(path.join(root, BOARD), 'utf8');
      const deleteButton = `document.querySelector('button[aria-label="Delete"]')`;
      try {
        await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        assert.ok(await page.waitFor(`document.querySelector('button[aria-label="Undo or redo"]')`, 5000), 'the page knows it is a touch screen');
        await page.clickTimes(...await page.evaluate(boardMiddle('p')), 2);
        assert.ok(await page.waitFor(`document.querySelector('iframe[data-board="Main.dc.html"]').contentDocument.activeElement?.isContentEditable`, 5000), 'the text box opens');
        await page.press('End');
        await page.type(' kept');
        assert.ok(await page.waitFor(deleteButton, 5000), 'the bar offers Delete while the text is edited');
        await clickOn(page, deleteButton, 'Delete');
        assert.ok(await until(() => !/<p /.test(boardText()), 10000), 'Delete left the paragraph');
        await page.press('z', mod);
        assert.ok(await until(() => /Paragraph kept</.test(boardText()), 10000), `⌘Z brings back the paragraph with the words typed: ${boardText()}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('Delete on objects partly locked removes only the unlocked ones, and none when all are locked', T, async () => {
      const { root, url } = await ctx.openNew('delete-partly-locked', (_ctx, root) => {
        copyFixture('design', root);
        const canvas = canvasOf(root);
        canvas.notes = { ...canvas.notes, free: { x: 0, y: 640, text: 'Free note' }, held: { x: 400, y: 640, text: 'Held note', locked: true } };
        fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(canvas));
      });
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const notes = () => Object.keys(canvasOf(root).notes).sort().join();
      const row = text => `[...document.querySelectorAll('[role=tree][aria-label="Layers"] [role=treeitem]')].find(el => el.textContent.includes(${JSON.stringify(text)}))`;
      try {
        await page.press('\\', mod);
        assert.ok(await page.waitFor(row('Held note'), 5000), 'the layers list shows the notes');
        await clickOn(page, row('Free note'), 'the free note’s row');
        const held = await middleOf(page, row('Held note'));
        await page.click(held.x, held.y, { shift: true });
        assert.ok(await page.waitFor(`${row('Held note')}.getAttribute('aria-selected') === 'true' && ${row('Free note')}.getAttribute('aria-selected') === 'true'`, 5000), 'both notes are selected');
        await page.evaluate(`document.querySelector('[data-canvas-surface]').focus()`);
        await page.press('Delete');
        assert.ok(await until(() => notes() === 'held', 10000), `Delete left: ${notes()}`);
        await page.press('Delete');
        assert.ok(await page.waitFor(textIn('Locked: unlock first.'), 5000), 'Delete on the locked note alone says why not');
        assert.equal(notes(), 'held', 'the locked note was deleted');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    // Where on the page an element of any artboard is (its middle), and its box on the page.
    const middleIn = (board, selector) => `(() => {
      const frame = document.querySelector('iframe[data-board=${JSON.stringify(board)}]');
      const rect = frame.getBoundingClientRect();
      const box = frame.contentDocument.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      const zoom = rect.width / frame.offsetWidth;
      return [rect.left + (box.left + box.width / 2) * zoom, rect.top + (box.top + box.height / 2) * zoom];
    })()`;
    const boxIn = (board, selector) => `(() => {
      const box = document.querySelector('iframe[data-board=${JSON.stringify(board)}]').contentDocument.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return [box.left, box.top, box.width, box.height];
    })()`;
    const withBoard = (root, name, template, dx = 1100) => {
      const canvas = canvasOf(root);
      const entry = canvas.boards['Main.dc.html'];
      canvas.boards[name] = { ...entry, title: name.replace('.dc.html', ''), x: entry.x + dx };
      canvas.order.push(name);
      fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(canvas));
      const main = fs.readFileSync(path.join(root, BOARD), 'utf8');
      fs.writeFileSync(path.join(root, 'project', name), main.replace(/<x-dc>[\s\S]*?<\/x-dc>/, template));
    };

    it('elements of two artboards and a note: the bar offers Duplicate and Delete for all, the panel shows Mixed, and one ⌘Z brings everything back', T, async () => {
      const { root, url } = await ctx.openNew('mixed-selection', (_ctx, root) => {
        paintBoard(_ctx, root);
        withBoard(root, 'Second.dc.html', `<x-dc><helmet><style>body{margin:0}</style></helmet><div style="width: 880px; height: 560px; padding: 40px; box-sizing: border-box"><div id="box" style="width: 160px; height: 80px; background-color: rgb(0, 0, 200)"></div></div></x-dc>`);
        const canvas = canvasOf(root);
        canvas.notes = { ...canvas.notes, memo: { x: 0, y: 700, text: 'Mixed note' } };
        fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(canvas));
      });
      const ready = `document.querySelector('iframe[data-board="Second.dc.html"]')?.contentDocument?.querySelector('#box') && document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.querySelector('#box')`;
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready, settle: 800 });
      const mac = process.platform === 'darwin';
      const mod = { meta: mac, ctrl: !mac };
      const text = name => fs.readFileSync(path.join(root, 'project', name), 'utf8');
      const row = label => `[...document.querySelectorAll('[role=tree][aria-label="Layers"] [role=treeitem]')].find(el => el.textContent.includes(${JSON.stringify(label)}))`;
      const duplicate = `Duplicate 2 elements on 2 artboards and 1 canvas object (${mac ? '⌘' : 'Ctrl+'}D)`;
      const remove = 'Delete 2 elements on 2 artboards and 1 canvas object';
      try {
        await page.click(...await page.evaluate(middleIn('Main.dc.html', '#box')));
        assert.ok(await page.waitFor(buttonNamed('Lock')), 'the box of the first artboard is selected');
        const [x, y] = await page.evaluate(middleIn('Second.dc.html', '#box'));
        await page.click(x, y, { shift: true });
        assert.ok(await page.waitFor(buttonNamed('Delete 2 elements on 2 artboards'), 5000), 'Shift adds the box of the other artboard');
        await page.press('\\', mod);
        assert.ok(await page.waitFor(row('Mixed note'), 5000), 'the layers list shows the note');
        const note = await middleOf(page, row('Mixed note'));
        await page.click(note.x, note.y, { shift: true });
        // Different fills read Mixed; the bar, and its Properties button, stay away while the panel is open.
        assert.ok(await page.waitFor(`document.querySelector('input[aria-label="Fill"]')?.placeholder === 'Mixed'`, 5000), 'the fill row reads Mixed');
        assert.ok(await page.waitFor(textIn('2 elements on 2 artboards and 1 canvas object'), 5000), 'the panel names what is selected');
        assert.ok(await page.waitFor(buttonNamed(duplicate), 5000), `with the panel open the bar still offers “${duplicate}”`);
        assert.equal(await page.evaluate(`Boolean(document.querySelector('[data-selection-bar] [aria-label="Properties"]'))`), false, 'no Properties button while the panel is open');
        await page.press('\\', mod);
        assert.ok(await page.waitFor(`document.querySelector('[data-selection-bar] [aria-label="Properties"]')`, 5000), 'with the panel closed the bar offers Properties');
        assert.ok(await page.evaluate(`Boolean(${buttonNamed(remove)})`), `the bar offers “${remove}”`);
        await clickOn(page, buttonNamed(remove), 'Delete');
        assert.ok(await until(() => !text('Main.dc.html').includes('id="box"') && !text('Second.dc.html').includes('id="box"') && !canvasOf(root).notes.memo, 10000), 'both boxes and the note are gone');
        await page.evaluate(`document.querySelector('[data-canvas-surface]').focus()`);
        await page.press('z', mod);
        assert.ok(await until(() => text('Main.dc.html').includes('id="box"') && text('Second.dc.html').includes('id="box"') && canvasOf(root).notes.memo, 10000), 'one ⌘Z brings back both boxes and the note');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('dragging one member of a selection across files moves all of it, as one undo step', T, async () => {
      const positioned = id => `<x-dc><helmet><style>body{margin:0}</style></helmet><div style="position: relative; width: 880px; height: 560px"><div id="${id}" style="position: absolute; left: 100px; top: 100px; width: 120px; height: 80px; background-color: rgb(200, 0, 0)"></div></div></x-dc>`;
      const { root, url } = await ctx.openNew('mixed-drag', (_ctx, root) => {
        copyFixture('design', root);
        fs.writeFileSync(path.join(root, BOARD), fs.readFileSync(path.join(root, BOARD), 'utf8').replace(/<x-dc>[\s\S]*?<\/x-dc>/, positioned('a')));
        withBoard(root, 'Second.dc.html', positioned('c'));
        const canvas = canvasOf(root);
        canvas.notes = { ...canvas.notes, memo: { x: 0, y: 700, text: 'Moving note' } };
        fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(canvas));
      });
      const ready = `document.querySelector('iframe[data-board="Second.dc.html"]')?.contentDocument?.querySelector('#c') && document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.querySelector('#a')`;
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready, settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const text = name => fs.readFileSync(path.join(root, 'project', name), 'utf8');
      const at = (name, id) => {
        const style = new RegExp(`id="${id}" style="([^"]*)"`).exec(text(name))?.[1] ?? '';
        return [Number(/left: (-?[\d.]+)px/.exec(style)?.[1]), Number(/top: (-?[\d.]+)px/.exec(style)?.[1])];
      };
      const row = label => `[...document.querySelectorAll('[role=tree][aria-label="Layers"] [role=treeitem]')].find(el => el.textContent.includes(${JSON.stringify(label)}))`;
      try {
        await page.click(...await page.evaluate(middleIn('Main.dc.html', '#a')));
        assert.ok(await page.waitFor(buttonNamed('Lock')), 'the first box is selected');
        const [x, y] = await page.evaluate(middleIn('Second.dc.html', '#c'));
        await page.click(x, y, { shift: true });
        await page.press('\\', mod);
        assert.ok(await page.waitFor(row('Moving note'), 5000), 'the layers list shows the note');
        const note = await middleOf(page, row('Moving note'));
        await page.click(note.x, note.y, { shift: true });
        assert.ok(await page.waitFor(buttonNamed('Delete 2 elements on 2 artboards and 1 canvas object'), 5000), 'both boxes and the note are selected');
        await page.press('\\', mod);
        const zoom = await page.evaluate(`(() => { const frame = document.querySelector('iframe[data-board="Main.dc.html"]'); return frame.getBoundingClientRect().width / frame.offsetWidth; })()`);
        const [fromX, fromY] = await page.evaluate(middleIn('Main.dc.html', '#a'));
        await page.dragMouse([fromX, fromY], [fromX + 60, fromY + 30]);
        const dx = 60 / zoom;
        const dy = 30 / zoom;
        const near = (value, want) => Math.abs(value - want) <= 2;
        assert.ok(await until(() => near(at('Main.dc.html', 'a')[0], 100 + dx) && near(at('Second.dc.html', 'c')[0], 100 + dx), 10000), `both boxes moved: ${at('Main.dc.html', 'a')} ${at('Second.dc.html', 'c')} (want ${100 + dx}, ${100 + dy})`);
        assert.ok(near(at('Main.dc.html', 'a')[1], 100 + dy) && near(at('Second.dc.html', 'c')[1], 100 + dy), `both boxes moved down: ${at('Main.dc.html', 'a')} ${at('Second.dc.html', 'c')}`);
        const memo = canvasOf(root).notes.memo;
        assert.ok(near(memo.x, dx) && near(memo.y, 700 + dy), `the note moved with them: ${memo.x}, ${memo.y}`);
        await page.evaluate(`document.querySelector('[data-canvas-surface]').focus()`);
        await page.press('z', mod);
        assert.ok(await until(() => at('Main.dc.html', 'a').join() === '100,100' && at('Second.dc.html', 'c').join() === '100,100' && canvasOf(root).notes.memo.x === 0 && canvasOf(root).notes.memo.y === 700, 10000), `one ⌘Z put everything back: ${at('Main.dc.html', 'a')} ${at('Second.dc.html', 'c')} ${JSON.stringify(canvasOf(root).notes.memo)}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    // Mouse steps sent by hand, so a drag can hold Alt or Shift (`modifiers`: 1 Alt, 8 Shift) and change them on the way.
    const pointer = page => ({
      move: (x, y, modifiers = 0, buttons = 0) => page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers, ...(buttons ? { button: 'left', buttons } : {}) }),
      down: (x, y, modifiers = 0) => page.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers }),
      up: (x, y, modifiers = 0) => page.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers }),
      async drag(from, to, { modifiers = 0, release = modifiers, before } = {}) {
        await this.move(from.x, from.y, modifiers);
        await this.down(from.x, from.y, modifiers);
        for (let n = 1; n <= 10; n++) await this.move(from.x + ((to.x - from.x) * n) / 10, from.y + ((to.y - from.y) * n) / 10, modifiers, 1);
        if (before) await before();
        if (release !== modifiers) await this.move(to.x, to.y, release, 1);
        await this.up(to.x, to.y, release);
      },
    });
    const noteBox = (page, id) => page.evaluate(`(() => { const r = document.querySelector('[data-note=${JSON.stringify(id)}]')?.getBoundingClientRect(); return r?.width ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; })()`);
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

    it('Alt-dragging a note leaves it and copies it as one undo step; Alt let go first moves it, Escape drops it, a locked note copies unlocked', T, async () => {
      const { root, url } = await ctx.openNew('alt-drag-copy', (_ctx, root) => {
        copyFixture('design', root);
        const canvas = canvasOf(root);
        canvas.notes = { ...canvas.notes, memo: { x: 0, y: 700, w: 240, text: 'Copy me' }, held: { x: 400, y: 700, w: 240, text: 'Held note', locked: true } };
        fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(canvas));
      });
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('[data-note="memo"]') && document.querySelector('[data-note="held"]')`, settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const mouse = pointer(page);
      const notes = () => canvasOf(root).notes;
      const others = () => Object.keys(notes()).filter(id => id !== 'memo' && id !== 'held');
      try {
        const box = await noteBox(page, 'memo');
        const zoom = box.w / 240;
        const middle = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
        await mouse.drag(middle, { x: middle.x + 150, y: middle.y }, { modifiers: 1 });
        assert.ok(await until(() => others().length === 1, 10000), `Alt-drag made one copy: ${JSON.stringify(notes())}`);
        const copy = notes()[others()[0]];
        assert.ok(Math.abs(copy.x - 150 / zoom) <= 2 && copy.y === 700 && copy.text === 'Copy me', `the copy is where it was dropped: ${JSON.stringify(copy)}`);
        assert.deepEqual([notes().memo.x, notes().memo.y], [0, 700], 'the original stayed');
        await page.evaluate(`document.querySelector('[data-canvas-surface]').focus()`);
        await page.press('z', mod);
        assert.ok(await until(() => others().length === 0, 10000), `one ⌘Z took the copy away: ${JSON.stringify(notes())}`);

        // Alt let go before the release: a plain move.
        await mouse.drag(middle, { x: middle.x + 150, y: middle.y }, { modifiers: 1, release: 0 });
        assert.ok(await until(() => Math.abs(notes().memo.x - 150 / zoom) <= 2, 10000), `letting go of Alt moved the note: ${JSON.stringify(notes().memo)}`);
        assert.equal(others().length, 0, 'and made no copy');
        await page.press('z', mod);
        assert.ok(await until(() => notes().memo.x === 0, 10000), 'the move is undone');

        // Escape during the drag: nothing happens.
        await mouse.drag(middle, { x: middle.x + 150, y: middle.y }, { modifiers: 1, before: () => page.press('Escape', { alt: true }) });
        await pause(800);
        assert.equal(others().length, 0, `Escape left no copy: ${JSON.stringify(notes())}`);
        assert.deepEqual([notes().memo.x, notes().memo.y], [0, 700], 'Escape left the note where it was');

        // A locked note can't move, but copies, and its copy is not locked.
        const held = await noteBox(page, 'held');
        const from = { x: held.x + held.w / 2, y: held.y + held.h / 2 };
        await mouse.drag(from, { x: from.x, y: from.y + 120 }, { modifiers: 1 });
        assert.ok(await until(() => others().length === 1, 10000), `the locked note was copied: ${JSON.stringify(notes())}`);
        const heldCopy = notes()[others()[0]];
        assert.ok(!heldCopy.locked && Math.abs(heldCopy.y - (700 + 120 / zoom)) <= 2, `the copy is unlocked and below: ${JSON.stringify(heldCopy)}`);
        assert.deepEqual([notes().held.x, notes().held.y, notes().held.locked], [400, 700, true], 'the locked note stayed');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('⌥A lines two positioned elements up on the left as one undo step; elements in the flow are refused', T, async () => {
      const template = `<x-dc><helmet><style>body{margin:0}</style></helmet><div style="position: relative; width: 880px; height: 560px">
        <div id="a" style="position: absolute; left: 100px; top: 100px; width: 120px; height: 80px; background-color: rgb(200, 0, 0)"></div>
        <div id="b" style="position: absolute; left: 300px; top: 260px; width: 60px; height: 40px; background-color: rgb(0, 0, 200)"></div>
        <div style="padding-top: 400px"><p id="p1" style="margin: 0; width: 200px">First line</p><p id="p2" style="margin: 0; width: 200px">Second line</p></div>
      </div></x-dc>`;
      const { root, url } = await ctx.openNew('align-each-other', (_ctx, root) => {
        copyFixture('design', root);
        fs.writeFileSync(path.join(root, BOARD), fs.readFileSync(path.join(root, BOARD), 'utf8').replace(/<x-dc>[\s\S]*?<\/x-dc>/, template));
      });
      const ready = `document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.querySelector('#p2')`;
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready, settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const text = () => fs.readFileSync(path.join(root, BOARD), 'utf8');
      const left = id => Number(new RegExp(`id="${id}" style="[^"]*left: (-?[\\d.]+)px`).exec(text())?.[1]);
      const status = phrase => `window === top && [...document.querySelectorAll('[role=status][aria-live]')].some(el => el.textContent.includes(${JSON.stringify(phrase)}))`;
      try {
        await page.click(...await page.evaluate(middleIn('Main.dc.html', '#a')));
        assert.ok(await page.waitFor(buttonNamed('Lock')), 'the first box is selected');
        await page.press('\\', mod);
        // One box aligns in its parent (placed from the left: Align left reads pressed); two line up with each other (nothing pressed).
        const alignButton = name => `document.querySelector('[role=group][aria-label="Align items"] [aria-label="${name}"]')`;
        const alignLeft = alignButton('Align left');
        assert.ok(await page.waitFor(`window === top && ${alignLeft}?.getAttribute('aria-pressed') === 'true'`, 5000), 'the panel shows the first box placed from the left');
        await page.click(...await page.evaluate(middleIn('Main.dc.html', '#b')), { shift: true });
        assert.ok(await page.waitFor(`window === top && ${alignLeft}?.getAttribute('aria-pressed') === 'false' && !${alignLeft}.disabled`, 5000), 'with both boxes selected the row lines them up with each other');
        await page.evaluate(`document.querySelector('[data-canvas-surface]').focus()`);
        await page.press('a', { alt: true });
        assert.ok(await until(() => left('b') === 100, 10000), `⌥A moved the second box to the left edge: ${left('a')} ${left('b')}`);
        assert.equal(left('a'), 100, 'the first box stayed');
        assert.ok(await page.waitFor(status('Aligned left'), 5000), 'the alignment is announced');
        await page.press('z', mod);
        assert.ok(await until(() => left('b') === 300, 10000), `one ⌘Z put it back: ${left('b')}`);

        await page.click(...await page.evaluate(middleIn('Main.dc.html', '#p1')));
        assert.ok(await page.waitFor(`window === top && ${alignButton('Align top')}?.disabled === true && !${alignLeft}.disabled`, 5000), 'one line alone aligns in its parent, sideways only');
        await page.click(...await page.evaluate(middleIn('Main.dc.html', '#p2')), { shift: true });
        assert.ok(await page.waitFor(`window === top && ${alignLeft}?.disabled === true`, 5000), 'with both lines selected the row turns off');
        await page.evaluate(`document.querySelector('[data-canvas-surface]').focus()`);
        const before = text();
        await page.press('a', { alt: true });
        assert.ok(await page.waitFor(textIn('Nothing moved. Set Position to Absolute on these elements to line them up.'), 5000), 'elements in the flow are refused');
        assert.equal(text(), before, 'and nothing changed');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('drawing snaps: a rectangle starts on a note’s edge, Shift keeps a line on 45°, and the Rectangle tool shows the guide before the press', T, async () => {
      const { root, url } = await ctx.openNew('draw-snap', (_ctx, root) => {
        copyFixture('design', root);
        const canvas = canvasOf(root);
        canvas.notes = { ...canvas.notes, memo: { x: 0, y: 700, w: 240, text: 'Snap to me' } };
        fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(canvas));
      });
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('[data-note="memo"]')`, settle: 800 });
      const mouse = pointer(page);
      const added = kind => Object.entries(canvasOf(root).notes).filter(([id, note]) => id !== 'memo' && note.kind === kind).map(([, note]) => note);
      try {
        const box = await noteBox(page, 'memo');
        const zoom = box.w / 240;
        await page.evaluate(`document.querySelector('[data-canvas-surface]').focus()`);
        await page.press('r');
        // 3 screen pixels right of the note's right edge, above it: the press snaps onto x = 240.
        const start = { x: box.x + box.w + 3, y: box.y - 60 };
        await mouse.drag(start, { x: start.x + 120, y: start.y - 80 });
        assert.ok(await until(() => added('rect').length === 1, 10000), `a rectangle was drawn: ${JSON.stringify(canvasOf(root).notes)}`);
        assert.equal(added('rect')[0].x, 240, `the rectangle starts on the note’s edge: ${JSON.stringify(added('rect')[0])}`);

        await page.evaluate(`document.querySelector('[data-canvas-surface]').focus()`);
        await page.press('l');
        const from = { x: box.x + box.w + 300, y: box.y - 220 };
        await mouse.drag(from, { x: from.x + 100, y: from.y + 80 }, { modifiers: 8 });
        assert.ok(await until(() => added('line').length === 1, 10000), `a line was drawn: ${JSON.stringify(canvasOf(root).notes)}`);
        const line = added('line')[0];
        const [dx, dy] = [line.x2 - line.x, line.y2 - line.y];
        const length = Math.hypot(100, 80) / zoom;
        assert.ok(Math.abs(dx - dy) <= 1 && Math.abs(Math.hypot(dx, dy) - length) <= 2, `Shift kept the line on 45° and its length: ${dx}, ${dy} (length ${length})`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }

      // The guides are DOM lines on the DOM canvas (the engine draws its own into its canvas).
      const dom = await (await ctx.browser()).load(new URL('index.html?open_artifact_engine=off', url).href, { ready: `document.querySelector('[data-note="memo"]')`, settle: 800 });
      try {
        const box = await noteBox(dom, 'memo');
        await dom.evaluate(`document.querySelector('[data-canvas-surface]').focus()`);
        await dom.press('r');
        const hover = pointer(dom);
        await hover.move(box.x + box.w + 3, box.y - 60);
        await hover.move(box.x + box.w + 2, box.y - 60);
        assert.ok(await dom.waitFor(`window === top && [...document.querySelectorAll('[data-snap-guide]')].some(line => line.dataset.at === '240')`, 5000), 'hovering by the note’s edge shows its guide');
        await hover.move(box.x + box.w + 200, box.y - 200);
        assert.ok(await dom.waitFor(`window === top && !document.querySelector('[data-snap-guide]')`, 5000), 'away from every line the guide goes');
        assert.deepEqual(dom.problems, []);
      } finally { await dom.close(); }
    });

    it('⌘G on elements in a flex column makes a group laid out like it', T, async () => {
      const { root, url } = await ctx.openNew('group-flex', paintBoard);
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.querySelector('#box')`, settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const boardText = () => fs.readFileSync(path.join(root, BOARD), 'utf8');
      try {
        await page.click(...await page.evaluate(boardMiddle('h1')));
        assert.ok(await page.waitFor(buttonNamed('Lock')), 'the heading is selected');
        const [x, y] = await page.evaluate(boardMiddle('p'));
        await page.click(x, y, { shift: true });
        await page.press('g', mod);
        const grouped = /<div data-dc-group(?:="")? style="[^"]*display: flex; flex-direction: column; gap: 24px[^"]*">\s*<h1[\s\S]*<p[\s\S]*?<\/p>\s*<\/div>/;
        assert.ok(await until(() => grouped.test(boardText()), 10000), `the heading and paragraph sit in a flex column group: ${boardText()}`);
        assert.ok(await page.waitFor(textIn('Grouped'), 5000), 'grouping is announced');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('⌘G and ⇧⌘G keep positioned elements where they are', T, async () => {
      const { root, url } = await ctx.openNew('group-positioned', (_ctx, root) => {
        copyFixture('design', root);
        const file = path.join(root, BOARD);
        const template = `<x-dc><helmet><style>body{margin:0}</style></helmet><div style="position: relative; width: 880px; height: 560px">
<div id="a" style="position: absolute; left: 40px; top: 50px; width: 120px; height: 60px; background-color: rgb(200, 0, 0)"></div>
<div id="b" style="position: absolute; left: 300px; top: 210px; width: 90px; height: 90px; background-color: rgb(0, 0, 200)"></div>
</div></x-dc>`;
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/<x-dc>[\s\S]*?<\/x-dc>/, template));
      });
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.querySelector('#b')`, settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const boardText = () => fs.readFileSync(path.join(root, BOARD), 'utf8');
      const boxes = async () => [await page.evaluate(boxIn('Main.dc.html', '#a')), await page.evaluate(boxIn('Main.dc.html', '#b'))];
      const same = (a, b) => a.every((box, i) => box.every((value, j) => Math.abs(value - b[i][j]) <= 1));
      try {
        const before = await boxes();
        await page.click(...await page.evaluate(boardMiddle('#a')));
        assert.ok(await page.waitFor(buttonNamed('Lock')), 'the first box is selected');
        const [x, y] = await page.evaluate(boardMiddle('#b'));
        await page.click(x, y, { shift: true });
        await page.press('g', mod);
        assert.ok(await until(() => /data-dc-group[^>]*position: absolute/.test(boardText()), 10000), `a positioned group was made: ${boardText()}`);
        let after = null;
        assert.ok(await page.waitFor(`document.querySelector('iframe[data-board="Main.dc.html"]').contentDocument.querySelector('[data-dc-group] #a')`, 10000), 'the artboard shows the group');
        after = await boxes();
        assert.ok(same(before, after), `grouping kept the boxes: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
        await page.press('g', { ...mod, shift: true });
        assert.ok(await until(() => !boardText().includes('data-dc-group'), 10000), `the group was taken apart: ${boardText()}`);
        assert.ok(await page.waitFor(`!document.querySelector('iframe[data-board="Main.dc.html"]').contentDocument.querySelector('[data-dc-group]')`, 10000), 'the artboard shows no group');
        after = await boxes();
        assert.ok(same(before, after), `ungrouping kept the boxes: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('the pointer over an artboard’s row in the layers list rings the artboard on the canvas', T, async () => {
      const { root, url } = await ctx.openNew('outline-hover');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const title = canvasOf(root).boards['Main.dc.html'].title || 'Main';
      const boardRow = `[...document.querySelectorAll('[role=tree][aria-label="Layers"] [role=treeitem]')].find(el => el.textContent.trim() === ${JSON.stringify(title)})`;
      try {
        await page.press('\\', mod);
        assert.ok(await page.waitFor(boardRow, 5000), 'the layers list is open');
        assert.equal(await page.evaluate(`!!document.querySelector('[data-hover-ring]')`), false, 'a ring before any hover');
        const over = await middleOf(page, boardRow);
        await page.hover(over.x, over.y);
        assert.ok(await page.waitFor(`document.querySelector('[data-hover-ring]')`, 5000), 'no ring for the hovered row');
        await page.hover(...await page.evaluate(`[innerWidth - 20, innerHeight - 20]`));
        assert.ok(await page.waitFor(`window === top && !document.querySelector('[data-hover-ring]')`, 5000), 'the ring stayed after the pointer left the list');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('Escape in a page’s actions menu closes just the menu, and the next closes the Pages list', T, async () => {
      const { url } = await ctx.openNew('pages-escape', (_ctx, root) => {
        copyFixture('design', root);
        const canvas = canvasOf(root);
        canvas.pages = [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }];
        fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(canvas));
      });
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('button[aria-label^="Pages:"]')`, settle: 800 });
      const actions = buttonNamed('Actions for Two');
      try {
        await clickOn(page, `document.querySelector('button[aria-label^="Pages:"]')`, 'the Pages menu');
        await clickOn(page, actions, 'the page’s actions');
        assert.ok(await page.waitFor(`document.querySelector('[role=menu]')`, 5000), 'the actions menu is open');
        await page.press('Escape');
        assert.ok(await page.waitFor(`window === top && !document.querySelector('[role=menu]')`, 5000), 'Escape left the actions menu open');
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.ok(await page.evaluate(`!!(${actions})`), 'Escape in the actions menu closed the Pages list too');
        await page.press('Escape');
        assert.ok(await page.waitFor(`window === top && !(${actions})`, 5000), 'a second Escape left the Pages list open');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('V leaves comment mode, and a comment on a repeated row says which row it is', T, async () => {
      const { root, url } = await ctx.openNew('comment-row', (_ctx, root) => {
        copyFixture('design', root);
        const file = path.join(root, BOARD);
        const rows = `<x-dc><helmet><style>body{margin:0}</style></helmet><div style="width: 880px; height: 560px; padding: 40px; box-sizing: border-box">
<h1 style="margin: 0 0 16px; font-size: 40px">Smoke canvas</h1>
<sc-for list="{{rows}}" as="row"><p style="margin: 0; height: 60px; font-size: 24px">{{row}}</p></sc-for>
</div></x-dc>`;
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
          .replace(/<x-dc>[\s\S]*?<\/x-dc>/, rows)
          .replace(/return \{ accent:[^\n]*/, "return { accent: '#666666', rows: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'] };"));
      });
      const editor = `document.querySelector('iframe[name="open-artifact-shell"]')`;
      const board = `${editor}?.contentDocument?.querySelector('iframe[data-board="Main.dc.html"]')`;
      const shell = await (await ctx.browser()).load(url, { ready: `${board}?.contentDocument?.querySelectorAll('p').length === 5` });
      const file = path.join(root, 'comments.json');
      try {
        assert.ok(await shell.waitFor("document.querySelector('[data-comments-button]')"));
        await clickOn(shell, buttonNamed('Comments'));
        assert.ok(await shell.waitFor("document.querySelector('[data-comment-capture]')"), 'comment mode is on');
        await shell.evaluate(`${editor}.contentWindow.focus(), ${editor}.contentDocument.querySelector('[data-canvas-surface]').focus()`);
        await shell.press('v');
        assert.ok(await shell.waitFor("!document.querySelector('[data-comment-capture]')", 5000), 'V left comment mode on');
        await clickOn(shell, buttonNamed('Comments'));
        assert.ok(await shell.waitFor("document.querySelector('[data-comment-capture]')"), 'comment mode is on again');
        const point = await shell.evaluate(`(() => {
          const outer = ${editor}.getBoundingClientRect();
          const frame = ${board};
          const rect = frame.getBoundingClientRect();
          const zoom = rect.width / frame.offsetWidth;
          const row = frame.contentDocument.querySelectorAll('p')[1].getBoundingClientRect();
          return [outer.left + rect.left + (row.left + 30) * zoom, outer.top + rect.top + (row.top + row.height / 2) * zoom];
        })()`);
        await shell.click(...point);
        assert.ok(await shell.waitFor("document.activeElement?.shadowRoot?.activeElement?.matches('textarea')"), 'the comment box opens');
        await shell.type('Second row');
        await shell.press('Enter');
        assert.ok(await until(() => fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('Second row'), 10000), 'the comment is saved');
        const saved = fs.readFileSync(file, 'utf8');
        assert.match(saved, /row 2 of 5/, `the comment names no row: ${saved}`);
        assert.match(saved, /Beta/, `the comment names no row text: ${saved}`);

        assert.deepEqual(shell.problems.filter(problem => !problem.includes('favicon.ico')), []);
      } finally { await shell.close(); }
    });

    it('⇧X swaps the fill and the border colour, X takes the fill away, and the border can sit centred on the edge', T, async () => {
      const { root, url } = await ctx.openNew('paint-keys', paintBoard);
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.querySelector('#box')`, settle: 800 });
      const boxTag = () => /<div id="box"[^>]*>/.exec(fs.readFileSync(path.join(root, BOARD), 'utf8'))?.[0] ?? '';
      const painted = `(() => { const box = document.querySelector('iframe[data-board="Main.dc.html"]').contentDocument.querySelector('#box'); const s = getComputedStyle(box); return [s.backgroundColor, s.borderTopColor, s.outlineStyle, s.outlineColor, s.outlineOffset].join(' | '); })()`;
      try {
        await page.click(...await page.evaluate(boardMiddle('#box')));
        assert.ok(await page.waitFor(buttonNamed('Lock')), 'the box is selected');
        await page.press('x', { shift: true });
        assert.ok(await page.waitFor(`${painted}.startsWith('rgb(0, 0, 200) | rgb(200, 0, 0)')`, 10000), `⇧X swapped: ${await page.evaluate(painted)}`);
        assert.ok(await page.waitFor(textIn('Fill and stroke swapped'), 5000), 'the swap is announced');

        await page.click(...await page.evaluate(`[innerWidth / 2, innerHeight - 40]`));
        await page.click(...await page.evaluate(boardMiddle('#box')));
        assert.ok(await page.waitFor(buttonNamed('Border')), 'the box is selected again');
        await clickOn(page, buttonNamed('Border'));
        const align = buttonNamed('Border alignment: Inside');
        assert.ok(await page.waitFor(align), 'the border panel offers its alignment');
        await clickOn(page, align);
        assert.ok(await page.waitFor(`${painted} === 'rgb(0, 0, 200) | rgba(0, 0, 0, 0) | solid | rgb(200, 0, 0) | -2px'`, 10000), `centred: ${await page.evaluate(painted)}`);
        assert.ok(await until(() => /outline-offset:\s*-2px/.test(boxTag()), 10000), `the file keeps the centred border: ${boxTag()}`);
        await page.press('Escape');

        await page.press('x');
        assert.ok(await page.waitFor(`${painted}.startsWith('rgba(0, 0, 0, 0)')`, 10000), `X took the fill away: ${await page.evaluate(painted)}`);
        assert.ok(await until(() => /background-color:\s*transparent/.test(boxTag()), 10000), `the file has no fill: ${boxTag()}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    // An image's content fills its border box: a border aligned outside goes away (no gap), the image keeps its size.
    it('an image\u2019s border aligned outside leaves no gap: the border goes, the outline draws it, the box keeps its size', T, async () => {
      const picture = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='16' height='10'><rect width='16' height='10' fill='green'/></svg>")}`;
      const { root, url } = await ctx.openNew('image-border', (_ctx, dir) => {
        copyFixture('design', dir);
        const file = path.join(dir, BOARD);
        const template = `<x-dc><helmet><style>body{margin:0}</style></helmet><div style="width: 880px; height: 560px; padding: 40px; box-sizing: border-box">
<img id="pic" alt="Picture" src="${picture}" style="display: block; width: 160px; height: 100px; border: 4px solid rgb(0, 0, 200)">
</div></x-dc>`;
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/<x-dc>[\s\S]*?<\/x-dc>/, template));
      });
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.querySelector('#pic')`, settle: 800 });
      const picTag = () => /<img id="pic"[^>]*>/.exec(fs.readFileSync(path.join(root, BOARD), 'utf8'))?.[0] ?? '';
      const drawn = `(() => { const pic = document.querySelector('iframe[data-board="Main.dc.html"]').contentDocument.querySelector('#pic'); const s = getComputedStyle(pic); return [s.borderTopStyle, s.borderTopWidth, s.outlineStyle, s.outlineStyle === 'none' ? '-' : s.outlineWidth, s.outlineOffset, pic.offsetWidth, pic.offsetHeight].join(' | '); })()`;
      try {
        assert.equal(await page.evaluate(drawn), 'solid | 4px | none | - | 0px | 168 | 108');
        await page.click(...await page.evaluate(boardMiddle('#pic')));
        assert.ok(await page.waitFor(buttonNamed('Properties')), 'the image is selected');
        await clickOn(page, buttonNamed('Properties'));
        const align = name => `[...document.querySelectorAll('button[aria-label="Border alignment: ${name}"]')].find((b) => b.offsetParent)`;
        assert.ok(await page.waitFor(align('Inside'), 5000), 'the panel offers the border alignment');
        await clickOn(page, align('Inside'));
        assert.ok(await page.waitFor(align('Center'), 10000), 'the border is centred');
        await clickOn(page, align('Center'));
        assert.ok(await page.waitFor(`${drawn} === 'none | 0px | solid | 4px | 0px | 168 | 108'`, 10000), `outside, same size: ${await page.evaluate(drawn)}`);
        assert.ok(await until(() => /border-style:\s*none/.test(picTag()) && /outline-offset:\s*0px/.test(picTag()) && /outline-color:\s*rgb\(0, 0, 200\)/.test(picTag()) && /width:\s*168px/.test(picTag()) && !/border:/.test(picTag()), 10000), `the file has the outline and no border: ${picTag()}`);
        assert.ok(await page.waitFor(align('Outside'), 5000), 'the alignment reads Outside');
        await clickOn(page, align('Outside'));
        assert.ok(await page.waitFor(`${drawn} === 'solid | 4px | none | - | 0px | 168 | 108'`, 10000), `inside again: ${await page.evaluate(drawn)}`);
        assert.ok(await until(() => /border:\s*4px solid rgb\(0, 0, 200\)/.test(picTag()) && /width:\s*160px/.test(picTag()) && !/outline/.test(picTag()), 10000), `the file has the plain border back: ${picTag()}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('closing the link address with Escape or Tab says the address was dropped, and the next Delete only says to press it again', T, async () => {
      const { root, url } = await ctx.openNew('link-card', paintBoard);
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: `document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.querySelector('#box')`, settle: 800 });
      const boardText = () => fs.readFileSync(path.join(root, BOARD), 'utf8');
      const grip = `document.querySelector('[role=separator][aria-label="Resize panel"]')`;
      try {
        await page.click(...await page.evaluate(boardMiddle('h1')));
        const link = buttonNamed('Link the whole text');
        assert.ok(await page.waitFor(link), 'the heading offers a link');
        await clickOn(page, link);
        assert.ok(await page.waitFor(`document.querySelector('input[aria-label="Link"]')`, 5000), 'the address field is there');
        await page.evaluate(`document.querySelector('input[aria-label="Link"]').focus()`);
        await page.type('https://example.com');
        await page.press('Escape');
        assert.ok(await page.waitFor(textIn('Address field closed. The address was not saved'), 5000), 'closing says the address was dropped');
        assert.ok(!boardText().includes('example.com'), 'the dropped address was saved');
        // Tab past the card's last control closes it the same way.
        await clickOn(page, link);
        assert.ok(await page.waitFor(`document.querySelector('input[aria-label="Link"]')`, 5000), 'the address field is back');
        await page.evaluate(`document.querySelector('input[aria-label="Link"]').focus()`);
        await page.type('https://example.org');
        await page.press('Tab');
        // Right away, while the card is still animating out with the focus in it.
        await page.press('Delete');
        assert.ok(await page.waitFor(textIn('again to delete'), 5000), 'the first Delete says to press it again');
        assert.ok(await page.waitFor(`window === top && !document.querySelector('input[aria-label="Link"]')`, 5000), 'Tab past the end closed the card');
        assert.ok(!boardText().includes('example.org'), 'the address left by Tab was saved');
        assert.ok(boardText().includes('<h1'), 'the first Delete deleted the heading');
        await page.press('Delete');
        assert.ok(await until(() => !boardText().includes('<h1'), 10000), 'the second Delete deletes the heading');

        // The panel's resize grip takes the keyboard: Enter steps through the preset widths.
        await page.click(...await page.evaluate(boardMiddle('#box')));
        assert.ok(await page.waitFor(buttonNamed('Properties')), 'the box is selected');
        await clickOn(page, buttonNamed('Properties'));
        assert.ok(await page.waitFor(grip, 5000), 'the side panel is open');
        {
          const width = `Math.round(${grip}.parentElement.getBoundingClientRect().width)`;
          const before = await page.evaluate(width);
          await page.evaluate(`${grip}.focus()`);
          await page.press('Enter');
          assert.ok(await page.waitFor(`${width} !== ${before}`, 5000), `Enter left the panel at ${before}px`);
          assert.ok(await page.evaluate(`${grip}.getAttribute('aria-valuenow') === String(${width})`), 'the grip reports the width');
        }
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('a locked artboard: locked: true in canvas.json, the arrows and Delete leave it, the outline unlocks it', T, async () => {
      const { root, url } = await ctx.openNew('lock-board');
      const page = await (await ctx.browser()).load(new URL('index.html', url).href, { ready: textIn('Smoke canvas'), settle: 800 });
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      const main = () => canvasOf(root).boards['Main.dc.html'];
      try {
        await clickOn(page, `document.querySelector('[data-board-title="Main.dc.html"]')`, 'the artboard title');
        await page.press('l', mod);
        assert.ok(await until(() => main()?.locked === true, 10000), `canvas.json board: ${JSON.stringify(main())}`);
        assert.ok(await page.waitFor(`document.querySelector('[data-board-title="Main.dc.html"] [data-board-locked]')`), 'the title shows the lock');

        await page.press('ArrowRight');
        await page.press('Delete');
        assert.ok(await page.waitFor(textIn('Locked: unlock first.'), 5000), 'the artboard says it is locked');
        assert.deepEqual([main()?.x, main()?.y], [0, 0], 'the locked artboard moved or went away');

        await page.rightClick(...await page.evaluate(`(() => { const r = document.querySelector('[data-board-title="Main.dc.html"]').getBoundingClientRect(); return [r.left + 10, r.top + r.height / 2]; })()`));
        assert.ok(await page.waitFor(`[...document.querySelectorAll('[role=menuitem]')].some(item => item.textContent.trim().startsWith('Unlock'))`), 'the menu offers Unlock');
        await page.press('Escape');

        await clickOn(page, buttonNamed('Show the properties panel'));
        await clickOn(page, buttonNamed('Unlock Main'), 'the outline’s unlock button');
        assert.ok(await until(() => main() && !('locked' in main()), 10000), `unlocking left the key: ${JSON.stringify(main())}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    it('an unreadable canvas.json is shown as such, and left as it is', T, async () => {
      const broken = (ctx_, root) => {
        copyFixture('design', root);
        fs.writeFileSync(path.join(root, 'project', 'canvas.json'), '{"v":3, "boards": {');
      };
      const root = path.join(tmpDir('design-unreadable'), 'artifact');
      fs.mkdirSync(root);
      broken(ctx, root);
      const out = await ctx.cli.json(['open', root, '--type', 'design', '--json']);
      const page = await (await ctx.browser()).load(new URL('index.html', out.url).href, { ready: textIn('could not be read'), settle: 1500, ignore: [/canvas\.json/i] });
      try {
        assert.ok(await page.waitFor(textIn('The editor will not change it until it is fixed.'), 5000), 'no banner for the unreadable canvas.json');
        const waiting = await startWait(ctx, root, 45);
        try {
          await clickOn(page, buttonNamed('Ask agent to fix'));
          const answer = await waiting.done;
          assert.equal(answer.code, 0);
          assert.match(answer.stdout, /Fix project\/canvas\.json/);
        } finally { waiting.child.kill('SIGTERM'); }
        assert.equal(fs.readFileSync(path.join(root, 'project', 'canvas.json'), 'utf8'), '{"v":3, "boards": {', 'the editor rewrote a canvas.json it could not read');
      } finally {
        await page.close();
      }
    });

    it('Copy as SVG and Copy as PNG draw an element’s outline, and leave the page as it was', T, async () => {
      const { root, url } = await ctx.openNew('copy-outline', (_ctx, root) => {
        copyFixture('design', root);
        const file = path.join(root, BOARD);
        const template = `<x-dc><helmet><style>body{margin:0}</style></helmet><div style="width:400px;height:300px;background:#fff7d6;position:relative">
          <div class="ring" style="position:absolute;left:100px;top:100px;width:100px;height:60px;background:#ffffff;outline:4px dashed rgb(200, 20, 50);outline-offset:2px"></div></div></x-dc>`;
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/<x-dc>[\s\S]*?<\/x-dc>/, template));
      });
      const editor = new URL('index.html', url);
      const ring = `document.querySelector('iframe[data-board="Main.dc.html"]')?.contentDocument?.querySelector('.ring')`;
      const page = await (await ctx.browser()).load(editor.href, { ready: ring, settle: 800 });
      const source = fs.readFileSync(path.join(root, BOARD), 'utf8');
      const mod = { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin' };
      // The copied PNG's size, and whether the outline's band above the box (at 1×, y 0 to 4) has red in it.
      const copiedPng = () => page.evaluate(`(async () => {
        const [item] = await navigator.clipboard.read();
        const image = await createImageBitmap(await item.getType('image/png'));
        const g = new OffscreenCanvas(image.width, image.height).getContext('2d');
        g.drawImage(image, 0, 0);
        const band = g.getImageData(0, 2, image.width, 4).data;
        let red = false;
        for (let i = 0; i < band.length; i += 4) if (band[i] > 150 && band[i + 1] < 90 && band[i + 2] < 110 && band[i + 3] > 200) red = true;
        const middle = [...g.getImageData(image.width / 2, image.height / 2, 1, 1).data].slice(0, 3);
        return { width: image.width, height: image.height, red, middle };
      })()`);
      try {
        await page.cdp('Browser.grantPermissions', { origin: editor.origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
        const at = await page.evaluate(`(() => {
          const frame = document.querySelector('iframe[data-board="Main.dc.html"]');
          const rect = frame.getBoundingClientRect();
          const box = ${ring}.getBoundingClientRect();
          const zoom = rect.width / frame.offsetWidth;
          return [rect.left + (box.left + box.width / 2) * zoom, rect.top + (box.top + box.height / 2) * zoom];
        })()`);
        await page.click(...at);
        await page.rightClick(...at);
        await clickOn(page, `[...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent.startsWith('Copy as SVG') && item.getAttribute('aria-disabled') !== 'true')`, 'Copy as SVG');
        assert.ok(await page.waitFor(textIn('Copied as SVG'), 20000), 'the SVG copy finished');
        const svg = await page.evaluate('navigator.clipboard.readText()');
        // The box is 100 × 60; the outline reaches 4 + 2 px past it on each side, and is drawn centred 4 px out.
        assert.match(svg, /^<svg[^>]* width="112" height="72"/, svg.slice(0, 300));
        const rect = /<rect[^>]*stroke="rgb\(200, 20, 50\)"[^>]*>/.exec(svg)?.[0];
        assert.ok(rect, `no outline rect in ${svg.slice(0, 2000)}`);
        assert.match(rect, /width="108"/);
        assert.match(rect, /height="68"/);
        assert.match(rect, /stroke-width="4"/);
        assert.match(rect, /stroke-dasharray="8 4"/);
        assert.doesNotMatch(svg, /oa-capture-outline-/, 'the outline’s lent id stays out of the copy');
        assert.equal(await page.evaluate(`${ring}.hasAttribute('id')`), false, 'the lent id is taken back from the page');

        await page.press('c', { ...mod, shift: true });
        assert.ok(await page.waitFor(textIn('Copied as PNG'), 20000), 'the PNG copy finished');
        const drawn = await copiedPng();
        assert.deepEqual(drawn, { width: 224, height: 144, red: true, middle: [255, 255, 255] }, 'shapes drawing: the PNG holds the outline');

        // A page with a CSS mask is drawn by the browser instead; that drawing makes room for the outline too.
        await page.evaluate(`(() => {
          const doc = document.querySelector('iframe[data-board="Main.dc.html"]').contentDocument;
          doc.head.append(Object.assign(doc.createElement('style'), { textContent: '.unused { mask: none }' }));
          // Note whether a picture drawn by the browser (a <foreignObject>) is loaded.
          const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
          window.paintedByBrowser = false;
          Object.defineProperty(HTMLImageElement.prototype, 'src', {
            ...src,
            set(value) { if (String(value).includes('foreignObject')) window.paintedByBrowser = true; src.set.call(this, value); },
          });
        })()`);
        await page.evaluate('navigator.clipboard.writeText("before")');
        await page.press('c', { ...mod, shift: true });
        assert.ok(await until(async () => (await page.evaluate('navigator.clipboard.read().then(items => items[0].types.join())')) === 'image/png', 20000), 'the second PNG copy finished');
        const painted = await copiedPng();
        assert.equal(await page.evaluate('window.paintedByBrowser'), true, 'the browser drew the second copy');
        assert.deepEqual(painted, { width: 224, height: 144, red: true, middle: [255, 255, 255] }, 'browser drawing: the PNG holds the outline');
        assert.equal(fs.readFileSync(path.join(root, BOARD), 'utf8'), source, 'copying left the artboard file alone');
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });

    // The width and height of the JPEG that starts at `at`, from its start-of-frame marker.
    const jpegSize = (bytes, at) => {
      at += 2;
      while (at < bytes.length && !(bytes[at] === 0xff && bytes[at + 1] >= 0xc0 && bytes[at + 1] <= 0xc2)) at += bytes[at] === 0xff ? 2 + bytes.readUInt16BE(at + 2) : 1;
      return [bytes.readUInt16BE(at + 7), bytes.readUInt16BE(at + 5)];
    };
    const tooLarge = [
      { label: 'JPEG 2×', file: 'Huge@2x.jpg', item: `[...document.querySelectorAll('[role=menuitem]')].filter(item => item.textContent.includes('Selected artboard, 2×'))[1]`, size: bytes => jpegSize(bytes, 0) },
      {
        label: 'PDF', file: 'Huge.pdf', item: `[...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent === 'Selected artboard')`,
        // The page picture's size as the PDF states it must be the size of the JPEG it holds.
        size: bytes => {
          const text = bytes.toString('latin1');
          const stated = [Number(/\/Width (\d+)/.exec(text)?.[1]), Number(/\/Height (\d+)/.exec(text)?.[1])];
          const drawn = jpegSize(bytes, text.indexOf('\xff\xd8\xff'));
          assert.deepEqual(stated, drawn, 'the PDF states the size its picture was drawn at');
          return drawn;
        },
      },
    ];
    for (const format of tooLarge) it(`a ${format.label} export larger than the browser will draw is saved smaller, and says so`, T, async () => {
      const { url } = await ctx.openNew('export-smaller', (_ctx, root) => {
        copyFixture('design', root);
        const index = canvasOf(root);
        Object.assign(index.boards['Main.dc.html'], { title: 'Huge', w: 4200, h: 4200 });
        fs.writeFileSync(path.join(root, 'project/canvas.json'), JSON.stringify(index));
        const file = path.join(root, BOARD);
        const template = '<x-dc><helmet><style>body{margin:0}</style></helmet><div style="width:4200px;height:4200px;background:rgb(30, 140, 60)"></div></x-dc>';
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/<x-dc>[\s\S]*?<\/x-dc>/, template));
      });
      const browser = await ctx.browser();
      const dir = ctx.downloads;
      fs.mkdirSync(dir, { recursive: true });
      await browser.downloadsTo(dir);
      const file = path.join(dir, format.file);
      fs.rmSync(file, { force: true });
      const page = await browser.load(new URL('index.html', url).href, { ready: `document.querySelector('[data-board-title="Main.dc.html"]')`, settle: 800 });
      try {
        // A browser that will not make a canvas past 8192 × 8192: its canvas comes back empty.
        await page.evaluate(`(() => {
          const toBlob = HTMLCanvasElement.prototype.toBlob;
          window.refusedCanvases = 0;
          HTMLCanvasElement.prototype.toBlob = function (callback, ...rest) {
            if (this.width * this.height <= 8192 * 8192) return toBlob.call(this, callback, ...rest);
            window.refusedCanvases++;
            setTimeout(() => callback(null));
          };
        })()`);
        await clickOn(page, `document.querySelector('[data-board-title="Main.dc.html"] button[aria-label="Focus"], [data-board-title="Main.dc.html"] button[aria-label="Play full screen"]')`, 'Focus');
        assert.ok(await page.waitFor(buttonNamed('Back to canvas')), 'the focused view opened');
        await clickOn(page, buttonNamed('Export'));
        assert.ok(await page.waitFor(`${format.item} && ${format.item}.getAttribute('aria-disabled') !== 'true'`), `${format.label} is offered`);
        await clickOn(page, format.item, format.label);
        assert.ok(await page.waitFor(textIn(`Saved “${format.file}” smaller than the size asked for: this browser can’t draw it that large.`), 60000), 'the export says it came out smaller');
        assert.ok(await until(() => fs.existsSync(file) && fs.statSync(file).size > 0, 30000), `the ${format.label} was saved`);
        assert.equal(await page.evaluate('window.refusedCanvases'), 1, 'one empty canvas, then a smaller one');
        const size = format.size(fs.readFileSync(file));
        assert.ok(size[0] < 8400 && size[0] > 8000 && size[0] * size[1] <= 8192 * 8192, `drawn at ${size.join(' × ')}`);
        assert.deepEqual(page.problems, []);
      } finally { await page.close(); }
    });
  },
});
