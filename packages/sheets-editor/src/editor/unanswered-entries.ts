import type { CellContents, Edit, Entry, NumberFormatKind, Paragraph } from '@open-artifact/sheets-core';
import { TEXT_PREFIX_QUOTE, parseBooleanText, stripTextPrefixQuote } from '../model/cell-text.ts';
import { formatNumberWithSigns, normalizeNoBreakSpaces, parsePlainNumber, stripGroupSeparators } from '../format/number-signs.ts';
import { dateToSerial } from '../model/date-serials.ts';
import { isSameCell } from '../selection/model.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { EnterEdit } from '../model/edit-effects.ts';
import type { EntryUnanswered, PageState } from '../state/initial-state.ts';
import type { PageContext } from '../state/event-reducer.ts';
/** How an entry not yet answered is drawn in its cell. */
export type EntryDrawnAs = Pick<CellContents, 'input' | 'shown'>;
/** What a typed text reads as, before the page's answer. */
export type TypedAs = 'bare' | 'grouped' | 'percent' | 'currency' | 'time' | 'date' | 'dateWithNoYear';
export interface TypedReading {
  value: number;
  as: TypedAs;
}
/** An entry not yet answered, as drawn, with the cell it makes when it starts a list after the `'` that keeps it a text. */
export interface EntryUnansweredWithList extends EntryUnanswered {
  drawnAs: EntryDrawnAs | null;
  cellWithList?: CellContents;
}
export function markEditByPage<E extends Edit>(edit: E): E {
  return (EDITS_BY_PAGE.add(edit), edit);
}
export function plainTextOfEntry(entry: Entry): string {
  if (entry.kind === 'text') return entry.text;
  if (entry.kind !== 'textWithLooks') return '';
  return entry.paragraphs.map(({ runs }) => runs.map(({ text }) => text).join('')).join(`
`);
}
// How an entry not yet answered is drawn: the number, time or day it reads as, shown in the cell's format.
export function numberOfTypedText(text: string, { decimalSign, signsOfNumbers }: Pick<WorkbookReads, 'decimalSign' | 'signsOfNumbers'>): TypedReading | null {
  let [, signs = '', digits = '', unit = ''] = NUMBER_ENTRY_PATTERN.exec(text) ?? [];
  let hasCurrencyBefore = /\p{Sc}/u.test(signs);
  if (
    !(
      signs.startsWith('(') === text.endsWith(')') &&
      signs.replaceAll(/[^(+-]/g, '').length <= 1 &&
      !(hasCurrencyBefore && unit !== '') &&
      !/[\u00a2\u00a4\u20a5\u20b0\uffe0]/.test(text)
    )
  )
    return null;
  let decimalMark = decimalSign === 'comma' ? ',' : '.';
  let [whole = '', ...fractions] = digits.split(decimalMark);
  let digitsUngrouped = [stripGroupSeparators(whole, decimalSign), ...fractions].join(decimalMark);
  let value = parsePlainNumber(digitsUngrouped, decimalSign);
  if (value === null) return null;
  let wholeAsGrouped = formatNumberWithSigns(Math.trunc(value), signsOfNumbers);
  let isGrouped = digitsUngrouped !== digits;
  if (isGrouped && normalizeNoBreakSpaces(whole) !== normalizeNoBreakSpaces(wholeAsGrouped)) return null;
  let signedValue = /[(-]/.test(signs) ? -value : value;
  if (unit === '%')
    return {
      value: signedValue / 100,
      as: 'percent',
    };
  if (hasCurrencyBefore || unit !== '')
    return {
      value: signedValue,
      as: 'currency',
    };
  return {
    value: signedValue,
    as: isGrouped ? 'grouped' : 'bare',
  };
}
export function timeOfTypedText(text: string): TypedReading | null {
  let [, hours, minutes, seconds = 0, halfOfDay] = TIME_ENTRY_PATTERN.exec(text) ?? [];
  let hour = Number(hours);
  if (hours === undefined || (halfOfDay !== undefined && (hour < 1 || hour > 12))) return null;
  let hoursAfterNoon = halfOfDay?.toLowerCase() === 'p' ? 12 : 0;
  return {
    value: ((halfOfDay === undefined ? hour : (hour % 12) + hoursAfterNoon) * 3600 + Number(minutes) * 60 + Number(seconds)) / 86400,
    as: 'time',
  };
}
export function dayOfTypedText(text: string, reads: Pick<WorkbookReads, 'dayTypedAs'>): TypedReading | null {
  let day = reads.dayTypedAs(text);
  if (day !== null)
    return {
      value: dateToSerial(day),
      as: 'date',
    };
  let [, slash, dot] = DAY_WITHOUT_YEAR_PATTERN.exec(text) ?? [];
  let separator = slash ?? dot;
  if (separator === undefined) return null;
  let dayInYear = reads.dayTypedAs(text.replace(/\.$/, '') + separator + YEAR_FOR_DAY_WITHOUT_YEAR);
  return dayInYear === null
    ? null
    : {
        value: dateToSerial(dayInYear),
        as: 'dateWithNoYear',
      };
}
export function cellDrawnForEntry(text: string, cellId: CellId, reads: WorkbookReads): EntryDrawnAs {
  let asText: EntryDrawnAs = {
    input: {
      kind: 'text',
      value: text.length > 1 ? stripTextPrefixQuote(text) : text,
    },
  };
  if (reads.dropdownOf(cellId) !== null || text.startsWith('=')) return asText;
  let boolean = parseBooleanText(text);
  if (boolean !== null)
    return {
      input: {
        kind: 'boolean',
        value: boolean,
      },
    };
  let { kind: formatKind, pattern } = reads.formatOf(cellId).numberFormat;
  if (formatKind === 'text') return asText;
  let [plainNumber, trimmed] = [parsePlainNumber(text, reads.decimalSign), text.replace(/^ +| +$/g, '')];
  let typed: TypedReading | null =
    plainNumber === null
      ? (numberOfTypedText(trimmed, reads) ?? timeOfTypedText(trimmed) ?? dayOfTypedText(trimmed, reads))
      : {
          value: plainNumber,
          as: 'bare',
        };
  if (typed === null) return asText;
  let value = formatKind === 'percent' && (typed.as === 'bare' || typed.as === 'grouped') ? typed.value / 100 : typed.value;
  let input = {
    kind: 'number' as const,
    value,
  };
  let shownInFormat = FORMAT_KINDS_SHOWING_TYPED[typed.as]?.includes(formatKind) === true ? reads.patternRead(pattern, () => value) : null;
  if (shownInFormat?.kind === 'numberFormat')
    return {
      input,
      shown: shownInFormat.shown,
    };
  if (typed.as === 'bare')
    return {
      input,
    };
  return {
    input,
    shown: {
      kind: 'text',
      text: trimmed,
      textColor: null,
    },
  };
}
export function unansweredEntryDrawn(entering: EnterEdit, reads: WorkbookReads): Omit<EntryUnansweredWithList, 'cellWithList'> {
  let { cellId, text } = unansweredEntryOf(entering);
  return {
    cellId,
    text,
    drawnAs: text === '' ? null : cellDrawnForEntry(text, cellId, reads),
  };
}
export function cellWithListOfEntry({ cell, entry }: EnterEdit, reads: WorkbookReads): CellContents | null {
  if (entry.kind !== 'textWithLooks') return null;
  let lists = entry.paragraphs.map(({ list }) => list);
  let text = plainTextOfEntry(entry);
  if (!text.startsWith(TEXT_PREFIX_QUOTE) || lists.every(({ kind }) => kind === 'none')) return null;
  let isAtStart = true;
  // The page writes the link of every run it enters (editor/text-looks.ts, richTextFromLooks).
  let paragraphs = entry.paragraphs.map(
    ({ list, runs }) => ({
      list,
      runs: runs.flatMap((run) => {
        let runText = isAtStart && run.text !== '' ? run.text.slice(TEXT_PREFIX_QUOTE.length) : run.text;
        return (
          (isAtStart &&= run.text === ''),
          runText === ''
            ? []
            : {
                ...run,
                text: runText,
              }
        );
      }),
    }),
  ) as Paragraph[];
  return {
    ...cell,
    input: {
      kind: 'richText',
      paragraphs,
    },
    value: {
      kind: 'text',
      value: text.slice(TEXT_PREFIX_QUOTE.length),
    },
    numbersOfListLines: (reads.listLinesAsKept(lists) ?? []).map(({ number }) => number),
  };
}
export function readsWithUnansweredEntries<Reads extends WorkbookReads>(
  reads: Reads,
  { entriesUnanswered }: { entriesUnanswered: readonly EntryUnansweredWithList[] },
): Reads {
  if (entriesUnanswered.length === 0) return reads;
  let cellOf = (cell: CellId): CellContents | null => {
    let unanswered = entriesUnanswered.findLast((entry) => isSameCell(entry.cellId, cell));
    if (unanswered === undefined) return reads.cellOf(cell);
    let { drawnAs, cellWithList } = unanswered;
    let { rowId, columnId } = cell;
    return (
      cellWithList ??
      (drawnAs === null
        ? null
        : {
            r: rowId,
            c: columnId,
            ...drawnAs,
          })
    );
  };
  return {
    ...reads,
    cellOf,
    cellOnShowIn: (cell) => cellOf(cell) ?? reads.spilledCellOf(cell),
    columnIndexesOnShowIn(sheetId, rowIndex) {
      let unansweredColumnIndexes = entriesUnanswered.flatMap(({ cellId }) => {
        let position = cellId.sheetId === sheetId ? reads.positionOfCell(cellId) : null;
        return position?.rowIndex === rowIndex ? [position.columnIndex] : [];
      });
      let columnIndexes = reads.columnIndexesOnShowIn(sheetId, rowIndex);
      if (unansweredColumnIndexes.length === 0) return columnIndexes;
      let allColumnIndexes = [...new Set([...columnIndexes, ...unansweredColumnIndexes])];
      allColumnIndexes.sort((index, otherIndex) => index - otherIndex);
      return allColumnIndexes;
    },
  };
}
export const EDITS_BY_PAGE = new WeakSet<Edit>();
export const isEditByPage = (edit: Edit): boolean =>
  (edit.kind === 'declareCellTable' && edit.isAskedFor !== true) || EDITS_BY_PAGE.has(edit);
export const NUMBER_ENTRY_PATTERN = /^([(+-]?(?:\p{Sc} ?[+-]?)?)([\d.,'\u00a0\u202f]+)(%| ?\p{Sc})?\)?$/u;
export const TIME_ENTRY_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?: ?([ap])m)?$/i;
export const DAY_WITHOUT_YEAR_PATTERN = /^\d{1,2}(?:(\/)\d{1,2}|(\.)\d{1,2}\.?)$/;
export const YEAR_FOR_DAY_WITHOUT_YEAR = 2026;
export const NUMBER_FORMAT_KINDS_FOR_NUMBERS: readonly NumberFormatKind[] = ['number', 'currency', 'percent', 'scientific', 'date', 'dateAndTime', 'duration'];
export const FORMAT_KINDS_SHOWING_TYPED: Partial<Record<TypedAs, readonly NumberFormatKind[]>> = {
  bare: NUMBER_FORMAT_KINDS_FOR_NUMBERS,
  grouped: NUMBER_FORMAT_KINDS_FOR_NUMBERS,
  percent: ['percent'],
  date: ['date', 'dateAndTime'],
  time: ['time', 'duration'],
};
export const unansweredEntryOf = (entering: EnterEdit): EntryUnanswered => ({
  cellId: {
    sheetId: entering.sheetId,
    rowId: entering.cell.r,
    columnId: entering.cell.c,
  },
  text: plainTextOfEntry(entering.entry),
});
export const textOfUnansweredEntryAt = ({ entriesUnanswered }: Pick<PageState, 'entriesUnanswered'>, cell: CellId): string | null =>
  entriesUnanswered.findLast((unanswered) => isSameCell(unanswered.cellId, cell))?.text ?? null;
export const isEntryWorkPending = (
  { entriesUnanswered }: Pick<PageState, 'entriesUnanswered'>,
  { areFormulasLeft }: Pick<PageContext, 'areFormulasLeft'>,
): boolean => areFormulasLeft || entriesUnanswered.length > 0;
