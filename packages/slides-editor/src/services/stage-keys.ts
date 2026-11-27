/**
 * Keys held over the stage: Space (or Shift+Space) to drag the stage
 * around (the middle button drags it too), Alt (Option) to show distances
 * from the selection.
 *
 * The keyboard module hands Space presses here, having decided whether the
 * key is the stage's; the releases, the pointer and the window losing focus
 * are watched here. What is held is published on the stage gesture store.
 */

import { useStageGesture } from '../components/stage/store.ts';
import { isSpaceKey, pressPointer, pressSpace, releaseOtherKey, releasePointer, releaseSpace, SPACE_RELEASED, type SpaceHold } from '../lib/space-pan.ts';

let hold: SpaceHold = SPACE_RELEASED;

function setHold(next: SpaceHold): void {
  hold = next;
  const stage = useStageGesture.getState();
  if (stage.spaceHeld === next.held) return;
  // The hand replaces the hover outline while Space is down.
  stage.set(next.held ? { spaceHeld: true, hover: null } : { spaceHeld: false });
}

/** A Space keydown; `elsewhere` when the key belongs to a field, a control, a dialog or the text being typed. */
export function holdSpace(event: KeyboardEvent, elsewhere: boolean): void {
  const step = pressSpace(hold, {
    repeat: event.repeat,
    chord: event.altKey || event.ctrlKey || event.metaKey,
    elsewhere: elsewhere || event.defaultPrevented,
  });
  if (step.preventDefault) event.preventDefault();
  setHold(step.hold);
}

/** A pointer press on the stage: true (and the press is the stage's drag) while Space is held, or for the middle button. */
export function claimStageDrag(button: number): boolean {
  const { hold: next, drags } = pressPointer(hold, button);
  setHold(next);
  return drags;
}

/** Alt is down (or not), as a key event or the pointer reports it. */
export function setAltHeld(held: boolean): void {
  if (useStageGesture.getState().altHeld !== held) useStageGesture.getState().set({ altHeld: held });
}

/** Watches releases, the pointer and focus. Returns the uninstaller. */
export function installStageKeys(): () => void {
  const wiring = new AbortController();
  const { signal } = wiring;
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'Alt') setAltHeld(false);
    if (!isSpaceKey(event)) {
      setHold(releaseOtherKey(hold, event.key));
      return;
    }
    const step = releaseSpace(hold);
    if (step.preventDefault) event.preventDefault();
    setHold(step.hold);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Alt' && !event.repeat) setAltHeld(true);
  };
  const onPointerEnd = (): void => setHold(releasePointer(hold));
  const onBlur = (): void => {
    setHold(SPACE_RELEASED);
    if (!document.hasFocus()) setAltHeld(false);
  };
  // Capture: a release must be seen (and a swallowed one stopped) before a focused control acts on it.
  window.addEventListener('keyup', onKeyUp, { signal, capture: true });
  window.addEventListener('keydown', onKeyDown, { signal, capture: true });
  for (const type of ['pointerup', 'pointercancel'] as const) window.addEventListener(type, onPointerEnd, { signal, capture: true });
  window.addEventListener('blur', onBlur, { signal });
  return () => {
    wiring.abort();
    setHold(SPACE_RELEASED);
    setAltHeld(false);
  };
}
