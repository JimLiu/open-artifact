/**
 * The slides demo's part in its replay. The replay's page area is narrower than the window the Slides editor shows
 * its slide rail in, so the page shows one slide at a time: a deck growing there would be a page number counting up
 * behind the cover. So the replay does what a person watching an agent write a deck does in the product, through the
 * editor's own controls:
 *
 * - closes the properties panel (its toolbar button), which leaves the slide the whole page area;
 * - follows the agent (People here › Follow Agent), so each slide shows as the agent writes it;
 * - once the deck is written, stops following (the banner's own button) and goes back to the slide the comment is
 *   on, by that slide's link (`#slide-~<id>`, which the editor follows on a `hashchange`);
 * - once the agent has answered the comment, takes the focus off the element it changed.
 *
 * All of it is best effort: with a control missing, the replay plays on the cover, which is the slide the comment is
 * on anyway.
 */

import { sleep } from '../../provider/events.ts';
import type { ReplayHooks } from '../replay.ts';

/** The Shell's frame with the editor in it. */
const frame = (): Window | null => document.querySelector<HTMLIFrameElement>('iframe[name=open-artifact-shell]')?.contentWindow ?? null;
/** The editor's document once the editor has drawn itself. */
const editor = (): Document | null => {
  const doc = frame()?.document;
  return doc?.querySelector('[data-open-artifact-presence], [data-open-artifact-mode]') ? doc : null;
};

/** Where the editor remembers which panels are open (`packages/slides-editor/src/state/view.ts`). */
const PREFS_KEY = 'open-artifact-slides:view';
const TRIES_MS = 30000;

/** Calls `act` until it says it is done (or for `ms` at most). */
function until(act: () => boolean, ms = TRIES_MS): void {
  const end = Date.now() + ms;
  const tick = (): void => {
    let done = false;
    try {
      done = act();
    } catch {
      // A frame between two documents: try again.
    }
    if (!done && Date.now() < end) setTimeout(tick, 100);
  };
  tick();
}

/** Closes the properties panel, for this visit only: what the editor remembers stays as the person left it. */
function closeProperties(): void {
  until(() => {
    const button = editor()?.querySelector<HTMLButtonElement>('button[aria-label="Properties"][aria-pressed]');
    if (!button || button.disabled) return false;
    if (button.getAttribute('aria-pressed') !== 'true') return true;
    let kept: string | null = null;
    try {
      kept = localStorage.getItem(PREFS_KEY);
    } catch {
      // No storage: nothing to keep.
    }
    button.click();
    try {
      if (kept === null) localStorage.removeItem(PREFS_KEY);
      else localStorage.setItem(PREFS_KEY, kept);
    } catch {
      // No storage.
    }
    return true;
  });
}

/**
 * Follows the agent: the menu behind the editor's "People here" button, then its "Follow <agent>" item. The item is a
 * switch, and a menu takes no choice in its first moments open: so the item is clicked a little after it shows, and
 * again only while the menu is still open (a choice closes it).
 */
function followAgent(): void {
  let openedAt = 0;
  let chosenAt = 0;
  let closedAt = 0;
  until(() => {
    const doc = editor();
    const button = doc?.querySelector<HTMLButtonElement>('button[aria-label="People here and following"]');
    if (!doc || !button) return written;
    // An item's text is its label and its description run together: "Follow AgentYour view follows…", "Follow meEveryone…".
    const item = [...doc.querySelectorAll<HTMLElement>('[role=menuitem]')].find((node) => /^Follow (?!me(?![a-z]))/.test(node.textContent?.trim() ?? ''));
    const now = Date.now();
    if (written) {
      // The deck is written already (a skipped replay): nothing left to follow, and no menu left open.
      if (item) {
        if (now - closedAt > 600) {
          closedAt = now;
          button.click();
        }
        return false;
      }
      // A closed menu hands the focus back to its button, which would keep the button's tooltip up.
      if (doc.activeElement === button) button.blur();
      return true;
    }
    if (!item) {
      if (chosenAt) {
        // The menu handed the focus back to its button, which would keep the button's tooltip up.
        (doc.activeElement as HTMLElement | null)?.blur();
        return true;
      }
      if (now - openedAt > 2000) {
        button.click();
        openedAt = now;
      }
      return false;
    }
    // Its first cell holds a check mark while the agent is followed already: then the menu only closes.
    if (item.firstElementChild?.querySelector('svg')) {
      chosenAt = now;
      button.click();
    } else if (now - openedAt > 700 && now - chosenAt > 400) {
      chosenAt = now;
      item.click();
    }
    return false;
  });
}

/** Stops following, by the button on the "Following Agent" banner: the slide is the person's again. */
function stopFollowing(): void {
  editor()?.querySelector<HTMLButtonElement>('button[aria-label="Stop following"]')?.click();
}

/** Shows slide `id`, once the editor is there. */
function show(id: string): void {
  until(() => {
    const target = frame();
    if (!target || !editor()) return false;
    const hash = `#slide-~${id}`;
    if (target.location.hash !== hash) target.location.hash = hash;
    return true;
  });
}

/** The slide a thread's anchor names (`{"slide": "<id>", …}`). */
function slideOf(anchor: string): string | null {
  try {
    const slide = (JSON.parse(anchor) as { slide?: unknown }).slide;
    return typeof slide === 'string' ? slide : null;
  } catch {
    return null;
  }
}

const demo = window.__PLAYGROUND__;
const commented = demo?.seed.replay ? slideOf(demo.seed.replay.comment.anchor) : null;
/** The deck is written: the build's steps have all landed. */
let written = false;
// Before the page shows: a panel closing over a deck being written would move the slide.
closeProperties();
followAgent();

/**
 * Takes the focus off the slide, for a moment after the page moved by itself. The editor lands the focus on the slide
 * it was sent to and on the element the agent changed: the focus ring would stay around the title until the person's
 * first click.
 */
function rest(ms = 1500): void {
  until(() => {
    const active = editor()?.activeElement as HTMLElement | null;
    if (active?.closest('[data-open-artifact-mode]')) active.blur();
    return false;
  }, ms);
}

/** Once the agent has answered the comment: the focus off the slide again. */
function restAfterAnswer(): void {
  let asked = false;
  const off = demo?.agent.statusChanges.on((status) => {
    if (status.busy) asked = true;
    if (status.busy || !asked) return;
    off?.();
    rest();
  });
}

const hooks: ReplayHooks = {
  build() {
    // Then the page is the person's again, on the slide they are about to comment on.
    return () => {
      written = true;
      try {
        stopFollowing();
      } catch {
        // A frame between two documents: the banner stays, which harms nothing.
      }
      if (commented) show(commented);
      rest();
    };
  },
  async comment() {
    if (commented) show(commented);
    restAfterAnswer();
    // A moment for the slide to draw before the pointer sets off.
    await sleep(250);
    return {};
  },
};

export default hooks;
