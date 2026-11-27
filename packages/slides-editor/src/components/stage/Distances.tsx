/**
 * Distances from the selection, drawn while Alt (Option) is held with the
 * pointer on the slide: to the element under the pointer, or (over the
 * selection itself or the bare slide) to the selection's container or the
 * slide. Hidden while typing, cropping or in the middle of a gesture.
 * Decoration only: nothing here is read out.
 */

import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { SLIDE_HEIGHT, SLIDE_WIDTH, type NodePath, type Rect } from '@open-artifact/slides-core';
import { useView } from '../../state/view.ts';
import { measureGaps, measureTargets, type Gap } from '../../lib/distances.ts';
import { elementOf, measure, unionRect } from './geometry.ts';
import type { StageContext } from './gestures.ts';
import { useStageGesture } from './store.ts';

/** A drawn box that can be measured to (something with a size). */
function boxOf(ctx: StageContext, path: NodePath): Rect | null {
  const el = elementOf(ctx.root, path);
  const box = el ? measure(ctx.root, el, ctx.scale) : null;
  return box && box.w > 0 && box.h > 0 ? box : null;
}

/** The gaps to show for a selection and what the pointer is over, or null. */
function gapsFor(ctx: StageContext, selection: readonly NodePath[], hover: NodePath | null): Gap[] | null {
  const own = unionRect(selection.flatMap((path) => boxOf(ctx, path) ?? []));
  if (!own) return null;
  let target: Rect = { x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT };
  for (const path of measureTargets(selection, hover)) {
    const box = boxOf(ctx, path);
    if (box) {
      target = box;
      break;
    }
  }
  const gaps = measureGaps(own, target);
  return gaps.length ? gaps : null;
}

function sameGaps(a: Gap[] | null, b: Gap[] | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The distance lines and their readouts. */
export function Distances({ ctx }: { ctx: StageContext }): ReactNode {
  const selection = useView((s) => s.selection);
  const quiet = useView((s) => s.textEdit !== null || s.cropping !== null || s.tool !== 'select');
  const asked = useStageGesture((s) => s.altHeld && s.pointerOnSlide);
  const hover = useStageGesture((s) => s.hover);
  const busy = useStageGesture((s) => Boolean(s.draft || s.move || s.marquee || s.draw || s.panning));
  const tick = useStageGesture((s) => s.layoutTick);
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  const on = asked && !quiet && !busy && selection.length > 0;

  useLayoutEffect(() => {
    const next = on ? gapsFor(ctx, selection, hover) : null;
    setGaps((prev) => (sameGaps(prev, next) ? prev : next));
  }, [on, ctx, selection, hover, tick]);

  // The format strip steps aside while distances show.
  useEffect(() => {
    const shown = gaps !== null;
    if (useStageGesture.getState().measuring !== shown) useStageGesture.getState().set({ measuring: shown });
  }, [gaps]);
  useEffect(() => () => useStageGesture.getState().set({ measuring: false }), []);

  if (!gaps) return null;
  const s = ctx.scale;
  /** A point on the stage from a position along a gap's axis and across it. */
  const point = (axis: Gap['axis'], along: number, across: number): { x: number; y: number } =>
    axis === 'x' ? { x: along * s, y: across * s } : { x: across * s, y: along * s };
  return (
    <div className="absolute inset-0" data-open-artifact-distances aria-hidden="true">
      <svg className="absolute inset-0 size-full overflow-visible">
        {gaps.map((gap, i) => {
          const a = point(gap.axis, gap.from, gap.at);
          const b = point(gap.axis, gap.to, gap.at);
          const lead = gap.lead ? [point(gap.axis, gap.to, gap.lead.from), point(gap.axis, gap.to, gap.lead.to)] : null;
          return (
            <g key={i} stroke="var(--color-danger)" strokeWidth={1}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              {lead ? <line x1={lead[0]!.x} y1={lead[0]!.y} x2={lead[1]!.x} y2={lead[1]!.y} strokeDasharray="3 3" opacity={0.6} /> : null}
            </g>
          );
        })}
      </svg>
      {gaps.map((gap, i) => {
        const at = point(gap.axis, (gap.from + gap.to) / 2, gap.at);
        return (
          <span
            key={i}
            data-open-artifact-distance={gap.value}
            className="absolute whitespace-nowrap rounded bg-danger px-1 text-[11px] leading-4 tabular-nums text-white"
            style={{ left: at.x, top: at.y, transform: gap.axis === 'x' ? 'translate(-50%, 5px)' : 'translate(5px, -50%)' }}
          >
            {gap.value}
          </span>
        );
      })}
    </div>
  );
}
