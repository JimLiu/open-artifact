/**
 * Laying a document out as it prints, without printing it: every media query of its stylesheets is rewritten to what it
 * is worth on paper, so `@media print` rules apply, `@media screen` ones don't, and the colour scheme is the light one
 * (browsers print light). The PDF export lays its copy of the dashboard out this way ({@link emulatePrintMedia}); the
 * rewriting itself is text to text ({@link printMediaQuery}) and runs without a DOM.
 */

/** A feature that never holds where a page is laid out (no page is 0 px wide), and one that always does. */
const NEVER = '(max-width:0px)';
const ALWAYS = '(min-width:0px)';
const COLOR_SCHEME = /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi;
const TYPED_QUERY = /^(?:(not|only)\s+)?(print|screen)\b\s*(?:and\s+([\s\S]+))?$/i;

/** Splits a media query list at its top-level commas. */
function splitQueries(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** One query as it evaluates on paper. */
function printQuery(query: string): string {
  const featured = query.trim().replace(COLOR_SCHEME, (_match, scheme: string) => (scheme.toLowerCase() === 'dark' ? NEVER : ALWAYS));
  const typed = TYPED_QUERY.exec(featured);
  if (typed === null) return featured;
  const negated = typed[1]?.toLowerCase() === 'not';
  const print = typed[2]!.toLowerCase() === 'print';
  const rest = typed[3]?.trim();
  // `not` negates the whole query (the type and its features). On paper `print` holds and `screen` doesn't, so a
  // `screen` query is decided whatever its features say.
  if (!print) return negated ? 'all' : 'not all';
  if (rest === undefined || rest === '') return negated ? 'not all' : 'all';
  return `${negated ? 'not all' : 'all'} and ${rest}`;
}

/**
 * A media query list as it evaluates when printing, to use on screen: `print` → `all`, `screen` → `not all`,
 * `(prefers-color-scheme: dark)` never holds. Queries about other things (sizes, hover…) stay as they are.
 * Returns null when nothing changes.
 */
export function printMediaQuery(text: string): string | null {
  if (!/print|screen|prefers-color-scheme/i.test(text)) return null;
  const rewritten = splitQueries(text).map(printQuery).join(', ');
  return rewritten === splitQueries(text).map((query) => query.trim()).join(', ') ? null : rewritten;
}

function rewriteMedia(media: MediaList | null | undefined): void {
  if (!media || typeof media.mediaText !== 'string' || media.mediaText === '') return;
  const next = printMediaQuery(media.mediaText);
  if (next === null) return;
  try {
    media.mediaText = next;
  } catch {
    // A media list that can't be changed keeps its screen meaning.
  }
}

function rewriteRules(sheet: CSSStyleSheet | CSSGroupingRule, seen: Set<object>): void {
  if (seen.has(sheet)) return;
  seen.add(sheet);
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    // A stylesheet from another origin hides its rules: it stays as it is.
    return;
  }
  for (const rule of rules) {
    const media = (rule as Partial<CSSMediaRule>).media;
    if (media !== undefined) rewriteMedia(media);
    const imported = (rule as Partial<CSSImportRule>).styleSheet;
    if (imported) rewriteRules(imported, seen);
    if ('cssRules' in rule) rewriteRules(rule as CSSGroupingRule, seen);
  }
}

/**
 * Makes the document lay out as it prints: rewrites the media of every stylesheet and rule it can read
 * ({@link printMediaQuery}). The document stays that way, so use it on a copy.
 */
export function emulatePrintMedia(doc: Document): void {
  const seen = new Set<object>();
  for (const sheet of [...doc.styleSheets, ...(doc.adoptedStyleSheets ?? [])]) {
    rewriteMedia(sheet.media);
    rewriteRules(sheet, seen);
  }
}
