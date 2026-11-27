// End-to-end tests of the installed Motion type: CLI validation and write rules, live playback in Chrome,
// compact Properties / Theme inspector, panel toggle announcements, layer retouching (Esc in Text styles back to the
// picked row, a line whose words set their own weight) and SVG group hide parts, standalone HTML export after an
// editor rebuild, the reload ask when a rebuild took away a part not loaded yet, Export dialog Escape, stray file-drop
// guard, Read as text from the More menu (saved text, focus back to More), the
// screen reader scene section, read-only inline iframe (#view-inline), a clip's own sound, captions and a counting
// figure, and video scenes trimmed, split, added and removed by hand.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { findChrome, launch } from './lib/browser.mjs';
import { cli } from './lib/cli.mjs';
import { until } from './lib/http.mjs';
import { browserOff, install, removeTmp, tmpDir, typePath } from './lib/target.mjs';

const TYPE = 'motion';
const T = { timeout: 90_000 };
const browserSkip = browserOff || !findChrome();

function skip() {
  const dir = typePath(TYPE);
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) return `${TYPE} is not in ${dir}`;
  const missing = ['scripts/cli.mjs', 'scripts/editors/motion/index.html'].filter((f) => !fs.existsSync(path.join(dir, f)));
  return missing.length ? `${TYPE} is not built (npm run build): no ${missing.join(', ')}` : false;
}

const docPath = (root, doc) => path.join(root, 'db', `${doc}.json`);
const readDoc = (root, doc) => JSON.parse(fs.readFileSync(docPath(root, doc), 'utf8'));

function introSceneCode(extraShape = '') {
  return `kit.scene('intro', {
  init(kit) {
    const wrap = kit.h(
      '<div class="wrap">' +
      '<h1 class="headline">Hello motion</h1>' +
      '<svg class="art" viewBox="0 0 240 160" width="240" height="160">' +
      '<rect x="0" y="0" width="240" height="160" fill="none" stroke="#6b7280" stroke-width="2"/>' +
      '<g class="badge">' +
      '<rect x="10" y="10" width="100" height="60" rx="8" fill="#d98a3d"/>' +
      '<circle cx="160" cy="40" r="24" fill="#2b5f8c"/>' +
      '<polygon points="40,100 90,100 65,145" fill="#4f8a5b"/>' +
      '<line x1="120" y1="110" x2="220" y2="110" stroke="#1c2430" stroke-width="6"/>' +
      ${JSON.stringify(extraShape)} +
      '</g></svg>' +
      // Every word sets its own weight: the line's Weight and Bold are not offered.
      '<p class="tagline"><b>Bold</b> <b>words</b></p>' +
      '</div>'
    );
    kit.stage.append(wrap);
  },
  render() {},
});`;
}

// A line on only in the middle of a scene that starts seconds in: Read as text must look between its ends.
const OUTRO_SCENE = `kit.scene('outro', {
  init(kit) {
    kit.stage.append(kit.h('<div class="wrap"><h1 class="headline">See you soon</h1><p class="aside">Back next week</p></div>'));
    this.aside = kit.stage.querySelector('.aside');
  },
  render(t) {
    this.aside.style.opacity = t > 0.6 && t < 1.4 ? '1' : '0';
  },
});`;

const SCENES_JSON = {
  v: 1,
  stage: 'final',
  width: 1280,
  height: 720,
  fps: 30,
  background: '#f5efe6',
  fonts: { display: 'space-grotesk', sans: 'manrope' },
  palettes: [
    { name: 'Warm', colors: { bg: '#f5efe6', ink: '#1c2430', accent: '#d98a3d', muted: '#6b7280' } },
    { name: 'Cool', colors: { bg: '#eef3f8', ink: '#102033', accent: '#2b5f8c', muted: '#5a6b7c' } },
  ],
  scenes: [
    { id: 'intro', name: 'Intro', dur: 3, desc: 'Opening card with headline and badge.' },
    { id: 'outro', name: 'Outro', dur: 2, desc: 'Closing headline.' },
  ],
};

const BASE_CSS = `:root { --bg: #f5efe6; --ink: #1c2430; --accent: #d98a3d; --muted: #6b7280; }
.wrap { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; background: var(--bg); }
.headline { font-family: var(--font-display, sans-serif); font-size: 72px; color: var(--ink); margin: 0; }`;

