/**
 * Video files put on the canvas: dropped or pasted on it (a video note each,
 * its cover a frame taken from the video), dropped into an artboard (a
 * `<video>` element), or replacing a video note's video. Files are checked
 * by name, header and size before the browser reads them.
 */

import { create } from 'zustand';
import { escapeAttribute } from '@open-artifact/dc';
import { toast } from '@open-artifact/ui';
import { freshId, isLockedObject, type CanvasNote } from '@open-artifact/design-core';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { session } from './session.ts';
import { edit } from './commands.ts';
import { announce } from './announce.ts';
import { refuseLocked } from './locks.ts';
import {
  coverFrameTime,
  coverSize,
  DARK_FRAME,
  isMp4Container,
  MAX_VIDEO_BYTES,
  meanLuminance,
  uploadRefusal,
  VIDEO_MESSAGES,
  VIDEO_READ_MS,
  videoKindOf,
  videoNoteSize,
  videoRefusalMessage,
  videoRow,
  VIDEOS_PER_DROP,
  videoTitle,
  type VideoRefusal,
} from '../lib/video-files.ts';

/** A video refused, with why. */
export class VideoRefused extends Error {
  constructor(readonly reason: VideoRefusal) {
    super(reason);
  }
}

/** Boxes on the canvas standing in for videos being uploaded (world coordinates). */
export const useVideoUploads = create<{ boxes: { id: string; x: number; y: number; w: number; h: number }[] }>(() => ({ boxes: [] }));

/** Refuses a file that is not a video this takes: by name, then (a `.mov`) its header, then its size. */
export async function checkVideoFile(file: File): Promise<VideoRefusal | null> {
  const kind = videoKindOf(file);
  if (!kind) return 'format';
  if (kind === 'mov') {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (!isMp4Container(head)) return 'quicktime';
  }
  return file.size > MAX_VIDEO_BYTES ? 'size' : null;
}

/** What the browser reads from a video: its pixel size and length, and a cover frame as JPEG. */
export interface ReadVideo {
  w: number;
  h: number;
  duration: number;
  cover: Blob;
}

function waitFor(video: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new VideoRefused('unreadable')), VIDEO_READ_MS);
    const ok = (): void => done(null);
    const failed = (): void => done(new VideoRefused(video.error?.code === 4 ? 'unplayable' : 'unreadable'));
    const done = (error: VideoRefused | null): void => {
      clearTimeout(timer);
      video.removeEventListener(event, ok);
      video.removeEventListener('error', failed);
      if (error) reject(error);
      else resolve();
    };
    video.addEventListener(event, ok, { once: true });
    video.addEventListener('error', failed, { once: true });
  });
}

/** Reads a video file in a muted `<video>`: its size and length, and a cover frame (a darker one is taken again later). */
export async function readVideo(file: Blob): Promise<ReadVideo> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    const loaded = waitFor(video, 'loadeddata');
    video.src = url;
    await loaded;
    if (!video.videoWidth || !video.videoHeight) throw new VideoRefused('unplayable');
    const duration = video.duration;
    const size = coverSize(video.videoWidth, video.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new VideoRefused('unreadable');
    // A video that doesn't say how long it is (a recording) may not seek: its first frame is the cover.
    const grab = async (at: number): Promise<number> => {
      if (Number.isFinite(duration) && Math.abs(video.currentTime - at) > 0.001) {
        const seeked = waitFor(video, 'seeked');
        video.currentTime = at;
        await seeked;
      }
      context.drawImage(video, 0, 0, size.w, size.h);
      // Brightness from a small sample is enough.
      const step = Math.max(1, Math.floor(Math.min(size.w, size.h) / 32));
      const sample = context.getImageData(0, 0, size.w, size.h).data.filter((_, i) => Math.floor(i / 4) % step === 0);
      return meanLuminance(sample);
    };
    if ((await grab(coverFrameTime(duration))) < DARK_FRAME) await grab(coverFrameTime(duration, true));
    const cover = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!cover) throw new VideoRefused('unreadable');
    return { w: video.videoWidth, h: video.videoHeight, duration, cover };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Uploads a file; a failure becomes a refusal (full storage, or anything else). */
async function upload(data: Blob, name: string): Promise<string> {
  const { assets } = session();
  if (!assets) throw new VideoRefused('no-uploads');
  try {
    return (await assets.upload(data, { name })).url;
  } catch (error) {
    throw new VideoRefused(uploadRefusal(error));
  }
}

/** A checked, read and uploaded video: its cover and video addresses, its name and pixel size. */
export interface UploadedVideo {
  src: string;
  video: string;
  alt: string;
  w: number;
  h: number;
}

/** Checks, reads and uploads one video (cover first). A cover that can't be stored refuses it as `cover`. */
export async function uploadVideo(file: File): Promise<UploadedVideo> {
  const refused = await checkVideoFile(file);
  if (refused) throw new VideoRefused(refused);
  const read = await readVideo(file);
  const alt = videoTitle(file.name);
  let src: string;
  try {
    src = await upload(read.cover, `${alt}.jpg`);
  } catch (error) {
    throw error instanceof VideoRefused && error.reason === 'no-uploads' ? error : new CoverNotStored();
  }
  const video = await upload(file, file.name);
  return { src, video, alt, w: read.w, h: read.h };
}

