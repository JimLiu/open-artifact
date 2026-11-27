/**
 * Says a select's new value while its trigger has the focus: a quiet
 * (`polite`) live region made when the trigger is focused, in the nearest
 * dialog or else the page body, in the page's language. A new value is
 * written into it when it changes under the focus, or when the focus comes
 * back to the trigger after a pick from the list. It goes when the trigger
 * loses the focus; when the trigger is disabled as it loses it, at the next
 * focus anywhere, so the last word is still read.
 */

/** The parts of the live region the announcer makes and fills. */
export interface AnnounceRegion {
  setAttribute(name: string, value: string): void;
  remove(): void;
  textContent: string | null;
}

/** Where the region goes: a dialog or the page body. */
export interface AnnounceHost<R extends AnnounceRegion> {
  appendChild(node: R): unknown;
}

/** The parts of a document the announcer uses; it makes regions of type `R`. */
export interface AnnounceDocument<R extends AnnounceRegion> {
  createElement(tag: 'span'): R;
  body: AnnounceHost<R> | null;
  documentElement: { lang: string };
  addEventListener(type: 'focusin', listener: () => void, options: { once: true; capture: true }): void;
}

/** The parts of a select trigger the announcer uses (an `HTMLElement` has them, with `HTMLSpanElement` regions). */
export interface AnnounceTrigger<R extends AnnounceRegion> {
  ownerDocument: AnnounceDocument<R>;
  closest(selector: string): AnnounceHost<R> | null;
  matches(selector: string): boolean;
}

/** Visually hidden, still read (inline, so no style sheet has to carry it). */
export const VISUALLY_HIDDEN = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';

export interface SelectAnnouncer<R extends AnnounceRegion> {
  /** The trigger got the focus, showing `label`. */
  focus(trigger: AnnounceTrigger<R>, label: string): void;
  /** The value now shows `label`; said when the trigger has the focus. */
  change(label: string): void;
  /** The trigger lost the focus. */
  blur(trigger: AnnounceTrigger<R>): void;
  /** The select went away. */
  dispose(): void;
}

export function createSelectAnnouncer<R extends AnnounceRegion>(): SelectAnnouncer<R> {
  let region: R | null = null;
  let focused = false;
  /** The label shown when the trigger last lost the focus. */
  let left: string | null = null;
  let shown: string | null = null;
  const say = (label: string) => {
    if (region) region.textContent = label;
  };
  const drop = () => {
    region?.remove();
    region = null;
  };
  return {
    focus(trigger, label) {
      focused = true;
      shown = label;
      if (!region) {
        const doc = trigger.ownerDocument;
        region = doc.createElement('span');
        region.setAttribute('aria-live', 'polite');
        region.setAttribute('aria-atomic', 'true');
        region.setAttribute('style', VISUALLY_HIDDEN);
        if (doc.documentElement.lang) region.setAttribute('lang', doc.documentElement.lang);
        const host = trigger.closest('[role="dialog"], [role="alertdialog"]') ?? doc.body;
        host?.appendChild(region);
      }
      // Back from a pick in the list: say what was picked.
      if (left !== null && left !== label) say(label);
      left = null;
    },
    change(label) {
      if (label === shown) return;
      shown = label;
      if (focused) say(label);
    },
    blur(trigger) {
      focused = false;
      left = shown;
      if (trigger.matches('[disabled], [data-disabled]')) {
        const current = region;
        trigger.ownerDocument.addEventListener(
          'focusin',
          () => {
            if (region === current && !focused) drop();
          },
          { once: true, capture: true },
        );
        return;
      }
      drop();
    },
    dispose() {
      focused = false;
      drop();
    },
  };
}
