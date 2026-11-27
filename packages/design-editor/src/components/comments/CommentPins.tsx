/**
 * The Design's comment layers: the shared capture layer and pins
 * (`@open-artifact/editor-kit`, CommentViews.tsx) wired to the canvas: its camera, its current
 * page, and what lies under a point (an element of an artboard, an
 * artboard, a note, or the empty canvas).
 */

import { useCallback, useEffect, type ReactNode } from 'react';
import { CommentCapture as SharedCapture, CommentPins as SharedPins } from '@open-artifact/editor-kit/react';
import { areaAnchor, type DesignAnchor } from '../../lib/comment-anchors.ts';
import { useDocument } from '../../state/document.ts';
import { useView } from '../../state/view.ts';
import { useAgent } from '../../services/agent.ts';
import { anchorAt, designComments, highlightOf, pinContext, placeOnPage } from '../../services/comments.ts';
import { liveCamera } from '../../services/engine.ts';
import { useLiveCamera } from '../../services/camera-frame.ts';
import { viewportSize } from '../../services/viewport.ts';

/**
 * In comment mode: clicks place threads, drags draw areas, and what a click
 * would comment on is outlined under the pointer. The artboard the pointer
 * last rested on is kept live (`peek`), so its elements can be picked even at
 * a zoom where artboards show snapshots; once its frame has booted, the
 * pointer picks again.
 */
export function CommentCapture(): ReactNode {
  const mode = useView((s) => s.mode);
  const spacePan = useView((s) => s.spacePan);
  const on = designComments.store((s) => s.on);
  const peekBooted = useView((s) => Boolean(s.peek && s.frames[s.peek]?.booted));
  const layoutTick = useView((s) => s.layoutTick);
  const active = on && mode === 'canvas';
  useEffect(() => {
    if (!active) useView.getState().setPeek(null);
  }, [active]);
  return (
    <SharedCapture<DesignAnchor>
      comments={designComments}
      enabled={mode === 'canvas'}
      panning={spacePan}
      camera={liveCamera}
      anchorAt={anchorAt}
      areaAnchor={(a, b) => areaAnchor(useView.getState().page, a, b)}
      highlight={highlightOf}
      onHover={(anchor) => {
        // Kept until another artboard is pointed at: passing over the gap between two does not reload either.
        if (anchor && (anchor.kind === 'board' || anchor.kind === 'element')) useView.getState().setPeek(anchor.board);
      }}
      revision={`${peekBooted}:${layoutTick}`}
    />
  );
}

/** Pins of the current page, the open card and the composer. */
export function CommentPins(): ReactNode {
  const page = useView((s) => s.page);
  const mode = useView((s) => s.mode);
  const layoutTick = useView((s) => s.layoutTick);
  const toolbarTop = useView((s) => s.toolbarTop);
  const canvas = useDocument((s) => s.canvas);
  const boards = useDocument((s) => s.boards);
  const agent = useAgent((s) => s.status);
  const hasPins = designComments.store((s) => s.available && (s.threads.length > 0 || s.draft !== null));
  const camera = useLiveCamera(mode === 'canvas' && hasPins);
  // Pins move with the page, the canvas, artboard sources and their layout.
  const place = useCallback((anchor: DesignAnchor) => placeOnPage(anchor, page, pinContext()), [page, canvas, boards, layoutTick]);
  if (mode !== 'canvas') return null;
  return (
    <SharedPins<DesignAnchor>
      comments={designComments}
      camera={camera}
      viewport={viewportSize}
      place={place}
      highlight={highlightOf}
      anchorAt={anchorAt}
      screenTransform
      agent={{ available: agent.available, name: agent.name, wakesIdle: agent.wakesIdle }}
      // "More comments" tabs keep clear of the corner cards and the foot toolbar.
      insets={toolbarTop ? { top: 104 } : { top: 48, bottom: 64 }}
    />
  );
}
