/**
 * What changed between two versions of a tab, as one doc and a list of changes. The doc is the newer version with what
 * it added marked, what it dropped put back in place, words whose formatting changed marked as such, and blocks that
 * moved drawn where they went with a small "Moved" note where they were. Each change has an id and a summary in the
 * words the history uses ("Text replaced", "Bold added", "Heading 2 added", "Moved"); the marks ride on `suggest`, under
 * keys {@link Comparison.parts} names, which the preview turns into its own highlighting, so nothing here is a real
 * suggestion.
 *
 * Blocks are matched by id (versions and restores keep them). A text block's words are compared by their content,
 * since a block written whole gets new character ids. Blocks between matched ones that were replaced are paired up
 * when both hold text and share most of it, so a reworded paragraph reads as its changed words, not as a deleted and an
 * added one. A block both versions hold in another order is a move.
 */
import { type Block, type DocState, type Inline, type Marks, isAtom, isContentsLanguage, isText } from '@open-artifact/docs-core';

export type ChangeOp = 'ins' | 'del';

/** What a change did: added, deleted, replaced (words), formatting, a block's kind or settings, or a move. */
export type ChangeKind = 'ins' | 'del' | 'replace' | 'fmt' | 'chg' | 'move';

/** One change, in document order. */
export interface VersionChange {
  /** Marked on the drawn version as `data-change-id`. */
  id: string;
  kind: ChangeKind;
  summary: string;
}

/** How a marked part is drawn: added, dropped, reformatted, a block changed, a block moved here, or moved from here. */
export type ChangeLook = 'ins' | 'del' | 'fmt' | 'chg' | 'move' | 'moved';

/** A marked part of a change (the key is the `suggest.id` it rides on). */
export interface ChangePart {
  change: string;
  look: ChangeLook;
  summary: string;
}

export interface Comparison extends DocState {
  changes: VersionChange[];
  parts: Record<string, ChangePart>;
}

/** Change ids and part keys start with this (a real suggestion id can't hold a colon). */
export const CHANGE_PREFIX = 'vh:';

/** Character comparisons larger than this are shown as the whole text replaced. */
const MAX_CELLS = 400_000;

/** `before` → `after`: the doc to draw and its changes, in document order. */
export function compareVersions(before: DocState, after: DocState): Comparison {
  const changes = new Changes();
  const blocks = mergeBlocks(before.blocks, after.blocks, changes);
  return { rev: after.rev, blocks, changes: changes.list, parts: changes.parts };
}

/** True when the comparison shows any change. */
export const hasChanges = (comparison: Comparison): boolean => comparison.changes.length > 0;

/** "1 change", "3 changes". */
export const changeCountLabel = (count: number): string => (count === 1 ? '1 change' : `${count} changes`);

/** The next change to show, stepping `dir` from `active` (-1: none shown yet), wrapping at either end. */
export function stepChange(active: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (dir === 1) return (active + 1) % count;
  return active <= 0 ? count - 1 : active - 1;
}

// ---- collecting changes --------------------------------------------------------------------------------------------

class Changes {
  readonly list: VersionChange[] = [];
  readonly parts: Record<string, ChangePart> = {};
  private seq = 0;
  /** Moves being compared inside: what changes within them is summed up in the move. */
  private within: Array<{ id: string; summaries: string[] }> = [];
  private moves = new Map<string, { id: string; own: VersionChange | null }>();

  change(kind: ChangeKind, summary: string): string {
    const outer = this.within[this.within.length - 1];
    if (outer) {
      outer.summaries.push(summary);
      return outer.id;
    }
    const id = `${CHANGE_PREFIX}${this.list.length + 1}`;
    this.list.push({ id, kind, summary });
    return id;
  }

  part(change: string, look: ChangeLook, summary: string): string {
    const key = `${change}.${++this.seq}`;
    this.parts[key] = { change, look, summary };
    return key;
  }

