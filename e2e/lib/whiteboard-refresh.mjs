// Installed before navigation in the Shell and editor. Observe the editor's own decode calls.
export function observeRefresh() {
  const trace = window.refreshTrace = { slots: [], states: [], reports: [], readiness: [], beforeLoad: [], veil: [], firstFrame: null };
  document.addEventListener('load', event => {
    if (event.target.matches?.('iframe')) trace.frameLoaded = true;
  }, true);
  const decoded = new WeakMap();
  const nativeDecode = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function (...args) {
    const src = this.currentSrc || this.src;
    const result = nativeDecode.apply(this, args);
    result.then(() => decoded.set(this, src), () => {});
    return result;
  };
  const visible = r => r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
  function firstFrame() {
    const images = [...document.querySelectorAll('.wb-elements img')].filter(img => visible(img.getBoundingClientRect()));
    const labels = [...document.querySelectorAll('.wb-text, .wb-shape-text, .wb-note .wb-lines')].filter(el => el.textContent.trim() && visible(el.getBoundingClientRect()));
    const laidOut = labels.filter(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && [...range.getClientRects()].some(visible);
    });
    trace.firstFrame = {
      at: performance.now(),
      zoom: new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.wb-layer')).transform).a,
      nodes: document.querySelectorAll('.wb-elements [data-wb-id]').length,
      elements: new Set([...document.querySelectorAll('.wb-elements [data-wb-id]')].map(el => el.dataset.wbId)).size,
      images: images.length, decoded: images.filter(img => img.complete && img.naturalWidth > 0 && decoded.get(img) === img.currentSrc).length,
      imageStates: images.map(img => ({ id: img.closest('[data-wb-id]')?.dataset.wbId, complete: img.complete, width: img.naturalWidth })),
      paintedLooks: images.filter(img => img.currentSrc.startsWith('blob:')).length,
      text: labels.length, laidOutText: laidOut.length,
    };
    HTMLImageElement.prototype.decode = nativeDecode;
  }
  let covered = false;
  function sample() {
    const veil = !!document.querySelector('[data-wb-veil]');
    if (veil !== covered) {
      covered = veil;
      trace.veil.push(covered);
      if (!covered && !trace.firstFrame) firstFrame();
    }
    const header = document.querySelector('header');
    if (!header) return;
    const history = header.querySelector('button[aria-label="Version history"]');
    const comments = header.querySelector('button[aria-label="Comments"]');
    const loading = !!document.querySelector('[data-shell-loading]');
    const state = header.querySelector('[data-shell-save-state]')?.dataset.shellSaveState;
    if (state && trace.states.at(-1) !== state) trace.states.push(state);
    const slot = [history?.getBoundingClientRect().x ?? null, comments?.getBoundingClientRect().x ?? null,
      history?.disabled ?? null, comments?.disabled ?? null, loading];
    if (JSON.stringify(slot) !== JSON.stringify(trace.slots.at(-1))) trace.slots.push(slot);
  }
  addEventListener('message', event => {
    if (event.source === document.querySelector('iframe')?.contentWindow && event.data?.openArtifact === 'chrome_report') {
      const saved = event.data.report.saved;
      const ready = event.data.report.ready !== false;
      if (ready && saved) trace.firstReadySaved ??= saved;
      if (trace.readiness.at(-1) !== ready) trace.readiness.push(ready);
      if (saved && trace.reports.at(-1) !== saved) trace.reports.push(saved);
      if (saved && !trace.frameLoaded && trace.beforeLoad.at(-1) !== saved) trace.beforeLoad.push(saved);
    }
  });
  new MutationObserver(sample).observe(document, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['disabled', 'data-shell-save-state', 'aria-label'] });
  function frame() { sample(); requestAnimationFrame(frame); }
  requestAnimationFrame(frame);
}

export const savedBoardCopy = `(() => {
  const params = new URLSearchParams(location.search);
  const id = params.get('open_artifact_id')?.trim();
  const framed = window.parent !== window && URL.canParse(params.get('open_artifact_shell'));
  const scope = framed && id ? 'artifact:' + encodeURIComponent(id) : location.pathname;
  return Object.keys(localStorage).filter(key => key.startsWith('wb-saved-copy:' + scope + ':'))
    .map(key => localStorage.getItem(key)).find(value => value?.startsWith('['));
})()`;

export async function refreshTrace(page) {
  const [board] = (await page.evaluateAll('window.refreshTrace?.firstFrame')).filter(Boolean);
  return { board, shell: await page.evaluate('window.refreshTrace') };
}
