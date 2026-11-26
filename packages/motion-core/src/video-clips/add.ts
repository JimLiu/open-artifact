import { FILM_SCHEMA_VERSION, MAX_ASSETS, MAX_FILM_SECONDS, MAX_FILM_SIDE, MAX_MODULES, MAX_SCENES, MIN_FILM_SIDE } from '../limits.ts';
import { isSceneId } from '../names.ts';
import { readRawScenes, writeRawScenes } from './film.ts';
import { roundToMs } from './form.ts';
import { MIN_CLIP_SCENE_SECONDS } from './trim.ts';

/** Scenes added from a video file on the page are called `video-` and six letters or digits. */
export const VIDEO_SCENE_PREFIX = 'video-';
/** The longest part of a video one add keeps, in seconds. */
export const MAX_ADDED_VIDEO_SECONDS = 60;
/** The most scenes a film may have that were added from a video file. */
export const MAX_VIDEO_SCENES = 12;
/** What an added scene is called until someone renames it. */
export const VIDEO_SCENE_NAME = 'Video';
/** The cut of a film made of scenes. */
export const SCENES_CUT = 'window.CUT = kit.scenes();';
/** The long side of a film started from a video. */
export const VIDEO_FILM_LONG_SIDE = 1920;
export const VIDEO_FILM_FPS = 30;
export const VIDEO_FILM_BACKGROUND = '#000000';

const VIDEO_STYLE = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain';
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const isVideoSceneId = (id: string): boolean => new RegExp(`^${VIDEO_SCENE_PREFIX}[a-z0-9]{6}$`).test(id);

/** The asset an added scene plays. */
export const videoSceneAsset = (sceneId: string): string => `${sceneId}.mp4`;

/** A fresh `video-` id no scene, module or asset uses; `null` if a few tries all collide. */
export function newVideoSceneId(taken: (id: string) => boolean, random: () => number = Math.random): string | null {
  for (let attempt = 0; attempt < 32; attempt++) {
    let tail = '';
    for (let index = 0; index < 6; index++) tail += ID_CHARS[Math.floor(random() * ID_CHARS.length) % ID_CHARS.length];
    const id = VIDEO_SCENE_PREFIX + tail;
    if (isSceneId(id) && !taken(id)) return id;
  }
  return null;
}

/** An added scene's module: its video filling the frame, with its sound, from its first second (a bare clip scene). */
export function videoSceneModule(sceneId: string): string {
  const asset = JSON.stringify(videoSceneAsset(sceneId));
  return `const FROM = 0;\nkit.scene(${JSON.stringify(sceneId)}, {\n  init(kit) {\n    kit.stage.append(kit.video(${asset}, { sound: true, from: FROM, style: '${VIDEO_STYLE}' }));\n  },\n  render() {},\n});\n`;
}

/** A film's frame for a video `width` × `height`: its long side 1920, the video's shape, even sides within bounds. */
export function videoFilmSize(width: number, height: number): { width: number; height: number } {
  const even = (value: number): number => Math.min(MAX_FILM_SIDE, Math.max(MIN_FILM_SIDE, 2 * Math.round(value / 2)));
  if (!(width > 0 && height > 0)) return { width: VIDEO_FILM_LONG_SIDE, height: even((VIDEO_FILM_LONG_SIDE * 9) / 16) };
  return width >= height
    ? { width: VIDEO_FILM_LONG_SIDE, height: even((VIDEO_FILM_LONG_SIDE * height) / width) }
    : { width: even((VIDEO_FILM_LONG_SIDE * width) / height), height: VIDEO_FILM_LONG_SIDE };
}

/** What the film is as far as adding a video goes. */
export interface AddVideoFilm {
  /** The cut's code ('' for none). */
  script: string;
  /** `scenes.json`'s text, if any. */
  scenes: string | null;
  moduleCount: number;
  assetCount: number;
}