  /** The change of the move of block `id` (one for where it went and where it was). */
  move(blockId: string): string {
    const known = this.moves.get(blockId);
    if (known) return known.id;
    const before = this.list.length;
    const id = this.change('move', 'Moved');
    this.moves.set(blockId, { id, own: this.list.length > before ? this.list[this.list.length - 1]! : null });
    return id;
  }

  /** Runs `compare` with every change it finds folded into the move of `blockId`, and words the move with them. */
  inMove<T>(blockId: string, compare: () => T): T {
    const id = this.move(blockId);
    const frame = { id, summaries: [] as string[] };
    this.within.push(frame);
    try {
      return compare();
    } finally {
      this.within.pop();
      const own = this.moves.get(blockId)?.own;
      const inner = [...new Set(frame.summaries)].filter(summary => summary !== 'Moved');
      if (own && inner.length) own.summary = `Moved; ${inner.join('; ')}`;
    }
  }
}

// ---- blocks --------------------------------------------------------------------------------------------------------

function mergeBlocks(before: readonly Block[], after: readonly Block[], changes: Changes): Block[] {
  const anchors = commonById(before, after);
  const moved = movedBlocks(before, after, anchors);
  const out: Block[] = [];
  /** Where a moved block was, by the old block put there for now: its note is written once both places are known. */
  const ghosts = new Map<Block, string>();
  const landed = new Map<string, Block>();
  let i = 0;
  let j = 0;
  for (const [oi, nj] of [...anchors, [before.length, after.length] as const]) {
    out.push(...mergeRun(before.slice(i, oi), after.slice(j, nj), changes, moved, ghosts, landed));
    if (oi < before.length && nj < after.length) out.push(...matchBlock(before[oi]!, after[nj]!, changes));
    i = oi + 1;
    j = nj + 1;
  }
  if (!ghosts.size) return out;
  return out.map((block, index) => {
    const blockId = ghosts.get(block);
    if (blockId === undefined) return block;
    const there = landed.get(blockId);
    const down = there ? out.indexOf(there) > index : true;
    return ghostOf(block, changes.move(blockId), down, changes);
  });
}

/** The blocks both lists hold out of order (and could be compared in place): old block by id. */
function movedBlocks(before: readonly Block[], after: readonly Block[], anchors: ReadonlyArray<readonly [number, number]>): Map<string, Block> {
  const anchored = new Set(anchors.map(([oi]) => before[oi]!.id));
  const fresh = new Map<string, Block>();
  for (const block of after) if (!fresh.has(block.id)) fresh.set(block.id, block);
  const moved = new Map<string, Block>();
  for (const block of before) {
    const now = fresh.get(block.id);
    if (now && !anchored.has(block.id) && !moved.has(block.id) && comparable(block, now)) moved.set(block.id, block);
  }
  return moved;
}

const comparable = (old: Block, fresh: Block) => (isText(old) && isText(fresh)) || old.type === fresh.type;

/** Blocks replaced between two matched ones: moves kept apart, the rest paired by position when both hold text. */
function mergeRun(
  gone: readonly Block[],
  added: readonly Block[],
  changes: Changes,
  moved: ReadonlyMap<string, Block>,
  ghosts: Map<Block, string>,
  landed: Map<string, Block>,
): Block[] {
  const out: Block[] = [];
  let g = 0;
  let a = 0;
  while (g < gone.length || a < added.length) {
    const old = gone[g];
    const fresh = added[a];
    if (old && moved.has(old.id)) {
      changes.move(old.id);
      ghosts.set(old, old.id);
      out.push(old);
      g++;
      continue;
    }
    if (fresh && moved.has(fresh.id)) {
      const block = movedBlock(moved.get(fresh.id)!, fresh, changes);
      landed.set(fresh.id, block);
      out.push(block);
      a++;
      continue;
    }
    if (old && fresh) {
      const merged = isText(old) && isText(fresh) ? mergeText(old, fresh, true, changes) : null;
      if (merged) out.push(merged);
      else out.push(droppedBlock(old, changes), addedBlock(fresh, changes));
      g++;
      a++;
    } else if (old) {
      out.push(droppedBlock(old, changes));
      g++;
    } else if (fresh) {
      out.push(addedBlock(fresh, changes));
      a++;
    }
  }
  return out;
}

