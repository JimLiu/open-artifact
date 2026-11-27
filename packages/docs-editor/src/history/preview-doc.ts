/**
 * A version as the preview draws it: a ProseMirror doc in the page's schema, and the highlighting of what changed as
 * decorations of its own (so the preview carries no suggestion marks or attrs for other parts of the page to find).
 * Every highlighted part carries its change's id (`data-change-id`), so the change strip can step to it.
 */
import type { DocState } from '@open-artifact/docs-core';
import { Fragment, type Mark, type Node as PMNode } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { pmDocOf } from '../editor/binding.ts';
import { schema } from '../editor/schema.ts';
import type { ChangeLook, ChangePart, Comparison } from './compare.ts';

export interface ChangeRange {
  from: number;
  to: number;
  /** The change it is part of. */
  change: string;
  look: ChangeLook;
  summary: string;
  /** A whole block (else words or an inline item). */
  block: boolean;
  /** Its words are drawn on it (a whole block: over it). */
  noted?: true;
}

export interface PreviewDoc {
  doc: PMNode;
  changes: ChangeRange[];
}

const partsOf = (state: DocState): Record<string, ChangePart> => (state as Partial<Comparison>).parts ?? {};

/** The doc to draw, with the ranges of what changed (from {@link compareVersions}' marks). */
export function previewDocOf(state: DocState | Comparison): PreviewDoc {
  const parts = partsOf(state);
  const marked = pmDocOf(state);
  if (!Object.keys(parts).length) return { doc: marked, changes: [] };
  const partOf = (id: unknown) => (typeof id === 'string' && Object.hasOwn(parts, id) ? parts[id]! : null);
  const isChangeMark = (mark: Mark) => (mark.type === schema.marks.suggestIns || mark.type === schema.marks.suggestDel) && partOf(mark.attrs.suggestId) !== null;
  const changes: ChangeRange[] = [];
  /** A block's words are drawn once, over it, not again over each block inside it (which carry its part too). */
  const noted = new Set<string>();
  let lastKey: string | null = null;
  marked.descendants((node, pos) => {
    const part = node.isInline ? null : partOf(node.attrs.suggestId);
    if (part) {
      const note = part.noted && !noted.has(node.attrs.suggestId as string);
      if (note) noted.add(node.attrs.suggestId as string);
      changes.push({ from: pos, to: pos + node.nodeSize, change: part.change, look: part.look, summary: part.summary, block: true, ...(note ? { noted: true as const } : {}) });
      lastKey = null;
      return true;
    }
    if (node.isInline) {
      const mark = node.marks.find(isChangeMark);
      const key = mark ? (mark.attrs.suggestId as string) : null;
      const last = changes[changes.length - 1];
      if (key && last && !last.block && lastKey === key && last.to === pos) last.to = pos + node.nodeSize;
      else if (key) {
        const inline = partOf(key)!;
        changes.push({ from: pos, to: pos + node.nodeSize, change: inline.change, look: inline.look, summary: inline.summary, block: false });
      }
      lastKey = key;
    }
    return true;
  });
  return { doc: withoutChanges(marked, isChangeMark, id => partOf(id) !== null), changes };
}

function withoutChanges(node: PMNode, isChangeMark: (mark: Mark) => boolean, isChangeId: (id: unknown) => boolean): PMNode {
  if (node.isText) return node.mark(node.marks.filter(mark => !isChangeMark(mark)));
  const marks = node.marks.filter(mark => !isChangeMark(mark));
  const attrs = isChangeId(node.attrs.suggestId) ? { ...node.attrs, suggestId: null, suggestOp: null } : node.attrs;
  if (node.isLeaf) return node.type.create(attrs, null, marks);
  const content: PMNode[] = [];
  node.forEach(child => content.push(withoutChanges(child, isChangeMark, isChangeId)));
  return node.type.create(attrs, Fragment.from(content), marks);
}

const INLINE_TAG: Partial<Record<ChangeLook, string>> = { ins: 'ins', del: 'del' };

/** The DOM attrs of one highlighted range. */
export function changeAttrs(range: ChangeRange, active: boolean): Record<string, string> {
  const attrs: Record<string, string> = {
    class: range.block ? `vh-block vh-block-${range.look}${range.look === 'moved' ? ' vh-moved' : ''}` : `vh-${range.look}`,
    'data-change-id': range.change,
    'data-diff': range.look === 'moved' ? 'del' : range.look === 'fmt' ? 'chg' : range.look,
  };
  if (active) attrs.class += ' vh-active';
  if (active) attrs['data-diff-active'] = '';
  if (range.look === 'fmt' || range.look === 'chg' || range.look === 'move' || range.noted) {
    attrs.title = range.summary;
    attrs['data-diff-summary'] = range.summary;
  }
  if (range.noted && range.block) attrs['data-diff-note'] = range.summary;
  return attrs;
}

/** Whether a node view is drawing a block the version dropped (its decorations, from `changesPlugin`). */
export const blockDropped = (decorations: readonly Decoration[]): boolean =>
  decorations.some(decoration => (decoration.spec as { diff?: ChangeLook }).diff === 'del');

/**
 * Draws the changes: added words underlined, dropped ones struck through, reformatted ones dotted, whole blocks
 * barred, changed and moved blocks outlined, and the one the strip is on (`active`) ringed. A whole block's look rides
 * along in its decoration's spec, for a node view that draws a dropped block its own way (`blockDropped`).
 */
export function changesPlugin(changes: readonly ChangeRange[], active: string | null = null): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations = changes.map(change => {
          const attrs = changeAttrs(change, change.change === active);
          return change.block ? Decoration.node(change.from, change.to, attrs, { diff: change.look }) : Decoration.inline(change.from, change.to, { nodeName: INLINE_TAG[change.look] ?? 'span', ...attrs });
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