describe(TYPE, { skip: skip() }, () => {
  let run, root, url, publicUrl, browser, page, editorAssets, downloads;

  before(async () => {
    const { dir } = install(typePath(TYPE), TYPE);
    const home = tmpDir('motion-home');
    editorAssets = path.join(dir, 'scripts', 'editors', TYPE, 'assets');
    downloads = path.join(home, 'Downloads');
    run = cli(dir, { HOME: home, OPEN_ARTIFACT_TYPE_SERVER_HOME: tmpDir('motion-state'), OPEN_ARTIFACT_USER: 'E2E' });
    root = path.join(tmpDir('motion-film'), 'film');
    ({ url: publicUrl } = await run.json(['open', root, '--type', TYPE, '--title', 'Smoke film', '--json']));
    const writes = [
      { op: 'set', path: 'film/meta', data: { v: 1, title: 'Smoke film', updatedAt: Date.now() } },
      { op: 'set', path: 'modules/scenes.json', data: { kind: 'json', text: JSON.stringify(SCENES_JSON) } },
      { op: 'set', path: 'modules/base.css', data: { kind: 'css', text: BASE_CSS } },
      { op: 'set', path: 'modules/scene-intro.js', data: { kind: 'js', text: introSceneCode() } },
      { op: 'set', path: 'modules/scene-outro.js', data: { kind: 'js', text: OUTRO_SCENE } },
      { op: 'set', path: 'modules/score.js', data: { kind: 'js', text: `kit.score((S) => {
        S.program('keys', 'marimba');
        S.note('keys', 'C5', { t: 0, dur: 0.5, vel: 65 });
      });` } },
      { op: 'set', path: 'film/script', data: { code: 'window.CUT = kit.scenes();' } },
    ];
    const wrote = await run.run(['write-db', root, JSON.stringify(writes)]);
    assert.equal(wrote.code, 0, wrote.stdout + wrote.stderr);
    url = new URL('index.html', publicUrl).href;
    if (!browserSkip) {
      browser = await launch();
      page = await browser.load(url, { ready: `document.querySelector('[data-video-transport] button[aria-label="Play"], [data-video-transport] button[aria-label="Pause"]')` });
    }
  });

  after(async () => {
    await browser?.close();
    await run?.run(['stop']).catch(() => {});
    removeTmp();
  });

  it('checks a valid film and refuses writing page-owned edit records', T, async () => {
    const checked = await run.run(['check', root, '--json']);
    assert.equal(checked.code, 0, checked.stdout + checked.stderr);
    assert.equal(checked.json.findings.filter((f) => f.level === 'error').length, 0);

    const refused = await run.run([
      'write-db',
      root,
      JSON.stringify([{ op: 'set', path: 'modules/retouched.json', data: { kind: 'json', text: '{"v":1,"layers":[]}' } }]),
    ]);
    assert.equal(refused.code, 1, refused.stdout);
    assert.ok(!fs.existsSync(docPath(root, 'modules/retouched.json')));
  });

  it('opens in compact inspector mode, announces Properties toggle, and switches palette under Theme', { ...T, skip: browserSkip }, async () => {
    assert.equal(await page.evaluate(`document.documentElement.hasAttribute('data-inspector-v1')`), true);

    await page.evaluate(`document.querySelector('button[aria-label="Properties"]').click()`);
    assert.ok(await page.waitFor(`document.querySelector('[data-video-panel]')`, 10_000));
    assert.ok(
      await page.waitFor(
        `[...document.querySelectorAll('[role="status"][aria-live]')].some((el) => /Properties(?: and Theme)? opened/.test(el.textContent || ''))`,
        10_000,
      ),
    );

    // Wait for Theme tab to appear once palettes are probed, then pick an alternate palette radio.
    assert.ok(await page.waitFor(`[...document.querySelectorAll('[data-video-panel] [role="tab"]')].some((t) => t.textContent?.trim() === 'Theme')`, 20_000));
    await page.evaluate(`[...document.querySelectorAll('[data-video-panel] [role="tab"]')].find((t) => t.textContent?.trim() === 'Theme').click()`);
    assert.ok(await page.waitFor(`document.querySelector('[data-video-panel] [role="radiogroup"] button[role="radio"][aria-checked="false"]')`, 20_000));
    await page.evaluate(`document.querySelector('[data-video-panel] [role="radiogroup"] button[role="radio"][aria-checked="false"]').click()`);

    assert.ok(await until(() => fs.existsSync(docPath(root, 'modules/recolored.json')), 15_000), 'recolored.json should be written');
    const recolored = JSON.parse(readDoc(root, 'modules/recolored.json').text);
    assert.ok(Array.isArray(recolored.colors) && recolored.colors.length >= 2, JSON.stringify(recolored));

    await page.evaluate(`document.querySelector('button[aria-label="Close panel"]').click()`);
    assert.ok(await page.waitFor(`!document.querySelector('[data-video-panel]')`, 10_000));
    assert.ok(
      await page.waitFor(
        `[...document.querySelectorAll('[role="status"][aria-live]')].some((el) => /Properties(?: and Theme)? closed/.test(el.textContent || ''))`,
        10_000,
      ),
    );
  });

  it('edits a text layer color and keeps a hidden SVG group hidden via parts across an in-place edit', { ...T, skip: browserSkip }, async () => {
    // Pause at scene 1 and open Properties.
    await page.evaluate(`(() => {
      const pause = document.querySelector('[data-video-transport] button[aria-label="Pause"]');
      if (pause) pause.click();
      const home = document.querySelector('[data-video-transport] button[aria-label="Back to start"]');
      if (home) home.click();
      if (!document.querySelector('[data-video-panel]')) document.querySelector('button[aria-label="Properties"]').click();
      const propsTab = [...document.querySelectorAll('[data-video-panel] [role="tab"]')].find((t) => t.textContent?.trim() === 'Properties');
      if (propsTab) propsTab.click();
    })()`);
    assert.ok(await page.waitFor(`document.querySelector('[data-layers-tree] [role="treeitem"]')`, 20_000));

    // Pick the Text layer and verify Text styles, Appearance and Animate sections appear.
    await page.evaluate(`[...document.querySelectorAll('[data-layers-tree] [role="treeitem"]')].find((r) => (r.getAttribute('aria-label') || '').includes('Hello motion')).click()`);
    assert.ok(await page.waitFor(`document.querySelector('[data-video-panel] button[aria-label^="Text color:"]')`, 15_000));
    const headings = await page.evaluate(`[...document.querySelectorAll('[data-video-panel] [data-ui-section-head] button')].map((b) => b.textContent?.trim())`);
    assert.ok(headings.includes('Text styles'), JSON.stringify(headings));
    assert.ok(headings.includes('Animate'), JSON.stringify(headings));

    // Esc in a Text styles field puts the focus back on the picked layer's row and keeps the pick.
    const fontSizeField = `[data-video-panel] [data-ui-field] input[aria-label="Font size"]:not([type="range"])`;
    assert.ok(await page.waitFor(`Boolean(document.querySelector(${JSON.stringify(fontSizeField)}))`, 10_000), 'Font size field');
    await page.evaluate(`document.querySelector(${JSON.stringify(fontSizeField)}).focus()`);
    assert.equal(await page.evaluate(`document.activeElement?.matches(${JSON.stringify(fontSizeField)}) === true`), true);
    await page.press('Escape');
    assert.ok(
      await page.waitFor(`document.activeElement?.matches('[data-layers-tree] [role="treeitem"][aria-selected="true"]') === true`, 5_000),
      'Esc in Text styles should focus the picked layer row',
    );
    assert.ok(await page.evaluate(`Boolean(document.querySelector('[data-video-panel] button[aria-label^="Text color:"]'))`), 'the pick should be kept');

    // A line whose words all set their own weight: Weight and Bold are a disabled stand-in that says why, its Reset is off.
    const pickRow = (words) => page.evaluate(`[...document.querySelectorAll('[data-layers-tree] [role="treeitem"]')].find((r) => (r.getAttribute('aria-label') || '').includes(${JSON.stringify(words)})).click()`);
    await pickRow('Bold words');
    const ownWeight = `[data-video-panel] [data-own-style][role="group"]`;
    assert.ok(await page.waitFor(`Boolean(document.querySelector(${JSON.stringify(ownWeight)}))`, 15_000), 'own weight stand-in');
    const own = await page.evaluate(`(() => {
      const group = document.querySelector(${JSON.stringify(ownWeight)});
      const text = (id) => document.getElementById(id)?.textContent ?? '';
      return {
        name: text(group.getAttribute('aria-labelledby')),
        why: text(group.getAttribute('aria-describedby')),
        hidden: group.querySelector('[aria-hidden="true"]') !== null,
        bold: document.querySelector('[data-video-panel] button[aria-label="Bold"]') !== null,
        fontSize: document.querySelector('[data-video-panel] [data-ui-field] input[aria-label="Font size"]') !== null,
        resetWeight: document.querySelector('[data-video-panel] button[aria-label="Reset weight"]')?.disabled ?? null,
      };
    })()`);
    assert.equal(own.name, 'Weight, Bold', JSON.stringify(own));
    assert.match(own.why, /set this style themselves/, JSON.stringify(own));
    assert.equal(own.hidden, true, JSON.stringify(own));
    assert.equal(own.bold, false, JSON.stringify(own));
    // What the words do not set stays: the size is the line's.
    assert.equal(own.fontSize, true, JSON.stringify(own));
    assert.equal(own.resetWeight, true, JSON.stringify(own));
    await pickRow('Hello motion');
    assert.ok(await page.waitFor(`document.querySelector('[data-video-panel] button[aria-label^="Text color:"]') && !document.querySelector(${JSON.stringify(ownWeight)})`, 15_000));

    // Change Text color via the ColorPicker hex field.
    await page.evaluate(`document.querySelector('[data-video-panel] button[aria-label^="Text color:"]').click()`);
    assert.ok(await page.waitFor(`document.querySelector('[role="dialog"] input[aria-label="Color value"]')`, 10_000));
    await page.evaluate(`(() => {
      const input = document.querySelector('[role="dialog"] input[aria-label="Color value"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '#2244aa');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await page.press('Escape');

    assert.ok(
      await until(() => {
        if (!fs.existsSync(docPath(root, 'modules/retouched.json'))) return false;
        const rec = JSON.parse(readDoc(root, 'modules/retouched.json').text);
        return rec.layers.some((layer) => layer.ink?.v === '#2244aa');
      }, 15_000),
      'retouched.json should store ink #2244aa',
    );

    // Hide the SVG group (.badge) and confirm `parts` is saved.
    const hideSelector = `[data-layers-tree] [data-layer$="/g"] button[aria-label^="Hide "]`;
    assert.ok(
      await page.waitFor(`(() => {
        if (document.querySelector(${JSON.stringify(hideSelector)})) return true;
        for (const btn of document.querySelectorAll('[data-layers-tree] button[aria-label^="Expand "]')) btn.click();
        return Boolean(document.querySelector(${JSON.stringify(hideSelector)}));
      })()`, 10_000),
      'should find Hide button on SVG <g> layer',
    );
    await page.evaluate(`document.querySelector(${JSON.stringify(hideSelector)}).click()`);

    assert.ok(
      await until(() => {
        if (!fs.existsSync(docPath(root, 'modules/retouched.json'))) return false;
        const rec = JSON.parse(readDoc(root, 'modules/retouched.json').text);
        return rec.layers.some((layer) => layer.id.endsWith('/g') && layer.hidden?.v === 1 && typeof layer.parts === 'string');
      }, 15_000),
      'retouched.json should store hidden SVG group with parts',
    );

    // Edit the hidden <g> in place by adding a small shape: it must stay hidden via `parts`.
    const updated = await run.run([
      'write-db',
      root,
      JSON.stringify([{ op: 'set', path: 'modules/scene-intro.js', data: { kind: 'js', text: introSceneCode('<circle cx="200" cy="135" r="8" fill="#d98a3d"/>') } }]),
    ]);
    assert.equal(updated.code, 0, updated.stdout + updated.stderr);
    assert.ok(
      await page.waitFor(`(() => {
        for (const btn of document.querySelectorAll('[data-layers-tree] button[aria-label^="Expand "]')) btn.click();
        return document.querySelectorAll('[data-layers-tree] [data-layer$="/g"] button[aria-label^="Show "]').length > 0;
      })()`, 20_000),
    );
  });

  it('closes Export with Escape and blocks stray external file drops', { ...T, skip: browserSkip }, async () => {
    await page.evaluate(`document.querySelector('button[aria-label="Export"]').click()`);
    assert.ok(await page.waitFor(`document.querySelector('[role="dialog"]')`, 10_000));
    await page.press('Escape');
    assert.ok(await page.waitFor(`!document.querySelector('[role="dialog"]')`, 10_000));

    const dropResult = await page.evaluate(`(() => {
      const dt = { types: ['Files'], dropEffect: 'copy' };
      const event = new Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dt });
      window.dispatchEvent(event);
      return { prevented: event.defaultPrevented, effect: dt.dropEffect };
    })()`);
    assert.deepEqual(dropResult, { prevented: true, effect: 'none' });
  });

  it('reads the film as text from the More menu, saves it, and gives focus back to More when the panel closes', { ...T, skip: browserSkip }, async () => {
    const centre = async (selector) => {
      const box = await page.evaluate(`(() => {
        const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      })()`);
      return page.click(box[0], box[1]);
    };
    const menuItem = (name) => `[...document.querySelectorAll('[role="menu"] [role^="menuitem"]')].find((item) => item.textContent.trim() === ${JSON.stringify(name)})`;
    await page.evaluate(`(() => {
      document.querySelector('[data-video-transport] button[aria-label="Pause"]')?.click();
      document.querySelector('button[aria-label="Close panel"]')?.click();
    })()`);
    assert.ok(await page.waitFor(`!document.querySelector('[data-video-panel]')`, 10_000));
    await page.evaluate(`document.activeElement?.blur()`);
    await page.press('Home');
    assert.ok(await page.waitFor(`document.querySelector('[data-video-transport]').innerText.includes('0:00 /')`, 10_000));

    // The words for screen readers sit under the picture, the scene playing marked current.
    assert.ok(await page.waitFor(`document.querySelector('[data-video-scene-words] li[aria-current="true"]')?.textContent.includes('Intro')`, 10_000));
    assert.match(await page.evaluate(`document.querySelector('[data-video-scene-words]').textContent`), /Outro.*Closing headline/);

    // More opens a menu; Escape closes it and gives focus back to its button.
    await centre('[data-video-more]');
    assert.ok(await page.waitFor(menuItem('Read as text'), 10_000));
    assert.equal(await page.evaluate(`${menuItem('Single-key shortcuts')}?.getAttribute('role')`), 'menuitemcheckbox');
    assert.equal(await page.evaluate(`${menuItem('Single-key shortcuts')}?.getAttribute('aria-checked')`), 'true');
    await page.press('Escape');
    assert.ok(await page.waitFor(`!document.querySelector('[role="menu"]') && document.activeElement?.hasAttribute('data-video-more')`, 10_000));

    await centre('[data-video-more]');
    assert.ok(await page.waitFor(menuItem('Read as text'), 10_000));
    await page.evaluate(`${menuItem('Read as text')}.click()`);
    assert.ok(await page.waitFor(`document.querySelector('[data-video-panel] [data-video-read]')`, 10_000));
    // While paused the words on screen are read, one scene at a time.
    assert.ok(
      await page.waitFor(`(() => {
        const text = document.querySelector('[data-video-read]')?.textContent ?? '';
        return text.includes('Hello motion') && text.includes('See you soon') && text.includes('Back next week');
      })()`, 30_000),
      await page.evaluate(`document.querySelector('[data-video-read]')?.innerText ?? 'no panel'`),
    );
    assert.equal(await page.evaluate(`document.querySelectorAll('[data-video-read-scene]').length`), 2);
    // Reading a scene draws it on the stage; the playhead's moment is shown again after.
    assert.ok(await page.waitFor(`document.querySelector('.headline')?.textContent === 'Hello motion'`, 10_000));
    // The panel takes the screen reader section's place, and its header has the touch Undo menu (hidden for a mouse).
    assert.equal(await page.evaluate(`document.querySelector('[data-video-scene-words]')`), null);
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-video-panel] [data-video-undo-menu]')).display`), 'none');

    const saveText = `[...document.querySelectorAll('[data-video-read] button')].find((button) => button.textContent.trim() === 'Save text')`;
    assert.ok(await page.waitFor(`${saveText} && !${saveText}.disabled`, 10_000));
    await page.evaluate(`${saveText}.click()`);
    const file = path.join(downloads, 'smoke-film.txt');
    assert.ok(await until(() => fs.existsSync(file), 10_000), 'smoke-film.txt should be saved');
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /^Smoke film\n\nIntro \(from 0:0+\)\nOpening card with headline and badge\.\nOn screen:\n- Hello motion\n/, text);
    assert.match(text, /Outro \(from 0:0?3\)\nClosing headline\.\nOn screen:\n- See you soon\n- Back next week\n/, text);

    await centre('[data-video-panel] button[aria-label="Close panel"]');
    assert.ok(await page.waitFor(`!document.querySelector('[data-video-panel]') && document.activeElement?.hasAttribute('data-video-more')`, 10_000));
    assert.ok(await page.waitFor(`document.querySelector('[data-video-scene-words]')`, 10_000));
  });

  it('runs a framed #view-inline page as live and read-only while the top-level page stays editable', { ...T, skip: browserSkip }, async () => {
    assert.equal(await page.evaluate(`document.documentElement.hasAttribute('data-display-inline')`), false);
    const inlineResult = await page.evaluate(`(async () => {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:400px;z-index:9999';
      frame.src = ${JSON.stringify(url + '#view-inline')};
      document.body.appendChild(frame);
      try {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const doc = frame.contentDocument;
          if (doc && doc.querySelector('[data-video-transport]')) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        const win = frame.contentWindow;
        const doc = frame.contentDocument;
        const user = await (await win.openartifact.use('user')).me();
        const db = await win.openartifact.use('db');
        let writeError = null;
        try {
          await db.write([{ op: 'update', path: 'film/meta', patch: { title: 'Blocked' } }]);
        } catch (err) {
          writeError = err?.code || String(err);
        }
        return {
          hasAttr: doc.documentElement.hasAttribute('data-display-inline'),
          role: user.role,
          writeError,
          commentsCap: await win.openartifact.use('comments'),
          agentCap: await win.openartifact.use('agent'),
          downloadsCap: await win.openartifact.use('downloads'),
          hasCommentsButton: !!doc.querySelector('button[aria-label="Comments"]'),
        };
      } finally {
        frame.remove();
      }
    })()`);
    assert.deepEqual(inlineResult, {
      hasAttr: true,
      role: 'viewer',
      writeError: 'not_granted',
      commentsCap: null,
      agentCap: null,
      downloadsCap: null,
      hasCommentsButton: false,
    });
    assert.equal(readDoc(root, 'film/meta').title, 'Smoke film');
    assert.deepEqual(page.problems.filter((p) => !p.includes('/favicon.ico')), []);
  });

  it('exports a playable HTML file with sound after the open editor loses its JavaScript files', { ...T, skip: browserSkip }, async () => {
    await page.evaluate(`document.querySelector('button[aria-label="Export"]').click()`);
    // Let the dialog finish its MP4 capability check, which uses a separate renderer.
    assert.ok(await page.waitFor(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog && !dialog.textContent.includes('Checking this browser');
    })()`, 10_000));
    await page.evaluate(`document.querySelector('[role="dialog"] button[aria-label="One HTML file that plays the animation offline"]').click()`);
    assert.ok(await page.waitFor(`document.querySelector('[role="dialog"] button[aria-label="One HTML file that plays the animation offline"][aria-pressed="true"]')`, 10_000));

    // A rebuild can replace the JavaScript files while this tab is still running the old editor.
    const scripts = fs.readdirSync(editorAssets).filter((name) => name.endsWith('.js'));
    const held = tmpDir('motion-editor-scripts');
    const moved = [];
    // Built files are kept for good: without this the browser could answer for the files a rebuild took away.
    await page.cdp('Network.setCacheDisabled', { cacheDisabled: true });
    try {
      for (const name of scripts) {
        fs.renameSync(path.join(editorAssets, name), path.join(held, name));
        moved.push(name);
      }
      // Toasts leave after a few seconds: keep what they said.
      await page.evaluate(`(() => {
        window.toastsSeen = [];
        new MutationObserver(() => {
          for (const card of document.querySelectorAll('[data-toast]')) if (!window.toastsSeen.includes(card.textContent)) window.toastsSeen.push(card.textContent);
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
      })()`);
      await page.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent.trim() === 'Export').click()`);
      // A saved export closes the dialog and says so in a toast; a failed one stays open.
      assert.ok(await page.waitFor(`(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const said = window.toastsSeen.some((text) => /^Exported (to .*\\/)?Smoke film\\.html/.test(text.trim()));
        return (said && !dialog) || dialog?.textContent.includes('Try again') || dialog?.textContent.includes('isn’t saved yet');
      })()`, 10_000), await page.evaluate(`JSON.stringify({
        dialog: document.querySelector('[role="dialog"]')?.innerText ?? null,
        toasts: window.toastsSeen,
      })`));
      const status = await page.evaluate(`document.querySelector('[role="dialog"]')?.innerText ?? 'closed'`);
      assert.equal(status, 'closed', status);

      const file = path.join(downloads, 'Smoke film.html');
      const player = await browser.load(pathToFileURL(file).href, {
        ready: `typeof window.filmAudio === 'function' && !!document.querySelector('iframe')`,
      });
      try {
        assert.ok(await player.waitFor(`document.querySelector('.headline')?.textContent === 'Hello motion'`, 10_000));
        assert.deepEqual(player.problems, []);
      } finally {
        await player.close();
      }
    } finally {
      for (const name of moved) fs.renameSync(path.join(held, name), path.join(editorAssets, name));
      await page.cdp('Network.setCacheDisabled', { cacheDisabled: false });
    }
  });

  it('asks for a reload when a rebuild took away a part the open editor had not loaded yet', { ...T, skip: browserSkip }, async () => {
    // The GIF and video exports load the frame painter on demand; a rebuild that ran first has deleted it.
    const painters = fs.readdirSync(editorAssets).filter((name) => /^_virtual_motion-raster-frame-.*\.js$/.test(name));
    assert.ok(painters.length > 0, 'the build has no frame painter chunk');
    const held = tmpDir('motion-editor-painter');
    const moved = [];
    let fresh = null;
    try {
      for (const name of painters) {
        fs.renameSync(path.join(editorAssets, name), path.join(held, name));
        moved.push(name);
      }
      // A page that never loaded the painter: not one whose browser holds it from an earlier tab (built files are kept for good).
      fresh = await browser.load(url, {
        cache: false,
        ready: `document.querySelector('[data-video-transport] button[aria-label="Play"], [data-video-transport] button[aria-label="Pause"]')`,
        ignore: [/raster-frame/, /dynamically imported module/i],
      });
      await fresh.evaluate(`document.querySelector('button[aria-label="Export"]').click()`);
      assert.ok(await fresh.waitFor(`document.querySelector('[role="dialog"]')`, 10_000));
      await fresh.evaluate(`document.querySelector('[role="dialog"] button[aria-label="A GIF: no sound, plays in a loop"]').click()`);
      assert.ok(await fresh.waitFor(`document.querySelector('[role="dialog"] button[aria-label="A GIF: no sound, plays in a loop"][aria-pressed="true"]')`, 10_000));
      await fresh.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent.trim() === 'Export').click()`);

      assert.ok(
        await fresh.waitFor(`document.querySelector('[role="dialog"]')?.textContent.includes('Reload the page, then export again')`, 10_000),
        await fresh.evaluate(`document.querySelector('[role="dialog"]')?.innerText ?? 'no dialog'`),
      );
      const buttons = await fresh.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].map((button) => button.textContent.trim())`);
      assert.ok(buttons.includes('Reload'), JSON.stringify(buttons));
      assert.ok(!buttons.includes('Try again'), JSON.stringify(buttons));
      assert.equal(
        await fresh.evaluate(`[...document.querySelectorAll('[data-tone="warning"]')].some((notice) => notice.textContent.includes('The editor was updated') && [...notice.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Reload'))`),
        true,
      );
    } finally {
      await fresh?.close();
      for (const name of moved) fs.renameSync(path.join(held, name), path.join(editorAssets, name));
    }
  });
});

