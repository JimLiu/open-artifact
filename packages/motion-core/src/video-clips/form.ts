import { CLIP_SPEED_RANGE } from '../clip-sound.ts';
import { isSceneId } from '../names.ts';

/**
 * A scene that plays one stretch of an uploaded video, written so the page can move that stretch by hand:
 *
 *     const FROM = 12.5;          // the video's second the scene starts at
 *     const SPEED = 2;            // optional: the video's seconds per film second
 *     kit.scene('id', { … kit.video('asset', { from: FROM, speed: SPEED, … }) … });
 *
 * A trim changes FROM's number and the scene's `dur` in scenes.json; nothing else of the module.
 */
export interface ClipSceneForm {
  sceneId: string;
  /** The asset the scene's one `kit.video` plays. */
  asset: string;
  /** The video's second the scene starts at (FROM). */
  from: number;
  /** The video's seconds per film second: SPEED, else 1. */
  speed: number;
  hasSpeed: boolean;
  /** Nothing but the video: the scene can be cut in two. */
  bare: boolean;
}

/** Where the number of line 1 sits in the module's text. */
interface Header {
  from: number;
  speed: number | null;
  numberAt: number;
  numberEnd: number;
  body: string;
}

const FROM_LINE = /^const FROM = (\d+(?:\.\d+)?);(?:[ \t]*\/\/[^\n]*)?[ \t]*\r?$/;
const SPEED_LINE = /^const SPEED = (\d+(?:\.\d+)?);(?:[ \t]*\/\/[^\n]*)?[ \t]*\r?$/;
const FORBIDDEN_OPTIONS: readonly string[] = ['dur', 'start', 'loop', '__proto__'];
const SIMPLE_VALUE = /^(?:FROM|SPEED|true|false|null|-?\d+(?:\.\d+)?|'[^'\\\n]*'|"[^"\\\n]*")$/;
const MEMBER = /^\s*(?:([A-Za-z_$][\w$]*)|'([^'\\\n]*)'|"([^"\\\n]*)")\s*:\s*([\s\S]*?)\s*$/;

/** The text up to the first line break (or all of it) and what follows that break. */
function splitLine(text: string): [string, string, number] {
  const end = text.indexOf('\n');
  return end < 0 ? [text, '', text.length] : [text.slice(0, end), text.slice(end + 1), end + 1];
}

function readHeader(text: string): Header | null {
  const [first, rest, restAt] = splitLine(text);
  const fromMatch = FROM_LINE.exec(first);
  if (fromMatch === null) return null;
  const from = Number(fromMatch[1]);
  const numberAt = first.indexOf('=') + 2;
  const header: Header = { from, speed: null, numberAt, numberEnd: numberAt + fromMatch[1]!.length, body: rest };
  const [second, after] = splitLine(rest);
  const speedMatch = SPEED_LINE.exec(second);
  if (speedMatch !== null) {
    const speed = Number(speedMatch[1]);
    if (!(speed >= CLIP_SPEED_RANGE[0] && speed <= CLIP_SPEED_RANGE[1])) return null;
    header.speed = speed;
    header.body = after;
  }
  return Number.isFinite(from) && restAt > 0 ? header : null;
}

const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

/** A quoted name: `'x'` or `"x"` without escapes or line breaks; its text and where the quote closes. */
function quoted(text: string, at: number): { value: string; end: number } | null {
  const quote = text[at];
  if (quote !== "'" && quote !== '"') return null;
  const close = text.indexOf(quote, at + 1);
  if (close < 0) return null;
  const value = text.slice(at + 1, close);
  return /[\\\n]/.test(value) ? null : { value, end: close + 1 };
}

const skipSpace = (text: string, at: number): number => {
  while (at < text.length && /\s/.test(text[at]!)) at++;
  return at;
};

/**
 * The members of the object literal opening at `at`, split at its own commas, and where it closes; `null` for
 * anything but plain members (a spread, a template, a slash: a comment or a division the page will not read past).
 */
function objectMembers(text: string, at: number): { members: string[]; end: number } | null {
  if (text[at] !== '{') return null;
  const members: string[] = [];
  let depth = 0;
  let start = at + 1;
  for (let index = at + 1; index < text.length; index++) {
    const char = text[index]!;
    if (char === "'" || char === '"') {
      const string = quoted(text, index);
      if (string === null) return null;
      index = string.end - 1;
    } else if (char === '`' || char === '/') {
      return null;
    } else if (char === '(' || char === '[' || char === '{') {
      depth++;
    } else if (char === ')' || char === ']' || (char === '}' && depth > 0)) {
      depth--;
    } else if (char === '}') {
      members.push(text.slice(start, index));
      return { members: members.filter((member) => member.trim() !== ''), end: index + 1 };
    } else if (char === ',' && depth === 0) {
      members.push(text.slice(start, index));
      start = index + 1;
    }
  }
  return null;
}

