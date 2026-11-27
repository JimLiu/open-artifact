import { useLayoutEffect, useRef, type ReactElement, type ReactNode, type RefObject } from 'react';
import { Maximize, Minimize, Pause, Play, Repeat, SkipBack } from 'lucide-react';
import { ToolButton } from '@open-artifact/editor-kit/react';
import { restart, setLoop, togglePlay } from '../engine/actions.ts';
import { useFilm } from '../stores/film.ts';
import { usePlayback } from '../stores/playback.ts';
import { useUi } from '../stores/ui.ts';
import { fullscreenAvailable, toggleFullscreen } from './fullscreen.ts';
import { MoreMenu } from './MoreMenu.tsx';
import { measured, SLIDER_ROOM, ToolbarPlaceContext, toolbarPlace, usePopupSide, useToolbarWidths, type ToolbarPlace } from './placement.ts';
import { useToolbar, type ToolbarItem } from './slots.ts';
import { TimeDisplay } from './TimeDisplay.tsx';
import { VolumeControl } from './VolumeControl.tsx';
import * as words from './words.ts';

const BAR_CLASS = 'flex h-10 shrink-0 items-center gap-0.5 rounded-xl border border-chrome-line bg-chrome px-1 shadow-chrome';

export function useToolbarPlace(): ToolbarPlace {
  const fullscreen = useUi((s) => s.fullscreen);
  return useToolbarWidths((widths) => toolbarPlace(widths, fullscreen));
}

/** Keeps the page's width, which decides where the toolbar goes. */
export function useToolbarRoom(page: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = page.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => measured('room', element.clientWidth));
    observer.observe(element);
    measured('room', element.clientWidth);
    return () => observer.disconnect();
  }, [page]);
}

/** Measures a top bar whenever it changes size; the volume slider counts as open. */
function useBarWidth(bar: RefObject<HTMLDivElement | null>, key: 'playback' | 'actions'): void {
  useLayoutEffect(() => {
    const element = bar.current;
    if (element === null) return;
    const measure = (): void => {
      const slider = element.querySelector<HTMLElement>('[data-volume-slider]');
      measured(key, element.offsetWidth + (slider === null ? 0 : SLIDER_ROOM - slider.offsetWidth));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [bar, key]);
}

function Items({ items, side }: { items: readonly ToolbarItem[]; side: ToolbarItem['side'] }): ReactNode {
  return items
    .filter((item) => item.side === side)
    .map((item) => (
      <span key={item.id} className="contents">
        {item.render()}
      </span>
    ));
}

/** Play, back to the start, time, loop and sound. */
function PlaybackControls(): ReactElement {
  const playing = usePlayback((s) => s.playing);
  const loop = usePlayback((s) => s.loop);
  const ready = useFilm((s) => s.stage === 'ready');
  const tipSide = usePopupSide();
  return (
    <>
      <ToolButton
        label={playing ? words.PAUSE : ready ? words.PLAY : words.NO_ANIMATION_TO_PLAY}
        shortcut="Space"
        size="lg"
        tipSide={tipSide}
        disabled={!ready}
        icon={playing ? <Pause /> : <Play />}
        onClick={togglePlay}
      />
      <ToolButton label={words.BACK_TO_START} shortcut="Home" size="lg" tipSide={tipSide} className="@max-[26rem]:hidden" disabled={!ready} icon={<SkipBack />} onClick={restart} />
      <TimeDisplay />
      <ToolButton label={words.LOOP} size="lg" tipSide={tipSide} pressed={loop} icon={<Repeat />} onClick={() => setLoop(!loop)} />
      <VolumeControl />
    </>
  );
}

/** The buttons the page's parts add, More, full screen, and the panel toggle last. */
function ActionControls(): ReactElement {
  const fullscreen = useUi((s) => s.fullscreen);
  const items = useToolbar((s) => s.items);
  const canFullscreen = fullscreenAvailable();
  return (
    <>
      <Items items={items} side="start" />
      <Items items={items} side="end" />
      <MoreMenu />
      <ToolButton
        label={!canFullscreen ? words.FULL_SCREEN_UNAVAILABLE : fullscreen ? words.EXIT_FULL_SCREEN : words.FULL_SCREEN}
        shortcut="F"
        size="lg"
        tipSide={usePopupSide()}
        disabled={!canFullscreen}
        icon={fullscreen ? <Minimize /> : <Maximize />}
        onClick={toggleFullscreen}
      />
      <Items items={items} side="last" />
    </>
  );
}

/** The two bars over the top of the page, playback on the left and actions on the right, while they fit. */
export function TopBars(): ReactElement | null {
  const place = useToolbarPlace();
  if (place !== 'top') return null;
  return <MeasuredTopBars />;
}

function MeasuredTopBars(): ReactElement {
  const playback = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  useBarWidth(playback, 'playback');
  useBarWidth(actions, 'actions');
  return (
    <ToolbarPlaceContext.Provider value="top">
      <div className="flex shrink-0 items-start justify-between gap-2 px-3 pt-3">
        <div ref={playback} role="toolbar" aria-label={words.PLAYBACK} className={BAR_CLASS} data-video-transport="">
          <PlaybackControls />
        </div>
        <div ref={actions} role="toolbar" aria-label={words.ACTIONS} className={BAR_CLASS} data-video-transport="">
          <ActionControls />
        </div>
      </div>
    </ToolbarPlaceContext.Provider>
  );
}

/** The one bar at the bottom, when the top bars do not fit or in full screen. */
export function Transport(): ReactElement | null {
  const place = useToolbarPlace();
  if (place !== 'bottom') return null;
  return (
    <ToolbarPlaceContext.Provider value="bottom">
      <div role="toolbar" aria-label={words.PLAYBACK} className="@container flex h-12 shrink-0 items-center gap-0.5 px-2" data-video-transport="">
        <PlaybackControls />
        <span className="flex-1" />
        <ActionControls />
      </div>
    </ToolbarPlaceContext.Provider>
  );
}
