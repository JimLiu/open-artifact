/**
 * Taking an added video's scene back out (a scene's menu): its line in `scenes.json`, its module, and its file when
 * nothing else plays it, in one write. Undo puts it back after the scene it followed, even when the film changed
 * since, unless there is no room for it now; then it says so and the step stays to try again.
 */

import { announce } from '@open-artifact/editor-kit';
import type { DocumentValue } from '@open-artifact/live-store';
import { toast } from '@open-artifact/ui';
import {
  ASSETS_COLLECTION,
  FILM_SCRIPT_PATH,
  MODULES_COLLECTION,
  SCENES_MODULE,
  assetDocumentPath,
  isFilmScriptDocument,
  isModuleDocument,
  removeVideoScene,
  restoreVideoBlock,
  restoreVideoScene,
  sceneModuleName,
  videoSceneAsset,
  type RemovedVideoScene,
  type VideoSceneFilm,
} from '@open-artifact/motion-core';
import { pushUndo, type UndoDeclined } from '../engine/undo.ts';
import { filmSource, writeFilmDocuments, type FilmDocuments } from '../host/live-film.ts';
import { agentName, useWorking } from '../stores/working.ts';
import { addVideoAvailable, useAddVideo } from './add-video.ts';
import { moduleDocuments } from './edits.ts';
import * as words from './words.ts';

/** The film's modules, cut and asset names, as taking a video out reads them. */
export function videoSceneFilm(documents: FilmDocuments): VideoSceneFilm {
  const modules = new Map<string, string>();
  const assets = new Set<string>();
  for (const [path, value] of documents) {
    const slash = path.indexOf('/');
    const collection = path.slice(0, slash);
    const name = path.slice(slash + 1);
    if (collection === MODULES_COLLECTION && isModuleDocument(value)) modules.set(name, value.text);
    else if (collection === ASSETS_COLLECTION) assets.add(name);
  }
  const script = documents.get(FILM_SCRIPT_PATH);
  return { script: isFilmScriptDocument(script) ? script.code : '', modules, assets };
}

/** Whether the scene's menu offers to take its video out: a video added here, still as written, and not the only scene. */
export const canRemoveVideo = (sceneId: string | null, documents: FilmDocuments = filmSource.documents()): boolean =>
  sceneId !== null && addVideoAvailable() && removeVideoScene(videoSceneFilm(documents), sceneId) !== null;

const adding = (): boolean => {
  const { open, phase } = useAddVideo.getState();
  return open && (phase === 'reading' || phase === 'preparing' || phase === 'saving');
};

/** The documents that take the scene out of the film as it is now; `null` when it can no longer go. */
function takeOut(sceneId: string): Map<string, DocumentValue | null> | null {
  const documents = filmSource.documents();
  const result = removeVideoScene(videoSceneFilm(documents), sceneId);
  if (result === null) return null;
  const changes = moduleDocuments(new Map([[SCENES_MODULE, result.scenes], [sceneModuleName(sceneId), null]]), documents);
  if (result.removed.assetGone) changes.set(assetDocumentPath(videoSceneAsset(sceneId)), null);
  return changes;
}

function putBack(removed: RemovedVideoScene, asset: DocumentValue | null): UndoDeclined | undefined {
  if (useWorking.getState().activity === 'working') return { said: words.UNDO_WHILE_WORKING(agentName()), keep: true };
  const documents = filmSource.documents();
  const film = videoSceneFilm(documents);
  const block = restoreVideoBlock(film, removed);
  if (block === 'scenes' || block === 'length' || block === 'files') return { said: words.NO_ROOM_TO_PUT_BACK, keep: true };
  const scenes = restoreVideoScene(film, removed);
  if (scenes === null) return { said: words.REMOVE_STALE, keep: false };
  const changes = moduleDocuments(new Map([[SCENES_MODULE, scenes], [sceneModuleName(removed.sceneId), removed.module]]), documents);
  const assetPath = assetDocumentPath(videoSceneAsset(removed.sceneId));
  if (asset !== null && !documents.has(assetPath)) changes.set(assetPath, asset);
  return writeFilmDocuments(changes) ? undefined : { said: words.NOT_WRITTEN, keep: true };
}

function takeOutAgain(sceneId: string): UndoDeclined | undefined {
  if (useWorking.getState().activity === 'working') return { said: words.REDO_WHILE_WORKING(agentName()), keep: true };
  const changes = takeOut(sceneId);
  if (changes === null) return { said: words.REMOVE_STALE, keep: false };
  return writeFilmDocuments(changes) ? undefined : { said: words.NOT_WRITTEN, keep: true };
}

/** Takes the scene's added video out of the film, as one undo step; `false` when nothing was taken out. */
export function removeVideo(sceneId: string): boolean {
  if (adding()) {
    toast.add({ title: words.REMOVE_WHILE_ADDING });
    return false;
  }
  const documents = filmSource.documents();
  const result = removeVideoScene(videoSceneFilm(documents), sceneId);
  const changes = takeOut(sceneId);
  if (result === null || changes === null || !addVideoAvailable()) return false;
  const asset = documents.get(assetDocumentPath(videoSceneAsset(sceneId))) ?? null;
  if (!writeFilmDocuments(changes)) {
    toast.add({ title: words.NOT_WRITTEN });
    return false;
  }
  const { removed } = result;
  pushUndo({ label: words.REMOVE_VIDEO, undo: () => putBack(removed, asset), redo: () => takeOutAgain(sceneId) });
  announce(words.VIDEO_REMOVED);
  return true;
}
