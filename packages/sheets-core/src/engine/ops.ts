/**
 * Operations: what changes a workbook, and the shapes they carry. A workbook's
 * history is a list of operations (`load`), every edit is more of them, and
 * each answers the operations that take it back (`reverse`).
 *
 * Operations are read strictly: a field the engine does not know makes the
 * whole request unreadable. A field typed `T | null` must be written (as
 * `null` where there is none); an optional one may be left out.
 */

import type { SortDirection } from './edits.ts';
import type { CellAt, ColumnId, IdRun, RangeCorners, RangeOnASheet, RowId, RunsOfABase, SheetId } from './ids.ts';
import type { Filter } from './reads.ts';
import type { ColumnReading } from './utility.ts';

// ---------------------------------------------------------------------------
// What a cell holds
// ---------------------------------------------------------------------------

/** One end of a reference: a cell, its row and its column each fixed (`$`) or not. */
export interface CellPoint {
  r: RowId;
  isRowAbsolute: boolean;
  c: ColumnId;
  isColumnAbsolute: boolean;
}

export interface RowPoint {
  r: RowId;
  isRowAbsolute: boolean;
}

export interface ColumnPoint {
  c: ColumnId;
  isColumnAbsolute: boolean;
}

/** A reference in a formula, always to a sheet by id (the formula's own sheet included). */
export type Reference =
  /** `A1` */
  | { kind: 'cell'; sheetId: SheetId; cell: CellPoint }
  /** `A1:B2` */
  | { kind: 'range'; sheetId: SheetId; topLeft: CellPoint; bottomRight: CellPoint }
  /** `A:B`, or `A2:B` from a row down (`top`). */
  | { kind: 'columns'; sheetId: SheetId; left: ColumnPoint; right: ColumnPoint; top: RowPoint | null }
  /** `2:3`, or `B2:3` from a column right (`left`). */
  | { kind: 'rows'; sheetId: SheetId; top: RowPoint; bottom: RowPoint; left: ColumnPoint | null }
  /**
   * A column of a connected table (`Customers[Id]`), its heading with it or
   * not (`Customers[[#All],[Id]]`). Written from format 49.
   */
  | { kind: 'tableColumn'; sheetId: SheetId; c: ColumnId; hasItsHeading: boolean }
  /**
   * Some rows of a connected table, of some of its columns (`null`: all of
   * them): `Customers[#Headers]`, `Customers[[#Data],[Id]:[Name]]`. Written
   * from format 55.
   */
  | { kind: 'tablePart'; sheetId: SheetId; columns: TableColumns | null; rows: TableRows }
  /** A named range, by id: written by its name as it is now, `#REF!` once removed. From format 51. */
  | { kind: 'namedRange'; namedRangeId: string };

/** The columns of a connected table a reference reads, from one to another. */
export interface TableColumns {
  left: ColumnId;
  right: ColumnId;
}

/** The rows of a connected table a reference reads: its heading, its records, or both. */
export type TableRows = 'heading' | 'records' | 'headingAndRecords';

/**
 * A formula as a cell keeps it: its text cut at its references
 * (`=SUM(A1:A2)*2` is `["=SUM(", ")*2"]` around one range).
 */
export interface StoredFormula {
  /** One piece more than there are references. */
  textBetweenReferences: string[];
  references: Reference[];
}

/** A person a cell names: `u_` and 22 letters, digits or `_`, and how the cell writes them. */
export interface Person {
  userId: string;
  label: string;
}

/** A look of a run of text, in the order a run names them. */
export type Mark = 'bold' | 'italic' | 'underline' | 'strikethrough';

/** A run of text that looks one way. */
export interface Run {
  /** Not empty, and without a line break. */
  text: string;
  marks: Mark[];
  /** The address the run links to. Always written in answers; may be left out in operations. */
  link: string | null;
}

/** How deep a line of a list lies: 0 to 7 as read, 0 to 2 as a cell keeps it. */
export type ListLevel = number;

