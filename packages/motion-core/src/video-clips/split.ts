import { MAX_MODULES, MAX_SCENES } from '../limits.ts';
import { isSceneId, sceneModuleName } from '../names.ts';
import { parseRetouchedRecord } from '../records/retouched.ts';
import { readRawScenes, readRecut, recutForParts, sceneShare, writeRawScenes } from './film.ts';
import { roundToMs, withClipFrom, withSceneId, type ClipSceneForm } from './form.ts';
import { MIN_CLIP_SCENE_SECONDS, type ClipSceneTexts } from './trim.ts';

/**
 * Why a clip scene cannot be cut in two: `place` the playhead is not at least half a second inside it, `looks`
 * something in it was restyled by hand (those changes name the scene), `bare` it shows more than its video,
 * `other` anything else (no room for another scene, no free name, a record of another version).
 */
export type ClipSplitBlock = 'place' | 'looks' | 'bare' | 'other';

/** What a split reads besides the scene's texts. */
export interface ClipSplitFilm {
  /** Every module name of the film. */
  modules: ReadonlySet<string>;
  /** `retouched.json`'s text, if any. */
  retouched: string | null;
}

export interface ClipSplit {
  /** The second part's scene id. */
  id: string;
  texts: ClipSceneTexts;
  /** The second part's module. */
  module: string;
}

export type ClipSplitResult = { ok: true; split: ClipSplit } | { ok: false; reason: ClipSplitBlock };

function retouchedScenes(text: string | null): string[] {
  if (text === null) return [];
  return parseRetouchedRecord(text).layers.map((layer) => layer.id.slice(0, layer.id.indexOf(':')));
}

/**
 * The id for the second part: the scene's id without a trailing `-n`, then `-2` … `-99`, the first that no scene,
 * module, length or name set by hand, or restyled thing uses; `null` when none is free.
 */
export function nextSplitId(sceneId: string, taken: (id: string) => boolean): string | null {
  const base = sceneId.replace(/-\d+$/, '');
  for (let n = 2; n <= 99; n++) {
    const id = `${base}-${n}`;
    if (isSceneId(id) && !taken(id)) return id;
  }
  return null;
}

/** Why the scene cannot be split now, or `null` (`at`: the playhead's film second within the scene). */
export function clipSplitBlock(texts: ClipSceneTexts, form: ClipSceneForm, film: ClipSplitFilm, at: number | null): ClipSplitBlock | null {
  const result = splitClipScene(texts, form, film, at ?? Number.NaN);
  return result.ok ? null : result.reason;
}

/**
 * The scene cut in two at its film second `at`: the first part keeps its id and plays to `at`; the second, a copy
 * of its module under a new id starting `at` seconds further into the video, is listed right after it under the
 * same name. A length set by hand is shared out at the same pace.
 */
export function splitClipScene(texts: ClipSceneTexts, form: ClipSceneForm, film: ClipSplitFilm, at: number): ClipSplitResult {
  if (!form.bare) return { ok: false, reason: 'bare' };
  const scenesOwned = retouchedScenes(film.retouched);
  if (scenesOwned.includes(form.sceneId)) return { ok: false, reason: 'looks' };
  const raw = readRawScenes(texts.scenes);
  const recut = readRecut(texts.recut);
  const share = raw === null || recut === null ? null : sceneShare(raw, recut, form.sceneId);
  if (raw === null || recut === null || share === null) return { ok: false, reason: 'other' };
  const first = roundToMs(at);
  if (!(first >= MIN_CLIP_SCENE_SECONDS && first <= share.dur - MIN_CLIP_SCENE_SECONDS)) return { ok: false, reason: 'place' };
  if (raw.scenes.length >= MAX_SCENES || film.modules.size >= MAX_MODULES) return { ok: false, reason: 'other' };
  const ids = new Set<string>([
    ...raw.scenes.flatMap((scene) => (typeof scene.id === 'string' ? [scene.id] : [])),
    ...recut.scenes.flatMap((entry) => (entry.target.by === 'id' ? [entry.target.id] : [])),
    ...scenesOwned,
  ]);
  const id = nextSplitId(form.sceneId, (candidate) => ids.has(candidate) || [...film.modules].some((name) => name.split('~')[0] === sceneModuleName(candidate)));
  if (id === null) return { ok: false, reason: 'other' };
  const second = roundToMs(share.dur - first);
  const scene = raw.scenes[share.index]!;
  const scenes = [...raw.scenes.slice(0, share.index), { ...scene, dur: first }, { ...scene, id, dur: second }, ...raw.scenes.slice(share.index + 1)];
  return {
    ok: true,
    split: {
      id,
      module: withClipFrom(withSceneId(texts.module, form.sceneId, id), form.from + first * form.speed),
      texts: {
        scenes: writeRawScenes(raw, scenes),
        module: texts.module,
        recut: recutForParts(texts.recut, recut, form.sceneId, share.dur, [
          { id: form.sceneId, dur: first },
          { id, dur: second },
        ]),
      },
    },
  };
}
