import { isPlainObject, parseJsonRecord, type JsonObject } from '../json.ts';
import { MAX_FILM_SECONDS } from '../limits.ts';
import { isAllowedRecutDuration, parseRecutRecord, SCENE_DURATION_EPSILON, serializeRecutRecord, type RecutEntry, type RecutRecord } from '../records/recut.ts';
import { readVersionOneRecord } from '../records/common.ts';
import { filmSeconds, playSeconds } from '../units.ts';
import { roundToMs } from './form.ts';

/** `scenes.json` as written, kept whole so a change touches only what it means to. */
export interface RawScenes {
  record: JsonObject;
  scenes: JsonObject[];
  /** The text had line breaks: it is written back indented. */
  indented: boolean;
}

export function readRawScenes(text: string): RawScenes | null {
  const record = parseJsonRecord(text);
  if (record === null || !Array.isArray(record.scenes) || !record.scenes.every(isPlainObject)) return null;
  return { record, scenes: record.scenes as JsonObject[], indented: text.includes('\n') };
}

export function writeRawScenes(raw: RawScenes, scenes: JsonObject[]): string {
  const record = { ...raw.record, scenes };
  return raw.indented ? `${JSON.stringify(record, null, 2)}\n` : JSON.stringify(record);
}

const sceneDur = (scene: JsonObject): number => (typeof scene.dur === 'number' && Number.isFinite(scene.dur) ? scene.dur : 0);

/** The recut's length for a scene when it still counts: its `was` is the scene's length and its bounds allow it. */
function countingDur(entry: RecutEntry, dur: number): { was: number; v: number } | null {
  return entry.dur !== undefined && Math.abs(entry.dur.was - dur) <= SCENE_DURATION_EPSILON && isAllowedRecutDuration(dur, entry.dur.v)
    ? entry.dur
    : null;
}

const entryFor = (record: RecutRecord, id: string): RecutEntry | undefined =>
  record.scenes.find((entry) => entry.target.by === 'id' && entry.target.id === id);

/** How much of the film the other scenes take, in the film's seconds and as played. */
export interface SceneShare {
  index: number;
  dur: number;
  othersFilm: number;
  othersPlayed: number;
  /** Played seconds per film second the recut gives this scene, when it gives it a length. */
  playRatio: number | null;
}

export function sceneShare(raw: RawScenes, recut: RecutRecord, sceneId: string): SceneShare | null {
  const index = raw.scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) return null;
  let othersFilm = 0;
  let othersPlayed = 0;
  let playRatio: number | null = null;
  raw.scenes.forEach((scene, at) => {
    const dur = sceneDur(scene);
    const entry = typeof scene.id === 'string' ? entryFor(recut, scene.id) : undefined;
    const counted = entry === undefined ? null : countingDur(entry, dur);
    if (at === index) {
      if (counted !== null && counted.was > 0) playRatio = counted.v / counted.was;
      return;
    }
    othersFilm += dur;
    othersPlayed += counted?.v ?? dur;
  });
  return { index, dur: sceneDur(raw.scenes[index]!), othersFilm, othersPlayed, playRatio };
}

/** The longest the scene may be, in film seconds, with the rest of the film as it is. */
export function longestSceneDur(share: SceneShare): number {
  const byFilm = MAX_FILM_SECONDS - share.othersFilm;
  const byPlay = share.playRatio === null ? Infinity : (MAX_FILM_SECONDS - share.othersPlayed) / share.playRatio;
  return Math.max(0, Math.min(byFilm, byPlay));
}

/** The recut record as it reads, or `null` for a record of another version the page leaves alone. */
export function readRecut(text: string | null): RecutRecord | null {
  if (text === null) return { scenes: [] };
  return readVersionOneRecord(text, 'scenes') === null ? null : parseRecutRecord(text);
}

/** A recut length moved to a scene now `dur` long at the same pace; dropped when its bounds no longer allow it. */
function rescaled(length: { was: number; v: number }, dur: number): { was: number; v: number } | null {
  const v = roundToMs((dur * length.v) / length.was);
  return isAllowedRecutDuration(dur, v) && v <= MAX_FILM_SECONDS ? { was: dur, v } : null;
}

/**
 * The recut with the scene's entry following it to its new lengths: one length per id in `parts` (a split gives
 * two), its name copied to each. The text as it was when nothing changes.
 */
export function recutForParts(text: string | null, record: RecutRecord, sceneId: string, oldDur: number, parts: ReadonlyArray<{ id: string; dur: number }>): string | null {
  const entry = entryFor(record, sceneId);
  if (entry === undefined) return text;
  const counted = countingDur(entry, oldDur);
  const replacements: RecutEntry[] = parts.flatMap(({ id, dur }) => {
    const length = counted === null ? (id === sceneId ? (entry.dur ?? null) : null) : rescaled(counted, dur);
    const next: RecutEntry = { target: { by: 'id', id } };
    if (length !== null) next.dur = { was: filmSeconds(length.was), v: playSeconds(length.v) };
    if (entry.name !== undefined) next.name = { ...entry.name };
    return next.dur !== undefined || next.name !== undefined ? [next] : [];
  });
  const scenes = record.scenes.flatMap((item) => (item === entry ? replacements : [item]));
  const same = scenes.length === record.scenes.length && scenes.every((item, index) => JSON.stringify(item) === JSON.stringify(record.scenes[index]));
  return same ? text : serializeRecutRecord({ ...record, scenes });
}