/** What list a paragraph is a line of: none, or a line of one at a level. */
export type ListLine =
  | { kind: 'none' }
  | { kind: 'bullet'; level: ListLevel }
  | { kind: 'numbered'; level: ListLevel }
  | { kind: 'checkbox'; level: ListLevel; isChecked: boolean };

/** A paragraph of text with looks. */
export interface Paragraph {
  list: ListLine;
  runs: Run[];
}

/** What a cell holds, as typed. */
export type Input =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'formula'; formula: StoredFormula }
  /** An option of a dropdown: the cell reads as the option's label now, or as this one when the option is gone. */
  | { kind: 'dropdownOption'; optionId: string; label: string }
  /** A person: the cell reads as their label. */
  | { kind: 'user'; userId: string; label: string }
  /** Two people or more: the cell reads as their labels, joined by `, `. */
  | { kind: 'users'; users: Person[] }
  /** Text with looks: the cell reads as its text. */
  | { kind: 'richText'; paragraphs: Paragraph[] };

export type InputKind = Input['kind'];

/** A cell to set; `input: null` empties it. */
export interface CellToSet {
  r: RowId;
  c: ColumnId;
  input: Input | null;
}

/** Rows or columns of a grid: a base, and runs of numbers `[first, count]`. */
export interface GridLines {
  base: string;
  runs: [first: number, count: number][];
}

/**
 * One slot of a grid: a number, a text or a boolean written bare, `null` for a
 * cell emptied, `[]` where no cell is set, any other input as itself.
 */
export type GridSlot = number | string | boolean | null | [] | Input;

/**
 * Cells set as a grid (written for 32 cells or more by what types, pastes,
 * fills or copies cells): rows and columns in id order, inputs row by row.
 */
export interface CellGrid {
  rows: GridLines[];
  columns: GridLines[];
  inputs: GridSlot[][];
}

// ---------------------------------------------------------------------------
// Cell formats
// ---------------------------------------------------------------------------

export type Hue = 'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'magenta';
export type Shade = 100 | 200 | 300 | 400 | 600 | 800;

/** A color: none, a standard hue and shade, or `#rrggbb` in small letters. */
export type Color =
  | { kind: 'none' }
  | { kind: 'standard'; hue: Hue; shade: Shade }
  | { kind: 'rgb'; hex: string };

export type HorizontalAlignment = 'general' | 'left' | 'center' | 'right';
export type VerticalAlignment = 'top' | 'center' | 'bottom';
export type Underline = 'none' | 'single' | 'double';
export type BorderStyle = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double';

export type Border = { kind: 'none' } | { kind: 'line'; style: BorderStyle; color: Color };

/** What a cell is worked with besides typing: nothing, a checkbox, or a dropdown. */
export type CellControl = { kind: 'none' } | { kind: 'checkbox' } | { kind: 'dropdown'; dropdownId: string };

export interface NumberFormat {
  /** A number format pattern (`#,##0.00`, `yyyy-mm-dd`, `General`). */
  pattern: string;
}

/** How a format writes the wrapping of a cell's text: as a flag, or by name (overflowing, wrapped, clipped at the edge). */
export type WrapWritten = boolean | 'overflow' | 'wrap' | 'clip';

/** The wrapping of a cell's text as it is kept: wrapped or not, or clipped at the cell's edge. */
export type Wrap = boolean | 'clip';

/**
 * A cell's format, as set and read back. Set, only the properties written
 * change; a property set to its default is taken away. Defaults: General, a
 * `general` and `top` alignment without wrap, no fill, no control, no borders,
 * a 10 point font in no color, neither bold, italic, underlined nor struck.
 */
