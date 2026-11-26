import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { COMMENT_TARGET } from '@open-artifact/editor-kit/react';
import { partIndexAt } from '../layers/stretch.ts';
import { selectParts, useFilm } from '../stores/film.ts';
import { formatPlaybackTime } from '../transport/time-format.ts';
import { timelineMark, type TimelineMark } from './anchor-place.ts';
import { filmComments, useComments } from './comments.ts';
import { groupMarks, hiddenCount, nextPage, type MarkGroup } from './mark-groups.ts';
import * as words from './words.ts';

/** Moments closer than this many pixels on the track are gathered. */
const CROWD_PX = 10;

/** The track's width in pixels, as it changes; measured from when the marks' box is put on the page. */
function useTrackWidth(): [(node: HTMLSpanElement | null) => void, number] {
  const [node, setNode] = useState<HTMLSpanElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (node === null) return;
    const observer = new ResizeObserver(() => setWidth(node.getBoundingClientRect().width));
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width];
}

/** Each open thread's moment (a dot) or stretch (a bar) on the scrub track; a press shows the thread. */
export function TimelineMarks({ total }: { total: number }): ReactElement | null {
  const available = useComments((s) => s.available);
  const threads = useComments((s) => s.threads);
  const showResolved = useComments((s) => s.showResolved);
  const active = useComments((s) => s.active);
  const clock = useFilm((s) => s.clock);
  const marks = useMemo(
    () =>
      threads
        .filter((thread) => showResolved || thread.status === 'open')
        .map((thread) => timelineMark(thread.id, filmComments.anchorOf(thread), clock, total))
        .filter((mark): mark is TimelineMark => mark !== null),
    [threads, showResolved, clock, total],
  );
  const parts = useFilm(selectParts);
  const [ref, width] = useTrackWidth();
  const [pages, setPages] = useState<ReadonlyMap<string, number>>(new Map());
  const ordered = useMemo(() => [...marks].sort((a, b) => a.from - b.from), [marks]);
  const groups = useMemo(
    () => groupMarks(ordered.map((mark) => ({ id: mark.id, x: mark.from * width, range: mark.to !== null })), CROWD_PX, pages),
    [ordered, width, pages],
  );
  if (!available || marks.length === 0) return null;
  const show = (id: string): void => {
    const thread = useComments.getState().threads.find((t) => t.id === id);
    if (thread !== undefined) filmComments.show(thread);
  };
  const turn = (group: MarkGroup, page: number): void => setPages((known) => new Map(known).set(group.key, page));
  const label = (mark: TimelineMark): string => {
    const number = ordered.indexOf(mark) + 1;
    const resolved = threads.find((t) => t.id === mark.id)?.status === 'resolved';
    const at = mark.from * total;
    if (mark.to !== null) return words.commentOnStretch(number, formatPlaybackTime(at), formatPlaybackTime(mark.to * total), resolved);
    const part = partIndexAt(parts, at);
    return words.commentNumberAt(number, formatPlaybackTime(at), part >= 0 ? (parts[part]?.label ?? '') : '', resolved);
  };
  return (
    <span ref={ref} className="pointer-events-none absolute inset-0" data-video-comment-marks="">
      {groups.map((group) => {
        const hidden = hiddenCount(group);
        const last = ordered.find((mark) => mark.id === group.shown[group.shown.length - 1]);
        const near = formatPlaybackTime((ordered.find((mark) => mark.id === group.key)?.from ?? 0) * total);
        return (
          <span key={group.key} className="contents">
            {group.shown.map((id) => {
              const mark = ordered.find((each) => each.id === id);
              if (mark === undefined) return null;
              return (
                <button
                  key={mark.id}
                  type="button"
                  aria-label={label(mark)}
                  data-active={mark.id === active ? '' : undefined}
                  className="pointer-events-auto absolute -top-1 h-1.5 min-w-1.5 rounded-full opacity-80 hover:opacity-100 data-[active]:opacity-100"
                  style={{ backgroundColor: COMMENT_TARGET, left: `${mark.from * 100}%`, width: mark.to === null ? undefined : `${Math.max(0, mark.to - mark.from) * 100}%` }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => show(mark.id)}
                />
              );
            })}
            {hidden > 0 && last !== undefined ? (
              <button
                type="button"
                aria-label={group.page === group.pages - 1 ? words.firstCommentsNear(near) : words.moreCommentsNear(hidden, near)}
                className="pointer-events-auto absolute -top-2.5 ml-2 h-4 rounded-full px-1 text-[10px] leading-4 font-medium text-white tabular-nums"
                style={{ backgroundColor: COMMENT_TARGET, left: `${last.from * 100}%` }}
                data-video-comment-more=""
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => turn(group, nextPage(group))}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && group.page !== 0) {
                    event.stopPropagation();
                    turn(group, 0);
                  }
                }}
              >
                {words.plusCount(hidden)}
              </button>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}
