import type { MenuSnapshot } from '../src/menu.ts';
import type { TestApp as DesktopTestApp } from './lib/app.ts';
import { present } from './lib/assertions.ts';
import type { TestProfile } from './lib/env.ts';
/**
 * The menu bar, in the app, in test mode: the application menu as built (`Menu.getApplicationMenu()`, read through the
 * test-only bridge), and its commands run by name (`desktop.test.command`, what each item's click runs): File ▸ New by
 * type, Open Folder… (the folder joins the library owned by nobody), Import… (a zip), Show in Finder, Move To… (the
 * folder really moves, the artifact still opens, the old folder is not made again), Close Tab, Reload, the sidebar,
 * zoom, previous and next tab, the Edit items on the editor in front (a contenteditable one and a text field), logs,
 * doctor, Settings and the new-artifact dialog. Test mode shows no dialog: the folder or file is the test's.
 */
import { BUILTIN_START } from '@open-artifact/protocol';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { launchApp, library } from './lib/app.ts';
import { daemonState, freePort, leftovers, makeProfile, sleep, stopDaemon, until } from './lib/env.ts';

const T = { timeout: 120_000 };
const WORDS = 'Ferry leaves at nine';
const inDocs = (url: string) => /\/docs\/[0-9a-f]+\//.test(url);
const inSheets = (url: string) => /\/sheets\/[0-9a-f]+\//.test(url);

function treeText(dir: string) {
  let text = '';
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    text += statSync(path).isDirectory() ? treeText(path) : readFileSync(path, 'utf8');
  }
  return text;
}

/** Every item of a described menu, depth first. */
const itemsOf = (menu: MenuSnapshot[] | null): MenuSnapshot[] => (menu ?? []).flatMap((item) => [item, ...(item.submenu ? itemsOf(item.submenu) : [])]);

