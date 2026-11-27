/**
 * The Slides editor: the slide rail on the left (headed by the View menu;
 * hidden in a narrow window), the stage in the middle (or the grid / canvas view) with
 * the speaker notes under the slide and the floating cards and toolbar over
 * it, and the properties panel or the comment list on the right; dialogs
 * and the show on top of everything.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Loader2, Presentation, TriangleAlert } from 'lucide-react';
import { LIMITS } from '@open-artifact/slides-core';
import { CrashBoundary, EmptyState } from '@open-artifact/ui';
import { useDeck } from './state/deck.ts';
import { useOrder } from './state/outline.ts';
import { useUi } from './state/ui.ts';
import { railWanted, useView, watchRailFit } from './state/view.ts';
import { installKeyboard } from './keyboard.ts';
import { startPresence, useAgent, usePresence } from './services/agent.ts';
import { installClipboard } from './services/clipboard.ts';
import { installLockedSelection } from './services/lock-selection.ts';
import { canChange } from './services/commands.ts';
import { emptyDeckMessage, emptyDeckToolbar } from './lib/empty-deck.ts';
import { startComments, useComments } from './services/comments.ts';
import { startCreation, useCreation } from './services/creation.ts';
import { startCursors } from './services/cursors.ts';
import { startDesignSystems } from './services/design-systems.ts';
import { HistoryDialog } from './components/HistoryDialog.tsx';
import { startHistory } from './services/history.ts';
import { initialSlide, startLocationSync } from './services/location.ts';
import { pendingRecovery } from './services/recovery.ts';
import { maybeSession, resolveSrc, startSession } from './services/session.ts';
import { startShellBridge } from './services/shell.ts';
import { loadDeck } from './services/sync.ts';
import { syncDeckFonts } from './render/fonts.ts';
import { Banners, useRecoveryOffer } from './components/Banners.tsx';
import { CrashCard } from './components/CrashCard.tsx';
import { CreationAnnouncer, CreationStatus, CreationView } from './components/Creation.tsx';
import { Dialogs } from './components/Dialogs.tsx';
import { FindBar } from './components/FindBar.tsx';
import { Rail } from './components/Rail.tsx';
import { Stage } from './components/Stage.tsx';
import { StageChrome } from './components/StageChrome.tsx';
import { Announcer, TipGroup } from '@open-artifact/editor-kit/react';
import { guardFileDrops } from '@open-artifact/editor-kit';
import { COMMENTS_ROOM, CommentList } from './components/comments/CommentList.tsx';
import { PropertiesPanel } from './components/properties/PropertiesPanel.tsx';
import { Presenter } from './components/present/Presenter.tsx';
import { CanvasView } from './components/views/CanvasView.tsx';
import { GridView } from './components/views/GridView.tsx';

/** Connects, loads the deck and picks the first slide. Runs once. */
async function boot(): Promise<void> {
  try {
    await startSession();
  } catch (error) {
    useDeck.getState().fail(error instanceof Error ? error.message : String(error));
    return;
  }
  await loadDeck();
  const deck = useDeck.getState();
  if (deck.status !== 'ready') return;
  // Start at the linked slide when opening a shared address.
  useView.getState().showSlide(initialSlide());
  startLocationSync();
  startPresence();
  startCreation();
  const room = maybeSession()?.room;
  if (room) {
    startCursors(room, {
      ids: () => usePresence.getState().peers.map((p) => p.id),
      subscribe: (listener) =>
        usePresence.subscribe((state, previous) => {
          if (state.peers !== previous.peers) listener();
        }),
    });
  }
  startShellBridge();
  void startComments();
  void startHistory();
  startDesignSystems();
  // Unsaved changes from an earlier visit wait for the person's choice.
  if (!deck.readOnly) useRecoveryOffer.getState().set(pendingRecovery());
  document.title = deck.title || 'Slides';
}

let booted = false;

/**
 * The deck has no slides yet: a faint deck icon, one line, and Add slide
 * (which opens the layout picker), centred on the whole stage.
 */