export interface CellFormat {
  numberFormat?: NumberFormat;
  /** The value the cell is reset to (`resetCellsToDefaultValues`), from format 54. */
  defaultValue?: DefaultValue;
  /** The least and most number the cell may be given, from format 54. */
  valueLimits?: ValueLimits;
  alignment?: { horizontal?: HorizontalAlignment; vertical?: VerticalAlignment; wrap?: WrapWritten };
  fillColor?: Color;
  cellControl?: CellControl;
  border?: { top?: Border; bottom?: Border; left?: Border; right?: Border };
  font?: {
    bold?: boolean;
    italic?: boolean;
    underline?: Underline;
    strikethrough?: boolean;
    color?: Color;
    /** 1 to 409 points. */
    size?: number;
  };
}

/**
 * A cell's default value: none (the default), blank (the cell is emptied), a
 * number, a text that is not empty, a boolean, or an option of the cell's
 * dropdown (its label not empty).
 */
export type DefaultValue =
  | { kind: 'none' }
  | { kind: 'blank' }
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'dropdownOption'; optionId: string; label: string };

/**
 * The least and most number a cell may be given (`null`: no end; the default
 * is both `null`). The minimum is not above the maximum.
 */
export interface ValueLimits {
  minimum: number | null;
  maximum: number | null;
}

/** Cells to format: every row by every column, and the format they take. */
export interface CellsToFormat {
  rows: IdRun[] | RunsOfABase[];
  columns: IdRun[];
  format: CellFormat;
}

// ---------------------------------------------------------------------------
// Layout: sizes, sheet settings, groups
// ---------------------------------------------------------------------------

/** Widths of columns to set: `null` puts back the default. */
export interface ColumnsToSize {
  columns: IdRun;
  widthInPixels: number | null;
}

/** Heights of rows to set: `null` puts back the default. */
export interface RowsToSize {
  rows: IdRun;
  heightInPixels: number | null;
}

/**
 * A sheet's settings: the last frozen row and column (`null`: none), and
 * whether gridlines are hidden. As set, only the ones written change.
 */
export interface SheetSettings {
  lastFrozenRow?: RowId | null;
  lastFrozenColumn?: ColumnId | null;
  areGridlinesHidden?: boolean;
  /**
   * The interactive view (a view id) the sheet shows in place of its grid
   * (`null`: none). Set only on an empty sheet, to a view with an interactive
   * element; while it is set, edits to the sheet's grid are refused.
   */
  interactive?: string | null;
  /**
   * Whether the sheet's tab is hidden, from format 50. Never `null`. A sheet
   * is not hidden when no other is shown (`noShownSheetLeft`).
   */
  isHidden?: boolean;
}

export interface SheetToSet {
  sheetId: SheetId;
  settings: SheetSettings;
}

/** The first and last line (row or column ids) of a group. */
export interface EndsOfGroup {
  first: string;
  last: string;
}

/** A group of rows or columns. As set, a group already there changes only in what is written; a new one is written whole. */
export interface GroupPatch {
  ends?: EndsOfGroup;
  isCollapsed?: boolean;
}

export interface GroupToSet {
  groupId: string;
  /** `null` takes the group away. */
  group: GroupPatch | null;
}

// ---------------------------------------------------------------------------
// Dropdowns, conditional formats, cell tables, views and placements
// ---------------------------------------------------------------------------

export interface DropdownOption {
  optionId: string;
  label: string;
  color: Color;
}

export interface DropdownToSet {
  dropdownId: string;
  /** `null` takes the dropdown away. */
  options: DropdownOption[] | null;
}

/** The cell a conditional format's test reads: the cell formatted, or the one in its row in another column. */
export type TestedCell = { kind: 'theCellItself' } | { kind: 'sameRowInColumn'; c: ColumnId };

export type Comparison =
  | 'equalTo'
  | 'notEqualTo'
  | 'greaterThan'
  | 'greaterThanOrEqualTo'
  | 'lessThan'
  | 'lessThanOrEqualTo';

export type NumberOperand =
  | { kind: 'number'; number: number }
  | { kind: 'daysFromToday'; days: number }
  | { kind: 'sameRowInColumn'; c: ColumnId };

