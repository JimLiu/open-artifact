/**
 * How a test edits each of Docs, Sheets, Slides and Whiteboard in the app's tab, and checks the edit on disk and on
 * screen again (the offline matrix and the packaged app's checks share it). The window is never shown, so there is no
 * real mouse or keyboard: the page's own events, and text an input method commits (`Page.type`).
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { until } from './env.mjs';

/** The word each edit writes. */
export const WORD = 'Ferry';

/** The text of every file under `dir`. */
export function treeText(dir) {
  let text = '';
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    text += statSync(path).isDirectory() ? treeText(path) : readFileSync(path, 'utf8');
  }
  return text;
}


const keyIn = (key) => `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', code: '${key}', keyCode: ${key === 'Enter' ? 13 : 27}, bubbles: true, cancelable: true })), true`;

/**
 * Each type: the editor's frame, how it is drawn, how it is edited (in a window that is never shown, so no real mouse
 * or keys: the page's own events and text an input method commits), where the edit lands, how it shows again, and
 * the export row that is checked.
 */
export const TYPES = {
  docs: {
    drawn: "!!document.querySelector('.doc-text p')",
    async edit(view, frame) {
      await view.inFrame(frame, `(() => { const p = document.querySelector('.doc-text p'); const root = p.closest('[contenteditable]'); root.focus(); const s = getSelection(); s.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); s.addRange(r); return true; })()`);
      await view.type(`${WORD} timetable`);
    },
    onDisk: (root) => treeText(join(root, 'doc')).includes(WORD),
    shown: `document.querySelector('.doc-text')?.innerText.includes(${JSON.stringify(WORD)})`,
    export: { row: 'Markdown (.md)', ext: '.md', check: (bytes) => bytes.toString('utf8').includes(WORD) },
  },
  sheets: {
    drawn: `!!document.querySelector('textarea[aria-label="Formula bar"]') && !!document.querySelector('[role=gridcell]')`,
    async edit(view, frame) {
      await view.inFrame(frame, `document.querySelector('textarea[aria-label="Formula bar"]').focus(), true`);
      await view.type(WORD);
      await view.inFrame(frame, keyIn('Enter'));
    },
    onDisk: (root) => treeText(join(root, 'sheet')).includes(WORD),
    shown: `[...document.querySelectorAll('[role=gridcell]')].some((c) => c.textContent.trim() === ${JSON.stringify(WORD)})`,
    share: 'Share',
    export: { row: 'CSV', ext: '.csv', check: (bytes) => bytes.toString('utf8').includes(WORD) },
  },
  slides: {
    drawn: `!![...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Add slide' || b.textContent.trim() === 'Add slide')`,
    async edit(view, frame) {
      await view.inFrame(frame, `[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Add slide' || b.textContent.trim() === 'Add slide').click(), true`);
      // Add slide adds a blank slide at once (no layout to pick).
    },
    onDisk: (root) => {
      try {
        const order = JSON.parse(readFileSync(join(root, 'project', 'deck.json'), 'utf8')).order ?? [];
        return order.length === 1 && existsSync(join(root, 'project', 'slides', `${order[0]}.html`));
      } catch {
        return false;
      }
    },
    shown: `document.querySelectorAll('[data-open-artifact-thumbs] [data-slide-index]').length === 1`,
    // Slides' save state now and then stays "saving" after Add slide, though the slide is written and nothing more is
    // sent (it happens with the network too, in about one add of five to ten): the files on disk are what is waited for.
    savedMayStick: true,
    export: { row: 'PowerPoint · PowerPoint, basic fonts', ext: '.pptx', check: (bytes) => bytes.subarray(0, 2).toString() === 'PK' },
  },
  whiteboard: {
    drawn: "!!document.querySelector('.wb-elements') && !!document.querySelector('.wb-surface')",
    async edit(view, frame) {
      // The board lays itself out after it draws: an empty spot is waited for.
      let spot = null;
      await until(async () => (spot = await view.inFrame(
        frame,
        `(() => { const s = []; for (let y = 140; y < innerHeight - 140; y += 40) for (let x = 60; x < innerWidth - 60; x += 40) s.push([x, y]);
          s.sort((a, b) => Math.hypot(a[0] - innerWidth / 2, a[1] - innerHeight / 2) - Math.hypot(b[0] - innerWidth / 2, b[1] - innerHeight / 2));
          for (const [x, y] of s) if (document.elementFromPoint(x, y)?.matches('.wb-surface')) return [x, y]; return null; })()`,
      ).catch(() => null)), 15_000, 200);
      assert.ok(spot, 'no empty spot on the board');
      await view.inFrame(frame, `document.elementFromPoint(${spot[0]}, ${spot[1]}).dispatchEvent(new MouseEvent('contextmenu', { clientX: ${spot[0]}, clientY: ${spot[1]}, bubbles: true, cancelable: true, button: 2 })), true`);
      const item = "[...document.querySelectorAll('[role=menuitem]')].find((e) => e.textContent.trim().startsWith('Add a note here'))";
      assert.ok(await view.waitInFrame(frame, `!!${item}`, 5000), 'no "Add a note here"');
      await view.inFrame(frame, `${item}.click(), true`);
      assert.ok(await view.waitInFrame(frame, `document.querySelectorAll('.wb-elements [data-wb-id]').length === 1 && document.activeElement?.isContentEditable`, 5000), 'the note was not added');
      await view.type(WORD);
      await view.inFrame(frame, keyIn('Escape'));
    },
    onDisk: (root) => treeText(join(root, 'db')).includes(WORD),
    shown: `document.querySelector('.wb-elements')?.innerText.includes(${JSON.stringify(WORD)})`,
    export: { row: 'PNG image', ext: '.png', check: (bytes) => bytes.subarray(1, 4).toString() === 'PNG' },
  },
};

/** A view's frame of `type`'s editor. */
export const editorFrame = (type) => (url) => new RegExp(`/${type}/[0-9a-f]+/`).test(url);
