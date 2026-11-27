/**
 * What a suggestion does, in one short sentence for its card: "Add “…”", "Delete paragraph", "Replace “…” with “…”",
 * "Format: Bold “…”". Pure: it reads the tab's model and nothing else.
 */
import { isAtom, isContents, MARK_ORDER, type AtomType, type Block, type DocState, type Inline, type MarkName, type Marks } from '@open-artifact/docs-core';

/** A piece of a sentence: plain words, or a quote of the doc's words (drawn in “…”). */
export interface SentencePart {
  text: string;
  quote?: true;
}
export type Sentence = SentencePart[];

export const UNRECOGNISED = '(unrecognised change)';

/** The sentence as one line of text, for a screen reader or a notice. */
export function sentenceText(sentence: Sentence): string {
  return sentence
    .map(part => (part.quote ? `“${part.text}”` : part.text))
    .join(' ')
    .replace(/ ,/g, ',');
}

// ---- quoting ---------------------------------------------------------------------------------------------------

const QUOTE_LIMIT = 80;
const PARAGRAPH_SIGN = '¶';
const LINE_SIGN = '↵';
/** How a part's text spells the edges inside it: between blocks, and a hard line break. */
const BLOCK_EDGE = '\n';
const LINE_EDGE = '\u2028';

/**
 * The doc's words as a card quotes them: one line, at most 80 code points, a paragraph break shown as ¶ and a line
 * break as ↵. Empty when nothing is left to show but those signs.
 */
export function quote(text: string): string {
  const spelled = text
    .replace(/\uFFFC/g, ' ')
    .replace(/\r\n?|\n/g, ` ${PARAGRAPH_SIGN} `)
    .replace(/[\u2028\u2029]/g, ` ${LINE_SIGN} `)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spelled.replace(/[¶↵\s]/g, '')) return '';
  const points = [...spelled];
  return points.length > QUOTE_LIMIT ? points.slice(0, QUOTE_LIMIT - 1).join('').trimEnd() + '…' : spelled;
}

// ---- the parts of a suggestion ---------------------------------------------------------------------------------

type Op = 'ins' | 'del';

/** A block the suggestion adds or takes away whole (its children go with it). */
export interface BlockPart {
  op: Op;
  name: BlockName;
  text: string;
  /** A paragraph break: an added block whose words were already in the doc (they moved into it). */
  isBreak: boolean;
  heading?: number;
  listKind?: string;
}

/** Words and atoms next to each other in one block, all added or all struck. */
export interface InlineRun {
  op: Op;
  block: string;
  text: string;
  chars: number;
  atoms: AtomType[];
  /** The marks of the run's first char. */
  marks?: Marks;
}

export interface SuggestionParts {
  blocks: BlockPart[];
  runs: InlineRun[];
}

export type BlockName =
  | 'paragraph'
  | 'heading'
  | 'code block'
  | 'table of contents'
  | 'list'
  | 'list item'
  | 'quote'
  | 'table'
  | 'row'
  | 'cell'
  | 'divider'
  | 'embed'
  | 'block';

const PLURAL: Record<BlockName, string> = {
  paragraph: 'paragraphs',
  heading: 'headings',
  'code block': 'code blocks',
  'table of contents': 'tables of contents',
  list: 'lists',
  'list item': 'list items',
  quote: 'quotes',
  table: 'tables',
  row: 'rows',
  cell: 'cells',
  divider: 'dividers',
  embed: 'embeds',
  block: 'blocks',
};

function headingOf(block: Block): number | undefined {
  const level = block.attrs?.heading;
  return typeof level === 'number' && level > 0 ? level : undefined;
}

export function blockName(block: Block): BlockName {
  switch (block.type) {
    case 'paragraph':
      return headingOf(block) ? 'heading' : 'paragraph';
    case 'codeBlock':
      return isContents(block) ? 'table of contents' : 'code block';
    case 'list':
      return 'list';
    case 'listItem':
      return 'list item';
    case 'blockquote':
      return 'quote';
    case 'table':
      return 'table';
    case 'tableRow':
      return 'row';
    case 'cell':
      return 'cell';
    case 'horizontalRule':
      return 'divider';
    case 'embed':
      return 'embed';
    default:
      return 'block';
  }
}

const itemText = (item: Inline) => (isAtom(item) ? (item.atom === 'hardBreak' ? LINE_EDGE : '\uFFFC') : item.ch);

function textOf(block: Block): string {
  if (block.inline) return block.inline.map(itemText).join('');
  return (block.children ?? []).map(textOf).filter(Boolean).join(BLOCK_EDGE);
}

