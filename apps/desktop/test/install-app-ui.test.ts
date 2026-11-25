import type { TestApp as DesktopTestApp } from './lib/app.ts';
import { present } from './lib/assertions.ts';
import type { TestProfile } from './lib/env.ts';
/**
 * "Install as app" in a development run (Electron with this folder, test mode): every way in opens the dialog (a
 * card's More menu, a sidebar row's right-click menu, a tab's right-click menu, File ▸ Install as App… for the tab in
 * front), and the dialog says only the packaged app installs; nothing is written to the install folder. The packaged
 * app's dialog, state by state, is `test/packaged/installed-apps-manage.test.ts`'s.
 */
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { launchApp, library } from './lib/app.ts';
import { daemonState, freePort, leftovers, makeProfile, stopDaemon, until } from './lib/env.ts';

const T = { timeout: 120_000 };
const js = (value: unknown) => JSON.stringify(value);
const TITLE = 'Harbour app';

describe("install as app: the ways in, and a development run's dialog", () => {
  let profile: TestProfile;
  let port: number;
  let app: DesktopTestApp;
  let id: string;
  const run = <T = unknown>(expression: string) => app.chrome.evaluate<T>(expression);
  const waitFor = (expression: string, timeoutMs = 15_000) => app.chrome.waitFor(expression, timeoutMs);
  const card = `[...document.querySelectorAll('.oa-item')].find((item) => item.querySelector('.oa-name')?.textContent === ${js(TITLE)})`;
  const dialogSays = async () => {
    assert.ok(
      await waitFor(`document.querySelector('[data-testid=install-app-dialog]')?.dataset.state === 'unavailable'`),
      await run<string>('document.body.innerText'),
    );
    assert.equal(await run<string | undefined>(`document.querySelector('[data-testid=install-app-dialog]').dataset.artifact`), id);
    const reason = await run<string>(`document.querySelector('[data-testid=install-app-reason]').textContent`);
    assert.match(reason, /Only the packaged Open Artifact can install/);
    // Only Close: nothing to install with.
    assert.deepEqual(
      await run<(string | undefined)[]>(`[...document.querySelectorAll('[data-testid=install-app-dialog] button')].map((b) => b.dataset.testid)`),
      ['install-app-close'],
    );
    await run<boolean>(`document.querySelector('[data-testid=install-app-close]').click(), true`);
    assert.ok(await waitFor(`!document.querySelector('[data-testid=install-app-dialog]')`), 'the dialog stayed open');
  };
  const rightClick = (selector: string) =>
    run(
      `(() => { const el = ${selector}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 10, clientY: r.y + 10, button: 2 })); return true; })()`,
    );

  before(async () => {
    profile = makeProfile('oa-desktop-install-ui-');
    port = await freePort();
    app = await launchApp(profile, port);
    await app.line(/\[desktop\] ready /);
    await app.connect();
    const made = await library(daemonState(profile), 'artifacts.create', {
      type: 'docs',
      title: TITLE,
      blank: true,
      folder: join(profile.artifacts, 'harbour'),
    });
    assert.ok(made.id, js(made));
    id = made.id;
    assert.ok(await waitFor(`!!(${card})`), 'no card');
  });

  after(async () => {
    await app?.quit({ force: true });
    await stopDaemon(profile);
    const left = leftovers(profile);
    const installDir = join(profile.home, 'Applications');
    const wrote = existsSync(installDir);
    rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
    assert.equal(wrote, false, 'a development run wrote to the install folder');
  });

  it("a card's More menu: Install as App… opens the dialog, which says only the packaged app installs", T, async () => {
    await run<boolean>(`(() => { ${card}.querySelector('.oa-act').click(); return true; })()`);
    assert.ok(await waitFor(`!!document.querySelector('.oa-menu-item[data-action=install-app]')`), 'no Install as App… in the card menu');
    assert.equal(await run<string>(`document.querySelector('.oa-menu-item[data-action=install-app]').textContent.trim()`), 'Install as App…');
    await run<boolean>(`document.querySelector('.oa-menu-item[data-action=install-app]').click(), true`);
    await dialogSays();
  });

  it("a sidebar row's right-click menu", T, async () => {
    await rightClick(`document.querySelector('[data-testid=recent] [data-artifact=${js(id)}]')`);
    assert.ok(await waitFor(`!!document.querySelector('[data-testid=row-install-app]')`), 'no Install as App… in the row menu');
    await run<boolean>(`document.querySelector('[data-testid=row-install-app]').click(), true`);
    await dialogSays();
  });

  it("a tab's right-click menu (the view hidden while it is open), and File ▸ Install as App… for the tab in front", T, async () => {
    await app.open(id);
    assert.ok(await until(async () => (await app.state()).current === id, 30_000), 'the tab did not come to the front');
    await rightClick(`document.querySelector('[data-tab=${js(id)}]')`);
    assert.ok(await waitFor(`!!document.querySelector('[data-testid=tab-menu]')`), 'no tab menu');
    assert.ok(await until(async () => (await app.state()).overlay === true, 5000), `the view stays over the tab menu: ${js(await app.state())}`);
    await run<boolean>(`document.querySelector('[data-testid=tab-install-app]').click(), true`);
    await dialogSays();

    const menu = await app.menu();
    const file = present(present(menu).find((m) => m.label === 'File')).submenu;
    const item = present(file).find((i) => i.id === 'install-app');
    assert.equal(item?.label, 'Install as App…');
    assert.equal(item.enabled, true, 'enabled with a tab in front');
    const out = await app.command('install-app');
    assert.ok(out.ok, js(out));
    await dialogSays();
  });
});
