/** The top bar's comments button: how many threads are open, and the list of every thread. */
import { openCount } from '@open-artifact/editor-kit';
import { ChromeButton, Tip } from '@open-artifact/editor-kit/react';
import { MessageSquare } from 'lucide-react';
import { type ReactNode } from 'react';
import { setDocs, useDocs } from '../app/store.ts';
import { useTabNews } from './reads.ts';
import { docComments, useThreads } from './store.ts';

export function CommentsButton(): ReactNode {
  const available = docComments.store(state => state.available);
  const count = useThreads(state => openCount(state.threads));
  const listing = useDocs(state => state.comments === 'all');
  const tab = useDocs(state => state.activeTab);
  // News on the open tab since its list was last open: a dot, until the list is opened on it.
  const news = useTabNews(tab) && !listing;
  if (!available) return null;
  const label = count ? `Comments, ${count} open` : 'Comments';
  return (
    <Tip label={news ? `${label}, new activity` : 'Comments'} side="bottom">
      <ChromeButton
        size="lg"
        pressed={listing}
        aria-label={label}
        aria-pressed={listing}
        aria-description={news ? 'Has unread comments' : undefined}
        data-testid="comments-toggle"
        onClick={() => setDocs({ comments: listing ? 'margin' : 'all' })}
        className="gap-1.5 [&_svg]:size-[18px] [&_svg]:shrink-0"
      >
        <span className="relative inline-flex">
          <MessageSquare />
          {news ? <span aria-hidden="true" data-unread-dot="" className="absolute -top-px -right-px size-2 rounded-full bg-chrome-accent ring-2 ring-chrome" /> : null}
        </span>
        {count ? <span className="text-[13px] tabular-nums">{count}</span> : null}
      </ChromeButton>
    </Tip>
  );
}