/** The options of the scene's `kit.video` call as key → value text, when they read as plain members. */
function videoCall(body: string): { asset: string; options: Map<string, string> } | null {
  const calls = [...body.matchAll(/\bkit\s*\.\s*video\s*\(/g)];
  if (calls.length !== 1) return null;
  let at = skipSpace(body, calls[0]!.index + calls[0]![0].length);
  const asset = quoted(body, at);
  if (asset === null || asset.value === '') return null;
  at = skipSpace(body, asset.end);
  if (body[at] !== ',') return null;
  const object = objectMembers(body, skipSpace(body, at + 1));
  if (object === null || body[skipSpace(body, object.end)] !== ')') return null;
  const options = new Map<string, string>();
  for (const member of object.members) {
    if (member.includes('...')) return null;
    const match = MEMBER.exec(member);
    if (match === null) return null;
    const key = match[1] ?? match[2] ?? match[3]!;
    if (options.has(key) || FORBIDDEN_OPTIONS.includes(key) || match[4] === '') return null;
    options.set(key, match[4]!);
  }
  return { asset: asset.value, options };
}

function bareScene(body: string, sceneId: string, options: ReadonlyMap<string, string>): boolean {
  const shape =
    /^\s*kit\.scene\(\s*(['"])([a-z][a-z0-9-]*)\1\s*,\s*\{\s*init\s*\(\s*kit\s*\)\s*\{\s*kit\.stage\.append\(\s*kit\.video\(\s*(['"])[^'"\\\n]+\3\s*,\s*\{[^{}]*\}\s*\)\s*\)\s*;?\s*\}\s*,\s*render\s*\([\w\s,$]*\)\s*\{\s*\}\s*,?\s*\}\s*\)\s*;?\s*$/.exec(
      body,
    );
  return shape !== null && shape[2] === sceneId && [...options.values()].every((value) => SIMPLE_VALUE.test(value));
}

/**
 * The clip form of a scene's module, or `null` when the page cannot trim it: line 1 `const FROM = n;`, maybe a
 * `const SPEED = n;` line, then one `kit.scene` for this scene and one `kit.video` whose options are plain members
 * holding `from: FROM` (and `speed: SPEED` exactly when there is a SPEED line), with no `dur`, `start` or `loop`,
 * no `kit.seek`, and FROM and SPEED never set again. `videoMime` tells the asset's type.
 */
export function clipSceneForm(text: string, sceneId: string, videoMime: (asset: string) => string | undefined): ClipSceneForm | null {
  if (!isSceneId(sceneId)) return null;
  const header = readHeader(text);
  if (header === null) return null;
  const body = header.body;
  const scenes = [...body.matchAll(/\bkit\s*\.\s*scene\s*\(/g)];
  if (scenes.length !== 1) return null;
  const named = quoted(body, skipSpace(body, scenes[0]!.index + scenes[0]![0].length));
  if (named === null || named.value !== sceneId) return null;
  if (/\bkit\s*\.\s*seek\b/.test(body)) return null;
  if (count(body, /\b(?:const|let|var|function|class)\s+(?:FROM|SPEED)\b/g) > 0) return null;
  if (/\b(?:FROM|SPEED)\s*(?:=(?!=)|\+\+|--|[-+*%&|^]=)/.test(body)) return null;
  const call = videoCall(body);
  if (call === null || call.options.get('from') !== 'FROM') return null;
  if (header.speed === null ? call.options.has('speed') : call.options.get('speed') !== 'SPEED') return null;
  const mime = videoMime(call.asset);
  if (mime !== 'video/mp4' && mime !== 'video/webm') return null;
  return {
    sceneId,
    asset: call.asset,
    from: header.from,
    speed: header.speed ?? 1,
    hasSpeed: header.speed !== null,
    bare: bareScene(body, sceneId, call.options),
  };
}

/** Seconds rounded to the millisecond. */
export const roundToMs = (seconds: number): number => Math.round(seconds * 1000) / 1000;

/** The module with line 1's number set to `from` (rounded to the millisecond); everything else as it was. */
export function withClipFrom(text: string, from: number): string {
  const header = readHeader(text);
  if (header === null) return text;
  return text.slice(0, header.numberAt) + String(roundToMs(Math.max(0, from))) + text.slice(header.numberEnd);
}

/** The module with its `kit.scene` naming `next` in place of its scene's id, the quotes as they were. */
export function withSceneId(text: string, sceneId: string, next: string): string {
  return text.replace(/(\bkit\s*\.\s*scene\s*\(\s*)(['"])([a-z][a-z0-9-]*)\2/, (whole, call: string, quote: string, id: string) =>
    id === sceneId ? `${call}${quote}${next}${quote}` : whole,
  );
}
