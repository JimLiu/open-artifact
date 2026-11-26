import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import { Film, LoaderCircle, Pause, Play } from 'lucide-react';
import { Button, Dialog, ScrubNumberField, cn } from '@open-artifact/ui';
import { askFitVideo } from '../agent/requests.ts';
import { useWorking } from '../stores/working.ts';
import { VIDEO_FILE_ACCEPT, addVideoPart, closeAddVideo, pickVideoFile, setVideoPart, useAddVideo } from './add-video.ts';
import { sliderKey } from './slider-keys.ts';
import * as words from './words.ts';

const THUMBS = 8;
const PART_STEP = 0.1;

/** Stills along the video, taken once it can be seeked: data URLs, `null` where one could not be taken. */
function useStrip(url: string | null, duration: number): ReadonlyArray<string | null> {
  const [stills, setStills] = useState<ReadonlyArray<string | null>>([]);
  useEffect(() => {
    setStills([]);
    if (url === null || !(duration > 0)) return;
    let stopped = false;
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = url;
    const canvas = document.createElement('canvas');
    const take = async (): Promise<void> => {
      const taken: Array<string | null> = [];
      for (let index = 0; index < THUMBS && !stopped; index++) {
        const at = ((index + 0.5) / THUMBS) * duration;
        const seeked = new Promise<void>((resolve) => video.addEventListener('seeked', () => resolve(), { once: true }));
        video.currentTime = Math.min(at, Math.max(0, duration - 0.05));
        await Promise.race([seeked, new Promise((resolve) => setTimeout(resolve, 3000))]);
        try {
          canvas.height = 48;
          canvas.width = Math.max(1, Math.round((48 * video.videoWidth) / Math.max(1, video.videoHeight)));
          canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
          taken.push(canvas.toDataURL('image/jpeg', 0.6));
        } catch {
          taken.push(null);
        }
        if (!stopped) setStills([...taken]);
      }
    };
    video.addEventListener('loadeddata', () => void take(), { once: true });
    return () => {
      stopped = true;
      video.removeAttribute('src');
      video.load();
    };
  }, [url, duration]);
  return stills;
}

/** The video in a strip of stills, the part to keep between two handles. */
function PartStrip({ duration, start, end }: { duration: number; start: number; end: number }): ReactElement {
  const url = useAddVideo((s) => s.url);
  const stills = useStrip(url, duration);
  const strip = useRef<HTMLDivElement>(null);
  const toSecond = (clientX: number): number => {
    const box = strip.current?.getBoundingClientRect();
    if (box === undefined || !(box.width > 0)) return 0;
    return Math.round((((clientX - box.left) / box.width) * duration) / PART_STEP) * PART_STEP;
  };
  const handle = (edge: 'start' | 'end'): ReactElement => {
    const value = edge === 'start' ? start : end;
    const move = (to: number): void => (edge === 'start' ? setVideoPart(to, end, 'start') : setVideoPart(start, to, 'end'));
    const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus({ preventScroll: true });
    };
    const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) move(toSecond(event.clientX));
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
      const keyMove = sliderKey(event.key);
      if (keyMove === null) return;
      event.preventDefault();
      if ('to' in keyMove) move(keyMove.to === 'min' ? 0 : duration);
      else move(value + keyMove.step * (event.shiftKey ? 1 : PART_STEP));
    };
    return (
      <div
        role="slider"
        tabIndex={0}
        aria-label={edge === 'start' ? words.PART_START : words.PART_END}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration * 1000) / 1000}
        aria-valuenow={value}
        aria-valuetext={words.intoVideo(value)}
        className="absolute top-0 bottom-0 z-10 -ml-1.5 flex w-3 cursor-ew-resize justify-center outline-none focus-visible:[&>span]:bg-accent"
        style={{ left: `${(value / duration) * 100}%` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      >
        <span className="w-1 rounded-full bg-fg" />
      </div>
    );
  };
  return (
    <div ref={strip} aria-label={words.PART_STRIP} role="group" className="relative h-12 overflow-hidden rounded-md bg-surface-2">
      <div className="flex h-full">
        {Array.from({ length: THUMBS }, (_, index) => {
          const still = stills[index] ?? null;
          return (
            <span key={index} className="block h-full flex-1 overflow-hidden">
              {still === null ? null : <img src={still} alt="" draggable={false} className="block h-full w-full object-cover" />}
            </span>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/55" style={{ width: `${(start / duration) * 100}%` }} />
      <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/55" style={{ width: `${(1 - end / duration) * 100}%` }} />
      <div
        className="pointer-events-none absolute inset-y-0 rounded-sm border-2 border-accent"
        style={{ left: `${(start / duration) * 100}%`, width: `${((end - start) / duration) * 100}%` }}
      />
      {handle('start')}
      {handle('end')}
    </div>
  );
}

/** The preview, playing only the part. */
function PartPreview({ start, end }: { start: number; end: number }): ReactElement {
  const url = useAddVideo((s) => s.url);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (element === null || playing) return;
    element.currentTime = start;
  }, [start, playing]);
  const toggle = (): void => {
    const element = video.current;
    if (element === null) return;
    if (playing) {
      element.pause();
      return;
    }
    if (element.currentTime < start || element.currentTime >= end - 0.05) element.currentTime = start;
    void element.play().catch(() => setPlaying(false));
  };
  return (
    <div className="flex flex-col gap-2">
      <video
        ref={video}
        src={url ?? undefined}
        playsInline
        preload="auto"
        className="aspect-video w-full rounded-md bg-black object-contain"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => {
          if (event.currentTarget.currentTime >= end) {
            event.currentTarget.pause();
            event.currentTarget.currentTime = end;
          }
        }}
      />
      <div className="flex justify-start">
        <Button size="sm" icon={playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} onClick={toggle}>
          {playing ? words.PAUSE_PART : words.PLAY_PART}
        </Button>
      </div>
    </div>
  );
}

