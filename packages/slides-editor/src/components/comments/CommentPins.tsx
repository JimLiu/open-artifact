/**
 * Comment pins on the stage: the shared pins, card and composer
 * (`@open-artifact/editor-kit`, CommentViews.tsx) placed on the slide on
 * stage. Pins sit where the thread was placed (a point on the slide), else at
 * the top-right corner of its element, else at the slide's corner. The shared
 * capture surface turns clicks and drags into slide-coordinate anchors.
 */

import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { isAncestorPath, nodeAt, samePath, SLIDE_HEIGHT, SLIDE_WIDTH, type NodePath, type Slide } from '@open-artifact/slides-core';
import { CommentCapture, CommentPins as SharedPins } from '@open-artifact/editor-kit/react';
import type { Box, PinPlace, Point } from '@open-artifact/editor-kit';
import { useAgent } from '../../services/agent.ts';
import { anchorOf, anchorPath, elementAnchor, slidesComments, useComments, type AnchorPart, type SlideAnchor } from '../../services/comments.ts';
import { partFromMarks } from '../../lib/comment-anchor.ts';
import { elementOf, measure } from '../stage/geometry.ts';
import { hitPath, pickAt, type StageContext } from '../stage/gestures.ts';
import { useStageGesture } from '../stage/store.ts';

/** Where an anchor's pin goes, in slide coordinates. */
function pinPoint(ctx: StageContext, slide: Slide, anchor: SlideAnchor): Point {
  if (anchor.x !== undefined && anchor.y !== undefined) return { x: anchor.x, y: anchor.y };
  const path = anchorPath(slide, anchor);
  const el = path && nodeAt(slide, path) ? elementOf(ctx.root, path) : null;
  if (el) {
    const r = measure(ctx.root, el, ctx.scale);
    return { x: r.x + r.w, y: r.y };
  }
  return { x: SLIDE_WIDTH - 48, y: 48 };
}

/** The list item or table cell at a client point inside the picked element (or that element itself), and its owner. */
function partAt(root: HTMLElement, clientX: number, clientY: number, picked: NodePath): { path: NodePath; part: AnchorPart } | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const at = hitPath(el, root);
    // Boxes that only lay things out let the pick through; so does this search.
    if (!at || !(samePath(at, picked) || isAncestorPath(picked, at))) continue;
    const marked = el.closest('[data-open-artifact-item], [data-open-artifact-cell]');
    const path = marked && root.contains(marked) ? hitPath(marked, root) : null;
    const part = marked ? partFromMarks(marked.getAttribute('data-open-artifact-item'), marked.getAttribute('data-open-artifact-cell')) : undefined;
    return path && part ? { path, part } : null;
  }
  return null;
}

/** The room a card has from the slide's top-left corner to the stage's far edges (screen px). */
function stageRoom(ctx: StageContext): { width: number; height: number } {
  const box = ctx.root.getBoundingClientRect();
  const stage = ctx.root.closest('[data-open-artifact-stage]')?.getBoundingClientRect();
  return stage ? { width: stage.right - box.left, height: stage.bottom - box.top } : { width: box.width, height: box.height };
}

/** Pins, the active card and the composer for the slide on stage. */
export function CommentPins({ ctx, slide }: { ctx: StageContext; slide: Slide }): ReactNode {
  const threads = useComments((s) => s.threads);
  const draft = useComments((s) => s.draft);
  const tick = useStageGesture((s) => s.layoutTick);
  const agent = useAgent((s) => s.status);
  const [layout, setLayout] = useState<{ points: Map<SlideAnchor, Point>; viewport: { width: number; height: number } }>(() => ({
    points: new Map(),
    viewport: { width: 0, height: 0 },
  }));

  // Pins are measured on the rendered slide, after it laid out.
  useLayoutEffect(() => {
    const points = new Map<SlideAnchor, Point>();
    for (const thread of threads) {
      const anchor = anchorOf(thread);
      if (anchor.slide === ctx.slideId) points.set(anchor, pinPoint(ctx, slide, anchor));
    }
    if (draft?.slide === ctx.slideId) points.set(draft, pinPoint(ctx, slide, draft));
    setLayout({ points, viewport: stageRoom(ctx) });
  }, [ctx, slide, threads, draft, tick]);

  const place = useCallback(
    (anchor: SlideAnchor): PinPlace | null => {
      const world = anchor.slide === ctx.slideId ? layout.points.get(anchor) : undefined;
      return world ? { world, state: 'ok' } : null;
    },
    [ctx.slideId, layout],
  );
  // A dragged pin lands on the element under its tip, at that point.
  const anchorAt = useCallback(
    (world: Point): SlideAnchor => {
      const box = ctx.root.getBoundingClientRect();
      const [x, y] = [box.left + world.x * ctx.scale, box.top + world.y * ctx.scale];
      const path = pickAt(ctx, slide, x, y, []);
      const hit = path ? partAt(ctx.root, x, y, path) : null;
      // On a list item or a cell, the comment names the list or table (even inside a group) and the part.
      if (hit) {
        const precise = elementAnchor(slide, hit.path, world, undefined, hit.part);
        if (precise.item !== undefined || precise.cell !== undefined) return precise;
      }
      return elementAnchor(slide, path, world);
    },
    [ctx, slide],
  );
  const camera = useMemo(() => ({ x: 0, y: 0, zoom: ctx.scale }), [ctx.scale]);

  const areaAnchor = (from: Point, to: Point): SlideAnchor => {
    const clamp = (value: number, limit: number): number => Math.max(0, Math.min(limit, value));
    const x = clamp(Math.min(from.x, to.x), SLIDE_WIDTH);
    const y = clamp(Math.min(from.y, to.y), SLIDE_HEIGHT);
    return elementAnchor(slide, null, { x, y }, {
      w: clamp(Math.max(from.x, to.x), SLIDE_WIDTH) - x,
      h: clamp(Math.max(from.y, to.y), SLIDE_HEIGHT) - y,
    });
  };
  const highlight = (anchor: SlideAnchor): Box | null => {
    if (anchor.x !== undefined && anchor.y !== undefined && anchor.w !== undefined && anchor.h !== undefined) {
      return { x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h, area: true };
    }
    const path = anchorPath(slide, anchor);
    const element = path && elementOf(ctx.root, path);
    return element ? measure(ctx.root, element, ctx.scale) : null;
  };

  return (
    <div data-open-artifact-comment-ui className="contents">
      <div className="pointer-events-auto contents">
        <CommentCapture comments={slidesComments} enabled camera={() => camera} anchorAt={anchorAt} areaAnchor={areaAnchor} />
      </div>
      <SharedPins<SlideAnchor>
        comments={slidesComments}
        camera={camera}
        viewport={layout.viewport}
        place={place}
        highlight={highlight}
        anchorAt={anchorAt}
        agent={{ available: agent.available, name: agent.name, wakesIdle: agent.wakesIdle }}
        piles={false}
      />
    </div>
  );
}
