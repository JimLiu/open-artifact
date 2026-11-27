/**
 * What the slash menu (and the page bar's insert menu) puts in: headings, a table and a dropdown first, then the rest
 * from A to Z, plus a code block in a named language and the dropdown templates when the query names them.
 */
import { announce } from '@open-artifact/editor-kit';
import { setBlockType } from 'prosemirror-commands';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { insertContents } from '../code/contents.ts';
import { type BlockStyle, type ListKind, inTable, insertBlocks, insertRule, insertTable, listKind, setBlockStyle, toggleList, toggleQuote } from '../editor/commands.ts';
import { schema } from '../editor/schema.ts';
import { clearRange, insertDate, insertDropdownChip } from './chips.ts';
import { isoDate, today } from './dates.ts';
import { dropdownFromTemplate } from './dropdown-calls.ts';
import { DROPDOWN_TEMPLATES } from './dropdown-model.ts';
import { canPickImage, chooseImage } from './image.ts';
import { languagesFor } from './languages.ts';
import { type InsertIcon, type MenuOption, type Range, openPicker } from './plugin.ts';

const { nodes } = schema;

/** Where the caret is, for the items that only fit some places. */
export interface SlashPlace {
  inTable: boolean;
  /** In a quote or a list item (a quote can't be made there). */
  inQuoteOrItem: boolean;
  canPickImage: boolean;
}

export interface SlashItem extends MenuOption {
  icon: InsertIcon;
  keywords: string;
  /** Left out inside a table. */
  noTable?: boolean;
  when?(place: SlashPlace): boolean;
}

type Edit = (state: EditorState, dispatch: EditorView['dispatch'], view: EditorView) => boolean;

/** What is said once an item went in: "Inserted Table", "Inserted Code block · Python". */
export const insertedWords = (label: string): string => `Inserted ${label}`;

/** Says `words` when an edit changed the page (one Suggesting mode refuses leaves it as it was, and says so itself). */
function sayIfChanged(view: EditorView, before: EditorState['doc'], words: string): void {
  if (!view.state.doc.eq(before)) announce(words);
}

/** Removes the `/query`, then makes the edit at the caret, and says what went in. */
const after =
  (edit: Edit, words: string) =>
  (view: EditorView, range: Range): void => {
    clearRange(view, range);
    const before = view.state.doc;
    if (edit(view.state, view.dispatch, view)) sayIfChanged(view, before, words);
    view.focus();
  };

const heading = (level: 1 | 2 | 3): SlashItem => ({
  id: `h${level}`,
  label: `Heading ${level}`,
  icon: `h${level}`,
  keywords: `heading ${level} h${level} title ${'#'.repeat(level)}`,
  noTable: true,
  run: after(setBlockStyle(`h${level}` as BlockStyle), insertedWords(`Heading ${level}`)),
});

/** A list of this kind around the caret's paragraph (left as it is when it already is one). */
const makeList =
  (kind: ListKind): Edit =>
  (state, dispatch) =>
    listKind(state) === kind ? false : toggleList(kind)(state, dispatch);

const inQuote = (state: EditorState) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type === nodes.blockquote) return true;
  return false;
};

/** The caret's empty paragraph becomes a code block; otherwise one goes in after the caret's block. */
const makeCode =
  (language: string | null): Edit =>
  (state, dispatch) => {
    const parent = state.selection.$from.parent;
    if (parent.type === nodes.codeBlock) return false;
    if (parent.type === nodes.paragraph && parent.content.size === 0 && setBlockType(nodes.codeBlock!, { language })(state, dispatch)) return true;
    return insertBlocks(nodes.codeBlock!.create({ language }))(state, dispatch);
  };