export type CellCondition =
  | { kind: 'isBlank' }
  | { kind: 'isNotBlank' }
  | { kind: 'numberIs'; comparison: Comparison; operand: NumberOperand }
  | { kind: 'numberIsBetween'; oneEnd: NumberOperand; otherEnd: NumberOperand }
  | { kind: 'numberIsNotBetween'; oneEnd: NumberOperand; otherEnd: NumberOperand }
  | { kind: 'textIs'; text: string }
  | { kind: 'textIsNot'; text: string }
  | { kind: 'textContains'; text: string }
  | { kind: 'textDoesNotContain'; text: string }
  | { kind: 'textStartsWith'; text: string }
  | { kind: 'textEndsWith'; text: string }
  | { kind: 'booleanIs'; value: boolean }
  /** `count` is 1 or more. */
  | { kind: 'isAmongTheLargest'; count: number }
  | { kind: 'isAmongTheSmallest'; count: number }
  | { kind: 'appearsMoreThanOnce' }
  | { kind: 'isAnError' };

export type CellConditionKind = CellCondition['kind'];

export interface Test {
  tested: TestedCell;
  condition: CellCondition;
}

/** The font a `formatWhere` gives: at least one property. */
export interface FontOfACondition {
  bold?: boolean;
  italic?: boolean;
  underline?: Underline;
  strikethrough?: boolean;
  color?: Color;
}

/** The look a `formatWhere` gives: a fill, a font, or both. */
export interface FormatOfACondition {
  fillColor?: Color;
  font?: FontOfACondition;
}

export type LowestAnchor =
  | { kind: 'smallestNumber' }
  | { kind: 'number'; number: number }
  | { kind: 'percentile'; percentile: number };

export type MiddleAnchor = { kind: 'number'; number: number } | { kind: 'percentile'; percentile: number };

export type HighestAnchor =
  | { kind: 'largestNumber' }
  | { kind: 'number'; number: number }
  | { kind: 'percentile'; percentile: number };

/** A stop of a color scale: where it lies among the numbers in the cells, and its color. */
export interface Stop<A> {
  anchor: A;
  color: Color;
}

/** What a conditional format does. */
export type Effect =
  /** Gives `format` to each cell for which every test holds. */
  | { kind: 'formatWhere'; allOf: Test[]; format: FormatOfACondition }
  /** Fills each cell that holds a number with a color between those of its stops. */
  | {
      kind: 'colorScale';
      lowest: Stop<LowestAnchor>;
      middle: Stop<MiddleAnchor> | null;
      highest: Stop<HighestAnchor>;
    };

/**
 * A conditional format: the ranges it formats, its priority (the smallest
 * first), and what it does. As set, one already there changes only in what is
 * written; a new one is written whole.
 */
export interface ConditionalFormatPatch {
  ranges?: RangeCorners[];
  priority?: number;
  effect?: Effect;
}

/** A conditional format as kept: every part of it. */
export interface ConditionalFormat {
  ranges: RangeCorners[];
  priority: number;
  effect: Effect;
}

export interface ConditionalFormatToSet {
  conditionalFormatId: string;
  /** `null` takes the conditional format away. */
  conditionalFormat: ConditionalFormatPatch | null;
}

export interface RowsOfACellTable {
  firstRow: RowId;
  lastRow: RowId;
}

/** A table drawn on cells: its header rows, its columns, and its footer rows if it has them. */
export interface CellTable {
  headerRows: RowsOfACellTable;
  firstColumn: ColumnId;
  lastColumn: ColumnId;
  footerRows: RowsOfACellTable | null;
}

export interface CellTableToSet {
  cellTableId: string;
  /** `null` takes the cell table away. */
  cellTable: CellTable | null;
}

/** What a widget of a view shows: `ref` names a node of the page (`node/<id>`). */
export interface Embed {
  ref: string;
  caption: string;
}

/** A named range a widget reads. */
export interface InputOfAWidget {
  /** A letter or `_`, then letters, digits and `_`; 128 at most. */
  name: string;
  range: RangeOnASheet;
}

