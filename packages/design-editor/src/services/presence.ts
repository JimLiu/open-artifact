/**
 * Live presence on the design: the Design adapter of the shared presence
 * controller (`@open-artifact/editor-kit`, presence.ts). This page publishes one `design` key
 * (merged with the `viewContext` key `services/agent.ts` publishes): its
 * page, selection and the artboard it edits, plus the pointer the shared
 * controller adds. Peers' values are checked and clipped in
 * {@link parseDesignPresence}.
 */

import { useCapability } from '@open-artifact/runtime';
import { PRESENCE_LIST_MAX, createPresence, peerValue, type PeerView } from '@open-artifact/editor-kit';
import { useDocument } from '../state/document.ts';
import { toWorld, useView } from '../state/view.ts';
import { liveCamera } from './engine.ts';
import { projectPath, session } from './session.ts';
import { elementGroupsOf, selectedBoardsOf, selectedNotesOf } from '../lib/selection.ts';

export { AGENT_COLOR, AGENT_SHOWN_MS, PEER_COLORS, peerColor, peerViews } from '@open-artifact/editor-kit';

/** What a page publishes under `design` (besides `cursor`). */
export interface DesignPresence {
  page: string | null;
  /** Selected artboards and notes. */
  boards: string[];
  notes: string[];
  /** Selected elements of one artboard (tids). */
  elements: { board: string; tids: number[] } | null;
  /** The artboard whose text is being edited, or whose elements are selected. */
  editing: string | null;
}

/** A peer as the canvas draws it. */
export type DesignPeer = PeerView<DesignPresence>;

/** Reads a peer's `design` key; anything malformed is dropped. */
export function parseDesignPresence(value: Record<string, unknown>): DesignPresence {
  const e = value.elements as Record<string, unknown> | null | undefined;
  const board = e ? peerValue.str(e.board) : null;
  const tids = e && Array.isArray(e.tids) ? e.tids.filter((t): t is number => Number.isInteger(t) && (t as number) >= 0).slice(0, PRESENCE_LIST_MAX) : [];
  return {
    page: peerValue.str(value.page),
    boards: peerValue.strList(value.boards),
    notes: peerValue.strList(value.notes),
    elements: board && tids.length ? { board, tids } : null,
    editing: peerValue.str(value.editing),
  };
}

/** What this page publishes now. */
function ownPresence(): DesignPresence {
  const view = useView.getState();
  const selection = view.selection;
  // Peers see the elements of one artboard: the one the selection leads with.
  const groups = elementGroupsOf(selection);
  const lead = selection.kind === 'mixed' && selection.primary?.kind === 'element' ? selection.primary.board : groups[0]?.board;
  const group = groups.find((entry) => entry.board === lead);
  const elements = group ? { board: group.board, tids: group.items.map((i) => i.tid).slice(0, PRESENCE_LIST_MAX) } : null;
  return {
    page: view.page,
    boards: selectedBoardsOf(selection).slice(0, PRESENCE_LIST_MAX),
    notes: selectedNotesOf(selection).slice(0, PRESENCE_LIST_MAX),
    elements,
    editing: useDocument.getState().readOnly ? null : (view.textEdit?.board ?? elements?.board ?? null),
  };
}

/** The design's presence. */
export const designPresence = createPresence<DesignPresence>({
  key: 'design',
  snapshot: ownPresence,
  parse: parseDesignPresence,
  watch: (changed) =>
    useView.subscribe((state, previous) => {
      if (state.selection !== previous.selection || state.page !== previous.page || state.textEdit !== previous.textEdit) changed();
    }),
  pointer(event) {
    const surface = (event.target instanceof Element ? event.target.closest('[data-canvas-surface]') : null) as HTMLElement | null;
    if (!surface || useView.getState().mode !== 'canvas') return null;
    const bounds = surface.getBoundingClientRect();
    return toWorld(liveCamera(), event.clientX - bounds.left, event.clientY - bounds.top);
  },
  wrotePath: projectPath,
});

/** The presence store (`agentWrote.paths` are project paths). */
export const usePresence = designPresence.store;

/** Starts presence; returns a function that stops it. */
export async function startCollabPresence(): Promise<() => void> {
  const room = session().room ?? (await useCapability('room'));
  return designPresence.start({ room, artifact: session().artifact });
}
