import type { Node as PMNode } from 'prosemirror-model';
import { TableMap } from 'prosemirror-tables';

/** A cell this short (in characters, on its longest line) stays on one line. */
export const SHORT_CELL = 12;
/** Words this long or shorter are not broken inside. */
export const SHORT_WORD = 20;
/** The least width of a column without a set width, in pixels. */
export const AUTO_COLUMN = 48;
/** Lines are counted up to this many characters; a picture or a block that is not text counts as this. */
export const FULL_LINE = 99;
/** A chip in the text (a mention, a date, a dropdown) counts as this many characters. */
export const CHIP_CHARS = 7;

/** How a cell's text wraps: `short` never, `words` only between words, `null` anywhere. */
export type CellWrap = 'short' | 'words' | null;

export interface CellFit {
  wrap: CellWrap;
  /** Its longest line, in characters (0 for a short cell). */
  chars: number;
  /** Its least width in pixels, when one of its columns has a set width: the set widths, and 48 for each other. */
  min: number | null;
}

const length = (text: string): number => Array.from(text).length;

/** The longest line of a cell, in characters, up to {@link FULL_LINE}. */
export function longestLine(cell: PMNode): number {
  let longest = 0;
  cell.descendants(node => {
    if (node.isAtom && node.isBlock) longest = FULL_LINE;
    if (!node.isTextblock) return longest < FULL_LINE;
    let line = 0;
    node.forEach(child => {
      if (longest >= FULL_LINE) return;
      if (child.type.name === 'hardBreak') line = 0;
      else if (child.isText) line += length((child.text ?? '').slice(0, 2 * FULL_LINE));
      else if (child.type.name === 'media') line = FULL_LINE;
      else line += CHIP_CHARS;
      longest = Math.max(longest, line);
    });
    return false;
  });
  return Math.min(longest, FULL_LINE);
}

/** The longest word of a cell, in characters. */
export function longestWord(cell: PMNode): number {
  return cell.textBetween(0, cell.content.size, ' ', ' ').split(/\s+/).reduce((most, word) => Math.max(most, length(word)), 0);
}

/** How a cell wraps, from its longest line, its longest word (asked only when needed), and whether it spans columns. */
export function wrapOf(line: number, word: () => number, spans: boolean): { wrap: CellWrap; chars: number } {
  if (line <= SHORT_CELL && !spans) return { wrap: 'short', chars: 0 };
  return { wrap: word() <= SHORT_WORD ? 'words' : null, chars: line };
}

/** Each column's set width (0: none), from the cells that cover it. */
export function columnWidths(table: PMNode): number[] {
  const map = TableMap.get(table);
  const widths = Array.from({ length: map.width }, () => 0);
  const seen = new Set<number>();
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      const offset = map.map[row * map.width + col]!;
      if (seen.has(offset) && widths[col]) continue;
      seen.add(offset);
      const cell = table.nodeAt(offset);
      const left = map.findCell(offset).left;
      const set = Array.isArray(cell?.attrs.colwidth) ? Number((cell.attrs.colwidth as unknown[])[col - left]) || 0 : 0;
      if (set > 0 && !widths[col]) widths[col] = set;
    }
  }
  return widths;
}

/** How a cell fits, from its text and the set widths of the columns it covers. */
export function cellFit(cell: PMNode, columns: readonly number[]): CellFit {
  let set = 0;
  let auto = 0;
  for (const width of columns) {
    if (width > 0) set += width;
    else auto += 1;
  }
  const { wrap, chars } = wrapOf(longestLine(cell), () => longestWord(cell), columns.length > 1);
  return { wrap, chars, min: set > 0 ? set + auto * AUTO_COLUMN : null };
}

/** One cell of a table as its fit draws it: where it is (from the table's start) and what it draws. */
export interface FittedCell {
  offset: number;
  size: number;
  left: number;
  right: number;
  wrap: CellWrap;
  style: string;
}

