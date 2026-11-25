/**
 * A tab with work that is not saved is not reloaded when the daemon comes back: the doc's folder is made read-only, so
 * what is typed stays unsaved; the service is restarted from its panel; the tab keeps its page and shows Reload; once
 * the folder can be written again, Reload brings the tab back on the new daemon.
 *
 * Throwaway profile, free port that is not 4800; the daemon is stopped by the pid its own daemon.json names.
 */
import assert from 'node:assert/strict';
import { chmodSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { alive, daemonState, freePort, leftovers, makeProfile, sleep, stopDaemon, until } from './lib/env.mjs';
import { launchApp, library } from './lib/app.mjs';

const T = { timeout: 180_000 };
const inDocs = (url) => /\/docs\/[0-9a-f]+\//.test(url);
const js = (value) => JSON.stringify(value);

/** Sets `mode` on `dir` and everything under it (directories get the execute bit). */
function chmodTree(dir, fileMode, dirMode) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) chmodTree(path, fileMode, dirMode);
    else chmodSync(path, fileMode);
  }
  chmodSync(dir, dirMode);
}

describe('a tab with unsaved work when the daemon comes back', () => {
  let profile;
  let port;
  let app;
  let doc;
  let folder;

  before(async () => {
    profile = makeProfile('oa-desktop-stale-');
    port = await freePort();
    app = await launchApp(profile, port);
    await app.line(/\[desktop\] ready /);
    await app.connect();
    folder = join(profile.artifacts, 'ferry');
    doc = await library(daemonState(profile), 'artifacts.create', { type: 'docs', title: 'Ferry', blank: true, folder });
    assert.ok(doc.id, js(doc));
  });

  after(async () => {
    try {
      chmodTree(folder, 0o644, 0o755);
    } catch {
      // Not made.
    }
    await app?.quit();
    await stopDaemon(profile);
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  const tab = async () => (await app.state()).tabs.find((t) => t.id === doc.id);

  it('is kept as it was, shows Reload, and Reload brings it back', T, async () => {
    assert.equal((await app.open(doc.id)).ok, true);
    const view = await app.view(doc.id);
    assert.ok(await view.waitInFrame(inDocs, "!!document.querySelector('.doc-text p')"), 'the doc editor did not draw');
    assert.ok(await until(async () => (await tab())?.status === 'ready', 15_000));

    // The folder cannot be written: what is typed stays unsaved.
    chmodTree(folder, 0o444, 0o555);
    const placed = await view.inFrame(
      inDocs,
      `(() => { const p = document.querySelector('.doc-text p'); const root = p.closest('[contenteditable]'); root.focus(); const s = getSelection(); s.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); s.addRange(r); return document.activeElement === root; })()`,
    );
    assert.equal(placed, true, 'the editor did not take focus');
    await view.type('Not saved yet.');
    assert.ok(await until(async () => (await tab())?.saved === 'unsaved', 30_000), js(await tab()));
    await sleep(500);
    assert.equal((await tab()).saved, 'unsaved', 'unsaved did not stay');
    assert.equal((await tab()).unsaved, true);
    await view.evaluate(`window.__marker = 'kept'`);

    // Restart the service from its panel.
    const was = daemonState(profile).pid;
    const page = app.chrome;
    await page.evaluate(`desktop.select('home')`);
    assert.ok(await page.waitFor(`!!document.querySelector('[data-testid=service-status]')`));
    await page.evaluate(`document.querySelector('[data-testid=service-status]').click(), true`);
    assert.ok(await page.waitFor(`!!document.querySelector('[data-testid=service-restart]')`));
    await page.evaluate(`document.querySelector('[data-testid=service-restart]').click(), true`);
    assert.ok(await page.waitFor(`!!document.querySelector('[data-testid=confirm-restart-yes]')`));
    await page.evaluate(`document.querySelector('[data-testid=confirm-restart-yes]').click(), true`);
    assert.ok(await until(() => daemonState(profile)?.pid && daemonState(profile).pid !== was && alive(daemonState(profile).pid), 60_000), 'no new daemon');
    assert.ok(await page.waitFor(`document.querySelector('[data-testid=service-panel]')?.dataset.state === 'running'`, 30_000));
    await page.evaluate(`document.querySelector('[data-testid=service-panel] .icon-button').click(), true`);

    // Kept as it was: not loaded again, the same page, Reload in its tab.
    assert.ok(await until(async () => (await tab())?.status === 'stale', 15_000), js(await tab()));
    await app.line(/kept as it was \(it had unsaved work when the daemon went away\)/);
    await sleep(1000);
    assert.equal((await tab()).status, 'stale');
    assert.equal(await view.evaluate('window.__marker'), 'kept', 'the page was loaded again');
    assert.equal(app.lines.some((l) => new RegExp(`tab ${doc.id}: loaded again`).test(l)), false);
    assert.ok(await page.waitFor(`!!document.querySelector('[data-tab=${js(doc.id)}] .tab-reload')`), 'no Reload in the tab');

    // The folder can be written again; Reload brings the tab back on the new daemon.
    chmodTree(folder, 0o644, 0o755);
    await page.evaluate(`document.querySelector('[data-tab=${js(doc.id)}] .tab-reload').click(), true`);
    assert.ok(await until(async () => (await tab())?.status === 'ready', 30_000), js(await tab()));
    await app.line(new RegExp(`tab ${doc.id}: unsaved work let go for the reload asked for`));
    await app.line(new RegExp(`tab ${doc.id}: loaded again`));
    assert.equal(await page.evaluate(`!!document.querySelector('[data-tab=${js(doc.id)}] .tab-reload')`), false);
    const again = await app.view(doc.id);
    assert.ok(await again.waitInFrame(inDocs, "!!document.querySelector('.doc-text p')", 30_000), 'the doc editor did not come back');
  });
});