function movedBlock(old: Block, fresh: Block, changes: Changes): Block {
  const [block] = changes.inMove(fresh.id, () => matchBlock(old, fresh, changes));
  const id = changes.move(fresh.id);
  return { ...block!, suggest: { id: changes.part(id, 'move', summaryOf(changes, id)), op: 'ins' } };
}

const summaryOf = (changes: Changes, id: string) => changes.list.find(change => change.id === id)?.summary ?? 'Moved';

/** Where a moved block was: a short note pointing to where it went (rows and cells keep their shape, struck through). */
function ghostOf(old: Block, id: string, down: boolean, changes: Changes): Block {
  const key = changes.part(id, 'moved', 'Moved');
  if (old.type === 'tableRow' || old.type === 'cell') return marked(old, 'del', key);
  const text = `Moved ${down ? '↓' : '↑'}`;
  const note: Block = { id: `${old.id}~moved`, type: 'paragraph', inline: Array.from(text).map((ch, index) => ({ id: `${old.id}~moved.${index}`, ch })) };
  if (old.type === 'listItem') return { id: `${old.id}~item`, type: 'listItem', suggest: { id: key, op: 'del' }, children: [note] };
  return { ...note, suggest: { id: key, op: 'del' } };
}

function matchBlock(old: Block, fresh: Block, changes: Changes): Block[] {
  if (isText(old) && isText(fresh)) return [mergeText(old, fresh, false, changes)!];
  if (old.children && fresh.children && old.type === fresh.type) {
    const key = blockChange(old, fresh, changes);
    return [{ ...fresh, ...(key ? { suggest: { id: key, op: 'ins' as const } } : {}), children: mergeBlocks(old.children, fresh.children, changes) }];
  }
  if (!old.children && !fresh.children && !old.inline && !fresh.inline && old.type === fresh.type) {
    const key = blockChange(old, fresh, changes);
    return [key ? { ...fresh, suggest: { id: key, op: 'ins' } } : fresh];
  }
  return [droppedBlock(old, changes), addedBlock(fresh, changes)];
}

/** A kept block whose kind or settings changed: the part key of that change, or `null`. */
function blockChange(old: Block, fresh: Block, changes: Changes): string | null {
  const summary = old.type !== fresh.type ? `${nodeLabel(old)} → ${nodeLabel(fresh)}` : attrsSummary(old, fresh);
  if (!summary) return null;
  return changes.part(changes.change('chg', summary), 'chg', summary);
}

function droppedBlock(block: Block, changes: Changes): Block {
  const summary = `${nodeLabel(block)} deleted`;
  return marked(block, 'del', changes.part(changes.change('del', summary), 'del', summary));
}

function addedBlock(block: Block, changes: Changes): Block {
  const summary = `${nodeLabel(block)} added`;
  return marked(block, 'ins', changes.part(changes.change('ins', summary), 'ins', summary));
}

/** A block and everything in it marked as added or dropped. */
function marked(block: Block, op: ChangeOp, key: string): Block {
  return {
    ...block,
    suggest: { id: key, op },
    ...(block.inline ? { inline: block.inline.map(item => tagged(item, key, op)) } : {}),
    ...(block.children ? { children: block.children.map(child => marked(child, op, key)) } : {}),
  };
}

const tagged = <T extends Inline>(item: T, key: string, op: ChangeOp): T => ({ ...item, suggest: { id: key, op } });

// ---- text ----------------------------------------------------------------------------------------------------------

type ItemStep = { op: 'same'; a: number; b: number } | { op: 'del'; a: number } | { op: 'ins'; b: number };

