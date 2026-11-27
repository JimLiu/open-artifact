/**
 * Every thread of the doc in one list beside the page, by tab, filtered to the open, those involving the viewer, the
 * resolved or all of them.
 */
import { announce } from '@open-artifact/editor-kit';
import { PanelEdge, usePanelWidth } from '@open-artifact/editor-kit/react';
import type { CommentThread } from '@open-artifact/runtime';
import { Segmented } from '@open-artifact/ui';
import { X } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { PHONE_QUERY, useMedia } from '../app/media.ts';
import { setDocs, useDocs } from '../app/store.ts';
import { revealThread } from './actions.ts';
import { NewThreadCard } from './NewThreadCard.tsx';
import { lookedAt, useNewestOnTab } from './reads.ts';
import { type CommentFilter, docComments, myName, setCommentUi, useCommentUi, useThreads } from './store.ts';
import { ReactionChip, ThreadCard } from './ThreadCard.tsx';
import { byRecent, EMPTY_FILTER, filterSaid, inFilter, isReactionThread } from './threads.ts';

// Four filters share the narrowest list: their names may be cut short there rather than spill out of it.
const FILTERS: Array<{ value: CommentFilter; label: ReactNode }> = [
  { value: 'open', label: 'Open' },
  { value: 'mine', label: 'Involving you' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
].map(({ value, label }) => ({ value: value as CommentFilter, label: <span className="truncate">{label}</span> }));

interface TabGroup {
  tab: string | null;
  name: string | null;
  threads: CommentThread[];
}

function groupByTab(threads: readonly CommentThread[], files: ReadonlyArray<{ id: string; name: string }>): TabGroup[] {
  const groups = new Map<string | null, CommentThread[]>();
  for (const thread of threads) {
    const tab = docComments.anchorOf(thread).tab;
    const known = tab !== null && files.some(file => file.id === tab) ? tab : null;
    groups.set(known, [...(groups.get(known) ?? []), thread]);
  }
  const ordered: TabGroup[] = [];
  const doc = groups.get(null);
  if (doc) ordered.push({ tab: null, name: null, threads: doc.sort(byRecent) });
  for (const file of files) {
    const items = groups.get(file.id);
    if (items) ordered.push({ tab: file.id, name: file.name, threads: items.sort(byRecent) });
  }
  return ordered;
}

const LIST_WIDTH = 320;
const LIST_MIN = 240;
const LIST_MAX = 600;

export function CommentList(): ReactNode {
  const threads = useThreads(state => state.threads);
  const active = useThreads(state => state.active);
  const chosen = useCommentUi(state => state.filter);
  // "Involving you" needs to know who is looking; until then the list falls back to the open threads.
  const me = myName();
  const filter: CommentFilter = chosen === 'mine' && !me ? 'open' : chosen;
  const filters = useMemo(() => (me ? FILTERS : FILTERS.filter(each => each.value !== 'mine')), [me]);
  const holds = useCommentUi(state => state.placed);
  const files = useDocs(state => state.project?.files);
  const activeTab = useDocs(state => state.activeTab);
  const writing = useCommentUi(state => !!state.composer && state.composer.anchor.tab === activeTab);
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (writing && list.current) list.current.scrollTop = 0;
  }, [writing]);
  // The list open on a shown page: the tab's news has been looked at, as it comes.
  const newest = useNewestOnTab(activeTab);
  useEffect(() => {
    const look = () => {
      if (document.visibilityState === 'visible') lookedAt(activeTab ?? '');
    };
    look();
    document.addEventListener('visibilitychange', look);
    return () => document.removeEventListener('visibilitychange', look);
  }, [activeTab, newest]);

  const groups = useMemo(() => {
    const shown = threads.filter(thread => inFilter(thread, filter, me));
    return groupByTab(shown, files ?? []);
  }, [threads, filter, me, files]);
  const several = groups.length > 1;
  const panel = usePanelWidth('docs.comments.width', LIST_WIDTH, LIST_MIN, LIST_MAX);
  const phone = useMedia(PHONE_QUERY, false);

  return (
    <aside
      className="relative flex max-w-[max(20rem,calc(100vw-24rem))] flex-none flex-col border-l border-chrome-line bg-chrome text-chrome-fg"
      style={phone ? { width: '100%', maxWidth: 'none' } : { width: panel.width }}
      aria-label="Comments"
    >
      <div className="flex h-11 flex-none items-center gap-2 border-b border-chrome-line pr-2 pl-4">
        <div className="min-w-0 flex-1 truncate text-[13px] font-semibold">Comments</div>
        <button
          type="button"
          aria-label="Close comments"
          onClick={() => setDocs({ comments: 'margin' })}
          className="grid size-7 place-items-center rounded-md text-chrome-muted hover:bg-chrome-hover"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-none px-3 py-2">
        <Segmented<CommentFilter>
          aria-label="Filter comments"
          value={filter}
          options={filters}
          onChange={value => {
            setCommentUi({ filter: value });
            announce(filterSaid(value, threads.filter(thread => inFilter(thread, value, me)).length));
          }}
          className="w-full text-[12px] [&>*]:min-w-0 [&>*]:flex-auto [&>*]:px-1"
        />
      </div>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {writing && <NewThreadCard />}
        {groups.length === 0 && !writing ? (
          <div className="py-10 text-center text-[13px] text-chrome-muted">{EMPTY_FILTER[filter]}</div>
        ) : (
          groups.map(group => (
            <section key={group.tab ?? ''} className="mt-2 flex flex-col gap-2" aria-label={group.name ?? 'Doc'}>
              {several && group.name ? <h3 className="px-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-chrome-muted">{group.name}</h3> : null}
              {group.threads.map(thread => {
                const open = thread.id === active;
                const onOpen = () => void revealThread(thread);
                const hold = holds.tab !== null && holds.tab === group.tab ? holds.holds[thread.id] : undefined;
                return isReactionThread(thread) ? (
                  <ReactionChip key={thread.id} thread={thread} open={open} onOpen={onOpen} />
                ) : (
                  <ThreadCard key={thread.id} thread={thread} hold={hold} open={open} inList tabName={!several && group.tab !== activeTab ? group.name : null} onOpen={onOpen} />
                );
              })}
            </section>
          ))
        )}
      </div>
      <PanelEdge label="Resize comments" side="left" width={panel.width} min={LIST_MIN} max={LIST_MAX} onResize={panel.resize} onReset={panel.reset} />
    </aside>
  );
}