/** A value an interactive element writes to a cell of one of its inputs. */
export type InteractiveValue =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean };

/** A cell of an input and the value saved for it (`null`: empty). */
export interface InteractiveCell {
  r: RowId;
  c: ColumnId;
  value: InteractiveValue | null;
}

/** The values an interactive element keeps for one of its inputs, which a reset writes back. */
export interface InteractiveWrite {
  /** The name of one of the element's inputs. */
  input: string;
  saved: InteractiveCell[];
}

/**
 * An element of a view. A widget reads its inputs; an interactive element also
 * writes to them, and keeps the values its inputs were saved with.
 */
export type ViewElement =
  | { kind: 'widget'; elementId: string; embed: Embed; inputs: InputOfAWidget[] }
  | { kind: 'interactive'; elementId: string; embed: Embed; inputs: InputOfAWidget[]; writes: InteractiveWrite[] };

/** A view: its name and what it shows. Kept as written: its ranges do not follow rows that move. */
export interface View {
  name: string;
  elements: ViewElement[];
}

export interface ViewToSet {
  viewId: string;
  /** `null` takes the view away (refused while a placement shows it). */
  view: View | null;
}

export type ShownByAPlacement = { kind: 'view'; viewId: string };

/** How far a placement lies from its anchor cell's top left; an offset of nothing is left out. */
export interface OffsetOfAPlacement {
  xInPixels: number;
  yInPixels: number;
}

/** Where a view is shown on a sheet: anchored at a cell, its size. */
export interface Placement {
  shows: ShownByAPlacement;
  topLeft: CellAt;
  offsetFromAnchorCell?: OffsetOfAPlacement;
  widthInPixels: number;
  heightInPixels: number;
}

export interface PlacementToSet {
  placementId: string;
  /** `null` takes the placement away. */
  placement: Placement | null;
}

// ---------------------------------------------------------------------------
// Moves and names
// ---------------------------------------------------------------------------

/** Rows to move, and the row they go after (`null`: to the top). */
export interface RowMove {
  rows: IdRun[];
  after: RowId | null;
}

/** Columns to move, and the column they go after (`null`: to the left end). */
export interface ColumnMove {
  columns: IdRun[];
  after: ColumnId | null;
}

/** Sheets to move, and the sheet they go after (`null`: first). */
export interface SheetMove {
  sheetIds: SheetId[];
  after: SheetId | null;
}

export interface SheetName {
  sheetId: SheetId;
  name: string;
}

// ---------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------


/** A filter and a sort a sheet keeps under a name. It outlives the cell table it was made for. */
export interface NamedView {
  name: string;
  cellTableId: string;
  filter: Filter | null;
  sortBy: { c: ColumnId; direction: SortDirection }[];
}

/** `null` removes the named view. */
export interface NamedViewToSet {
  namedViewId: string;
  namedView: NamedView | null;
}

/**
 * Rows put in an order among themselves. `order` is base 64 (`A`–`Z`, `a`–`z`,
 * `0`–`9`, `-`, `_`), each index in as many digits as the largest needs: the
 * `k`th place the rows take gets the row at index `order[k]` of `ids`. A rising
 * run is written as its first index, `+` and how many follow.
 */
export interface RowsInOrder {
  ids: RunsOfABase[];
  order: string;
}

/** A key of the sort that put the rows in order. */
export interface SortedBy {
  c: ColumnId;
  direction: SortDirection;
}

// ---------------------------------------------------------------------------
// Connected tables
// ---------------------------------------------------------------------------

/** The call made again for the next records, its cursor written in the arguments as `{{cursor}}`. */
export interface FollowUpOfACall {
  tool: string;
  argumentsAsJson: string;
}

/** The call a connected table fetches its records with, and the code that makes its answer into records. */
export interface CallOfAConnectedTable {
  title: string;
  connector: string;
  tool: string;
  /** A JSON object, as text. */
  argumentsAsJson: string;
  followUp: FollowUpOfACall | null;
  transform: { kind: 'code'; source: string };
}

