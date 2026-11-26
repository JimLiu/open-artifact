/**
 * Reads the words each scene puts on screen, one scene at a time, while the page is idle: the film loaded and
 * paused, the Tweaks panel's own layer reading not wanted, nothing exported, and no one pressing or typing for a
 * moment. A press, a key or playing ends a reading under way; it is asked again later. What was read holds until the
 * film loads again.
 */

import type { LayersReport } from '@open-artifact/motion-stage/protocol';
import { playSeconds } from '@open-artifact/motion-core';
import { create } from 'zustand';
import { filmEngine } from '../engine/engine-context.ts';
import { useExport } from '../export/store.ts';
import { layersActive } from '../layers/reader.ts';
import { selectDuration, selectParts, selectSceneReports, useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useUi } from '../stores/ui.ts';
import { nextUnread, partKey, readLines, textParts, type ReadLine } from './film-text.ts';

export interface FilmTextState {
  /** The load the readings are of (the stage's meta). */
  load: unknown;
  /** By part key: the lines read, or null where the reading failed. */
  read: ReadonlyMap<string, readonly ReadLine[] | null>;
}

export const useFilmText = create<FilmTextState>()(() => ({ load: null, read: new Map() }));

/** How long the page must be left alone before a scene is read. */
export const READ_IDLE_MS = 1200;
/** A reading that came back empty is tried once more after this long. */
export const READ_RETRY_MS = 1000;
/** Between one scene's reading and the next. */
const NEXT_MS = 60;
/** Its questions are told apart from the Tweaks panel's by number. */
const SEQ_FROM = 1_000_000_000;

/** Things that end a reading under way: the person is doing something. */
const STIRS = ['pointerdown', 'keydown', 'wheel'] as const;

function idle(): boolean {
  return (
    useFilm.getState().stage === 'ready' &&
    useFilm.getState().meta !== null &&
    !usePlayback.getState().playing &&
    !useUi.getState().fullscreen &&
    !useExport.getState().open &&
    !layersActive()
  );
}

/**
 * A reading draws its scene's moments on the one stage and leaves it at the scene's start. The playhead's moment is
 * asked for again right behind the question: the stage holds that render until the reading lets go of the stage and
 * draws it before the next paint, so another scene never shows. It is asked again when the answer comes, in case the
 * reading had not yet taken the stage.
 */
function showPlayheadAgain(): void {
  const engine = filmEngine();
  if (engine !== null && !usePlayback.getState().playing) engine.playback.show();
}

/** What has been read of the film on show; a new load starts afresh. */
function readNow(): ReadonlyMap<string, readonly ReadLine[] | null> {
  const meta = useFilm.getState().meta;
  const state = useFilmText.getState();
  if (state.load === meta) return state.read;
  const read = new Map<string, readonly ReadLine[] | null>();
  useFilmText.setState({ load: meta, read });
  return read;
}

function keep(key: string, lines: readonly ReadLine[] | null): void {
  const next = new Map(readNow());
  next.set(key, lines);
  useFilmText.setState({ read: next });
}

export function startFilmTextReader(): () => void {
  let seq = SEQ_FROM;
  let asking: { seq: number; key: string; from: number; to: number; scene: string | null } | null = null;
  const retried = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const later = (ms: number): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(ask, ms);
  };

  /** Lets a reading under way go; tells the stage only when no other reading has taken its place. */
  const drop = (): void => {
    if (asking === null) return;
    const was = asking;
    asking = null;
    if (layersActive()) return;
    seq += 1;
    filmEngine()?.send({ type: 'layers', seq, from: playSeconds(was.from), to: playSeconds(was.to), at: playSeconds(was.from), scene: was.scene, stop: true });
    showPlayheadAgain();
  };

  function ask(): void {
    timer = undefined;
    if (asking !== null || !idle()) return;
    const engine = filmEngine();
    if (engine === null) return;
    const film = useFilm.getState();
    const reports = selectSceneReports(film);
    const parts = textParts(selectParts(film), selectDuration(film));
    const index = nextUnread(parts, reports, readNow());
    if (index < 0) return;
    const part = parts[index]!;
    seq += 1;
    asking = { seq, key: partKey(part, index), from: part.from, to: part.to, scene: reports !== null ? part.key : null };
    engine.send({ type: 'layers', seq, from: playSeconds(part.from), to: playSeconds(part.to), at: playSeconds(part.from), scene: asking.scene, stop: false });
    showPlayheadAgain();
  }

  const received = (report: LayersReport): void => {
    if (asking === null || report.seq !== asking.seq) return;
    const { key, from } = asking;
    asking = null;
    showPlayheadAgain();
    if (useFilmText.getState().load !== useFilm.getState().meta) return later(NEXT_MS);
    if (report.rows === null) {
      if (!retried.has(key)) {
        retried.add(key);
        return later(READ_RETRY_MS);
      }
      keep(key, null);
    } else keep(key, readLines(report.rows, from));
    later(NEXT_MS);
  };

  const follow = (): void => {
    if (idle()) {
      if (asking === null) later(READ_IDLE_MS);
    } else {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      drop();
    }
  };

  const stir = (event: Event): void => {
    if (event.type === 'pointermove' && (event as PointerEvent).buttons === 0) return;
    drop();
    if (idle()) later(READ_IDLE_MS);
  };

  let unlisten: (() => void) | null = null;
  const listen = (): void => {
    if (unlisten !== null) return;
    const engine = filmEngine();
    if (engine === null) return;
    unlisten = engine.onStageMessage((message) => {
      if (message.type === 'layers') received(message.report);
    });
  };
  listen();

  const stops = [
    useFilm.subscribe((state, before) => {
      listen();
      if (state.meta !== before.meta) retried.clear();
      if (state.stage !== before.stage || state.meta !== before.meta || state.clock !== before.clock) {
        drop();
        follow();
      }
    }),
    usePlayback.subscribe((state, before) => {
      if (state.playing !== before.playing) follow();
    }),
    useUi.subscribe((state, before) => {
      if (state.panel !== before.panel || state.fullscreen !== before.fullscreen) follow();
    }),
    useExport.subscribe((state, before) => {
      if (state.open !== before.open) follow();
    }),
  ];
  for (const type of [...STIRS, 'pointermove'] as const) document.addEventListener(type, stir, { capture: true, passive: true });
  follow();

  return () => {
    for (const type of [...STIRS, 'pointermove'] as const) document.removeEventListener(type, stir, { capture: true });
    if (timer !== undefined) clearTimeout(timer);
    drop();
    unlisten?.();
    for (const stop of stops) stop();
  };
}