/** A text block's words compared; `null` when `similar` is asked for and the two share less than half their text. */
function mergeText(old: Block, fresh: Block, similar: boolean, changes: Changes): Block | null {
  const a = old.inline ?? [];
  const b = fresh.inline ?? [];
  const steps = itemSteps(a, b);
  if (similar && steps.filter(step => step.op === 'same').length * 2 < Math.max(a.length, b.length)) return null;
  const head = blockChange(old, fresh, changes);
  const items: Inline[] = [];
  let k = 0;
  while (k < steps.length) {
    const step = steps[k]!;
    if (step.op === 'same') {
      const delta = marksSummary(a[step.a]!.marks, b[step.b]!.marks);
      if (!delta) {
        items.push(b[step.b]!);
        k++;
        continue;
      }
      const key = changes.part(changes.change('fmt', delta), 'fmt', delta);
      for (let next = steps[k]; next?.op === 'same' && marksSummary(a[next.a]!.marks, b[next.b]!.marks) === delta; next = steps[++k]) items.push(tagged(b[next.b]!, key, 'ins'));
      continue;
    }
    // One change runs on over the spaces between changed words ("on Friday" → "Monday" is one replacement).
    const run: ItemStep[] = [];
    while (k < steps.length) {
      if (steps[k]!.op !== 'same') {
        run.push(steps[k++]!);
        continue;
      }
      let m = k;
      for (let gap = steps[m]; gap?.op === 'same' && isSpace(b[gap.b]!) && !marksSummary(a[gap.a]!.marks, b[gap.b]!.marks); gap = steps[++m]);
      if (m === k || m >= steps.length || steps[m]!.op === 'same') break;
      run.push(...steps.slice(k, m));
      k = m;
    }
    const gone = run.flatMap(item => (item.op === 'del' ? [a[item.a]!] : []));
    const put = run.flatMap(item => (item.op === 'ins' ? [b[item.b]!] : []));
    const kind: ChangeKind = gone.length && put.length ? 'replace' : put.length ? 'ins' : 'del';
    const summary = textSummary(kind, [...gone, ...put]);
    const id = changes.change(kind, summary);
    const delKey = gone.length ? changes.part(id, 'del', summary) : '';
    const insKey = put.length ? changes.part(id, 'ins', summary) : '';
    if (kind === 'replace' && run.some(item => item.op === 'same')) {
      // A replacement over spaces reads as the old words, then the new ones.
      for (const item of run) if (item.op !== 'ins') items.push(tagged(a[item.a]!, delKey, 'del'));
      for (const item of run) if (item.op !== 'del') items.push(tagged(b[item.b]!, insKey, 'ins'));
      continue;
    }
    for (const item of run) items.push(item.op === 'same' ? b[item.b]! : item.op === 'del' ? tagged(a[item.a]!, delKey, 'del') : tagged(b[item.b]!, insKey, 'ins'));
  }
  return { ...fresh, ...(head ? { suggest: { id: head, op: 'ins' as const } } : {}), inline: items };
}

/** "Text added", "Text replaced", "Mention deleted", "Image replaced", "Content added". */
export function textSummary(kind: ChangeKind, items: readonly Inline[]): string {
  const verb = kind === 'replace' ? 'replaced' : kind === 'ins' ? 'added' : 'deleted';
  if (items.some(item => !isAtom(item)) || !items.length) return `Text ${verb}`;
  const atoms = items.filter(isAtom);
  const one = atoms.every(item => item.atom === atoms[0]!.atom) && atoms.length === (kind === 'replace' ? 2 : 1);
  return `${one ? (ATOM_LABELS[atoms[atoms.length - 1]!.atom] ?? 'Content') : 'Content'} ${verb}`;
}

/** Words (letters and digits), each CJK character, each other character and each atom: what text is compared by. */
interface Token {
  key: string;
  from: number;
  to: number;
}

