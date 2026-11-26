import { MAX_FILM_SECONDS } from '../limits.ts';
import { SCENE_DURATION_EPSILON } from '../records/recut.ts';
import { longestSceneDur, readRawScenes, readRecut, recutForParts, sceneShare, writeRawScenes } from './film.ts';
import { roundToMs, withClipFrom, type ClipSceneForm } from './form.ts';

/** The shortest a clip scene gets, in film seconds. */
export const MIN_CLIP_SCENE_SECONDS = 0.5;
/** A trim moves an end by this many film seconds' worth of the video. */
export const CLIP_TRIM_STEP = 0.1;

/** The texts a trim or a split reads and writes. */
export interface ClipSceneTexts {
  scenes: string;
  module: string;
  recut: string | null;
}

/** Where the scene starts and ends in its video, and how far each end may go (all in the video's seconds). */
export interface ClipTrimRange {
  start: number;
  end: number;
  startMin: number;
  startMax: number;
  endMin: number;
  endMax: number;
}

/**
 * How far the scene's ends may move: the start back to the video's first second, the end to its last (`length`,
 * `null` when not known: then not past where it is), each no further than the film's length limit leaves room for,
 * and never closer together than half a second of film.
 */
export function clipTrimRange(texts: ClipSceneTexts, form: ClipSceneForm, length: number | null): ClipTrimRange | null {
  const raw = readRawScenes(texts.scenes);
  const recut = readRecut(texts.recut) ?? { scenes: [] };
  const share = raw === null ? null : sceneShare(raw, recut, form.sceneId);
  if (share === null || !(share.dur > 0)) return null;
  const { from, speed } = form;
  const end = from + share.dur * speed;
  const more = Math.max(0, longestSceneDur(share) - share.dur) * speed;
  const shortest = MIN_CLIP_SCENE_SECONDS * speed;
  const known = length !== null && Number.isFinite(length) && length > 0;
  const endLimit = known ? Math.min(length, end + more) : end;
  return {
    start: from,
    end,
    startMin: Math.min(from, Math.max(0, from - more)),
    startMax: Math.max(from, end - shortest),
    endMin: Math.min(end, from + shortest),
    endMax: Math.max(Math.min(end, from + shortest), endLimit),
  };
}

export type ClipTrimRefusal = 'form' | 'short' | 'long' | 'past-end';
export type ClipTrimResult = { ok: true; texts: ClipSceneTexts; from: number; dur: number } | { ok: false; reason: ClipTrimRefusal };

export interface ClipTrimOptions {
  /** The video's length, to refuse an end past it; `null` when not known. */
  length: number | null;
  /** An undo or redo puts back what was: it may end past the video's end as known now. */
  pastEnd?: boolean;
}

/**
 * The scene showing its video from `from` to `to` (the video's seconds): line 1's number becomes `from` and the
 * scene's `dur` in scenes.json `(to − from) / speed`, both to the millisecond; a length set by hand follows at the
 * same pace. The same texts when nothing moves.
 */
export function trimClipScene(texts: ClipSceneTexts, form: ClipSceneForm, from: number, to: number, options: ClipTrimOptions): ClipTrimResult {
  const raw = readRawScenes(texts.scenes);
  const recut = readRecut(texts.recut);
  const share = raw === null ? null : sceneShare(raw, recut ?? { scenes: [] }, form.sceneId);
  if (raw === null || share === null || !Number.isFinite(from) || !Number.isFinite(to)) return { ok: false, reason: 'form' };
  const start = roundToMs(Math.max(0, from));
  const dur = roundToMs((to - start) / form.speed);
  if (dur < MIN_CLIP_SCENE_SECONDS - SCENE_DURATION_EPSILON) return { ok: false, reason: 'short' };
  if (share.othersFilm + dur > MAX_FILM_SECONDS + SCENE_DURATION_EPSILON) return { ok: false, reason: 'long' };
  const length = options.length;
  if (options.pastEnd !== true && length !== null && Number.isFinite(length) && to > length + SCENE_DURATION_EPSILON) return { ok: false, reason: 'past-end' };
  if (Math.abs(start - form.from) < 1e-9 && Math.abs(dur - share.dur) < 1e-9) return { ok: true, texts, from: start, dur };
  const scenes = raw.scenes.map((scene, index) => (index === share.index ? { ...scene, dur } : scene));
  return {
    ok: true,
    from: start,
    dur,
    texts: {
      scenes: writeRawScenes(raw, scenes),
      module: withClipFrom(texts.module, start),
      recut: recut === null ? texts.recut : recutForParts(texts.recut, recut, form.sceneId, share.dur, [{ id: form.sceneId, dur }]),
    },
  };
}

/** A position in the video snapped to the trim's step at the scene's speed. */
export function snapClipSecond(second: number, speed: number): number {
  const step = CLIP_TRIM_STEP * speed;
  return roundToMs(Math.round(second / step) * step);
}
