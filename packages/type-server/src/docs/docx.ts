/**
 * A doc as a Word file (.docx), written by hand. The package and its styles are the usual ones (Calibri 11, Heading1-6,
 * ListParagraph with a numbering instance per list, Code as one shaded paragraph, TableGrid with a fixed layout and a
 * repeating header row), with A4 where the viewer's region uses it, an East Asian font for the doc's language,
 * settings.xml so that Word doesn't open it in Compatibility Mode, and light table lines.
 *
 * Word is strict about element order inside pPr, rPr, tblPr and tcPr, and about characters XML can't hold: the writers
 * here keep the schema's order and `escapeXml` drops the rest.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type Anchor,
  type Block,
  columnWidths,
  DEFAULT_HIGHLIGHT,
  type DocFont,
  type DocLanguage,
  escapeAttr,
  escapeXml,
  type ExportNote,
  ExportNotes,
  type ExportSource,
  headingOf,
  hexColor,
  type Inline,
  isContents,
  linkOf,
  type LinkTo,
  noteEmbed,
  notePending,
  opensWithName,
  type Paper,
  type Segment,
  type SegmentImage,
  segmentsOf,
  spanOf,
  TEXT_COLORS,
  textColorOf,
} from '@open-artifact/docs-core';
import { writeZip } from '../archive.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Page sizes in twentieths of a point; margins of an inch, as Word's default. */
const PAGE: Record<Paper, { w: number; h: number }> = { a4: { w: 11906, h: 16838 }, letter: { w: 12240, h: 15840 } };
const MARGIN = 1440;
const EMU_PER_TWIP = 635;
const EMU_PER_PIXEL = 9525;
const IMAGE_EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif' };
/** One list or quote level's indent, a list marker's hanging indent, and a cell's left and right padding together. */
const INDENT = 720;
const HANGING = 360;
const CELL_PADDING = 216;
const MAX_LEVEL = 8;

