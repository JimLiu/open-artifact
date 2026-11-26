import type { KeyboardEvent, PointerEvent, ReactElement, ReactNode } from 'react';
import { create } from 'zustand';
import { CLIP_TRIM_STEP, clipTrimRange, snapClipSecond, type ClipTrimRange } from '@open-artifact/motion-core';
import { cn } from '@open-artifact/ui';
import { seekTo } from '../engine/actions.ts';
import { selectFps, useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useWorking } from '../stores/working.ts';
import type { LaneContext } from '../timeline/lanes.ts';
import type { PartSpan } from '../timeline/timeline-math.ts';
import { splitScene, trimScene } from './edits.ts';
import { useClipLength, useSceneClip, type SceneClip } from './scene-clip.ts';
import { sliderKey } from './slider-keys.ts';
import * as words from './words.ts';

type Edge = 'start' | 'end';

/** An end on the move: by the pointer (`pointer`) or by keys, with the video second it would set. */
interface Moving {
  sceneId: string;
  edge: Edge;
  pointer: number | null;
  startX: number;
  was: number;
  value: number;
  /** Pixels per second of the video, fixed for the move. */
  pxPerSecond: number;
  moved: boolean;
}

const useMoving = create<{ moving: Moving | null }>()(() => ({ moving: null }));

/** Keys stop for this long before a key move is written. */
const KEY_SETTLE_MS = 400;
let keyTimer: ReturnType<typeof setTimeout> | undefined;

function clearKeyTimer(): void {
  if (keyTimer !== undefined) clearTimeout(keyTimer);
  keyTimer = undefined;
}

const clamp = (range: ClipTrimRange, edge: Edge, value: number): number =>
  edge === 'start' ? Math.min(range.startMax, Math.max(range.startMin, value)) : Math.min(range.endMax, Math.max(range.endMin, value));

/** The film second (as played) an end shows: the start's first frame, the end's last. */
function showEdge(span: PartSpan, range: ClipTrimRange, edge: Edge, value: number): void {
  const fps = selectFps(useFilm.getState());
  const playPerSecond = span.dur / Math.max(1e-6, range.end - range.start);
  const at = span.start + (value - range.start) * playPerSecond - (edge === 'end' ? 1 / fps : 0);
  seekTo(Math.min(span.start + span.dur - 1 / fps, Math.max(span.start, at)));
}

function write(span: PartSpan, range: ClipTrimRange, moving: Moving): void {
  if (Math.abs(moving.value - moving.was) < 1e-6) return;
  const from = moving.edge === 'start' ? moving.value : range.start;
  const to = moving.edge === 'end' ? moving.value : range.end;
  trimScene(moving.sceneId, from, to, span.index + 1);
}

