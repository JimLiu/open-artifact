/**
 * What an image note may carry beyond its picture: a `crop` (how far the
 * picture is zoomed past filling the note, and where it sits), and a `video`
 * with its play settings. The editor writes these; reading `canvas.json`
 * keeps only valid values, and `check` names what it would drop.
 */

import { cleanNoteCss } from './note-css.ts';

/** How a picture fills its note: `zoom` past cover (1–50), `x`/`y` its alignment (0 left/top … 1 right/bottom). */
export interface NoteCrop {
  zoom: number;
  x: number;
  y: number;
}

/** Not cropped: filling the note, centred. */
export const UNCROPPED: NoteCrop = { zoom: 1, x: 0.5, y: 0.5 };
export const MAX_CROP_ZOOM = 50;

const round = (value: number, places: number): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};
const within = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** A crop in range and rounded (zoom to 4 places, x and y to 5), or undefined when it is not one or leaves the picture as it is. */
export function cleanCrop(raw: unknown): NoteCrop | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const crop = {
    zoom: round(within(value.zoom, 1, MAX_CROP_ZOOM, UNCROPPED.zoom), 4),
    x: round(within(value.x, 0, 1, UNCROPPED.x), 5),
    y: round(within(value.y, 0, 1, UNCROPPED.y), 5),
  };
  return isUncropped(crop) ? undefined : crop;
}

export function isUncropped(crop: NoteCrop): boolean {
  return crop.zoom === UNCROPPED.zoom && crop.x === UNCROPPED.x && crop.y === UNCROPPED.y;
}

/** A crop only applies while the picture covers its note: `object-fit` unset or `cover`. */
export function cropApplies(css: unknown): boolean {
  const fit = cleanNoteCss(css)?.['object-fit'];
  return fit === undefined || fit === 'cover';
}

/** An address an upload is served under: `/_blob/<id>`. */
export function isUploadAddress(value: unknown): value is string {
  return typeof value === 'string' && /^\/_blob\/[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** The one value each video setting is stored as; without it the setting is its default. */
export const VIDEO_SETTINGS = { videoStart: 'click', videoLoop: 'off', videoSound: 'on', videoCover: 'custom' } as const;
export type VideoSetting = keyof typeof VIDEO_SETTINGS;
const SETTING_KEYS = Object.keys(VIDEO_SETTINGS) as VideoSetting[];

/** How a video note plays: on its own (then always without sound), looping, with sound. */
export interface VideoOptions {
  autoplay: boolean;
  loop: boolean;
  sound: boolean;
}

export function videoOptions(note: { videoStart?: unknown; videoLoop?: unknown; videoSound?: unknown }): VideoOptions {
  const autoplay = note.videoStart !== VIDEO_SETTINGS.videoStart;
  return { autoplay, loop: note.videoLoop !== VIDEO_SETTINGS.videoLoop, sound: !autoplay && note.videoSound === VIDEO_SETTINGS.videoSound };
}

/** Keeps an image note's valid crop and video keys and drops the rest (in place). */
export function cleanNoteMedia(note: Record<string, unknown>): void {
  if (note.kind !== 'image') return;
  if ('crop' in note) {
    const crop = cropApplies(note.css) ? cleanCrop(note.crop) : undefined;
    if (crop) note.crop = crop;
    else delete note.crop;
  }
  if ('video' in note && !isUploadAddress(note.video)) delete note.video;
  for (const key of SETTING_KEYS) if (key in note && (note.video === undefined || note[key] !== VIDEO_SETTINGS[key])) delete note[key];
}

/** What reading an image note would drop of its crop and video keys: for `check`. */
export function droppedNoteMedia(note: Record<string, unknown>): ({ kind: 'crop' } | { kind: 'video' } | { kind: 'setting'; key: VideoSetting; value: string })[] {
  if (note.kind !== 'image') return [];
  const dropped: ReturnType<typeof droppedNoteMedia> = [];
  if (note.crop !== undefined && !cropApplies(note.css)) dropped.push({ kind: 'crop' });
  if (note.video !== undefined && !isUploadAddress(note.video)) dropped.push({ kind: 'video' });
  for (const key of SETTING_KEYS) {
    const value = note[key];
    if (value !== undefined && value !== VIDEO_SETTINGS[key]) dropped.push({ kind: 'setting', key, value: typeof value === 'string' ? value : JSON.stringify(value) });
  }
  return dropped;
}
