import type { SortDirection } from '@open-artifact/sheets-core';
import type { PhraseMeaning } from './tokens.ts';
import { phrasesMeaning } from './tokens.ts';
import { NUMBER_COMPARISON_PHRASES, NUMBER_TRAILING_COMPARISON_PHRASES, LARGEST_SMALLEST_PHRASES } from './numbers-values.ts';
import { TEXT_TEST_PHRASES, CELL_TEST_PHRASES } from './conditions-values.ts';
import {
  PAST_PHRASES,
  DATE_COMPARISON_PHRASES,
  DATE_TRAILING_COMPARISON_PHRASES,
  AGE_COMPARISON_PHRASES,
  RELATIVE_PERIOD_WORDS,
  DAYS_IN_UNIT,
  RELATIVE_DAY_WORDS,
  MONTH_NAMES,
  MONTHS_IN_PERIOD,
} from './dates-values.ts';
export function wordSetWith(words: string, ...moreWordSets: Iterable<string>[]): Set<string> {
  let wordSet = new Set<string>(words.split(' '));
  for (let moreWords of moreWordSets) for (let word of moreWords) wordSet.add(word);
  return wordSet;
}
/** The words of phrase lists of any meaning. */
export const wordsOfPhrases = (...phraseLists: PhraseMeaning<unknown>[][]): string[] =>
  phraseLists.flatMap((phrases) => phrases.flatMap(([words]) => words));
