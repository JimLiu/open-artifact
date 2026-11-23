/**
 * The Whiteboard editor: connects to the host, starts live sync, and lays
 * out the board surface with its floating chrome.
 *
 * ```
 * .wb-root
 *   BoardContextMenu                 right-click / long-press menus
 *     BoardSurface
 *       camera layer (board units)   ElementsLayer, UploadPlaceholders, CollabBoardLayer, NextItemOffer
 *       overlay (screen units)       SelectionOverlay, CollabOverlay
 *   TimerEndGlow, BoardPill, BoardFoot, SelectionBar, LinkCard, CollabChrome, FindBar,
 *   VersionHistory                   the history panel and a past version's preview
 * ```
 */

import { useEffect, useLayoutEffect, useState } from 'react';
import { EmptyState } from '@open-artifact/ui';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { BoardSurface } from './canvas/BoardSurface.tsx';
import { CollabBoardLayer, CollabChrome, CollabOverlay, UploadPlaceholders } from './collab/index.ts';
import { ElementsLayer } from './elements/ElementsLayer.tsx';
import { FindBar } from './find/FindBar.tsx';
import { NextItemOffer } from './selection/NextItemOffer.tsx';
import { SelectionOverlay } from './selection/SelectionOverlay.tsx';
import { useBoardRecovery, showBoardMedia } from './services/load-recovery.ts';
import { startBoard } from './services/boot.ts';
import { hasPendingDrawingLooks } from './services/drawing-looks.ts';
import { setBoardRevealed, useBoard } from './state/board.ts';
import { BoardPill } from './ui/BoardPill.tsx';
import { BoardContextMenu } from './ui/ContextMenu.tsx';
import { LinkCard } from './ui/LinkCard.tsx';
import { SelectionBar } from './ui/SelectionBar.tsx';
import { TimerEndGlow } from './ui/Timer.tsx';
import { BoardFoot } from './ui/Toolbar.tsx';
import { VersionHistory } from './ui/VersionHistory.tsx';
import './tools/index.ts';

type Phase = { kind: 'starting' } | { kind: 'ready' } | { kind: 'failed'; message: string };