const LATIN: Record<DocFont, string> = { sans: 'Calibri', serif: 'Cambria', mono: 'Consolas' };
const EAST_ASIAN: Record<Exclude<DocLanguage, 'en'>, { sans: string; serif: string }> = {
  zh: { sans: 'Microsoft YaHei', serif: 'SimSun' },
  ja: { sans: 'Yu Gothic', serif: 'Yu Mincho' },
  ko: { sans: 'Malgun Gothic', serif: 'Batang' },
};
const LANG_TAG: Record<Exclude<DocLanguage, 'en'>, string> = { zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR' };

const fontsXml = (latin: string, eastAsia: string) => `<w:rFonts w:ascii="${latin}" w:hAnsi="${latin}" w:eastAsia="${eastAsia}" w:cs="${latin}"/>`;

/** Where a block stands: how far in, in what. */
interface Place {
  /** The width it has, in twips. */
  width: number;
  /** Its indent from quotes, and from the list items a quote sits in. */
  left: number;
  /** The level of the list it is in; -1 outside lists. */
  level: number;
  quote: number;
  /** In a table cell: tighter paragraphs, and the cell's alignment. */
  cell: boolean;
  align?: string;
}

const contentLeft = (place: Place) => place.left + (place.level >= 0 ? INDENT * (place.level + 1) : 0);

interface ParagraphProps {
  style?: string;
  pageBreak?: boolean;
  num?: { id: number; level: number };
  /** pBdr: a horizontal rule's line. */
  border?: string;
  spacing?: string;
  ind?: string;
  jc?: string;
}

/** pPr, in the schema's order. */
function paragraphProps(props: ParagraphProps): string {
  const parts = [
    props.style ? `<w:pStyle w:val="${props.style}"/>` : '',
    props.pageBreak ? '<w:pageBreakBefore/>' : '',
    props.num ? `<w:numPr><w:ilvl w:val="${props.num.level}"/><w:numId w:val="${props.num.id}"/></w:numPr>` : '',
    props.border ?? '',
    props.spacing ?? '',
    props.ind ?? '',
    props.jc ? `<w:jc w:val="${props.jc}"/>` : '',
  ].join('');
  return parts ? `<w:pPr>${parts}</w:pPr>` : '';
}

const CELL_SPACING = '<w:spacing w:before="40" w:after="40"/>';
const JC: Record<string, string> = { center: 'center', right: 'right' };

/** Tabs and line breaks are elements of their own inside a run. */
function textXml(text: string): string {
  return text
    .split(/(\t|\n)/)
    .map(part => (part === '\t' ? '<w:tab/>' : part === '\n' ? '<w:br/>' : part ? `<w:t xml:space="preserve">${escapeXml(part)}</w:t>` : ''))
    .join('');
}

function runXml(segment: Segment, linked: boolean): string {
  const marks = segment.marks ?? {};
  const highlight = marks.highlight === undefined ? undefined : (hexColor(marks.highlight) ?? DEFAULT_HIGHLIGHT);
  // A link keeps the link's colour, as on the page.
  const color = linked ? undefined : TEXT_COLORS[textColorOf(marks.textColor) ?? ''];
  const props = [
    marks.code ? '<w:rStyle w:val="CodeChar"/>' : linked ? '<w:rStyle w:val="Hyperlink"/>' : '',
    marks.bold ? '<w:b/><w:bCs/>' : '',
    marks.italic ? '<w:i/><w:iCs/>' : '',
    marks.strike ? '<w:strike/>' : '',
    // Code keeps its own style, so a link in code takes the link's look directly; the Hyperlink style underlines already.
    marks.code && linked ? '<w:color w:val="0563C1"/>' : color ? `<w:color w:val="${color.toUpperCase()}"/>` : '',
    (marks.code && linked) || (marks.underline && !linked) ? '<w:u w:val="single"/>' : '',
    highlight ? `<w:shd w:val="clear" w:color="auto" w:fill="${highlight.toUpperCase()}"/>` : '',
  ].join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${textXml(segment.text)}</w:r>`;
}

class DocumentWriter {
  /** External links, in order: rId4 and on (the first three are the styles, the numbering and the settings). */
  private links = new Map<string, string>();
  private images: { id: string; path: string; bytes: Uint8Array }[] = [];
  private nums: string[] = [];
  private checkNums: { open: number; done: number } | null = null;
  /** The next paragraph starts a new page (a tab of several that opens with its own name). */
  private breakNext = false;
  /** Places links inside the doc go to, waiting for the next paragraph: the first of their block, or of their tab. */
  private marked: Anchor[] = [];
  private bookmarkCount = 0;

  private source: ExportSource;
  private notes: ExportNotes;

  constructor(source: ExportSource, notes: ExportNotes) {
    this.source = source;
    this.notes = notes;
  }

  body(): string {
    const { w } = PAGE[this.source.paper];
    const width = w - 2 * MARGIN;
    const place: Place = { width, left: 0, level: -1, quote: 0, cell: false };
    const several = this.source.tabs.length > 1;
    return this.source.tabs
      .map((tab, index) => {
        this.mark(this.source.anchors?.tabs[index]);
        const title = several && !opensWithName(tab) ? `<w:p>${paragraphProps({ style: 'Title', pageBreak: index > 0 })}${this.bookmarks()}${runXml({ text: tab.name }, false)}</w:p>` : '';
        if (several && !title && index > 0) this.breakNext = true;
        return title + this.blocks(tab.blocks, place);
      })
      .join('');
  }

  relationships(): string {
    const fixed = [
      ['rId1', 'styles', 'styles.xml'],
      ['rId2', 'numbering', 'numbering.xml'],
      ['rId3', 'settings', 'settings.xml'],
    ].map(([id, type, target]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`);
    const links = [...this.links].map(([href, id]) => `<Relationship Id="${id}" Type="${R}/hyperlink" Target="${escapeAttr(href)}" TargetMode="External"/>`);
    const images = this.images.map(image => `<Relationship Id="${image.id}" Type="${R}/image" Target="${image.path}"/>`);
    return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[...fixed, ...links, ...images].join('')}</Relationships>`;
  }

  numbering(): string {
    return `${XML}<w:numbering xmlns:w="${W}">${abstractNums()}${this.nums.join('')}</w:numbering>`;
  }

  private blocks(blocks: Block[], place: Place): string {
    return blocks.map(block => this.block(block, place)).join('');
  }

  /** A place a link goes to, for the next paragraph to hold. */
  private mark(anchor: Anchor | undefined): void {
    if (anchor) this.marked.push(anchor);
  }

  /** The bookmarks waiting, for a paragraph to hold just after its properties. */
  private bookmarks(): string {
    const xml = this.marked
      .map(anchor => {
        const id = this.bookmarkCount++;
        return `<w:bookmarkStart w:id="${id}" w:name="${anchor.bookmark}"/><w:bookmarkEnd w:id="${id}"/>`;
      })
      .join('');
    this.marked = [];
    return xml;
  }

  private block(block: Block, place: Place): string {
    this.mark(this.source.anchors?.blocks.get(block.id));
    switch (block.type) {
      case 'paragraph':
        return this.paragraph(block, place);
      case 'codeBlock':
        return isContents(block) ? this.contents(block, place) : this.code(block, place);
      case 'horizontalRule':
        return `<w:p>${paragraphProps({ ...this.takeBreak(), border: '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr>', ind: this.plainIndent(place) })}${this.bookmarks()}</w:p>`;
      case 'pending':
        notePending(this.notes);
        return '';
      case 'embed':
        noteEmbed(this.notes);
        return '';
      case 'blockquote':
        return this.blocks(block.children ?? [], { ...place, left: contentLeft(place) + INDENT, level: -1, quote: place.quote + 1 });
      case 'list':
        return this.list(block, place);
      case 'table':
        return this.table(block, place);
      default:
        return this.blocks(block.children ?? [], place);
    }
  }

  private takeBreak(): { pageBreak?: boolean } {
    if (!this.breakNext) return {};
    this.breakNext = false;
    return { pageBreak: true };
  }

  /** A block's indent as a paragraph's `ind`; none when it stands at the margin or at what its style already has. */
  private plainIndent(place: Place, styled = 0): string | undefined {
    const left = contentLeft(place);
    return left === styled ? undefined : `<w:ind w:left="${left}"/>`;
  }

  private paragraph(block: Block, place: Place, num?: { id: number; level: number }): string {
    const heading = headingOf(block);
    // Only a quote's own paragraphs carry its line: a hanging indent would draw it away from theirs, even off the page.
    const style = heading ? `Heading${heading}` : num ? 'ListParagraph' : place.quote > 0 ? 'Quote' : place.level >= 0 ? 'ListParagraph' : undefined;
    const styled = style === 'Quote' ? INDENT : style === 'ListParagraph' ? INDENT : 0;
    let ind: string | undefined;
    // A numbered paragraph's indent comes from its level; a list in a quote or a cell's list takes that much further in.
    if (num) ind = place.left > 0 ? `<w:ind w:left="${place.left + INDENT * (num.level + 1)}" w:hanging="${HANGING}"/>` : undefined;
    else ind = this.plainIndent(place, styled);
    return `<w:p>${paragraphProps({
      ...(style ? { style } : {}),
      ...this.takeBreak(),
      ...(num ? { num } : {}),
      ...(place.cell ? { spacing: CELL_SPACING } : {}),
      ...(ind ? { ind } : {}),
      ...(place.align && JC[place.align] ? { jc: JC[place.align]! } : {}),
    })}${this.bookmarks()}${this.runs(block.inline ?? [])}</w:p>`;
  }

  /**
   * Runs, with those under one link inside one hyperlink element. A link only to where a reader should go: a web address,
   * or a bookmark of this file for a link inside the doc.
   */
  private runs(inline: Inline[]): string {
    const segments = segmentsOf(inline, this.source, this.notes);
    let out = '';
    const run = (segment: Segment, linked: boolean) => (segment.image ? this.imageRun(segment.image) : runXml(segment, linked));
    const keyOf = (to: LinkTo | undefined) => (to ? ('href' in to ? `href ${to.href}` : `anchor ${to.anchor.bookmark}`) : '');
    for (let index = 0; index < segments.length; ) {
      const to = linkOf(segments[index]!.marks?.link, this.source);
      if (!to) {
        out += run(segments[index]!, false);
        index++;
        continue;
      }
      const key = keyOf(to);
      let inner = '';
      while (index < segments.length && keyOf(linkOf(segments[index]!.marks?.link, this.source)) === key) inner += run(segments[index++]!, true);
      const target = 'href' in to ? `r:id="${this.linkId(to.href)}"` : `w:anchor="${to.anchor.bookmark}"`;
      out += `<w:hyperlink ${target} w:history="1">${inner}</w:hyperlink>`;
    }
    return out;
  }

  /** A picture, as big as it is shown but no wider than the page. Word doesn't take WebP: its description stays instead. */
  private imageRun(image: SegmentImage): string {
    const extension = IMAGE_EXTENSION[image.mime];
    if (!extension) {
      this.notes.add('kept_as_text', 'image (a format Word does not open)');
      return image.alt ? runXml({ text: image.alt, marks: { italic: true } }, false) : '';
    }
    const index = this.images.length + 1;
    const id = `rIdImage${index}`;
    this.images.push({ id, path: `media/image${index}.${extension}`, bytes: image.bytes });
    const room = (PAGE[this.source.paper].w - 2 * MARGIN) * EMU_PER_TWIP;
    const width = image.width ? image.width * EMU_PER_PIXEL : room;
    const height = image.width && image.height ? image.height * EMU_PER_PIXEL : Math.round(room * 0.6);
    const scale = Math.min(1, room / width);
    const cx = Math.round(width * scale);
    const cy = Math.round(height * scale);
    const name = `image${index}`;
    const alt = escapeAttr(image.alt);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${index}" name="${name}" descr="${alt}"/><a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="${index}" name="${name}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  /** The pictures the body named, for the package. */
  media(): { path: string; bytes: Uint8Array }[] {
    return this.images;
  }

  private linkId(href: string): string {
    let id = this.links.get(href);
    if (!id) {
      id = `rId${this.links.size + 4}`;
      this.links.set(href, id);
    }
    return id;
  }

  /** One shaded paragraph with line breaks: it selects, copies and shades as one block. */
  private code(block: Block, place: Place): string {
    const text = segmentsOf(block.inline ?? [], this.source, this.notes).map(segment => segment.text).join('');
    return `<w:p>${paragraphProps({ style: 'Code', ...this.takeBreak(), ...(contentLeft(place) ? { ind: `<w:ind w:left="${contentLeft(place)}"/>` } : {}) })}${this.bookmarks()}<w:r>${textXml(text)}</w:r></w:p>`;
  }

  /** A table of contents: a paragraph for each heading it lists, linked to its bookmark and stepped in by its depth. */
  private contents(block: Block, place: Place): string {
    const lines = this.source.anchors?.contents?.get(block.id) ?? [];
    return lines
      .map(line => {
        const left = contentLeft(place) + (line.indent * INDENT) / 2;
        const run = runXml({ text: line.text, ...(line.group ? { marks: { bold: true } } : {}) }, !!line.anchor);
        const linked = line.anchor ? `<w:hyperlink w:anchor="${line.anchor.bookmark}" w:history="1">${run}</w:hyperlink>` : run;
        return `<w:p>${paragraphProps({ ...this.takeBreak(), ...(place.cell ? { spacing: CELL_SPACING } : {}), ...(left ? { ind: `<w:ind w:left="${left}"/>` } : {}) })}${this.bookmarks()}${linked}</w:p>`;
      })
      .join('');
  }

  private list(block: Block, place: Place): string {
    const kind = block.attrs?.kind;
    const level = Math.min(place.level + 1, MAX_LEVEL);
    const num = kind === 'ordered' ? this.orderedNum(level, block.attrs?.start, block.attrs?.numbering) : kind === 'check' ? 0 : this.bulletNum();
    const inside: Place = { ...place, level };
    return (block.children ?? [])
      .map(item => {
        this.mark(this.source.anchors?.blocks.get(item.id));
        const id = kind === 'check' ? this.checkNum(item.attrs?.checked === true) : num;
        const children = item.children ?? [];
        const first = children[0];
        // The marker sits on the item's first paragraph; an item that opens with something else gets one of its own.
        if (first?.type === 'paragraph') return this.paragraph(first, inside, { id, level }) + this.blocks(children.slice(1), inside);
        return `<w:p>${paragraphProps({ style: 'ListParagraph', num: { id, level } })}${this.bookmarks()}</w:p>${this.blocks(children, inside)}`;
      })
      .join('');
  }

  private addNum(abstract: number, override = ''): number {
    const id = this.nums.length + 1;
    this.nums.push(`<w:num w:numId="${id}"><w:abstractNumId w:val="${abstract}"/>${override}</w:num>`);
    return id;
  }

  private bulletNum(): number {
    return this.addNum(0);
  }

  /** Each ordered list counts from its own start, and may number its own way (a, A, i, I). */
  private orderedNum(level: number, start: unknown, numbering: unknown): number {
    const from = Number.isInteger(Number(start)) && Number(start) >= 0 && start !== undefined ? Number(start) : 1;
    const format = typeof numbering === 'string' ? { a: 'lowerLetter', A: 'upperLetter', i: 'lowerRoman', I: 'upperRoman' }[numbering] : undefined;
    // Without startOverride a list carries on counting from the last one of the same abstractNum, whatever its lvl says.
    const own = format
      ? `<w:lvl w:ilvl="${level}"><w:start w:val="${from}"/><w:numFmt w:val="${format}"/><w:lvlText w:val="%${level + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${INDENT * (level + 1)}" w:hanging="${HANGING}"/></w:pPr></w:lvl>`
      : '';
    return this.addNum(1, `<w:lvlOverride w:ilvl="${level}"><w:startOverride w:val="${from}"/>${own}</w:lvlOverride>`);
  }

  private checkNum(done: boolean): number {
    this.checkNums ??= { open: this.addNum(2), done: this.addNum(3) };
    return done ? this.checkNums.done : this.checkNums.open;
  }

  private table(block: Block, place: Place): string {
    const layout = tableLayout(block);
    const left = contentLeft(place);
    const widths = columnsOf(layout, place.width - left);
    const sum = (from: number, span: number) => widths.slice(from, from + span).reduce((total, width) => total + width, 0);
    let leading = true;
    const rows = layout.rows.map(row => {
      leading &&= row.length > 0 && row.every(slot => slot.cell?.attrs?.header === true);
      const cells = row.map(slot => {
        if (slot.cell) this.mark(this.source.anchors?.blocks.get(slot.cell.id));
        const width = sum(slot.col, slot.span);
        const header = slot.cell?.attrs?.header === true;
        const fill = hexColor(slot.cell?.attrs?.background) ?? (header ? 'f2f2f2' : undefined);
        const props = [
          `<w:tcW w:w="${width}" w:type="dxa"/>`,
          slot.span > 1 ? `<w:gridSpan w:val="${slot.span}"/>` : '',
          slot.merged ? '<w:vMerge/>' : slot.restart ? '<w:vMerge w:val="restart"/>' : '',
          fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill.toUpperCase()}"/>` : '',
        ].join('');
        const align = slot.cell?.attrs?.align;
        const body = slot.cell ? this.blocks(slot.cell.children ?? [], { width: width - CELL_PADDING, left: 0, level: -1, quote: 0, cell: true, ...(typeof align === 'string' ? { align } : {}) }) : '';
        // A cell ends in a paragraph, or Word calls the file corrupt.
        return `<w:tc><w:tcPr>${props}</w:tcPr>${body.endsWith('</w:p>') || body.endsWith('<w:p/>') ? body : `${body}<w:p/>`}</w:tc>`;
      });
      return `<w:tr>${leading ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.join('')}</w:tr>`;
    });
    if (!rows.length) return '';
    const props = `<w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>${left ? `<w:tblInd w:w="${left}" w:type="dxa"/>` : ''}<w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>`;
    // Two tables with nothing between them become one in Word, and a table has no space after it of its own.
    const after = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="200" w:lineRule="exact"/></w:pPr></w:p>';
    return `<w:tbl><w:tblPr>${props}</w:tblPr><w:tblGrid>${widths.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>${after}`;
  }
}

