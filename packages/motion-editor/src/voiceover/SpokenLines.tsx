import type { ReactElement } from 'react';
import { usePlayback } from '../stores/playback.ts';
import { lineAt, voiceWords } from './lines.ts';
import { useVoiceover } from './store.ts';
import { WHAT_THE_VOICEOVER_SAYS } from './words.ts';

/** For screen readers: the voiceover's lines in order, the one being said marked current. */
export function SpokenLines(): ReactElement | null {
  const lines = useVoiceover((s) => s.lines);
  const now = usePlayback((s) => (lines === null ? -1 : lineAt(lines, s.time)));
  if (lines === null || lines.length === 0) return null;
  return (
    <section className="sr-only" aria-labelledby="video-spoken-lines" data-video-spoken-lines="">
      <h2 id="video-spoken-lines">{WHAT_THE_VOICEOVER_SAYS}</h2>
      <ol>
        {lines.map((line, index) => (
          <li key={index} aria-current={index === now ? 'true' : undefined}>
            {voiceWords(line.text)}
          </li>
        ))}
      </ol>
    </section>
  );
}
