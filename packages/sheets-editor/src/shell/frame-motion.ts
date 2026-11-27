/** Whether motion is to be reduced comes from the browser's own setting: the root is marked with it and follows its changes. */
import { REDUCED_MOTION_QUERY } from '../kit/platform.ts';

export function followFrameMotion(win: Window, root: HTMLElement): () => void {
  if (typeof win.matchMedia !== 'function') return () => {};
  const motionQuery = win.matchMedia(REDUCED_MOTION_QUERY);
  const markRoot = (): void => {
    if (motionQuery.matches) root.dataset.reduceMotion = 'true';
    else delete root.dataset.reduceMotion;
  };
  markRoot();
  motionQuery.addEventListener('change', markRoot);
  return () => motionQuery.removeEventListener('change', markRoot);
}
