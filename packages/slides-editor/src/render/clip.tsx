/**
 * A video's play button and its controls.
 *
 * - {@link ClipSign}: the round play sign over a video's poster in the editor and in thumbnails, so a video reads
 *   as one at a glance (it takes no clicks).
 * - {@link ClipPlayButton}: the same button, pressable, while presenting a video that waits to be played.
 * - {@link ClipPlayer}: an uploaded clip while presenting: the play button over it while it is paused, and a bar at
 *   its bottom-left with restart, play / pause and sound, shown while the pointer moves over the clip or a control
 *   has the keyboard focus.
 *
 * The button and the bar are sized from the video's box (container query units), so they keep their proportion in
 * a thumbnail and on a full-screen slide alike. They live inside the slide, whose own CSS (css.ts) draws them.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Pause, Play, SkipBack, Volume2, VolumeX } from 'lucide-react';

/** How long the bar stays after the pointer stops moving over the clip, ms. */
export const CLIP_BAR_REST_MS = 2000;

/** The round play sign over a video in the editor and in thumbnails (`small`: drawn larger for its box, to read there). */
export function ClipSign({ small = false }: { small?: boolean }): ReactNode {
  return (
    <span className="open-artifact-clip-play" data-open-artifact-clip-sign={small ? 'small' : ''} aria-hidden>
      <span className="open-artifact-clip-button">
        <Play fill="currentColor" strokeWidth={0} />
      </span>
    </span>
  );
}

/** The play button of a video that waits to be played. */
export function ClipPlayButton({ label = 'Play video', onPlay }: { label?: string; onPlay(): void }): ReactNode {
  return (
    <span className="open-artifact-clip-play">
      <button
        type="button"
        className="open-artifact-clip-button"
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          onPlay();
        }}
      >
        <Play fill="currentColor" strokeWidth={0} />
      </button>
    </span>
  );
}

/** Props of {@link ClipPlayer}. */
export interface ClipPlayerProps {
  src: string;
  poster?: string;
  /** Plays with sound from the start (else muted, so it may start by itself). */
  sound: boolean;
  loop: boolean;
  style: CSSProperties;
}

/** An uploaded clip while presenting, with its play button and control bar. */
export function ClipPlayer({ src, poster, sound, loop, style }: ClipPlayerProps): ReactNode {
  const video = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(!sound);
  const [awake, setAwake] = useState(false);
  const rest = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(rest.current), []);
  // React sets `muted` only as the clip mounts; the sound button changes it after.
  useEffect(() => {
    if (video.current) video.current.muted = muted;
  }, [muted]);

  const wake = (): void => {
    setAwake(true);
    clearTimeout(rest.current);
    rest.current = setTimeout(() => setAwake(false), CLIP_BAR_REST_MS);
  };
  const play = (): void => {
    const el = video.current;
    // With sound, a browser may refuse to start without a click: the play button stays for one.
    if (el) void el.play().catch(() => setPaused(true));
  };
  const toggle = (): void => {
    const el = video.current;
    if (!el) return;
    if (el.paused) play();
    else el.pause();
  };

  return (
    <>
      <video
        ref={video}
        src={src}
        poster={poster}
        autoPlay
        playsInline
        muted={muted}
        loop={loop}
        style={style}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onEnded={() => setPaused(true)}
      />
      {/* Over the clip: a click plays or pauses it (and does not turn the slide); moving shows the bar. */}
      <span
        className="open-artifact-clip-controls"
        data-open-artifact-clip-controls=""
        data-awake={awake || paused ? '' : undefined}
        onPointerMove={wake}
        onPointerDown={wake}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
      >
        <span role="group" aria-label="Video" className="open-artifact-clip-bar" onFocus={wake}>
          <button
            type="button"
            aria-label="Restart"
            onClick={(event) => {
              event.stopPropagation();
              const el = video.current;
              if (!el) return;
              el.currentTime = 0;
              play();
            }}
          >
            <SkipBack fill="currentColor" />
          </button>
          <button
            type="button"
            aria-label={paused ? 'Play' : 'Pause'}
            onClick={(event) => {
              event.stopPropagation();
              toggle();
            }}
          >
            {paused ? <Play fill="currentColor" strokeWidth={0} /> : <Pause fill="currentColor" strokeWidth={0} />}
          </button>
          <button
            type="button"
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={(event) => {
              event.stopPropagation();
              setMuted(!muted);
            }}
          >
            {muted ? <VolumeX /> : <Volume2 />}
          </button>
        </span>
      </span>
      {paused ? <ClipPlayButton onPlay={play} /> : null}
    </>
  );
}
