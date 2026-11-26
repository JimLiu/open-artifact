import type { ReactElement } from 'react';
import { Scissors } from 'lucide-react';
import { ChromeButton, Tip } from '@open-artifact/editor-kit/react';
import { ScrubNumberField } from '@open-artifact/ui';
import { CLIP_TRIM_STEP, clipTrimRange } from '@open-artifact/motion-core';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { PanelRow } from '../tweaks/PanelSection.tsx';
import { announceSplitBlock, splitBlock, splitScene, trimScene } from './edits.ts';
import { useClipLength, useSceneClip } from './scene-clip.ts';
import * as words from './words.ts';

const toMs = (value: number): number => Math.round(value * 1000) / 1000;

/** Split at the playhead: still focusable when it cannot, so a click or Enter says why. */
function SplitButton({ sceneId, off }: { sceneId: string; off: boolean }): ReactElement {
  // Redrawn as the playhead and the film move, so the button greys out in time.
  usePlayback((s) => s.time);
  useFilm((s) => s.revision);
  const block = off ? null : splitBlock(sceneId);
  const blocked = block !== null;
  return (
    <Tip label={words.SPLIT_HINT} side="top">
      <ChromeButton
        aria-disabled={blocked || undefined}
        aria-description={words.SPLIT_HINT}
        disabled={off}
        className={blocked ? 'opacity-40' : undefined}
        onClick={() => {
          if (block !== null) announceSplitBlock(block);
          else splitScene(sceneId);
        }}
      >
        <Scissors className="size-4" aria-hidden />
        {words.SPLIT_AT_PLAYHEAD}
      </ChromeButton>
    </Tip>
  );
}

/** A video scene's start and end in its video, split at the playhead, and a note on what trimming keeps. */
export function ClipRows({ sceneId, number, off }: { sceneId: string | null; number: number; off: boolean }): ReactElement | null {
  const clip = useSceneClip(sceneId);
  const length = useClipLength(clip?.ref ?? null);
  if (clip === null || sceneId === null) return null;
  const range = clipTrimRange(clip.texts, clip.form, length);
  if (range === null) return null;
  const step = CLIP_TRIM_STEP * clip.form.speed;
  const key = `${sceneId}:${range.start}:${range.end}`;
  return (
    <>
      <PanelRow label={words.START}>
        <ScrubNumberField
          key={`start:${key}`}
          aria-label={words.trimStartField}
          className="min-w-0 flex-1"
          value={toMs(range.start)}
          unit={words.SECONDS_UNIT}
          step={step}
          largeStep={10 * step}
          precision={2}
          min={toMs(range.startMin)}
          max={toMs(range.startMax)}
          disabled={off}
          onCommit={(seconds) => trimScene(sceneId, seconds, range.end, number)}
        />
      </PanelRow>
      <PanelRow label={words.END}>
        <ScrubNumberField
          key={`end:${key}`}
          aria-label={words.trimEndField}
          className="min-w-0 flex-1"
          value={toMs(range.end)}
          unit={words.SECONDS_UNIT}
          step={step}
          largeStep={10 * step}
          precision={2}
          min={toMs(range.endMin)}
          max={toMs(range.endMax)}
          disabled={off}
          onCommit={(seconds) => trimScene(sceneId, range.start, seconds, number)}
        />
      </PanelRow>
      <div className="flex justify-end">
        <SplitButton sceneId={sceneId} off={off} />
      </div>
      <p className="text-xs leading-4 text-chrome-muted">{words.TRIM_NOTE}</p>
    </>
  );
}
