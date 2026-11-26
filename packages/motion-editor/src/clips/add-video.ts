/**
 * Adding a video from a file: pick a file, choose the part to keep, and it is converted to an MP4 that fits the
 * upload limit, stored, and added as a scene that shows it (after the chosen scene, else last). A film with nothing
 * in it yet becomes a film of scenes with this one. One undo step takes the scene back out.
 */

import { create } from 'zustand';
import { announce } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import type { DocumentValue } from '@open-artifact/live-store';
import {
  ASSETS_COLLECTION,
  FILM_SCRIPT_PATH,
  MIN_CLIP_SCENE_SECONDS,
  MODULES_COLLECTION,
  SCENES_MODULE,
  addVideoRoom,
  addVideoScene,
  assetDocumentPath,
  isFilmScriptDocument,
  isModuleDocument,
  moduleDocumentPath,
  newVideoSceneId,
  roundToMs,
  sceneModuleName,
  videoSceneAsset,
  type AddVideoBlock,
  type AddVideoFilm,
} from '@open-artifact/motion-core';
import { VideoPartError, convertVideoPart, readVideoFile, type VideoFileFacts } from '@open-artifact/motion-export';
import { filmSource, type FilmDocuments } from '../host/live-film.ts';
import { maybeSession } from '../host/session.ts';
import { agentName, useWorking } from '../stores/working.ts';
import { moduleDocuments, writeStep } from './edits.ts';
import * as words from './words.ts';

/** What a file chooser and a drop take. */
export const VIDEO_FILE_ACCEPT = 'video/*,.mov,.m4v,.mp4,.webm,.mkv';
const VIDEO_EXTENSIONS = /\.(mov|m4v|mp4|webm|mkv)$/i;

export const isVideoFileLike = (file: { name: string; type: string }): boolean => file.type.startsWith('video/') || VIDEO_EXTENSIONS.test(file.name);

type Phase = 'pick' | 'reading' | 'choose' | 'preparing' | 'saving' | 'added';

export interface AddVideoState {
  open: boolean;
  /** The scene to put it after; `null`: last. */
  after: string | null;
  phase: Phase;
  file: File | null;
  /** An object URL of the file, for the preview. */
  url: string | null;
  facts: VideoFileFacts | null;
  /** The part to keep, in the file's seconds. */
  start: number;
  end: number;
  /** The longest part one add may keep now. */
  longest: number;
  /** 0–1 through the conversion. */
  progress: number;
  error: string | null;
  /** The scene it became (from 1), and whether it is all the film has. */
  added: { scene: number; blank: boolean } | null;
}

const CLOSED: AddVideoState = {
  open: false,
  after: null,
  phase: 'pick',
  file: null,
  url: null,
  facts: null,
  start: 0,
  end: 0,
  longest: 0,
  progress: 0,
  error: null,
  added: null,
};

export const useAddVideo = create<AddVideoState>()(() => CLOSED);

let running: AbortController | null = null;

const prefix = (collection: string): string => `${collection}/`;
const count = (documents: FilmDocuments, collection: string): number => [...documents.keys()].filter((path) => path.startsWith(prefix(collection))).length;

function filmFor(documents: FilmDocuments): AddVideoFilm {
  const script = documents.get(FILM_SCRIPT_PATH);
  const scenes = documents.get(moduleDocumentPath(SCENES_MODULE));
  return {
    script: isFilmScriptDocument(script) ? script.code : '',
    scenes: isModuleDocument(scenes) ? scenes.text : null,
    moduleCount: count(documents, MODULES_COLLECTION),
    assetCount: count(documents, ASSETS_COLLECTION),
  };
}

const roomWords = (reason: AddVideoBlock): string => {
  switch (reason) {
    case 'files':
      return words.NO_ROOM_FILES;
    case 'scenes':
      return words.NO_ROOM_SCENES;
    case 'length':
      return words.NO_ROOM_LENGTH;
    case 'videos':
      return words.NO_ROOM_VIDEOS;
    case 'form':
      return words.NOT_SCENES;
    default: {
      const never: never = reason;
      return never;
    }
  }
};

