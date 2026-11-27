/**
 * What the printed exports (Word, PDF, the print page) read: the tabs to print and what their chips say, and the notes
 * on what stayed out. docx.ts and print.ts both write from this, so a doc says the same in both files.
 *
 * The notes are `{code, what, count}`, which the page's export flow turns into its "Exported without 1 image" and "1 item was simplified" messages.
 */
import { DocAnchors, githubSlug, type LinkTarget, uniqueSlugs } from './anchors.ts';
import { imageInfo } from './blobs.ts';
import { CONTENTS_PER_FILE, contentsGrouped, contentsOf, isContents } from './contents.ts';
import { type Atom, type Block, type Inline, isAtom, type Marks, sameMarks, walk } from './model.ts';

export type Paper = 'a4' | 'letter';
export type DocFont = 'serif' | 'sans' | 'mono';
/** The languages with their own fonts and line breaking in a printed file. */
export type DocLanguage = 'en' | 'zh' | 'ja' | 'ko';

export interface ExportNote {
  code: 'kept_as_text' | 'dropped';
  what: string;
  count: number;
}

export interface ExportSource {
  /** The file's title: the doc's name, with the tab's when one tab of several is printed. */
  title: string;
  rev: number;
  paper: Paper;
  tabs: ExportTab[];
  /** Where the links inside the doc land in the file (`linkAnchors`); none when the tabs' links were not looked at. */
  anchors?: ExportAnchors;
  /** Dropdown lists: their options' names. */
  enums: Record<string, string[]>;
  /** People, by principal. */
  names: Record<string, string>;
  /** An image's bytes, by its `blob/<id>`. */
  blob?: (ref: string) => Uint8Array | null;
  /** Tabs a chip can name (`file/<id>`). */
  refs: Record<string, string>;
  /** The doc's fonts (`display` in doc.json), as the page reads them: serif headings and sans text unless it says. */
  fonts: { headings: DocFont; text: DocFont };
  language: DocLanguage;
}

export interface ExportTab {
  /** Its file id, which a link to the tab names. */
  id?: string;
  name: string;
  blocks: Block[];
}

/** A place in the file a link inside the doc goes to. */
export interface Anchor {
  /** Its element's id in the print page; a link to it is `#<id>`. */
  id: string;
  /** Its bookmark in a Word file: hidden from Word's list of bookmarks by the `_`, as Word's own cross-references are. */
  bookmark: string;
}

export interface ExportAnchors {
  /** By the block a link goes to. */
  blocks: Map<string, Anchor>;
  /** By tab, in the order of `tabs`: where a link to the tab goes, its start. */
  tabs: (Anchor | undefined)[];
  /** By `id`, as the links now name them. */
  byId: Map<string, Anchor>;
  /** By a table of contents' block: the headings it lists, each with where it is in the file. */
  contents?: Map<string, FileContentsLine[]>;
}

export interface FileContentsLine {
  text: string;
  indent: number;
  /** Top lines of a table of contents with lines under them, drawn as the names of their groups. */
  group: boolean;
  anchor: Anchor | null;
}

/** Blocks a file holds nothing of: nowhere for a link to land. */
const PRINTS_NOTHING = new Set(['pending', 'embed']);

/**
 * The tabs again, with each link inside the doc (`#<block id>~<slug>`, `#<slug>`, `#<tab id>`, as the page writes and
 * follows them: anchors.ts) pointing at an anchor of the file, `#<anchor id>`; one to nothing the file holds loses its
 * link and keeps its words. A tab chip links to its tab when the file holds that tab.
 */
