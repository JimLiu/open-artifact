import type { ArtifactView } from '@open-artifact/protocol';
import type { TestApp as DesktopTestApp } from './lib/app.ts';
import { present } from './lib/assertions.ts';
import type { TestProfile } from './lib/env.ts';
/**
 * Work that is not saved is not let go without asking:
 *
 * - A tab's close waits for the save (up to about 3 s, the tab says it is saving): saved in time, it closes with no
 *   question; not saved, the window's page asks ("… has unsaved changes", Close Anyway / Cancel). Cancel keeps the tab,
 *   Close Anyway closes it. Through the bar's ×, ⌘W (Close Tab) and Escape (Cancel).
 * - A tab whose Shell never said anything of its saving (`saved` null) closes with no question.
 * - The quit (the app's quit, the window's close) waits the same way, then names every tab with unsaved work: Cancel
 *   keeps the app running, Quit Anyway quits it.
 * - A real unsaved state too: a doc in a folder that cannot be written, typed into, closed: asked about.
 *
 * Deterministic: the tabs' saved states are set by the test (test mode's `desktop.test.saved`), except in the last
 * case, where the folder is read-only so the edit can never be saved.
 *
 * Throwaway profile, free port that is not 4800; the daemon is stopped by the pid its own daemon.json names.
 */
import assert from 'node:assert/strict';
import { chmodSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { launchApp, library } from './lib/app.ts';
import { daemonState, freePort, leftovers, makeProfile, sleep, stopDaemon, until } from './lib/env.ts';

const T = { timeout: 120_000 };
const js = (value: unknown) => JSON.stringify(value);
const inDocs = (url: string) => /\/docs\/[0-9a-f]+\//.test(url);
const UNSAVED = { state: 'unsaved', leaveLosesWork: true } as const;
const SAVED = { state: 'saved', leaveLosesWork: false } as const;
const DIALOG = `document.querySelector('[data-testid=unsaved-dialog]')`;

function chmodTree(dir: string, fileMode: number, dirMode: number) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) chmodTree(path, fileMode, dirMode);
    else chmodSync(path, fileMode);
  }
  chmodSync(dir, dirMode);
}