// A clip of theirs: its own sound played under the film, its captions over it, and a figure that counts.
describe(`${TYPE} clips`, { skip: skip() || (browserSkip && 'no Chrome') }, () => {
  let run, root, url, browser, page;

  const PLAYING = `document.querySelector('[data-video-transport] button[aria-label="Play"], [data-video-transport] button[aria-label="Pause"]')`;
  const CLIP_SCENE = `kit.scene('clip', {
  init(kit) {
    this.v = kit.video('clip.webm', { from: 0.2, sound: true, captions: [{ at: 0.2, dur: 1.5, text: 'Said in the clip' }] });
    kit.stage.append(this.v);
    this.n = kit.h('<b class="fans-n">1,200</b>');
    kit.stage.append(this.n);
  },
  render(t) { kit.count(this.n, t, 0, 1); },
});`;

  before(async () => {
    const { dir } = install(typePath(TYPE), TYPE);
    const home = tmpDir('motion-clips-home');
    run = cli(dir, { HOME: home, OPEN_ARTIFACT_TYPE_SERVER_HOME: tmpDir('motion-clips-state'), OPEN_ARTIFACT_USER: 'E2E' });
    root = path.join(tmpDir('motion-clips-film'), 'film');
    const { url: publicUrl } = await run.json(['open', root, '--type', TYPE, '--title', 'Clip film', '--json']);
    url = new URL('index.html', publicUrl).href;
    // Sound starts without a click here, so the page's audio graph runs as it would after one.
    browser = await launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

    // A short WebM with a tone, recorded in the browser: the suite needs no ffmpeg.
    const maker = await browser.load('about:blank');
    const base64 = await maker.evaluate(`(async () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 160, height: 90 });
      const g = canvas.getContext('2d');
      const audio = new AudioContext();
      const tone = new OscillatorNode(audio, { frequency: 440 });
      const out = audio.createMediaStreamDestination();
      tone.connect(new GainNode(audio, { gain: 0.3 })).connect(out);
      tone.start();
      const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...out.stream.getAudioTracks()]);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
      const parts = [];
      recorder.ondataavailable = (e) => parts.push(e.data);
      let frame = 0;
      const draw = setInterval(() => { g.fillStyle = 'hsl(' + (frame++ * 7) % 360 + ' 60% 50%)'; g.fillRect(0, 0, 160, 90); }, 33);
      recorder.start();
      await new Promise((done) => setTimeout(done, 3000));
      const stopped = new Promise((done) => { recorder.onstop = done; });
      recorder.stop();
      await stopped;
      clearInterval(draw);
      await audio.close();
      const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(text);
    })()`, { timeout: 20_000 });
    await maker.close();
    const file = path.join(tmpDir('motion-clips-media'), 'clip.webm');
    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
    const uploaded = await run.run(['upload', root, file]);
    assert.equal(uploaded.code, 0, uploaded.stdout + uploaded.stderr);
    const [ref, mime] = uploaded.stdout.trim().split('\n')[0].split('\t');
    assert.match(ref, /^\/_blob\/[0-9a-f]{32}$/);
    assert.match(uploaded.stderr, /"note"/, 'the upload hint asks for the clip’s note');

    const scenes = { ...SCENES_JSON, fonts: {}, palettes: [], scenes: [{ id: 'clip', name: 'Clip', dur: 2, desc: 'A coloured clip with a tone.' }] };
    const writes = [
      { op: 'set', path: 'film/meta', data: { v: 1, title: 'Clip film', updatedAt: Date.now() } },
      { op: 'set', path: 'assets/clip.webm', data: { ref, mime: mime.split(';')[0], note: 'a test tone, 0–3 s' } },
      { op: 'set', path: 'modules/scenes.json', data: { kind: 'json', text: JSON.stringify(scenes) } },
      { op: 'set', path: 'modules/base.css', data: { kind: 'css', text: '.fans-n { position:absolute; left:40px; top:40px; font-size:64px }' } },
      { op: 'set', path: 'modules/scene-clip.js', data: { kind: 'js', text: CLIP_SCENE } },
      { op: 'set', path: 'film/script', data: { code: 'window.CUT = kit.scenes();' } },
    ];
    const wrote = await run.run(['write-db', root, JSON.stringify(writes)]);
    assert.equal(wrote.code, 0, wrote.stdout + wrote.stderr);
    page = await browser.load(url, { ready: PLAYING });
  });

  after(async () => {
    await browser?.close();
    await run?.run(['stop']).catch(() => {});
    removeTmp();
  });

  it('plays the clip’s own sound once unmuted, with its captions over the film', { ...T, skip: browserSkip }, async () => {
    // Note every sound the page starts from a decoded buffer: this film has no score, so only the clip's sound is one.
    await page.evaluate(`(() => {
      window.__started = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        window.__started.push(this.buffer ? this.buffer.duration : 0);
        return start.apply(this, args);
      };
    })()`);
    await page.evaluate(`document.querySelector('[data-video-transport] button[aria-label="Unmute"]')?.click()`);
    await page.evaluate(`document.querySelector('[data-video-transport] button[aria-label="Play"]')?.click()`);
    // From second 0.2 of a 3 s file to the end of a 2 s scene: one piece of about 2 s.
    assert.ok(
      await page.waitFor(`window.__started?.some((seconds) => seconds > 1.5 && seconds < 2.1)`, 20_000),
      JSON.stringify(await page.evaluate(`window.__started`)),
    );
    assert.ok(await page.waitFor(`document.body.innerText.includes('Said in the clip')`, 20_000), 'the clip’s caption is shown');
  });

  it('counts a figure up from half to the words in the markup', { ...T, skip: browserSkip }, async () => {
    await page.evaluate(`(() => {
      document.querySelector('[data-video-transport] button[aria-label="Pause"]')?.click();
      document.querySelector('[data-video-transport] button[aria-label="Back to start"]')?.click();
    })()`);
    assert.ok(await page.waitFor(`document.querySelector('.fans-n')?.textContent === '600'`, 10_000));
    await page.evaluate(`document.querySelector('[data-video-transport] button[aria-label="Play"]')?.click()`);
    assert.ok(await page.waitFor(`document.querySelector('.fans-n')?.textContent === '1,200'`, 10_000));
  });
});

