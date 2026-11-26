/**
 * The Pen tool: freehand strokes. Samples are collected in board units and
 * previewed straight into the overlay's SVG path (no React render per
 * sample); Shift straightens the stroke's tail onto the nearest 45° line.
 * The stroke is written once, on release. The pen stays armed.
 *
 * A stylus records a width factor per point from its pressure and tilt
 * (`widths`, see core `stroke-widths.ts`); the stroke is then drawn as a
 * filled outline. Predicted samples only lengthen the preview.
 */

import {
  DEFAULT_STROKE_WIDTH,
  MAX_STROKE_POINTS,
  appendPenPoint,
  createElementId,
  encodeStrokeWidths,
  encodeWidthFactor,
  normalizeStrokePoints,
  pressureStrokeOutline,
  straightenPenTail,
  strokePointsToPath,
  type StrokeElement,
} from '@open-artifact/whiteboard-core';
import { addElements } from '../services/actions.ts';
import { useCamera } from '../state/camera.ts';
import { useTool } from '../state/tool.ts';
import { drawInkPreview, reportInkTrail, useInteraction } from '../selection/store.ts';
import type { Gesture, PointerSample } from './gesture.ts';
import { snapEndToFortyFiveDegrees } from './hit.ts';
import { notePenStroke } from './pen-input.ts';
import { ensureRoom } from './place.ts';
import { forgetTap } from './select.ts';

/** Samples closer than this (screen pixels) to the last one are skipped as jitter on touch. */
export const POINTER_JITTER_PX = 4;

/** With pressure, a sample closer than this (screen pixels) to the last one is kept only when the width changed. */
export const PRESSURE_SAMPLE_MIN_PX = 0.2;

/**
 * The width factor a stylus asks for: pressure widens the line from 0.4×
 * (no pressure) to 1.6× (full), and tilting it (towards lying flat) widens
 * it up to 1.7× more, as a pencil's side does.
 */
export function penWidthShare(pressure: number, tiltX: number, tiltY: number): number {
  const tilt = Math.min(1, Math.hypot(tiltX, tiltY) / 90);
  return (0.4 + 1.2 * Math.min(1, Math.max(0, pressure))) * (1 + 0.7 * tilt * tilt);
}

/** The width factor after smoothing: mostly the previous one, so the outline does not shimmer. */
export function smoothPenShare(previous: number | undefined, share: number): number {
  return previous === undefined ? share : 0.6 * previous + 0.4 * share;
}

/**
 * Appends a pressure sample (board units) and its width factor. Returns
 * `false` when the stroke is full, or the sample is within
 * {@link PRESSURE_SAMPLE_MIN_PX} on screen of the last one and its width
 * did not change.
 */
export function appendPressureSample(samples: number[], factors: number[], x: number, y: number, factor: number, zoom: number): boolean {
  if (samples.length >= MAX_STROKE_POINTS * 2) return false;
  if (samples.length >= 2) {
    const distance = Math.hypot(x - samples[samples.length - 2]!, y - samples[samples.length - 1]!) * zoom;
    if (distance < PRESSURE_SAMPLE_MIN_PX && encodeWidthFactor(factor) === encodeWidthFactor(factors.at(-1) ?? 1)) return false;
  }
  samples.push(x, y);
  factors.push(factor);
  return true;
}

/** Keeps one factor per point after the points were rewritten (a straightened tail takes `fill`). */
export function matchFactors(factors: number[], pointCount: number, fill: number): void {
  if (factors.length > pointCount) factors.length = pointCount;
  while (factors.length < pointCount) factors.push(fill);
}

/**
 * A finished stroke from samples (`[x0, y0, x1, y1, …]`, board units); a
 * lone sample becomes a dot. `factors` (one per sample) are the widths a
 * stylus drew with.
 */