/** A place in a table's grid: a cell, the rest of a merge from above, or a gap a short row leaves. */
interface Slot {
  col: number;
  span: number;
  cell?: Block;
  restart?: boolean;
  merged?: boolean;
}

interface TableLayout {
  rows: Slot[][];
  columns: number;
}

/** Which cell stands where once colspans and rowspans are counted, every row filled to the same width. */
function tableLayout(block: Block): TableLayout {
  const carried = new Map<number, { rows: number; span: number }>();
  const rows: Slot[][] = [];
  let columns = 0;
  for (const row of block.children ?? []) {
    const slots: Slot[] = [];
    let col = 0;
    const takeCarried = () => {
      for (let carry = carried.get(col); carry; carry = carried.get(col)) {
        slots.push({ col, span: carry.span, merged: true });
        if (--carry.rows === 0) carried.delete(col);
        col += carry.span;
      }
    };
    for (const cell of row.children ?? []) {
      takeCarried();
      const span = spanOf(cell.attrs?.colspan);
      const down = spanOf(cell.attrs?.rowspan);
      slots.push({ col, span, cell, ...(down > 1 ? { restart: true } : {}) });
      if (down > 1) carried.set(col, { rows: down - 1, span });
      col += span;
    }
    // Merges further right than this row's last cell, past any gap.
    for (const at of [...carried.keys()].sort((a, b) => a - b)) {
      if (at < col) continue;
      if (at > col) slots.push({ col, span: at - col });
      col = at;
      takeCarried();
    }
    columns = Math.max(columns, col);
    rows.push(slots);
  }
  for (const slots of rows) {
    const last = slots[slots.length - 1];
    const end = last ? last.col + last.span : 0;
    if (end < columns) slots.push({ col: end, span: columns - end });
  }
  return { rows, columns };
}

