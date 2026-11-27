/**
 * A table of contents: a code block in the `toc` language with nothing in it, which the page and every file draw as
 * links to the headings of its tab. When the tab opens with a heading, that heading is the tab's title and is left out.
 */
import { type Block, isAtom, walk } from './model.ts';

export const CONTENTS_LANGUAGE = 'toc';
/** Headings deeper than this stay out of a table of contents. */
export const CONTENTS_DEPTH = 3;
/** A file draws this many tables of contents at most; any after them are left out. */
export const CONTENTS_PER_FILE = 20;

/** A code block's language names a table of contents. */
export const isContentsLanguage = (language: unknown): boolean => typeof language === 'string' && language.trim().toLowerCase() === CONTENTS_LANGUAGE;

const blankText = (block: Block) => (block.inline ?? []).every(item => isAtom(item) || !item.ch.trim());

/** A table of contents as the files draw it: a `toc` code block with no words in it. */
export const isContents = (block: Block): boolean => block.type === 'codeBlock' && isContentsLanguage(block.attrs?.language) && blankText(block);

export interface ContentsLine<H> {
  heading: H;
  /** Steps in from the shallowest heading listed: 0, 1 or 2. */
  indent: number;
}

/**
 * The lines of a table of contents, from the headings of its tab in order. `opensWithTitle`: the first of them is the
 * tab's first block, its title.
 */
export function contentsLines<H extends { level: number }>(headings: readonly H[], opensWithTitle: boolean): ContentsLine<H>[] {
  const listed = headings.filter((heading, index) => heading.level <= CONTENTS_DEPTH && !(opensWithTitle && index === 0));
  const top = Math.min(...listed.map(heading => heading.level));
  return listed.map(heading => ({ heading, indent: heading.level - top }));
}

/** The top lines stand out as group names when some lines sit under them. */
export const contentsGrouped = (lines: readonly ContentsLine<unknown>[]): boolean => lines.some(line => line.indent > 0);

/** A heading's level, 1 to 6; 0 for any other block. */
function levelOf(block: Block): number {
  if (block.type !== 'paragraph') return 0;
  const heading = block.attrs?.heading;
  return typeof heading === 'number' && heading > 0 ? Math.min(Math.floor(heading), 6) : 0;
}

const hasWords = (block: Block) => (block.inline ?? []).some(item => !isAtom(item) && item.ch.trim() !== '');

export interface ContentsHeading {
  block: Block;
  level: number;
}

/** The lines a table of contents in a tab of these blocks shows: its headings with words, at any depth of the tab. */
export function contentsOf(blocks: Block[]): ContentsLine<ContentsHeading>[] {
  const headings: ContentsHeading[] = [];
  for (const { block } of walk(blocks)) {
    const level = levelOf(block);
    if (level && hasWords(block)) headings.push({ block, level });
  }
  const first = blocks[0];
  return contentsLines(headings, !!first && headings[0]?.block === first);
}