const WORD = /[\p{L}\p{M}\p{N}_]/u;
const isSpace = (item: Inline) => !isAtom(item) && /^\s$/u.test(item.ch);
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function tokensOf(items: readonly Inline[]): Token[] {
  const tokens: Token[] = [];
  let word: Token | null = null;
  items.forEach((item, index) => {
    if (isAtom(item)) {
      word = null;
      tokens.push({ key: `a${item.atom}${JSON.stringify(item.attrs ?? {})}`, from: index, to: index + 1 });
      return;
    }
    if (WORD.test(item.ch) && !CJK.test(item.ch)) {
      if (word) {
        word.key += item.ch;
        word.to = index + 1;
      } else {
        word = { key: `w${item.ch}`, from: index, to: index + 1 };
        tokens.push(word);
      }
      return;
    }
    word = null;
    tokens.push({ key: `c${item.ch}`, from: index, to: index + 1 });
  });
  return tokens;
}

/** The two texts compared word by word, as steps over their items. */
function itemSteps(a: readonly Inline[], b: readonly Inline[]): ItemStep[] {
  const ta = tokensOf(a);
  const tb = tokensOf(b);
  const out: ItemStep[] = [];
  for (const step of diffSequences(
    ta.map(token => token.key),
    tb.map(token => token.key),
  )) {
    if (step.op === 'same') {
      const x = ta[step.a]!;
      const y = tb[step.b]!;
      for (let n = 0; n < x.to - x.from; n++) out.push({ op: 'same', a: x.from + n, b: y.from + n });
    } else if (step.op === 'del') {
      const x = ta[step.a]!;
      for (let n = x.from; n < x.to; n++) out.push({ op: 'del', a: n });
    } else {
      const y = tb[step.b]!;
      for (let n = y.from; n < y.to; n++) out.push({ op: 'ins', b: n });
    }
  }
  return out;
}

// ---- words for changes ---------------------------------------------------------------------------------------------

const ATOM_LABELS: Record<string, string> = { hardBreak: 'Line break', mention: 'Mention', media: 'Image', date: 'Date', dropdown: 'Dropdown' };

const BLOCK_LABELS: Record<string, string> = {
  listItem: 'List item',
  codeBlock: 'Code block',
  horizontalRule: 'Divider',
  embed: 'Embed',
  table: 'Table',
  tableRow: 'Row',
  cell: 'Cell',
  pending: 'Placeholder',
  blockquote: 'Quote',
};

const LIST_LABELS: Record<string, string> = { bullet: 'Bulleted list', ordered: 'Numbered list', check: 'Checklist' };

const headingLabel = (heading: unknown) => (typeof heading === 'number' && heading > 0 ? `Heading ${heading}` : 'Paragraph');
const listLabel = (kind: unknown) => LIST_LABELS[typeof kind === 'string' ? kind : 'bullet'] ?? 'List';

/** "Paragraph", "Heading 2", "Numbered list", "Code block"… */
export function nodeLabel(block: Pick<Block, 'type' | 'attrs'>): string {
  if (block.type === 'paragraph') return headingLabel(block.attrs?.heading);
  if (block.type === 'list') return listLabel(block.attrs?.kind);
  if (block.type === 'codeBlock' && isContentsLanguage(block.attrs?.language)) return 'Table of contents';
  return BLOCK_LABELS[block.type] ?? 'Block';
}

const valueKey = (value: unknown) => JSON.stringify(value ?? null);
const orText = (fallback: string) => (value: unknown) => (typeof value === 'string' && value !== '' ? value : typeof value === 'number' ? String(value) : fallback);

