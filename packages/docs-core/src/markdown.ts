/**
 * Markdown in (writes and births) and out (exports, reads in markdown form).
 *
 * In: CommonMark-ish blocks (ATX headings, paragraphs, bullet / ordered / task lists nested by indentation,
 * blockquotes, fenced code, rules, GFM pipe tables) and inline marks (**bold**, *italic*, ~~strike~~, `code`,
 * [links](url), <u>underline</u>, ==highlight==, <span data-text-color="red">a text colour</span>, a trailing
 * backslash or two spaces for a line break). A chip is a `<?oa block KEY?>` token whose definition is `chips[KEY]`: alone on its line a block chip (pending, an empty
 * paragraph, an embed), inside text an inline one (date, mention, dropdown, a link to a tab).
 */
import { BLOB_REF } from './blobs.ts';
import { type IdSource, textToInline } from './content.ts';
import { type Atom, type Block, type Inline, type Marks, isAtom, newBlock, textColorOf } from './model.ts';

export type Chip = Record<string, unknown> & { type: string };
export type Chips = Record<string, Chip>;

export class MarkdownError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const CHIP = /<\?oa\s+block\s+([A-Za-z0-9_$:.-]+)\s*\?>/;
const CHIP_LINE = /^\s*<\?oa\s+block\s+([A-Za-z0-9_$:.-]+)\s*\?>\s*$/;

