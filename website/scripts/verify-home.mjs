#!/usr/bin/env node
// Checks the home page's live stage in headless Chrome (the repo's e2e/lib/browser.mjs), against the built website as a
// static host serves it: the page holds a tab per demo and no frame of its own; the first demo's frame
// (`playground/<demo>/?embed=1&replay=hold&lang=…`) arrives after the page has loaded and shows the real Shell without
// the demo's hint bar; the demo's replay plays while it is on show, a click on the veil skips it and "Replay" plays it
// again; the veil keeps the wheel with the page until someone clicks in; a tab, and a type card's "Try it live", show another
// demo; a narrow window loads nothing until asked.
//
//   node website/scripts/verify-home.mjs [site URL, default http://127.0.0.1:4330/]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../../e2e/lib/browser.mjs';

const DEMOS = ['slides', 'design', 'design-system', 'whiteboard', 'sheets', 'data', 'docs', 'motion', 'page'];
/** Only in the page itself: `waitFor` asks the frames too. */
const TOP = (expr) => `window.top === window && (${expr})`;
const STAGE = "document.querySelector('[data-stage]')";
const FRAMES = `[...${STAGE}.querySelectorAll('iframe')]`;
/** The demo on show: its frame is up, and the stage says ready. */
const SHOWN = (demo) => TOP(`${STAGE}.dataset.state === 'ready' && ${FRAMES}.some(f => f.hasAttribute('data-on') && new URL(f.src).pathname.endsWith('/playground/${demo}/'))`);

/** Runs the checks against the site at `site` (its root URL); resolves to the number that failed. */
export async function verifyHome(site) {
  const base = new URL(site);
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(!!ok);
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  console.log('\n# home: live stage');
  const browser = await launch({ width: 1440, height: 900 });
  try {
    const page = await browser.load(base.href, { ready: TOP(`!!${STAGE}`), timeout: 20000, settle: 0 });
    try {
      const tabs = await page.evaluate(`[...${STAGE}.querySelectorAll('[data-demo]')].map(a => a.href)`);
      check('the stage has a tab per demo, each a link to the demo’s own page', tabs.length === DEMOS.length && DEMOS.every((d) => tabs.includes(new URL(`playground/${d}/`, base).href)), `${tabs.length} tabs`);
      const first = await page.evaluate(`${STAGE}.querySelector('[data-demo][aria-current=true]').dataset.demo`);
      check('the first demo’s frame loads by itself', await page.waitFor(SHOWN(first), 40000), first);
      check('…as the embed page, with no hint bar', await page.evaluate(`(f => new URL(f.src).search === '?embed=1&replay=hold&lang=en' && getComputedStyle(f.contentDocument.getElementById('pg-hint')).display === 'none' && !!f.contentDocument.querySelector('iframe[name=open-artifact-shell]'))(${FRAMES}[0])`));
      const REPLAY = `${FRAMES}.find(f => f.hasAttribute('data-on')).contentDocument.querySelector('.pg-replay')?.dataset.state`;
      check('the demo plays its replay, and the stage says so', await page.waitFor(TOP(`${STAGE}.dataset.replay === 'playing' && ${REPLAY} === 'playing' && !!${STAGE}.querySelector('.stage-veil-skip').offsetParent`), 20000));
      check('a veil covers the loaded demo', await page.evaluate(`(v => !v.hidden && v.getBoundingClientRect().height > 100)(${STAGE}.querySelector('[data-stage-veil]'))`));
      await page.evaluate(`${STAGE}.querySelector('[data-stage-veil]').click()`);
      check('a click on the veil hands the demo the pointer', await page.evaluate(`${STAGE}.hasAttribute('data-active') && ${STAGE}.querySelector('[data-stage-veil]').hidden`));
      check('…and skips the replay', await page.waitFor(TOP(`${STAGE}.dataset.replay === 'done' && ${REPLAY} === 'done' && !${STAGE}.querySelector('[data-stage-replay]').hidden`), 20000));
      await page.evaluate("document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))");
      check('a press outside the stage takes it back', await page.evaluate(`!${STAGE}.hasAttribute('data-active') && !${STAGE}.querySelector('[data-stage-veil]').hidden`));

      await page.evaluate(`${STAGE}.querySelector('[data-stage-replay]').click()`);
      check('"Replay" plays it again', await page.waitFor(TOP(`${STAGE}.dataset.replay === 'playing' && ${REPLAY} === 'playing' && ${STAGE}.querySelector('[data-stage-replay]').hidden`), 20000));

      const other = first === 'whiteboard' ? 'slides' : 'whiteboard';
      await page.evaluate(`${STAGE}.querySelector('[data-demo=${other}]').click()`);
      check('a tab shows its demo in the stage', await page.waitFor(SHOWN(other), 40000), other);
      check('…and stays on the home page, with "Open full screen" at that demo', await page.evaluate(`location.href === ${JSON.stringify(base.href)} && ${STAGE}.querySelector('[data-stage-open]').href === ${JSON.stringify(new URL(`playground/${other}/`, base).href)}`));
      await page.evaluate("document.querySelector('.type-card [data-stage-demo=sheets]').click()");
      check('a type card’s "Try it live" shows that demo in the stage', await page.waitFor(SHOWN('sheets'), 40000));
      for (const demo of ['data', 'docs']) {
        await page.evaluate(`${STAGE}.querySelector('[data-demo=${demo}]').click()`);
        await page.waitFor(SHOWN(demo), 40000);
      }
      check('at most three demos stay loaded', (await page.evaluate(`${FRAMES}.length`)) === 3);
      check('no page problems', page.problems.length === 0, page.problems.join(' | '));
    } finally {
      await page.close();
    }

    const zh = await browser.load(new URL('zh/', base).href, { ready: TOP(`!!${STAGE}`), timeout: 20000, settle: 0 });
    try {
      check('the Chinese home page has the stage too', await zh.waitFor(TOP(`${STAGE}.dataset.state === 'ready'`), 40000));
    } finally {
      await zh.close();
    }
  } finally {
    await browser.close();
  }

  // A phone: nothing loads until someone asks.
  const phone = await launch({ width: 390, height: 844 });
  try {
    const page = await phone.load(base.href, { ready: TOP(`!!${STAGE}`), timeout: 20000, settle: 2500 });
    try {
      check('a narrow window loads no demo by itself', await page.evaluate(`${STAGE}.dataset.state === 'idle' && ${FRAMES}.length === 0`));
      await page.evaluate(`${STAGE}.querySelector('[data-stage-load]').click()`);
      check('…until "Load the live demo"', await page.waitFor(TOP(`${STAGE}.dataset.state === 'ready' && ${FRAMES}.length === 1`), 40000));
    } finally {
      await page.close();
    }
  } finally {
    await phone.close();
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} home checks passed`);
  return failed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit((await verifyHome(process.argv[2] ?? 'http://127.0.0.1:4330/')) ? 1 : 0);
}