/** What changed in a kept block's settings ("Paragraph → Heading 2", "Code language: plain → js"); `null`: nothing. */
export function attrsSummary(old: Pick<Block, 'type' | 'attrs'>, fresh: Pick<Block, 'type' | 'attrs'>): string | null {
  const a = old.attrs ?? {};
  const b = fresh.attrs ?? {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => valueKey(a[key]) !== valueKey(b[key]));
  if (!keys.length) return null;
  const has = (key: string) => keys.includes(key);
  const items: string[] = [];
  const from = (prefix: string, word: (value: unknown) => string, key: string) => {
    if (has(key) && word(a[key]) !== word(b[key])) items.push(`${prefix}${word(a[key])} → ${word(b[key])}`);
  };
  switch (fresh.type) {
    case 'paragraph':
      from('', headingLabel, 'heading');
      break;
    case 'list':
      from('', listLabel, 'kind');
      from('Numbering: ', orText('1'), 'numbering');
      from('Start: ', orText('1'), 'start');
      break;
    case 'listItem':
      if (has('checked')) items.push(b.checked === true ? 'Checked' : b.checked === false ? 'Unchecked' : 'Checkbox removed');
      break;
    case 'cell': {
      if (has('header')) items.push(b.header === true ? 'Made header cell' : 'Made body cell');
      const area = (attrs: Record<string, unknown>) => (Number(attrs.colspan) || 1) * (Number(attrs.rowspan) || 1);
      if (has('colspan') || has('rowspan')) items.push(area(b) > area(a) ? 'Merged cells' : 'Split cells');
      from('Cell background: ', orText('none'), 'background');
      from('Cell alignment: ', orText('left'), 'align');
      if (has('colwidth')) items.push('Column resized');
      break;
    }
    case 'codeBlock':
      // A table of contents is no language of code: the block became one, or stopped being one.
      if (nodeLabel(old) !== nodeLabel(fresh)) items.push(`${nodeLabel(old)} → ${nodeLabel(fresh)}`);
      else from('Code language: ', orText('plain'), 'language');
      break;
  }
  return items.length ? items.join('; ') : `${nodeLabel(fresh)} changed`;
}

const MARK_LABELS: Record<string, string> = { bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough', code: 'Code', link: 'Link', highlight: 'Highlight' };
const SUMMARY_ORDER = ['bold', 'italic', 'underline', 'strike', 'code', 'link', 'highlight', 'textColor'] as const;

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const highlightColor = (value: unknown) => (typeof value === 'string' && value !== '' ? value : 'yellow');
const textColor = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);

/** A link as the change says it: its scheme, host and path, shortened. */
export function shortLink(href: unknown): string | null {
  if (typeof href !== 'string' || !href.trim()) return null;
  const value = href.trim().replace(/\s+/g, ' ');
  const cut = (text: string) => (Array.from(text).length > 40 ? `${Array.from(text).slice(0, 40).join('')}…` : text);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return cut(value.split(/[?#]/)[0]!) || null;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return `${url.protocol}//${url.host}${url.pathname === '/' ? '' : cut(url.pathname)}`;
  if (url.protocol === 'mailto:' || url.protocol === 'tel:') return `${url.protocol}${cut(url.pathname)}`;
  return url.protocol;
}

/** What changed in a run's formatting ("Bold added", "Link added: https://a.com", "Highlight yellow → green"); `null`: none. */
export function marksSummary(before: Marks | undefined, after: Marks | undefined): string | null {
  const items: string[] = [];
  for (const name of SUMMARY_ORDER) {
    const was = before?.[name];
    const now = after?.[name];
    if ((was ?? undefined) === (now ?? undefined)) continue;
    const label = MARK_LABELS[name] ?? capital(name);
    if (was === undefined) {
      if (name === 'highlight') items.push(`${capital(highlightColor(now))} highlight added`);
      else if (name === 'textColor') items.push(textColor(now) ? `${capital(textColor(now)!)} text color added` : 'Text color added');
      else if (name === 'link') items.push(shortLink(now) ? `Link added: ${shortLink(now)}` : 'Link added');
      else items.push(`${label} added`);
    } else if (now === undefined) {
      if (name === 'highlight') items.push(`${capital(highlightColor(was))} highlight removed`);
      else if (name === 'textColor') items.push(textColor(was) ? `${capital(textColor(was)!)} text color removed` : 'Text color removed');
      else if (name === 'link') items.push(shortLink(was) ? `Link removed: ${shortLink(was)}` : 'Link removed');
      else items.push(`${label} removed`);
    } else if (name === 'highlight') items.push(`Highlight ${highlightColor(was)} → ${highlightColor(now)}`);
    else if (name === 'textColor') items.push(textColor(was) && textColor(now) ? `Text color ${textColor(was)} → ${textColor(now)}` : 'Text color changed');
    else if (name === 'link') {
      const x = shortLink(was);
      const y = shortLink(now);
      items.push(x !== null && y !== null && x !== y ? `Link changed: ${x} → ${y}` : 'Link changed');
    } else items.push(`${label} changed`);
  }
  return items.length ? items.join(', ') : null;
}

// ---- sequences -----------------------------------------------------------------------------------------------------

/** Index pairs of the blocks both lists hold (by id), in order: the longest such run. */
function commonById(before: readonly Block[], after: readonly Block[]): Array<readonly [number, number]> {
  const at = new Map<string, number>();
  before.forEach((block, index) => {
    if (!at.has(block.id)) at.set(block.id, index);
  });
  const pairs: Array<readonly [number, number]> = [];
  const seen = new Set<string>();
  after.forEach((block, index) => {
    const old = at.get(block.id);
    if (old !== undefined && !seen.has(block.id)) {
      seen.add(block.id);
      pairs.push([old, index]);
    }
  });
  return longestIncreasing(pairs);
}

/** The longest run of pairs whose first indexes increase (their second ones already do). */
function longestIncreasing(pairs: ReadonlyArray<readonly [number, number]>): Array<readonly [number, number]> {
  const tails: number[] = [];
  const back: number[] = new Array<number>(pairs.length).fill(-1);
  pairs.forEach(([value], index) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]!]![0] < value) lo = mid + 1;
      else hi = mid;
    }
    back[index] = lo > 0 ? tails[lo - 1]! : -1;
    tails[lo] = index;
  });
  const out: Array<readonly [number, number]> = [];
  for (let index = tails.length ? tails[tails.length - 1]! : -1; index >= 0; index = back[index]!) out.push(pairs[index]!);
  return out.reverse();
}

