/**
 * A table of contents on the page: an empty code block in the `toc` language, drawn as links to the headings of its
 * tab. The rules for which headings and how far in are the files' rules too (docs-core).
 */
import { CONTENTS_LANGUAGE, contentsGrouped, contentsLines, isContentsLanguage } from '@open-artifact/docs-core';
import type { Node as PMNode } from 'prosemirror-model';
import { type Command, type EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { insertBlocks } from '../editor/commands.ts';
import { schema } from '../editor/schema.ts';
import { headingHref, headingWords } from '../selbar/fragments.ts';

export const CONTENTS_NAME = 'Table of contents';
export const CONTENTS_EMPTY = 'No headings to list yet';
export const CONTENTS_DELETED = `${CONTENTS_NAME} deleted`;
/** The bar a selected table of contents has, and its one action. */
export const CONTENTS_ACTIONS = `${CONTENTS_NAME} actions`;
export const CONTENTS_DELETE = 'Delete table of contents';

/**
 * What is said when a table of contents is selected: how to reach its links (when it has any) and its bar (when
 * there is one, by `keys`).
 */
export function contentsSelected(links: boolean, keys: string | null): string {
  const said = `${CONTENTS_NAME} selected`;
  if (links && keys) return `${said}, press Enter to reach its links, or ${keys} to reach its actions`;
  if (links) return `${said}, press Enter to reach its links`;
  if (keys) return `${said}, press ${keys} to reach its actions`;
  return said;
}

/** The two ways on from a selected table of contents a selection can name: Enter to its links, F6 to its bar. */
export type ContentsHint = 'links' | 'actions';

/** A hint, for one editor: whether the reader has used it, has been told it, and when they were last on a table of contents. */
export interface HintLesson {
  learned: boolean;
  said: boolean;
  lastOnAt: number;
}

export type HintLessons = Record<ContentsHint, HintLesson>;

/** Away from tables of contents this long, a reader who hasn't used a hint yet is told it again. */
export const HINT_AGAIN_MS = 2 * 60 * 1000;

export function freshLessons(): HintLessons {
  return { links: { learned: false, said: false, lastOnAt: -Infinity }, actions: { learned: false, said: false, lastOnAt: -Infinity } };
}

/** The selection is still on a table of contents at `now`: the time away starts again. */
export function stillOnContents(lessons: HintLessons, now: number): void {
  lessons.links.lastOnAt = now;
  lessons.actions.lastOnAt = now;
}

/**
 * Which of the `offered` hints a new selection of a table of contents names: one the reader hasn't used, the first
 * time, or again after `HINT_AGAIN_MS` away. Every offered hint counts as seen at `now`.
 */
export function hintsToSay(lessons: HintLessons, offered: readonly ContentsHint[], now: number): Set<ContentsHint> {
  const say = new Set<ContentsHint>();
  for (const hint of offered) {
    const lesson = lessons[hint];
    const tell = !lesson.learned && (!lesson.said || now - lesson.lastOnAt > HINT_AGAIN_MS);
    lesson.lastOnAt = now;
    if (tell) {
      lesson.said = true;
      say.add(hint);
    }
  }
  return say;
}

export interface PageContentsLine {
  text: string;
  /** Steps in from the shallowest heading listed. */
  indent: number;
  /** A top line with lines under it: the name of a group. */
  group: boolean;
  /** Where the line goes; none for a heading the doc has not named yet. */
  href: string | null;
}

/** The block is a table of contents: a `toc` code block with nothing in it. Words in it make it code again. */
export const isPageContents = (node: PMNode): boolean =>
  node.type === schema.nodes.codeBlock && isContentsLanguage(node.attrs.language) && node.textContent.trim() === '';

interface PageHeading {
  node: PMNode;
  level: number;
  text: string;
}

/** What a table of contents in this tab lists. */
export function pageContents(doc: PMNode): PageContentsLine[] {
  const headings: PageHeading[] = [];
  doc.descendants(node => {
    if (!node.isTextblock) return true;
    const level = node.type === schema.nodes.paragraph ? Number(node.attrs.heading) : 0;
    const text = level ? headingWords(node) : '';
    if (text) headings.push({ node, level: Math.min(level, 6), text });
    return false;
  });
  const lines = contentsLines(headings, headings[0]?.node === doc.firstChild);
  const grouped = contentsGrouped(lines);
  return lines.map(({ heading, indent }) => {
    const bid = heading.node.attrs.bid;
    return { text: heading.text, indent, group: grouped && indent === 0, href: typeof bid === 'string' ? headingHref(bid, heading.text) : null };
  });
}

/** The table of contents the selection holds whole, with where it starts. */
export function selectedContents(state: EditorState): { node: PMNode; pos: number } | null {
  const { selection } = state;
  return selection instanceof NodeSelection && isPageContents(selection.node) ? { node: selection.node, pos: selection.from } : null;
}

/**
 * A table of contents after the caret's block (or in place of its empty paragraph), and the caret on an empty line
 * after it to write on.
 */
export const insertContents: Command = (state, dispatch) =>
  insertBlocks(schema.nodes.codeBlock!.create({ language: CONTENTS_LANGUAGE }))(
    state,
    dispatch &&
      (tr => {
        const end = tr.selection.$from.after();
        const next = tr.doc.nodeAt(end);
        if (!(next?.type === schema.nodes.paragraph && next.content.size === 0 && !next.attrs.heading)) tr.insert(end, schema.nodes.paragraph!.create());
        dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)));
      }),
  );

/** A caret that lands inside a table of contents (it has no text to stand in) selects the whole block instead. */
export function wholeContents(state: EditorState): NodeSelection | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  return isPageContents($from.parent) ? NodeSelection.create(state.doc, $from.before()) : null;
}

/**
 * The table of contents beside the caret's block in the direction of an arrow key, when the caret stands at that edge;
 * `atEdge` says whether it does (the view knows where lines wrap).
 */
export function contentsBeside(state: EditorState, dir: -1 | 1, atEdge: boolean): NodeSelection | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty || !atEdge) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.depth < 1) return null;
  const outside = state.doc.resolve(dir < 0 ? $from.before() : $from.after());
  const beside = dir < 0 ? outside.nodeBefore : outside.nodeAfter;
  if (!beside || !isPageContents(beside)) return null;
  return NodeSelection.create(state.doc, dir < 0 ? outside.pos - beside.nodeSize : outside.pos);
}