/** The page can add videos here at all: it may write, and the host stores uploads. */
export function addVideoAvailable(): boolean {
  const current = maybeSession();
  return current !== null && current.assets !== null && current.canEdit && !current.inline && useWorking.getState().readOnlyReason === null;
}

/** Why no video can be added now, or `null` with the longest part one add may keep. */
function addBlock(): { said: string } | { longest: number; blank: boolean } {
  if (useWorking.getState().activity === 'working') return { said: words.AGENT_WORKING(agentName()) };
  const room = addVideoRoom(filmFor(filmSource.documents()));
  return room.ok ? { longest: room.longest, blank: room.blank } : { said: roomWords(room.reason) };
}

/** Whether the film is blank: nothing to play yet (the place to offer a video). */
export function filmIsBlank(documents: FilmDocuments = filmSource.documents()): boolean {
  const film = filmFor(documents);
  return film.script.trim() === '' && film.scenes === null;
}

/** Opens the dialog to add a video after scene `after` (`null`: last); or says why none can be added. */
export function openAddVideo(after: string | null): void {
  if (!addVideoAvailable()) return;
  const block = addBlock();
  closeAddVideo();
  if ('said' in block) {
    toast.add({ title: block.said });
    return;
  }
  useAddVideo.setState({ ...CLOSED, open: true, after, longest: block.longest });
}

export function closeAddVideo(): void {
  running?.abort();
  running = null;
  const { url } = useAddVideo.getState();
  if (url !== null) URL.revokeObjectURL(url);
  useAddVideo.setState(CLOSED);
}

/** Back to picking a file, keeping the dialog open. */
function backToPick(error: string): void {
  const { url } = useAddVideo.getState();
  if (url !== null) URL.revokeObjectURL(url);
  useAddVideo.setState({ phase: 'pick', file: null, url: null, facts: null, start: 0, end: 0, progress: 0, error });
}

const problemWords = (error: unknown): string => {
  if (!(error instanceof VideoPartError)) return words.COULDNT_ADD;
  switch (error.problem) {
    case 'not-video':
      return words.NOT_A_VIDEO;
    case 'unreadable':
      return words.CANT_READ;
    case 'no-encoder':
      return words.CANT_PREPARE;
    case 'too-large':
      return words.TOO_LONG_TO_STORE;
    case 'failed':
      return words.COULDNT_ADD;
    default: {
      const never: never = error.problem;
      return never;
    }
  }
};

/** Reads a picked or dropped file; anything but a video this browser reads is refused with a reason. */
export async function pickVideoFile(file: File): Promise<void> {
  if (!isVideoFileLike(file)) {
    backToPick(words.NOT_A_VIDEO);
    return;
  }
  const { url } = useAddVideo.getState();
  if (url !== null) URL.revokeObjectURL(url);
  useAddVideo.setState({ phase: 'reading', file, url: null, facts: null, error: null });
  let facts: VideoFileFacts;
  try {
    facts = await readVideoFile(file);
  } catch (error) {
    if (useAddVideo.getState().file === file) backToPick(problemWords(error));
    return;
  }
  const state = useAddVideo.getState();
  if (!state.open || state.file !== file) return;
  const end = roundToMs(Math.min(facts.duration, state.longest));
  useAddVideo.setState({ phase: 'choose', facts, url: URL.createObjectURL(file), start: 0, end });
}

/** Sets the part to keep, within the file, at least half a second and at most the longest allowed. */
export function setVideoPart(start: number, end: number, moved: 'start' | 'end'): void {
  const { facts, longest } = useAddVideo.getState();
  if (facts === null) return;
  const total = facts.duration;
  const shortest = Math.min(MIN_CLIP_SCENE_SECONDS, total);
  let from = Math.min(Math.max(0, start), total - shortest);
  let to = Math.min(Math.max(end, from + shortest), total);
  if (moved === 'start') {
    if (to - from > longest) to = from + longest;
    if (to - from < shortest) from = to - shortest;
  } else {
    to = Math.min(Math.max(end, shortest), total);
    from = Math.min(Math.max(0, start), to - shortest);
    if (to - from > longest) from = to - longest;
  }
  useAddVideo.setState({ start: roundToMs(from), end: roundToMs(to) });
}

