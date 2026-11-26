import { MAX_CLIP_CAPTION_CHARS, MAX_CLIP_CAPTIONS, MAX_SOUNDING_CLIPS, clipSpeed, filmSeconds, heardAtSpeed, playSeconds } from '@open-artifact/motion-core';
import type { ClipSoundUse, FilmSeconds } from '@open-artifact/motion-core';
import { film } from './film.ts';
import type { SceneClock } from './recut.ts';
import type { VideoClock } from './video-sync.ts';

/**
 * What `kit.video` asks of a clip beyond where it sits: which of its seconds play when, whether its sound plays, and
 * the words said in it. The stage keeps the picture at its second; the host plays the sound from the list 'ready'
 * carries, so a clip made after the film loaded is silent.
 */

/** A clip's timing as kit.video wrote it on the element: film second `start`, its own second `from`, `span` film seconds, `speed`. */
export interface ClipTiming {
  start: number;
  from: number;
  span: number;
  speed: number;
}

/** Where a clip's sound may play: its scene's stretch of film seconds, and whether the scene failed to come up. */
export interface ClipScene {
  lo: number;
  hi: number;
  gone(): boolean;
}

/** A clip that sounds, in film seconds: heard from `lo` to `hi`, where it shows its second `from + (t − start) × speed`. */
export interface SoundingClip {
  name: string;
  level: number;
  loop: boolean;
  start: number;
  from: number;
  speed: number;
  lo: number;
  hi: number;
}

/** A caption of a clip on the film's clock. */
export interface ClipCaption {
  at: FilmSeconds;
  dur: number;
  text: string;
}

interface Heard {
  video: HTMLVideoElement;
  name: string;
  level: number;
}

interface Said {
  video: HTMLVideoElement;
  lines: readonly unknown[];
}

const heard: Heard[] = [];
const said: Said[] = [];
const scenes = new WeakMap<HTMLVideoElement, ClipScene>();
/** Clips kit.seek has moved: their sound and words cannot follow the film's clock. */
const sought = new WeakSet<HTMLVideoElement>();
const told = new Set<string>();
/** A use shorter than this is not heard. */
const SHORTEST_SOUND_S = 0.05;

function warnOnce(key: string, message: string): void {
  if (told.has(key)) return;
  told.add(key);
  console.warn(message);
}

const positive = (value: unknown): number | null => {
  const n = Number(value);
  return value !== undefined && value !== null && n > 0 && Number.isFinite(n) ? n : null;
};

/** The data attributes kit.video writes for `start`, `from`, `dur` and `speed`; a speed out of range is said once. */
export function clipAttributes(options: { start?: unknown; from?: unknown; dur?: unknown; speed?: unknown }): Record<string, string> {
  const attrs: Record<string, string> = { 'data-start': String(Number(options.start) || 0) };
  const from = positive(options.from);
  const dur = positive(options.dur);
  if (from !== null) attrs['data-from'] = String(from);
  if (dur !== null) attrs['data-dur'] = String(dur);
  const given = options.speed;
  if (given !== undefined && given !== null) {
    const speed = clipSpeed(given);
    if (positive(given) === null) console.warn('kit.video: speed ' + String(given) + ' is not a number above 0, so the clip plays at speed 1');
    else if (speed !== Number(given)) console.warn('kit.video: speed ' + String(given) + ' is outside 0.25 to 4, so the clip plays at ' + speed);
    if (speed !== 1) attrs['data-speed'] = String(speed);
  }
  return attrs;
}

export function clipTiming(video: HTMLVideoElement): ClipTiming {
  return {
    start: Number(video.getAttribute('data-start')) || 0,
    from: positive(video.getAttribute('data-from')) ?? 0,
    span: positive(video.getAttribute('data-dur')) ?? Infinity,
    speed: clipSpeed(video.getAttribute('data-speed')),
  };
}

/** The clip's own second at film time `t` (before looping or holding at its end), and whether its `dur` has it on. */
export function clipSecondAt(video: HTMLVideoElement, t: number): { second: number; on: boolean } {
  const { start, from, span, speed } = clipTiming(video);
  const into = t - start;
  return { second: from + Math.min(Math.max(into, 0), span) * speed, on: into >= 0 && into < span };
}

/** The clock a clip plays on: the film's, faster or slower by its speed. */
export function clipClock(video: HTMLVideoElement, clock: VideoClock): VideoClock {
  const { speed } = clipTiming(video);
  return speed === 1 ? clock : { ...clock, rate: (clock.retimed ? clock.rate : 1) * speed, retimed: true };
}

