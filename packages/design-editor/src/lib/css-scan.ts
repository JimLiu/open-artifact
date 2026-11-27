/**
 * Reading a stylesheet the way a browser tokenizes it, as far as the HTML
 * exports need: where its comments, strings, `url(…)` references and
 * `@import` rules are, so that text inside a comment or a string is never
 * taken for a reference, and whether the file stops in the middle of one.
 */

/** A stretch of a stylesheet, as offsets into its text (`end` exclusive). */
export type CssPiece =
  | { kind: 'text' | 'comment' | 'string'; start: number; end: number }
  /** `target`: the address it names, `null` when it can't be read plainly (escapes, stray quotes). */
  | { kind: 'url'; start: number; end: number; target: string | null; quote: '"' | "'" | '' }
  /** `condition`: what follows the address up to the `;` (layer, supports, media), trimmed. */
  | { kind: 'import'; start: number; end: number; target: string | null; condition: string };

/** A stylesheet in pieces, and whether it ends inside a string, comment or `url(`. */
export interface CssScan {
  pieces: CssPiece[];
  unclosed: boolean;
}

const isSpace = (char: string | undefined): boolean => char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';

const isNameChar = (char: string | undefined): boolean => char !== undefined && (/[A-Za-z0-9_-]/.test(char) || char.charCodeAt(0) >= 0x80);

/** Where the name starting at `at` ends (a backslash takes the next character into the name). */
function nameEnd(css: string, at: number): number {
  let i = at;
  while (i < css.length) {
    if (css[i] === '\\' && i + 1 < css.length && css[i + 1] !== '\n') i += 2;
    else if (isNameChar(css[i])) i++;
    else break;
  }
  return i;
}

const skipSpace = (css: string, at: number): number => {
  let i = at;
  while (isSpace(css[i])) i++;
  return i;
};

/** Where the comment opening at `at` ends; one never closed runs to the end of the file. */
function commentEnd(css: string, at: number): { end: number; unclosed: boolean } {
  const close = css.indexOf('*/', at + 2);
  return close < 0 ? { end: css.length, unclosed: true } : { end: close + 2, unclosed: false };
}

interface StringRead {
  end: number;
  /** The characters between the quotes, when no backslash was used. */
  value: string | null;
  unclosed: boolean;
}

/** A quoted string starting at `at`. A raw line break ends it early, as browsers do. */
function readString(css: string, at: number): StringRead {
  const quote = css[at];
  let escaped = false;
  for (let i = at + 1; i < css.length; i++) {
    const char = css[i];
    if (char === '\\') {
      escaped = true;
      i++;
    } else if (char === quote) {
      return { end: i + 1, value: escaped ? null : css.slice(at + 1, i), unclosed: false };
    } else if (char === '\n' || char === '\r' || char === '\f') {
      return { end: i, value: null, unclosed: false };
    }
  }
  return { end: css.length, value: null, unclosed: true };
}

interface UrlRead {
  end: number;
  target: string | null;
  quote: '"' | "'" | '';
  unclosed: boolean;
}

/** The rest of a `url(` whose parenthesis is at `open - 1`. */
function readUrl(css: string, open: number): UrlRead {
  let i = skipSpace(css, open);
  const first = css[i];
  if (first === '"' || first === "'") {
    const string = readString(css, i);
    if (string.unclosed) return { end: css.length, target: null, quote: first, unclosed: true };
    i = skipSpace(css, string.end);
    if (css[i] === ')') return { end: i + 1, target: string.value, quote: first, unclosed: false };
    const close = css.indexOf(')', i);
    return close < 0 ? { end: css.length, target: null, quote: first, unclosed: true } : { end: close + 1, target: null, quote: first, unclosed: false };
  }
  const from = i;
  let plain = true;
  while (i < css.length) {
    const char = css[i];
    if (char === ')') {
      const target = css.slice(from, i).trimEnd();
      return { end: i + 1, target: plain && target ? target : null, quote: '', unclosed: false };
    }
    if (char === '\\') {
      plain = false;
      i += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === '(') plain = false;
    else if (isSpace(char) && css[skipSpace(css, i)] !== ')') plain = false;
    i++;
  }
  return { end: css.length, target: null, quote: '', unclosed: true };
}

interface ImportRead {
  piece: Extract<CssPiece, { kind: 'import' }>;
  unclosed: boolean;
}

