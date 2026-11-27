/**
 * The page's own layers beside `#dash-root`, inside its scroller: edit mode
 * (while the pencil is on), the selection pill ("Ask the agent", Edit, "See
 * where this comes from") and, while Sources is open, the source marks with
 * the picked source lit.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { askAboutElement } from '../ask/ask.ts';
import { AskPill } from '../ask/AskPill.tsx';
import { describeActiveFilters, type SelectionContext } from '../ask/prompt.ts';
import { maybeDataEngine } from '../data/engine.ts';
import { askWithEdits, useEditFlow } from '../drafts/edit-flow.ts';
import { useDraftFlow } from '../drafts/flow.ts';
import { useCanAskAgent } from '../drafts/request.ts';
import { EditModeLayer } from '../edit/EditModeLayer.tsx';
import { usePencil } from '../edit/PencilButton.tsx';
import { SOURCE_LIT_ATTRIBUTE, SourceMarksLayer } from '../edit/SourceMarksLayer.tsx';
import { useSourceRules } from '../edit/source-rules.ts';
import { getMarkedSourceIds } from '../page/sources.ts';
import { markOf, usePageRuntime } from '../page/runtime.ts';
import type { ElementSelection, SelectionPoint } from '../page/selection.ts';
import { maybeSession } from '../services/session.ts';
import { useDatasets } from '../state/datasets.ts';
import { useDocument } from '../state/document.ts';
import { useShown, useShownContent } from '../state/shown.ts';
import { useSourcesUi } from '../state/sources-ui.ts';
import { findPickedMark, pickOf, pickSourceOf, rangeData } from './source-pick.ts';
import { sourceStopDescription } from './words.ts';

const sourceTitle = (id: string): string => maybeDataEngine()?.getDataset(id)?.title || id;
const markAt = (target: Element): Element | null => markOf(target)?.element ?? null;
const sourceOf = (target: Element): string | null => {
  const pick = pickOf(target);
  return pick === null ? null : sourceTitle(pick.id);
};
const isKnownSource = (id: string): boolean => maybeDataEngine()?.getDataset(id) !== undefined;
const describeStop = (element: Element): string | null => {
  const id = getMarkedSourceIds(element).find(isKnownSource);
  return id === undefined ? null : sourceStopDescription(sourceTitle(id));
};
const onSource = (target: Element | null): void => {
  if (target === null || !pickSourceOf(target)) useSourcesUi.setState({ pick: null });
};

let fromHere = false;

/** Edit mode came on from the pill's Edit (it starts on the selected words); reading it clears it. */
const adopts = (): boolean => {
  const adopted = fromHere;
  fromHere = false;
  return adopted;
};

/** Lights the picked source's mark while Sources is open; returns a number that changes with each pick. */
function useLitMark(root: HTMLElement | null, on: boolean): number | null {
  const pick = useSourcesUi((state) => state.pick);
  const version = usePageRuntime((state) => state.version);
  const count = useRef(0);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    setPicked(on && pick !== null ? (count.current += 1) : null);
  }, [on, pick]);
  useEffect(() => {
    if (root === null) return;
    const lit = on && pick !== null ? findPickedMark(root, pick) : null;
    for (const element of root.querySelectorAll(`[${SOURCE_LIT_ATTRIBUTE}]`)) if (element !== lit) element.removeAttribute(SOURCE_LIT_ATTRIBUTE);
    if (lit !== null && !lit.hasAttribute(SOURCE_LIT_ATTRIBUTE)) lit.setAttribute(SOURCE_LIT_ATTRIBUTE, '');
  }, [root, on, pick, version]);
  useEffect(
    () => () => {
      if (root !== null) for (const element of root.querySelectorAll(`[${SOURCE_LIT_ATTRIBUTE}]`)) element.removeAttribute(SOURCE_LIT_ATTRIBUTE);
    },
    [root],
  );
  return picked;
}

export interface PageToolsProps {
  /** The changed filters' names, for what a selection says. */
  filters: readonly string[];
  onPoint?: ((point: SelectionPoint | null) => void) | undefined;
}

export function PageTools({ filters, onPoint }: PageToolsProps): ReactElement | null {
  const page = usePageRuntime((state) => state.page);
  const phase = useEditFlow((state) => state.phase);
  const dialog = useEditFlow((state) => state.dialog !== null);
  const commenting = useShown((state) => state.commenting);
  const { mode } = useShownContent();
  const sourcesOpen = useSourcesUi((state) => state.open);
  const pointing = useSourcesUi((state) => state.pointing);
  const asking = useDraftFlow((state) => state.asking !== null);
  const params = useDatasets((state) => state.params);
  const canWrite = useDocument((state) => state.canWrite);
  const pencil = usePencil();
  const editing = phase !== 'off';
  const viewingOther = mode !== 'live';
  const root = page?.root ?? null;
  const showingSources = sourcesOpen && !editing && !commenting;
  const picked = useLitMark(root, showingSources);
  const version = usePageRuntime((state) => state.version);
  useSourceRules(root, { mode: showingSources ? 'data' : editing && !commenting ? 'edit' : null, known: isKnownSource, describe: describeStop, version });

  const context = useMemo<SelectionContext>(() => ({ filters: describeActiveFilters(filters, params), sourceTitle }), [filters, params]);
  const contextRef = useRef(context);
  contextRef.current = context;
  const ask = useCallback((selection: ElementSelection) => askWithEdits(() => askAboutElement(selection, contextRef.current)), []);
  const askFromEdit = useCallback((pick: () => ElementSelection) => askWithEdits(() => askAboutElement(pick(), contextRef.current)), []);
  const canAsk = useCanAskAgent();
  const canPencil = canWrite && (maybeSession()?.canEdit ?? false) && pencil.hasPage;
  const pencilHere =
    canPencil && !editing && !viewingOther && pencil.reason === null
      ? () => {
          pencil.edit();
          fromHere = useEditFlow.getState().phase === 'editing';
        }
      : null;
  const pickedAt = useCallback((): Element | null => root?.querySelector(`[${SOURCE_LIT_ATTRIBUTE}]`) ?? null, [root]);

  if (page === null || root === null) return null;
  return (
    <>
      <EditModeLayer
        page={page}
        editing={editing}
        off={commenting || dialog || phase === 'saving'}
        onAsk={canAsk ? askFromEdit : null}
        adopts={adopts}
        sourceOf={sourceOf}
        onSource={onSource}
      />
      <AskPill
        root={root}
        off={editing || commenting || pointing || dialog || asking || viewingOther}
        picked={showingSources ? picked : null}
        picks={picked ?? 0}
        pickedAt={pickedAt}
        onAsk={ask}
        onEdit={pencilHere}
        dataAt={rangeData}
        {...(onPoint === undefined ? {} : { onPoint })}
      />
      {showingSources ? <SourceMarksLayer root={root} markAt={markAt} sourceOf={sourceOf} /> : null}
    </>
  );
}