/** The cover frame could not be uploaded. */
export class CoverNotStored extends Error {}

/** Takes a new cover frame from a note's uploaded video and uploads it. */
export async function captureCover(videoUrl: string, name: string): Promise<string> {
  const response = await fetch(videoUrl);
  if (!response.ok) throw new VideoRefused('unreadable');
  const read = await readVideo(await response.blob());
  return upload(read.cover, `${videoTitle(name)}.jpg`);
}

const tellRefusal = (error: unknown, how: 'dropped' | 'pasted'): void => {
  if (error instanceof CoverNotStored) toast.add({ title: VIDEO_MESSAGES.noCover(how) });
  else toast.add({ title: videoRefusalMessage(error instanceof VideoRefused ? error.reason : 'unreadable') });
};

/**
 * Puts dropped or pasted video files on the canvas around `at` (at most four
 * at once), or into the artboard `board` as `<video>` elements.
 */
export async function placeVideos(files: readonly File[], at: { x: number; y: number }, how: 'dropped' | 'pasted', board?: string): Promise<void> {
  const doc = useDocument.getState();
  if (!files.length) return;
  if (doc.readOnly) {
    toast.add({ title: VIDEO_MESSAGES.readOnly });
    return;
  }
  if (!session().assets) {
    toast.add({ title: videoRefusalMessage('no-uploads') });
    return;
  }
  if (board && isLockedObject(doc.canvas.boards[board])) {
    refuseLocked();
    return;
  }
  const taken = files.slice(0, VIDEOS_PER_DROP);
  if (files.length > VIDEOS_PER_DROP) toast.add({ title: VIDEO_MESSAGES.tooMany(VIDEOS_PER_DROP) });
  const selectionBefore = useView.getState().selection;
  const pending = videoRow(taken.map(() => ({ w: 320, h: 180 })), at).map((place, i) => ({ id: `upload-${Date.now()}-${i}`, ...place, w: 320, h: 180 }));
  if (!board) useVideoUploads.setState({ boxes: [...useVideoUploads.getState().boxes, ...pending] });
  announce(VIDEO_MESSAGES.uploading(taken.length));
  const done: UploadedVideo[] = [];
  try {
    for (const file of taken) {
      try {
        done.push(await uploadVideo(file));
      } catch (error) {
        tellRefusal(error, how);
      }
    }
  } finally {
    const ids = new Set(pending.map((box) => box.id));
    useVideoUploads.setState({ boxes: useVideoUploads.getState().boxes.filter((box) => !ids.has(box.id)) });
  }
  if (!done.length) return;
  const sizes = done.map((video) => videoNoteSize(video.w, video.h));
  const places = videoRow(sizes, at);
  const entry = board ? useDocument.getState().canvas.boards[board] : undefined;
  if (board && entry) {
    for (const [i, video] of done.entries()) {
      // Inside an artboard a video takes the size a dropped image does: its long side at most 480.
      const scale = Math.min(1, 480 / Math.max(sizes[i]!.w, sizes[i]!.h));
      const w = Math.round(sizes[i]!.w * scale);
      const h = Math.round(sizes[i]!.h * scale);
      const x = Math.round(at.x + i * 24 - entry.x);
      const y = Math.round(at.y + i * 24 - entry.y);
      const html = `<video src="${escapeAttribute(video.video)}" poster="${escapeAttribute(video.src)}" aria-label="${escapeAttribute(video.alt)}" autoplay loop muted playsinline style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;object-fit:contain"></video>`;
      edit(board, { kind: 'insert', target: null, position: 'last-child', html }, { selectCreated: true });
    }
    return;
  }
  const current = useDocument.getState();
  if (current.readOnly || current.canvasError) {
    for (let i = 0; i < done.length; i++) toast.add({ title: VIDEO_MESSAGES.noNote(how) });
    return;
  }
  const view = useView.getState();
  const page = view.page && current.canvas.pages.length > 1 && view.page !== current.canvas.pages[0]?.id ? view.page : undefined;
  const ids: string[] = [];
  const used = new Set(Object.keys(current.canvas.notes));
  const notes: Record<string, CanvasNote> = {};
  done.forEach((video, i) => {
    const id = freshId('n', used);
    used.add(id);
    ids.push(id);
    notes[id] = { kind: 'image', x: places[i]!.x, y: places[i]!.y, w: sizes[i]!.w, h: sizes[i]!.h, src: video.src, video: video.video, alt: video.alt, ...(page ? { page } : {}) };
  });
  current.updateCanvas((canvas) => ({ ...canvas, notes: { ...canvas.notes, ...notes } }));
  if (!ids.every((id) => useDocument.getState().canvas.notes[id])) {
    toast.add({ title: VIDEO_MESSAGES.noNote(how) });
    return;
  }
  // The new notes are selected, unless something else was selected meanwhile.
  if (useView.getState().selection === selectionBefore) useView.getState().select({ kind: 'objects', boards: [], notes: ids });
}
