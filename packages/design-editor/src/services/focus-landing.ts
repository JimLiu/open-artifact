/**
 * Puts focus on a nearby landmark (`[data-focus-landing]`, the first one
 * shown) when it fell to the body after a control went away. See
 * lib/focus-landing.ts for when.
 */

import { LANDING_RETRY_MS, landingDone, shouldLandFocus, type LandingState } from '../lib/focus-landing.ts';

/** Call as a focused control is about to go away. */
export function landFocusAfterDismiss(): void {
  if (typeof document === 'undefined') return;
  const since = performance.now();
  let interacted = false;
  let tries = 0;
  const onInput = () => {
    interacted = true;
  };
  window.addEventListener('pointerdown', onInput, true);
  window.addEventListener('keydown', onInput, true);
  const stop = () => {
    clearInterval(timer);
    window.removeEventListener('pointerdown', onInput, true);
    window.removeEventListener('keydown', onInput, true);
  };
  const check = () => {
    tries += 1;
    const active = document.activeElement;
    const state: LandingState = { since, now: performance.now(), onBody: !active || active === document.body, interacted };
    if (shouldLandFocus(state)) {
      const target = [...document.querySelectorAll<HTMLElement>('[data-focus-landing]')].find((el) => el.getClientRects().length > 0);
      if (target) {
        // A visible focus ring shows where the keyboard is now.
        target.focus({ focusVisible: true } as FocusOptions);
        stop();
        return;
      }
    }
    if (landingDone(state, tries)) stop();
  };
  const timer = setInterval(check, LANDING_RETRY_MS);
}
