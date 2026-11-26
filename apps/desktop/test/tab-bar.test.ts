import type { ArtifactView } from '@open-artifact/protocol';
import type { TestApp as DesktopTestApp } from './lib/app.ts';
import type { Page as TestPage } from './lib/cdp.ts';
import type { TestProfile } from './lib/env.ts';
/**
 * The tab bar of the window, driven over DevTools: a tab dragged past another takes its place (and the tabs keep that
 * order), a tab moves by key, the tabs that do not fit are in ▾'s list and one picked there comes into the row and to
 * the front, a tab's menu closes the tabs to its right and the others (the view hidden while it is open), and + opens
 * its menu and closes it again, and opens an artifact not yet open from it.
 *
 * Throwaway profile, free port that is not 4800; the daemon is stopped by the pid its own daemon.json names.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { launchApp, library } from './lib/app.ts';
import { daemonState, freePort, leftovers, makeProfile, stopDaemon, until } from './lib/env.ts';

const T = { timeout: 180_000 };
const js = (value: unknown) => JSON.stringify(value);
/** More tabs than a browser opens HTTP connections to one host (six), and more than fit in the 1280px window. */
const COUNT = 8;

describe('the tab bar', () => {
  let profile: TestProfile;
  let port: number;
  let app: DesktopTestApp;
  let page: TestPage;
  const made: ArtifactView[] = [];

  const run = <T = unknown>(expression: string) => page.evaluate<T>(expression);
  const waitFor = (expression: string, timeoutMs = 15_000) => page.waitFor(expression, timeoutMs);
  /** The artifact tabs in the app's order. */
  const order = async () => (await app.state()).tabs.map((t) => t.id);
  /** The artifact tabs in the bar's order, as drawn. */
  const drawn = () => run<string[]>(`[...document.querySelectorAll('[data-slot=tab]')].map((el) => el.dataset.tab).filter((id) => id !== 'home')`);
  /** The tabs the row shows (not in ▾'s list). */
  const shown = () =>
    run<string[]>(`[...document.querySelectorAll('[data-slot=tab]:not([data-hidden])')].map((el) => el.dataset.tab).filter((id) => id !== 'home')`);
  const tab = (id: string) => `document.querySelector('[data-tab=${js(id)}]')`;
  /** The middle of a tab, in the window page's viewport. */
  const middle = (id: string) => run<[number, number]>(`(() => { const r = ${tab(id)}.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  /** A pointer event of the mouse at (x, y), sent to what is there (a window never shown gets no real mouse). */
  const pointer = (type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number) =>
    run(
      `(() => { const target = document.elementFromPoint(${x}, ${y}) ?? document.body; target.dispatchEvent(new PointerEvent(${js(type)}, { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: ${x}, clientY: ${y}, button: ${type === 'pointermove' ? -1 : 0}, buttons: ${type === 'pointerup' ? 0 : 1} })); return true; })()`,
    );
  const rightClick = (selector: string) =>
    run(
      `(() => { const el = ${selector}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 10, clientY: r.y + 10, button: 2 })); return true; })()`,
    );

  before(async () => {
    profile = makeProfile('oa-desktop-tab-bar-');
    port = await freePort();
    app = await launchApp(profile, port);
    await app.line(/\[desktop\] ready /);
    await app.connect();
    page = app.chrome;
    const daemon = daemonState(profile);
    for (let i = 0; i < COUNT; i++) {
      const title = `Crossing log ${String(i + 1).padStart(2, '0')} with a long title`;
      made.push(await library(daemon, 'artifacts.create', { type: 'docs', title, blank: true, folder: join(profile.artifacts, `log-${i}`) }));
    }
    // 2026-11-26: each view held an event stream to the daemon, and the seventh tab's page waited 8 to 30 s for one of
    // the six connections. Every tab opens at once.
    for (const artifact of made) {
      const started = Date.now();
      await app.open(artifact.id);
      assert.ok(Date.now() - started < 5000, `tab ${made.indexOf(artifact) + 1} took ${Date.now() - started} ms to open`);
    }
    assert.ok(await until(async () => (await order()).length === COUNT, 60_000), js(await app.state()));
    assert.ok(await waitFor(`document.querySelectorAll('[data-slot=tab]').length === ${COUNT + 1}`), 'the bar does not draw every tab');
  });

  after(async () => {
    await app?.quit({ force: true });
    await stopDaemon(profile);
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it('draws the tabs in the order they opened, the last one in front and in sight; the ones that do not fit are in ▾', T, async () => {
    assert.deepEqual(await drawn(), made.map((a) => a.id));
    const last = made[COUNT - 1].id;
    assert.equal((await app.state()).current, last);
    const row = await shown();
    assert.ok(row.includes(last), js(row));
    assert.ok(row.length < COUNT, `all ${COUNT} tabs fit: the test needs some in the list`);
    assert.equal(await run<boolean>(`!document.querySelector('[data-testid=tab-more]').classList.contains('hidden')`), true, '▾ is not shown');
    // 2026-11-26: the tabs in the list kept their room in the row (`relative` won over `absolute`), and the row
    // scrolled to show the one in front, so a drag put tabs in the wrong place. The row is not scrolled, and the first
    // tab shown sits right after the home tab.
    const geometry = await run<{ scrolled: number; gap: number }>(
      `(() => { const home = document.querySelector('[data-tab=home]'); const first = ${tab(row[0])};
        return { scrolled: first.parentElement.scrollLeft, gap: first.getBoundingClientRect().left - home.getBoundingClientRect().right }; })()`,
    );
    assert.equal(geometry.scrolled, 0, js(geometry));
    assert.ok(geometry.gap >= 0 && geometry.gap < 8, js(geometry));
    // Its tooltip says the whole title.
    assert.equal(await run<string | null>(`${tab(last)}.getAttribute('title')`), made[COUNT - 1].title);
  });

  it('a tab picked from ▾ comes into the row next to the last one shown, and to the front', T, async () => {
    const row = await shown();
    const listed = (await drawn()).filter((id) => !row.includes(id));
    const pick = listed[0];
    await run(`document.querySelector('[data-testid=tab-more]').click(), true`);
    assert.ok(await waitFor(`!!document.querySelector('[data-testid=tab-list]')`), 'no list');
    assert.ok(await until(async () => (await app.state()).overlay === true, 5000), 'the view stays over the list');
    const rows = await run<string[]>(`[...document.querySelectorAll('[data-testid=tab-list] [data-tab-row]')].map((el) => el.dataset.tabRow)`);
    assert.deepEqual(rows, listed, 'the list names the tabs that do not fit, in order');
    await run(`document.querySelector('[data-testid=tab-list] [data-tab-row=${js(pick)}]').click(), true`);
    assert.ok(await waitFor(`!document.querySelector('[data-testid=tab-list]')`), 'the list stayed');
    assert.ok(await until(async () => (await app.state()).current === pick, 15_000), js(await app.state()));
    assert.ok(await until(async () => (await shown()).includes(pick), 5000), js(await shown()));
    // It went next to the last tab shown, in the app's order too.
    const now = await order();
    const lastShown = row[row.length - 1];
    assert.equal(Math.abs(now.indexOf(pick) - now.indexOf(lastShown)), 1, js({ now, pick, lastShown }));
    assert.ok(await until(async () => (await app.state()).overlay === false, 5000), 'the view did not come back');
  });

  it('a tab dragged past the next one takes its place, and the app keeps that order', T, async () => {
    const row = await shown();
    const [a, b] = row;
    const [ax, y] = await middle(a);
    const [bx] = await middle(b);
    const width = await run<number>(`${tab(b)}.getBoundingClientRect().width`);
    await pointer('pointerdown', ax, y);
    for (let x = ax; x <= bx + width / 2; x += 12) await pointer('pointermove', x, y);
    assert.equal(await run<string | null>(`${tab(a)}.dataset.dragging ?? null`), 'true', 'the tab is not being dragged');
    await pointer('pointerup', bx + width / 2, y);
    assert.ok(await until(async () => {
      const now = await order();
      return now.indexOf(a) === now.indexOf(b) + 1;
    }, 5000), js(await order()));
    assert.ok(await until(async () => (await drawn()).join() === (await order()).join(), 5000), 'the bar and the app disagree');
  });

  it('a tab moves by key (⌘/Ctrl ⇧ ←/→) and keeps the keyboard', T, async () => {
    const row = await shown();
    const id = row[1];
    const before = await order();
    const mac = (await app.state()).look.platform === 'darwin';
    await run(
      `(() => { const el = ${tab(id)}; el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true, shiftKey: true, ${mac ? 'metaKey' : 'ctrlKey'}: true })); return true; })()`,
    );
    assert.ok(await until(async () => (await order()).indexOf(id) === before.indexOf(id) - 1, 5000), js(await order()));
    assert.ok(await waitFor(`document.activeElement === ${tab(id)}`), 'the tab lost the keyboard');
  });

  // 2026-11-26: closing tabs left four that fit to within a pixel; the fit flipped every render (React's update limit)
  // and the window's page went blank.
  it("a tab's menu closes the tabs to its right, then the others (the view hidden while it is open)", T, async () => {
    const row = await shown();
    const id = row[1];
    const at = (await order()).indexOf(id);
    await rightClick(tab(id));
    assert.ok(await waitFor(`document.querySelector('[data-testid=tab-menu]')?.dataset.tabMenu === ${js(id)}`), 'no menu for the tab');
    assert.ok(await until(async () => (await app.state()).overlay === true, 5000), 'the view stays over the menu');
    await run(`document.querySelector('[data-testid=tab-close-right]').click(), true`);
    assert.ok(await until(async () => (await order()).length === at + 1, 15_000), js(await order()));
    assert.equal((await order()).at(-1), id);

    await rightClick(tab(id));
    assert.ok(await waitFor(`!!document.querySelector('[data-testid=tab-menu]')`), 'no menu');
    await run(`document.querySelector('[data-testid=tab-close-others]').click(), true`);
    assert.ok(await until(async () => (await order()).join() === id, 15_000), js(await order()));
    // With one tab, every tab fits: ▾ goes.
    assert.ok(await waitFor(`document.querySelector('[data-testid=tab-more]').classList.contains('hidden')`), '▾ stayed');
    assert.ok(await until(async () => (await app.state()).overlay === false, 5000), 'the view did not come back');
  });

  it('+ opens its menu and closes it again; an artifact not open opens from it', T, async () => {
    const plus = `document.querySelector('[data-testid=tab-new]')`;
    await run(`${plus}.click(), true`);
    assert.ok(await waitFor(`!!document.querySelector('[data-testid=tab-new-menu]')`), 'no menu');
    assert.ok(await until(async () => (await app.state()).overlay === true, 5000), 'the view stays over the menu');
    await run(`${plus}.click(), true`);
    assert.ok(await waitFor(`!document.querySelector('[data-testid=tab-new-menu]')`), 'a second click left the menu open');
    assert.equal(await run<string | null>(`${plus}.getAttribute('aria-expanded')`), 'false');

    await run(`${plus}.click(), true`);
    assert.ok(await waitFor(`!!document.querySelector('[data-testid=tab-new-menu] [data-artifact]')`), 'the menu offers no artifact');
    // Artifacts not open, at most six.
    const offered = await run<string[]>(`[...document.querySelectorAll('[data-testid=tab-new-menu] [data-artifact]')].map((el) => el.dataset.artifact)`);
    const open = await order();
    assert.deepEqual(offered.filter((id) => open.includes(id)), [], js({ offered, open }));
    assert.ok(offered.length <= 6, js(offered));
    const pick = offered[0];
    await run(`document.querySelector('[data-testid=tab-new-menu] [data-artifact=${js(pick)}]').click(), true`);
    assert.ok(await until(async () => (await app.state()).current === pick, 15_000), js(await app.state()));
    assert.ok(await waitFor(`!document.querySelector('[data-testid=tab-new-menu]')`), 'the menu stayed');
  });
});