function PickView(): ReactElement {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    // Handled here, so the page's own guard against stray drops lets it through.
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined) void pickVideoFile(file);
  };
  return (
    <div
      className={cn('flex flex-col items-center gap-3 rounded-lg border border-dashed border-line px-4 py-8 text-center', over && 'border-accent bg-accent/5')}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <Film className="size-6 text-fg-muted" aria-hidden />
      <p className="text-[13px] text-fg-muted">{words.DROP_HERE}</p>
      <Button variant="primary" onClick={() => input.current?.click()}>
        {words.CHOOSE_FILE}
      </Button>
      <input
        ref={input}
        type="file"
        accept={VIDEO_FILE_ACCEPT}
        className="hidden"
        aria-label={words.CHOOSE_FILE}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file !== undefined) void pickVideoFile(file);
        }}
      />
    </div>
  );
}

function ChooseView(): ReactElement | null {
  const facts = useAddVideo((s) => s.facts);
  const start = useAddVideo((s) => s.start);
  const end = useAddVideo((s) => s.end);
  const longest = useAddVideo((s) => s.longest);
  if (facts === null) return null;
  const total = facts.duration;
  return (
    <div className="flex flex-col gap-3">
      <PartPreview start={start} end={end} />
      <PartStrip duration={total} start={start} end={end} />
      <div className="grid grid-cols-2 gap-2">
        <ScrubNumberField
          aria-label={words.PART_START}
          label={words.START}
          value={start}
          unit={words.SECONDS_UNIT}
          step={PART_STEP}
          largeStep={1}
          precision={1}
          min={0}
          max={Math.round(total * 1000) / 1000}
          onCommit={(value) => setVideoPart(value, end, 'start')}
        />
        <ScrubNumberField
          aria-label={words.PART_END}
          label={words.END}
          value={end}
          unit={words.SECONDS_UNIT}
          step={PART_STEP}
          largeStep={1}
          precision={1}
          min={0}
          max={Math.round(total * 1000) / 1000}
          onCommit={(value) => setVideoPart(start, value, 'end')}
        />
      </div>
      <p className="text-xs text-fg-muted">{words.partNote(end - start, total, longest)}</p>
    </div>
  );
}

function WorkingView(): ReactElement {
  const phase = useAddVideo((s) => s.phase);
  const progress = useAddVideo((s) => s.progress);
  const share = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <div className="flex items-center gap-2 text-xs">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
        <span>{phase === 'saving' ? words.SAVING : words.PREPARING}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share}>
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${phase === 'saving' ? 100 : share}%` }} />
      </div>
    </div>
  );
}

function AddedView(): ReactElement | null {
  const added = useAddVideo((s) => s.added);
  const agent = useWorking((s) => s.name);
  if (added === null) return null;
  return <p className="text-[13px]">{added.blank ? words.addedToBlank(agent) : words.addedAs(added.scene)}</p>;
}

/** Adding a video: pick a file, choose the part, add it as a scene. */
export function AddVideoDialog(): ReactElement | null {
  const open = useAddVideo((s) => s.open);
  const phase = useAddVideo((s) => s.phase);
  const error = useAddVideo((s) => s.error);
  const added = useAddVideo((s) => s.added);
  const agent = useWorking((s) => s.name);
  if (!open) return null;
  const busy = phase === 'reading' || phase === 'preparing' || phase === 'saving';
  const footer =
    phase === 'added' ? (
      <>
        <Button onClick={closeAddVideo}>{words.DONE}</Button>
        <Button
          variant="primary"
          onClick={() => {
            if (added !== null) void askFitVideo(added.scene, added.blank);
            closeAddVideo();
          }}
        >
          {words.askFit(agent)}
        </Button>
      </>
    ) : (
      <>
        <Button onClick={closeAddVideo}>{words.CANCEL}</Button>
        {phase === 'choose' || phase === 'preparing' || phase === 'saving' ? (
          <Button variant="primary" disabled={phase !== 'choose'} onClick={() => void addVideoPart()}>
            {words.ADD}
          </Button>
        ) : null}
      </>
    );
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) closeAddVideo();
      }}
      title={words.ADD_VIDEO}
      className="w-[min(34rem,calc(100vw-2rem))]"
      footer={footer}
    >
      <div className="flex flex-col gap-3 text-[13px]">
        {phase === 'pick' ? <PickView /> : null}
        {phase === 'reading' ? (
          <p className="flex items-center gap-2 text-fg-muted" aria-live="polite">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            {words.READING}
          </p>
        ) : null}
        {phase === 'choose' || phase === 'preparing' || phase === 'saving' ? <ChooseView /> : null}
        {phase === 'preparing' || phase === 'saving' ? <WorkingView /> : null}
        {phase === 'added' ? <AddedView /> : null}
        {error !== null && !busy ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
        {phase !== 'added' ? <p className="text-xs text-fg-muted">{words.RIGHTS_NOTE}</p> : null}
      </div>
    </Dialog>
  );
}