export interface ConnectedTable {
  call: CallOfAConnectedTable;
}

/** A column of a connected table: its name, and the field it shows (its texts read as they are when `reading` is `null`). */
export interface ColumnOfAConnectedTable {
  name: string;
  from: { kind: 'field'; field: string; reading: ColumnReading | null };
  /** How the column's records line up; without it, a column lines up by what it holds. */
  horizontalAlignment?: HorizontalAlignment;
}

/** What the server fetched last for a connected table. */
export interface SnapshotOfAConnectedTable {
  /** 32 digits of lowercase hexadecimal. */
  snapshotId: string;
  rowCount: number;
  fieldCount: number;
  textInBytes: number;
  isCutOff: boolean;
  fetchedAtInSecondsSince1970: number;
  /** The digest of the call it was fetched with. */
  callDigest: string;
}

export interface ConnectedTableToSet {
  sheetId: SheetId;
  /** `null` makes the sheet no connected table. */
  connectedTable: ConnectedTable | null;
}

export interface ColumnOfAConnectedTableToSet {
  c: ColumnId;
  column: ColumnOfAConnectedTable | null;
}

export interface SnapshotToSet {
  sheetId: SheetId;
  snapshot: SnapshotOfAConnectedTable | null;
}

// ---------------------------------------------------------------------------
// Named ranges and protections
// ---------------------------------------------------------------------------

/** The cells a named range names: a range, columns (from a row down), or rows (from a column right). */
export type CellsOfANamedRange =
  | { kind: 'range'; sheetId: SheetId; topLeft: CellAt; bottomRight: CellAt }
  | { kind: 'columns'; sheetId: SheetId; left: ColumnId; right: ColumnId; top: RowId | null }
  | { kind: 'rows'; sheetId: SheetId; top: RowId; bottom: RowId; left: ColumnId | null };

export interface NamedRange {
  name: string;
  cells: CellsOfANamedRange;
}

export interface NamedRangeToSet {
  namedRangeId: string;
  /** `null` removes it. */
  namedRange: NamedRange | null;
}

/** A named range by its id, as the workbook holds it. */
export interface NamedRangeEntry {
  namedRangeId: string;
  namedRange: NamedRange;
}

/** A range of a sheet a protection names: cells, whole rows, or whole columns. */
export type ProtectedRange =
  | { kind: 'cells'; topLeft: CellAt; bottomRight: CellAt }
  | { kind: 'wholeRows'; first: RowId; last: RowId }
  | { kind: 'wholeColumns'; first: ColumnId; last: ColumnId };

/** What a protection protects: a range of the sheet, or the whole sheet but its open ranges. */
export type Protects = { kind: 'range'; range: ProtectedRange } | { kind: 'sheet'; openRanges: ProtectedRange[] };

/** A protection: what it protects, and the user ids of who may still edit it (the owner always may). */
export interface Protection {
  protects: Protects;
  editors: string[];
}

export interface ProtectionToSet {
  protectionId: string;
  /** `null` removes it. */
  protection: Protection | null;
}

