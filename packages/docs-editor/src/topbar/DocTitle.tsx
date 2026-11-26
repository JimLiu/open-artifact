/**
 * The doc's name in the top bar. Someone who may edit clicks it to rename the doc in place: Enter or leaving the field
 * saves, Escape gives up. Someone who may not edit sees a badge saying what they can do instead.
 */
import { Tip } from '@open-artifact/editor-kit/react';
import { isComposingKey, toast } from '@open-artifact/ui';
import { Lock, MessageSquare } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { CallDenied, docClient } from '../app/doc-client.ts';
import { getDocs, setDocs, useDocs } from '../app/store.ts';
import { setTopBar, useTopBar } from './store.ts';
import { cleanDocName } from './words.ts';

const UNTITLED = 'Untitled doc';

/** Saves `name` as the doc's name, showing it at once; on a refusal the old name comes back and a toast says so. */
export async function renameDoc(name: string): Promise<boolean> {
  const { project, writable } = getDocs();
  const clean = cleanDocName(name);
  if (!project || !writable || !clean || clean === project.name) return false;
  const before = project.name;
  setDocs({ project: { ...project, name: clean } });
  try {
    await docClient().call({ member: { verb: 'update', object: 'project', payload: { kind: 'patch', patch: [{ op: 'set', path: ['name'], value: clean }] } } });
    return true;
  } catch (error) {
    const now = getDocs().project;
    if (now && now.name === clean) setDocs({ project: { ...now, name: before } });
    toast.add({ title: 'Rename failed', description: error instanceof CallDenied ? undefined : 'Try again in a moment.' });
    return false;
  }
}

function NameField({ name }: { name: string }): ReactNode {
  const [draft, setDraft] = useState(name);
  const field = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  const mounted = useRef(0);

  useLayoutEffect(() => {
    mounted.current = performance.now();
    field.current?.focus();
    field.current?.select();
  }, []);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setTopBar({ renaming: false });
    if (save) void renameDoc(draft);
  };

  return (
    <input
      ref={field}
      aria-label="Document name"
      value={draft}
      maxLength={256}
      spellCheck={false}
      className="h-7 w-48 min-w-0 rounded-[8px] bg-chrome-field px-2 text-sm font-medium text-chrome-fg outline-none ring-2 ring-chrome-ring"
      onChange={event => setDraft(event.target.value)}
      onBlur={() => {
        // Opened from a menu, which hands the keyboard back to its button as it closes: take it again.
        if (performance.now() - mounted.current < 400) {
          requestAnimationFrame(() => {
            field.current?.focus();
            field.current?.select();
          });
          return;
        }
        finish(true);
      }}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          if (isComposingKey(event.nativeEvent)) return;
          finish(true);
        } else if (event.key === 'Escape') {
          if (isComposingKey(event.nativeEvent)) return;
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
    />
  );
}

const READER_TIP = 'You can read this document but not edit it; ask someone who can edit it to give you access.';
const COMMENTER_TIP = 'You can read and leave comments. Ask someone who can edit this document to give you edit access.';

/** "View only" or "Can comment", for someone who may not edit. */
export function AccessBadge(): ReactNode {
  const phase = useDocs(state => state.phase.kind);
  const writable = useDocs(state => state.writable);
  const commentable = useDocs(state => state.commentable);
  if (phase !== 'ready' || writable) return null;
  const Icon = commentable ? MessageSquare : Lock;
  return (
    <Tip label={commentable ? COMMENTER_TIP : READER_TIP}>
      <span tabIndex={0} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-chrome-hover px-2 text-[12px] text-chrome-muted outline-none focus-visible:ring-2 focus-visible:ring-chrome-ring">
        <Icon className="size-3.5" strokeWidth={1.5} aria-hidden />
        {commentable ? 'Can comment' : 'View only'}
      </span>
    </Tip>
  );
}

/** The name, a field while it is renamed, and the access badge. */
export function DocTitle(): ReactNode {
  const name = useDocs(state => state.project?.name ?? '');
  const writable = useDocs(state => state.writable);
  const renaming = useTopBar(state => state.renaming);
  const shown = name || UNTITLED;
  return (
    <div className="flex min-w-0 items-center gap-2">
      {renaming && writable ? (
        <NameField name={name} />
      ) : writable ? (
        <button
          type="button"
          title="Rename"
          className="min-w-0 truncate rounded-[6px] px-1 py-0.5 text-sm font-medium hover:bg-chrome-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chrome-ring"
          onClick={() => setTopBar({ renaming: true })}
        >
          {shown}
        </button>
      ) : (
        <div className="min-w-0 truncate text-sm font-medium">{shown}</div>
      )}
      <AccessBadge />
    </div>
  );
}