/** How wide text is in columns of a monospace face: East Asian characters take two. */
const textWidth = (block: Block): number => {
  let width = 0;
  for (const item of block.inline ?? []) width += 'ch' in item ? (/[⺀-힯豈-﫿＀-￯]/.test(item.ch) ? 2 : 1) : 4;
  return width + (block.children ?? []).reduce((total, child) => total + textWidth(child), 0);
};

/**
 * The grid's widths, filling the width there is: the doc's own column widths when every column has one; otherwise more
 * for the columns with more to say, as a fixed layout can't work that out by itself.
 */
function columnsOf(layout: TableLayout, available: number): number[] {
  const { columns, rows } = layout;
  if (!columns) return [];
  // Deep in lists or in a narrow cell there may be next to nothing left: a table still needs room to exist.
  const room = Math.max(available, 720 * columns);
  const given: number[] = Array.from({ length: columns }, () => 0);
  const words: number[] = Array.from({ length: columns }, () => 0);
  for (const row of rows) {
    for (const slot of row) {
      if (!slot.cell) continue;
      const width = columnWidths(slot.cell.attrs?.colwidth);
      for (let index = 0; index < slot.span; index++) {
        const part = width.length === slot.span ? width[index]! : width.length === 1 ? width[0]! / slot.span : 0;
        given[slot.col + index] ||= part;
      }
      if (slot.span === 1) words[slot.col] = Math.max(words[slot.col]!, textWidth(slot.cell));
    }
  }
  const weights = given.every(width => width > 0) ? given : words.map(width => Math.sqrt(Math.min(Math.max(width, 4), 200)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const floor = Math.min(720, Math.floor(room / columns));
  const widths = weights.map(weight => Math.max(floor, Math.round((room * weight) / total)));
  // Rounding and the floor must not push the table past the margin.
  widths[widths.indexOf(Math.max(...widths))]! -= widths.reduce((sum, width) => sum + width, 0) - room;
  return widths;
}

function abstractNums(): string {
  const level = (index: number, format: string, text: string, font = '') =>
    `<w:lvl w:ilvl="${index}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${INDENT * (index + 1)}" w:hanging="${HANGING}"/></w:pPr>${font}</w:lvl>`;
  const levels = (make: (index: number) => string) => Array.from({ length: MAX_LEVEL + 1 }, (_, index) => make(index)).join('');
  const abstract = (id: number, content: string) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${content}</w:abstractNum>`;
  const symbol = '<w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol" w:eastAsia="Segoe UI Symbol" w:cs="Segoe UI Symbol" w:hint="default"/></w:rPr>';
  const bullets = ['•', 'o', '▪'];
  const orders = ['decimal', 'lowerLetter', 'lowerRoman'];
  return (
    abstract(0, levels(index => level(index, 'bullet', bullets[index % 3]!))) +
    abstract(1, levels(index => level(index, orders[index % 3]!, `%${index + 1}.`))) +
    abstract(2, levels(index => level(index, 'bullet', '☐', symbol))) +
    abstract(3, levels(index => level(index, 'bullet', '☑', symbol)))
  );
}

/** The styles, named and sized as Word's own, with the doc's fonts. */
function stylesXml(source: ExportSource): string {
  const { fonts, language } = source;
  const eastAsianOf = (font: DocFont) => (language === 'en' ? LATIN[font] : EAST_ASIAN[language][font === 'serif' ? 'serif' : 'sans']);
  const bodyLatin = LATIN[fonts.text];
  const body = fontsXml(bodyLatin, eastAsianOf(fonts.text));
  // The page's default is serif headings over sans text; in Word those headings are drawn in the text's face.
  const headingFonts = fonts.headings === 'serif' && fonts.text === 'sans' ? '' : fontsXml(LATIN[fonts.headings], eastAsianOf(fonts.headings));
  const code = fontsXml(LATIN.mono, language === 'en' ? LATIN.mono : EAST_ASIAN[language].sans);
  const lang = language === 'en' ? '<w:lang w:val="en-US"/>' : `<w:lang w:val="en-US" w:eastAsia="${LANG_TAG[language]}"/>`;
  const size = (half: number) => `<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`;
  const heading = (level: number, before: number, after: number, half: number, italic = false) =>
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/>${before ? `<w:spacing w:before="${before}" w:after="${after}"/>` : ''}<w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr>${headingFonts}${italic ? '<w:i/><w:iCs/>' : '<w:b/><w:bCs/>'}${size(half)}</w:rPr></w:style>`;
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
  const quoteLine = '<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="A0A0A0"/></w:pBdr>';
  return (
    `${XML}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>${body}${size(22)}${lang}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    heading(1, 360, 120, 32) +
    heading(2, 280, 100, 26) +
    heading(3, 240, 80, 24) +
    heading(4, 0, 0, 22) +
    heading(5, 0, 0, 22) +
    heading(6, 0, 0, 22, true) +
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80"/><w:contextualSpacing/></w:pPr><w:rPr>${headingFonts}${size(56)}</w:rPr></w:style>` +
    // Not italic: a slanted Chinese, Japanese or Korean face is only a distorted one.
    `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${quoteLine}<w:ind w:left="${INDENT}"/></w:pPr><w:rPr><w:color w:val="404040"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:link w:val="CodeChar"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/><w:spacing w:after="160" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr>${code}${size(20)}</w:rPr></w:style>` +
    `<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/><w:link w:val="Code"/><w:rPr>${code}${size(20)}<w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="${INDENT}"/><w:contextualSpacing/></w:pPr></w:style>` +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders></w:tblPr></w:style>` +
    '</w:styles>'
  );
}

/** The doc's bytes, and what stayed out of them. */
export async function renderDocx(source: ExportSource): Promise<{ bytes: Buffer; notes: ExportNote[] }> {
  const notes = new ExportNotes();
  const writer = new DocumentWriter(source, notes);
  const { w, h } = PAGE[source.paper];
  const section = `<w:sectPr><w:pgSz w:w="${w}" w:h="${h}"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  // A body with no paragraph at all opens as a damaged file in some readers.
  const body = writer.body() || '<w:p/>';
  const imageTypes = [...new Set(writer.media().map(image => image.path.split('.').pop()!))].map(extension => `<Default Extension="${extension}" ContentType="image/${extension}"/>`).join('');
  const parts: [string, string][] = [
    [
      '[Content_Types].xml',
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageTypes}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${R}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    ],
    [
      'docProps/core.xml',
      `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(source.title)}</dc:title><cp:revision>${source.rev}</cp:revision></cp:coreProperties>`,
    ],
    ['docProps/app.xml', `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Open Artifact Docs</Application></Properties>`],
    ['word/document.xml', `${XML}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}"><w:body>${body}${section}</w:body></w:document>`],
    ['word/_rels/document.xml.rels', writer.relationships()],
    ['word/styles.xml', stylesXml(source)],
    ['word/numbering.xml', writer.numbering()],
    ['word/settings.xml', `${XML}<w:settings xmlns:w="${W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`],
  ];
  const chunks: Buffer[] = [];
  // A fixed time: the same doc makes the same file.
  const mtime = new Date(2000, 0, 1);
  const files: { name: string; data: Uint8Array }[] = [
    ...parts.map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') })),
    ...writer.media().map(image => ({ name: `word/${image.path}`, data: image.bytes })),
  ];
  // The zip writer reads each part from a file.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-artifact-docs-docx-'));
  try {
    const entries = files.map((part, index) => {
      const file = path.join(dir, String(index));
      fs.writeFileSync(file, part.data);
      return { name: part.name, file, size: part.data.byteLength, mode: 0o644, mtime };
    });
    await writeZip(entries, async chunk => {
      chunks.push(chunk);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { bytes: Buffer.concat(chunks), notes: notes.list() };
}
