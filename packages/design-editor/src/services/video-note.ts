/**
 * Changing an image or video note's media from the Properties panel and the
 * quick bar: the play toggles, the cover image, replacing the video or the
 * picture. Each change is one labelled undo step.
 */

import { toast } from '@open-artifact/ui';
import { cleanNoteCss, noteCssValue, type CanvasNote } from '@open-artifact/design-core';
import { useDocument } from '../state/document.ts';
import { useVideo } from '../state/video.ts';
import { session } from './session.ts';
import { announce } from './announce.ts';
import { rememberPictureSize } from './picture-sizes.ts';
import { captureCover, CoverNotStored, uploadVideo, VideoRefused } from './videos.ts';
import { looksLikeVideo, uploadRefusal, videoRefusalMessage } from '../lib/video-files.ts';
import { heightForVideo, MEDIA_MESSAGES, MEDIA_UNDO, videoSettingPatch, type VideoToggle } from '../lib/video-settings.ts';

/** The note, when it can be changed now. */
function editable(id: string): CanvasNote | null {
  const doc = useDocument.getState();
  const note = doc.canvas.notes[id];
  // A lock keeps a note's place and size; its media can still change, as its style can.
  return !note || doc.readOnly ? null : note;
}

/** Writes a patch to a note as one undo step; `undefined` removes a key. */
export function patchNote(id: string, patch: Partial<Record<keyof CanvasNote, unknown>>, label?: string): void {
  useDocument.getState().updateCanvas((canvas) => {
    const note = canvas.notes[id];
    if (!note) return canvas;
    const next = { ...note, ...patch } as CanvasNote;
    for (const [key, value] of Object.entries(patch)) if (value === undefined) delete (next as Record<string, unknown>)[key];
    return { ...canvas, notes: { ...canvas.notes, [id]: next } };
  }, label);
}

/** Writes keys of a note's css (null removes one); a value the note doesn't take changes nothing and says false. */
export function setNoteCssKeys(id: string, patch: Record<string, string | null>): boolean {
  const note = editable(id);
  if (!note) return false;
  const next: Record<string, string> = { ...note.css };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value.trim() === '') delete next[key];
    else if (noteCssValue(key, value) === null) return false;
    else next[key] = value.trim();
  }
  patchNote(id, { css: cleanNoteCss(next) });
  return true;
}

/** Turns Autoplay, Loop or Sound on or off. */
export function setVideoSetting(id: string, toggle: VideoToggle, on: boolean): void {
  const note = editable(id);
  if (!note?.video) return;
  const patch = videoSettingPatch(note, toggle, on);
  if (patch) patchNote(id, patch, MEDIA_UNDO.settings);
}

/** Natural size of an image file. */
function pictureSizeOf(file: Blob): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ w: image.naturalWidth, h: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

/** Uploads an image file and remembers its size; null (and a message) when it can't. */
async function uploadPicture(file: File, failed: (why: string) => string): Promise<{ url: string; size: { w: number; h: number } | null } | null> {
  const { assets } = session();
  if (!assets) {
    toast.add({ title: failed('uploads aren’t available in this view') });
    return null;
  }
  try {
    const size = await pictureSizeOf(file);
    const { url } = await assets.upload(file, { name: file.name });
    if (size) rememberPictureSize(url, size.w, size.h);
    return { url, size };
  } catch (error) {
    toast.add({ title: failed(uploadRefusal(error) === 'storage' ? 'storage may be full' : 'the image couldn’t be uploaded') });
    return null;
  }
}

/** Sets a video note's cover to an image file. */
export async function setCoverImage(id: string, file: File): Promise<void> {
  if (!editable(id)) return;
  if (!file.type.startsWith('image/')) {
    toast.add({ title: MEDIA_MESSAGES.coverNotSet('pick an image file') });
    return;
  }
  const picture = await uploadPicture(file, MEDIA_MESSAGES.coverNotSet);
  if (!picture || !useDocument.getState().canvas.notes[id]?.video) return;
  patchNote(id, { src: picture.url, videoCover: 'custom' }, MEDIA_UNDO.cover);
  announce(MEDIA_MESSAGES.coverSet);
}

/** Takes a new cover from the video's frame. */
export async function resetCoverImage(id: string): Promise<void> {
  const note = editable(id);
  if (!note?.video) return;
  try {
    const src = await captureCover(note.video, note.alt ?? 'video');
    if (useDocument.getState().canvas.notes[id]?.video !== note.video) return;
    patchNote(id, { src, videoCover: undefined }, MEDIA_UNDO.cover);
    announce(MEDIA_MESSAGES.coverReset);
  } catch {
    toast.add({ title: MEDIA_MESSAGES.coverNotReset });
  }
}

/**
 * Replaces a video note's video with a video file: it is read, its cover
 * taken and both uploaded; the width stays, the height follows the new
 * video, and the crop and a custom cover go. Any other file is refused:
 * the cover image has its own row.
 */
export async function replaceVideo(id: string, file: File): Promise<void> {
  const note = editable(id);
  if (!note?.video) return;
  if (!looksLikeVideo(file)) {
    toast.add({ title: MEDIA_MESSAGES.pickVideo });
    return;
  }
  try {
    const uploaded = await uploadVideo(file);
    const current = useDocument.getState().canvas.notes[id];
    if (!current) {
      toast.add({ title: MEDIA_MESSAGES.replaceFailed });
      return;
    }
    useVideo.getState().release(id);
    useVideo.getState().choose(id, null);
    useVideo.getState().setFailed(id, false);
    const h = heightForVideo(current.w ?? 320, uploaded, current.h ?? 180);
    patchNote(id, { src: uploaded.src, video: uploaded.video, alt: uploaded.alt, h, crop: undefined, videoCover: undefined }, MEDIA_UNDO.video);
    announce(MEDIA_MESSAGES.videoReplaced);
  } catch (error) {
    if (error instanceof VideoRefused) toast.add({ title: MEDIA_MESSAGES.notReplaced(videoRefusalMessage(error.reason, true)) });
    else if (error instanceof CoverNotStored) toast.add({ title: MEDIA_MESSAGES.replaceFailed });
    else toast.add({ title: MEDIA_MESSAGES.replaceFailed });
  }
}

/** Replaces a picture note's picture with an image file; its crop goes. */
export async function replacePicture(id: string, file: File): Promise<void> {
  const note = editable(id);
  if (!note || note.kind !== 'image') return;
  if (note.video) {
    await setCoverImage(id, file);
    return;
  }
  if (!file.type.startsWith('image/')) {
    toast.add({ title: 'Pick an image file to replace the picture.' });
    return;
  }
  const picture = await uploadPicture(file, (why) => `The picture was not replaced: ${why}.`);
  if (!picture || !useDocument.getState().canvas.notes[id]) return;
  patchNote(id, { src: picture.url, alt: file.name, crop: undefined }, MEDIA_UNDO.picture);
  announce(MEDIA_MESSAGES.pictureReplaced);
}

/** Opens the file picker for `accept`, and hands the chosen file on. */
export function pickFile(accept: string, then: (file: File) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) then(file);
  });
  input.click();
}