// Video scenes by hand: trimming a scene's ends from the keyboard, splitting it at the playhead, removing a video
// added on the page, undoing each, and adding a video from a file to an empty film. The clip is made with ffmpeg; without it these are skipped.
const ffmpegSkip = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 ? false : 'no ffmpeg';

describe(`${TYPE} video scenes`, { skip: skip() || (browserSkip && 'no Chrome') || ffmpegSkip }, () => {
  let run, root, url, browser, page, clipFile;

  const READY = `document.querySelector('[data-video-transport] button[aria-label="Play"], [data-video-transport] button[aria-label="Pause"]')`;
  const UNDO = process.platform === 'darwin' ? { meta: true } : { ctrl: true };
  const clipScene = (id, from) => `const FROM = ${from};
kit.scene('${id}', {
  init(kit) {
    kit.stage.append(kit.video('clip.mp4', { sound: true, from: FROM, style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain' }));
  },
  render() {},
});
`;
  const moduleText = (id) => readDoc(root, `modules/scene-${id}.js`).text;
  const sceneList = () => JSON.parse(readDoc(root, 'modules/scenes.json').text).scenes.map(({ id, name, dur }) => ({ id, name, dur }));
  const blur = () => page.evaluate(`document.activeElement?.blur?.()`);
  const pressLetter = async (key) => {
    const code = `Key${key.toUpperCase()}`;
    await page.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0), text: key });
    await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) });
  };

  before(async () => {
    const { dir } = install(typePath(TYPE), TYPE);
    run = cli(dir, { HOME: tmpDir('motion-cut-home'), OPEN_ARTIFACT_TYPE_SERVER_HOME: tmpDir('motion-cut-state'), OPEN_ARTIFACT_USER: 'E2E' });
    clipFile = path.join(tmpDir('motion-cut-media'), 'clip.mp4');
    const made = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440',
      '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', '-y', clipFile], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);

    root = path.join(tmpDir('motion-cut-film'), 'film');
    const { url: publicUrl } = await run.json(['open', root, '--type', TYPE, '--title', 'Cut film', '--json']);
    url = new URL('index.html', publicUrl).href;
    const uploaded = await run.run(['upload', root, clipFile]);
    assert.equal(uploaded.code, 0, uploaded.stdout + uploaded.stderr);
    const [ref] = uploaded.stdout.trim().split('\n')[0].split('\t');
    const scenes = { ...SCENES_JSON, fonts: {}, palettes: [], scenes: [
      { id: 'a', name: 'First', dur: 2, desc: 'The clip from second 1.' },
      { id: 'b', name: 'Second', dur: 2, desc: 'The clip from second 3.' },
    ] };
    const writes = [
      { op: 'set', path: 'film/meta', data: { v: 1, title: 'Cut film', updatedAt: Date.now() } },
      { op: 'set', path: 'assets/clip.mp4', data: { ref, mime: 'video/mp4', w: 320, h: 180, note: 'a test pattern, 0–6 s' } },
      { op: 'set', path: 'modules/scenes.json', data: { kind: 'json', text: JSON.stringify(scenes) } },
      { op: 'set', path: 'modules/scene-a.js', data: { kind: 'js', text: clipScene('a', 1) } },
      { op: 'set', path: 'modules/scene-b.js', data: { kind: 'js', text: clipScene('b', 3) } },
      { op: 'set', path: 'film/script', data: { code: 'window.CUT = kit.scenes();' } },
    ];
    const wrote = await run.run(['write-db', root, JSON.stringify(writes)]);
    assert.equal(wrote.code, 0, wrote.stdout + wrote.stderr);
    browser = await launch();
    page = await browser.load(url, { ready: READY });
  });

  after(async () => {
    await browser?.close();
    await run?.run(['stop']).catch(() => {});
    removeTmp();
  });

  it('trims a video scene’s start from the keyboard, changing only FROM and the length, and undoes it byte for byte', { ...T, skip: browserSkip }, async () => {
    const was = moduleText('a');
    const scenesWas = readDoc(root, 'modules/scenes.json').text;
    const START = `[data-trim="start"][aria-label^="Start of First"]`;
    assert.ok(await page.waitFor(`document.querySelector('${START}')`, 20_000), 'the first scene has trim handles');
    assert.ok(await page.waitFor(`document.querySelectorAll('[data-trim]').length === 4`, 10_000), 'both video scenes have two ends');
    await page.evaluate(`document.querySelector('${START}').focus()`);
    await page.press('ArrowRight');
    assert.ok(await until(() => moduleText('a') !== was, 10_000));
    assert.equal(moduleText('a'), was.replace('const FROM = 1;', 'const FROM = 1.1;'));
    assert.deepEqual(sceneList()[0], { id: 'a', name: 'First', dur: 1.9 });
    assert.equal(moduleText('b'), clipScene('b', 3), 'the other scene is left alone');

    await blur();
    await page.press('z', UNDO);
    assert.ok(await until(() => moduleText('a') === was, 10_000));
    assert.equal(readDoc(root, 'modules/scenes.json').text, scenesWas);
  });

  it('splits a video scene at the playhead into two of the same name, and undoes the split', { ...T, skip: browserSkip }, async () => {
    const scenesWas = readDoc(root, 'modules/scenes.json').text;
    // The playhead a second in: a quarter of the way along the 4 s film.
    const bar = await page.evaluate(`(() => { const r = document.querySelector('[role="slider"][aria-label="Playhead"]').getBoundingClientRect(); return { x: r.x + r.width / 4, y: r.y + r.height / 2 }; })()`);
    await page.click(bar.x, bar.y);
    assert.ok(await page.waitFor(`document.querySelector('[role="slider"][aria-label="Playhead"]')?.getAttribute('aria-valuenow') > 0.8 && document.querySelector('[role="slider"][aria-label="Playhead"]').getAttribute('aria-valuenow') < 1.2`, 5_000), 'the playhead is a second in');
    await page.evaluate(`document.querySelector('[data-trim="end"][aria-label^="End of First"]').focus()`);
    await pressLetter('s');
    const split = await until(() => fs.existsSync(docPath(root, 'modules/scene-a-2.js')), 10_000);
    assert.ok(split, await page.evaluate(`JSON.stringify({ focus: document.activeElement?.getAttribute('aria-label'), said: [...document.querySelectorAll('[aria-live], [role=status], [data-sonner-toast], li')].map((e) => e.textContent).filter(Boolean).slice(-6), time: document.querySelector('[data-video-transport]')?.textContent })`));
    assert.deepEqual(sceneList(), [
      { id: 'a', name: 'First', dur: 1 },
      { id: 'a-2', name: 'First', dur: 1 },
      { id: 'b', name: 'Second', dur: 2 },
    ]);
    assert.match(moduleText('a-2'), /^const FROM = 2;\n/);
    assert.match(moduleText('a-2'), /kit\.scene\('a-2'/);
    assert.equal(moduleText('a'), clipScene('a', 1));

    await blur();
    await page.press('z', UNDO);
    assert.ok(await until(() => !fs.existsSync(docPath(root, 'modules/scene-a-2.js')), 10_000));
    assert.equal(readDoc(root, 'modules/scenes.json').text, scenesWas);
  });

  it('removes a video added on the page from its scene’s menu, and undo puts it back', { ...T, skip: browserSkip }, async () => {
    // A scene as the page writes it when a video is added, with its own file.
    const ID = 'video-aaaaaa';
    const added = `const FROM = 0;
kit.scene("${ID}", {
  init(kit) {
    kit.stage.append(kit.video("${ID}.mp4", { sound: true, from: FROM, style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain' }));
  },
  render() {},
});
`;
    const scenes = JSON.parse(readDoc(root, 'modules/scenes.json').text);
    scenes.scenes.splice(1, 0, { id: ID, name: 'Video', dur: 2 });
    const asset = { ...readDoc(root, 'assets/clip.mp4') };
    delete asset.note;
    const wrote = await run.run(['write-db', root, JSON.stringify([
      { op: 'set', path: `assets/${ID}.mp4`, data: asset },
      { op: 'set', path: `modules/scene-${ID}.js`, data: { kind: 'js', text: added } },
      { op: 'set', path: 'modules/scenes.json', data: { kind: 'json', text: JSON.stringify(scenes) } },
    ])]);
    assert.equal(wrote.code, 0, wrote.stdout + wrote.stderr);
    const scenesWas = readDoc(root, 'modules/scenes.json').text;
    const assetWas = readDoc(root, `assets/${ID}.mp4`);

    const OPTIONS = `document.querySelector('button[aria-label="Video, scene 2, scene options"]')`;
    assert.ok(await page.waitFor(OPTIONS, 20_000), 'the added scene is on the timeline');
    // Its module can land a moment after scenes.json: the trim handles show the page has read it.
    assert.ok(await page.waitFor(`document.querySelector('[data-trim="start"][aria-label^="Start of Video"]')`, 10_000), 'the page has read the scene’s module');
    const center = (expression) => page.evaluate(`(() => { const r = ${expression}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const ITEM = (label) => `[...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.trim() === '${label}')`;
    const optionsOf = async (expression) => {
      const at = await center(expression);
      await page.click(at.x, at.y);
      assert.ok(await page.waitFor(ITEM('Add video after this scene'), 10_000), 'the scene’s menu is open');
    };
    // A scene made by hand has no Remove video.
    await optionsOf(`document.querySelector('button[aria-label="First, scene 1, scene options"]')`);
    assert.equal(await page.evaluate(`Boolean(${ITEM('Remove video')})`), false);
    await page.press('Escape');
    assert.ok(await page.waitFor(`!document.querySelector('[role="menu"]')`, 5_000));

    await optionsOf(OPTIONS);
    const offered = await page.waitFor(ITEM('Remove video'), 10_000);
    assert.ok(offered, await page.evaluate(`JSON.stringify([...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent.trim()))`));
    const remove = await center(ITEM('Remove video'));
    await page.click(remove.x, remove.y);
    assert.ok(await until(() => !fs.existsSync(docPath(root, `modules/scene-${ID}.js`)), 10_000), 'its module is gone');
    assert.ok(await until(() => !fs.existsSync(docPath(root, `assets/${ID}.mp4`)), 10_000), 'its file is gone: nothing else plays it');
    assert.deepEqual(sceneList().map(({ id }) => id), ['a', 'b']);
    assert.ok(fs.existsSync(docPath(root, 'assets/clip.mp4')), 'the other scenes’ file stays');

    await blur();
    await page.press('z', UNDO);
    assert.ok(await until(() => fs.existsSync(docPath(root, `modules/scene-${ID}.js`)), 10_000), 'undo puts it back');
    assert.ok(await until(() => fs.existsSync(docPath(root, `assets/${ID}.mp4`)), 10_000));
    assert.ok(await until(() => readDoc(root, 'modules/scenes.json').text === scenesWas, 10_000), 'back in its place');
    assert.equal(moduleText(ID), added);
    assert.deepEqual(readDoc(root, `assets/${ID}.mp4`), assetWas);
  });

  it('adds a chosen part of a video file to an empty film as a scene of its own', { ...T, timeout: 180_000, skip: browserSkip }, async (t) => {
    const blank = path.join(tmpDir('motion-cut-blank'), 'film');
    const { url: blankUrl } = await run.json(['open', blank, '--type', TYPE, '--title', 'Blank film', '--json']);
    const other = await browser.load(new URL('index.html', blankUrl).href, { ready: READY });
    try {
      const ADD = `document.querySelector('[data-video-transport] button[aria-label="Add video"]')`;
      assert.ok(await other.waitFor(ADD, 20_000), 'an empty film offers Add video on the toolbar');
      await other.evaluate(`${ADD}.click()`);
      assert.ok(await other.waitFor(`document.querySelector('[role="dialog"] input[type="file"]')`, 10_000));
      const { root: doc } = await other.cdp('DOM.getDocument', { depth: 0 });
      const { nodeId } = await other.cdp('DOM.querySelector', { nodeId: doc.nodeId, selector: '[role="dialog"] input[type="file"]' });
      await other.cdp('DOM.setFileInputFiles', { nodeId, files: [clipFile] });
      const ADD_BUTTON = `[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === 'Add')`;
      assert.ok(await other.waitFor(`${ADD_BUTTON} && !${ADD_BUTTON}.disabled`, 20_000), 'the file is read and its part can be chosen');
      assert.equal(await other.evaluate(`document.querySelectorAll('[role="dialog"] [role="slider"]').length`), 2);
      await other.evaluate(`${ADD_BUTTON}.click()`);
      const OUTCOME = `(() => { const text = document.querySelector('[role="dialog"]')?.textContent ?? ''; return text.includes('Your video is in') ? 'added' : text.includes('can’t prepare videos') ? 'no-encoder' : text.includes('Try again') ? text : ''; })()`;
      await other.waitFor(OUTCOME, 120_000);
      const outcome = await other.evaluate(OUTCOME);
      if (outcome === 'no-encoder') return t.skip('this Chrome has no H.264 encoder');
      assert.equal(outcome, 'added');
      assert.ok(await until(() => fs.existsSync(docPath(blank, 'modules/scenes.json')), 10_000), 'the scene is saved');
      const scenes = JSON.parse(readDoc(blank, 'modules/scenes.json').text).scenes;
      assert.equal(scenes.length, 1);
      assert.match(scenes[0].id, /^video-[a-z0-9]{6}$/);
      assert.ok(Math.abs(scenes[0].dur - 6) < 0.05, `the whole six seconds fit: ${scenes[0].dur}`);
      const asset = readDoc(blank, `assets/${scenes[0].id}.mp4`);
      assert.equal(asset.mime, 'video/mp4');
      assert.match(asset.ref, /^\/_blob\/[0-9a-f]{32}$/);
      assert.match(readDoc(blank, `modules/scene-${scenes[0].id}.js`).text, /^const FROM = 0;\n/);
      assert.equal(readDoc(blank, 'film/script').code, 'window.CUT = kit.scenes();');
      const checked = await run.run(['check', blank, '--json']);
      assert.equal(checked.json.findings.filter((f) => f.level === 'error').length, 0, JSON.stringify(checked.json.findings));
    } finally {
      await other.close();
    }
  });
});
