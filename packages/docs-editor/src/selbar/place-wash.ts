/** Opening a link to words in a block washes the words, and outlines their block, for a moment. */
import type { DocState } from '@open-artifact/docs-core';
import { type EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { rangeOfIds } from '../comments/anchor-map.ts';
import type { DocPlace } from './fragments.ts';

const WASH_MS = 1400;
const washKey = new PluginKey<DecorationSet>('placeWash');

/** Draws the washed words and their block while a link to them has just been opened. */
export function washPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: washKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const next = tr.getMeta(washKey) as DecorationSet | undefined;
        return next ?? set.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations: state => washKey.getState(state),
    },
  });
}

/** The decorations for washed words between two positions, and an outline on the block holding the first. */
export function washDecorations(state: EditorState, from: number, to: number): DecorationSet {
  const decos = [Decoration.inline(from, to, { class: 'doc-place-wash' })];
  const $from = state.doc.resolve(from);
  if ($from.depth > 0) decos.push(Decoration.node($from.before($from.depth), $from.after($from.depth), { class: 'doc-place-block' }));
  return DecorationSet.create(state.doc, decos);
}

let washTimer: ReturnType<typeof setTimeout> | null = null;

/** Washes the words a link names, if they are still there; the wash fades on its own. */
export function washPlace(view: EditorView, shadow: DocState | null, place: DocPlace): void {
  if (!place.words) return;
  const range = shadow ? rangeOfIds(view.state.doc, shadow, place.words) : null;
  if (!range || !washKey.getState(view.state)) return;
  if (washTimer) clearTimeout(washTimer);
  view.dispatch(view.state.tr.setMeta(washKey, washDecorations(view.state, range.from, range.to)).setMeta('addToHistory', false));
  washTimer = setTimeout(() => {
    washTimer = null;
    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(washKey, DecorationSet.empty).setMeta('addToHistory', false));
  }, WASH_MS);
}
