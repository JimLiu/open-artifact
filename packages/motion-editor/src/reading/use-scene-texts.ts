import { useMemo } from 'react';
import { selectDuration, selectParts, selectSceneReports, useFilm } from '../stores/film.ts';
import { useVoiceover } from '../voiceover/store.ts';
import { sceneTexts, textParts, type SceneText } from './film-text.ts';
import { useFilmText } from './reader.ts';

const NO_READING: ReadonlyMap<string, null> = new Map();

/** The film on show as text, scene by scene, with what has been read of its words so far. */
export function useSceneTexts(): SceneText[] {
  const parts = useFilm(selectParts);
  const duration = useFilm(selectDuration);
  const reports = useFilm(selectSceneReports);
  const scenes = useFilm((s) => s.scenes?.scenes ?? null);
  const meta = useFilm((s) => s.meta);
  const load = useFilmText((s) => s.load);
  const read = useFilmText((s) => s.read);
  const lines = useVoiceover((s) => s.lines);
  return useMemo(
    () =>
      sceneTexts({
        parts: textParts(parts, duration),
        scenes,
        reports,
        read: load === meta ? read : NO_READING,
        spoken: lines ?? [],
      }),
    [parts, duration, scenes, reports, read, load, meta, lines],
  );
}
