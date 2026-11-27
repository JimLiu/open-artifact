/**
 * Where other parts of the editor mount: the edit tool switch in the
 * toolbar, and the Listen controls right before the page.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ReadAloudControls } from '../read-aloud/index.ts';
import { useDraftFlow } from '../drafts/flow.ts';
import { useEditFlow } from '../drafts/edit-flow.ts';
import { usePageRuntime, type PageHandle } from '../page/runtime.ts';
import { hasOpenOverlay } from '../edit/marks.tsx';
import { PencilButton, usePencil } from '../edit/PencilButton.tsx';
import { maybeSession } from '../services/session.ts';
import { onShellCommand, useShellDraws } from '../services/shell.ts';
import { useDocument } from '../state/document.ts';
import { setChromeActions, type ChromeAction } from './shell-actions.ts';
import { useShown, useShownContent } from '../state/shown.ts';
import { useSourcesUi } from '../state/sources-ui.ts';
import { usePageSnapshot } from './data-view.ts';

/**
 * The edit tool switch ("Use the page" / Edit) for viewers who can edit a
 * dashboard that has a page (`index.html`). When
 * the Shell draws the page's actions, it offers `edit_page` / `use_page`
 * there instead.
 */
export function EditModeSlot(): ReactElement | null {
  const pencil = usePencil();
  const canWrite = useDocument((state) => state.canWrite);
  const inShell = useShellDraws((state) => state.draws.has('actions'));
  const on = canWrite && (maybeSession()?.canEdit ?? false) && (pencil.hasPage || pencil.editing);
  const action: ChromeAction | null = !on
    ? null
    : pencil.editing
      ? { id: 'use_page', ...(pencil.unsaved ? { disabled: true, why: 'unsaved' as const } : {}) }
      : { id: 'edit_page', ...(pencil.reason !== null || pencil.dialog ? { disabled: true, why: pencil.reason ?? 'other' } : {}) };
  const actionKey = action === null ? '' : JSON.stringify(action);
  const pencilRef = useRef(pencil);
  pencilRef.current = pencil;
  useEffect(() => {
    setChromeActions('edit', inShell && action !== null ? [action] : null);
  }, [inShell, actionKey]);
  useEffect(() => () => setChromeActions('edit', null), []);
  useEffect(
    () =>
      onShellCommand((command) => {
        if (command.cmd !== 'action' || (command.id !== 'edit_page' && command.id !== 'use_page') || hasOpenOverlay()) return;
        if (command.id === 'edit_page') pencilRef.current.edit();
        else pencilRef.current.use();
      }),
    [],
  );
  if (!on || inShell) return null;
  return <PencilButton size="lg" />;
}

/** A number that changes whenever the picked source mark does (`null`: none). */
function usePickedMark(): number | null {
  const pick = useSourcesUi((state) => state.pick);
  const count = useRef(0);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    if (pick === null) setPicked(null);
    else setPicked((count.current += 1));
  }, [pick]);
  return picked;
}

const pageKeys = new WeakMap<PageHandle, number>();
let pageCount = 0;
const keyOf = (page: PageHandle): number => {
  let key = pageKeys.get(page);
  if (key === undefined) pageKeys.set(page, (key = ++pageCount));
  return key;
};

/** The Listen button and player, as the page's previous sibling; re-renders with every page redraw (the snapshot), remounts with a new page. */
export function ReadAloudSlot(): ReactElement | null {
  const page = usePageRuntime((state) => state.page);
  const snapshot = usePageSnapshot();
  const { content } = useShownContent();
  const commenting = useShown((state) => state.commenting);
  const editing = useShown((state) => state.editing);
  const sourcesOpen = useSourcesUi((state) => state.open);
  const pointing = useSourcesUi((state) => state.pointing);
  const dialog = useEditFlow((state) => state.dialog !== null);
  const asking = useDraftFlow((state) => state.asking !== null);
  const picked = usePickedMark();
  if (page === null || snapshot?.files == null) return null;
  return (
    <ReadAloudControls
      key={keyOf(page)}
      root={page.root}
      files={snapshot.files}
      language={content.lang}
      off={commenting || sourcesOpen || dialog || asking}
      editing={editing}
      choosing={pointing}
      picked={picked}
    />
  );
}
