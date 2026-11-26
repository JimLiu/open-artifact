import type { ReactElement } from 'react';
import { partIndexAt } from '../layers/stretch.ts';
import { selectParts, useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useUi } from '../stores/ui.ts';
import { READ_PANEL } from './panel-id.ts';
import { useSceneTexts } from './use-scene-texts.ts';
import * as words from './words.ts';

function List({ head, lines }: { head: string; lines: readonly string[] }): ReactElement | null {
  if (lines.length === 0) return null;
  return (
    <>
      <p>{head}</p>
      <ul>
        {lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </>
  );
}

/**
 * For screen readers, under the picture: each scene's name, where it starts and its description, then its words on
 * screen and its spoken lines, the scene playing marked current. Left out while Read as text shows the same.
 */
export function SceneWords(): ReactElement | null {
  const scenes = useSceneTexts();
  const ready = useFilm((s) => s.stage === 'ready');
  const parts = useFilm(selectParts);
  const now = usePlayback((s) => partIndexAt(parts, s.time));
  const reading = useUi((s) => s.panel === READ_PANEL);
  if (!ready || reading || scenes.length === 0) return null;
  return (
    <section className="sr-only" aria-labelledby="video-scene-words" data-video-scene-words="">
      <h2 id="video-scene-words">{words.WHAT_IT_SHOWS}</h2>
      <ol>
        {scenes.map((scene, index) => {
          const current = index === now || (now < 0 && index === 0);
          return (
            <li key={index} aria-current={current ? 'true' : undefined}>
              <p>
                {words.sceneName(scene.name, index)}, {words.startsAt(scene.from)}
                {current ? `, ${words.CURRENT}` : ''}
                {scene.note !== '' ? `. ${scene.note}` : ''}
              </p>
              <List head={words.ON_SCREEN} lines={scene.shown ?? []} />
              <List head={words.SPOKEN} lines={scene.spoken} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
