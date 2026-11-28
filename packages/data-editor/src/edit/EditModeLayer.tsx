/**
 * Edit mode over the mounted page: a draft of the page's stored markup
 * (made again when the page mounts again), registered with the edit flow as
 * its page edit session, and the edit mode's marks, toolbar and keys over it.
 * Mount it beside `#dash-root`, inside the page's scroller (the washes
 * scroll with the page).
 */

import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { registerPageEditSession, type PageEditSession } from '../drafts/edit-flow.ts';
import { createPageTemplate } from '../page/parse.ts';
import type { PageHandle } from '../page/runtime.ts';
import type { ElementSelection } from '../page/selection.ts';
import { createMountedPageDraft, type PageDraft } from './draft.ts';
import { PageEditMode } from './EditMode.tsx';
import type { SourceNameOf } from './SourceMarksLayer.tsx';

export interface EditModeLayerProps {
  page: PageHandle | null;
  /** Edit mode is on (the edit flow's phase is not `off`). */
  editing: boolean;
  /** Hide the chrome: comments are on, an edit dialog is open, or the page is saving. */
  off: boolean;
  onAsk: ((pick: () => ElementSelection) => void) | null;
  adopts?: () => boolean;
  sourceOf?: SourceNameOf;
  onSource?: (target: Element | null) => void;
}

const NO_SUBSCRIPTION = (): (() => void) => () => undefined;

/** A page edit session that follows whichever draft is current (the page may mount again mid-edit). */
function createDraftSession(current: () => PageDraft | null): PageEditSession & { changed(): void } {
  const listeners = new Set<() => void>();
  return {
    text() {
      const draft = current();
      if (draft === null) return '';
      draft.settle(true);
      return draft.text();
    },
    typing: () => current()?.visit() != null,
    count: () => current()?.count() ?? 0,
    revert() {
      current()?.revert();
    },
    readsBack: (html) => current()?.reads(createPageTemplate(html).content) ?? true,
    canUndo: () => current()?.canUndo() ?? false,
    canRedo: () => current()?.canRedo() ?? false,
    undo: () => current()?.undo() ?? null,
    redo: () => current()?.redo() ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    changed() {
      for (const listener of [...listeners]) listener();
    },
  };
}

export function EditModeLayer({ page, editing, off, onAsk, adopts, sourceOf, onSource }: EditModeLayerProps): ReactNode {
  const mount = useSyncExternalStore(page === null ? NO_SUBSCRIPTION : page.subscribe, () => page?.snapshot().n ?? 0);
  const draft = useMemo(() => (page === null || !editing ? null : createMountedPageDraft(page)), [page, editing, mount]);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const session = useMemo(() => (editing ? createDraftSession(() => draftRef.current) : null), [editing]);

  useEffect(() => {
    if (session === null) return;
    registerPageEditSession(session);
    return () => registerPageEditSession(null);
  }, [session]);

  useEffect(() => {
    if (session === null) return;
    session.changed();
    return draft?.subscribe(() => session.changed());
  }, [session, draft]);

  if (page === null || draft === null) return null;
  return <PageEditMode key={mount} root={page.root} draft={draft} off={off} onAsk={onAsk} adopts={adopts} sourceOf={sourceOf} onSource={onSource} />;
}
