/**
 * An artifact whose folder was moved outside Open Artifact:
 *
 * - The library still lists it (`folderMissing: true`). Its tab shows "The folder of this artifact cannot be found" with the
 *   folder the library had, Relocate… and Remove from Library; no Shell is loaded for it.
 * - Relocate… with a folder that is not the artifact's shows the daemon's answer as it is, and the tab stays.
 * - Relocate… with the folder it was moved to: the library is told, the tab opens from there, the editor draws.
 * - Remove from Library: the record goes (the library's delete, with Undo), the tab closes, the folder is not touched.
 *
 * The system's folder dialog is never shown: test mode's `desktop.test.pickNext(path)` says what the next one picks.
 *
 * Throwaway profile, free port that is not 4800; the daemon is stopped by the pid its own daemon.json names.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { daemonState, freePort, leftovers, makeProfile, stopDaemon, until } from './lib/env.mjs';
import { launchApp, library } from './lib/app.mjs';

const T = { timeout: 120_000 };
const js = (value) => JSON.stringify(value);
const inDocs = (url) => /\/docs\/[0-9a-f]+\//.test(url);
const PAGE = `document.querySelector('[data-testid=missing-folder]')`;

describe('an artifact whose folder was moved: Relocate… and Remove from Library', () => {
  let profile;
  let port;
  let app;
  let away;
  const made = {};

  const tab = async (id) => (await app.state()).tabs.find((t) => t.id === id);
  const make = async (title) => {
    const folder = join(profile.artifacts, title.toLowerCase());
    const doc = await library(daemonState(profile), 'artifacts.create', { type: 'docs', title, blank: true, folder });
    assert.ok(doc.id, js(doc));
    made[title] = { id: doc.id, folder, moved: join(away, title.toLowerCase()) };
    return made[title];
  };
  /** Moves the folder away, as Finder would, and opens the artifact's tab: it says the folder is gone. */
  const moveAndOpen = async ({ id, folder, moved }) => {
    renameSync(folder, moved);
    const listed = (await library(daemonState(profile), 'artifacts')).artifacts.find((a) => a.id === id);
    assert.equal(listed?.folderMissing, true, js(listed));
    assert.equal((await app.open(id)).ok, true);
    assert.ok(await until(async () => (await tab(id))?.status === 'missing', 15_000), js(await tab(id)));
    assert.ok(await app.chrome.waitFor(`${PAGE}?.dataset.tab === ${js(id)}`), 'the missing-folder page is not shown');
  };

  before(async () => {
    profile = makeProfile('oa-desktop-relocate-');
    port = await freePort();
    away = join(profile.root, 'moved-away');
    mkdirSync(away, { recursive: true });
    app = await launchApp(profile, port);
    await app.line(/\[desktop\] ready /);
    await app.connect();
    await make('Glacier');
    await make('Juniper');
  });

  after(async () => {
    await app?.quit({ force: true });
    await stopDaemon(profile);
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it('the tab says the folder is gone, with the old path; no Shell is loaded', T, async () => {
    const glacier = made.Glacier;
    await moveAndOpen(glacier);
    const shown = await app.chrome.evaluate(`({
      title: ${PAGE}.querySelector('.missing-title').textContent,
      path: document.querySelector('[data-testid=missing-path]').textContent,
      relocate: document.querySelector('[data-testid=missing-relocate]').textContent,
      remove: document.querySelector('[data-testid=missing-remove]').textContent,
      word: document.querySelector('[data-tab=${js(glacier.id)}] .tab-state')?.textContent ?? null,
    })`);
    assert.equal(shown.title, 'The folder of this artifact cannot be found');
    assert.equal(shown.path, glacier.folder);
    assert.equal(shown.relocate, 'Relocate…');
    assert.equal(shown.remove, 'Remove from Library');
    assert.equal(shown.word, 'Folder not found');
    assert.equal((await tab(glacier.id)).missing, glacier.folder);
    await app.line(new RegExp(`tab ${glacier.id}: its folder is gone`));
    const shells = (await app.cdp.targets()).filter((t) => t.type === 'page' && new URL(t.url || 'about:blank').pathname === `/a/${glacier.id}`);
    assert.deepEqual(shells, [], 'a Shell was loaded for an artifact whose folder is gone');
    // The daemon did not make the folder again.
    assert.equal(existsSync(glacier.folder), false);
  });

  it('Relocate… to a folder that is not the artifact\'s shows the daemon\'s answer; the tab stays', T, async () => {
    const { id } = made.Glacier;
    const wrong = join(profile.root, 'not-an-artifact');
    mkdirSync(wrong, { recursive: true });
    await app.chrome.evaluate(`desktop.test.pickNext(${js(wrong)})`);
    await app.chrome.evaluate(`document.querySelector('[data-testid=missing-relocate]').click(), true`);
    assert.ok(await app.chrome.waitFor(`!!document.querySelector('[data-testid=missing-error]')`, 15_000), 'no error shown');
    const error = await app.chrome.evaluate(`document.querySelector('[data-testid=missing-error]').textContent`);
    assert.ok(error.includes(`${wrong} has no .artifact.json: it is not an artifact's folder.`), error);
    assert.equal((await tab(id)).status, 'missing');
  });

  it('Relocate… to where it was moved: the library is told, the tab opens from there', T, async () => {
    const { id, moved } = made.Glacier;
    await app.chrome.evaluate(`desktop.test.pickNext(${js(moved)})`);
    await app.chrome.evaluate(`document.querySelector('[data-testid=missing-relocate]').click(), true`);
    assert.ok(await until(async () => (await tab(id))?.status === 'ready', 30_000), js(await tab(id)));
    await app.line(new RegExp(`relocate ${id}: ${moved.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
    const record = await library(daemonState(profile), `artifact?id=${id}`);
    assert.equal(record.root, moved);
    assert.equal(record.folderMissing, false);
    assert.equal(await app.chrome.evaluate(`!!${PAGE}`), false, 'the missing-folder page stayed');
    const view = await app.view(id);
    assert.ok(await view.waitInFrame(inDocs, "!!document.querySelector('.doc-text p')", 30_000), 'the doc editor did not draw');
  });

  it('Remove from Library: the record goes, the tab closes, the folder stays', T, async () => {
    const juniper = made.Juniper;
    await moveAndOpen(juniper);
    await app.chrome.evaluate(`document.querySelector('[data-testid=missing-remove]').click(), true`);
    assert.ok(await until(async () => !(await tab(juniper.id)), 15_000), 'the tab did not close');
    const listed = (await library(daemonState(profile), 'artifacts')).artifacts.map((a) => a.id);
    assert.equal(listed.includes(juniper.id), false, 'still in the library');
    assert.ok(existsSync(join(juniper.moved, '.artifact.json')), 'the moved folder was touched');
  });

  it('with a tab in front, how Open Folder… went is said in the notice over the tab', T, async () => {
    const { id } = made.Glacier;
    await app.chrome.evaluate(`desktop.select(${js(id)})`);
    assert.equal((await app.state()).current, id);
    // A folder that holds no artifact: refused, said as an error.
    const empty = join(profile.root, 'nothing-here');
    mkdirSync(empty, { recursive: true });
    const refused = await app.command('open-folder', empty);
    assert.equal(refused.ok, false, js(refused));
    assert.ok(await until(async () => (await app.chrome.evaluate('desktop.test.notice()'))?.kind === 'error', 10_000), js(await app.chrome.evaluate('desktop.test.notice()')));
    const said = await app.chrome.evaluate('desktop.test.notice()');
    assert.match(said.name, /^It was not opened: /);
    await app.line(/notice says /);
    // A folder that holds one: added and opened; the notice says so over the new tab.
    const bare = join(profile.root, 'Bare sheet');
    mkdirSync(join(bare, 'sheet'), { recursive: true });
    writeFileSync(join(bare, 'sheet', 'sheet.json'), JSON.stringify({ name: 'Bare' }));
    const added = await app.command('open-folder', bare);
    assert.equal(added.ok, true, js(added));
    assert.ok(await until(async () => /^Added to the library: /.test((await app.chrome.evaluate('desktop.test.notice()'))?.name ?? ''), 10_000), js(await app.chrome.evaluate('desktop.test.notice()')));
    assert.equal((await app.state()).current, added.value.id);
  });
});