function TrimHandle({ edge, span, context, clip, range }: { edge: Edge; span: PartSpan; context: LaneContext; clip: SceneClip; range: ClipTrimRange }): ReactElement {
  const playing = usePlayback((s) => s.playing);
  const moving = useMoving((s) => (s.moving?.sceneId === clip.form.sceneId && s.moving.edge === edge ? s.moving : null));
  const sceneId = clip.form.sceneId;
  const speed = clip.form.speed;
  const value = moving?.value ?? (edge === 'start' ? range.start : range.end);
  const pxPerSecond = context.width > 0 && context.total > 0 ? (context.width / context.total) * (span.dur / Math.max(1e-6, range.end - range.start)) : 0;
  const offset = (value - (edge === 'start' ? range.start : range.end)) * pxPerSecond;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || playing || !(pxPerSecond > 0)) return;
    event.preventDefault();
    event.stopPropagation();
    clearKeyTimer();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    useMoving.setState({ moving: { sceneId, edge, pointer: event.pointerId, startX: event.clientX, was: value, value, pxPerSecond, moved: false } });
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = useMoving.getState().moving;
    if (current === null || current.pointer !== event.pointerId) return;
    const next = clamp(range, edge, snapClipSecond(current.was + (event.clientX - current.startX) / current.pxPerSecond, speed));
    const moved = current.moved || Math.abs(event.clientX - current.startX) > 2;
    if (next === current.value && moved === current.moved) return;
    useMoving.setState({ moving: { ...current, value: next, moved } });
    if (next !== current.value) showEdge(span, range, edge, next);
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>, cancel: boolean): void => {
    const current = useMoving.getState().moving;
    if (current === null || current.pointer !== event.pointerId) return;
    useMoving.setState({ moving: null });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancel) return;
    // A click without a drag shows the frame at that end.
    if (!current.moved) showEdge(span, range, edge, current.was);
    else write(span, range, current);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (playing) return;
    const current = useMoving.getState().moving;
    if (event.key === 'Escape') {
      if (current === null) return;
      event.preventDefault();
      event.stopPropagation();
      clearKeyTimer();
      useMoving.setState({ moving: null });
      return;
    }
    if (event.key === 's' || event.key === 'S') {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      splitScene(sceneId);
      return;
    }
    const keyMove = sliderKey(event.key);
    if (keyMove === null) return;
    event.preventDefault();
    event.stopPropagation();
    const from = current !== null && current.edge === edge && current.sceneId === sceneId ? current : { sceneId, edge, pointer: null, startX: 0, was: value, value, pxPerSecond, moved: true };
    if (from.pointer !== null) return;
    let next: number;
    if ('to' in keyMove) {
      const [lowest, highest] = edge === 'start' ? [range.startMin, range.startMax] : [range.endMin, range.endMax];
      next = keyMove.to === 'min' ? lowest : highest;
    } else {
      const stepSeconds = (event.shiftKey ? 10 : 1) * CLIP_TRIM_STEP * speed;
      next = clamp(range, edge, Math.round((from.value + keyMove.step * stepSeconds) * 1000) / 1000);
    }
    const moved: Moving = { ...from, value: next };
    useMoving.setState({ moving: moved });
    showEdge(span, range, edge, next);
    clearKeyTimer();
    keyTimer = setTimeout(() => {
      keyTimer = undefined;
      const settled = useMoving.getState().moving;
      if (settled === null || settled.pointer !== null || settled.sceneId !== sceneId || settled.edge !== edge) return;
      useMoving.setState({ moving: null });
      write(span, range, settled);
    }, KEY_SETTLE_MS);
  };

  const label = edge === 'start' ? words.trimStartOf(span.label, span.index + 1) : words.trimEndOf(span.label, span.index + 1);
  return (
    <>
      {moving !== null ? (
        <div
          className="pointer-events-none absolute top-0 bottom-0 z-10"
          style={edge === 'start' ? { left: offset } : { left: span.width - 2 + offset }}
        >
          <div className="absolute top-0 bottom-0 -left-px w-0.5 rounded-full bg-chrome-accent" />
          <div className="absolute -top-6 left-0 -translate-x-1/2 rounded-md bg-[var(--vid-tip)] px-1.5 py-0.5 text-[11px] tabular-nums whitespace-nowrap text-[var(--vid-tip-fg)]">
            {words.tipSeconds(value)}
          </div>
        </div>
      ) : null}
      <div
        role="slider"
        tabIndex={playing ? -1 : 0}
        aria-label={label}
        aria-description={`${words.DRAG_TO_TRIM}. ${words.TRIMMED_STAYS}`}
        aria-valuenow={Math.round(value * 1000) / 1000}
        aria-valuemin={edge === 'start' ? range.startMin : range.endMin}
        aria-valuemax={edge === 'start' ? range.startMax : range.endMax}
        aria-valuetext={words.intoVideo(value)}
        aria-disabled={playing || undefined}
        title={`${words.DRAG_TO_TRIM}. ${words.TRIMMED_STAYS}`}
        data-trim={edge}
        className={cn(
          'group absolute top-0 bottom-0 z-10 flex w-3 justify-center outline-none',
          edge === 'start' ? '-left-1' : '-right-1',
          playing ? 'pointer-events-none' : 'cursor-ew-resize',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => onPointerEnd(event, false)}
        onPointerCancel={(event) => onPointerEnd(event, true)}
        onKeyDown={onKeyDown}
      >
        <span
          className={cn(
            'my-1.5 w-1 rounded-full bg-chrome-accent opacity-40 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
            moving !== null && 'opacity-100',
          )}
        />
      </div>
    </>
  );
}

/**
 * A video scene's two ends on the timeline, in place of the length grip (`grip`): drag one, or press the arrow keys,
 * to show more or less of the video. Other scenes keep the grip.
 */
export function SceneEnds({ span, context, grip }: { span: PartSpan; context: LaneContext; grip: ReactNode }): ReactNode {
  const clip = useSceneClip(span.key);
  const length = useClipLength(clip?.ref ?? null);
  const readOnly = useWorking((s) => s.readOnlyReason !== null);
  if (clip === null) return grip;
  if (readOnly || span.width < 16) return null;
  const range = clipTrimRange(clip.texts, clip.form, length);
  if (range === null) return grip;
  return (
    <>
      <TrimHandle edge="start" span={span} context={context} clip={clip} range={range} />
      <TrimHandle edge="end" span={span} context={context} clip={clip} range={range} />
    </>
  );
}