/**
 * An `@import` whose name ends at `after`. Only white space may stand between
 * the name and its address; anything else is left as it is (`null`).
 */
function readImport(css: string, at: number, after: number): ImportRead | null {
  let i = skipSpace(css, after);
  let target: string | null;
  let unclosed = false;
  if (css[i] === '"' || css[i] === "'") {
    const string = readString(css, i);
    target = string.value;
    unclosed = string.unclosed;
    i = string.end;
  } else {
    const end = nameEnd(css, i);
    if (css.slice(i, end).toLowerCase() !== 'url' || css[end] !== '(') return null;
    const url = readUrl(css, end + 1);
    target = url.target;
    unclosed = url.unclosed;
    i = url.end;
  }
  const conditionStart = i;
  let depth = 0;
  // The rule ends at the first `;` outside parentheses, strings and comments.
  while (i < css.length && !unclosed) {
    const char = css[i];
    if (char === '"' || char === "'" || (char === '/' && css[i + 1] === '*')) {
      const skipped = char === '/' ? commentEnd(css, i) : readString(css, i);
      unclosed = skipped.unclosed;
      i = skipped.end;
      continue;
    }
    if (char === ';' && depth === 0) break;
    depth = Math.max(0, depth + (char === '(' ? 1 : char === ')' ? -1 : 0));
    i++;
  }
  const condition = css.slice(conditionStart, Math.min(i, css.length)).trim();
  const end = Math.min(css.length, i + 1);
  return { piece: { kind: 'import', start: at, end, target: unclosed ? null : target, condition }, unclosed };
}

/** A stylesheet's pieces, in order, covering all of its text. */
export function scanCss(css: string): CssScan {
  const pieces: CssPiece[] = [];
  let unclosed = false;
  let plainFrom = 0;
  const add = (piece: CssPiece): void => {
    if (piece.start > plainFrom) pieces.push({ kind: 'text', start: plainFrom, end: piece.start });
    pieces.push(piece);
    plainFrom = piece.end;
  };
  let i = 0;
  while (i < css.length) {
    const char = css[i]!;
    if (char === '/' && css[i + 1] === '*') {
      const comment = commentEnd(css, i);
      if (comment.unclosed) unclosed = true;
      add({ kind: 'comment', start: i, end: comment.end });
      i = comment.end;
    } else if (char === '"' || char === "'") {
      const string = readString(css, i);
      if (string.unclosed) unclosed = true;
      add({ kind: 'string', start: i, end: string.end });
      i = string.end;
    } else if (char === '\\') {
      i += 2;
    } else if (char === '@') {
      const end = nameEnd(css, i + 1);
      const rule = css.slice(i + 1, end).toLowerCase() === 'import' ? readImport(css, i, end) : null;
      if (rule) {
        if (rule.unclosed) unclosed = true;
        add(rule.piece);
        i = rule.piece.end;
      } else i = Math.max(end, i + 1);
    } else if (isNameChar(char)) {
      const end = nameEnd(css, i);
      if (css.slice(i, end).toLowerCase() === 'url' && css[end] === '(') {
        const url = readUrl(css, end + 1);
        if (url.unclosed) unclosed = true;
        add({ kind: 'url', start: i, end: url.end, target: url.target, quote: url.quote });
        i = url.end;
      } else i = end;
    } else {
      i++;
    }
  }
  if (css.length > plainFrom) pieces.push({ kind: 'text', start: plainFrom, end: css.length });
  return { pieces, unclosed };
}

/**
 * The stylesheet with no `{{` or `}}` left in it, so a page template never
 * reads part of it as a placeholder: inside strings and addresses a doubled
 * brace becomes a CSS escape of itself, elsewhere the two braces are spaced.
 */
export function escapeTemplateBraces(css: string): string {
  if (!/\{\{|\}\}/.test(css)) return css;
  let out = '';
  for (const piece of scanCss(css).pieces) {
    const text = css.slice(piece.start, piece.end);
    out += piece.kind === 'string' || piece.kind === 'url' ? text.replace(/\{\{/g, '{\\7b ').replace(/\}\}/g, '}\\7d ') : text;
  }
  // Braces that now meet across two pieces get the same spacing.
  return out.replace(/\{(?=\{)/g, '{ ').replace(/\}(?=\})/g, '} ');
}
