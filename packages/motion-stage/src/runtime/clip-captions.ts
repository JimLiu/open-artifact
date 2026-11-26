import { filmSeconds } from '@open-artifact/motion-core';
import type { NarrationReport } from '../protocol.ts';
import { captionLayer } from './captions.ts';
import type { CaptionLine } from './captions.ts';
import { clipCaptions } from './clips.ts';
import { film } from './film.ts';
import type { Cut } from './film.ts';
import { fontFamilies } from './fonts.ts';
import type { SceneClock } from './recut.ts';

const fields = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;

/**
 * Lays the clips' captions (kit.video's `captions`) on the film's caption layer with the narration's, one layer, so a
 * clip's words show in the player and in every export. The narration's `captions: false` turns them off too, and its
 * `{ style }` styles them alike. Their times move with the picture, as the clip does.
 */
export function addClipCaptions(cut: Cut, narration: NarrationReport | null, clock: SceneClock): void {
  const said = clipCaptions(cut.duration);
  if (said.length === 0) return;
  const settings = fields(cut.narration)?.['captions'];
  if (settings === false) return;
  const style = fields(settings)?.['style'];
  const lines: CaptionLine[] = said.map((line) => {
    const at = clock.back(line.at);
    return { at, dur: Math.max(0, clock.back(filmSeconds(line.at + line.dur)) - at), text: line.text };
  });
  // The narration's lines are on the layer only where it made one.
  const spoken = film.captions !== null && narration !== null ? narration.lines : [];
  film.captions = captionLayer([...spoken, ...lines], typeof style === 'string' ? style : undefined, Math.min(cut.width, cut.height), fontFamilies.sans);
}
