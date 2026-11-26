import type { ArtifactView } from '@open-artifact/protocol';
import type { SettingsValues } from '../src/settings.ts';
import type { TestApp as DesktopTestApp } from './lib/app.ts';
import { present } from './lib/assertions.ts';
import type { Page as TestPage } from './lib/cdp.ts';
import type { TestProfile } from './lib/env.ts';
/**
 * The window's own page, driven over DevTools with the window never shown: the home page lists the library (made
 * through the Library API), a card opens its tab, the sidebar's recent and pinned lists follow the library, a rename
 * reaches the sidebar and the tab, a delete takes it away and Undo brings it back, the new-artifact dialog makes a
 * blank doc that opens in its editor (typing reaches its folder) and an empty design that opens on the Shell's
 * hand-to-an-agent prompt, back and forward go over the tabs, the sidebar collapses (and stays so in the app's
 * settings), Search brings the library forward with its search field focused, the daemon's token is nowhere the
 * page can reach, and an agent's artifacts say their project, which the filter's Project submenu narrows the library to.
 *
 * Throwaway profile, free port that is not 4800; the daemon is stopped by the pid its own daemon.json names.
 */
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { launchApp, library } from './lib/app.ts';
import { daemonState, freePort, leftovers, makeProfile, stopDaemon, until } from './lib/env.ts';

const T = { timeout: 120_000 };
const WORDS = 'Tide tables for the crossing.';
const inDocs = (url: string) => /\/docs\/[0-9a-f]+\//.test(url);

/** Every file under `dir` as text, joined. */
function treeText(dir: string) {
  let text = '';
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    text += statSync(path).isDirectory() ? treeText(path) : readFileSync(path, 'utf8');
  }
  return text;
}

const js = (value: unknown) => JSON.stringify(value);