export const NUMBER_CONDITION_WORDS = new Set<string>([
  ...wordsOfPhrases(NUMBER_COMPARISON_PHRASES, NUMBER_TRAILING_COMPARISON_PHRASES, LARGEST_SMALLEST_PHRASES),
  ...'between from to'.split(' '),
]);
export const LARGEST_SMALLEST_WORDS = new Set<string>(wordsOfPhrases(LARGEST_SMALLEST_PHRASES));
export const TEXT_TEST_WORDS = new Set<string>(wordsOfPhrases(TEXT_TEST_PHRASES, CELL_TEST_PHRASES));
export const DATE_CONDITION_WORDS = new Set<string>([
  ...wordsOfPhrases(PAST_PHRASES, DATE_COMPARISON_PHRASES, DATE_TRAILING_COMPARISON_PHRASES, AGE_COMPARISON_PHRASES),
  ...'older ago'.split(' '),
  ...RELATIVE_PERIOD_WORDS.keys(),
  ...DAYS_IN_UNIT.keys(),
  ...RELATIVE_DAY_WORDS.keys(),
  ...MONTH_NAMES.flatMap((month) => [month, month.slice(0, 3)]),
  ...MONTHS_IN_PERIOD.keys(),
  ...'sept between from to in within the on'.split(' '),
]);
export const MOST_CHARACTERS_OF_WORDS = 200;
export const phrasesOf = (phrases: string): string[][] => phrases.split(', ').map((phrase) => phrase.split(' '));
export const SORT_BY_PHRASES = phrasesOf('ordered by, sorted by, order by, sort by, by');
export const SORT_VERBS = wordSetWith('sort sorted order ordered');
export const NO_WITHOUT_WORDS = wordSetWith('no without');
export const NEGATING_WORDS = wordSetWith('not hide except excluding isnt arent', NO_WITHOUT_WORDS);
export const EXCLUDE_VERBS = wordSetWith('exclude skip ignore omit');
export const HIDING_WORDS = wordSetWith('hide except excluding leave', EXCLUDE_VERBS);
export const WORDS_NOT_TAKEN_AS_VALUES = wordSetWith('but assigned set', EXCLUDE_VERBS);
export const HAVING_WORDS = wordSetWith('with has have having');
export const CHECKED_RULE_WORDS = wordSetWith('yes true checked ticked');
export const UNCHECKED_WORDS = wordSetWith('no false unchecked unticked empty blank');
export const NOT_VERBS = wordSetWith('not isnt arent wasnt werent hasnt havent');
export const LINKING_VERBS = wordSetWith('is are was were has have been still already');
export const FIRST_PERSON_WORDS = wordSetWith('my mine me');
export const UNASSIGNED_PHRASES = phrasesOf('no one, noone, nobody, unassigned, not assigned, no ones, nobodys');
export const IS_HAS_WORDS = wordSetWith('is are has have having');
export const POSSESSIVE_ONES_WORDS = wordSetWith('ones nobodys');
export const SHOW_VERBS = wordSetWith('show give tell');
export const LIST_JOINERS = wordSetWith('and or plus ,');
export const SORT_KEY_JOINERS = wordSetWith('and then ,');
export const EQUALS_WORDS = wordSetWith('is are say says equals');
export const ALL_WORDS = wordSetWith('all every everything');
export const ANYONE_WORDS = wordSetWith('anything anyone everyone');
export const BLANK_WORDS = wordSetWith('blank blanks empty none nothing missing unset');
export const FILLED_WORDS = wordSetWith('filled set any anything');
export const SET_STATE_WORDS = wordSetWith('missing unset set');
export const NONE_OR_ANY_WORDS = wordSetWith('none nothing any anything');
export const EMPTY_WORDS = wordSetWith('blank empty missing');
export const WORDS_AFTER_COLUMN_NAME = new Set<string>([...EQUALS_WORDS, ...NEGATING_WORDS, ...BLANK_WORDS, ...FILLED_WORDS, ...FIRST_PERSON_WORDS]);
export const ROW_NOUNS = wordSetWith('rows row items item records record entries entry');
export const VAGUE_NOUNS = wordSetWith('things thing stuff ones');
export const RECORD_NOUNS = new Set<string>([...ROW_NOUNS, ...VAGUE_NOUNS]);
export const FILTER_FILLER_WORDS = wordSetWith('only just the a an that which in of for to please column', SHOW_VERBS, EQUALS_WORDS, RECORD_NOUNS);
export const TABLE_SUBJECT_NOUNS = wordSetWith(
  'deal deals candidate candidates applicant applicants application applications people person cost costs expense expenses orders customer customers project projects bug bugs',
);
export const YET_WORD = 'yet';
export const QUESTION_FILLER_WORDS = wordSetWith(
  'where whose who what filter filtered find list display see those still currently thats whats um uh oh ok okay',
  new Set([YET_WORD]),
  TABLE_SUBJECT_NOUNS,
);
export const TASK_NOUNS = wordSetWith('task tasks issue issues ticket tickets');
export const SORT_DIRECTION_PHRASES: PhraseMeaning<SortDirection>[] = [
  ...phrasesMeaning('ascending', 'ascending, asc, a to z'),
  ...phrasesMeaning('descending', 'descending, desc, reversed, z to a'),
];
export const SUPERLATIVE_DIRECTIONS = new Map<string, SortDirection>([
  ...'smallest lowest least fewest cheapest shortest earliest oldest soonest'.split(' ').map((word): [string, SortDirection] => [word, 'ascending']),
  ...'largest biggest highest most longest latest newest'.split(' ').map((word): [string, SortDirection] => [word, 'descending']),
]);
export const DATE_SUPERLATIVES = wordSetWith('earliest soonest latest newest oldest');
export const AGE_SUPERLATIVES = wordSetWith('newest oldest');
export const NON_COLUMN_SUPERLATIVES = wordSetWith('cheapest longest shortest');
export const ON_TOP_PHRASES = phrasesOf('first, on top, on the top, at the top');
export const RANGE_DIRECTION_PHRASES: PhraseMeaning<SortDirection>[] = [
  ...phrasesMeaning('descending', 'high to low, highest to lowest, largest to smallest, biggest to smallest, newest to oldest, latest to earliest'),
  ...phrasesMeaning('ascending', 'low to high, lowest to highest, smallest to largest, smallest to biggest, oldest to newest, earliest to latest'),
];
export const MOST_DAYS_FROM_TODAY_FOR_DATES = 92;
export const DUE_WORDS = wordSetWith('due deadline');
export const RANK_WORDS = wordSetWith('priority prio sev severity rank ranking place position tier');
export const COMMAND_WORDS = new Set<string>([
  ...SORT_BY_PHRASES.flat(),
  ...SUPERLATIVE_DIRECTIONS.keys(),
  'first',
  ...SORT_DIRECTION_PHRASES.flatMap(([words]) => words),
  ...NEGATING_WORDS,
  ...HAVING_WORDS,
  ...FIRST_PERSON_WORDS,
  ...LIST_JOINERS,
  ...SORT_KEY_JOINERS,
  ...ALL_WORDS,
  ...FILTER_FILLER_WORDS,
]);