/** Every operation, by `kind`. Lists in an operation are never empty, and runs never of no ids. */
export type Op =
  | { kind: 'insertSheet'; sheetId: SheetId; name: string; after: SheetId | null }
  | { kind: 'insertRows'; sheetId: SheetId; after: RowId | null; rows: IdRun }
  | { kind: 'insertColumns'; sheetId: SheetId; after: ColumnId | null; columns: IdRun }
  /** Written as `cells`, or as `grid` for 32 cells or more set by typing, pasting, filling or copying. */
  | { kind: 'setCells'; sheetId: SheetId; cells: CellToSet[] }
  | { kind: 'setCells'; sheetId: SheetId; grid: CellGrid }
  | { kind: 'deleteRows'; sheetId: SheetId; rows: IdRun[] | RunsOfABase[] }
  | { kind: 'deleteColumns'; sheetId: SheetId; columns: IdRun[] }
  | { kind: 'undeleteRows'; sheetId: SheetId; rows: IdRun[] | RunsOfABase[] }
  | { kind: 'undeleteColumns'; sheetId: SheetId; columns: IdRun[] }
  | { kind: 'deleteSheet'; sheetId: SheetId }
  | { kind: 'undeleteSheet'; sheetId: SheetId }
  | { kind: 'setCellFormats'; sheetId: SheetId; formats: CellsToFormat[] }
  | { kind: 'setSheetNames'; names: SheetName[] }
  | { kind: 'mergeCells'; sheetId: SheetId; ranges: RangeCorners[] }
  | { kind: 'unmergeCells'; sheetId: SheetId; ranges: RangeCorners[] }
  | { kind: 'setColumnWidths'; sheetId: SheetId; widths: ColumnsToSize[] }
  | { kind: 'setRowHeights'; sheetId: SheetId; heights: RowsToSize[] }
  | { kind: 'setSheetSettings'; sheets: SheetToSet[] }
  /** The seed random numbers are drawn from. */
  | { kind: 'reseed'; seed: number }
  /** An IANA time zone name, or `null` for none. */
  | { kind: 'setTimeZone'; timeZone: string | null }
  /** Sets the time zone only when the workbook has none. */
  | { kind: 'adoptTimeZone'; timeZone: string }
  /** A BCP 47 locale tag the engine knows (`en-US`, `de-DE`). */
  | { kind: 'setLocale'; locale: string }
  | { kind: 'setDropdowns'; sheetId: SheetId; dropdowns: DropdownToSet[] }
  | { kind: 'setRowGroups'; sheetId: SheetId; groups: GroupToSet[] }
  | { kind: 'setColumnGroups'; sheetId: SheetId; groups: GroupToSet[] }
  | { kind: 'setConditionalFormats'; sheetId: SheetId; conditionalFormats: ConditionalFormatToSet[] }
  | { kind: 'setViews'; views: ViewToSet[] }
  | { kind: 'setPlacements'; sheetId: SheetId; placements: PlacementToSet[] }
  | { kind: 'setCellTables'; sheetId: SheetId; cellTables: CellTableToSet[] }
  | { kind: 'setNamedViews'; sheetId: SheetId; namedViews: NamedViewToSet[] }
  | { kind: 'moveRows'; sheetId: SheetId; moves: RowMove[] }
  | { kind: 'reorderRows'; sheetId: SheetId; rows: RowsInOrder; sortedBy: SortedBy[] }
  | { kind: 'moveColumns'; sheetId: SheetId; moves: ColumnMove[] }
  | { kind: 'moveSheets'; moves: SheetMove[] }
  /** From format 48. */
  | { kind: 'setConnectedTables'; tables: ConnectedTableToSet[] }
  /** From format 48. */
  | { kind: 'setColumnsOfConnectedTable'; sheetId: SheetId; columns: ColumnOfAConnectedTableToSet[] }
  /** From format 48. */
  | { kind: 'setSnapshots'; snapshots: SnapshotToSet[] }
  /** From format 51. */
  | { kind: 'setNamedRanges'; namedRanges: NamedRangeToSet[] }
  /** From format 52. */
  | { kind: 'setProtections'; sheetId: SheetId; protections: ProtectionToSet[] };

export type OpKind = Op['kind'];

/** The operation of a kind. */
export type OpOf<K extends OpKind> = Extract<Op, { kind: K }>;

/** The oldest version of the operations' format the engine reads. */
export const OLDEST_FORMAT_VERSION = 17;
/** The newest version of the operations' format the engine writes. */
export const NEWEST_FORMAT_VERSION = 55;

/**
 * An edit as recorded for the server: the version of the format its operations
 * are written in, the revision it was made on, and the operations.
 */
export interface RecordedEdit {
  v: number;
  base: number;
  ops: Op[];
}
