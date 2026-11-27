/**
 * Comment pins over the page, the open card or composer, and the list of
 * every comment. Pins sit at their target's top-right corner and move with
 * scrolling, resizing and the page's own changes.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { AllComments, CommentPins, CommentPopover, CommentsLayer, ThreadCard, type AgentBadge } from '@open-artifact/editor-kit/react';
import type { PinPlace } from '@open-artifact/editor-kit';
import { useAgentActivity } from '../platform/agent-activity.ts';
import { pageComments, useComments, type PageAnchor } from './comments.ts';
import { findTarget, pinPoint, ROOT_ID } from './comment-targets.ts';
import { COMMENTS_HINT } from './words.ts';

const CAMERA = { x: 0, y: 0, zoom: 1 };
const LIST_TOP = 56;

function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const resize = (): void => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return size;
}

/** A number that changes whenever the page may have moved under the pins. */
function useLayoutRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let frame = 0;
    const bump = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setRevision((n) => n + 1));
    };
    const observer = new MutationObserver(bump);
    const watch = (): void => {
      const root = document.getElementById(ROOT_ID);
      if (root !== null) observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    };
    watch();
    const outer = new MutationObserver(() => {
      observer.disconnect();
      watch();
      bump();
    });
    outer.observe(document.body, { childList: true });
    window.addEventListener('scroll', bump, { capture: true, passive: true });
    window.addEventListener('resize', bump);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      outer.disconnect();
      window.removeEventListener('scroll', bump, { capture: true });
      window.removeEventListener('resize', bump);
    };
  }, []);
  return revision;
}

export function useAgentBadge(): AgentBadge {
  const available = useAgentActivity((s) => s.available);
  const name = useAgentActivity((s) => s.name);
  const wakesIdle = useAgentActivity((s) => s.wakesIdle);
  return useMemo(() => ({ available, name, wakesIdle }), [available, name, wakesIdle]);
}

export function CommentLayer(): ReactElement | null {
  const available = useComments((s) => s.available);
  const active = useComments((s) => s.active);
  const listOpen = useComments((s) => s.listOpen);
  const threads = useComments((s) => s.threads);
  const viewport = useWindowSize();
  const revision = useLayoutRevision();
  const agent = useAgentBadge();
  const place = useCallback(
    (anchor: PageAnchor): PinPlace | null => {
      const el = findTarget(document, anchor.selector);
      const at = el === null ? null : pinPoint(el, window);
      return at === null ? null : { world: at, state: 'ok' };
    },
    // `revision` changes whenever the page moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision],
  );
  if (!available) return null;
  const found = active === null ? undefined : threads.find((t) => t.id === active);
  // One on the whole dashboard opens by the list (`AllComments`).
  const unplaced = found !== undefined && !pageComments.isWhole(found) && place(pageComments.anchorOf(found)) === null && !listOpen ? found : undefined;
  const close = (): void => {
    const state = useComments.getState();
    state.setDraft(null);
    state.setActive(null);
  };
  return (
    <div className="dash-comment-layer" data-uncommentable="">
      <CommentPins comments={pageComments} camera={CAMERA} viewport={viewport} place={place} agent={agent} revision={revision} movable={false} insets={{ top: LIST_TOP }} />
      {unplaced === undefined ? null : (
        <CommentsLayer mark="data-comment-layer" onEscape={() => (close(), true)}>
          <CommentPopover key={unplaced.id} corner={{ x: viewport.width / 2 - 165, y: 80 }} viewport={viewport} onEscape={close}>
            {(maxHeight) => <ThreadCard comments={pageComments} agent={agent} thread={unplaced} maxHeight={maxHeight} />}
          </CommentPopover>
        </CommentsLayer>
      )}
      <AllComments comments={pageComments} agent={agent} top={LIST_TOP} hint={COMMENTS_HINT} />
    </div>
  );
}