/** Every part of suggestion `id` in the tab, in document order. */
export function suggestionParts(doc: DocState, id: string): SuggestionParts {
  const parts: SuggestionParts = { blocks: [], runs: [] };
  const visit = (blocks: Block[]) => {
    for (const block of blocks) {
      if (block.suggest?.id === id) {
        const inline = block.inline ?? [];
        const listKind = typeof block.attrs?.kind === 'string' ? block.attrs.kind : undefined;
        const heading = headingOf(block);
        parts.blocks.push({
          op: block.suggest.op,
          name: blockName(block),
          text: textOf(block),
          isBreak: block.suggest.op === 'ins' && inline.length > 0 && inline.every(item => item.suggest?.id !== id),
          ...(heading ? { heading } : {}),
          ...(listKind ? { listKind } : {}),
        });
        continue;
      }
      let run: InlineRun | null = null;
      for (const item of block.inline ?? []) {
        const op = item.suggest?.id === id ? item.suggest.op : null;
        if (!op) {
          run = null;
          continue;
        }
        if (!run || run.op !== op) {
          run = { op, block: block.id, text: '', chars: 0, atoms: [] };
          if (item.marks) run.marks = item.marks;
          parts.runs.push(run);
        }
        run.text += itemText(item);
        if (isAtom(item)) {
          if (item.atom !== 'hardBreak') run.atoms.push(item.atom);
        } else run.chars++;
      }
      if (block.children) visit(block.children);
    }
  };
  visit(doc.blocks);
  return parts;
}

// ---- words -----------------------------------------------------------------------------------------------------

const MARK_LABEL: Record<Exclude<MarkName, 'link'>, string> = {
  bold: 'Bold',
  italic: 'Italic',
  strike: 'Strikethrough',
  code: 'Code',
  underline: 'Underline',
  highlight: 'Highlight',
  textColor: 'Text color',
};

function markLabel(name: Exclude<MarkName, 'link'>, marks: Marks): string {
  if (name === 'textColor' && marks.textColor) return `Text color (${marks.textColor})`;
  return MARK_LABEL[name];
}

const ATOM_WORDS: Partial<Record<AtomType, [string, string]>> = {
  mention: ['mention', 'mentions'],
  date: ['date', 'dates'],
  dropdown: ['dropdown', 'dropdowns'],
  media: ['image', 'images'],
};

function atomPhrase(atoms: AtomType[]): string | null {
  const counts = new Map<AtomType, number>();
  for (const atom of atoms) if (ATOM_WORDS[atom]) counts.set(atom, (counts.get(atom) ?? 0) + 1);
  const phrases = [...counts].map(([atom, count]) => {
    const [one, many] = ATOM_WORDS[atom]!;
    return count > 1 ? `${count} ${many}` : `${/^[aeiou]/.test(one) ? 'an' : 'a'} ${one}`;
  });
  if (!phrases.length) return null;
  return phrases.length === 1 ? phrases[0]! : `${phrases.slice(0, -1).join(', ')} and ${phrases.at(-1)}`;
}

function hostOf(href: string): string {
  try {
    return new URL(href).host || href;
  } catch {
    return href;
  }
}

const words = (text: string): Sentence => [{ text }];
const withQuote = (lead: string, text: string): Sentence => {
  const shown = quote(text);
  return shown ? [{ text: lead }, { text: shown, quote: true }] : [{ text: lead }];
};

function joinRuns(runs: InlineRun[]): string {
  let out = '';
  runs.forEach((run, index) => {
    if (index > 0) out += runs[index - 1]!.block === run.block ? ' ' : BLOCK_EDGE;
    out += run.text;
  });
  return out;
}

/** Struck and added words that read the same: a change of look, named by what changed. */
function formatSentence(old: Marks | undefined, next: Marks | undefined, text: string): Sentence | null {
  const before = old ?? {};
  const after = next ?? {};
  const added: string[] = [];
  const removed: string[] = [];
  for (const name of MARK_ORDER) {
    if (name === 'link') continue;
    if (before[name] === after[name]) continue;
    if (after[name] !== undefined) added.push(markLabel(name, after));
    if (before[name] !== undefined && (after[name] === undefined || name !== 'textColor')) removed.push(markLabel(name, before));
  }
  const linkChanged = before.link !== after.link;
  if (linkChanged && !added.length && !removed.length) {
    if (!before.link) return withQuote(`Add link (${hostOf(after.link!)})`, text);
    if (!after.link) return withQuote('Remove link', text);
    return withQuote(`Change link: ${hostOf(before.link)} → ${hostOf(after.link)}`, text);
  }
  if (!added.length && !removed.length) return null;
  const extra = linkChanged ? [after.link ? `+Link` : `−Link`] : [];
  if (!removed.length && !extra.length) return withQuote(`Format: ${added.join(', ')}`, text);
  if (!added.length && !extra.length) return withQuote(`Remove format: ${removed.join(', ')}`, text);
  return withQuote(`Format: ${[...added.map(name => `+${name}`), ...removed.map(name => `−${name}`), ...extra].join(', ')}`, text);
}

