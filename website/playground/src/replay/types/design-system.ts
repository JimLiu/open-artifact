/**
 * The design-system demo's part in its replay. A design system is one long page (the brand book, then colors, type,
 * the scales, the components), and the replay's page area shows a screen of it at a time: left at the top, the
 * components would land out of sight and the token the person comments on would be far below. So the replay scrolls
 * the page as someone watching an agent write a system would:
 *
 * - down to each component as its preview lands, so the cards show one after the other;
 * - back to the top when the cover lands;
 * - to the token the comment is on before the pointer sets off, with its color group at the top of the page, so the
 *   colors that follow it are in view when the agent answers. The comment's `at` is that token's place then.
 *
 * All of it is best effort: with an element missing, the page stays where it is and the script's own `at` is used.
 */

import { sleep } from '../../provider/events.ts';
import type { ReplayHooks } from '../replay.ts';

/** The editor's document, in the Shell's frame. */
const editor = (): Document | null => document.querySelector<HTMLIFrameElement>('iframe[name=open-artifact-shell]')?.contentDocument ?? null;
/** The editor's scroller, once the system's sections are drawn. */
const scroller = (): HTMLElement | null => {
  const main = editor()?.querySelector<HTMLElement>('main');
  return main?.querySelector('[data-system-section]') ? main : null;
};
/** A skip is on: everything lands at once, and nothing is worth following. */
const skipping = (): boolean => document.querySelector('.pg-replay')?.hasAttribute('data-fast') ?? false;

/** `find()`'s element once it is there (or null after `ms`). */
async function waitFor<T>(find: () => T | null | undefined, ms: number): Promise<T | null> {
  for (let waited = 0; ; waited += 50) {
    let found: T | null | undefined = null;
    try {
      found = find();
    } catch {
      // A frame between two documents: try again.
    }
    if (found) return found;
    if (waited >= ms) return null;
    await sleep(50);
  }
}

/** Scrolls the page so `element`'s top stands `offset` px under the scroller's. */
function scrollTo(element: Element, offset: number, smooth: boolean): void {
  const main = scroller();
  if (!main) return;
  const top = main.scrollTop + element.getBoundingClientRect().top - main.getBoundingClientRect().top - offset;
  main.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
}

/** Waits until the page has stopped scrolling (or `ms` went by). */
async function settled(ms: number): Promise<void> {
  let last = -1;
  let still = 0;
  for (let waited = 0; waited < ms && still < 3; waited += 60) {
    const top = scroller()?.scrollTop ?? 0;
    still = top === last ? still + 1 : 0;
    last = top;
    await sleep(60);
  }
}

const demo = window.__PLAYGROUND__;
// While the agent builds: follow what it writes.
demo?.store.files.on((event) => {
  if (event.author !== 'agent' || skipping()) return;
  const paths = Object.keys(event.changes);
  const preview = paths.map((path) => /^project\/components\/([^/]+)\/preview\.html$/.exec(path)?.[1]).find(Boolean);
  if (!preview) return;
  if (preview === 'Cover') {
    scroller()?.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  void waitFor(() => editor()?.getElementById(`ds-component-${preview}`), 1500).then((card) => {
    if (card && !skipping()) scrollTo(card, 16, true);
  });
});

/** The row of the item a thread's anchor names (`{"kind": "token", "name": "accent", …}`). */
function rowOf(anchor: string): HTMLElement | null {
  let wanted: { kind?: unknown; name?: unknown };
  try {
    wanted = JSON.parse(anchor) as typeof wanted;
  } catch {
    return null;
  }
  for (const row of editor()?.querySelectorAll<HTMLElement>('[data-comment-item]') ?? []) {
    try {
      const item = JSON.parse(row.dataset.commentItem ?? '') as typeof wanted;
      if (item.kind === wanted.kind && item.name === wanted.name) return row;
    } catch {
      // Not an anchor.
    }
  }
  return null;
}

const hooks: ReplayHooks = {
  async comment(_demo, script) {
    const row = await waitFor(() => rowOf(script.comment.anchor), skipping() ? 1500 : 4000);
    const page = document.querySelector<HTMLElement>('.pg-page');
    const frame = document.querySelector<HTMLIFrameElement>('iframe[name=open-artifact-shell]');
    if (!row || !page || !frame) return {};
    // The token's group under the table's sticky header: the token first, the colors named after it below.
    const smooth = !skipping();
    scrollTo(row.closest('section') ?? row, 44, smooth);
    if (smooth) await settled(1500);
    const box = page.getBoundingClientRect();
    const origin = frame.getBoundingClientRect();
    const name = (row.querySelector('.font-mono') ?? row).getBoundingClientRect();
    const x = origin.left + name.left + Math.min(name.width, 120) / 2 - box.left;
    const y = origin.top + name.top + name.height / 2 - box.top;
    if (!(box.width > 0 && box.height > 0) || x < 0 || y < 0 || x > box.width || y > box.height) return {};
    return { at: [x / box.width, y / box.height] };
  },
};

export default hooks;