export function linkAnchors(tabs: ExportTab[]): { tabs: ExportTab[]; anchors: ExportAnchors } {
  const finder = new DocAnchors(tabs);
  const anchors: ExportAnchors = { blocks: new Map(), tabs: tabs.map(() => undefined), byId: new Map() };
  const unique = uniqueSlugs();
  // The heading's words where there are some, as a reader of the print page would guess its address.
  const make = (words: string, kind: string): Anchor => {
    const count = anchors.byId.size + 1;
    const anchor = { id: unique(githubSlug(words)) || unique(`${kind}-${count}`), bookmark: `_Link${count}` };
    anchors.byId.set(anchor.id, anchor);
    return anchor;
  };
  const anchorOf = (target: LinkTarget): Anchor | null => {
    if (!target.block) return (anchors.tabs[target.tab] ??= make(tabs[target.tab]!.name, 'tab'));
    if (PRINTS_NOTHING.has(target.block.type)) return null;
    let anchor = anchors.blocks.get(target.block.id);
    if (!anchor) {
      anchor = make(headingOf(target.block) ? plainText(target.block) : '', 'block');
      anchors.blocks.set(target.block.id, anchor);
    }
    return anchor;
  };
  const linked = tabs.map((tab, index) => {
    const blocks = structuredClone(tab.blocks);
    for (const { block } of walk(blocks)) {
      for (const item of block.inline ?? []) {
        const link = item.marks?.link;
        if (link?.startsWith('#')) {
          const target = finder.resolve(link, index);
          const anchor = target ? anchorOf(target) : null;
          if (anchor) item.marks = { ...item.marks, link: `#${anchor.id}` };
          else {
            const { link: _gone, ...rest } = item.marks!;
            if (Object.keys(rest).length) item.marks = rest;
            else delete item.marks;
          }
        } else if (link === undefined && isAtom(item) && item.atom === 'mention' && typeof item.attrs?.ref === 'string') {
          const target = finder.resolve(`#${item.attrs.ref}`, index);
          const anchor = target ? anchorOf(target) : null;
          if (anchor) item.marks = { ...(item.marks ?? {}), link: `#${anchor.id}` };
        }
      }
    }
    return { ...tab, blocks };
  });
  // A table of contents links to its tab's headings, so each of them gets a place in the file.
  const contents = new Map<string, FileContentsLine[]>();
  linked.forEach((tab, index) => {
    const tables = [...walk(tab.blocks)].filter(({ block }) => isContents(block)).slice(0, CONTENTS_PER_FILE - contents.size);
    if (!tables.length) return;
    const lines = contentsOf(tab.blocks);
    const grouped = contentsGrouped(lines);
    const drawn = lines.map(({ heading, indent }) => ({ text: plainText(heading.block), indent, group: grouped && indent === 0, anchor: anchorOf({ tab: index, block: heading.block }) }));
    for (const { block } of tables) contents.set(block.id, drawn);
  });
  return { tabs: linked, anchors: { ...anchors, contents } };
}

/** Where a link goes in a file: a web address, or an anchor of the file. Undefined: its words alone. */
export type LinkTo = { href: string } | { anchor: Anchor };

export function linkOf(href: string | undefined, source: ExportSource): LinkTo | undefined {
  if (href?.startsWith('#')) {
    const anchor = source.anchors?.byId.get(href.slice(1));
    return anchor ? { anchor } : undefined;
  }
  const safe = safeHref(href);
  return safe ? { href: safe } : undefined;
}

/** Why there is no file: `code` is what the page's messages go by. */
export class ExportRefusal extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class ExportNotes {
  private counts = new Map<string, ExportNote>();

  add(code: ExportNote['code'], what: string): void {
    const key = `${code} ${what}`;
    const note = this.counts.get(key);
    if (note) note.count++;
    else this.counts.set(key, { code, what, count: 1 });
  }

  list(): ExportNote[] {
    return [...this.counts.values()];
  }
}

/** Charts and drawings can't be made here (SKILL.md): the page's message counts them as left out. */
export const noteEmbed = (notes: ExportNotes) => notes.add('kept_as_text', 'embed snapshot (not drawn here)');
/** An image whose bytes aren't in the doc's folder. */
const noteImage = (notes: ExportNotes) => notes.add('kept_as_text', 'image (not available here)');
/** A section the agent has not written yet: nothing to print. */
export const notePending = (notes: ExportNotes) => notes.add('dropped', 'pending section');

/** A picture among the runs, with what the file needs to show it. */
export interface SegmentImage {
  bytes: Uint8Array;
  mime: string;
  alt: string;
  /** The size to show it at, in CSS pixels, when known. */
  width?: number;
  height?: number;
}

/** A run of text with one set of marks. A chip (date, mention, dropdown) is a run of its own, and so is a picture. */
export interface Segment {
  text: string;
  marks?: Marks;
  chip?: boolean;
  image?: SegmentImage;
}

/** As the page and the exports show a date chip: `Oct 31, 2026`. A bare date is that day wherever this runs. */
export function dateText(ts: unknown): string {
  const raw = String(ts ?? '').trim();
  if (!raw) return '';
  const value = new Date(/^\d+$/.test(raw) ? Number(raw) : raw);
  if (Number.isNaN(value.getTime())) return raw;
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', ...(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? { timeZone: 'UTC' } : {}) }).format(value);
}

function atomText(item: Atom, source: ExportSource): string {
  const attrs = item.attrs ?? {};
  switch (item.atom) {
    case 'hardBreak':
      return '\n';
    case 'date':
      return dateText(attrs.ts);
    case 'mention':
      if (attrs.ref) return String(source.refs[String(attrs.ref)] ?? attrs.label ?? attrs.ref);
      return `@${String(attrs.name ?? source.names[String(attrs.principal)] ?? attrs.label ?? attrs.principal ?? 'someone')}`;
    case 'dropdown': {
      const index = attrs.index === null || attrs.index === undefined ? -1 : Number(attrs.index);
      return index >= 0 ? (source.enums[String(attrs.enum)]?.[index] ?? '') : '';
    }
    case 'media':
      return String(attrs.alt ?? attrs.caption ?? '');
  }
}

