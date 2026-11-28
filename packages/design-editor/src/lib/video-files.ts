/**
 * Video files put on the canvas (dropped, pasted, or replacing a video
 * note's video): which files are taken, what the note is called, how big it
 * is and where it goes, when its cover frame is taken, and what is said when
 * one is refused.
 */

export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
/** Videos one drop or paste adds. */
export const VIDEOS_PER_DROP = 4;
/** How long reading a video's size and length may take. */
export const VIDEO_READ_MS = 6000;
/** Between notes added together. */
export const VIDEO_GAP = 80;
const MAX_NOTE_W = 1200;
const MIN_NOTE_W = 48;
const MAX_NOTE_H = 8000;
const MAX_COVER_SIDE = 1920;
const TITLE_CHARS = 60;

export type VideoKind = 'mp4' | 'webm' | 'mov';

/** What a video file picker offers. */
export const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime,.mov';

/** What a file is, by its name and type: a video this takes, or null. */
export function videoKindOf(file: { name: string; type: string }): VideoKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (ext === 'mp4' || ext === 'm4v' || file.type === 'video/mp4') return 'mp4';
  if (ext === 'webm' || file.type === 'video/webm') return 'webm';
  if (ext === 'mov' || file.type === 'video/quicktime') return 'mov';
  return null;
}

/** True for any video file, taken or not (so a refused one is told why rather than dropped silently). */
export function looksLikeVideo(file: { name: string; type: string }): boolean {
  return file.type.startsWith('video/') || /\.(mp4|m4v|webm|mov|avi|mkv|wmv|flv|ogv|3gp)$/i.test(file.name);
}

/** True when a file's first bytes are an MP4-family container (an `ftyp` box), as a modern `.mov` is. */
export function isMp4Container(head: Uint8Array): boolean {
  return head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
}

/** The note's name: the file name without its extension, at most 60 characters, "Video" when nothing is left. */
export function videoTitle(name: string): string {
  const title = name.replace(/\.[^./\\]+$/, '').trim();
  return title ? Array.from(title).slice(0, TITLE_CHARS).join('') : 'Video';
}

/** The note's size from the video's pixels: 48 to 1200 wide, at most 8000 tall, keeping its shape. */
export function videoNoteSize(w: number, h: number): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: 640, h: 360 };
  let scale = Math.min(1, MAX_NOTE_W / w);
  if (w * scale < MIN_NOTE_W) scale = MIN_NOTE_W / w;
  if (h * scale > MAX_NOTE_H) scale = MAX_NOTE_H / h;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** Where notes added together go: the first centred on the point, the rest in a row to its right, 80 apart. */
export function videoRow(sizes: readonly { w: number; h: number }[], at: { x: number; y: number }): { x: number; y: number }[] {
  let x = at.x - (sizes[0]?.w ?? 0) / 2;
  return sizes.map((size) => {
    const place = { x: Math.round(x), y: Math.round(at.y - size.h / 2) };
    x += size.w + VIDEO_GAP;
    return place;
  });
}

/** When the cover frame is taken: 0.1s in (1s on a retry after a dark frame), never past half the video. */
export function coverFrameTime(duration: number, retry = false): number {
  const at = retry ? 1 : 0.1;
  return Number.isFinite(duration) && duration > 0 ? Math.min(at, duration / 2) : at;
}

/** A frame darker than this on average is taken again later. */
export const DARK_FRAME = 8;

/** The average brightness (0–255) of RGBA pixels. */
export function meanLuminance(rgba: ArrayLike<number>): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    sum += 0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!;
    count++;
  }
  return count ? sum / count : 0;
}

/** The cover image's size: the frame's, its long side at most 1920. */
export function coverSize(w: number, h: number): { w: number; h: number } {
  const scale = Math.min(1, MAX_COVER_SIDE / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** Why a video was not added (or used, when replacing). */
export type VideoRefusal = 'format' | 'quicktime' | 'size' | 'unplayable' | 'unreadable' | 'storage' | 'no-uploads' | 'upload';

export function videoRefusalMessage(reason: VideoRefusal, replacing = false): string {
  switch (reason) {
    case 'format':
      return 'Only .mp4, .mov and .webm videos can be added. Convert it to .mp4 (H.264) first.';
    case 'quicktime':
      return `This .mov is in an older QuickTime format that can’t be ${replacing ? 'used' : 'added'}. Convert it to .mp4 (H.264) first.`;
    case 'size':
      return 'Videos over 20 MB can’t be added. Trim or compress it first.';
    case 'unplayable':
      return 'This browser can’t play that video, so it wasn’t added. Try an H.264 .mp4.';
    case 'unreadable':
      return 'Couldn’t read that video. Try again.';
    case 'storage':
      return 'No more uploads can be added here right now (storage may be full).';
    case 'no-uploads':
      return 'Uploads aren’t available in this view, so videos can’t be added.';
    case 'upload':
      return 'The video couldn’t be uploaded. Try again in a moment.';
  }
}

/** An upload error as a refusal: full storage, or anything else. */
export function uploadRefusal(error: unknown): VideoRefusal {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /ENOSPC|no space|quota|storage (is )?full|507/i.test(text) ? 'storage' : 'upload';
}

export const VIDEO_MESSAGES = {
  readOnly: 'This design is view-only — videos can’t be added.',
  tooMany: (limit: number) => `Adding the first ${limit} video${limit === 1 ? '' : 's'}. Add the rest separately.`,
  uploading: (count: number) => (count === 1 ? 'Uploading video' : 'Uploading videos'),
  noCover: (how: 'dropped' | 'pasted') => `Couldn’t store a cover image for the ${how} video, so it wasn’t added. Try again.`,
  noNote: (how: 'dropped' | 'pasted') => `Couldn’t add the ${how} video to the canvas. Add it again.`,
} as const;
