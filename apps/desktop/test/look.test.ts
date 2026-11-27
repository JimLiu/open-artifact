import type { ArtifactView } from '@open-artifact/protocol';
import type { TestApp as DesktopTestApp } from './lib/app.ts';
import { replyValue } from './lib/assertions.ts';
import type { Page as TestPage } from './lib/cdp.ts';
import type { TestProfile } from './lib/env.ts';
/**
 * The window's language and look, and the home page's thumbnails, in the running app: with `--locale zh` the app's
 * own words and the page's are Chinese; with `--theme dark` the root says dark and the page's tokens are the dark ones;
 * with `--thumbnails` (test mode only: a window that is never shown is otherwise not on screen, and takes none) a new
 * artifact gets its thumbnail taken from its type's page, saved to the daemon at the version it was taken at, and the
 * card shows it through the app's own `oa-thumbnail:` scheme. The picture's window is gone afterwards.
 *
 * Throwaway profile, free port that is not 4800; the daemon is stopped by the pid its own daemon.json names.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { launchApp, library } from './lib/app.ts';
import { daemonState, freePort, leftovers, makeProfile, stopDaemon, until } from './lib/env.ts';

const T = { timeout: 120_000 };

describe('language, look and thumbnails', () => {
  let profile: TestProfile;
  let port: number;
  let app: DesktopTestApp;
  let page: TestPage;
  let doc: ArtifactView;

  before(async () => {
    profile = makeProfile('oa-desktop-look-');
    port = await freePort();
    app = await launchApp(profile, port, { args: ['--locale', 'zh', '--theme', 'dark', '--thumbnails'] });
    await app.line(/\[desktop\] ready /);
    await app.connect();
    page = app.chrome;
  });

  after(async () => {
    await app?.quit();
    await stopDaemon(profile);
    const left = leftovers(profile);
    if (!process.env.OA_DESKTOP_KEEP) rmSync(profile.root, { recursive: true, force: true });
    assert.deepEqual(left, [], 'processes of the test profile still run');
  });

  it('speaks Chinese and draws dark', T, async () => {
    assert.ok(await page.waitFor(`!!document.querySelector('[data-testid=sidebar]')`), 'no sidebar');
    const look = await page.evaluate<{
      theme: string | undefined;
      platform: string | undefined;
      lang: string;
      nav: string[];
      home: string;
      bg: string;
      pageTheme: string | undefined;
    }>(`({
      theme: document.documentElement.dataset.theme,
      platform: document.documentElement.dataset.platform,
      lang: document.documentElement.lang,
      nav: [...document.querySelectorAll('[data-testid=sidebar] > .nav-row')].map((b) => b.textContent),
      home: document.querySelector('[data-tab=home]').textContent,
      bg: getComputedStyle(document.body).backgroundColor,
      pageTheme: document.querySelector('.oa-page')?.dataset.theme,
    })`);
    assert.equal(look.theme, 'dark');
    assert.equal(look.platform, process.platform);
    assert.equal(look.lang, 'zh-CN');
    assert.deepEqual(look.nav, ['新建', '搜索', '作品库']);
    assert.equal(look.home, '作品库');
    assert.equal(look.bg, 'rgb(28, 28, 30)');
    assert.equal(look.pageTheme, 'dark');
    // The page's own words are Chinese too (its tile groups are the app's).
    assert.ok(
      await page.waitFor(
        `[...document.querySelectorAll('.oa-tile-group .oa-section-title')].map((h) => h.textContent).join('|') === '直接开始|和 agent 一起做'`,
      ),
    );
  });

  it('starts in the look of the setting before the first state arrives', T, async () => {
    // theme.js is a classic script at the head's top, so it runs before the style sheets and before the first paint;
    // run again with data-theme taken off, it gives the look of the setting (--theme dark here, whatever the system's).
    const first = await page.evaluate<{ head: string[]; theme: string | undefined; bg: string }>(`new Promise((done) => {
      const root = document.documentElement;
      const head = [...document.head.children]
        .filter((el) => el.matches('script, link[rel=stylesheet]'))
        .map((el) => el.localName === 'script' ? 'script ' + el.getAttribute('src') + (el.defer || el.async || el.type === 'module' ? ' deferred' : '') : 'css');
      delete root.dataset.theme;
      const script = document.createElement('script');
      script.src = 'theme.js';
      script.onload = () => done({ head, theme: root.dataset.theme, bg: getComputedStyle(document.body).backgroundColor });
      script.onerror = () => done({ head, theme: 'theme.js did not load', bg: '' });
      document.head.append(script);
    })`);
    assert.equal(first.head[0], 'script theme.js', first.head.join(', '));
    assert.equal(first.theme, 'dark');
    assert.equal(first.bg, 'rgb(28, 28, 30)');
  });

  it("takes a new artifact's thumbnail, saves it at its version, and shows it", T, async () => {
    doc = await library(daemonState(profile), 'artifacts.create', { type: 'docs', title: '渡轮笔记', blank: true, folder: join(profile.artifacts, 'ferry') });
    assert.ok(doc.id, JSON.stringify(doc));
    const taken = await until(
      async () => {
        const answer =
          await page.evaluate<import('../src/types').Reply<import('../../../packages/library-page/src/index').ArtifactList>>('desktop.library.list()');
        const artifact = replyValue(answer)?.artifacts.find((a) => a.id === doc.id);
        return artifact && artifact.thumbnail && artifact.thumbnail === artifact.updatedAt ? artifact : null;
      },
      90_000,
      500,
    );
    assert.ok(taken, `no thumbnail was saved:\n${app.lines.filter((l) => /thumbnail|capture/i.test(l)).join('\n')}`);
    const shown = await page.waitFor(
      `(() => { const img = [...document.querySelectorAll('.oa-item')].find((i) => i.querySelector('.oa-name')?.textContent === '渡轮笔记')?.querySelector('img'); return img && img.complete && img.naturalWidth > 0 ? img.getAttribute('src') : null; })()`,
      30_000,
    );
    assert.ok(typeof shown === 'string' && shown.startsWith('oa-thumbnail://artifact/'), String(shown));
    // The picture's window is gone: only the app's own page is left.
    assert.ok(
      await until(async () => (await app.cdp.targets()).filter((t) => t.type === 'page').length === 1, 10_000),
      JSON.stringify((await app.cdp.targets()).map((t) => t.url)),
    );
  });

  it('the thumbnail scheme answers only artifact ids', T, async () => {
    const status = await page.evaluate(
      `new Promise((done) => { const img = new Image(); img.onload = () => done('loaded'); img.onerror = () => done('refused'); img.src = 'oa-thumbnail://artifact/..%2F..%2Fdaemon.json'; })`,
    );
    assert.equal(status, 'refused');
  });
});