describe('the home page, the sidebar and the tab bar', () => {
  let profile: TestProfile;
  let port: number;
  let app: DesktopTestApp;
  let page: TestPage;
  const made: Record<string, ArtifactView> = {};

  /** Runs in the window's page. */
  const run = <T = unknown>(expression: string) => page.evaluate<T>(expression);
  const waitFor = (expression: string, timeoutMs = 15_000) => page.waitFor(expression, timeoutMs);
  const state = () => app.state();
  /** The home page's card of a title (its `.oa-item`). */
  const card = (title: string) => `[...document.querySelectorAll('.oa-item')].find((item) => item.querySelector('.oa-name')?.textContent === ${js(title)})`;
  const sidebarTitles = (section: string) =>
    run<string[]>(`[...document.querySelectorAll('[data-testid=${section}] [data-artifact] .row-title')].map((e) => e.textContent)`);
  /** Types into a React input as a person would (its own value setter, then an input event). */
  const fill = (selector: string, value: unknown) =>
    run<boolean>(`(() => {
      const input = document.querySelector(${js(selector)});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${js(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  /** Opens a card's menu and picks an item by its label. */
  const menu = async (title: string, label: string) => {
    assert.equal(await run<boolean>(`(() => { const item = ${card(title)}; item.querySelector('.oa-act').click(); return true; })()`), true);
    assert.ok(await waitFor(`!!document.querySelector('.oa-menu-item')`), 'no menu');
    assert.equal(
      await run<boolean>(
        `(() => { const item = [...document.querySelectorAll('.oa-menu-item')].find((b) => b.textContent.includes(${js(label)})); item.click(); return !!item; })()`,
      ),
      true,
    );
  };

  before(async () => {
    profile = makeProfile('oa-desktop-home-');
    port = await freePort();
    app = await launchApp(profile, port);
    await app.line(/\[desktop\] ready /);
    await app.connect();
    page = app.chrome;
    const daemon = daemonState(profile);
    made.ferry = await library(daemon, 'artifacts.create', { type: 'docs', title: 'Ferry notes', blank: true, folder: join(profile.artifacts, 'ferry') });
    made.budget = await library(daemon, 'artifacts.create', { type: 'sheets', title: '2027 Budget', blank: true, folder: join(profile.artifacts, 'budget') });
    assert.ok(made.ferry.id && made.budget.id, js(made));
  });

  after(async () => {
    await app?.quit();
    await stopDaemon(profile);
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it('lists the artifacts made through the Library API, on the home page and in the sidebar', T, async () => {
    assert.ok(await waitFor(`!!(${card('Ferry notes')}) && !!(${card('2027 Budget')})`), await run<string>('document.body.innerText'));
    assert.deepEqual((await sidebarTitles('recent')).sort(), ['2027 Budget', 'Ferry notes']);
    // The library is the current place: its tab and its sidebar row say so; no artifact tab yet.
    assert.equal(await run<string | null>(`document.querySelector('[data-tab=home]').getAttribute('aria-selected')`), 'true');
    assert.equal(await run<string | null>(`document.querySelector('[data-testid=nav-library]').getAttribute('aria-current')`), 'page');
    // The two tile groups: what goes straight to an editor, and what an agent builds.
    const groups = await run<string[]>(
      `[...document.querySelectorAll('.oa-tile-group')].map((g) => g.dataset.group + ':' + [...g.querySelectorAll('.oa-tile')].map((b) => b.dataset.type ?? '').join(','))`,
    );
    assert.equal(groups.length, 2, js(groups));
    assert.match(groups[0], /^blank:/);
    assert.match(groups[1], /^agent:/);
    // The host's own search and New are in the sidebar, not in the page's heading.
    const tools = await run<(string | null)[]>(`[...document.querySelectorAll('.oa-heading .oa-tool')].map((b) => b.getAttribute('aria-label'))`);
    assert.equal(tools.includes('Search artifacts'), false, js(tools));
    assert.equal(
      tools.some((label) => /^New/.test(label ?? '')),
      false,
      js(tools),
    );
    assert.ok(tools.length >= 1, "the page's own tools (filter, layout) are still there");
  });

  it('a card opens its artifact in a tab', T, async () => {
    await run<boolean>(`${card('Ferry notes')}.querySelector('.oa-card').click(), true`);
    assert.ok(await until(async () => (await state()).current === made.ferry.id, 15_000), js(await state()));
    assert.ok(await waitFor(`document.querySelector('[data-tab=${js(made.ferry.id)}]')?.getAttribute('aria-selected') === 'true'`));
    const view = await app.view(made.ferry.id);
    assert.ok(await view.waitInFrame(inDocs, "!!document.querySelector('.doc-text p')"), 'the doc editor did not draw');
    // The tab bar: the tab's title and its type's color; the sidebar row of the artifact is the current one.
    assert.equal(await run<string>(`document.querySelector('[data-tab=${js(made.ferry.id)}] [data-slot=tab-title]').textContent`), 'Ferry notes');
    assert.equal(await run<string | null>(`document.querySelector('[data-artifact=${js(made.ferry.id)}]').getAttribute('aria-current')`), 'page');
    // The view sits beside the sidebar and under the tab bar.
    assert.equal(await view.evaluate<number>('innerWidth'), 1280 - 240);
  });

  it('the sidebar shows an artifact made meanwhile at the top of Recent', T, async () => {
    made.harbour = await library(daemonState(profile), 'artifacts.create', {
      type: 'docs',
      title: 'Harbour plan',
      blank: true,
      folder: join(profile.artifacts, 'harbour'),
    });
    assert.ok(await until(async () => (await sidebarTitles('recent'))[0] === 'Harbour plan', 15_000), js(await sidebarTitles('recent')));
  });

  it('a pinned artifact moves from Recent to Pinned', T, async () => {
    await run<boolean>(`desktop.select('home')`);
    await menu('2027 Budget', 'Pin');
    assert.ok(await until(async () => (await sidebarTitles('pinned')).includes('2027 Budget'), 10_000), 'not in Pinned');
    assert.equal((await sidebarTitles('recent')).includes('2027 Budget'), false);
    // The library says so too.
    const listed = await library(daemonState(profile), `artifact?id=${made.budget.id}`);
    assert.equal(listed.pinned, true, js(listed));
    // Pinned folds away and comes back.
    await run<boolean>(`document.querySelector('[data-testid=pinned] .section-head').click(), true`);
    assert.ok(await waitFor(`document.querySelectorAll('[data-testid=pinned] [data-artifact]').length === 0`));
    await run<boolean>(`document.querySelector('[data-testid=pinned] .section-head').click(), true`);
    assert.ok(await waitFor(`document.querySelectorAll('[data-testid=pinned] [data-artifact]').length === 1`));
  });

  it('a rename reaches the sidebar and the tab', T, async () => {
    await menu('Ferry notes', 'Rename');
    assert.ok(await waitFor(`!!document.querySelector('.oa-dialog input')`), 'no rename dialog');
    await fill('.oa-dialog input', 'Ferry timetable');
    await run<boolean>(`[...document.querySelectorAll('.oa-dialog button')].find((b) => b.textContent === 'Save').click(), true`);
    assert.ok(await until(async () => (await sidebarTitles('recent')).includes('Ferry timetable'), 10_000), js(await sidebarTitles('recent')));
    assert.ok(
      await waitFor(`document.querySelector('[data-tab=${js(made.ferry.id)}] [data-slot=tab-title]')?.textContent === 'Ferry timetable'`),
      'the tab kept the old title',
    );
    // The main process's tab follows the library too (what a restart of the page would show).
    assert.ok(await until(async () => (await state()).tabs.find((t) => t.id === made.ferry.id)?.title === 'Ferry timetable', 10_000), js(await state()));
  });

  it('a delete takes it away; Undo brings it back', T, async () => {
    await menu('Harbour plan', 'Delete');
    assert.ok(await waitFor(`!!document.querySelector('.oa-dialog')`), 'no delete dialog');
    await run<boolean>(`[...document.querySelectorAll('.oa-dialog button')].find((b) => b.textContent === 'Delete').click(), true`);
    assert.ok(await waitFor(`!(${card('Harbour plan')})`), 'the card stayed');
    assert.ok(await until(async () => !(await sidebarTitles('recent')).includes('Harbour plan'), 10_000), 'the sidebar kept it');
    assert.ok(await waitFor(`!!document.querySelector('.oa-toast-undo')`), 'no Undo');
    await run<boolean>(`document.querySelector('.oa-toast-undo').click(), true`);
    assert.ok(await waitFor(`!!(${card('Harbour plan')})`), 'Undo did not bring it back');
    assert.ok(await until(async () => (await sidebarTitles('recent')).includes('Harbour plan'), 10_000), 'the sidebar did not get it back');
  });

  it('the new-artifact dialog makes a blank doc that opens in its editor, and what is typed reaches its folder', T, async () => {
    await run<boolean>(`document.querySelector('[data-testid=nav-new]').click(), true`);
    assert.ok(await waitFor(`!!document.querySelector('[data-testid=new-dialog]')`), 'no dialog');
    const groups = await run<string[]>(
      `[...document.querySelectorAll('.new-group')].map((g) => g.dataset.group + ':' + [...g.querySelectorAll('.new-type')].map((b) => b.dataset.type).join(','))`,
    );
    assert.match(groups[0], /^blank:docs,/, js(groups));
    assert.match(groups[1], /^agent:design,data,motion,page/, js(groups));
    await run<boolean>(`document.querySelector('.new-type[data-type=docs]').click(), true`);
    await fill('#new-name', 'Crossing log');
    await run<boolean>(`document.querySelector('[data-testid=new-create]').click(), true`);
    assert.ok(await until(async () => (await state()).tabs.some((t) => t.title === 'Crossing log'), 30_000), js(await state()));
    assert.ok(await waitFor(`!document.querySelector('[data-testid=new-dialog]')`), 'the dialog stayed');
    const tab = (await state()).tabs.find((t) => t.title === 'Crossing log');
    made.crossing = await library(daemonState(profile), `artifact?id=${present(tab).id}`);
    assert.equal((await state()).current, present(tab).id);
    const view = await app.view(present(tab).id);
    assert.ok(await view.waitInFrame(inDocs, "!!document.querySelector('.doc-text p')"), 'the doc editor did not draw');
    const placed = await view.inFrame<boolean>(
      inDocs,
      `(() => { const p = document.querySelector('.doc-text p'); const root = p.closest('[contenteditable]'); root.focus(); const s = getSelection(); s.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); s.addRange(r); return document.activeElement === root; })()`,
    );
    assert.equal(placed, true, 'the editor did not take focus');
    await view.type(WORDS);
    const record = await library(daemonState(profile), `artifact?id=${present(tab).id}`);
    assert.ok(record.root, js(record));
    assert.ok(await until(() => treeText(record.root).includes(WORDS), 15_000), 'the words did not reach the folder');
  });

  it("+ in the tab bar makes a type at once, with no dialog; a type an agent builds is made empty and its tab shows the Shell's prompt", T, async () => {
    const before = new Set((await state()).tabs.map((t) => t.id));
    await run<boolean>(`document.querySelector('[data-testid=tab-new]').click(), true`);
    assert.ok(await waitFor(`!!document.querySelector('[data-testid=tab-new-menu]')`), 'no menu');
    assert.equal(await run<boolean>(`!!document.querySelector('[data-testid=new-dialog]')`), false, 'a dialog opened');
    // New first, its types in their order; then the artifacts not open.
    const lines = await run<string[]>(
      `[...document.querySelectorAll('[data-testid=tab-new-menu] > *')].map((el) => el.getAttribute('role') === 'separator' ? '-' : el.getAttribute('role') !== 'menuitem' ? '#' + el.textContent : el.dataset.type ? 'type:' + el.dataset.type : 'open:' + el.dataset.artifact)`,
    );
    assert.equal(lines[0], '#New', js(lines));
    const typeLines = lines.filter((line) => line.startsWith('type:'));
    assert.ok(typeLines.indexOf('type:docs') < typeLines.indexOf('type:design'), js(lines));
    if (lines.some((line) => line.startsWith('open:'))) assert.ok(lines.indexOf('-') > lines.indexOf(typeLines[typeLines.length - 1]), js(lines));
    assert.equal(await run<boolean>(`document.querySelector('[data-testid=tab-new]').getAttribute('aria-expanded') === 'true'`), true);
    await run<boolean>(`document.querySelector('[data-testid=tab-new-menu] [data-type=design]').click(), true`);
    assert.ok(await waitFor(`!document.querySelector('[data-testid=tab-new-menu]')`), 'the menu stayed');
    assert.ok(await until(async () => (await state()).tabs.some((t) => !before.has(t.id)), 30_000), js(await state()));
    const tab = (await state()).tabs.find((t) => !before.has(t.id));
    assert.equal((await state()).current, present(tab).id);
    made.launch = await library(daemonState(profile), `artifact?id=${present(tab).id}`);
    const view = await app.view(present(tab).id);
    assert.ok(await view.waitFor(`!!document.querySelector('[data-testid=empty-artifact]')`, 20_000), await view.evaluate<string>('document.body.innerText'));
  });

  it('a create that fails says why in the dialog, and the dialog stays', T, async () => {
    // The folder new artifacts go to cannot be written: the daemon's own refusal comes back.
    const record = await library(daemonState(profile), `artifact?id=${made.crossing.id}`);
    const folder = dirname(record.root);
    chmodSync(folder, 0o555);
    try {
      await run<boolean>(`document.querySelector('[data-testid=nav-new]').click(), true`);
      assert.ok(await waitFor(`!!document.querySelector('[data-testid=new-dialog]')`), 'no dialog');
      await run<boolean>(`document.querySelector('.new-type[data-type=docs]').click(), true`);
      await fill('#new-name', 'Blocked');
      await run<boolean>(`document.querySelector('[data-testid=new-create]').click(), true`);
      const said = await waitFor(`document.querySelector('[data-testid=new-error]')?.textContent`, 30_000);
      assert.match(String(said), /^It was not made: ./, String(said));
      assert.equal(await run<boolean>(`!!document.querySelector('[data-testid=new-dialog]')`), true, 'the dialog closed');
      assert.equal(
        (await state()).tabs.some((t) => t.title === 'Blocked'),
        false,
      );
    } finally {
      chmodSync(folder, 0o755);
    }
    // The bridge refuses what is not a type id before the daemon sees it.
    assert.equal((await run<import('../src/types').Reply<{ id: string; title: string }>>(`desktop.library.create('not a type!', '')`)).ok, false);
    await run<boolean>(`document.querySelector('[data-testid=new-dialog] .button-quiet').click(), true`);
    assert.ok(await waitFor(`!document.querySelector('[data-testid=new-dialog]')`), 'Cancel did not close it');
  });

  it('back and forward go over the tabs the person went to', T, async () => {
    const ids = [made.ferry.id, made.crossing.id, made.launch.id];
    await run<boolean>(`desktop.select(${js(ids[0])})`);
    await run<boolean>(`desktop.select('home')`);
    await run<boolean>(`desktop.select(${js(ids[1])})`);
    const at = async () => (await state()).current;
    assert.equal(await at(), ids[1]);
    await run<boolean>(`document.querySelector('[data-testid=back]').click(), true`);
    assert.ok(await until(async () => (await at()) === 'home'), await at());
    await run<boolean>(`document.querySelector('[data-testid=back]').click(), true`);
    assert.ok(await until(async () => (await at()) === ids[0]), await at());
    await run<boolean>(`document.querySelector('[data-testid=forward]').click(), true`);
    assert.ok(await until(async () => (await at()) === 'home'), await at());
    assert.equal((await state()).canForward, true);
    // Going somewhere new drops what was ahead.
    await run<boolean>(`desktop.select(${js(ids[2])})`);
    assert.ok(await until(async () => (await state()).canForward === false), js(await state()));
    assert.ok(await waitFor(`document.querySelector('[data-testid=forward]').disabled === true`));
    // A closed tab leaves back and forward.
    await run<boolean>(`desktop.close(${js(ids[2])})`);
    await run<boolean>(`document.querySelector('[data-testid=back]').click(), true`);
    assert.notEqual(await at(), ids[2]);
  });

  it("the sidebar collapses (the view takes the room) and stays collapsed in the app's settings", T, async () => {
    await run<boolean>(`desktop.select(${js(made.ferry.id)})`);
    const view = await app.view(made.ferry.id);
    await run<boolean>(`document.querySelector('[data-testid=toggle-sidebar]').click(), true`);
    assert.ok(await waitFor(`!document.querySelector('[data-testid=sidebar]')`), 'the sidebar stayed');
    assert.ok(await until(async () => (await view.evaluate<number>('innerWidth')) === 1280, 5000), String(await view.evaluate<number>('innerWidth')));
    assert.ok(
      app.lines.some((line) => line.includes('[desktop] sidebar collapsed: view at x=0 width=1280')),
      app.lines.join('\n'),
    );
    const settings = JSON.parse(readFileSync(join(profile.oaHome, 'desktop', 'user-data', 'settings.json'), 'utf8')) as SettingsValues;
    assert.equal(settings.sidebarCollapsed, true);
    // Its controls are at the tab bar's start now; the same button opens it again.
    assert.ok(await waitFor(`!!document.querySelector('#bar [data-testid=toggle-sidebar]') && !!document.querySelector('#bar [data-testid=back]')`));
    await run<boolean>(`document.querySelector('#bar [data-testid=toggle-sidebar]').click(), true`);
    assert.ok(await waitFor(`!!document.querySelector('[data-testid=sidebar]')`), 'the sidebar did not come back');
    // The view is placed beside the sidebar again. (A window that is never shown does not pass a smaller size on to its
    // page, so the page's own width is not checked here: the main process's placing of it is.)
    assert.ok(await until(() => app.lines.some((line) => line.includes('[desktop] sidebar open: view at x=240 width=1040')), 5000), app.lines.join('\n'));
    assert.equal((JSON.parse(readFileSync(join(profile.oaHome, 'desktop', 'user-data', 'settings.json'), 'utf8')) as SettingsValues).sidebarCollapsed, false);
  });

  it('Search brings the library forward with its search field focused', T, async () => {
    assert.notEqual((await state()).current, 'home');
    await run<boolean>(`document.querySelector('[data-testid=nav-search]').click(), true`);
    assert.ok(await until(async () => (await state()).current === 'home', 5000));
    assert.ok(
      await waitFor(`document.activeElement?.closest('.oa-search') !== null && document.activeElement?.tagName === 'INPUT'`),
      await run<string | undefined>('document.activeElement?.outerHTML'),
    );
    await fill('.oa-search input', 'Budget');
    assert.ok(await waitFor(`!!(${card('2027 Budget')}) && !(${card('Ferry timetable')})`), 'the search did not filter');
    await fill('.oa-search input', '');
  });

  it("the daemon's token is nowhere the page can reach", T, async () => {
    const { token, url } = present(daemonState(profile));
    assert.ok(token && token.length > 8);
    const reachable = await run<{ text: string; fetched: string }>(`(async () => {
      const seen = [];
      const walk = (value, depth = 0) => {
        if (depth > 6 || value === null || value === undefined) return;
        if (typeof value === 'string') return void seen.push(value);
        if (typeof value === 'function') return void seen.push(String(value));
        if (typeof value !== 'object') return;
        for (const key of Object.keys(value)) { seen.push(key); try { walk(value[key], depth + 1); } catch {} }
      };
      walk(window.desktop);
      walk(await desktop.state());
      walk(await desktop.library.list());
      for (const key of Object.getOwnPropertyNames(window)) { seen.push(key); try { const v = window[key]; if (typeof v === 'string') seen.push(v); } catch {} }
      try { for (let i = 0; i < localStorage.length; i++) seen.push(localStorage.key(i), localStorage.getItem(localStorage.key(i))); } catch {}
      seen.push(document.cookie, document.documentElement.outerHTML, location.href);
      for (const entry of performance.getEntries()) seen.push(entry.name);
      let fetched = 'blocked';
      try { await fetch(${js(`${url}/api/open-artifact.artifacts`)}); fetched = 'reached'; } catch {}
      return { text: seen.join('\\n'), fetched };
    })()`);
    assert.equal(reachable.text.includes(token), false, 'the token is reachable from the page');
    assert.equal(reachable.fetched, 'blocked', 'the page can reach the daemon itself');
    // The bridge refuses what is not this window's to change.
    const refused = await run<import('../src/types').Reply<import('../../../packages/library-page/src/index').PageArtifact>>(
      `desktop.library.update(${js(made.ferry.id)}, { owner: 'someone' })`,
    );
    assert.ok(!refused.ok);
  });

  it("an agent's artifacts say their project, and the filter's Project submenu narrows the library to it", T, async () => {
    const daemon = daemonState(profile);
    // Two sessions, each in a folder of its own (no checkout around it: the folder is the project). Nothing is set, so
    // their artifacts go under the profile's Open Artifact folder, outside both projects.
    const shop = join(profile.root, 'code', 'shop');
    const site = join(profile.root, 'code', 'site');
    for (const dir of [shop, site]) mkdirSync(dir, { recursive: true });
    const make = async (title: string, workspace: string) => {
      const result = (await library(daemon, 'tools.call', {
        name: 'Artifact',
        arguments: { action: 'publish', type_url: 'open-artifact://type/docs', title, open: 'never' },
        caller: { harness: 'mcp', session: `session-${title}`, workspace },
      })) as { url?: string; root?: string; error?: unknown };
      assert.equal(result.error, undefined, js(result));
      assert.ok(present(result.root).startsWith(join(profile.home, 'OpenArtifact')), js(result));
      return present(result.url).split('/').pop()!;
    };
    const plan = await make('Shop plan', shop);
    await make('Shop review', shop);
    await make('Site map', site);

    await run<boolean>(`document.querySelector('[data-testid=nav-library]').click(), true`);
    assert.ok(await waitFor(`!!(${card('Shop plan')}) && !!(${card('Shop review')}) && !!(${card('Site map')})`), await run<string>('document.body.innerText'));
    // Under each title: the project's name, and which folder that is.
    const projectOn = (title: string) => run<[string, string] | null>(`(() => { const p = (${card(title)})?.querySelector('.oa-project'); return p ? [p.dataset.project, p.textContent] : null; })()`);
    assert.deepEqual(await projectOn('Shop plan'), [shop, 'shop · ']);
    assert.deepEqual(await projectOn('Site map'), [site, 'site · ']);
    assert.equal(await projectOn('2027 Budget'), null, 'made with no session: of no project');
    // The sidebar's row says the project when pointed at.
    assert.equal(await run<string | undefined>(`document.querySelector('[data-testid=sidebar] [data-artifact=${js(plan)}]')?.title`), `Shop plan\n${shop}`);

    // The filter menu's Project submenu: each project with its count, then the artifacts of none.
    const shown = () => run<string[]>(`[...document.querySelectorAll('.oa-item .oa-name')].map((e) => e.textContent).sort()`);
    const everything = await shown();
    await run<boolean>(`document.querySelector('.oa-heading .oa-tool[aria-label="Sort and filter"]').click(), true`);
    const projectRow = `[...document.querySelectorAll('.oa-menu-item[aria-haspopup=menu]')].find((b) => b.textContent.includes('Project'))`;
    assert.ok(await waitFor(`!!(${projectRow})`), 'no Project row in the filter menu');
    await run<boolean>(`(${projectRow}).click(), true`);
    assert.ok(await waitFor(`!!document.querySelector('[role=menuitemcheckbox][data-project]')`), 'the Project submenu did not open');
    const choices = await run<[string, string, string][]>(
      `[...document.querySelectorAll('[role=menuitemcheckbox][data-project]')].map((b) => [b.dataset.project, b.querySelector('.oa-menu-label').textContent, b.querySelector('.oa-menu-count').textContent])`,
    );
    assert.deepEqual(choices.slice(0, 2), [
      [shop, 'shop', '2'],
      [site, 'site', '1'],
    ]);
    assert.deepEqual(choices[2]?.slice(0, 2), ['', 'No project'], js(choices));
    const pick = (project: string) => run<boolean>(`document.querySelector('[role=menuitemcheckbox][data-project=${js(project)}]').click(), true`);
    await pick(shop);
    assert.ok(await waitFor(`document.querySelectorAll('.oa-item').length === 2`), js(await shown()));
    assert.deepEqual(await shown(), ['Shop plan', 'Shop review']);
    // A second project adds its artifacts; unpicking both brings everything back.
    await pick(site);
    assert.ok(await waitFor(`document.querySelectorAll('.oa-item').length === 3`), js(await shown()));
    assert.deepEqual(await shown(), ['Shop plan', 'Shop review', 'Site map']);
    await pick(shop);
    await pick(site);
    assert.ok(await waitFor(`document.querySelectorAll('.oa-item').length === ${everything.length}`), js(await shown()));
    assert.deepEqual(await shown(), everything);
  });
});
