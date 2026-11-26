import type { OwnTextStyle } from '../../protocol.ts';
import { SKIP, isArtWords, isPen } from '../layers/parts.ts';
import { typeRule } from './type-style.ts';

/*
 * Which of a line's styles its words all set for themselves. A change by hand is laid on the line's element; a word
 * that sets its own weight (a span, a <b>) keeps it whatever the line says. Where no word would show a change, the
 * panel offers no control for it but says why.
 *
 * Each style is tried in turn: a made-up value is laid on the line the way a saved change is (in its own sheet in the
 * stage, by an attribute on the element), every word is read before and after, and everything is put back.
 */

export const OWN_TEXT_STYLES: readonly OwnTextStyle[] = ['weight', 'italic', 'px', 'tracking', 'ink'];

/** The attribute the trial's rules go by; on the line only while one style is tried. */
const TRYING = 'data-film-trying';

/** What a word shows of one style, as computed. Letter spacing in px: a word has the line's spacing where it is the same width. */
function shownOf(cs: CSSStyleDeclaration, key: OwnTextStyle, art: boolean): string {
  switch (key) {
    case 'weight':
      return cs.fontWeight;
    case 'italic':
      return cs.fontStyle;
    case 'px':
      return cs.fontSize;
    case 'tracking':
      return cs.letterSpacing;
    case 'ink':
      return art ? cs.fill : cs.color;
    default: {
      const never: never = key;
      return never;
    }
  }
}

/** What one word showed of the style tried, before the trial and during it. */
export interface WordTrial {
  before: string;
  during: string;
}

/**
 * Whether the style tried is the words' own: the line took the trial, and no word that showed the line's value
 * followed it. A trial the line did not take tells nothing, so the control stays. Pure.
 */
export function ownByTrial(line: WordTrial, words: readonly WordTrial[]): boolean {
  if (line.during === line.before || words.length === 0) return false;
  const follows = (word: WordTrial): boolean => word.before === line.before && word.during !== word.before;
  return !words.some(follows);
}

/** A value for the trial that differs from the line's own. Pure. */
export function trialValue(key: OwnTextStyle, now: number | string): number | string {
  const n = typeof now === 'number' ? now : NaN;
  switch (key) {
    case 'weight':
      return n >= 550 ? 200 : 800;
    case 'italic':
      return n === 1 ? 0 : 1;
    case 'px':
      return Math.max(1, Math.round((Number.isFinite(n) ? n : 16) * 1.5));
    case 'tracking':
      return (Number.isFinite(n) ? n : 0) + 0.25;
    case 'ink':
      return String(now).toLowerCase() === '#123456' ? '#654321' : '#123456';
    default: {
      const never: never = key;
      return never;
    }
  }
}

/** The trial's rules, laid the way a saved change is: with !important, and again in the layer that beats the film's own !important. */
function trialRules(key: OwnTextStyle, value: number | string, art: boolean): string {
  const declaration = key === 'ink' ? (art ? 'fill:' : 'color:') + String(value) + '!important' : typeRule(key, value);
  const rule = '[' + TRYING + '="' + key + '"]{' + declaration + '}';
  return rule + '@layer film-laid{' + rule + '}';
}

/** Whether an element shows: displayed, and visible where its nearest box is. */
function shows(el: Element): boolean {
  if (getComputedStyle(el).display === 'none') return false;
  let box: Element = el;
  while (box.parentElement && getComputedStyle(box).display === 'contents') box = box.parentElement;
  return typeof box.checkVisibility !== 'function' || box.checkVisibility();
}

/** The elements that hold the line's words themselves: those with text of their own, shown, and not a caption, pen or sheet. */
function wordHolders(el: Element): Element[] {
  const out: Element[] = [];
  const walk = (at: Element): void => {
    if (SKIP.test(at.tagName) || isPen(at) || at.classList.contains('film-caption')) return;
    let worded = false;
    for (let n = at.firstChild; n; n = n.nextSibling) {
      if (n instanceof Element) walk(n);
      else if (!worded && n instanceof Text && /\S/.test(n.data)) worded = true;
    }
    if (worded && shows(at)) out.push(at);
  };
  walk(el);
  return out;
}

/**
 * The styles of the line `el` that its words all set for themselves, of those `now` offers (a null is not offered).
 * Reads layout; run with no mark of the record's on the stage. A trial that throws tells nothing: none.
 */
export function ownStyles(stage: HTMLElement, el: Element, now: Partial<Record<OwnTextStyle, number | string | null>>): OwnTextStyle[] {
  const keys = OWN_TEXT_STYLES.filter((key) => now[key] !== null && now[key] !== undefined);
  if (keys.length === 0) return [];
  const words = wordHolders(el);
  if (words.length === 0) return [];
  const art = isArtWords(el);
  const sheet = document.createElement('style');
  const had = el.getAttribute(TRYING);
  const out: OwnTextStyle[] = [];
  try {
    stage.appendChild(sheet);
    for (const key of keys) {
      const value = now[key];
      if (value === null || value === undefined) continue;
      const lineBefore = shownOf(getComputedStyle(el), key, art);
      const before = words.map((word) => shownOf(getComputedStyle(word), key, art));
      sheet.textContent = trialRules(key, trialValue(key, value), art);
      el.setAttribute(TRYING, key);
      const lineDuring = shownOf(getComputedStyle(el), key, art);
      const during = words.map((word) => shownOf(getComputedStyle(word), key, art));
      el.removeAttribute(TRYING);
      const trials = before.map((was, i) => ({ before: was, during: during[i] ?? was }));
      if (ownByTrial({ before: lineBefore, during: lineDuring }, trials)) out.push(key);
    }
  } catch {
    return [];
  } finally {
    sheet.remove();
    if (had === null) el.removeAttribute(TRYING);
    else el.setAttribute(TRYING, had);
  }
  return out;
}