function imageOf(item: Atom, source: ExportSource): SegmentImage | null {
  const attrs = item.attrs ?? {};
  const bytes = typeof attrs.blob === 'string' ? source.blob?.(attrs.blob) : null;
  const info = bytes ? imageInfo(bytes) : null;
  if (!bytes || !info) return null;
  const dims = attrs.dims as { w?: unknown; h?: unknown } | undefined;
  const width = Number(dims?.w ?? info.width);
  const height = Number(dims?.h ?? info.height);
  return { bytes, mime: info.mime, alt: String(attrs.alt ?? attrs.name ?? ''), ...(width > 0 && height > 0 ? { width, height } : {}) };
}

/** A text block's items as runs: its characters joined by marks, each chip as itself. */
export function segmentsOf(inline: Inline[], source: ExportSource, notes: ExportNotes): Segment[] {
  const out: Segment[] = [];
  for (const item of inline) {
    if (isAtom(item)) {
      if (item.atom === 'media') {
        const image = imageOf(item, source);
        if (image) {
          out.push({ text: '', image, ...(item.marks ? { marks: item.marks } : {}) });
          continue;
        }
        noteImage(notes);
      }
      const text = atomText(item, source);
      if (!text) continue;
      if (item.atom === 'hardBreak' || item.atom === 'media') appendText(out, text, item.marks);
      else out.push({ text, ...(item.marks ? { marks: item.marks } : {}), chip: true });
      continue;
    }
    appendText(out, item.ch, item.marks);
  }
  return out;
}

function appendText(out: Segment[], text: string, marks: Marks | undefined): void {
  const last = out[out.length - 1];
  if (last && !last.chip && sameMarks(last.marks, marks)) last.text += text;
  else out.push({ text, ...(marks ? { marks } : {}) });
}

/**
 * Only addresses a reader's program should follow from a file someone sent them, written as a valid URL: Word calls a
 * whole file corrupt over a link target it can't parse.
 */
export function safeHref(href: string | undefined): string | undefined {
  const value = href?.trim();
  if (!value || !/^(https?:|mailto:|tel:)/i.test(value)) return undefined;
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}

/** `#rrggbb` or `rrggbb` as `rrggbb`; undefined for anything else. */
export function hexColor(value: unknown): string | undefined {
  const match = typeof value === 'string' ? /^#?([0-9a-f]{6})$/i.exec(value.trim()) : null;
  return match ? match[1]!.toLowerCase() : undefined;
}

/** A highlight with no colour of its own. */
export const DEFAULT_HIGHLIGHT = 'fff2a8';

/** What the doc is written in, from its characters: kana, then hangul, then Han. */
export function languageOf(tabs: { blocks: Block[] }[]): DocLanguage {
  let han = false;
  let hangul = false;
  for (const tab of tabs) {
    for (const { block } of walk(tab.blocks)) {
      for (const item of block.inline ?? []) {
        if (isAtom(item)) continue;
        if (/[぀-ヿ]/.test(item.ch)) return 'ja';
        if (/[가-힯]/.test(item.ch)) hangul = true;
        else if (/[㐀-鿿豈-﫿]/.test(item.ch)) han = true;
      }
    }
  }
  return hangul ? 'ko' : han ? 'zh' : 'en';
}

/** Text XML 1.0 can hold: Word refuses a whole file over one control character. */
export function xmlSafe(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
}

export const escapeXml = (text: string) => xmlSafe(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export const escapeAttr = (text: string) => escapeXml(text).replaceAll('"', '&quot;');

/** A cell's width in px from its `colwidth` attr (a list per spanned column, a number, or those as text). */
export function columnWidths(value: unknown): number[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : typeof value === 'number' ? [value] : [];
  return list.map(Number).filter(width => Number.isFinite(width) && width > 0);
}

export const spanOf = (value: unknown) => {
  const span = Number(value);
  return Number.isInteger(span) && span > 1 ? Math.min(span, 1000) : 1;
};

export const headingOf = (block: Block) => {
  const level = Number(block.attrs?.heading);
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : 0;
};

/** The plain words of a text block, as a tab's first heading is compared with its name. */
export const plainText = (block: Block) => (block.inline ?? []).map(item => (isAtom(item) ? '' : item.ch)).join('').trim();

/** Whether a tab already opens with its own name, so a file of several tabs need not print it above. */
export const opensWithName = (tab: { name: string; blocks: Block[] }) => {
  const first = tab.blocks[0];
  return !!first && first.type === 'paragraph' && headingOf(first) > 0 && plainText(first) === tab.name.trim();
};