const VIEWPORT_REVEAL_BUDGET_MS = 1500;
const FONTS_BUDGET_MS = 500;
function nextFrame(signal: AbortSignal, deadline: number): Promise<void> {
  return new Promise(resolve => {
    const frame = requestAnimationFrame(finish);
    const timer = setTimeout(finish, Math.max(0, deadline - performance.now()));
    signal.addEventListener('abort', finish, { once: true });
    function finish() {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

async function decodeImage(img: HTMLImageElement, signal: AbortSignal): Promise<void> {
  if (typeof img.decode === 'function') {
    try { await img.decode(); return; } catch { /* The source may have changed while decoding. */ }
  }
  if (img.complete || signal.aborted) return;
  await new Promise<void>(resolve => {
    img.addEventListener('load', () => resolve(), { once: true, signal });
    img.addEventListener('error', () => resolve(), { once: true, signal });
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

async function waitForViewportReady(signal: AbortSignal): Promise<void> {
  const start = performance.now();
  const deadline = start + VIEWPORT_REVEAL_BUDGET_MS;
  const fontsDeadline = start + FONTS_BUDGET_MS;
  const decodes = new WeakMap<HTMLImageElement, { src: string; current: string; done: boolean }>();
  let previousImages: HTMLImageElement[] = [];
  let previousBoard: ReturnType<typeof useBoard.getState>['board'] | undefined;
  let stableFrames = 0;
  while (!signal.aborted && performance.now() < deadline) {
    await nextFrame(signal, deadline);
    if (signal.aborted) return;
    const board = useBoard.getState().board;
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('.wb-elements img')).filter(img => {
      const r = img.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
    });
    let stable = board === previousBoard && images.length === previousImages.length &&
      images.every((image, index) => image === previousImages[index]);
    for (const img of images) {
      let decoded = decodes.get(img);
      if (!decoded || decoded.src !== img.src || decoded.current !== img.currentSrc) {
        const job = { src: img.src, current: img.currentSrc, done: false };
        decodes.set(img, job);
        void decodeImage(img, signal).then(() => { job.done = true; });
        decoded = job;
      }
      if (!decoded.done) stable = false;
    }
    const fontsPending = performance.now() < fontsDeadline && document.fonts?.status === 'loading';
    stableFrames = stable && !fontsPending && !hasPendingDrawingLooks() ? stableFrames + 1 : 0;
    // Reveal a stable cached viewport even while its list is in flight. Images added
    // by a server response that has already rendered participate in the same deadline.
    if (stableFrames >= 2) return;
    previousImages = images;
    previousBoard = board;
  }
}

/**
 * The running board. Starting it wires page-wide singletons (the session,
 * the sync engine, input listeners), so it starts once per page: React's
 * development double mount (unmount, then mount again at once) keeps the
 * same run instead of tearing it down under the second mount.
 */
let run: { ready: ReturnType<typeof startBoard>; controller: AbortController; holders: number; stopTimer?: ReturnType<typeof setTimeout> } | null = null;
let shutdown: Promise<void> | undefined;

/** Starts the board, or joins the run already started. */
function holdBoard(): Promise<unknown> {
  if (!run) {
    const controller = new AbortController();
    const start = () => startBoard(controller.signal);
    run = { ready: shutdown ? shutdown.then(start, start) : start(), controller, holders: 0 };
  }
  clearTimeout(run.stopTimer);
  run.stopTimer = undefined;
  run.holders += 1;
  return run.ready;
}

/** Leaves the run; the last holder stops it, unless the editor mounts again right away. */
function releaseBoard(): void {
  const current = run;
  if (!current) return;
  current.holders -= 1;
  if (current.holders > 0) return;
  current.stopTimer = setTimeout(() => {
    if (run !== current || current.holders > 0) return;
    run = null;
    current.controller.abort();
    const done = current.ready.then(stop => stop(), () => {});
    shutdown = done;
    const forget = () => { if (shutdown === done) shutdown = undefined; };
    void done.then(forget, error => { forget(); reportError(error); });
  }, 0);
}

/** The editor root. */
export function App() {
  const paused = useBoardRecovery((state) => state.paused);
  const loaded = useBoard(state => state.status !== 'loading');
  const revealed = useBoard(state => state.revealed);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });

  useLayoutEffect(() => {
    let cancelled = false;
    holdBoard()
      .then(() => {
        if (!cancelled) setPhase({ kind: 'ready' });
      })
      .catch((error: unknown) => {
        if (!cancelled) setPhase({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
      releaseBoard();
    };
  }, []);

  useEffect(() => {
    if (phase.kind !== 'ready' || !loaded || revealed) return;
    const controller = new AbortController();
    void waitForViewportReady(controller.signal).then(() => {
      if (!controller.signal.aborted) setBoardRevealed(true);
    });
    return () => controller.abort();
  }, [phase.kind, loaded, revealed]);

  if (phase.kind === 'failed') {
    return (
      <EmptyState icon={<TriangleAlert className="size-6" />} title="This board could not open">
        {phase.message}
      </EmptyState>
    );
  }

  const ready = phase.kind === 'ready';
  return (
    <div className="wb-root">
      <div inert={!revealed} className="contents">
        <BoardContextMenu>
          <BoardSurface
            overlay={ready ? <><SelectionOverlay /><CollabOverlay /></> : null}
            elements={<ElementsLayer />}
          >
            {ready && <UploadPlaceholders />}
            {ready && <CollabBoardLayer />}
            {ready && <NextItemOffer />}
          </BoardSurface>
        </BoardContextMenu>
        {ready && (
          <>
            {paused && <div role="status" className="wb-recovery">
              Pictures and embeds are paused because the last load was interrupted.
              <button type="button" onClick={() => void showBoardMedia()}>Show pictures and embeds</button>
            </div>}
            <TimerEndGlow />
            <BoardPill />
            <BoardFoot />
            <SelectionBar />
            <LinkCard />
            <CollabChrome />
            <FindBar />
            <VersionHistory />
          </>
        )}
      </div>
      {!revealed && (
        <div className="wb-veil" data-wb-veil="" role="status">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
          <span>Opening the board…</span>
        </div>
      )}
    </div>
  );
}