export type DiffStep = { op: 'same'; a: number; b: number } | { op: 'del'; a: number } | { op: 'ins'; b: number };

/** The steps from `a` to `b` keeping their longest common subsequence; deletions come before insertions at a change. */
export function diffSequences(a: readonly string[], b: readonly string[]): DiffStep[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const steps: DiffStep[] = [];
  for (let k = 0; k < head; k++) steps.push({ op: 'same', a: k, b: k });
  const midA = a.length - head - tail;
  const midB = b.length - head - tail;
  if (midA * midB > MAX_CELLS) {
    for (let k = 0; k < midA; k++) steps.push({ op: 'del', a: head + k });
    for (let k = 0; k < midB; k++) steps.push({ op: 'ins', b: head + k });
  } else {
    // lengths[x][y]: the common subsequence of a[head + x…] and b[head + y…].
    const width = midB + 1;
    const lengths = new Uint32Array((midA + 1) * width);
    for (let x = midA - 1; x >= 0; x--)
      for (let y = midB - 1; y >= 0; y--)
        lengths[x * width + y] = a[head + x] === b[head + y] ? lengths[(x + 1) * width + y + 1]! + 1 : Math.max(lengths[(x + 1) * width + y]!, lengths[x * width + y + 1]!);
    let x = 0;
    let y = 0;
    const pendingIns: DiffStep[] = [];
    const flush = () => steps.push(...pendingIns.splice(0));
    while (x < midA || y < midB) {
      if (x < midA && y < midB && a[head + x] === b[head + y]) {
        flush();
        steps.push({ op: 'same', a: head + x++, b: head + y++ });
      } else if (y < midB && (x === midA || lengths[x * width + y + 1]! >= lengths[(x + 1) * width + y]!)) {
        pendingIns.push({ op: 'ins', b: head + y++ });
      } else {
        steps.push({ op: 'del', a: head + x++ });
      }
    }
    flush();
  }
  for (let k = 0; k < tail; k++) steps.push({ op: 'same', a: a.length - tail + k, b: b.length - tail + k });
  return steps;
}
