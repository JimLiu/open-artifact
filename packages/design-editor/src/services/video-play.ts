/**
 * Playing and pausing video notes: a click on a selected video note while
 * editing, the play button when viewing, the bar's Play button. A note waits
 * for a free play slot when four already play on the page.
 */

import { toast } from '@open-artifact/ui';
import { useDocument } from '../state/document.ts';
import { useVideo } from '../state/video.ts';
import { announce } from './announce.ts';
import { playAnnouncement, slotLimitMessage } from '../lib/play-slots.ts';

/** True when the note plays, or waits for a slot to. */
export function videoOn(id: string): boolean {
  const { slots } = useVideo.getState();
  return slots.playing.includes(id) || slots.waiting.includes(id);
}

/** Plays or pauses a video note, and says so. */
export function toggleVideoNote(id: string): void {
  const note = useDocument.getState().canvas.notes[id];
  if (!note?.video) return;
  const video = useVideo.getState();
  if (videoOn(id)) {
    video.choose(id, false);
    video.release(id);
    announce(playAnnouncement('Paused', note.alt));
    return;
  }
  video.setFailed(id, false);
  video.choose(id, true);
  if (!video.visible[id]) return;
  video.claim(id);
  if (useVideo.getState().slots.waiting.includes(id)) toast.add({ title: slotLimitMessage() });
  else announce(playAnnouncement('Playing', note.alt));
}

/** A video that played to its end without looping. */
export function videoEnded(id: string): void {
  const note = useDocument.getState().canvas.notes[id];
  const video = useVideo.getState();
  video.choose(id, false);
  video.release(id);
  announce(playAnnouncement('Stopped', note?.alt));
}
