import { isFormulaText } from '../chips/dropdown-pane-edits.ts';
import { findFormulaReferences } from '../formulas/references.ts';
import type { PageState } from '../state/initial-state.ts';
export function unclosedBraceTail(formula: string): string | null {
  let braceAt = formula.lastIndexOf('{');
  return braceAt > formula.lastIndexOf('}') ? formula.slice(braceAt + 1) : null;
}
export function isFormulaUnfinished(text: string): boolean {
  if (!isFormulaText(text)) return false;
  let masked = formulaTextMasked(text);
  return (
    quoteMarkInFormulaPattern.test(masked) ||
    openParenthesesCount(masked) > 0 ||
    unclosedBraceTail(masked) !== null ||
    trailingOperatorPattern.test(masked)
  );
}
export function withFormulaBracketsClosed(text: string): string {
  if (!isFormulaText(text)) return text;
  let masked = formulaTextMasked(text);
  let isOpenAtEnd = quoteMarkInFormulaPattern.test(masked) || trailingOperatorPattern.test(masked);
  let braceTail = unclosedBraceTail(masked);
  let isBraceTailOdd = braceTail !== null && (/[()]/.test(braceTail) || trailingBackslashPattern.test(braceTail));
  if (isOpenAtEnd || isBraceTailOdd) return text;
  return text + (braceTail === null ? '' : '}') + ')'.repeat(Math.max(0, openParenthesesCount(masked)));
}
export const quotedOrSheetRefPattern = /"[^"]*"|'[^']*'|#[\w/]+!/g;
export const trailingOperatorPattern = /[=+\-*/^&<>({,;:!]\s*$/;
export const trailingBackslashPattern = /\\\s*$/;
/** A formula's text with its quoted text, sheet prefixes and table column references masked; an unclosed table column reads as an open quote. */
export const formulaTextMasked = (text: string): string =>
  findFormulaReferences(text, 'point')
    .columnsOfTables.reduceRight((masked, { start, end, isClosed }) => `${masked.slice(0, start)}${isClosed ? '0' : '"'}${masked.slice(end)}`, text)
    .replaceAll(quotedOrSheetRefPattern, '0');
export const quoteMarkInFormulaPattern = /["']/;
export const openParenthesesCount = (formula: string): number => formula.split('(').length - formula.split(')').length;
export const isBareEqualsSign = (text: string): boolean => /^=\s*$/.test(text);
export const isFormulaUnfinishedInEntry = ({ mode, formulaFromWords }: Pick<PageState, 'mode' | 'formulaFromWords'>): boolean =>
  mode.kind === 'editing' && mode.isBegunToListFunctions !== true && formulaFromWords.stage?.kind !== 'asked' && isFormulaUnfinished(mode.text);
