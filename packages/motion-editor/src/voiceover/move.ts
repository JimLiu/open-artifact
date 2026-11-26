/**
 * Moving a voiceover line on the lane writes its new start into the narration code (the line's `at`), as the agent
 * would: a plain number, or a scene's start plus or minus seconds, moved by the film seconds the drag covered.
 */

import type { VoiceoverLine } from '@open-artifact/motion-audio';
import { decodeFilm, playSeconds } from '@open-artifact/motion-core';
import { toast } from '@open-artifact/ui';
import { pushUndo } from '../engine/undo.ts';
import { filmSource, writeFilmDocument } from '../host/live-film.ts';
import { useFilm } from '../stores/film.ts';
import { movedFrom, type LastMove } from './lines.ts';
import { narrationAtFor, narrationAtWrite, shiftNarrationAt } from './narration-code.ts';
import { filmTimeOf } from './record.ts';
import { useVoiceover } from './store.ts';
import { MOVE_NOT_WRITTEN, MOVE_UNDO_LABEL } from './words.ts';

/** Puts the line with this take from `was` to `now` in the film as stored now; false when its code no longer reads `was`. */
function writeLineAt(audio: string, was: string, now: string): boolean {
  const documents = filmSource.documents();
  const write = narrationAtWrite(decodeFilm(documents), audio, was, now);
  if (write === null) return false;
  return writeFilmDocument(write.path, { ...documents.get(write.path), ...write.data });
}

/** Each take's last move, so a move made before the film comes back starts where that one put the line. */
const lastMoves = new Map<string, LastMove>();

/** Moves `line` to start at `to` (seconds as played); false when the page could not write it. */
export function moveVoiceLine(line: VoiceoverLine, to: number): boolean {
  const film = decodeFilm(filmSource.documents());
  const from = narrationAtFor(film, line.audio);
  if (from === null) return false;
  const toFilm = filmTimeOf(useFilm.getState().clock);
  const shown = useVoiceover.getState().lines;
  const at = movedFrom(lastMoves.get(line.audio), from, shown) ?? line.at;
  const next = shiftNarrationAt(from, toFilm(playSeconds(to)) - toFilm(playSeconds(at)));
  if (next === null || next === from) return false;
  if (!writeLineAt(line.audio, from, next)) {
    toast.add({ title: MOVE_NOT_WRITTEN });
    return false;
  }
  lastMoves.set(line.audio, { code: next, at: to, on: shown });
  pushUndo({
    label: MOVE_UNDO_LABEL,
    undo: () => void writeLineAt(line.audio, next, from),
    redo: () => void writeLineAt(line.audio, from, next),
  });
  return true;
}
