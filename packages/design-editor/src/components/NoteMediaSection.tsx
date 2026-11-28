/**
 * The Media section of a video note's properties: the video (replace it
 * with another video), its cover image (set or reset it), a scrubber over
 * the video on the canvas, and the Autoplay, Loop and Sound toggles.
 */

import { useEffect, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { SliderInput, SwitchInput } from '@open-artifact/ui';
import { videoOptions, type CanvasNote } from '@open-artifact/design-core';
import { useVideo, videoElements } from '../state/video.ts';
import { toggleVideoNote } from '../services/video-play.ts';
import { pickFile, replaceVideo, resetCoverImage, setCoverImage, setNoteCssKeys, setVideoSetting } from '../services/video-note.ts';
import { clockTime, coverName, scrubRefusal, VIDEO_TIPS, videoName, type VideoToggle } from '../lib/video-settings.ts';
import { VIDEO_ACCEPT } from '../lib/video-files.ts';
import { PButton, PIconButton, PInput, PRow, PSection, PSelect } from './fields.tsx';

const FITS = ['fill', 'contain', 'cover', 'none', 'scale-down'].map((value) => ({ value, label: value === 'scale-down' ? 'Scale down' : value[0]!.toUpperCase() + value.slice(1) }));

/** The note's `<video>` on the canvas, read again a few times a second. */
function useVideoClock(id: string) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, []);
  const element = videoElements.get(id) ?? null;
  return {
    element,
    time: element?.currentTime ?? 0,
    duration: element?.duration ?? Number.NaN,
    loaded: Boolean(element && element.readyState >= 1),
  };
}

function Scrubber({ id }: { id: string }) {
  const waiting = useVideo((s) => s.slots.waiting.includes(id));
  const on = useVideo((s) => s.slots.playing.includes(id) || s.slots.waiting.includes(id));
  const clock = useVideoClock(id);
  const why = scrubRefusal({ mounted: clock.element !== null, waiting, loaded: clock.loaded, duration: clock.duration });
  const length = why ? 0 : clock.duration;
  return (
    <PRow label="Time" title={why ?? undefined}>
      <PIconButton label={on ? 'Pause video' : 'Play video'} onClick={() => toggleVideoNote(id)}>
        {on ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </PIconButton>
      <span className="min-w-0 flex-1" title={why ?? undefined}>
        <SliderInput
          aria-label="Video time"
          value={why ? 0 : clock.time}
          min={0}
          max={length || 1}
          step={0.01}
          keyStep={1}
          disabled={why !== null}
          onChange={(value) => {
            if (clock.element && !why) clock.element.currentTime = value;
          }}
        />
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-chrome-muted">{why ? '–:––' : clockTime(clock.time)}</span>
    </PRow>
  );
}

function Toggle({ label, title, checked, disabled, onChange }: { label: string; title?: string; checked: boolean; disabled: boolean; onChange(on: boolean): void }) {
  return (
    <PRow label={label} title={title}>
      <span className="flex flex-1 justify-end" title={title}>
        <SwitchInput aria-label={label} checked={checked} disabled={disabled} onChange={onChange} />
      </span>
    </PRow>
  );
}

export function NoteMediaSection({ id, note, readOnly }: { id: string; note: CanvasNote; readOnly: boolean }) {
  const options = videoOptions(note);
  const off = readOnly;
  const set = (toggle: VideoToggle) => (on: boolean) => setVideoSetting(id, toggle, on);
  return (
    <PSection title="Media">
      <PRow label="Video">
        <PButton
          className="min-w-0 flex-1 justify-start"
          title="Replace video"
          aria-label={`Replace video: ${videoName(note)}`}
          disabled={off}
          onClick={() => pickFile(VIDEO_ACCEPT, (file) => void replaceVideo(id, file))}
        >
          <span className="truncate">{videoName(note)}</span>
        </PButton>
      </PRow>
      <PRow label="Cover image">
        <PButton
          className="min-w-0 flex-1 justify-start"
          title="Set cover image"
          aria-label={`Set cover image: ${coverName(note)}`}
          disabled={off}
          onClick={() => pickFile('image/*', (file) => void setCoverImage(id, file))}
        >
          <span className="truncate">{coverName(note)}</span>
        </PButton>
        {note.videoCover === 'custom' ? (
          <PIconButton label="Reset cover image" disabled={off} onClick={() => void resetCoverImage(id)}>
            <RotateCcw className="size-3.5" />
          </PIconButton>
        ) : null}
      </PRow>
      <PRow label="Fit">
        <PSelect aria-label="Object fit" value={note.css?.['object-fit'] ?? (note.videoCover ? 'cover' : 'fill')} options={FITS} disabled={off} onChange={(value) => setNoteCssKeys(id, { 'object-fit': value === 'fill' ? null : value })} />
      </PRow>
      <PRow label="Position">
        <PInput aria-label="Object position" value={note.css?.['object-position'] ?? ''} placeholder="center" disabled={off} onCommit={(value) => setNoteCssKeys(id, { 'object-position': value || null })} />
      </PRow>
      <Scrubber id={id} />
      <Toggle label="Autoplay" title={VIDEO_TIPS.autoplay} checked={options.autoplay} disabled={off} onChange={set('autoplay')} />
      <Toggle label="Loop" checked={options.loop} disabled={off} onChange={set('loop')} />
      <Toggle
        label="Sound"
        title={options.autoplay ? VIDEO_TIPS.soundUnderAutoplay : undefined}
        checked={options.sound}
        disabled={off || options.autoplay}
        onChange={set('sound')}
      />
    </PSection>
  );
}
