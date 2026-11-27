import * as React from 'react';
import { cn } from './cn.ts';
import { ShimmerText } from './shimmer-text.tsx';
import { useReducedMotion } from './platform.ts';

/**
 * What the agent is doing, as its mark shows it. `entrance` and `tickle` play once and
 * then call `onEnd`; `thinking` loops until the state changes.
 */
export type AgentMarkState = 'idle' | 'entrance' | 'tickle' | 'thinking';

const ONE_SHOT_STATES: ReadonlySet<AgentMarkState> = new Set(['entrance', 'tickle']);

/** A four-pointed star, with a small one beside it. */
const MAIN_STAR = 'M10.5 5c.7 5 3.5 7.8 8.5 8.5-5 .7-7.8 3.5-8.5 8.5-.7-5-3.5-7.8-8.5-8.5 5-.7 7.8-3.5 8.5-8.5Z';
const SMALL_STAR = 'M19 1.5c.3 2.1 1.4 3.2 3.5 3.5-2.1.3-3.2 1.4-3.5 3.5-.3-2.1-1.4-3.2-3.5-3.5 2.1-.3 3.2-1.4 3.5-3.5Z';

interface Motion {
  star: Keyframe[];
  twinkle: Keyframe[];
  timing: KeyframeAnimationOptions;
}

const MOTIONS: Readonly<Record<Exclude<AgentMarkState, 'idle'>, Motion>> = {
  entrance: {
    star: [
      { transform: 'scale(0) rotate(-90deg)', opacity: 0 },
      { transform: 'scale(1.12) rotate(8deg)', opacity: 1, offset: 0.7 },
      { transform: 'scale(1) rotate(0deg)', opacity: 1 },
    ],
    twinkle: [{ opacity: 0, transform: 'scale(0)' }, { opacity: 0, transform: 'scale(0)', offset: 0.5 }, { opacity: 1, transform: 'scale(1)' }],
    timing: { duration: 420, easing: 'cubic-bezier(0.165, 0.84, 0.44, 1)' },
  },
  tickle: {
    star: [
      { transform: 'scale(1) rotate(0deg)' },
      { transform: 'scale(1.15) rotate(-14deg)', offset: 0.3 },
      { transform: 'scale(1.05) rotate(10deg)', offset: 0.6 },
      { transform: 'scale(1) rotate(0deg)' },
    ],
    twinkle: [{ transform: 'scale(1)' }, { transform: 'scale(1.4)', offset: 0.4 }, { transform: 'scale(1)' }],
    timing: { duration: 480, easing: 'ease-in-out' },
  },
  thinking: {
    star: [
      { transform: 'scale(1) rotate(0deg)' },
      { transform: 'scale(0.82) rotate(90deg)', offset: 0.5 },
      { transform: 'scale(1) rotate(180deg)' },
    ],
    twinkle: [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0.25, transform: 'scale(0.5)', offset: 0.5 }, { opacity: 1, transform: 'scale(1)' }],
    timing: { duration: 1600, easing: 'ease-in-out', iterations: Number.POSITIVE_INFINITY },
  },
};

const scaled = (px: number): string => `calc(${px}px * var(--ui-rem-scale, 1))`;

function startMotion(element: SVGElement | null, frames: Keyframe[], timing: KeyframeAnimationOptions): Animation | null {
  if (element === null || typeof element.animate !== 'function') return null;
  try {
    return element.animate(frames, { fill: 'both', ...timing });
  } catch {
    return null;
  }
}

export interface AgentMarkProps {
  /** Pixels at the default type size, or any CSS length. */
  size?: number | string;
  state?: AgentMarkState;
  /** Fill of the mark; the agent's tint unless set, `currentColor` to follow the text. */
  color?: string;
  /** Called when a one-shot state has played, at once when motion is reduced. */
  onEnd?: () => void;
  className?: string;
}

/** The agent's mark, still or moving to show what the agent is doing. */
export const AgentMark = React.memo(function AgentMark({
  size = 16,
  state = 'idle',
  color = 'var(--ui-agent-tint)',
  onEnd,
  className,
}: AgentMarkProps): React.ReactElement {
  const star = React.useRef<SVGPathElement | null>(null);
  const twinkle = React.useRef<SVGPathElement | null>(null);
  const reducedMotion = useReducedMotion();
  const latestOnEnd = React.useRef(onEnd);
  React.useLayoutEffect(() => {
    latestOnEnd.current = onEnd;
  });

  React.useLayoutEffect(() => {
    if (state === 'idle') return;
    const isOneShot = ONE_SHOT_STATES.has(state);
    const motion = MOTIONS[state];
    const starMotion = reducedMotion ? null : startMotion(star.current, motion.star, motion.timing);
    const twinkleMotion = reducedMotion ? null : startMotion(twinkle.current, motion.twinkle, motion.timing);
    let isCurrent = true;
    if (isOneShot) {
      const finish = (): void => {
        if (isCurrent) latestOnEnd.current?.();
      };
      if (starMotion === null) queueMicrotask(finish);
      else starMotion.finished.then(finish, () => {});
    }
    return () => {
      isCurrent = false;
      starMotion?.cancel();
      twinkleMotion?.cancel();
    };
  }, [state, reducedMotion]);

  const length = typeof size === 'number' ? scaled(size) : size;
  return (
    <svg
      data-ui="AgentMark"
      data-state={state}
      aria-hidden
      viewBox="0 0 24 24"
      fill={color}
      className={cn('shrink-0 overflow-visible forced-colors:fill-[CanvasText]', className)}
      style={{ width: length, height: length }}
    >
      <path ref={star} d={MAIN_STAR} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
      <path ref={twinkle} d={SMALL_STAR} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
    </svg>
  );
});

export type WorkingMarkState = 'working' | 'blocked';

export interface WorkingMarkProps {
  /** `blocked` holds the mark still, while the agent waits on someone. */
  state?: WorkingMarkState;
  className?: string;
}

/** Shows beside a line of text that the agent is busy with something. */
export const WorkingMark = React.memo(function WorkingMark({ state = 'working', className }: WorkingMarkProps): React.ReactElement {
  return (
    <span data-ui="WorkingMark" aria-hidden className={cn('inline-flex shrink-0 select-none items-center justify-center', className)}>
      <AgentMark size={14} state={state === 'working' ? 'thinking' : 'idle'} />
    </span>
  );
});

/** A working mark on its own, not handed on from another mark that was showing before it. */
export function StandaloneWorkingMark(): React.ReactElement {
  return <WorkingMark />;
}

/** The words of a row the agent is working on, with a sheen passing over them. */
export function WordsWhileAgentWorks({ children }: { children?: React.ReactNode }): React.ReactElement {
  return <ShimmerText>{children}</ShimmerText>;
}

/**
 * Gets the working mark ready once a view that will show it is up. The mark here is drawn
 * inline, so there is nothing to load; views call it where the mark will soon show.
 */
export function usePreloadWorkingMark(_active: boolean): void {}
