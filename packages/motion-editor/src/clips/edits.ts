/**
 * Trimming and splitting a video scene by hand (and adding one, `add-video.ts`). Each is one change of several documents (the scene's module,
 * `scenes.json`, maybe `recut.json` and a new module) written at once, and one undo step that puts them back only
 * while nothing else has changed them since.
 */

import { announce } from '@open-artifact/editor-kit';
import type { DocumentValue } from '@open-artifact/live-store';
import { toast } from '@open-artifact/ui';
import {
  MODULES_COLLECTION,
  RECUT_MODULE,
  RETOUCHED_MODULE,
  SCENES_MODULE,
  isModuleDocument,
  moduleDocumentPath,
  sceneModuleName,
  splitClipScene,
  trimClipScene,
  type ClipSceneTexts,
  type ClipSplitBlock,
} from '@open-artifact/motion-core';
import { pushUndo, type UndoDeclined } from '../engine/undo.ts';
import { filmSource, writeFilmDocuments, type FilmDocuments } from '../host/live-film.ts';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { agentName, useWorking } from '../stores/working.ts';
import { knownClipLength, sceneClip } from './scene-clip.ts';
import * as words from './words.ts';

type Changes = Map<string, DocumentValue | null>;

/** Two stored values say the same: a module by its text, anything else as JSON. */
function sameDocument(a: DocumentValue | null | undefined, b: DocumentValue | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (isModuleDocument(a) && isModuleDocument(b)) return a.text === b.text && a.kind === b.kind;
  return JSON.stringify(a) === JSON.stringify(b);
}

const stillIs = (documents: FilmDocuments, state: Changes): boolean => [...state].every(([path, value]) => sameDocument(documents.get(path), value));

function moduleValue(documents: FilmDocuments, name: string, text: string | null): DocumentValue | null {
  if (text === null) return null;
  const current = documents.get(moduleDocumentPath(name));
  return { ...(isModuleDocument(current) ? current : { kind: name.endsWith('.json') ? 'json' : 'js' }), text };
}

/** The module documents for these texts (`null`: no module), keeping each module's other fields. */
export function moduleDocuments(modules: ReadonlyMap<string, string | null>, documents: FilmDocuments = filmSource.documents()): Changes {
  return new Map([...modules].map(([name, text]) => [moduleDocumentPath(name), moduleValue(documents, name, text)]));
}

/** Puts `next` in place of `expected`; declines while the agent works, or when something else changed it since. */
function swap(expected: Changes, next: Changes, stale: string, working: string): UndoDeclined | undefined {
  if (useWorking.getState().activity === 'working') return { said: working, keep: true };
  if (!stillIs(filmSource.documents(), expected)) return { said: stale, keep: false };
  if (!writeFilmDocuments(next)) return { said: words.NOT_WRITTEN, keep: true };
  return undefined;
}

/** Writes the documents at once and makes them one undo step; `false` when the page could not write them. */
export function writeStep(next: ReadonlyMap<string, DocumentValue | null>, label: string, stale: string): boolean {
  const documents = filmSource.documents();
  const before: Changes = new Map();
  const after: Changes = new Map();
  for (const [path, value] of next) {
    const was = documents.get(path) ?? null;
    if (sameDocument(was, value)) continue;
    before.set(path, was);
    after.set(path, value);
  }
  if (after.size === 0) return true;
  if (!writeFilmDocuments(after)) {
    toast.add({ title: words.NOT_WRITTEN });
    return false;
  }
  pushUndo({
    label,
    undo: () => swap(after, before, stale, words.UNDO_WHILE_WORKING(agentName())),
    redo: () => swap(before, after, stale, words.REDO_WHILE_WORKING(agentName())),
  });
  return true;
}

const textChanges = (sceneId: string, texts: ClipSceneTexts): Map<string, string | null> =>
  new Map([
    [SCENES_MODULE, texts.scenes],
    [sceneModuleName(sceneId), texts.module],
    [RECUT_MODULE, texts.recut],
  ]);

