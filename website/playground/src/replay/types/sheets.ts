/**
 * The sheets demo's part in its replay: where the comment's pointer goes. A grid is laid out in pixels from its top
 * left corner, so a fraction of the page's area (the script's `at`) is another cell at another size of the page. This
 * finds the cell the script names (`comment.label`, an address such as `D6`) where the editor draws it now.
 */

import type { ReplayHooks } from '../replay.ts';

const hooks: ReplayHooks = {
  comment(_demo, script) {
    const address = /^([A-Z]+)(\d+)$/.exec(script.comment.label);
    const frame = document.querySelector<HTMLIFrameElement>('iframe[name=open-artifact-shell]');
    const page = document.querySelector<HTMLElement>('.pg-page');
    if (!address || !frame || !page) return {};
    const cell = frame.contentDocument?.querySelector(`[role=gridcell][aria-colindextext="${address[1]}"][aria-rowindextext="${address[2]}"]`);
    const inFrame = cell?.getBoundingClientRect();
    const area = page.getBoundingClientRect();
    if (!inFrame?.width || !area.width || !area.height) return {};
    const origin = frame.getBoundingClientRect();
    const x = (origin.left + inFrame.left + inFrame.width / 2 - area.left) / area.width;
    const y = (origin.top + inFrame.top + inFrame.height / 2 - area.top) / area.height;
    // A cell scrolled out of view keeps the script's place.
    return x > 0 && x < 1 && y > 0 && y < 1 ? { at: [x, y] } : {};
  },
};

export default hooks;