function EmptyDeck(): ReactNode {
  const editable = useDeck((s) => !s.readOnly) && canChange();
  const agent = useAgent((s) => s.status);
  const writing = useCreation((s) => s.writing);
  // The agent is writing this deck: its outline as skeleton cells.
  if (writing) return <CreationView />;
  return (
    <div data-open-artifact-empty-deck="" className="flex min-w-0 flex-1 flex-col overflow-y-auto text-center">
      <div className="m-auto flex flex-col items-center gap-3 p-6">
        <Presentation className="size-14 text-chrome-fg opacity-25" strokeWidth={1.5} aria-hidden />
        <p className="max-w-md text-sm text-chrome-muted">{emptyDeckMessage({ editable, agent: agent.available ? agent.name : null })}</p>
        {editable ? (
          <button
            type="button"
            className="h-7 rounded-[6px] bg-chrome-hover px-2.5 text-[13px] font-control text-chrome-fg outline-none hover:bg-chrome-selected focus-visible:ring-2 focus-visible:ring-chrome-focus"
            onClick={() => useUi.getState().open('newSlide')}
          >
            Add slide
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function App(): ReactNode {
  const status = useDeck((s) => s.status);
  const error = useDeck((s) => s.error);
  const title = useDeck((s) => s.title);
  const faces = useDeck((s) => s.index.faces);
  const order = useOrder();
  const mode = useView((s) => s.mode);
  const canvasEdit = useView((s) => s.canvasEdit);
  const current = useView((s) => s.current);
  const showRail = useView(railWanted);
  const showProperties = useView((s) => s.showProperties);
  const readOnly = useDeck((s) => s.readOnly);
  const writing = useCreation((s) => s.writing);
  const commentsOpen = useComments((s) => s.listOpen && s.available);

  useEffect(() => {
    if (!booted) {
      booted = true;
      void boot();
    }
    const keyboard = installKeyboard();
    const clipboard = installClipboard();
    const locks = installLockedSelection();
    const drops = guardFileDrops(window);
    const railFit = watchRailFit();
    return () => {
      railFit();
      keyboard();
      clipboard();
      locks();
      drops();
    };
  }, []);

  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  // The deck's typefaces load into the page (and follow index changes).
  useEffect(() => {
    if (status === 'ready') syncDeckFonts(faces, resolveSrc);
  }, [status, faces]);

  // The slide on stage left the deck (deleted here or elsewhere): show its neighbour.
  const lastIndex = useRef(0);
  useEffect(() => {
    if (status !== 'ready') return;
    const at = current ? order.indexOf(current) : -1;
    if (at >= 0) {
      lastIndex.current = at;
      return;
    }
    const next = order[Math.min(lastIndex.current, order.length - 1)] ?? null;
    if (next !== current) useView.getState().showSlide(next);
  }, [status, order, current]);

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <Loader2 className="size-5 animate-spin text-fg-subtle" aria-label="Loading" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="h-full bg-canvas">
        <EmptyState icon={<TriangleAlert className="size-6" />} title="This presentation could not be opened">
          {error}
        </EmptyState>
      </div>
    );
  }

  // The one-slide stage is up: the edit view, or a slide edited on the canvas.
  const onStage = mode === 'edit' || canvasEdit;
  const empty = order.length === 0;
  const railShown = mode === 'edit' && showRail && !empty;
  // An empty deck's own Add slide stands in for the top-left card, as nothing else there applies yet.
  const emptyToolbar = mode === 'edit' && emptyDeckToolbar({ editable: !readOnly && canChange(), writing, slides: order.length, maxSlides: LIMITS.slides });

  return (
    <CrashBoundary fallback={<CrashCard />}>
      <TipGroup>
        <div className="flex h-full bg-stage text-fg">
          {railShown ? <Rail /> : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <Banners />
            <main className="relative flex min-h-0 min-w-0 flex-1">
              {mode === 'edit' ? empty ? <EmptyDeck /> : <Stage /> : mode === 'grid' ? <GridView /> : <CanvasView />}
              <StageChrome onStage={onStage && !empty} startCard={!railShown && !(mode === 'edit' && empty)} emptyDeck={emptyToolbar} />
              <FindBar />
              <CreationStatus />
              <CreationAnnouncer />
              <Announcer />
            </main>
          </div>
          {onStage && showProperties && !empty && !commentsOpen ? <PropertiesPanel /> : null}
          {/* The All comments panel floats at the right; this keeps its room, so the stage narrows beside it. */}
          {commentsOpen ? <div data-open-artifact-comments-room="" aria-hidden className="shrink-0" style={{ width: COMMENTS_ROOM }} /> : null}
          <CommentList />
          <Dialogs />
          <HistoryDialog />
          <Presenter />
        </div>
      </TipGroup>
    </CrashBoundary>
  );
}
