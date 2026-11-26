/** The words of an Ask field, as the page tells them to the agent (pure). */

import { ASK_TEXT_BYTES, ASK_TOO_LONG } from '@open-artifact/editor-kit';

/**
 * The most UTF-16 units an Ask field takes as it is typed in. The words are refused when over
 * {@link ASK_TEXT_BYTES} UTF-8 bytes (`askTooLong`), never cut, and a byte is never fewer units, so whatever is within
 * the limit fits.
 */
export const MAX_ASK_WORDS_LENGTH = ASK_TEXT_BYTES;
/** What an Ask field says while the words it refused as too long are still in it, or `null` once they are changed. */
export const tooLongNoteOf = (typed: string, refusedTyped: string | null): string | null =>
  refusedTyped !== null && refusedTyped === typed ? ASK_TOO_LONG : null;
export const UNSHOWN_CHARACTERS_PATTERN =
  /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Noncharacter_Code_Point}\u2800\uFFFD\u{16FE4}]/gu;
export const collapseWhitespace = (text: string): string => text.replaceAll(/\s+/gu, ' ').trim();
export const hasUnshownCharacters = (text: string): boolean => text.replaceAll(UNSHOWN_CHARACTERS_PATTERN, '') !== text;
export const cleanAskWords = (text: string): string =>
  collapseWhitespace(collapseWhitespace(text).replaceAll(UNSHOWN_CHARACTERS_PATTERN, ''));