function runSentence(runs: InlineRun[]): Sentence {
  const added = runs.filter(run => run.op === 'ins');
  const struck = runs.filter(run => run.op === 'del');
  const addedText = joinRuns(added);
  const struckText = joinRuns(struck);
  if (added.length && struck.length) {
    if (addedText === struckText && added.length === 1 && struck.length === 1) {
      const format = formatSentence(struck[0]!.marks, added[0]!.marks, addedText);
      if (format) return format;
    }
    const old = quote(struckText);
    const next = quote(addedText);
    if (!old && !next) return words('Replace text');
    if (!next) return [{ text: 'Replace' }, { text: old, quote: true }, { text: 'with new text' }];
    if (!old) return [{ text: 'Replace with' }, { text: next, quote: true }];
    return [{ text: 'Replace' }, { text: old, quote: true }, { text: 'with' }, { text: next, quote: true }];
  }
  const op = added.length ? 'Add' : 'Delete';
  const list = added.length ? added : struck;
  const text = added.length ? addedText : struckText;
  const chars = list.reduce((sum, run) => sum + run.chars, 0);
  if (!chars) {
    const atoms = atomPhrase(list.flatMap(run => run.atoms));
    if (atoms) return words(`${op} ${atoms}`);
    const breaks = [...text].filter(ch => ch === LINE_EDGE).length;
    if (breaks) return words(breaks > 1 ? `${op} ${breaks} line breaks` : `${op} line break`);
  }
  const shown = quote(text);
  return shown ? [{ text: op }, { text: shown, quote: true }] : words(`${op} text`);
}

// ---- blocks ----------------------------------------------------------------------------------------------------

const countOf = (name: BlockName, count: number) => (count > 1 ? `${count} ${PLURAL[name]}` : name);
const sameName = (parts: BlockPart[]): BlockName | null => {
  const names = new Set(parts.map(part => part.name));
  return names.size === 1 ? parts[0]!.name : null;
};

const LIST_KIND: Record<string, string> = { bullet: 'bulleted list', ordered: 'numbered list', check: 'checklist' };

/** One block struck and the same words added back in a new style: a change of block style. */
function blockFormat(old: BlockPart, next: BlockPart): string | null {
  if (old.text !== next.text) return null;
  if (next.name === 'heading' && (old.name === 'paragraph' || (old.name === 'heading' && old.heading !== next.heading))) return `Format: Heading ${next.heading}`;
  if (old.name === 'heading' && next.name === 'paragraph') return 'Format: Normal text';
  if (next.name === 'list' && old.name === 'list' && next.listKind !== old.listKind) return `Format: Make ${LIST_KIND[next.listKind ?? 'bullet'] ?? 'list'}`;
  if (next.name === 'list' && old.name !== 'list') return `Format: Make ${LIST_KIND[next.listKind ?? 'bullet'] ?? 'list'}`;
  if (old.name === 'list' && next.name !== 'list') return 'Format: Remove list';
  if (next.name === 'quote' && old.name !== 'quote') return 'Format: Make quote';
  if (old.name === 'quote' && next.name !== 'quote') return 'Format: Remove quote';
  return null;
}

function phrase(op: 'Add' | 'Delete', parts: BlockPart[]): string {
  const name = sameName(parts);
  return name ? `${op} ${countOf(name, parts.length)}` : `${op} ${parts.length} blocks`;
}

function blockSentence(parts: BlockPart[]): Sentence {
  const breaks = parts.filter(part => part.isBreak);
  const added = parts.filter(part => part.op === 'ins' && !part.isBreak);
  const struck = parts.filter(part => part.op === 'del');
  const breakWords = breaks.length > 1 ? `Add ${breaks.length} paragraph breaks` : breaks.length ? 'Add paragraph break' : '';
  const tail: Sentence = breakWords && (added.length || struck.length) ? [{ text: `, ${breakWords}` }] : [];
  if (!added.length && !struck.length) return words(breakWords || UNRECOGNISED);
  if (added.length && !struck.length) {
    const lead = phrase('Add', added);
    return [...(added.length === 1 ? withQuote(lead, added[0]!.text) : words(lead)), ...tail];
  }
  if (struck.length && !added.length) {
    const lead = phrase('Delete', struck);
    return [...(struck.length === 1 ? withQuote(lead, struck[0]!.text) : words(lead)), ...tail];
  }
  if (added.length === 1 && struck.length === 1) {
    const old = struck[0]!;
    const next = added[0]!;
    const format = blockFormat(old, next);
    if (format) return [...withQuote(format, next.text), ...tail];
    if (old.name === next.name) {
      const before = quote(old.text);
      const after = quote(next.text);
      if (before && after) return [{ text: 'Replace' }, { text: before, quote: true }, { text: 'with' }, { text: after, quote: true }, ...tail];
      return [{ text: `Replace ${old.name}` }, ...tail];
    }
    return [{ text: `Replace ${old.name} with ${next.name}` }, ...tail];
  }
  return [{ text: `${phrase('Add', added)}, ${phrase('Delete', struck)}` }, ...tail];
}

// ---- the sentence ----------------------------------------------------------------------------------------------

export function describeParts(parts: SuggestionParts): Sentence {
  const { blocks, runs } = parts;
  if (!blocks.length && !runs.length) return words(UNRECOGNISED);
  if (!blocks.length) return runSentence(runs);
  if (!runs.length) return blockSentence(blocks);
  const [lead, ...rest] = runSentence(runs);
  return [...blockSentence(blocks), { text: `, ${lead!.text}` }, ...rest];
}

/** The sentence a card shows for suggestion `id` in the tab. */
export function describeSuggestion(doc: DocState, id: string): Sentence {
  return describeParts(suggestionParts(doc, id));
}
