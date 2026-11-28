/**
 * A Sheet as an .xlsx file: the engine writes the file's parts (readXlsxFile), given the RGB of the page's standard
 * colors and the charts it can describe; the caller zips the parts. What Excel shows differently comes back as
 * `notCarriedOver`, which excelDifferences puts in the page's words.
 */

import type { DescribedChart } from './chart-descriptions.ts';
import type { EngineMessage } from './engine.ts';

/** The name of the sheet an .xlsx file gets for the options of its dropdowns. */
export const DROPDOWN_OPTIONS_SHEET = 'Dropdown options';

export type StandardHue = 'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'magenta';
export type StandardShade = '100' | '200' | '300' | '400' | '600' | '800';

/** The page's standard colors (a dropdown option's, a cell's fill) as RGB, by hue and shade. */
export const STANDARD_COLORS: Readonly<Record<StandardHue, Readonly<Record<StandardShade, string>>>> = {
  gray: { '100': '#e0e0e0', '200': '#c2c2c2', '300': '#a4a4a4', '400': '#878787', '600': '#515151', '800': '#202020' },
  red: { '100': '#fad6d6', '200': '#f4abab', '300': '#ec7e7e', '400': '#e34948', '600': '#8e2626', '800': '#3c0e0e' },
  orange: { '100': '#f7d8cb', '200': '#f4ae94', '300': '#ec835a', '400': '#d95926', '600': '#863311', '800': '#371407' },
  yellow: { '100': '#f9dca4', '200': '#fab219', '300': '#db9300', '400': '#b77700', '600': '#734500', '800': '#311a00' },
  green: { '100': '#caeac7', '200': '#91d68b', '300': '#55bf50', '400': '#0ca30c', '600': '#006300', '800': '#11260f' },
  teal: { '100': '#bfebdb', '200': '#7ad7b4', '300': '#3bbd8c', '400': '#199e70', '600': '#065f49', '800': '#022720' },
  blue: { '100': '#cde2fb', '200': '#9ec5f4', '300': '#6da7ec', '400': '#3987e5', '600': '#184f95', '800': '#032042' },
  purple: { '100': '#dfdbfd', '200': '#bfb9f5', '300': '#a096eb', '400': '#8173e3', '600': '#4a3aa7', '800': '#1d1649' },
  magenta: { '100': '#f9d4e2', '200': '#f3a8c3', '300': '#e87ba4', '400': '#d55181', '600': '#862a4c', '800': '#390f1f' },
};

/** What readXlsxFile is asked, with the charts it is to write. */
export function xlsxRequest(charts: readonly DescribedChart[]): EngineMessage {
  return { kind: 'readXlsxFile', nameOfTheSheetOfOptions: DROPDOWN_OPTIONS_SHEET, rgbOfStandardColors: STANDARD_COLORS, charts };
}

/** One part of an .xlsx file, as readXlsxFile writes it. */
export interface XlsxPart {
  path: string;
  xml: string;
}

/** The parts of readXlsxFile's answer, or null when it is not an xlsxFile. */
export function xlsxPartsOf(answer: EngineMessage): XlsxPart[] | null {
  if (answer.kind !== 'xlsxFile' || !Array.isArray(answer.parts)) return null;
  const parts: XlsxPart[] = [];
  for (const part of answer.parts) {
    if (typeof part !== 'object' || part === null) return null;
    const { path, xml } = part as { path?: unknown; xml?: unknown };
    if (typeof path !== 'string' || typeof xml !== 'string') return null;
    parts.push({ path, xml });
  }
  return parts;
}

/** How long a file name the page makes can be, extension and all: in characters (code points), and in UTF-8 bytes. */
export const MOST_FILE_NAME_CHARACTERS = 120;
export const MOST_FILE_NAME_BYTES = 240;

