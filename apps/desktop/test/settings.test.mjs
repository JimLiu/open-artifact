/**
 * The look and the language settings reach the artifact views, not only the app's own page: in a tab's Shell page and
 * in its editor's frame, `navigator.language` and `prefers-color-scheme` are the app's, and the Shell's words are in
 * that language. The look switches at once in an open view; a changed language says `restartNeeded` and takes effect
 * when the app is opened again (Chromium's `--lang`). Test mode's `--locale` and `--theme` come before the settings.
 *
 * Throwaway profile, free port that is not 4800; the daemon is stopped by the pid its own daemon.json names.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { daemonState, freePort, leftovers, makeProfile, stopDaemon, until } from './lib/env.mjs';
import { launchApp, library } from './lib/app.mjs';

const T = { timeout: 180_000 };
const inDocs = (url) => /\/docs\/[0-9a-f]+\//.test(url);
const js = (value) => JSON.stringify(value);

/** What a page says about its language and look. */
const LOOK = `({ lang: navigator.language, dark: matchMedia('(prefers-color-scheme: dark)').matches, theme: document.documentElement.dataset.theme ?? null })`;
/** The Shell's Share button's words. */
const SHARE = `[...document.querySelectorAll('button span')].map((s) => s.textContent.trim()).find((t) => t === 'Share' || t === '分享') ?? null`;

describe('the look and the language in the artifact views', () => {
  let profile;
  let port;
  let app;
  let doc;

  before(async () => {
    profile = makeProfile('oa-desktop-settings-');
    port = await freePort();
  });

  after(async () => {
    await app?.quit();
    await stopDaemon(profile);
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  const settingsFile = () => join(profile.oaHome, 'desktop', 'user-data', 'settings.json');

  /** Opens the doc in a tab and answers its view, once its editor has drawn. */
  const openDoc = async () => {
    const opened = await app.open(doc.id);
    assert.equal(opened.ok, true, js(opened));
    const view = await app.view(doc.id);
    assert.ok(await view.waitInFrame(inDocs, "!!document.querySelector('.doc-text p')"), 'the doc editor did not draw');
    return view;
  };

  /** The Shell page and the editor's frame of `view` both say `want` (waiting for a change to arrive). */
  const looksLike = async (view, want, label) => {
    const same = (got) => got && got.lang === want.lang && got.dark === want.dark && got.theme === want.theme;
    let shell;
    await until(async () => same((shell = await view.evaluate(LOOK))), 15_000, 100);
    assert.deepEqual(shell, want, `${label}: the Shell page`);
    let frame;
    await until(async () => same((frame = await view.inFrame(inDocs, LOOK).catch((error) => ({ error: error.message })))), 15_000, 100);
    assert.deepEqual(frame, want, `${label}: the editor's frame`);
  };

  it('Chinese and dark from the settings, in the Shell and its editor; the look switches at once', T, async () => {
    mkdirSync(join(profile.oaHome, 'desktop', 'user-data'), { recursive: true });
    writeFileSync(settingsFile(), js({ sidebarCollapsed: false, theme: 'dark', locale: 'zh-CN' }));
    app = await launchApp(profile, port, { defaultLocale: false });
    await app.line(/\[desktop\] ready /);
    await app.connect();
    doc = await library(daemonState(profile), 'artifacts.create', { type: 'docs', title: 'Ferry', blank: true, folder: join(profile.artifacts, 'ferry') });
    assert.ok(doc.id, js(doc));

    const state = await app.state();
    assert.equal(state.look.locale, 'zh');
    assert.equal(state.look.theme, 'dark');
    assert.deepEqual([state.settings.theme, state.settings.locale, state.settings.restartNeeded], ['dark', 'zh-CN', false]);
    assert.deepEqual(state.settings.forced, { theme: null, locale: null });

    const view = await openDoc();
    await looksLike(view, { lang: 'zh-CN', dark: true, theme: 'dark' }, 'zh, dark');
    assert.equal(await view.waitFor(SHARE), '分享', "the Shell's words are Chinese");
    assert.equal(await view.evaluate('document.documentElement.lang'), 'zh-CN');

    // The look at once: the open view, its editor's frame, and the app's own page.
    const lighter = await app.chrome.evaluate(`desktop.settings.set('theme', 'light')`);
    assert.equal(lighter.theme, 'light');
    await looksLike(view, { lang: 'zh-CN', dark: false, theme: 'light' }, 'switched to light');
    assert.ok(await app.chrome.waitFor(`document.documentElement.dataset.theme === 'light'`), "the app's own page is light");
    assert.equal(await app.chrome.evaluate(`matchMedia('(prefers-color-scheme: dark)').matches`), false);
    await app.chrome.evaluate(`desktop.settings.set('theme', 'dark')`);
    await looksLike(view, { lang: 'zh-CN', dark: true, theme: 'dark' }, 'back to dark');
    assert.ok(await app.chrome.waitFor(`document.documentElement.dataset.theme === 'dark'`));

    // The language waits for the app to open again; the views keep speaking the running one.
    const english = await app.chrome.evaluate(`desktop.settings.set('locale', 'en')`);
    assert.deepEqual([english.locale, english.running.locale, english.restartNeeded], ['en', 'zh-CN', true]);
    assert.equal((await app.state()).settings.restartNeeded, true);
    assert.equal(await view.evaluate('navigator.language'), 'zh-CN');
    // What is not a choice is refused, and nothing is kept.
    const refused = await app.chrome.evaluate(`desktop.settings.set('theme', 'sepia').then(() => 'kept', (e) => 'refused')`);
    assert.equal(refused, 'refused');
    await app.chrome.evaluate(`desktop.settings.set('theme', 'light')`);
    assert.deepEqual(JSON.parse(readFileSync(settingsFile(), 'utf8')), { sidebarCollapsed: false, theme: 'light', locale: 'en' });
    await app.quit();
    app = null;
  });

  it('opened again: English and light, in the Shell and its editor', T, async () => {
    app = await launchApp(profile, port, { defaultLocale: false });
    await app.line(/\[desktop\] ready /);
    await app.connect();
    const state = await app.state();
    assert.equal(state.look.locale, 'en');
    assert.equal(state.look.theme, 'light');
    assert.equal(state.settings.restartNeeded, false);
    const view = await openDoc();
    await looksLike(view, { lang: 'en-US', dark: false, theme: 'light' }, 'en, light');
    assert.equal(await view.waitFor(SHARE), 'Share', "the Shell's words are English");
    await app.quit();
    app = null;
  });

  it('test mode\'s --locale and --theme come before the settings', T, async () => {
    // The settings say English and light; the switches say Chinese and dark.
    app = await launchApp(profile, port, { args: ['--locale', 'zh', '--theme', 'dark'] });
    await app.line(/\[desktop\] ready /);
    await app.connect();
    const state = await app.state();
    assert.deepEqual(state.settings.forced, { theme: 'dark', locale: 'zh-CN' });
    assert.equal(state.settings.restartNeeded, false);
    const view = await openDoc();
    await looksLike(view, { lang: 'zh-CN', dark: true, theme: 'dark' }, 'switches: zh, dark');
    assert.equal(await view.waitFor(SHARE), '分享');
    // A look set meanwhile is kept, but the switch still decides.
    await app.chrome.evaluate(`desktop.settings.set('theme', 'light')`);
    await new Promise((done) => setTimeout(done, 500));
    await looksLike(view, { lang: 'zh-CN', dark: true, theme: 'dark' }, 'switches still decide');
    assert.equal(JSON.parse(readFileSync(settingsFile(), 'utf8')).theme, 'light');
  });
});