/** Its speed for the element: picture only, so WebKit keeps every frame as the rate moves off 1. */
export function prepareClip(video: HTMLVideoElement): void {
  if (clipTiming(video).speed !== 1) video.preservesPitch = false;
}

/** kit.video's `sound` and `captions`, noted for the report that goes with 'ready'. `name`: the asset, or null for a URL. */
export function noteClip(video: HTMLVideoElement, name: string | null, sound: unknown, captions: unknown): void {
  if (sound !== undefined && sound !== null && sound !== false) {
    const level = sound === true ? 1 : Number(sound);
    if (name === null) warnOnce('url', 'kit.video: sound plays only from an asset given by its name, so this clip is silent');
    else if (film.loaded) warnOnce('late:' + name, 'kit.video: ' + name + ' was made after the film loaded, so it is silent. Make a clip with sound in init');
    else if (!(level > 0 && level <= 1)) warnOnce('level:' + name, 'kit.video: sound is true or a level from 0 to 1, so ' + name + ' is silent');
    else if (!heardAtSpeed(clipTiming(video).speed))
      warnOnce(
        'speed:' + name,
        'kit.video: ' + name + ' plays at speed ' + clipTiming(video).speed + ', where its sound is not heard (0.5 to 2 only), so it is silent and the score stays up',
      );
    else {
      heard.push({ video, name, level });
      video.preservesPitch = false;
    }
  }
  if (captions === undefined || captions === null) return;
  if (film.loaded) warnOnce('late-said', 'kit.video: captions of a clip made after the film loaded are not shown. Make the clip in init');
  else if (!Array.isArray(captions)) warnOnce('said-list', 'kit.video: captions are a list of { at, dur, text }, so this clip has none');
  else said.push({ video, lines: captions });
}

/** Made in a scene: its sound and words stay within the scene. */
export function clipInScene(video: HTMLVideoElement, scene: ClipScene): void {
  scenes.set(video, scene);
}

/** kit.seek moved the clip: its sound and words, which cannot follow, are dropped (said once). */
export function noteSeek(video: HTMLVideoElement): void {
  sought.add(video);
  if (film.loaded && heard.some((each) => each.video === video))
    warnOnce('seek-late', 'kit.seek: a clip with sound cannot be moved by kit.seek; its sound follows kit.video’s start, from and dur alone');
}

/** The film seconds a clip is on for: from its start to its dur, its scene's end and the film's end. */
function onFor(video: HTMLVideoElement, duration: number): { lo: number; hi: number } | null {
  const scene = scenes.get(video);
  if (scene?.gone()) return null;
  const { start, span } = clipTiming(video);
  const lo = Math.max(start, scene ? scene.lo : 0);
  const hi = Math.min(duration, scene ? scene.hi : Infinity, start + span);
  return hi > lo ? { lo, hi } : null;
}