const BASE_ITEMS: readonly SlashItem[] = [
  heading(1),
  heading(2),
  heading(3),
  {
    id: 'table',
    label: 'Table',
    icon: 'table',
    keywords: 'table grid rows columns cells',
    noTable: true,
    run: after(insertTable(3, 3), insertedWords('Table')),
  },
  {
    id: 'dropdown',
    label: 'Dropdown',
    icon: 'dropdown',
    keywords: 'dropdown select status enum option choose pick',
    run(view, range) {
      clearRange(view, range);
      openPicker(view, 'insertDropdown', view.state.selection.from);
    },
  },
  {
    id: 'divider',
    label: 'Divider',
    icon: 'divider',
    keywords: 'divider horizontal rule line hr ---',
    noTable: true,
    run: after(insertRule, insertedWords('Divider')),
  },
  {
    id: 'quote',
    label: 'Quote',
    icon: 'quote',
    keywords: 'quote blockquote cite >',
    noTable: true,
    when: place => !place.inQuoteOrItem,
    // The item only makes a quote (it is left out where one can't be made), so it says the quote came on.
    run: after((state, dispatch) => (inQuote(state) ? false : toggleQuote(state, dispatch)), 'Quote on'),
  },
  {
    id: 'image',
    label: 'Image',
    icon: 'image',
    keywords: 'image picture photo img upload png jpg jpeg gif screenshot',
    when: place => place.canPickImage,
    run(view, range) {
      clearRange(view, range);
      chooseImage(view);
    },
  },
  {
    id: 'bullet-list',
    label: 'Bulleted list',
    icon: 'bullet',
    keywords: 'bullet list ul unordered - *',
    run: after(makeList('bullet'), insertedWords('Bulleted list')),
  },
  {
    id: 'ordered-list',
    label: 'Numbered list',
    icon: 'ordered',
    keywords: 'numbered list ol ordered 1.',
    run: after(makeList('ordered'), insertedWords('Numbered list')),
  },
  {
    id: 'checkbox',
    label: 'Checklist',
    icon: 'check',
    keywords: 'checkbox todo task check checklist [] box',
    run: after(makeList('check'), insertedWords('Checklist')),
  },
  {
    id: 'code',
    label: 'Code block',
    icon: 'code',
    keywords: 'code codeblock snippet fence pre monospace block',
    noTable: true,
    run: after(makeCode(null), insertedWords('Code block')),
  },
  {
    id: 'toc',
    label: 'Table of contents',
    icon: 'contents',
    keywords: 'toc contents index',
    noTable: true,
    run: after(insertContents, insertedWords('Table of contents')),
  },
  {
    id: 'date',
    label: 'Date',
    icon: 'date',
    keywords: 'date calendar due day when',
    run(view, range) {
      const before = view.state.doc.content.size;
      insertDate(view, isoDate(today()), { range, open: true });
      // More changed than the `/query` going: the date went in.
      if (view.state.doc.content.size !== before - (range.to - range.from)) announce(insertedWords('Date'));
    },
  },
];

const FEATURED = ['h1', 'h2', 'h3', 'table', 'dropdown'];

/** The menu's items in order: the featured ones, then the rest by label. */
export const ORDERED_ITEMS: readonly SlashItem[] = [
  ...FEATURED.map(id => BASE_ITEMS.find(item => item.id === id)!),
  ...BASE_ITEMS.filter(item => !FEATURED.includes(item.id)).toSorted((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
];

/** How many items lead the menu, before the A–Z rest. */
export const FEATURED_COUNT = FEATURED.length;

/** The item belongs at a caret in this place. */
export const fitsPlace = (item: SlashItem, place: SlashPlace): boolean => (!item.when || item.when(place)) && !(item.noTable && place.inTable);

function templateItems(query: string): SlashItem[] {
  if (query.length < 3) return [];
  return DROPDOWN_TEMPLATES.filter(template => template.name.toLowerCase().startsWith(query)).map(template => ({
    id: `dropdown-${template.name.toLowerCase()}`,
    label: `Dropdown · ${template.name}`,
    icon: 'dropdown',
    keywords: '',
    run(view: EditorView, range: Range) {
      clearRange(view, range);
      view.focus();
      void dropdownFromTemplate(template).then(
        id => {
          if (!view.isDestroyed) insertDropdownChip(view, id, { open: true });
        },
        () => {
          if (!view.isDestroyed) openPicker(view, 'insertDropdown', view.state.selection.from);
        },
      );
    },
  }));
}

function languageItems(query: string): SlashItem[] {
  return languagesFor(query).map(language => ({
    id: `code-${language.key}`,
    label: `Code block · ${language.label}`,
    icon: 'code',
    keywords: '',
    noTable: true,
    run: after(makeCode(language.key), insertedWords(`Code block · ${language.label}`)),
  }));
}

const MAX_ITEMS = 10;

/** The items a query finds, where the caret is. `/code py` finds the language after "code" too. */
export function slashItems(rawQuery: string, place: SlashPlace): SlashItem[] {
  const query = rawQuery.toLowerCase();
  const fitting = ORDERED_ITEMS.filter(item => fitsPlace(item, place));
  const named = (item: SlashItem) => !query || item.label.toLowerCase().startsWith(query) || ` ${item.keywords}`.includes(` ${query}`);
  const direct = [...templateItems(query).filter(item => fitsPlace(item, place)), ...fitting.filter(named)];
  const codeQuery = /^code\s+(\S+)$/.exec(query)?.[1];
  const languages = languageItems(codeQuery ?? query).filter(item => fitsPlace(item, place) && !direct.some(other => other.id === item.id));
  return [...direct, ...languages].slice(0, Math.max(MAX_ITEMS, direct.length));
}

export function slashPlace(state: EditorState): SlashPlace {
  const { $from } = state.selection;
  let inQuoteOrItem = false;
  for (let depth = $from.depth; depth > 0; depth--) {
    const type = $from.node(depth).type;
    if (type === nodes.blockquote || type === nodes.listItem) inQuoteOrItem = true;
  }
  return { inTable: inTable(state), inQuoteOrItem, canPickImage: canPickImage() };
}

export const slashSource = (query: string, state: EditorState): MenuOption[] => slashItems(query, slashPlace(state));