/** The cells of a table and how each fits; none when every column has a set width (the table keeps them). */
export function fitTable(table: PMNode): FittedCell[] {
  const widths = columnWidths(table);
  if (widths.every(width => width > 0)) return [];
  const map = TableMap.get(table);
  const out: FittedCell[] = [];
  const seen = new Set<number>();
  for (const offset of map.map) {
    if (seen.has(offset)) continue;
    seen.add(offset);
    const cell = table.nodeAt(offset);
    if (!cell) continue;
    const { left, right } = map.findCell(offset);
    const fit = cellFit(cell, widths.slice(left, right));
    out.push({ offset, size: cell.nodeSize, left, right, wrap: fit.wrap, style: fitStyle(fit) });
  }
  return out;
}

/** The style a cell's fit draws: its longest line and least width, as the stylesheet reads them. */
export function fitStyle(fit: CellFit): string {
  return [fit.chars ? `--fit-chars: ${fit.chars}` : '', fit.min ? `--fit-min: ${fit.min}px` : ''].filter(Boolean).join('; ');
}

/** What lies beside the page on its right: the comments column, its gutter of markers, or nothing. */
export type PageSide = 'rail' | 'icons' | 'none';

/** Room kept at the page's right edge for a table, by what lies there: none before the comments column. */
export const SIDE_GUTTER: Readonly<Record<PageSide, number>> = { rail: 0, icons: 64, none: 24 };

/**
 * How wide a table of its own may be, from the text's left edge: to the right edge of the page's scrolling box, less
 * its padding (where the comments column lies) and the gutter of what lies there; never less than the text's width.
 */
export function tableRoom(text: { left: number; width: number }, scroller: { left: number; contentWidth: number; paddingRight: number }, side: PageSide): number {
  const right = scroller.left + scroller.contentWidth - scroller.paddingRight - SIDE_GUTTER[side];
  return Math.max(text.width, Math.floor(right - text.left));
}

/** Room kept at the page's left edge for a table scrolled to the left. */
export const LEFT_GUTTER = 24;
/** The least a table of its own reaches left of the text: the room its row handles are drawn in. */
export const TABLE_LEAD = 48;

/**
 * How far left of the text a table of its own may be scrolled into: to the left edge of the page's scrolling box, less
 * {@link LEFT_GUTTER}; never less than {@link TABLE_LEAD}. The table starts at the text's left edge all the same.
 */
export function tableLead(text: { left: number }, scroller: { left: number }): number {
  return Math.max(TABLE_LEAD, Math.floor(text.left - scroller.left - LEFT_GUTTER));
}

/**
 * The width each column has as drawn, for keeping them while the caret is in the table: a cell over one column gives
 * it; a cell over several shares what the others leave. Null when a column can't be measured.
 */
export interface DrawnCell {
  left: number;
  right: number;
  /** Its width as drawn; null when it is not drawn. */
  width: number | null;
}

export function measureColumns(cells: readonly DrawnCell[], count: number): number[] | null {
  const widths = Array.from({ length: count }, () => 0);
  let open = count;
  const wide: DrawnCell[] = [];
  for (const cell of cells) {
    if (!open) break;
    if (cell.right - cell.left > 1) wide.push(cell);
    else if (!widths[cell.left]) {
      if (cell.width === null) return null;
      widths[cell.left] = cell.width;
      open -= 1;
    }
  }
  for (const cell of open ? wide : []) {
    if (cell.width === null) return null;
    let rest = cell.width;
    const unknown: number[] = [];
    for (let col = cell.left; col < cell.right; col++) {
      if (widths[col]) rest -= widths[col]!;
      else unknown.push(col);
    }
    for (const col of unknown) widths[col] = rest / unknown.length;
  }
  return widths.every(width => width > 0) ? widths.map(width => Math.max(AUTO_COLUMN, Math.ceil(width * 1000) / 1000)) : null;
}