/** The clips that sound, in film seconds, as the film loaded. */
export function soundingClips(duration: number): SoundingClip[] {
  const out: SoundingClip[] = [];
  for (const each of heard) {
    if (sought.has(each.video)) {
      warnOnce('seek:' + each.name, 'kit.seek: ' + each.name + ' is moved by kit.seek, which its sound cannot follow, so it is silent. Use kit.video’s start, from and dur');
      continue;
    }
    const on = onFor(each.video, duration);
    if (on === null) continue;
    const { start, from, speed } = clipTiming(each.video);
    out.push({ name: each.name, level: each.level, loop: each.video.loop, start, from, speed, lo: on.lo, hi: on.hi });
    if (out.length === MAX_SOUNDING_CLIPS) break;
  }
  return out;
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * The sounding clips on the play clock: each scene part a clip plays in becomes a use, at the part's rate, so a scene a
 * person made longer plays its clip's sound slower, at the same pitch. Two uses of one file at one moment and second
 * sound once, at the louder level.
 */
export function playedClipSound(clips: readonly SoundingClip[], clock: SceneClock): ClipSoundUse[] {
  const uses: ClipSoundUse[] = [];
  for (const clip of clips) {
    for (const part of clock.parts) {
      const x0 = Math.max(clip.lo, part.a0);
      const x1 = Math.min(clip.hi, part.a0 + part.nat);
      if (!(x1 - x0 >= SHORTEST_SOUND_S) || !(part.nat > 0) || !(part.dur > 0)) continue;
      const stretch = part.dur / part.nat;
      const use: ClipSoundUse = {
        name: clip.name,
        level: clip.level,
        loop: clip.loop,
        at: playSeconds(round6(part.p0 + (x0 - part.a0) * stretch)),
        dur: round6((x1 - x0) * stretch),
        second: round6(clip.from + (x0 - clip.start) * clip.speed),
        rate: round6(clip.speed / stretch),
      };
      const twin = uses.find(
        (other) => other.name === use.name && Math.abs(other.at - use.at) < 1e-3 && Math.abs(other.second - use.second) < 1e-3 && Math.abs(other.rate - use.rate) < 1e-6,
      );
      if (twin === undefined) uses.push(use);
      else {
        twin.level = Math.max(twin.level, use.level);
        twin.dur = Math.max(twin.dur, use.dur);
      }
    }
  }
  return uses;
}

/**
 * The clips' captions in film seconds: a line said at the clip's second `at` shows at `start + (at − from) / speed`
 * for `dur / speed`, only while the clip is on, and once more on each pass of a looping clip whose length is known.
 */
export function clipCaptions(duration: number): ClipCaption[] {
  const out: ClipCaption[] = [];
  for (const each of said) {
    const { video } = each;
    if (sought.has(video)) {
      warnOnce('seek-said', 'kit.video: a clip moved by kit.seek shows no captions. Use kit.video’s start, from and dur');
      continue;
    }
    const on = onFor(video, duration);
    if (on === null) continue;
    const { start, from, speed } = clipTiming(video);
    const length = video.duration;
    const known = length > 0 && Number.isFinite(length);
    if (video.loop && !known) warnOnce('loop-said', 'kit.video: the length of a looping clip was not known when the film loaded, so its captions show on its first pass only');
    const passes = video.loop && known ? Math.max(1, Math.ceil(((on.hi - start) * speed + from) / length)) : 1;
    each.lines.forEach((entry, i) => {
      const line = entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const { at, dur, text } = line;
      if (typeof at !== 'number' || typeof dur !== 'number' || !(at >= 0) || !(dur > 0) || typeof text !== 'string' || !text.trim()) {
        console.warn(
          'kit.video: caption ' + (i + 1) + ' is left out. It needs { at, dur, text }: the second of the clip where it is said, for how many seconds, and the words',
        );
        return;
      }
      for (let pass = 0; pass < passes && out.length < MAX_CLIP_CAPTIONS; pass++) {
        const second = at + pass * (passes > 1 ? length : 0);
        if (second < from) continue;
        const shown = Math.max(on.lo, start + (second - from) / speed);
        const gone = Math.min(on.hi, start + (second - from + dur) / speed);
        if (gone > shown) out.push({ at: filmSeconds(shown), dur: gone - shown, text: text.slice(0, MAX_CLIP_CAPTION_CHARS) });
      }
    });
  }
  return out;
}

/** The seconds of the file a sounding clip plays: from `from` at its first heard moment to where it stops. */
function heardSeconds(clip: SoundingClip): [number, number] {
  return [clip.from + (clip.lo - clip.start) * clip.speed, clip.from + (clip.hi - clip.start) * clip.speed];
}

/**
 * Narration lines that play seconds of a clip (`audio` its name, `from` its second) which kit.video's `sound` plays
 * too, one message each: a second of a clip is heard from one of the two, never both.
 */
export function narrationOverlaps(narration: unknown, clips: readonly SoundingClip[]): string[] {
  const lines = narration !== null && typeof narration === 'object' ? (narration as Record<string, unknown>)['lines'] : null;
  if (!Array.isArray(lines) || clips.length === 0) return [];
  const out: string[] = [];
  lines.forEach((entry: unknown, i) => {
    const line = entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const { audio, from, dur } = line;
    if (typeof audio !== 'string' || typeof from !== 'number' || typeof dur !== 'number' || !(dur > 0)) return;
    for (const clip of clips) {
      if (clip.name !== audio) continue;
      const [a, b] = heardSeconds(clip);
      const both = clip.loop ? dur : Math.min(b, from + dur) - Math.max(a, from);
      if (!(both > SHORTEST_SOUND_S)) continue;
      out.push(
        'narration line ' +
          (i + 1) +
          ' plays seconds of ' +
          JSON.stringify(audio) +
          ' that its kit.video sound plays too, so they are heard twice: give a clip with sound no narration line for those seconds, or take sound off the clip',
      );
      break;
    }
  });
  return out;
}
