/**
 * When a control that had focus goes away (a banner closed by its own
 * button), focus falls to the page body and the keyboard loses its place.
 * For a short while afterwards, unless the person has clicked or pressed a
 * key since, focus is put on a nearby landmark instead.
 */

/** How long after the dismissal focus is still put back. */
export const LANDING_WINDOW_MS = 5000;
/** How often to look whether focus fell to the body. */
export const LANDING_RETRY_MS = 200;
/** How many times to look. */
export const LANDING_TRIES = 15;

/** What a landing check sees. */
export interface LandingState {
  /** When the control went away. */
  since: number;
  now: number;
  /** Focus is on the body (or nowhere). */
  onBody: boolean;
  /** The person clicked or pressed a key since. */
  interacted: boolean;
}

/** Whether to put focus on the landmark now. */
export function shouldLandFocus(state: LandingState): boolean {
  return state.onBody && !state.interacted && state.now - state.since <= LANDING_WINDOW_MS;
}

/** Whether to stop looking: focus is somewhere on purpose, or the time is up. */
export function landingDone(state: LandingState, tries: number): boolean {
  return state.interacted || !state.onBody || tries >= LANDING_TRIES || state.now - state.since > LANDING_WINDOW_MS;
}