describe('unsaved work: closing a tab and quitting ask first', () => {
  let profile: TestProfile;
  let port: number;
  let app: DesktopTestApp;
  const docs: Record<string, ArtifactView & { folder: string }> = {};
  const readOnly: string[] = [];

  const make = async (title: string) => {
    const folder = join(profile.artifacts, title.toLowerCase());
    const doc = await library(daemonState(profile), 'artifacts.create', { type: 'docs', title, blank: true, folder });
    assert.ok(doc.id, js(doc));
    docs[title] = { ...doc, folder };
    return docs[title];
  };
  const tab = async (id: string) => (await app.state()).tabs.find((t) => t.id === id);
  /** Opens a doc's tab and waits for its Shell to be ready and to have said what it says of its saving first. */
  const openReady = async (id: string) => {
    assert.equal((await app.open(id)).ok, true);
    assert.ok(await until(async () => (await tab(id))?.status === 'ready', 30_000), js(await tab(id)));
    const view = await app.view(id);
    assert.ok(await view.waitInFrame(inDocs, "!!document.querySelector('.doc-text p')", 30_000), 'the doc editor did not draw');
    await sleep(500);
    return view;
  };
  const setSaved = (id: string, saved: import('../src/types.ts').SavedState | null) =>
    app.chrome.evaluate<boolean>(`desktop.test.saved(${js(id)}, ${js(saved)})`);
  const click = (testid: string) => app.chrome.evaluate<boolean>(`document.querySelector('[data-testid=${testid}]').click(), true`);
  const dialogKind = () => app.chrome.evaluate<string | null>(`${DIALOG}?.dataset.kind ?? null`);

  before(async () => {
    profile = makeProfile('oa-desktop-unsaved-');
    port = await freePort();
    app = await launchApp(profile, port);
    await app.line(/\[desktop\] ready /);
    await app.connect();
    for (const title of ['Harbor', 'Lantern', 'Meadow', 'Orchard', 'Quarry']) await make(title);
  });

  after(async () => {
    for (const folder of readOnly) {
      try {
        chmodTree(folder, 0o644, 0o755);
      } catch {
        // Gone.
      }
    }
    await app?.quit({ force: true });
    await stopDaemon(profile);
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it('saved within the wait: the tab says it is saving, then closes with no question', T, async () => {
    const { id } = docs.Harbor;
    await openReady(id);
    assert.equal(await setSaved(id, UNSAVED), true);
    assert.equal(present(await tab(id)).unsaved, true);
    const closed = app.chrome.evaluate<boolean>(`desktop.close(${js(id)})`);
    assert.ok(await until(async () => (await tab(id))?.closing === true, 5000), 'the tab does not say it waits for the save');
    assert.ok(await app.chrome.waitFor(`document.querySelector('[data-tab=${js(id)}]')?.dataset.closing === 'true'`), 'the bar does not show the wait');
    assert.match(await app.chrome.evaluate<string>(`document.querySelector('[data-tab=${js(id)}] [data-testid=tab-closing]')?.textContent ?? ''`), /Saving/);
    await sleep(800);
    assert.equal(await setSaved(id, SAVED), true);
    await closed;
    assert.ok(await until(async () => !(await tab(id)), 5000), 'the tab did not close once saved');
    await app.line(new RegExp(`close ${id}: its work was saved`));
    assert.equal(
      app.lines.some((l) => /ask close/.test(l)),
      false,
      'it asked though the work was saved',
    );
  });

  it('not saved: asked about; Cancel (and Escape) keep the tab', T, async () => {
    const { id } = docs.Lantern;
    await openReady(id);
    await setSaved(id, UNSAVED);
    const started = Date.now();
    void app.chrome.evaluate<boolean>(`desktop.close(${js(id)})`);
    assert.ok(await until(async () => (await dialogKind()) === 'close', 10_000), 'no question');
    const waited = Date.now() - started;
    assert.ok(waited >= 2500, `asked before the wait for the save was over (${waited} ms)`);
    const ask = (await app.state()).ask;
    assert.equal(present(ask).kind, 'close');
    assert.deepEqual(present(ask).names, ['Lantern']);
    assert.equal(await app.chrome.evaluate<string>(`${DIALOG}.querySelector('.confirm-title').textContent`), 'Lantern has changes that are not saved');
    assert.equal(await app.chrome.evaluate<string>(`document.querySelector('[data-testid=confirm-unsaved-yes]').textContent`), 'Close anyway');
    // The view makes room for the question: the overlay is on.
    assert.ok(await until(async () => (await app.state()).overlay === true, 3000), 'the view did not make room for the question');
    // Return presses Cancel: it is the button in focus.
    assert.equal(await app.chrome.evaluate(`document.activeElement?.dataset.testid`), 'confirm-unsaved-cancel');
    await click('confirm-unsaved-cancel');
    await app.line(new RegExp(`close ${id}: kept \\(it has unsaved work\\)`));
    assert.ok(await app.chrome.waitFor(`!${DIALOG}`), 'the question stayed');
    assert.ok(await tab(id), 'Cancel closed the tab');
    assert.equal((await app.state()).ask, null);
    assert.ok(await until(async () => (await app.state()).overlay === false, 3000), 'the view did not come back');

    // ⌘W (Close Tab), then Escape.
    await app.chrome.evaluate<boolean>(`desktop.select(${js(id)})`);
    void app.command('close-tab');
    assert.ok(await until(async () => (await dialogKind()) === 'close', 10_000), 'Close Tab did not ask');
    await app.chrome.evaluate<boolean>(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), true`);
    assert.ok(await app.chrome.waitFor(`!${DIALOG}`), 'Escape did not answer');
    assert.equal(app.lines.filter((l) => l.includes(`close ${id}: kept (it has unsaved work)`)).length, 2);
    assert.ok(await tab(id), 'Escape closed the tab');
  });

  it('not saved: Close Anyway closes the tab', T, async () => {
    const { id } = docs.Lantern;
    // The bar's ×.
    void app.chrome.evaluate<boolean>(`document.querySelector('[data-tab=${js(id)}] .tab-close').click(), true`);
    assert.ok(await until(async () => (await dialogKind()) === 'close', 10_000), 'the × did not ask');
    await click('confirm-unsaved-yes');
    assert.ok(await until(async () => !(await tab(id)), 5000), 'Close Anyway did not close the tab');
    await app.line(new RegExp(`close ${id}: closed with its unsaved work let go, as asked`));
  });

  it('a tab whose saved state is null closes with no question', T, async () => {
    const asked = app.lines.filter((l) => /ask close/.test(l)).length;
    const { id } = docs.Meadow;
    await openReady(id);
    assert.equal(await setSaved(id, null), true);
    assert.equal(present(await tab(id)).saved, null);
    assert.equal(present(await tab(id)).unsaved, false);
    await app.chrome.evaluate<boolean>(`desktop.close(${js(id)})`);
    assert.ok(await until(async () => !(await tab(id)), 3000), 'a tab with no saved state did not close at once');
    assert.equal(app.lines.filter((l) => /ask close/.test(l)).length, asked, 'it asked');
  });

  it('a real unsaved edit (the folder cannot be written) is asked about', T, async () => {
    const { id, folder } = docs.Quarry;
    const view = await openReady(id);
    chmodTree(folder, 0o444, 0o555);
    readOnly.push(folder);
    const placed = await view.inFrame<boolean>(
      inDocs,
      `(() => { const p = document.querySelector('.doc-text p'); const root = p.closest('[contenteditable]'); root.focus(); const s = getSelection(); s.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); s.addRange(r); return document.activeElement === root; })()`,
    );
    assert.equal(placed, true, 'the editor did not take focus');
    await view.type('Cannot be saved.');
    assert.ok(await until(async () => (await tab(id))?.unsaved === true, 30_000), js(await tab(id)));
    void app.command('close-tab');
    assert.ok(await until(async () => (await dialogKind()) === 'close', 10_000), 'no question for a real unsaved edit');
    assert.deepEqual(present((await app.state()).ask).names, ['Quarry']);
    await click('confirm-unsaved-cancel');
    assert.ok(await app.chrome.waitFor(`!${DIALOG}`));
    assert.ok(await tab(id));
  });

  it('the quit waits, names every tab with unsaved work; Cancel keeps the app, Quit Anyway quits', T, async () => {
    const orchard = docs.Orchard.id;
    await openReady(orchard);
    await setSaved(orchard, UNSAVED);
    // Quarry is still open with its real unsaved edit; Harbor opened again, saved: not named.
    await openReady(docs.Harbor.id);
    await setSaved(docs.Harbor.id, SAVED);

    void app.chrome.evaluate<boolean>('desktop.test.quit(false)');
    assert.ok(await until(async () => (await tab(orchard))?.closing === true, 5000), 'the quit does not say it waits for the saves');
    assert.ok(await until(async () => (await dialogKind()) === 'quit', 10_000), 'the quit did not ask');
    const ask = (await app.state()).ask;
    assert.deepEqual([...present(ask).names].sort(), ['Orchard', 'Quarry']);
    const body = await app.chrome.evaluate<string>(`${DIALOG}.querySelector('.confirm-body').textContent`);
    assert.match(body, /Orchard/);
    assert.match(body, /Quarry/);
    assert.doesNotMatch(body, /Harbor/);
    assert.equal(await app.chrome.evaluate<string>(`document.querySelector('[data-testid=confirm-unsaved-yes]').textContent`), 'Quit anyway');
    await click('confirm-unsaved-cancel');
    await app.line(/quit: cancelled \(unsaved work\)/);
    await sleep(500);
    assert.equal(app.exited, null, 'Cancel quit the app');
    assert.equal(present(await tab(orchard)).closing, false);

    // The window's close asks the same; Quit Anyway quits.
    void app.chrome.evaluate<boolean>('desktop.test.closeWindow()').catch(() => {});
    assert.ok(await until(async () => (await dialogKind().catch(() => null)) === 'quit', 10_000), 'closing the window did not ask');
    await click('confirm-unsaved-yes');
    assert.ok(await until(() => app.exited, 15_000), 'Quit Anyway did not quit');
    assert.equal(present<import('./lib/env.ts').ProcessExit | null>(app.exited).code, 0, js(app.exited));
  });
});