/** Plays the scene's video from `from` to `to` (its own seconds); `false` when nothing could be written. */
export function trimScene(sceneId: string, from: number, to: number, number: number): boolean {
  const clip = sceneClip(sceneId);
  if (clip === null) return false;
  const result = trimClipScene(clip.texts, clip.form, from, to, { length: knownClipLength(clip.ref) });
  if (!result.ok) {
    if (result.reason === 'long') toast.add({ title: words.TRIM_TOO_LONG });
    else if (result.reason === 'past-end') toast.add({ title: words.TRIM_PAST_END });
    return false;
  }
  if (result.texts === clip.texts) return true;
  if (!writeStep(moduleDocuments(textChanges(sceneId, result.texts)), words.TRIM, words.TRIM_STALE)) return false;
  announce(words.sceneTrimmed(number));
  return true;
}

export type SplitBlock = ClipSplitBlock | 'wait';

/** The scene's own second the playhead is at, or `null` when it is not in the scene. */
function playheadInScene(sceneId: string): number | null {
  const part = useFilm.getState().clock?.parts.find((candidate) => candidate.key === sceneId);
  if (part === undefined || !(part.playDur > 0)) return null;
  const into = usePlayback.getState().time - part.playStart;
  return into < 0 || into > part.playDur ? null : (into * part.filmDur) / part.playDur;
}

function splitWith(sceneId: string, write: boolean): SplitBlock | null {
  const clip = sceneClip(sceneId);
  if (clip === null) return 'other';
  const documents = filmSource.documents();
  const listed = useFilm.getState().scenes?.scenes.find((scene) => scene.id === sceneId);
  const part = useFilm.getState().clock?.parts.find((candidate) => candidate.key === sceneId);
  // The film on show is behind the documents (a change is still loading): its playhead says nothing yet.
  if (useFilm.getState().stage !== 'ready' || listed === undefined || part === undefined || Math.abs(listed.dur - part.filmDur) > 0.001) return 'wait';
  const prefix = `${MODULES_COLLECTION}/`;
  const modules = new Set([...documents.keys()].flatMap((path) => (path.startsWith(prefix) ? [path.slice(prefix.length)] : [])));
  const retouched = documents.get(moduleDocumentPath(RETOUCHED_MODULE));
  const film = { modules, retouched: isModuleDocument(retouched) ? retouched.text : null };
  const result = splitClipScene(clip.texts, clip.form, film, playheadInScene(sceneId) ?? Number.NaN);
  if (!result.ok) return result.reason;
  if (!write) return null;
  const changes = textChanges(sceneId, result.split.texts);
  changes.set(sceneModuleName(result.split.id), result.split.module);
  if (!writeStep(moduleDocuments(changes), words.SPLIT, words.SPLIT_STALE)) return 'other';
  announce(words.SPLIT_DONE);
  return null;
}

/** Why the scene cannot be split at the playhead now, or `null`. */
export const splitBlock = (sceneId: string): SplitBlock | null => splitWith(sceneId, false);

/** Splits the scene at the playhead; why not, said aloud, when it cannot. */
export function splitScene(sceneId: string): boolean {
  const block = splitWith(sceneId, true);
  if (block !== null) announceSplitBlock(block);
  return block === null;
}

export const splitBlockWords = (block: SplitBlock): string => {
  switch (block) {
    case 'place':
      return words.SPLIT_PLACE;
    case 'wait':
      return words.SPLIT_WAIT;
    case 'looks':
      return words.SPLIT_LOOKS;
    case 'bare':
      return words.SPLIT_BARE;
    case 'other':
      return words.SPLIT_OTHER;
    default: {
      const never: never = block;
      return never;
    }
  }
};

export function announceSplitBlock(block: SplitBlock): void {
  const said = splitBlockWords(block);
  announce(said);
  toast.add({ title: said });
}