/** The scene's place, from 1, once the film has it. */
function placeOf(documents: FilmDocuments, id: string): number {
  const scenes = documents.get(moduleDocumentPath(SCENES_MODULE));
  if (!isModuleDocument(scenes)) return 1;
  try {
    const list = (JSON.parse(scenes.text) as { scenes?: Array<{ id?: unknown }> }).scenes ?? [];
    return Math.max(1, list.findIndex((scene) => scene.id === id) + 1);
  } catch {
    return 1;
  }
}

/** Converts, stores and adds the chosen part. */
export async function addVideoPart(): Promise<void> {
  const state = useAddVideo.getState();
  const assets = maybeSession()?.assets ?? null;
  if (state.file === null || state.facts === null || state.phase !== 'choose' || assets === null) return;
  const block = addBlock();
  if ('said' in block) {
    useAddVideo.setState({ error: block.said });
    return;
  }
  const seconds = state.end - state.start;
  if (seconds > block.longest + 1e-6) {
    setVideoPart(state.start, state.start + block.longest, 'start');
    useAddVideo.setState({ longest: block.longest, error: words.TOO_LONG_TO_STORE });
    return;
  }
  const controller = new AbortController();
  running?.abort();
  running = controller;
  useAddVideo.setState({ phase: 'preparing', progress: 0, error: null });
  const fail = (said: string): void => {
    if (running !== controller) return;
    running = null;
    useAddVideo.setState({ phase: 'choose', progress: 0, error: said });
  };
  let part: Awaited<ReturnType<typeof convertVideoPart>>;
  try {
    part = await convertVideoPart(state.file, {
      start: state.start,
      end: state.end,
      facts: state.facts,
      signal: controller.signal,
      onProgress: (progress) => {
        if (running === controller) useAddVideo.setState({ progress });
      },
    });
  } catch (error) {
    if (!controller.signal.aborted) fail(problemWords(error));
    return;
  }
  if (running !== controller) return;
  useAddVideo.setState({ phase: 'saving' });
  const documents = filmSource.documents();
  const scenesNow = new Set([...documents.keys()]);
  const id = newVideoSceneId(
    (candidate) =>
      scenesNow.has(moduleDocumentPath(sceneModuleName(candidate))) ||
      scenesNow.has(assetDocumentPath(videoSceneAsset(candidate))) ||
      (filmFor(documents).scenes ?? '').includes(`"${candidate}"`),
  );
  if (id === null) {
    fail(words.COULDNT_ADD);
    return;
  }
  let url: string;
  try {
    url = (await assets.upload(new Blob([part.bytes], { type: 'video/mp4' }), { name: videoSceneAsset(id) })).url;
  } catch {
    fail(words.COULDNT_ADD);
    return;
  }
  if (running !== controller) return;
  // The film may have changed while the video was converted: the scene goes into the film as it is now.
  const film = filmFor(filmSource.documents());
  const texts = addVideoScene(film, { id, dur: seconds, width: part.width, height: part.height, after: state.after });
  if (texts === null) {
    const room = addVideoRoom(film);
    fail(room.ok ? words.COULDNT_ADD : roomWords(room.reason));
    return;
  }
  const changes = new Map<string, DocumentValue | null>(
    moduleDocuments(
      new Map([
        [SCENES_MODULE, texts.scenes],
        [sceneModuleName(id), texts.module],
      ]),
    ),
  );
  changes.set(assetDocumentPath(videoSceneAsset(id)), { ref: url, mime: 'video/mp4', w: part.width, h: part.height });
  if (texts.script !== null) changes.set(FILM_SCRIPT_PATH, { code: texts.script });
  if (!writeStep(changes, words.ADD_VIDEO, words.ADD_VIDEO_STALE)) {
    fail(words.COULDNT_ADD);
    return;
  }
  running = null;
  const scene = placeOf(filmSource.documents(), id);
  const blank = film.script.trim() === '' && film.scenes === null;
  announce(words.videoAddedAs(scene));
  useAddVideo.setState({ phase: 'added', progress: 1, added: { scene, blank } });
}
