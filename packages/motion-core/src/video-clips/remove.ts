/**
 * Taking a video added on the page back out of the film, and putting it back. Only a scene still as the page wrote it
 * (a trim changes nothing but its FROM) can go, and never a film's only scene.
 */

import type { JsonObject } from '../json.ts';
import { MAX_ASSETS, MAX_FILM_SECONDS, MAX_MODULES, MAX_SCENES } from '../limits.ts';
import { SCENES_MODULE, sceneModuleName } from '../names.ts';
import { isVideoSceneId, videoSceneAsset, videoSceneModule } from './add.ts';
import { readRawScenes, writeRawScenes, type RawScenes } from './film.ts';
import { withClipFrom } from './form.ts';

const LEADING_FROM = /^const FROM = (\d+(?:\.\d+)?);\n/;

/** Whether a scene's module is still the one written when its video was added, whatever start a trim gave it since. */
export function isAddedVideoModule(sceneId: string, text: string): boolean {
  if (!isVideoSceneId(sceneId)) return false;
  const leading = LEADING_FROM.exec(text);
  return leading !== null && withClipFrom(videoSceneModule(sceneId), Number(leading[1])) === text;
}

/** The film as taking a video scene out, or putting it back, reads it. */
export interface VideoSceneFilm {
  /** The cut's code. */
  script: string;
  /** Every module's text, by module name (`scenes.json` among them). */
  modules: ReadonlyMap<string, string>;
  /** The names of the film's assets. */
  assets: ReadonlySet<string>;
}

/** A video scene taken out: all it takes to put it back where it was. */
export interface RemovedVideoScene {
  sceneId: string;
  /** Its line in `scenes.json`, as it was. */
  entry: JsonObject;
  /** The scene before it (`null`: it was first), and its place from 0 for when that one is gone too. */
  after: string | null;
  index: number;
  module: string;
  /** Its asset goes with it: nothing else in the film names that file. */
  assetGone: boolean;
}

const scenesOf = (film: VideoSceneFilm): RawScenes | null => {
  const text = film.modules.get(SCENES_MODULE);
  return text === undefined ? null : readRawScenes(text);
};

/** The new `scenes.json` without the scene, and what went; `null` when the page may not take it out. */
export function removeVideoScene(film: VideoSceneFilm, sceneId: string): { scenes: string; removed: RemovedVideoScene } | null {
  const raw = scenesOf(film);
  const moduleName = sceneModuleName(sceneId);
  const module = film.modules.get(moduleName);
  if (raw === null || module === undefined || !isAddedVideoModule(sceneId, module)) return null;
  const index = raw.scenes.findIndex((scene) => scene.id === sceneId);
  const entry = raw.scenes[index];
  if (entry === undefined || raw.scenes.length === 1) return null;
  const asset = videoSceneAsset(sceneId);
  const namedElsewhere = film.script.includes(asset) || [...film.modules].some(([name, text]) => name !== moduleName && text.includes(asset));
  const before = raw.scenes[index - 1]?.id;
  return {
    scenes: writeRawScenes(raw, raw.scenes.filter((scene) => scene !== entry)),
    removed: { sceneId, entry, after: typeof before === 'string' ? before : null, index, module, assetGone: film.assets.has(asset) && !namedElsewhere },
  };
}

/**
 * Why a scene taken out cannot go back now: `scenes`, `length` or `files` the film has no room for it, `taken` its id
 * or module is in use again, `form` the film is no longer one of scenes; `null` when it can.
 */
export type RestoreVideoBlock = 'scenes' | 'length' | 'files' | 'taken' | 'form';

export function restoreVideoBlock(film: VideoSceneFilm, removed: RemovedVideoScene): RestoreVideoBlock | null {
  const raw = scenesOf(film);
  if (raw === null) return 'form';
  if (film.modules.has(sceneModuleName(removed.sceneId)) || raw.scenes.some((scene) => scene.id === removed.sceneId)) return 'taken';
  if (raw.scenes.length + 1 > MAX_SCENES) return 'scenes';
  let seconds = typeof removed.entry.dur === 'number' ? removed.entry.dur : 0;
  for (const scene of raw.scenes) if (typeof scene.dur === 'number' && Number.isFinite(scene.dur)) seconds += scene.dur;
  if (seconds > MAX_FILM_SECONDS + 1e-9) return 'length';
  const assetBack = !film.assets.has(videoSceneAsset(removed.sceneId));
  if (film.modules.size + 1 > MAX_MODULES || (assetBack && film.assets.size + 1 > MAX_ASSETS)) return 'files';
  return null;
}

/** The `scenes.json` with the scene back after the one it followed, else at its old place; `null` when it cannot go back. */
export function restoreVideoScene(film: VideoSceneFilm, removed: RemovedVideoScene): string | null {
  const raw = scenesOf(film);
  if (raw === null || restoreVideoBlock(film, removed) !== null) return null;
  const ids = raw.scenes.map((scene) => scene.id);
  const follows = removed.after === null ? -1 : ids.indexOf(removed.after);
  const scenes = [...raw.scenes];
  scenes.splice(follows < 0 ? Math.min(removed.index, scenes.length) : follows + 1, 0, removed.entry);
  return writeRawScenes(raw, scenes);
}
