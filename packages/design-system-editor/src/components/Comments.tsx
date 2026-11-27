






import { MessageCircle } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CommentThread } from '@open-artifact/runtime';
import { AllComments, CommentComposer, CommentPopover, CommentsLayer, ThreadCard, type AgentBadge } from '@open-artifact/editor-kit/react';
import { cn } from '@open-artifact/ui';
import type { Focus } from '../state/view.ts';
import { useAgent } from '../services/agent.ts';
import { anchorLabel, parseAnchor, serializeAnchor, threadsByAnchor, type SystemAnchor } from '../lib/comment-anchors.ts';
import { canComment, closeComments, openComments, systemComments, useCommentScope, useComments } from '../services/comments.ts';
import { maybeSession } from '../services/session.ts';

/** Open threads per anchor, memoized on the thread list. */
function useOpenByAnchor(): Map<string, CommentThread[]> {
  const threads = useComments((s) => s.threads);
  return useMemo(() => threadsByAnchor(threads), [threads]);
}

/**
 * The badge of one item: its open thread count (opens them), or a
 * "Comment" button shown on hover of the row (`group` class) for those who
 * may comment.
 */
export function CommentBadge({ focus, className }: { focus: Focus; className?: string }) {
  const available = useComments((s) => s.available);
  const on = useComments((s) => s.on);
  const key = serializeAnchor(focus);
  // A comment begun here and set aside: the badge shows it, and pressing it takes it up again.
  const parked = useComments((s) => s.parked !== null && serializeAnchor(s.parked.anchor.anchor) === key);
  const byAnchor = useOpenByAnchor();
  if (!available) return null;
  const threads = byAnchor.get(key);
  const count = threads?.length ?? 0;
  const canStart = canComment() && (on || !maybeSession()?.shell);
  if (!count && !canStart && !parked) return null;
  return (
    <button
      type="button"
      data-comment-badge={key}
      data-comment-parked={parked ? '' : undefined}
      aria-label={parked ? 'Your draft comment' : count ? `${count} comments on ${anchorLabel(focus)}` : `Comment on ${anchorLabel(focus)}`}
      title={parked ? 'Your draft comment' : count ? `${count} open ${count === 1 ? 'comment' : 'comments'}` : 'Comment'}
      onClick={(event) => {
        event.stopPropagation();
        if (canStart || parked) openComments(focus);
        else if (threads?.[0]) systemComments.reveal(threads[0]);
      }}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[11px] font-semibold tabular-nums transition-opacity',
        parked ? 'bg-accent text-white' : count ? 'bg-warning text-white' : 'text-fg-subtle opacity-0 hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover:opacity-100',
        className,
      )}
    >
      {count ? (
        <>
          <MessageCircle className="size-3" />
          {count}
        </>
      ) : (
        <MessageCircle className="size-3.5" />
      )}
    </button>
  );
}

/** The agent as the comment cards show it. */
function useAgentBadge(): AgentBadge {
  const available = useAgent((s) => s.status.available);
  const name = useAgent((s) => s.status.name);
  const wakesIdle = useAgent((s) => s.status.wakesIdle);
  return useMemo(() => ({ available, name, wakesIdle }), [available, name, wakesIdle]);
}

/** Under the top bar (48px) with the panel's 12px gap. */
const TOP = 60;

/** Re-renders on scroll and resize (once a frame), so a card follows its badge. */
function useViewport(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight, tick: 0 }));
  useEffect(() => {
    let frame = 0;
    const update = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setSize((last) => ({ width: window.innerWidth, height: window.innerHeight, tick: last.tick + 1 }));
      });
    };
    window.addEventListener('scroll', update, { passive: true, capture: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, { capture: true });
      window.removeEventListener('resize', update);
      cancelAnimationFrame(frame);
    };
  }, []);
  return size;
}

/** Where an item's card goes: beside its badge, or (the whole system, a badge out of sight) under the bar at the right. */
function cornerOf(scope: SystemAnchor, viewport: { width: number; height: number }): { x: number; y: number } {
  const key = serializeAnchor(scope);
  const badge = scope ? document.querySelector(`[data-comment-badge="${CSS.escape(key)}"]`) : null;
  const rect = badge?.getBoundingClientRect();
  if (rect && rect.bottom > TOP && rect.top < viewport.height) return { x: rect.right + 6, y: Math.max(TOP, rect.top - 2) };
  return { x: viewport.width - 342, y: TOP };
}

/** The open item's threads and a composer for a new one, beside its badge. */
function ItemCards({ scope, agent }: { scope: SystemAnchor; agent: AgentBadge }): ReactNode {
  const threads = useComments((s) => s.threads);
  const draft = useComments((s) => s.draft);
  const showResolved = useComments((s) => s.showResolved);
  const active = useComments((s) => s.active);
  const viewport = useViewport();
  const key = serializeAnchor(scope);
  const shown = threads.filter((t) => serializeAnchor(parseAnchor(t.anchor)) === key && (showResolved || t.status === 'open' || t.id === active));
  const composing = draft !== null && serializeAnchor(draft.anchor) === key;
  if (!composing && shown.length === 0) return null;
  return (
    <CommentPopover corner={cornerOf(scope, viewport)} viewport={viewport} onEscape={closeComments}>
      {(maxHeight) => (
        <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight }}>
          {shown.map((thread: CommentThread) => (
            <ThreadCard key={thread.id} comments={systemComments} agent={agent} thread={thread} onClose={closeComments} />
          ))}
          {composing ? <CommentComposer comments={systemComments} agent={agent} anchor={draft} onCancel={closeComments} /> : null}
        </div>
      )}
    </CommentPopover>
  );
}

/** The comments over the page: an item's cards beside its badge, and the "All comments" panel. */
export function CommentsOverlay(): ReactNode {
  const available = useComments((s) => s.available);
  const scope = useCommentScope((s) => s.scope);
  const agent = useAgentBadge();
  if (!available) return null;
  return (
    <>
      {scope !== undefined ? (
        <CommentsLayer className="pointer-events-none fixed inset-0 z-40" onEscape={() => (closeComments(), true)}>
          <ItemCards scope={scope} agent={agent} />
        </CommentsLayer>
      ) : null}
      <AllComments comments={systemComments} agent={agent} top={TOP} hint="Turn on Comments, then select a token, text style, component, asset or section." />
    </>
  );
}

/** Opens the composer on the whole system. */
export function commentOnSystem(): void {
  openComments(null);
}
