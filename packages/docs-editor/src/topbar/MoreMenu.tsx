/**
 * The top bar’s More menu: the open tab’s word count (while it can be edited), rename, the comments list and margin,
 * version history, locking the doc (owners) and the keyboard shortcuts.
 */
import { announce } from '@open-artifact/editor-kit';
import { ChromeButton, ChromeMenu, ChromeMenuItem, ChromeMenuSeparator, ALT, MOD } from '@open-artifact/editor-kit/react';
import { History, Keyboard, Lock, LockOpen, MessageSquareOff, MessagesSquare, MoreHorizontal, Pencil } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { maybeSession } from '../app/session.ts';
import { setDocs, useDocs } from '../app/store.ts';
import { useEditor } from '../editor/format.ts';
import { chipWordsOnPage } from '../find/controller.ts';
import { mayLock, setLocked } from '../saving/lock.ts';
import { LOCK_MENU_WORDS } from '../saving/words.ts';
import { toggleShortcuts } from './ShortcutsDialog.tsx';
import { setTopBar } from './store.ts';
import { countEditor, countLines } from './word-count.ts';

const ICON = 'size-4 text-chrome-muted';

/** The open tab’s words and characters (or the selection’s), counted as the menu opens; nothing while it can’t be edited. */
function WordCount(): ReactNode {
  const [lines] = useState(() => {
    const { view } = useEditor.getState();
    return view?.editable ? countLines(countEditor(view.state, chipWordsOnPage)) : null;
  });
  useEffect(() => {
    if (lines) announce(`${lines[0]}, ${lines[1]}`);
  }, [lines]);
  if (!lines) return null;
  return (
    <>
      <div className="flex flex-col gap-0.5 px-2.5 py-1 text-[13px] text-chrome-muted tabular-nums" data-doc-word-count="">
        <div>{lines[0]}</div>
        <div>{lines[1]}</div>
      </div>
      <ChromeMenuSeparator />
    </>
  );
}

export function MoreMenu(): ReactNode {
  const ready = useDocs(state => state.phase.kind === 'ready');
  const writable = useDocs(state => state.writable);
  const comments = useDocs(state => state.comments);
  const history = useDocs(state => state.history);
  const locked = useDocs(state => !!state.project?.locked);
  if (!ready) return null;
  const hasComments = !!maybeSession()?.comments;
  return (
    <ChromeMenu
      align="end"
      tip={{ label: 'More' }}
      trigger={
        <ChromeButton square aria-label="More">
          <MoreHorizontal className="size-4" strokeWidth={1.5} />
        </ChromeButton>
      }
    >
      <WordCount />
      {writable ? (
        <ChromeMenuItem icon={<Pencil className={ICON} strokeWidth={1.5} />} onSelect={() => setTopBar({ renaming: true })}>
          Rename
        </ChromeMenuItem>
      ) : null}
      {hasComments ? (
        <ChromeMenuItem
          icon={<MessagesSquare className={ICON} strokeWidth={1.5} />}
          checked={comments === 'all'}
          onSelect={() => setDocs({ comments: comments === 'all' ? 'margin' : 'all' })}
        >
          Show all comments
        </ChromeMenuItem>
      ) : null}
      {hasComments ? (
        <ChromeMenuItem
          icon={<MessageSquareOff className={ICON} strokeWidth={1.5} />}
          shortcut={`${ALT}⇧C`}
          onSelect={() => setDocs({ comments: comments === 'hidden' ? 'margin' : 'hidden' })}
        >
          {comments === 'hidden' ? 'Show comments' : 'Hide comments'}
        </ChromeMenuItem>
      ) : null}
      <ChromeMenuItem icon={<History className={ICON} strokeWidth={1.5} />} checked={history} onSelect={() => setDocs({ history: !history })}>
        Version history
      </ChromeMenuItem>
      {mayLock() ? (
        <ChromeMenuItem
          icon={locked ? <LockOpen className={ICON} strokeWidth={1.5} /> : <Lock className={ICON} strokeWidth={1.5} />}
          onSelect={() => void setLocked(!locked)}
        >
          {locked ? LOCK_MENU_WORDS.unlock : LOCK_MENU_WORDS.lock}
        </ChromeMenuItem>
      ) : null}
      <ChromeMenuSeparator />
      <ChromeMenuItem icon={<Keyboard className={ICON} strokeWidth={1.5} />} shortcut={`${MOD}/`} onSelect={() => toggleShortcuts()}>
        Keyboard shortcuts
      </ChromeMenuItem>
    </ChromeMenu>
  );
}