export function strokeFromSamples(samples: readonly number[], color: StrokeElement['color'], width: number, factors?: readonly number[]): StrokeElement | undefined {
  if (samples.length < 2) return undefined;
  const lone = samples.length === 2;
  const points = lone ? [samples[0]!, samples[1]!, samples[0]! + 0.5, samples[1]! + 0.5] : [...samples];
  const normalized = normalizeStrokePoints(points);
  const widths = factors && factors.length === samples.length / 2 ? encodeStrokeWidths(lone ? [factors[0]!, factors[0]!] : factors) : undefined;
  const fits = widths !== undefined && widths.length === normalized.points.length / 2;
  return { type: 'stroke', id: createElementId(), x: normalized.x, y: normalized.y, points: normalized.points, color, width, ...(fits ? { widths } : {}) };
}

/** The Pen tool's press. */
export function penPress(sample: PointerSample): Gesture | null {
  forgetTap();
  if (!ensureRoom()) return null;
  const color = useTool.getState().ink;
  const width = DEFAULT_STROKE_WIDTH;
  const pressure = sample.event.pointerType === 'pen';
  const samples: number[] = [sample.board.x, sample.board.y];
  /** One width factor per sample, with a stylus. */
  const factors: number[] = [];
  let share: number | undefined;
  const shareOf = (event: PointerEvent): number => (share = smoothPenShare(share, penWidthShare(event.pressure, event.tiltX ?? 0, event.tiltY ?? 0)));
  if (pressure) factors.push(shareOf(sample.event));
  /** Predicted samples past the last one: drawn, never kept. */
  let ahead: number[] = [];
  /** Where the straightened tail starts while Shift is held. */
  let lock: number | null = null;
  let frame = 0;
  const interaction = useInteraction.getState();
  interaction.setInk({ color, width, filled: pressure });
  interaction.setTransform('draw');
  const paint = (): void => {
    frame = 0;
    if (pressure) {
      const tip = factors.at(-1) ?? 1;
      drawInkPreview(pressureStrokeOutline([...samples, ...ahead], [...factors, ...ahead.filter((_, index) => index % 2 === 0).map(() => tip)], width));
      reportInkTrail(samples, encodeStrokeWidths(factors));
    } else {
      drawInkPreview(strokePointsToPath([...samples, ...ahead]));
      reportInkTrail(samples);
    }
  };
  const schedule = (): void => {
    if (frame !== 0) return;
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(paint);
    else paint();
  };
  const finish = (): void => {
    if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    frame = 0;
    drawInkPreview('');
    reportInkTrail(null);
    useInteraction.getState().reset();
  };
  paint();
  return {
    cursor: 'crosshair',
    move(next) {
      const { x, y } = next.board;
      ahead = [];
      if (next.event.shiftKey) {
        lock ??= samples.length;
        const from = { x: samples[lock - 2] ?? x, y: samples[lock - 1] ?? y };
        const to = snapEndToFortyFiveDegrees(from, { x, y });
        straightenPenTail(samples, lock, to.x, to.y);
        if (pressure) matchFactors(factors, samples.length / 2, factors[lock / 2 - 1] ?? shareOf(next.event));
      } else {
        lock = null;
        const zoom = useCamera.getState().camera.zoom;
        if (pressure) {
          if (!appendPressureSample(samples, factors, x, y, shareOf(next.event), zoom)) return;
        } else {
          if (next.event.pointerType === 'touch' && samples.length >= 2) {
            const lastX = samples[samples.length - 2]!;
            const lastY = samples[samples.length - 1]!;
            if (Math.hypot(x - lastX, y - lastY) * zoom < POINTER_JITTER_PX) return;
          }
          if (!appendPenPoint(samples, x, y)) return;
        }
      }
      schedule();
    },
    predict(predicted) {
      if (lock !== null) return;
      ahead = predicted.flatMap((each) => [each.board.x, each.board.y]);
      schedule();
    },
    up() {
      finish();
      if (pressure) notePenStroke();
      const stroke = strokeFromSamples(samples, color, width, pressure ? factors : undefined);
      if (stroke) addElements([stroke], 'Draw', { select: false });
    },
    cancel() {
      finish();
    },
  };
}
