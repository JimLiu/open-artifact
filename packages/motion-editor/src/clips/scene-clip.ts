/**
 * A scene that plays a stretch of one uploaded video in the clip form (`clipSceneForm`), read from the documents
 * as the store holds them now, with the video's own length once a `<video>` has read it.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import {
  RECUT_MODULE,
  SCENES_MODULE,
  assetDocumentPath,
  clipSceneForm,
  isAssetDocument,
  isModuleDocument,
  moduleDocumentPath,
  parseAssetReference,
  sceneModuleName,
  type ClipSceneForm,
  type ClipSceneTexts,
} from '@open-artifact/motion-core';
import { assetUrl } from '../host/assets.ts';
import { filmSource, type FilmDocuments } from '../host/live-film.ts';

export interface SceneClip {
  form: ClipSceneForm;
  texts: ClipSceneTexts;
  /** The video's ref (`_blob/<id>`). */
  ref: string;
}

const moduleText = (documents: FilmDocuments, name: string): string | null => {
  const document = documents.get(moduleDocumentPath(name));
  return isModuleDocument(document) ? document.text : null;
};

/** The scene's clip, or `null` when it is not one the page can trim. */
export function sceneClip(sceneId: string | null, documents: FilmDocuments = filmSource.documents()): SceneClip | null {
  if (sceneId === null) return null;
  const module = moduleText(documents, sceneModuleName(sceneId));
  const scenes = moduleText(documents, SCENES_MODULE);
  if (module === null || scenes === null) return null;
  const asset = (name: string) => {
    const document = documents.get(assetDocumentPath(name));
    return isAssetDocument(document) ? document : null;
  };
  const form = clipSceneForm(module, sceneId, (name) => asset(name)?.mime);
  const ref = form === null ? '' : parseAssetReference(asset(form.asset)?.ref);
  if (form === null || ref === '') return null;
  return { form, ref, texts: { scenes, module, recut: moduleText(documents, RECUT_MODULE) } };
}

const subscribe = (listener: () => void): (() => void) => filmSource.subscribe(() => listener());

/** The film's documents, redrawn on every change. */
export function useFilmDocuments(): FilmDocuments {
  return useSyncExternalStore(subscribe, filmSource.documents, filmSource.documents);
}

/** {@link sceneClip}, kept current. */
export function useSceneClip(sceneId: string | null): SceneClip | null {
  const documents = useFilmDocuments();
  return useMemo(() => sceneClip(sceneId, documents), [sceneId, documents]);
}

/** How long the page waits for a video to say how long it is. */
const PROBE_MS = 10_000;

/** Each video's own length by ref: seconds, `null` when it could not be read, absent while reading. */
const useLengths = create<{ byRef: Readonly<Record<string, number | null>> }>()(() => ({ byRef: {} }));
const probing = new Set<string>();

function probe(ref: string): void {
  if (probing.has(ref) || ref in useLengths.getState().byRef) return;
  const url = assetUrl(ref);
  const settle = (seconds: number | null): void => {
    probing.delete(ref);
    useLengths.setState((state) => ({ byRef: { ...state.byRef, [ref]: seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null } }));
  };
  if (url === null || typeof document === 'undefined') {
    settle(null);
    return;
  }
  probing.add(ref);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  const timer = setTimeout(() => finish(null), PROBE_MS);
  function finish(seconds: number | null): void {
    clearTimeout(timer);
    video.removeAttribute('src');
    video.load();
    settle(seconds);
  }
  video.addEventListener('loadedmetadata', () => finish(video.duration), { once: true });
  video.addEventListener('error', () => finish(null), { once: true });
  video.src = url;
}

/** The video's own length in seconds; `null` while unknown (being read, or unreadable). */
export function useClipLength(ref: string | null): number | null {
  const length = useLengths((state) => (ref === null ? null : (state.byRef[ref] ?? null)));
  useEffect(() => {
    if (ref !== null) probe(ref);
  }, [ref]);
  return length;
}

/** The length as known now, without reading it. */
export const knownClipLength = (ref: string): number | null => useLengths.getState().byRef[ref] ?? null;
