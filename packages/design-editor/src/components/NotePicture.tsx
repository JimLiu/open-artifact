/**
 * The picture of an image or video note, inside its box. A cropped note
 * clips its picture in a frame that carries the note's look; until the
 * picture has loaded it draws uncropped. A video note shows its cover with a
 * play button, and the `<video>` once it has been played.
 */

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Play } from 'lucide-react';
import { videoOptions, type CanvasNote } from '@open-artifact/design-core';
import { cn } from '@open-artifact/ui';
import { imageLook, reactStyle } from '../lib/note-look.ts';
import { cropFrameStyle, cropPictureStyle } from '../lib/note-crop.ts';
import { pictureSize, rememberPictureSize, usePictureSize } from '../services/picture-sizes.ts';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { useVideo, videoElements } from '../state/video.ts';
import { toggleVideoNote, videoEnded } from '../services/video-play.ts';

/** The picture's natural size: read here once when no one has recorded it, and redrawn when it is known. */
function useLoadedSize(src: string | undefined) {
  const size = usePictureSize(src);
  useEffect(() => {
    if (!src || pictureSize(src)) return;
    const image = new Image();
    image.onload = () => rememberPictureSize(src, image.naturalWidth, image.naturalHeight);
    image.src = src;
    return () => {
      image.onload = null;
    };
  }, [src]);
  return size;
}

/** Lays the media out: in a clipping frame when cropped and loaded, else filling the box with the note's look. */
function Framed({ note, loaded, media }: { note: CanvasNote; loaded: boolean; media: (style: CSSProperties, className: string) => ReactNode }) {
  const look = imageLook(note).dom;
  if (note.crop && loaded) {
    return <div style={reactStyle(cropFrameStyle(look)) as CSSProperties}>{media(reactStyle(cropPictureStyle(note.crop)) as CSSProperties, 'block select-none')}</div>;
  }
  return <>{media(reactStyle(look) as CSSProperties, 'block size-full select-none')}</>;
}

export function NotePicture({ id, note }: { id: string; note: CanvasNote }) {
  const size = useLoadedSize(note.src);
  if (note.video) return <VideoPicture id={id} note={note} loaded={Boolean(size)} />;
  if (!note.src) return <div className="size-full" style={reactStyle(imageLook(note).dom) as CSSProperties} />;
  const src = note.src;
  return (
    <Framed
      note={note}
      loaded={Boolean(size)}
      media={(style, className) => <img src={src} alt={note.alt ?? note.text ?? ''} draggable={false} className={className} style={style} />}
    />
  );
}

/** The picture only (a video note's cover), for a still view such as an earlier version. */
export function NoteStill({ note }: { note: CanvasNote }) {
  const size = useLoadedSize(note.src);
  const src = note.src;
  if (!src) return <div className="size-full" style={reactStyle(imageLook(note).dom) as CSSProperties} />;
  return <Framed note={note} loaded={Boolean(size)} media={(style, className) => <img src={src} alt="" draggable={false} className={className} style={style} />} />;
}

function VideoPicture({ id, note, loaded }: { id: string; note: CanvasNote; loaded: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const element = useRef<HTMLVideoElement | null>(null);
  const readOnly = useDocument((s) => s.readOnly);
  const cropping = useView((s) => s.noteCrop === id);
  const visible = useVideo((s) => Boolean(s.visible[id]));
  const chosen = useVideo((s) => s.chosen[id]);
  const failed = useVideo((s) => Boolean(s.failed[id]));
  const playing = useVideo((s) => s.slots.playing.includes(id));
  const options = videoOptions(note);
  // Editing never starts a video on its own; viewing starts one set to autoplay once it is in view.
  const wants = visible && !cropping && !failed && (chosen ?? (options.autoplay && readOnly));
  const mounted = !cropping && !failed && (playing || chosen !== undefined);
  const name = note.alt?.trim();

  useEffect(() => {
    const target = box.current;
    if (!target || typeof IntersectionObserver === 'undefined') {
      useVideo.getState().setVisible(id, true);
      return;
    }
    const observer = new IntersectionObserver((entries) => useVideo.getState().setVisible(id, entries.some((entry) => entry.isIntersecting)));
    observer.observe(target);
    return () => {
      observer.disconnect();
      useVideo.getState().setVisible(id, false);
      useVideo.getState().release(id);
    };
  }, [id]);

  useEffect(() => {
    if (wants) useVideo.getState().claim(id);
    else useVideo.getState().release(id);
  }, [wants, id]);

  useEffect(() => {
    const video = element.current;
    if (!video) return;
    if (playing) void video.play().catch(() => undefined);
    else video.pause();
  }, [playing, mounted]);

  const cover = (
    <Framed
      note={note}
      loaded={loaded}
      media={(style, className) =>
        mounted ? (
          <video
            ref={(node) => {
              element.current = node;
              if (node) videoElements.set(id, node);
              else videoElements.delete(id);
            }}
            data-note-video={id}
            src={note.video}
            poster={note.src}
            aria-label={name || undefined}
            playsInline
            disablePictureInPicture
            disableRemotePlayback
            loop={options.loop}
            muted={!options.sound}
            className={className}
            style={style}
            onError={() => useVideo.getState().setFailed(id, true)}
            onEnded={() => videoEnded(id)}
          />
        ) : note.src ? (
          <img src={note.src} alt={name ?? ''} draggable={false} className={className} style={style} />
        ) : (
          <div className="size-full" style={style} />
        )
      }
    />
  );

  return (
    <div ref={box} className="relative size-full">
      {cover}
      {failed ? (
        <div role="status" className="absolute inset-x-2 bottom-2 rounded bg-black/70 px-2 py-1 text-[12px] text-white">
          {note.src ? 'This video couldn’t be loaded, so only its still is shown.' : 'This video couldn’t be loaded.'}
        </div>
      ) : readOnly ? (
        <button
          type="button"
          aria-label={`${playing ? 'Pause' : 'Play'} video${name ? `: ${name}` : ''}`}
          className={cn('pointer-events-auto absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white', playing && 'opacity-0 hover:opacity-100 focus-visible:opacity-100')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => toggleVideoNote(id)}
        >
          <Play className="size-6 translate-x-px" fill="currentColor" strokeWidth={1.5} />
        </button>
      ) : playing ? null : (
        <div data-note-play="" aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white">
          <Play className="size-6 translate-x-px" fill="currentColor" strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}