describe('the menu bar', () => {
  let profile: TestProfile;
  let port: number;
  let app: DesktopTestApp;
  let doc: string;
  const run = async <N extends string>(name: N, arg?: unknown) => {
    const out = await app.command(name, arg);
    assert.ok(out.ok, `${name}: ${JSON.stringify(out)}`);
    return out.value;
  };
  const record = (id: string) => library(daemonState(profile), `artifact?id=${encodeURIComponent(id)}`);
  const ready = async (id: string) =>
    assert.ok(await until(async () => (await app.state()).tabs.find((t) => t.id === id)?.status === 'ready', 30_000), `the tab of ${id} was not ready`);

  before(async () => {
    profile = makeProfile('oa-desktop-menu-');
    port = await freePort();
    app = await launchApp(profile, port);
    await app.line(/\[desktop\] ready /);
    await app.connect();
    assert.ok(await until(async () => JSON.stringify(await app.menu()).includes('"new:docs"'), 20_000), 'File ▸ New has no types');
  });

  after(async () => {
    await app?.quit();
    await stopDaemon(profile);
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it("is built as the app has it: its menus, roles, shortcuts, and File ▸ New in the dialog's groups", T, async () => {
    const menu = await app.menu();
    assert.deepEqual(
      present(menu).map((m) => m.label),
      ['Open Artifact', 'File', 'Edit', 'View', 'Window', 'Help'],
    );
    const ids = (label: string) =>
      present(present(present(menu).find((m) => m.label === label)).submenu)
        .filter((i) => i.type !== 'separator')
        .map((i) => i.id ?? i.role);
    assert.deepEqual(ids('Open Artifact'), ['about', 'settings', 'services', 'hide', 'hideothers', 'unhide', 'quit']);
    assert.deepEqual(ids('File'), ['new', 'new-dialog', 'open-folder', 'import', 'reveal', 'move', 'install-app', 'close-tab']);
    assert.deepEqual(ids('Edit'), ['edit:undo', 'edit:redo', 'edit:cut', 'edit:copy', 'edit:paste', 'edit:paste-plain', 'edit:delete', 'edit:select-all']);
    assert.deepEqual(ids('View'), ['reload', 'toggle-sidebar', 'zoom-reset', 'zoom-in', 'zoom-out', 'fullscreen']);
    assert.deepEqual(ids('Window'), ['minimize', 'zoom', 'previous-tab', 'next-tab', 'front']);
    assert.deepEqual(ids('Help'), ['logs', 'doctor']);
    const all = itemsOf(menu);
    const by = (id: string) => all.find((i) => i.id === id);
    assert.equal(present(by('close-tab')).accelerator, 'CmdOrCtrl+W');
    assert.equal(present(by('settings')).accelerator, 'CmdOrCtrl+,');
    assert.equal(present(by('reload')).accelerator, 'CmdOrCtrl+R');
    assert.equal(present(all.find((i) => i.role === 'quit')).label, 'Quit Open Artifact');
    // File ▸ New: the dialog's two groups, in its order, under its headings.
    const types = present(present(by('new')).submenu)
      .filter((i) => i.id)
      .map((i) => present(i.id).slice(4));
    const blank = types.filter((id: string) => (BUILTIN_START.blank as readonly string[]).includes(id));
    assert.deepEqual(
      blank,
      BUILTIN_START.blank.filter((id) => types.includes(id)),
    );
    assert.deepEqual(types.slice(0, blank.length), blank, 'the blank group comes first');
    assert.ok(types.includes('docs') && types.includes('sheets') && types.includes('slides') && types.includes('whiteboard'));
    assert.equal(present(present(by('new')).submenu)[0].enabled, false, 'the group heading is not an item');
    // Nothing in front: the artifact's items are greyed out.
    for (const id of ['reveal', 'move', 'install-app', 'close-tab', 'reload']) assert.equal(present(by(id)).enabled, false, id);
    assert.equal(present(by('open-folder')).enabled, true);
    const refused = await app.command('close-tab');
    assert.ok(!refused.ok);
  });

  it('File ▸ New ▸ Docs makes a blank doc and opens it; the artifact items are enabled then', T, async () => {
    const made = await run('new:docs');
    doc = made.id;
    await ready(doc);
    const view = await app.view(doc);
    assert.ok(await view.waitInFrame(inDocs, "!!document.querySelector('.doc-text p')"), 'the doc editor did not draw');
    const rec = await record(doc);
    assert.equal(rec.type, 'docs');
    assert.equal(rec.owner, null);
    assert.ok(await until(async () => present(itemsOf(await app.menu()).find((i) => i.id === 'reveal')).enabled, 5000), 'Show in Finder stayed greyed out');
    // Words in it, for the moves below.
    await view.inFrame<boolean>(
      inDocs,
      `(() => { const p = document.querySelector('.doc-text p'); const root = p.closest('[contenteditable]'); root.focus(); const s = getSelection(); s.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); s.addRange(r); return true; })()`,
    );
    await view.type(WORDS);
    assert.ok(await until(() => treeText(join(rec.root, 'doc')).includes(WORDS), 15_000), 'the words did not reach the folder');
  });

  it("Edit acts on the editor in front: Select All in the doc (contenteditable) and in a sheet's formula bar (a text field)", T, async () => {
    const view = await app.view(doc);
    await view.inFrame<boolean>(
      inDocs,
      `document.querySelector('.doc-text [contenteditable], .doc-text[contenteditable], [contenteditable]').focus(), getSelection().collapseToEnd(), true`,
    );
    await run('edit:select-all');
    assert.ok(await view.waitInFrame(inDocs, `getSelection().toString().includes(${JSON.stringify(WORDS)})`, 5000), 'Select All did not select the doc');
    const sheet = await run('new:sheets');
    await ready(sheet.id);
    const sv = await app.view(sheet.id);
    assert.ok(await sv.waitInFrame(inSheets, `!!document.querySelector('textarea[aria-label="Formula bar"]')`), 'the sheet did not draw');
    await sv.inFrame<boolean>(inSheets, `(() => { const f = document.querySelector('textarea[aria-label="Formula bar"]'); f.focus(); return true; })()`);
    await sv.type('Ticket');
    await sv.inFrame<boolean>(inSheets, `(() => { const f = document.activeElement; f.setSelectionRange(f.value.length, f.value.length); return true; })()`);
    await run('edit:select-all');
    assert.ok(
      await sv.waitInFrame(
        inSheets,
        `(() => { const f = document.activeElement; return f?.tagName === 'TEXTAREA' && f.selectionStart === 0 && f.selectionEnd === f.value.length && f.value.length > 0; })()`,
        5000,
      ),
      'Select All did not select the field',
    );
    await sv.inFrame<boolean>(
      inSheets,
      `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true })), true`,
    );
    assert.ok(app.lines.some((line) => line.includes(`edit selectAll on tab ${sheet.id}`)));
    await run('close-tab');
    assert.equal(
      (await app.state()).tabs.some((t) => t.id === sheet.id),
      false,
    );
  });

  it('Previous and next tab go over the tabs, the home page first; Close Tab closes the one in front', T, async () => {
    const second = await run('new:docs');
    await ready(second.id);
    assert.equal((await app.state()).current, second.id);
    await run('previous-tab');
    assert.equal((await app.state()).current, doc);
    await run('previous-tab');
    assert.equal((await app.state()).current, 'home');
    await run('previous-tab');
    assert.equal((await app.state()).current, second.id, 'it wraps around');
    await run('next-tab');
    assert.equal((await app.state()).current, 'home');
    await run('next-tab');
    assert.equal((await app.state()).current, doc);
    await run('next-tab');
    await run('close-tab');
    const state = await app.state();
    assert.deepEqual(
      state.tabs.map((t) => t.id),
      [doc],
    );
    assert.equal(state.current, doc);
  });

  it('Reload loads the tab again; the sidebar and zoom follow the menu', T, async () => {
    const reloaded = () => app.lines.filter((line) => line.includes(`tab ${doc}: loaded again`)).length;
    const was = reloaded();
    assert.equal(await run('reload'), true);
    assert.ok(await until(() => reloaded() > was, 15_000), 'not loaded again');
    await ready(doc);
    const collapsed = (await app.state()).sidebarCollapsed;
    assert.equal(await run('toggle-sidebar'), !collapsed);
    assert.equal((await app.state()).sidebarCollapsed, !collapsed);
    await run('toggle-sidebar');
    assert.equal(await run('zoom-in'), 0.5);
    assert.equal(await run('zoom-in'), 1);
    assert.equal(await run('zoom-out'), 0.5);
    assert.equal(await run('zoom-reset'), 0);
    assert.equal(await run('fullscreen'), false, 'test mode: never full screen');
    assert.ok(app.lines.some((line) => line.includes('full screen (test mode: not done)')));
  });

  it("Show in Finder shows the artifact's folder (only logged in test mode)", T, async () => {
    const rec = await record(doc);
    await run('reveal');
    assert.ok(app.lines.some((line) => line.includes(`reveal ${rec.root} (test mode: not shown)`)));
  });

  it('Move To… moves the folder, the library follows, the artifact opens from there, the old folder stays gone', T, async () => {
    const from = (await record(doc)).root;
    const into = join(profile.root, 'Moved here');
    mkdirSync(into);
    const moved = await run('move', { id: doc, into });
    assert.equal(present(moved).from, from);
    assert.equal(present(moved).to, join(into, present(from.split('/').at(-1))));
    assert.equal(existsSync(from), false, 'the old folder is still there');
    assert.equal(JSON.parse(readFileSync(join(present(moved).to, '.artifact.json'), 'utf8')).id, doc);
    assert.ok(treeText(join(present(moved).to, 'doc')).includes(WORDS));
    assert.equal((await record(doc)).root, present(moved).to);
    await ready(doc);
    const view = await app.view(doc);
    assert.ok(
      await view.waitInFrame(inDocs, `document.querySelector('.doc-text')?.innerText.includes(${JSON.stringify(WORDS)})`),
      'the moved doc does not show its words',
    );
    // Writing again goes to the new folder; the old one is not made again.
    await view.inFrame<boolean>(
      inDocs,
      `(() => { const p = [...document.querySelectorAll('.doc-text p')].at(-1); const root = p.closest('[contenteditable]'); root.focus(); const s = getSelection(); s.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); s.addRange(r); return true; })()`,
    );
    await view.type(' and returns');
    assert.ok(await until(() => treeText(join(present(moved).to, 'doc')).includes('and returns'), 15_000), 'the new words did not reach the moved folder');
    await sleep(1000);
    assert.equal(existsSync(from), false, 'the old folder was made again');
  });

  it('Open Folder… adds an artifact folder owned by nobody and opens it; Import… makes one from a zip', T, async () => {
    const bare = join(profile.root, 'Bare sheet');
    mkdirSync(join(bare, 'sheet'), { recursive: true });
    writeFileSync(join(bare, 'sheet', 'sheet.json'), JSON.stringify({ name: 'Bare' }));
    const added = await run('open-folder', bare);
    await ready(present(added).id);
    const rec = await record(present(added).id);
    assert.equal(rec.type, 'sheets');
    assert.equal(rec.root, bare);
    assert.equal(rec.owner, null);
    // A zip of the doc, from the daemon's archive.
    const state = daemonState(profile);
    const zip = await fetch(`${present(state).url}/api/open-artifact.artifact.archive?id=${doc}`, {
      headers: { Authorization: `Bearer ${present(state).token}` },
    });
    assert.equal(zip.status, 200);
    const file = join(profile.root, 'ferry.zip');
    writeFileSync(file, Buffer.from(await zip.arrayBuffer()));
    const imported = await run('import', file);
    assert.notEqual(present(imported).id, doc);
    await ready(present(imported).id);
    const copy = await record(present(imported).id);
    assert.equal(copy.type, 'docs');
    assert.ok(treeText(join(copy.root, 'doc')).includes(WORDS), 'the import does not hold the words');
    const view = await app.view(present(imported).id);
    assert.ok(
      await view.waitInFrame(inDocs, `document.querySelector('.doc-text')?.innerText.includes(${JSON.stringify(WORDS)})`),
      'the imported doc does not show its words',
    );
    // No path given in test mode: no dialog, nothing happens.
    assert.equal(await run('open-folder'), null);
    assert.ok(app.lines.some((line) => line.includes('choose folder (test mode: no dialog)')));
  });

  it('Help: the logs folder (only logged) and doctor (in the service panel); About is only logged', T, async () => {
    await run('logs');
    assert.ok(app.lines.some((line) => line.includes(`open folder ${join(profile.oaHome, 'logs')} (test mode: not opened)`)));
    const doctor = await run('doctor');
    assert.ok(doctor.counts, JSON.stringify(doctor));
    assert.equal(typeof doctor.counts.ok, 'number');
    assert.ok(await app.chrome.waitFor("!!document.querySelector('[data-testid=doctor]')", 10_000), 'the service panel does not show the doctor');
    await app.chrome.evaluate<boolean>("document.querySelector('.scrim .icon-button[aria-label]').click(), true");
    assert.ok(
      await until(async () => !(await app.chrome.evaluate<boolean>("!!document.querySelector('[data-testid=doctor]')")), 5000),
      'the service panel did not close',
    );
    await run('about');
    assert.ok(app.lines.some((line) => line.includes('about (test mode: not shown)')));
  });

  it("Settings… and New Artifact… open the window's own dialogs, over the artifact in front", T, async () => {
    await run('settings');
    assert.ok(await app.chrome.waitFor("!!document.querySelector('[data-testid=settings-dialog]')", 5000), 'Settings did not open');
    await app.chrome.evaluate<boolean>("document.querySelector('[data-testid=settings-done]').click(), true");
    assert.ok(await until(async () => !(await app.chrome.evaluate<boolean>("!!document.querySelector('[data-testid=settings-dialog]')")), 5000));
    await run('new-dialog');
    assert.ok(await app.chrome.waitFor("!!document.querySelector('.new-type[data-type=docs]')", 5000), 'the new-artifact dialog did not open');
  });

  it("a card's More menu and a sidebar row's right-click menu have Show in Finder and Move To…", T, async () => {
    await app.chrome.evaluate<boolean>(
      "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), document.querySelector('.new-dialog button, [data-testid=new-cancel]'), true",
    );
    await app.chrome.evaluate<boolean>("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel')?.click(), true");
    await app.chrome.evaluate<boolean>("desktop.select('home')");
    // A title of its own (the import above is a copy with the same one).
    await library(daemonState(profile), 'artifacts.update', { id: doc, title: 'Moved ferry notes' });
    const rec = await record(doc);
    const card = `[...document.querySelectorAll('.oa-item')].find((item) => item.querySelector('.oa-name')?.textContent === ${JSON.stringify(rec.title)})`;
    assert.ok(await app.chrome.waitFor(`!!${card}`, 10_000), 'no card of the doc');
    await app.chrome.evaluate<boolean>(`${card}.querySelector('.oa-act').click(), true`);
    assert.ok(await app.chrome.waitFor("!!document.querySelector('.oa-menu-item[data-action=reveal]')", 5000), 'no Show in Finder in the card menu');
    const labels = await app.chrome.evaluate<string[]>("[...document.querySelectorAll('.oa-menu-item')].map((b) => b.textContent.trim())");
    assert.deepEqual(labels.slice(4, 6), ['Show in Finder', 'Move To…'], JSON.stringify(labels));
    const reveals = () => app.lines.filter((line) => line.includes(`reveal ${rec.root} (test mode: not shown)`)).length;
    let was = reveals();
    await app.chrome.evaluate<boolean>("document.querySelector('.oa-menu-item[data-action=reveal]').click(), true");
    assert.ok(await until(() => reveals() > was, 5000), `the card's Show in Finder did not show the folder: ${app.lines.slice(-8).join('\n')}`);
    // The sidebar's row of it: right-click.
    const row = `document.querySelector('[data-testid=sidebar] [data-artifact=${JSON.stringify(doc)}]')`;
    assert.ok(await app.chrome.waitFor(`!!${row}`, 5000), 'no sidebar row of the doc');
    await app.chrome.evaluate<boolean>(
      `(() => { const r = ${row}.getBoundingClientRect(); ${row}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 10, button: 2 })); return true; })()`,
    );
    assert.ok(await app.chrome.waitFor("!!document.querySelector('[data-testid=row-menu]')", 5000), 'no right-click menu');
    const box = await app.chrome.evaluate<{ right: number; sidebar: number }>(
      "(() => { const m = document.querySelector('[data-testid=row-menu]').getBoundingClientRect(); const s = document.querySelector('[data-testid=sidebar]').getBoundingClientRect(); return { right: m.right, sidebar: s.right }; })()",
    );
    assert.ok(box.right <= box.sidebar, `the menu goes past the sidebar: ${JSON.stringify(box)}`);
    assert.deepEqual(
      await app.chrome.evaluate<string[]>("[...document.querySelectorAll('[data-testid=row-menu] [role=menuitem]')].map((b) => b.textContent)"),
      ['Open', 'Show in Finder', 'Move To…', 'Install as App…'],
    );
    was = reveals();
    await app.chrome.evaluate<boolean>("document.querySelector('[data-testid=row-reveal]').click(), true");
    assert.ok(await until(() => reveals() > was, 5000), "the row's Show in Finder did not show the folder");
    assert.equal(await app.chrome.evaluate<boolean>("!!document.querySelector('[data-testid=row-menu]')"), false, 'the menu stayed open');
    // Move To… from there: test mode shows no dialog, nothing moves.
    await app.chrome.evaluate<boolean>(
      `${row}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 200, button: 2 })), true`,
    );
    await app.chrome.evaluate<boolean>("document.querySelector('[data-testid=row-move]').click(), true");
    assert.ok(await until(() => app.lines.filter((line) => line.includes('choose folder (test mode: no dialog)')).length >= 2, 5000));
    assert.equal((await record(doc)).root, rec.root);
  });
});