export interface MarkdownContext {
  /** The person writing, for `{"type":"mention","user":"me"}`. */
  me?: { id: string; name?: string; email?: string };
  /** Chip keys → the id each chip got (the ack's `keys`). */
  keys?: Record<string, string>;
  /** A file from elsewhere (import-markdown.ts): entities, bare URLs and the common inline HTML are read as such. */
  lenient?: boolean;
  /** What `![alt](src)` shows, as a `media` atom's attrs; null leaves it a link. A `blob/<id>` needs none of this. */
  image?: (alt: string, src: string) => Record<string, unknown> | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', middot: '·', times: '×' };
const decodeEntities = (text: string) =>
  text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/gi, (whole, decimal?: string, hex?: string, name?: string) => {
    if (name) return ENTITIES[name] ?? whole;
    const code = decimal ? Number.parseInt(decimal, 10) : Number.parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
/** The inline HTML a markdown file is likely to hold, as its mark. */
const HTML_MARKS: Record<string, keyof Marks> = { b: 'bold', strong: 'bold', i: 'italic', em: 'italic', s: 'strike', del: 'strike', strike: 'strike', code: 'code' };
const BARE_URL = /^https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/;

// ---- blocks ----------------------------------------------------------------------------------------------------

interface Line {
  text: string;
  indent: number;
}

const expandTabs = (line: string) => line.replace(/^\t+/, tabs => '    '.repeat(tabs.length));
const indentOf = (line: string) => /^ */.exec(line)![0].length;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const FENCE = /^ *(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HR = /^ {0,3}([-*_])( *\1){2,} *$/;
const HEADING = /^ {0,3}(#{1,6})(?: +(.*?))?(?: +#+)? *$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const TABLE_SEP = /^ *\|? *:?-{1,}:? *(\| *:?-{1,}:? *)*\|? *$/;

export function parseMarkdown(markdown: string, ids: IdSource, chips: Chips = {}, context: MarkdownContext = {}): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n').map(expandTabs);
  return new BlockParser(ids, chips, context).blocks(lines.map(text => ({ text, indent: indentOf(text) })));
}

/** Markdown that must stay inline (a replace of chars, an insert inside a line): one paragraph's content. */
export function parseMarkdownInline(markdown: string, ids: IdSource, chips: Chips = {}, context: MarkdownContext = {}): Inline[] {
  const text = markdown.replace(/\r\n?/g, '\n').trim();
  if (/\n\s*\n/.test(text) || /^(#{1,6} |[-*+] |\d+[.)] |> |```|~~~|\|)/m.test(text))
    throw new MarkdownError('markdown_blocks', 'this place takes inline text; to write blocks, target a block (side before/after) or the root');
  return new InlineParser(ids, chips, context).parse(text);
}

class BlockParser {
  private ids: IdSource;
  private chips: Chips;
  private context: MarkdownContext;
  constructor(ids: IdSource, chips: Chips, context: MarkdownContext) {
    this.ids = ids;
    this.chips = chips;
    this.context = context;
  }

  private inline(text: string): Inline[] {
    return new InlineParser(this.ids, this.chips, this.context).parse(text);
  }

  private paragraph(text: string, attrs?: Record<string, unknown>): Block {
    const block = newBlock('paragraph', this.ids.take(), attrs);
    block.inline = this.inline(text);
    return block;
  }

  blocks(lines: Line[]): Block[] {
    const out: Block[] = [];
    let index = 0;
    const blank = (line: Line | undefined) => !line || line.text.trim() === '';
    while (index < lines.length) {
      const line = lines[index]!;
      const text = line.text;
      if (blank(line)) {
        index++;
        continue;
      }
      // A chip alone on its line.
      const chipLine = CHIP_LINE.exec(text);
      if (chipLine) {
        const chip = this.chip(chipLine[1]!);
        if (chip.kind === 'block') {
          out.push(chip.make());
          index++;
          continue;
        }
      }
      const fence = FENCE.exec(text);
      if (fence) {
        const marker = fence[1]!;
        const language = fence[2] || undefined;
        const body: string[] = [];
        index++;
        while (index < lines.length && !new RegExp(`^ *${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`).test(lines[index]!.text)) {
          body.push(lines[index]!.text.slice(Math.min(line.indent, lines[index]!.indent)));
          index++;
        }
        index++;
        const block = newBlock('codeBlock', this.ids.take(), language ? { language } : undefined);
        block.inline = textToInline(body.join('\n'), this.ids);
        out.push(block);
        continue;
      }
      if (HR.test(text)) {
        out.push(newBlock('horizontalRule', this.ids.take()));
        index++;
        continue;
      }
      const heading = HEADING.exec(text);
      if (heading) {
        out.push(this.paragraph(heading[2] ?? '', { heading: heading[1]!.length }));
        index++;
        continue;
      }
      if (QUOTE.test(text)) {
        const inner: Line[] = [];
        while (index < lines.length && !blank(lines[index]) && (QUOTE.test(lines[index]!.text) || inner.length)) {
          const quoted = QUOTE.exec(lines[index]!.text);
          if (!quoted && (LIST_ITEM.test(lines[index]!.text) || HEADING.test(lines[index]!.text) || FENCE.test(lines[index]!.text))) break;
          const body = quoted ? quoted[1]! : lines[index]!.text;
          inner.push({ text: body, indent: indentOf(body) });
          index++;
        }
        const quote = newBlock('blockquote', this.ids.take());
        quote.children = this.blocks(inner);
        if (!quote.children.length) quote.children.push(newBlock('paragraph', this.ids.take()));
        out.push(quote);
        continue;
      }
      if (text.includes('|') && index + 1 < lines.length && TABLE_SEP.test(lines[index + 1]!.text) && lines[index + 1]!.text.includes('-')) {
        const rows: string[][] = [splitRow(text)];
        const aligns = splitRow(lines[index + 1]!.text).map(cell => (/^:-+:$/.test(cell) ? 'center' : /^-+:$/.test(cell) ? 'right' : undefined));
        index += 2;
        while (index < lines.length && !blank(lines[index]) && lines[index]!.text.includes('|')) {
          rows.push(splitRow(lines[index]!.text));
          index++;
        }
        out.push(this.table(rows, aligns));
        continue;
      }
      const item = LIST_ITEM.exec(text);
      if (item) {
        const consumed = this.list(lines, index, out);
        index = consumed;
        continue;
      }
      // A paragraph: lines until a blank line or another block starts.
      const body: string[] = [text.trim()];
      index++;
      while (index < lines.length) {
        const next = lines[index]!;
        if (blank(next) || FENCE.test(next.text) || HR.test(next.text) || HEADING.test(next.text) || QUOTE.test(next.text) || LIST_ITEM.test(next.text) || CHIP_LINE.test(next.text)) break;
        body.push(next.text.replace(/^ +/, ''));
        index++;
      }
      out.push(this.paragraph(joinLines(body)));
    }
    return out;
  }

  private list(lines: Line[], start: number, out: Block[]): number {
    const first = LIST_ITEM.exec(lines[start]!.text)!;
    const baseIndent = first[1]!.length;
    const ordered = /\d/.test(first[2]!);
    const task = /^\[[ xX]\]( |$)/.test(first[4] ?? '');
    const kind = task ? 'check' : ordered ? 'ordered' : 'bullet';
    const startNumber = ordered ? Number.parseInt(first[2]!, 10) : 1;
    const list = newBlock('list', this.ids.take(), { kind, ...(ordered && startNumber !== 1 ? { start: startNumber } : {}) });
    let index = start;
    while (index < lines.length) {
      const match = LIST_ITEM.exec(lines[index]!.text);
      if (!match || match[1]!.length !== baseIndent) break;
      const sameKind = /\d/.test(match[2]!) === ordered;
      if (!sameKind) break;
      let content = match[4] ?? '';
      const contentIndent = match[1]!.length + match[2]!.length + Math.max(1, Math.min(match[3]!.length, 4));
      let checked: boolean | undefined;
      const box = /^\[([ xX])\](?: +|$)(.*)$/.exec(content);
      if (kind === 'check' && box) {
        checked = box[1] !== ' ';
        content = box[2] ?? '';
      }
      const itemLines: Line[] = [{ text: content, indent: 0 }];
      index++;
      // Continuation: indented lines (nested lists, more paragraphs), and lazy lines of the first paragraph.
      let sawBlank = false;
      while (index < lines.length) {
        const next = lines[index]!;
        if (next.text.trim() === '') {
          sawBlank = true;
          itemLines.push({ text: '', indent: 0 });
          index++;
          continue;
        }
        const nested = next.indent >= Math.min(contentIndent, baseIndent + 2);
        if (nested) {
          const body = next.text.slice(Math.min(next.indent, contentIndent));
          itemLines.push({ text: body, indent: indentOf(body) });
          sawBlank = false;
          index++;
          continue;
        }
        if (!sawBlank && !LIST_ITEM.test(next.text) && !HEADING.test(next.text) && !FENCE.test(next.text) && !QUOTE.test(next.text) && !HR.test(next.text) && !CHIP_LINE.test(next.text)) {
          itemLines.push({ text: next.text.trim(), indent: 0 });
          index++;
          continue;
        }
        break;
      }
      while (itemLines.length && itemLines[itemLines.length - 1]!.text === '') itemLines.pop();
      const listItem = newBlock('listItem', this.ids.take(), kind === 'check' ? { checked: !!checked } : undefined);
      listItem.children = this.blocks(itemLines);
      // An item starts with a paragraph (the schema): an empty one above an item that opens with a code fence or a quote.
      if (listItem.children[0]?.type !== 'paragraph') listItem.children.unshift(newBlock('paragraph', this.ids.take()));
      list.children!.push(listItem);
      // A blank line followed by something that is not an item of this list ends it.
      if (index < lines.length && lines[index]!.text.trim() === '') {
        let peek = index;
        while (peek < lines.length && lines[peek]!.text.trim() === '') peek++;
        const again = peek < lines.length ? LIST_ITEM.exec(lines[peek]!.text) : null;
        if (again && again[1]!.length === baseIndent && /\d/.test(again[2]!) === ordered) index = peek;
      }
    }
    out.push(list);
    return index;
  }

  private table(rows: string[][], aligns: Array<string | undefined>): Block {
    const table = newBlock('table', this.ids.take());
    const width = Math.max(...rows.map(row => row.length));
    rows.forEach((cells, rowIndex) => {
      const row = newBlock('tableRow', this.ids.take());
      for (let col = 0; col < width; col++) {
        const attrs: Record<string, unknown> = {};
        if (rowIndex === 0) attrs.header = true;
        if (aligns[col]) attrs.align = aligns[col];
        const cell = newBlock('cell', this.ids.take(), attrs);
        cell.children = [this.paragraph(cells[col] ?? '')];
        row.children!.push(cell);
      }
      table.children!.push(row);
    });
    return table;
  }

  private chip(key: string): { kind: 'block'; make: () => Block } | { kind: 'inline' } {
    const chip = this.chips[key];
    if (!chip) throw new MarkdownError('chip_unknown', `<?oa block ${key}?> has no entry in blocks`);
    switch (chip.type) {
      case 'pending':
        return {
          kind: 'block',
          make: () => {
            const block = newBlock('pending', this.ids.take(), { intent: String(chip.intent ?? '') });
            this.context.keys && (this.context.keys[key] = block.id);
            return block;
          },
        };
      case 'paragraph':
        return {
          kind: 'block',
          make: () => {
            const block = newBlock('paragraph', this.ids.take());
            this.context.keys && (this.context.keys[key] = block.id);
            return block;
          },
        };
      case 'embed':
        return {
          kind: 'block',
          make: () => {
            const { type: _type, ...rest } = chip;
            const block = newBlock('embed', this.ids.take(), rest);
            this.context.keys && (this.context.keys[key] = block.id);
            return block;
          },
        };
      default:
        return { kind: 'inline' };
    }
  }
}

function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  let code = false;
  for (let index = 0; index < text.length; index++) {
    const ch = text[index]!;
    if (ch === '\\' && text[index + 1] === '|') {
      current += '|';
      index++;
      continue;
    }
    if (ch === '`') code = !code;
    if (ch === '|' && !code) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/** Paragraph lines: a soft break is a space; a trailing backslash or two spaces is a hard break (kept as "\n"). */
function joinLines(lines: string[]): string {
  let out = '';
  lines.forEach((line, index) => {
    const last = index === lines.length - 1;
    if (!last && /(\\| {2,})$/.test(line)) out += line.replace(/(\\| {2,})$/, '') + '\n';
    else out += line.trimEnd() + (last ? '' : ' ');
  });
  return out;
}

// ---- inline ----------------------------------------------------------------------------------------------------

class InlineParser {
  private ids: IdSource;
  private chips: Chips;
  private context: MarkdownContext;
  private out: Inline[] = [];
  constructor(ids: IdSource, chips: Chips, context: MarkdownContext) {
    this.ids = ids;
    this.chips = chips;
    this.context = context;
  }

  parse(text: string): Inline[] {
    this.run(text, undefined);
    return this.out;
  }

  private text(text: string, marks: Marks | undefined): void {
    if (!text) return;
    const parts = text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) this.out.push({ id: this.ids.take(), atom: 'hardBreak', ...(marks ? { marks: { ...marks } } : {}) });
      this.out.push(...textToInline(part, this.ids, marks));
    });
  }

  private run(text: string, marks: Marks | undefined): void {
    let plain = '';
    let index = 0;
    const flush = () => {
      this.text(this.context.lenient && !marks?.code ? decodeEntities(plain) : plain, marks);
      plain = '';
    };
    while (index < text.length) {
      const ch = text[index]!;
      const rest = text.slice(index);
      if (this.context.lenient && !marks?.link && (ch === 'h' || ch === 'H') && !/[A-Za-z0-9]/.test(text[index - 1] ?? '')) {
        const url = BARE_URL.exec(rest)?.[0].replace(/[.,;:!?)\]'*_~]+$/, '');
        if (url) {
          flush();
          this.text(url, { ...(marks ?? {}), link: url });
          index += url.length;
          continue;
        }
      }
      if (ch === '\\' && index + 1 < text.length && /[\\`*_{}[\]()#+\-.!|~<>=]/.test(text[index + 1]!)) {
        plain += text[index + 1];
        index += 2;
        continue;
      }
      const chip = CHIP.exec(rest);
      if (chip && chip.index === 0) {
        flush();
        this.chip(chip[1]!, marks);
        index += chip[0].length;
        continue;
      }
      if (ch === '`') {
        const ticks = /^`+/.exec(rest)![0];
        const close = text.indexOf(ticks, index + ticks.length);
        if (close > 0) {
          flush();
          let code = text.slice(index + ticks.length, close);
          if (/^ .* $/.test(code)) code = code.slice(1, -1);
          this.text(code, { ...(marks ?? {}), code: true });
          index = close + ticks.length;
          continue;
        }
      }
      if (ch === '[' || (ch === '!' && text[index + 1] === '[')) {
        const link = parseLink(text, ch === '!' ? index + 1 : index);
        if (link) {
          flush();
          const attrs = ch === '!' ? this.imageAttrs(link.label, link.href) : null;
          if (attrs) this.out.push({ id: this.ids.take(), atom: 'media', attrs, ...(marks ? { marks: { ...marks } } : {}) });
          // A picture nothing can be shown for keeps what it said and where it was.
          else this.run(link.label || (ch === '!' ? link.href : ''), { ...(marks ?? {}), link: link.href });
          index = link.end;
          continue;
        }
      }
      if (ch === '<') {
        if (this.context.lenient) {
          const br = /^<br\s*\/?>/i.exec(rest);
          if (br) {
            flush();
            this.out.push({ id: this.ids.take(), atom: 'hardBreak', ...(marks ? { marks: { ...marks } } : {}) });
            index += br[0].length;
            continue;
          }
          const tag = /^<(b|strong|i|em|s|del|strike|code)>([\s\S]*?)<\/\1>/i.exec(rest);
          if (tag) {
            flush();
            this.run(tag[2]!, { ...(marks ?? {}), [HTML_MARKS[tag[1]!.toLowerCase()]!]: true });
            index += tag[0].length;
            continue;
          }
          const anchor = /^<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(rest);
          if (anchor) {
            flush();
            this.run(anchor[2]!, { ...(marks ?? {}), link: anchor[1]! });
            index += anchor[0].length;
            continue;
          }
        }
        const auto = /^<((?:https?|mailto):[^\s>]+)>/.exec(rest);
        if (auto) {
          flush();
          this.text(auto[1]!, { ...(marks ?? {}), link: auto[1]! });
          index += auto[0].length;
          continue;
        }
        const u = /^<u>([\s\S]*?)<\/u>/.exec(rest);
        if (u) {
          flush();
          this.run(u[1]!, { ...(marks ?? {}), underline: true });
          index += u[0].length;
          continue;
        }
        // A text colour, spelled as the page copies it: <span data-text-color="red">…</span>.
        const span = /^<span\s+data-text-color=(["']?)([A-Za-z]+)\1\s*>([\s\S]*?)<\/span>/.exec(rest);
        const color = span && textColorOf(span[2]);
        if (span && color) {
          flush();
          this.run(span[3]!, { ...(marks ?? {}), textColor: color });
          index += span[0].length;
          continue;
        }
      }
      const delimiter = /^(\*\*|__|~~|==|\*|_)/.exec(rest)?.[1];
      if (delimiter) {
        const close = findClose(text, index, delimiter);
        if (close > 0) {
          flush();
          const inner = text.slice(index + delimiter.length, close);
          const name = delimiter === '**' || delimiter === '__' ? 'bold' : delimiter === '~~' ? 'strike' : delimiter === '==' ? 'highlight' : 'italic';
          this.run(inner, { ...(marks ?? {}), ...(name === 'highlight' ? { highlight: '' } : { [name]: true }) });
          index = close + delimiter.length;
          continue;
        }
      }
      plain += ch;
      index++;
    }
    flush();
  }

  /** The attrs of the `media` atom `![alt](src)` makes: the doc's own image by its `blob/<id>`, or what the reader makes of it. */
  private imageAttrs(alt: string, src: string): Record<string, unknown> | null {
    if (BLOB_REF.test(src)) return { blob: src, ...(alt ? { alt } : {}) };
    return this.context.image?.(alt, src) ?? null;
  }

  private chip(key: string, marks: Marks | undefined): void {
    const chip = this.chips[key];
    if (!chip) throw new MarkdownError('chip_unknown', `<?oa block ${key}?> has no entry in blocks`);
    const id = this.ids.take();
    let atom: Atom;
    switch (chip.type) {
      case 'date':
        atom = { id, atom: 'date', attrs: { ts: String(chip.value ?? chip.ts ?? '') } };
        break;
      case 'mention': {
        if (typeof chip.ref === 'string') atom = { id, atom: 'mention', attrs: { principal: null, ref: chip.ref } };
        else {
          const me = chip.user === 'me' || chip.user === undefined ? this.context.me : undefined;
          const principal = me ? me.id : String(chip.user ?? chip.principal ?? '');
          atom = { id, atom: 'mention', attrs: { principal, ...(me?.name ? { name: me.name } : {}), ...(me?.email ? { email: me.email } : {}) } };
        }
        break;
      }
      case 'dropdown':
        atom = { id, atom: 'dropdown', attrs: { enum: String(chip.enum ?? ''), index: chip.index ?? null } };
        break;
      default:
        throw new MarkdownError('chip_place', `<?oa block ${key}?> is a ${chip.type} block: put it alone on its line`);
    }
    if (marks) atom.marks = { ...marks };
    this.out.push(atom);
    if (this.context.keys) this.context.keys[key] = id;
  }
}

function parseLink(text: string, open: number): { label: string; href: string; end: number } | null {
  let depth = 0;
  let close = -1;
  for (let index = open; index < text.length; index++) {
    const ch = text[index];
    if (ch === '\\') {
      index++;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0 || text[close + 1] !== '(') return null;
  let depthParen = 0;
  for (let index = close + 1; index < text.length; index++) {
    const ch = text[index];
    if (ch === '(') depthParen++;
    else if (ch === ')') {
      depthParen--;
      if (depthParen === 0) {
        const target = text.slice(close + 2, index).trim();
        const href = /^<(.*)>$/.exec(target)?.[1] ?? target.split(/\s+/)[0] ?? '';
        return { label: text.slice(open + 1, close), href, end: index + 1 };
      }
    }
  }
  return null;
}

/** The closing delimiter: same run, not right after whitespace, and (for * and _) not inside a word for _. */
function findClose(text: string, open: number, delimiter: string): number {
  const after = text[open + delimiter.length];
  if (after === undefined || /\s/.test(after)) return -1;
  if (delimiter === '_' || delimiter === '__') {
    const before = text[open - 1];
    if (before && /\w/.test(before)) return -1;
  }
  let index = open + delimiter.length + 1;
  while (index <= text.length - delimiter.length) {
    if (text[index] === '`') {
      const close = text.indexOf('`', index + 1);
      if (close > 0) {
        index = close + 1;
        continue;
      }
    }
    if (text[index] === '\\') {
      index += 2;
      continue;
    }
    if (text.startsWith(delimiter, index) && !/\s/.test(text[index - 1]!)) {
      // ** inside a * run: skip doubled delimiters for single ones.
      if (delimiter.length === 1 && text[index + 1] === delimiter) {
        index += 2;
        continue;
      }
      if ((delimiter === '_' || delimiter === '__') && /\w/.test(text[index + delimiter.length] ?? '')) {
        index++;
        continue;
      }
      return index;
    }
    index++;
  }
  return -1;
}

// ---- out -------------------------------------------------------------------------------------------------------

export interface ExportContext {
  /** Enum id → option names, for dropdown chips. */
  enums?: Record<string, string[]>;
  /** Principal → display name, for mentions. */
  names?: Record<string, string>;
  /** Link ref (`file/<tab id>`) → the text it shows, for links to tabs. */
  refs?: Record<string, string>;
  /**
   * For a file: where a link inside the doc (`#…`, a tab chip too) goes in it, as `#<a heading's name there>`, or null to
   * leave its words unlinked. Without it, as an agent reads the tab: the links as the doc holds them.
   */
  fragment?: (href: string) => string | null;
}

const escapeMarkdown = (text: string) => text.replace(/([\\`*_[\]<>|~=])/g, '\\$1');

function inlineToMarkdown(inline: Inline[], context: ExportContext, code = false): string {
  if (code) return inline.map(item => (isAtom(item) ? (item.atom === 'hardBreak' ? '\n' : '') : item.ch)).join('');
  let out = '';
  let index = 0;
  while (index < inline.length) {
    const item = inline[index]!;
    if (isAtom(item)) {
      out += atomToMarkdown(item, context);
      index++;
      continue;
    }
    let end = index + 1;
    while (end < inline.length && !isAtom(inline[end]!) && JSON.stringify(inline[end]!.marks ?? null) === JSON.stringify(item.marks ?? null)) end++;
    const text = inline
      .slice(index, end)
      .map(entry => (entry as { ch: string }).ch)
      .join('');
    out += wrapMarks(item.marks?.code ? '`' + text + '`' : escapeMarkdown(text), item.marks, context);
    index = end;
  }
  return out;
}

function wrapMarks(text: string, marks: Marks | undefined, context: ExportContext): string {
  if (!marks) return text;
  let out = text;
  const lead = /^\s*/.exec(out)![0];
  const trail = /\s*$/.exec(out)![0];
  out = out.trim();
  if (!out) return text;
  if (marks.underline) out = `<u>${out}</u>`;
  const color = textColorOf(marks.textColor);
  if (color) out = `<span data-text-color="${color}">${out}</span>`;
  if (marks.highlight !== undefined) out = `==${out}==`;
  if (marks.strike) out = `~~${out}~~`;
  if (marks.italic) out = `*${out}*`;
  if (marks.bold) out = `**${out}**`;
  const href = marks.link !== undefined && marks.link.startsWith('#') && context.fragment ? context.fragment(marks.link) : marks.link;
  if (href !== undefined && href !== null) out = `[${out}](${href})`;
  return lead + out + trail;
}

function atomToMarkdown(item: Atom, context: ExportContext): string {
  const attrs = item.attrs ?? {};
  switch (item.atom) {
    case 'hardBreak':
      return '\\\n';
    case 'date':
      return String(attrs.ts ?? '');
    case 'mention':
      if (attrs.ref) {
        const label = escapeMarkdown(String(context.refs?.[String(attrs.ref)] ?? attrs.label ?? attrs.ref));
        const href = context.fragment ? context.fragment(`#${String(attrs.ref)}`) : `#${String(attrs.ref)}`;
        return href ? `[${label}](${href})` : label;
      }
      return '@' + String(attrs.name ?? context.names?.[String(attrs.principal)] ?? attrs.label ?? attrs.principal ?? 'someone');
    case 'dropdown': {
      const options = context.enums?.[String(attrs.enum)];
      const index = attrs.index === null || attrs.index === undefined ? -1 : Number(attrs.index);
      return options && index >= 0 ? (options[index] ?? '') : '';
    }
    case 'media':
      return `![${String(attrs.alt ?? '')}](${String(attrs.blob ?? (typeof attrs.src === 'string' ? attrs.src : attrs.url) ?? '')})`;
  }
}

/** The words a heading shows once the file is read: its text and what its chips say. GitHub names it by these. */
export function shownWords(inline: Inline[], context: ExportContext): string {
  return inline
    .map(item => {
      if (!isAtom(item)) return item.ch;
      const attrs = item.attrs ?? {};
      switch (item.atom) {
        case 'date':
          return String(attrs.ts ?? '');
        case 'mention':
          return attrs.ref ? String(context.refs?.[String(attrs.ref)] ?? attrs.label ?? attrs.ref) : atomToMarkdown(item, context);
        case 'dropdown':
          return atomToMarkdown(item, context);
        default:
          return '';
      }
    })
    .join('')
    .trim();
}

export function blocksToMarkdown(blocks: Block[], context: ExportContext = {}): string {
  return blocks
    .map(block => blockToMarkdown(block, context))
    .filter(text => text !== null)
    .join('\n\n');
}

function blockToMarkdown(block: Block, context: ExportContext): string {
  const attrs = block.attrs ?? {};
  switch (block.type) {
    case 'paragraph': {
      const text = inlineToMarkdown(block.inline ?? [], context);
      return attrs.heading ? `${'#'.repeat(Number(attrs.heading))} ${text}` : text;
    }
    case 'codeBlock': {
      const text = inlineToMarkdown(block.inline ?? [], context, true);
      const fence = text.includes('```') ? '~~~' : '```';
      return `${fence}${String(attrs.language ?? '')}\n${text}\n${fence}`;
    }
    case 'horizontalRule':
      return '---';
    case 'pending':
      return `<!-- pending: ${String(attrs.intent ?? '')} -->`;
    case 'embed':
      return `<!-- embed ${String(attrs.ref ?? '')} -->`;
    case 'blockquote':
      return blocksToMarkdown(block.children ?? [], context)
        .split('\n')
        .map(line => (line ? `> ${line}` : '>'))
        .join('\n');
    case 'list': {
      const kind = attrs.kind;
      let number = Number(attrs.start ?? 1);
      return (block.children ?? [])
        .map(item => {
          const marker = kind === 'ordered' ? `${number++}.` : kind === 'check' ? `- [${item.attrs?.checked ? 'x' : ' '}]` : '-';
          const body = blocksToMarkdown(item.children ?? [], context);
          const pad = ' '.repeat(kind === 'ordered' ? marker.length + 1 : 2);
          return body
            .split('\n')
            .map((line, index) => (index === 0 ? `${marker} ${line}` : line ? pad + line : ''))
            .join('\n');
        })
        .join('\n');
    }
    case 'table': {
      const rows = (block.children ?? []).map(row => (row.children ?? []).map(cell => blocksToMarkdown(cell.children ?? [], context).replace(/\n+/g, ' ').replace(/\|/g, '\\|')));
      if (!rows.length) return '';
      const width = Math.max(...rows.map(row => row.length));
      const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, index) => cells[index] ?? '').join(' | ')} |`;
      const aligns = (block.children?.[0]?.children ?? []).map(cell => (cell.attrs?.align === 'center' ? ':---:' : cell.attrs?.align === 'right' ? '---:' : '---'));
      return [line(rows[0]!), line(Array.from({ length: width }, (_, index) => aligns[index] ?? '---')), ...rows.slice(1).map(line)].join('\n');
    }
    default:
      return blocksToMarkdown(block.children ?? [], context);
  }
}
