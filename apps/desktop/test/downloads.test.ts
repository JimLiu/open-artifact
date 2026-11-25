import type { TestApp as DesktopTestApp } from './lib/app.ts';
import { present } from './lib/assertions.ts';
import type { Page as TestPage } from './lib/cdp.ts';
import type { TestProfile } from './lib/env.ts';
/**
 * Files the artifact views save, in the app, in test mode: a Docs export (Markdown) and a Sheets export (CSV, then
 * again: the type server names the second ` (2)`), the folder's zip (a download of the view itself), a page's own
 * `blob:` download twice (the app names the second ` (2)`), each landing in the throwaway HOME's Downloads with no
 * dialog, non-empty, with the right extension, and each saying so in the notice (Show in Finder only logged in test
 * mode); a download from another program's loopback server (reached by a navigation DevTools starts, past the views'
 * navigation guard) is cancelled and logged.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { launchApp } from './lib/app.ts';
import { buttonNamed } from './lib/cdp.ts';
import { freePort, leftovers, makeProfile, stopDaemon, until } from './lib/env.ts';

const T = { timeout: 120_000 };

describe('downloads and exports', () => {
  let profile: TestProfile;
  let port: number;
  let app: DesktopTestApp;
  let downloads: string;
  let foreign: ReturnType<typeof createServer>;
  let foreignHits = 0;
  const files = () => (existsSync(downloads) ? readdirSync(downloads).sort() : []);
  const newFile = async (before: string[], ext: string, timeoutMs = 30_000): Promise<string> => {
    let found: string | null | undefined = null;
    await until(() => (found = files().find((name) => !before.includes(name) && name.endsWith(ext))), timeoutMs);
    assert.ok(found, `no new ${ext} in ${downloads}: ${files().join(', ')}`);
    return present<string | null | undefined>(found);
  };
  /** A new artifact of `type` from the menu's File ▸ New, its tab ready. */
  const make = async (type: string) => {
    const made = await app.command(`new:${type}`);
    assert.ok(made.ok, JSON.stringify(made));
    const id = made.value.id;
    const view = await app.view(id);
    assert.ok(await until(async () => (await app.state()).tabs.find((t) => t.id === id)?.status === 'ready', 30_000), 'the tab was not ready');
    return { id, view };
  };
  /** The Export tab's row `label`, from Artifact options (or, for Sheets, Share). */
  const exportRow = async (view: TestPage, label: string, { from = 'Artifact options' } = {}) => {
    await view.clickOn(from === 'Share' ? "document.querySelector('button[aria-label=Share]')" : buttonNamed(from));
    await view.clickOn(buttonNamed('Export'));
    await view.clickOn(`document.querySelector('[data-export-row="${label}"]:not([disabled])')`, { timeoutMs: 15_000 });
  };
  const noticeOf = async (name: string): Promise<NonNullable<Awaited<ReturnType<import('../src/contracts.ts').DesktopBridge['test']['notice']>>>> => {
    let shown: Awaited<ReturnType<import('../src/contracts.ts').DesktopBridge['test']['notice']>> = null;
    await until(
      async () =>
        (shown = await app.chrome.evaluate<{
          id: string | null;
          name: string;
          where: string;
          kind: import('../src/types').NoticeData['kind'];
          visible: boolean;
        } | null>('desktop.test.notice()'))?.name === name,
      10_000,
    );
    return present<Awaited<ReturnType<import('../src/contracts.ts').DesktopBridge['test']['notice']>>>(shown);
  };

  before(async () => {
    profile = makeProfile('oa-desktop-downloads-');
    downloads = join(profile.home, 'Downloads');
    port = await freePort();
    // Another program on this computer, offering a file.
    foreign = createServer((req, res) => {
      foreignHits++;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="elsewhere.bin"' });
      res.end('not for the app');
    });
    await new Promise<void>((done) => foreign.listen(0, '127.0.0.1', done));
    app = await launchApp(profile, port);
    await app.line(/\[desktop\] ready /);
    await app.connect();
    assert.ok(await until(async () => JSON.stringify(await app.menu()).includes('"new:docs"'), 20_000), 'File ▸ New has no types');
  });

  after(async () => {
    await app?.quit();
    await stopDaemon(profile);
    foreign?.close();
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it("the downloads folder is the throwaway HOME's", T, async () => {
    assert.equal(await app.chrome.evaluate<string>('desktop.test.downloads()'), downloads);
  });

  it('a Docs export (Markdown) is saved there with no dialog, and the notice says so', T, async () => {
    const { view } = await make('docs');
    const inDocs = (url: string) => /\/docs\/[0-9a-f]+\//.test(url);
    assert.ok(await view.waitInFrame(inDocs, "!!document.querySelector('.doc-text p')"), 'the doc editor did not draw');
    await view.inFrame<boolean>(
      inDocs,
      `(() => { const p = document.querySelector('.doc-text p'); const root = p.closest('[contenteditable]'); root.focus(); const s = getSelection(); s.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); s.addRange(r); return true; })()`,
    );
    await view.type('Ferry timetable');
    assert.ok(await until(async () => present((await app.state()).tabs.at(-1)).saved === 'saved', 15_000), 'the doc was not saved');
    const before = files();
    await exportRow(view, 'Markdown (.md)');
    const name = await newFile(before, '.md');
    const text = readFileSync(join(downloads, name), 'utf8');
    assert.match(text, /Ferry timetable/);
    const shown = await noticeOf(name);
    assert.equal(present(shown).visible, true);
    assert.match(present(shown).where, /Downloads/);
    assert.ok(
      app.lines.some((line) => line.includes('"via":"shell"') && line.includes(name)),
      "not logged as the Shell's saved file",
    );
    // Show in Finder, from the notice's own page: only logged in test mode.
    const target = await app.cdp.waitTarget((t) => t.type === 'page' && t.url.endsWith('/renderer/notice/notice.html'));
    const page = await app.cdp.attach(target.targetId);
    await page.send('Runtime.enable');
    assert.equal(await page.evaluate<string>(`document.querySelector('[data-testid=notice-name]').textContent`), name);
    await page.evaluate<boolean>(`document.querySelector('[data-testid=notice-reveal]').click(), true`);
    assert.ok(
      await until(() => app.lines.some((line) => line.includes(`reveal ${join(downloads, name)} (test mode: not shown)`)), 5000),
      'Show in Finder was not asked for the file',
    );
    await page.evaluate<boolean>(`document.querySelector('[data-testid=notice-close]').click(), true`);
    assert.ok(
      await until(
        async () =>
          (await app.chrome.evaluate<{
            id: string | null;
            name: string;
            where: string;
            kind: import('../src/types').NoticeData['kind'];
            visible: boolean;
          } | null>('desktop.test.notice()')) === null,
        5000,
      ),
      'the notice did not close',
    );
  });

  it("the folder's zip is the view's own download, saved there; again, it is named (2)", T, async () => {
    const view = await app.view((await app.state()).current);
    const before = files();
    await exportRow(view, 'Whole folder (.zip)');
    const first = await newFile(before, '.zip');
    assert.ok(statSync(join(downloads, first)).size > 0);
    assert.equal(readFileSync(join(downloads, first)).subarray(0, 2).toString(), 'PK');
    await exportRow(view, 'Whole folder (.zip)');
    const second = await newFile([...before, first], '.zip');
    assert.equal(second, first.replace(/\.zip$/, ' (2).zip'));
    assert.ok(app.lines.some((line) => line.includes('"via":"download"') && line.includes(second)));
    await noticeOf(second);
  });

  it('a Sheets export (CSV) is saved there; exported again, the second is named (2)', T, async () => {
    const { view } = await make('sheets');
    const inSheets = (url: string) => /\/sheets\/[0-9a-f]+\//.test(url);
    assert.ok(await view.waitInFrame(inSheets, `!!document.querySelector('textarea[aria-label="Formula bar"]')`), 'the sheet did not draw');
    await view.inFrame<boolean>(inSheets, `document.querySelector('textarea[aria-label="Formula bar"]').focus(), true`);
    await view.type('Ferry');
    await view.inFrame<boolean>(
      inSheets,
      `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true })), true`,
    );
    assert.ok(await until(async () => present((await app.state()).tabs.at(-1)).saved === 'saved', 15_000), 'the sheet was not saved');
    const before = files();
    await exportRow(view, 'CSV', { from: 'Share' });
    const first = await newFile(before, '.csv');
    assert.match(readFileSync(join(downloads, first), 'utf8'), /Ferry/);
    await noticeOf(first);
    await exportRow(view, 'CSV', { from: 'Share' });
    const second = await newFile([...before, first], '.csv');
    assert.equal(second, first.replace(/\.csv$/, ' (2).csv'));
    assert.ok(statSync(join(downloads, second)).size > 0);
    await noticeOf(second);
  });

  it("a page's own blob: download is saved with no dialog; a second of the same name is (2)", T, async () => {
    const view = await app.view((await app.state()).current);
    const blob = `(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['ferry'], { type: 'text/plain' })); a.download = 'ferry-note.txt'; document.body.append(a); a.click(); a.remove(); return true; })()`;
    const before = files();
    await view.evaluate<boolean>(blob);
    assert.equal(await newFile(before, 'ferry-note.txt'), 'ferry-note.txt');
    await view.evaluate<boolean>(blob);
    assert.equal(await newFile([...before, 'ferry-note.txt'], '.txt'), 'ferry-note (2).txt');
    assert.equal(readFileSync(join(downloads, 'ferry-note (2).txt'), 'utf8'), 'ferry');
  });

  it("a download from another program's loopback server is cancelled and logged", T, async () => {
    const view = await app.view((await app.state()).current);
    const url = `http://127.0.0.1:${(foreign.address() as import('node:net').AddressInfo).port}/elsewhere.bin`;
    const before = files();
    // A page's own link there is a navigation (a cross-origin `download` is not honoured), which the views refuse
    // before anything is fetched; a navigation the page does not start (DevTools') reaches the download itself.
    await view.send('Page.navigate', { url });
    assert.ok(
      await until(() => app.lines.some((line) => line.includes(`download cancelled: ${url}`)), 10_000),
      `not cancelled:\n${app.lines.filter((l) => /download/.test(l)).join('\n')}`,
    );
    await new Promise((done) => setTimeout(done, 500));
    assert.deepEqual(files(), before, 'something was saved');
    assert.equal(
      files().some((name) => name.includes('elsewhere')),
      false,
    );
    assert.ok(foreignHits <= 1, 'the server was asked more than once');
  });
});
