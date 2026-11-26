import { useState, type ReactElement } from 'react';
import { Download } from 'lucide-react';
import { saveFile } from '@open-artifact/editor-kit';
import { ChromeButton } from '@open-artifact/editor-kit/react';
import { toast } from '@open-artifact/ui';
import { pause, seekTo } from '../engine/actions.ts';
import { maybeSession } from '../host/session.ts';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useWorking } from '../stores/working.ts';
import { filmTextFile, textFileName, type SceneText } from './film-text.ts';
import { useSceneTexts } from './use-scene-texts.ts';
import * as words from './words.ts';

function Lines({ head, lines }: { head: string; lines: readonly string[] }): ReactElement | null {
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <h4 className="text-[11px] font-medium text-chrome-muted">{head}</h4>
      <ul className="flex list-none flex-col gap-0.5 text-[12px] break-words">
        {lines.map((line, index) => (
          <li key={index} dir="auto">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Scene({ scene, index }: { scene: SceneText; index: number }): ReactElement {
  const name = words.sceneName(scene.name, index);
  const at = words.startsAt(scene.from);
  return (
    <li className="flex flex-col gap-1.5 border-b border-chrome-line px-4 py-3" data-video-read-scene={index}>
      <h3 className="m-0">
        <button
          type="button"
          aria-label={words.goToScene(name, at)}
          className="flex w-full min-w-0 items-baseline gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-chrome-focus"
          onClick={() => {
            pause();
            seekTo(scene.from);
          }}
        >
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {name}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-chrome-muted">{at}</span>
        </button>
      </h3>
      {scene.note !== '' ? (
        <p className="text-[12px] break-words text-chrome-muted" dir="auto">
          {scene.note}
        </p>
      ) : null}
      {scene.shown === null ? <p className="text-[12px] text-chrome-muted">{words.WORDS_UNREAD}</p> : null}
      <Lines head={words.ON_SCREEN} lines={scene.shown ?? []} />
      <Lines head={words.SPOKEN} lines={scene.spoken} />
    </li>
  );
}

/** Read as text: each scene's name, start, description, the words on screen and the words spoken; a click goes there. */
export function ReadAsTextPanel(): ReactElement {
  const scenes = useSceneTexts();
  const title = useFilm((s) => s.film?.meta?.title ?? '');
  const ready = useFilm((s) => s.stage === 'ready');
  const playing = usePlayback((s) => s.playing);
  const agent = useWorking((s) => s.name);
  const [saving, setSaving] = useState(false);
  if (!ready) return <p className="px-4 py-3 text-[12px] text-chrome-muted">{words.NOTHING_TO_READ}</p>;
  const reading = scenes.some((scene) => scene.shown === undefined);
  const save = async (): Promise<void> => {
    const name = textFileName(title);
    const text = filmTextFile(title, scenes, { scene: words.sceneName, startsAt: words.startsAt, onScreen: words.ON_SCREEN, spoken: words.SPOKEN, unread: words.WORDS_UNREAD });
    setSaving(true);
    try {
      await saveFile(maybeSession()?.downloads ?? null, name, new Blob([text], { type: 'text/plain;charset=utf-8' }));
      toast.add({ title: words.savedFile(name) });
    } catch {
      toast.add({ title: words.SAVE_FAILED });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex min-h-full flex-col" data-video-read="">
      <ol className="m-0 flex list-none flex-col p-0">
        {scenes.map((scene, index) => (
          <Scene key={index} scene={scene} index={index} />
        ))}
      </ol>
      <div className="mt-auto flex flex-col gap-2 px-4 py-3 text-[11px] text-chrome-muted">
        {scenes.some((scene) => scene.note !== '') ? <p>{words.notesBy(agent)}</p> : null}
        <p>{words.PICTURE_WORDS}</p>
        {reading ? <p role="status">{playing ? words.PAUSE_TO_READ : words.WORDS_READING}</p> : null}
        <div className="flex">
          <ChromeButton disabled={reading || saving} title={reading ? words.SAVE_WHEN_DONE : undefined} onClick={() => void save()}>
            <Download className="size-4" />
            {words.SAVE_TEXT}
          </ChromeButton>
        </div>
      </div>
    </div>
  );
}