/** Why no video can be added: `files` no room for another module or asset, `scenes` the film has as many as it may, `videos` as many added videos, `length` no half second left, `form` not a film of scenes. */
export type AddVideoBlock = 'files' | 'scenes' | 'videos' | 'length' | 'form';
export type AddVideoRoom = { ok: true; longest: number; blank: boolean } | { ok: false; reason: AddVideoBlock };

const blankScript = (script: string): boolean => script.trim() === '';

/** Whether a video can be added, and the longest part one add may keep. */
export function addVideoRoom(film: AddVideoFilm): AddVideoRoom {
  const blank = blankScript(film.script);
  const raw = film.scenes === null ? null : readRawScenes(film.scenes);
  if (!blank && raw === null) return { ok: false, reason: 'form' };
  if (film.moduleCount + 1 > MAX_MODULES || film.assetCount + 1 > MAX_ASSETS) return { ok: false, reason: 'files' };
  const scenes = raw?.scenes ?? [];
  if (scenes.length >= MAX_SCENES) return { ok: false, reason: 'scenes' };
  if (scenes.filter((scene) => typeof scene.id === 'string' && isVideoSceneId(scene.id)).length >= MAX_VIDEO_SCENES) return { ok: false, reason: 'videos' };
  const used = scenes.reduce((sum, scene) => sum + (typeof scene.dur === 'number' && Number.isFinite(scene.dur) ? scene.dur : 0), 0);
  const longest = roundToMs(Math.min(MAX_ADDED_VIDEO_SECONDS, MAX_FILM_SECONDS - used));
  if (longest < MIN_CLIP_SCENE_SECONDS) return { ok: false, reason: 'length' };
  return { ok: true, longest, blank: blank && raw === null };
}

export interface AddedVideoScene {
  id: string;
  /** Film seconds. */
  dur: number;
  /** The video's frame, to size a film started from it. */
  width: number;
  height: number;
  /** Put it after this scene; `null`: last. */
  after: string | null;
}

/** The documents an add writes, as module texts and the cut. */
export interface AddedVideoTexts {
  /** The cut, when the film had none. */
  script: string | null;
  scenes: string;
  module: string;
  /** Where the scene is, from 0. */
  index: number;
}

/** The film with the scene added (a film with no cut yet starts as a film of scenes); `null` when it cannot be. */
export function addVideoScene(film: AddVideoFilm, scene: AddedVideoScene): AddedVideoTexts | null {
  const room = addVideoRoom(film);
  if (!room.ok || !isSceneId(scene.id) || scene.dur > room.longest + 1e-9 || scene.dur < MIN_CLIP_SCENE_SECONDS) return null;
  const entry = { id: scene.id, name: VIDEO_SCENE_NAME, dur: roundToMs(scene.dur) };
  const module = videoSceneModule(scene.id);
  const raw = film.scenes === null ? null : readRawScenes(film.scenes);
  if (raw === null) {
    const size = videoFilmSize(scene.width, scene.height);
    const record = { v: FILM_SCHEMA_VERSION, stage: 'final', ...size, fps: VIDEO_FILM_FPS, background: VIDEO_FILM_BACKGROUND, scenes: [entry] };
    return { script: SCENES_CUT, scenes: `${JSON.stringify(record, null, 2)}\n`, module, index: 0 };
  }
  const ids = raw.scenes.map((item) => item.id);
  if (ids.includes(scene.id)) return null;
  // Right after the scene it follows; at the end when that scene is gone or none was named.
  const index = scene.after !== null && ids.includes(scene.after) ? ids.indexOf(scene.after) + 1 : ids.length;
  const scenes: typeof raw.scenes = [...raw.scenes];
  scenes.splice(index, 0, entry);
  return { script: blankScript(film.script) ? SCENES_CUT : null, scenes: writeRawScenes(raw, scenes), module, index };
}

/** Whether a file's first bytes look like an MP4/MOV (ISO boxes) or a WebM/Matroska file. */
export function looksLikeVideoFile(head: Uint8Array): boolean {
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true;
  if (head.length < 8) return false;
  const box = String.fromCharCode(head[4]!, head[5]!, head[6]!, head[7]!);
  return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(box);
}
