import type { SettingsValues } from '../src/settings.ts';
import type { TestApp as DesktopTestApp } from './lib/app.ts';
import { present } from './lib/assertions.ts';
import type { TestProfile } from './lib/env.ts';
/**
 * The settings dialog: opened from the sidebar's Settings; the look changes the window at once; a changed language
 * says it takes effect when the app is opened again and offers to reopen it (test mode only logs that); the folder for
 * new artifacts (given through the test-mode bridge, as the system's dialog is never shown in test mode) is where a new
 * artifact goes, named as the daemon would name it, `-2` past one that exists; "Show in Finder" is only logged; the
 * service row opens the service panel. With no switches and no settings file the app follows the system (no reopen
 * prompt); test mode's `--locale` and `--theme` make those controls read-only.
 *
 * Throwaway profiles, free ports that are not 4800; daemons are stopped by the pid their own daemon.json names.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { launchApp } from './lib/app.ts';
import { freePort, leftovers, makeProfile, stopDaemon } from './lib/env.ts';

const T = { timeout: 180_000 };
const js = (value: unknown) => JSON.stringify(value);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function on(app: DesktopTestApp) {
  const run = <T = unknown>(expression: string) => app.chrome.evaluate<T>(expression);
  return {
    run,
    waitFor: (expression: string, timeoutMs = 20_000) => app.chrome.waitFor(expression, timeoutMs),
    click: (selector: string) =>
      run<boolean>(`(() => { const b = document.querySelector(${js(selector)}); if (!b || b.disabled) return false; b.click(); return true; })()`),
    text: async (testid: string) => present(await run<string | null>(`document.querySelector('[data-testid=${testid}]')?.textContent ?? null`)),
    disabled: (selector: string) => run(`document.querySelector(${js(selector)})?.disabled ?? null`),
  };
}

const finish = async (app: DesktopTestApp, profile: TestProfile) => {
  await app?.quit();
  await stopDaemon(profile);
  const left = leftovers(profile);
  if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
  assert.deepEqual(left, [], 'processes of the test profile still run');
};

describe('the settings dialog', () => {
  let profile: TestProfile;
  let port: number;
  let app: DesktopTestApp | null;
  let ui: ReturnType<typeof on>;

  before(async () => {
    profile = makeProfile('oa-desktop-settings-dialog-');
    port = await freePort();
    // No --locale: the language is the person's setting here.
    app = await launchApp(profile, port, { defaultLocale: false });
    await app.line(/\[desktop\] ready /);
    await app.connect();
    ui = on(present(app));
    assert.ok(await ui.waitFor(`!!document.querySelector('[data-testid=nav-settings]')`));
  });

  after(() => finish(present(app), profile));

  it('opens from the sidebar; the look changes the window at once', T, async () => {
    assert.equal(await ui.click('[data-testid=nav-settings]'), true);
    assert.ok(await ui.waitFor(`!!document.querySelector('[data-testid=settings-dialog]')`));
    for (const id of ['settings-general', 'settings-artifacts', 'settings-shared', 'settings-advanced']) assert.ok(await ui.text(id), id);
    assert.equal(await ui.run<string | undefined>(`document.querySelector('[data-testid=look] [aria-checked=true]').dataset.value`), 'system');
    assert.equal(await ui.disabled('[data-testid=language]'), false);

    assert.equal(await ui.click('[data-testid=look] [data-value=dark]'), true);
    assert.ok(await ui.waitFor(`document.documentElement.dataset.theme === 'dark'`), 'the window did not turn dark');
    assert.equal((await present(app).state()).look.theme, 'dark');
    assert.equal(await ui.run<string | undefined>(`document.querySelector('[data-testid=look] [aria-checked=true]').dataset.value`), 'dark');
    assert.equal(await ui.run<boolean>(`matchMedia('(prefers-color-scheme: dark)').matches`), true);
    assert.equal(await ui.click('[data-testid=look] [data-value=light]'), true);
    assert.ok(await ui.waitFor(`document.documentElement.dataset.theme === 'light'`));
    // What theme.js reads to start in before the first state: it follows the setting, not only the system.
    assert.equal(await ui.run<boolean>(`matchMedia('(prefers-color-scheme: dark)').matches`), false);
    assert.equal((JSON.parse(readFileSync(join(profile.oaHome, 'desktop', 'user-data', 'settings.json'), 'utf8')) as SettingsValues).theme, 'light');
  });

  it('desktop updates have separate saved preferences and cannot contact GitHub or install in test mode', T, async () => {
    const run = <V>(expression: string) => ui.run<V>(expression);
    assert.ok(await ui.waitFor(`!!document.querySelector('[data-testid=app-update-settings]')`));
    assert.match(await ui.text('app-update-line'), /test mode|测试模式/i);
    assert.equal(await ui.disabled('[data-testid=app-update-check]'), true);
    const updates = () => run<import('../src/app-update.ts').AppUpdateView>('desktop.updates.get()');
    assert.equal((await updates()).unavailable, 'test');
    assert.equal(await ui.run<boolean>('!!document.querySelector("[data-testid=app-update-button]")'), false);
    assert.equal((await updates()).autoCheck, true);
    assert.equal((await updates()).autoDownload, false);
    for (const action of ['check', 'download', 'install']) {
      const out = await run<import('../src/types.ts').Reply<unknown>>(`desktop.updates.do(${js(action)})`);
      assert.equal(out.ok, false);
    }
    assert.equal(await ui.click('[data-testid=app-update-auto-check]'), true);
    assert.ok(await ui.waitFor(`document.querySelector('[data-testid=app-update-auto-check]')?.getAttribute('aria-checked') === 'false'`));
    assert.equal(await ui.click('[data-testid=app-update-auto-download]'), true);
    assert.ok(await ui.waitFor(`document.querySelector('[data-testid=app-update-auto-download]')?.getAttribute('aria-checked') === 'true'`));
    const saved = JSON.parse(readFileSync(join(profile.oaHome, 'desktop', 'user-data', 'settings.json'), 'utf8')) as SettingsValues;
    assert.equal(saved.appAutoCheck, false);
    assert.equal(saved.appAutoDownload, true);
    assert.equal((await updates()).phase, 'idle');
    const invalid = await run<import('../src/types.ts').Reply<unknown>>(`desktop.updates.do('checking', 'true')`);
    assert.equal(invalid.ok, false);
    await present(app).command('check-updates');
    assert.ok(await ui.waitFor(`!!document.querySelector('[data-testid=settings-dialog]')`));
    assert.equal((await updates()).checkedAt, null);
  });

  it('a changed language says it takes effect when the app opens again, and Reopen is only logged in test mode', T, async () => {
    assert.equal(await ui.run<boolean>(`document.querySelector('[data-testid=relaunch-note]') === null`), true);
    const before = (await present(app).state()).look.locale;
    const other = before === 'zh' ? 'en' : 'zh-CN';
    assert.equal(
      await ui.run<boolean>(`(() => {
        const select = document.querySelector('[data-testid=language]');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${js(other)});
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`),
      true,
    );
    assert.ok(await ui.waitFor(`!!document.querySelector('[data-testid=relaunch-note]')`), await ui.text('settings-general'));
    assert.equal((await present(app).state()).settings.restartNeeded, true);
    // The window keeps its language until it is opened again.
    assert.equal((await present(app).state()).look.locale, before);
    assert.equal(await ui.click('[data-testid=relaunch]'), true);
    await present(app).line(/relaunch \[.*\] \(test mode: not done\)/);
    assert.equal(present(app).exited, null, 'the app quit');
  });

  it('new artifacts go to the chosen folder, named as the daemon names them; Change and Show in Finder are only logged', T, async () => {
    // The default is the library's own folder.
    assert.match(await ui.text('folder'), new RegExp(escape(join(profile.home, 'OpenArtifact', 'artifacts'))));
    assert.equal(await ui.click('[data-testid=folder-change]'), true);
    await present(app).line(/choose folder \(test mode: no dialog\)/);

    const chosen = join(profile.artifacts, 'chosen');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(chosen, { recursive: true });
    // A folder that does not exist is refused.
    const missing = await ui.run<string>(
      `desktop.settings.set('artifactsFolder', ${js(join(profile.root, 'nowhere'))}).then((v) => v.artifactsFolder, (e) => 'refused: ' + e.message)`,
    );
    assert.ok(missing === '' || /^refused/.test(missing), missing);
    const set = await ui.run<import('../src/contracts').SettingsSnapshot>(`desktop.settings.set('artifactsFolder', ${js(chosen)})`);
    assert.equal(set.artifactsFolder, chosen);
    assert.ok(await ui.waitFor(`document.querySelector('[data-testid=folder]')?.textContent === ${js(chosen)}`), await ui.text('folder'));

    const first = await ui.run<import('../src/types').Reply<{ id: string; title: string }>>(`desktop.library.create('docs', 'Tide Tables')`);
    assert.ok(first.ok, js(first));
    const second = await ui.run<import('../src/types').Reply<{ id: string; title: string }>>(`desktop.library.create('docs', 'Tide Tables')`);
    assert.ok(second.ok, js(second));
    assert.ok(existsSync(join(chosen, 'tide-tables')), 'not in <folder>/tide-tables');
    assert.ok(existsSync(join(chosen, 'tide-tables-2')), 'the second is not in <folder>/tide-tables-2');
    await ui.run<boolean>(`desktop.select('home')`);

    assert.equal(await ui.click('[data-testid=nav-settings]'), true);
    assert.ok(await ui.waitFor(`!!document.querySelector('[data-testid=folder-reset]')`));
    assert.equal(await ui.click('[data-testid=folder-reset]'), true);
    assert.ok(await ui.waitFor(`!document.querySelector('[data-testid=folder-reset]')`));
    assert.equal((await ui.run<import('../src/contracts').SettingsSnapshot>('desktop.settings.get()')).artifactsFolder, '');

    assert.equal(await ui.click('[data-testid=reveal-home]'), true);
    await present(app).line(new RegExp(`reveal ${escape(profile.oaHome)} \\(test mode: not shown\\)`));
    assert.equal(await ui.text('home-path'), profile.oaHome);
    assert.match(await ui.text('versions'), /\d+\.\d+\.\d+/);
  });

  it('the service row says the state and opens the service panel', T, async () => {
    assert.ok(
      await ui.waitFor(`/running|运行中/i.test(document.querySelector('[data-testid=service-line]')?.textContent ?? '')`),
      await ui.text('service-line'),
    );
    assert.equal(await ui.click('[data-testid=settings-manage]'), true);
    assert.ok(await ui.waitFor(`!!document.querySelector('[data-testid=service-panel]') && !document.querySelector('[data-testid=settings-dialog]')`));
    await ui.run<boolean>(`document.querySelector('[data-testid=service-panel] .icon-button').click(), true`);
    assert.ok(await ui.waitFor(`!document.querySelector('[data-testid=service-panel]')`));
  });
});

describe("the settings by default, and under test mode's switches", () => {
  let profile: TestProfile;
  let port: number;
  let app: DesktopTestApp | null;

  before(async () => {
    profile = makeProfile('oa-desktop-settings-default-');
    port = await freePort();
  });

  after(() => finish(present(app), profile));

  it("no --locale, no --theme, no settings file: the system's, and nothing to reopen for", T, async () => {
    assert.equal(existsSync(join(profile.oaHome, 'desktop', 'user-data', 'settings.json')), false);
    app = await launchApp(profile, port, { defaultLocale: false });
    await app.line(/\[desktop\] ready /);
    await app.connect();
    const { settings } = await app.state();
    assert.equal(settings.theme, 'system');
    assert.equal(settings.locale, 'system');
    assert.equal(settings.restartNeeded, false);
    assert.deepEqual(settings.forced, { theme: null, locale: null });
    assert.equal(settings.artifactsFolder, '');
    await app.quit();
    app = null;
  });

  it('--locale and --theme: the language and the look are shown and not changed here', T, async () => {
    app = await launchApp(profile, port, { args: ['--locale', 'en', '--theme', 'dark'] });
    await app.line(/\[desktop\] ready /);
    await app.connect();
    const ui = on(present(app));
    assert.ok(await ui.waitFor(`!!document.querySelector('[data-testid=nav-settings]')`));
    assert.equal(await ui.click('[data-testid=nav-settings]'), true);
    assert.ok(await ui.waitFor(`!!document.querySelector('[data-testid=settings-dialog]')`));
    assert.equal(await ui.disabled('[data-testid=language]'), true);
    assert.equal(await ui.run<boolean>(`[...document.querySelectorAll('[data-testid=look] button')].every((b) => b.disabled)`), true);
    assert.ok(await ui.text('forced-theme'));
    assert.ok(await ui.text('forced-locale'));
  });
});