/** Characters no one sees (soft hyphens, joiners, direction marks), which a file name drops. */
const UNSEEN = /[\u00AD\u061C\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu;
/** Runs of spaces, control characters, blank-looking letters and what a file system or a link reads, which become a space. */
const NOT_IN_FILE_NAMES = /[\s\p{Cc}\u2800\uFFFC\u{1D159}\u{13441}\u{13442}\u{16910}\u115F\u1160\u3164\uFFA0\\/:*?"<>|%]+/gu;
const SPACES_AND_DOTS_AT_ENDS = /^[\s.]+|[\s.]+$/gu;

/** A part of a file name, with what no file name holds taken out or turned into a space. */
export const fileNamePart = (text: string): string =>
  text.replace(UNSEEN, '').replace(NOT_IN_FILE_NAMES, ' ').replace(SPACES_AND_DOTS_AT_ENDS, '');

/** A text's graphemes (what a person takes for one character), or its code points where Intl.Segmenter is missing. */
function graphemes(text: string): string[] {
  if (typeof Intl.Segmenter !== 'function') return Array.from(text);
  return Array.from(new Intl.Segmenter().segment(text), ({ segment }) => segment);
}

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/**
 * As much of the title as fits a file name with this extension, cut between graphemes so no letter loses its accent
 * or an emoji its parts; null when nothing of it is left.
 */
export function fileNameStemOf(title: string | null, extension: string): string | null {
  let stem = '';
  for (const grapheme of graphemes(fileNamePart(title ?? ''))) {
    const longer = stem + grapheme;
    if (Array.from(longer).length > MOST_FILE_NAME_CHARACTERS || utf8Length(longer + extension) > MOST_FILE_NAME_BYTES) break;
    stem = longer;
  }
  return stem.replace(SPACES_AND_DOTS_AT_ENDS, '') || null;
}

/** A file name for the workbook: its title, else its first sheet's name, else "Sheet". */
export function xlsxFileName(title: string | null, firstSheet: string): string {
  return `${fileNameStemOf(title, '.xlsx') ?? (fileNamePart(firstSheet) || 'Sheet')}.xlsx`;
}

/** What Excel shows differently, in the page's words. */
const EXCEL_DIFFERENCES: Record<string, string> = {
  formulasWrittenAsValues: 'Some formulas are saved as their values.',
  randomNumbersThatStay: 'Random numbers change when the file is opened.',
  users: 'People appear as their names.',
  checkboxes: 'Checkboxes appear as TRUE or FALSE.',
  colorsOfDropdownOptions: 'Dropdown options have no colors.',
  sheetNames: 'Some sheet names are shortened or changed.',
  looksOfSomeBlankCells: 'Some empty cells have no formatting.',
  linksOfPartsOfTexts: 'Links on part of a cell’s text become one link for the whole cell.',
  linksOfSomeCells: 'Some links aren’t included.',
  sizesOfTheLargestRowsAndColumns: 'Very tall rows and wide columns are made smaller.',
  listsInTexts: 'Lists in a cell’s text appear as typed characters, like “• item” or “☐ item”.',
  conditionalFormats: 'Conditional formatting isn’t included.',
  namedViews: 'Saved views aren’t included.',
  editorsOfProtections: 'Protected cells are locked with no password, so anyone who opens the file can unlock them.',
  protections: 'Protection isn’t included, so anyone who opens the file can edit every cell.',
  defaultValues: 'Cells can’t be reset to their defaults.',
  limitsOfSomeCells: 'Some minimums and maximums aren’t included.',
  interactives: 'Interactive sheets are saved empty.',
  rowsOfConnectedTables: 'Some rows from connected tables aren’t included.',
  placedViews: 'Charts aren’t included.',
  looksOfCharts: 'Included charts look different.',
};

/** readXlsxFile's notCarriedOver in the page's words (a kind the page has no words for is given as it is). */
export function excelDifferences(notCarriedOver: unknown): string[] {
  if (!Array.isArray(notCarriedOver)) return [];
  return notCarriedOver.map((what) =>
    what === 'placedViews' && notCarriedOver.includes('looksOfCharts') ? 'Some charts aren’t included.' : (EXCEL_DIFFERENCES[String(what)] ?? String(what)),
  );
}
