import { mayStartMention, mentionSource } from './mentions.ts';

export type MdInline =
  | { t: 'text'; text: string }
  | { t: 'mention'; text: string }
  | { t: 'code'; text: string }
  | { t: 'em' | 'strong' | 'del'; c: MdInline[] }
  | { t: 'link'; href: string; c: MdInline[] };

export type MdBlock =
  | { t: 'p'; c: MdInline[] }
  | { t: 'h'; level: number; c: MdInline[] }
  | { t: 'code'; text: string; lang: string }
  | { t: 'quote'; c: MdBlock[] }
  | { t: 'list'; ordered: boolean; start: number; items: MdBlock[][] }
  | { t: 'hr' };

/** Past these a comment is drawn as plain text. */
export const COMMENT_MARKDOWN_LIMITS = {
  /** Characters of text. */
  length: 20_000,
  /** Blocks or inline marks inside each other. */
  depth: 50,
  /** Emphasis delimiter runs in one paragraph (more are left as typed). */
  delimiters: 400,
};

class TooCostly extends Error {}

/** Whether the text holds anything Markdown would change (else it is drawn as it is). */
export function hasMarkdown(text: string): boolean {
  return /[`*_~[\]<\\]|https?:\/\/|www\.|^[ \t]*(?:>|#{1,6}(?:[ \t]|$)|[-+*][ \t]|\d{1,9}[.)][ \t]|(?:[-*_][ \t]*){3,}$)/im.test(text);
}

/**
 * The comment's blocks; `null` when it is too big or nested too deep to draw (show it as plain text).
 * `mentions`: the names an `@name` may be (people and the agent).
 */
export function parseCommentMarkdown(text: string, mentions: readonly string[] = []): MdBlock[] | null {
  if (text.length > COMMENT_MARKDOWN_LIMITS.length || nestedTooDeep(text)) return null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const context: Context = { mentions: mentionPattern(mentions) };
  try {
    return parseBlocks(lines, 0, context);
  } catch (error) {
    if (error instanceof TooCostly) return null;
    throw error;
  }
}

/** The blocks are one paragraph: the text can be drawn inline (folded by lines like plain text). */
export function inlineOnly(blocks: readonly MdBlock[]): MdInline[] | null {
  return blocks.length === 1 && blocks[0]!.t === 'p' ? blocks[0]!.c : blocks.length === 0 ? [] : null;
}

/** The address a link may open: http(s), mailto and tel; `www.` gets `http://`. Anything else is not a link. */
export function safeHref(url: string): string | null {
  const href = url.trim();
  if (/[\u0000-\u001f\u007f\s\\]/.test(href)) return null;
  if (/^www\./i.test(href)) return `http://${href}`;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  if (scheme === 'http' || scheme === 'https') return /^https?:\/\/[^/?#\s]/i.test(href) ? href : null;
  if (scheme === 'mailto' || scheme === 'tel') return href.length > scheme.length + 1 ? href : null;
  return null;
}

function nestedTooDeep(text: string): boolean {
  return text.split(/[\n\r]/).some(line => (line.match(/>|(?:[-+*]|\d[.)])(?=[ \t])/g)?.length ?? 0) >= 50 || /^(?:[ >]{0,3}\t|[ >]{4}){25}/.test(line));
}

interface Context {
  mentions: RegExp | null;
}

/** `@name` at the start of the rest of a text, for the names given (longest first, as splitMentions does). */
function mentionPattern(names: readonly string[]): RegExp | null {
  const source = mentionSource(names);
  return source ? new RegExp(`^${source}`, 'iu') : null;
}

// ---- blocks ------------------------------------------------------------------------------------------------------

const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^`]*)$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( {0,3})([-+*]|(\d{1,9})([.)]))(?:([ \t]+)(.*))?$/;

const isBlank = (line: string) => /^[ \t]*$/.test(line);
const expandTabs = (line: string) => line.replace(/^[ \t]+/, lead => lead.replace(/\t/g, '    '));
const indentOf = (line: string) => /^ */.exec(expandTabs(line))![0].length;

interface Item {
  ordered: boolean;
  /** The marker's kind: `-`, `+`, `*`, `.` or `)`. */
  kind: string;
  n: number;
  /** Where the item's own text starts: continuation lines indented this far belong to it. */
  content: number;
  rest: string;
}

/** A list item's first line; one that would break a paragraph must have text, and an ordered one start at 1. */
function listItem(line: string, interrupting: boolean): Item | null {
  if (RULE.test(line)) return null;
  const match = ITEM.exec(expandTabs(line));
  if (!match) return null;
  const [, lead = '', marker = '', number, delimiter = '', gap = '', rest = ''] = match;
  if (gap === '' && rest !== '') return null;
  if (interrupting && (rest.trim() === '' || (number !== undefined && Number(number) !== 1))) return null;
  const pad = gap.length > 4 || rest === '' ? 1 : gap.length;
  return {
    ordered: number !== undefined,
    kind: number !== undefined ? delimiter : marker,
    n: number !== undefined ? Number(number) : 1,
    content: lead.length + marker.length + pad,
    rest: ' '.repeat(Math.max(0, gap.length - pad)) + rest,
  };
}

function fence(line: string): { indent: number; ch: string; n: number; lang: string } | null {
  const match = FENCE.exec(line);
  if (!match) return null;
  const [, indent = '', marks = '', info = ''] = match;
  return { indent: indent.length, ch: marks[0]!, n: marks.length, lang: info.trim().split(/\s+/)[0] ?? '' };
}

/** Whether a line starts a block that ends the paragraph before it. */
function breaksParagraph(line: string): boolean {
  return fence(line) !== null || RULE.test(line) || HEADING.test(line) || QUOTE.test(line) || listItem(line, true) !== null;
}

function parseBlocks(lines: readonly string[], depth: number, context: Context): MdBlock[] {
  if (depth > COMMENT_MARKDOWN_LIMITS.depth) throw new TooCostly();
  const out: MdBlock[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at]!;
    if (isBlank(line)) {
      at++;
      continue;
    }
    const open = fence(line);
    if (open) {
      const body: string[] = [];
      at++;
      const close = new RegExp(`^ {0,3}${open.ch === '`' ? '`' : '~'}{${open.n},}[ \\t]*$`);
      while (at < lines.length && !close.test(lines[at]!)) {
        const inner = lines[at]!;
        body.push(inner.slice(Math.min(open.indent, indentOf(inner))));
        at++;
      }
      at++;
      out.push({ t: 'code', text: body.join('\n'), lang: open.lang });
      continue;
    }
    if (RULE.test(line)) {
      out.push({ t: 'hr' });
      at++;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      out.push({ t: 'h', level: heading[1]!.length, c: parseInline(heading[2] ?? '', depth, context) });
      at++;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (at < lines.length && QUOTE.test(lines[at]!)) inner.push(lines[at++]!.replace(QUOTE, ''));
      out.push({ t: 'quote', c: parseBlocks(inner, depth + 1, context) });
      continue;
    }
    const first = listItem(line, false);
    if (first) {
      at = parseList(lines, at, first, depth, context, out);
      continue;
    }
    const paragraph = [line];
    for (at++; at < lines.length && !isBlank(lines[at]!) && !breaksParagraph(lines[at]!); at++) paragraph.push(lines[at]!);
    out.push({ t: 'p', c: parseInline(paragraph.join('\n').replace(/^[ \t]+/, ''), depth, context) });
  }
  return out;
}

/** A list from its first item at `start`; pushes it to `out` and answers the line after it. */
function parseList(lines: readonly string[], start: number, first: Item, depth: number, context: Context, out: MdBlock[]): number {
  const items: MdBlock[][] = [];
  let item: Item | null = first;
  let at = start;
  while (item) {
    const current: Item = item;
    const body = [current.rest];
    let next: Item | null = null;
    let blankBefore = false;
    for (at++; at < lines.length; at++) {
      const line = lines[at]!;
      if (isBlank(line)) {
        blankBefore = true;
        body.push('');
        continue;
      }
      const indent = indentOf(line);
      if (indent >= current.content) {
        body.push(expandTabs(line).slice(current.content));
        blankBefore = false;
        continue;
      }
      const sibling = listItem(line, false);
      if (sibling && sibling.ordered === first.ordered && sibling.kind === first.kind) next = sibling;
      else if (!blankBefore && !sibling && !breaksParagraph(line) && body.some(text => !isBlank(text))) {
        // A lazy line: the paragraph of the item goes on.
        body.push(line.trimStart());
        continue;
      }
      break;
    }
    while (body.length && isBlank(body[body.length - 1]!)) body.pop();
    items.push(parseBlocks(body, depth + 1, context));
    item = next;
  }
  out.push({ t: 'list', ordered: first.ordered, start: first.n, items });
  return at;
}

// ---- inline ------------------------------------------------------------------------------------------------------

interface Delimiter {
  t: 'delim';
  ch: string;
  /** Characters of the run still unmatched. */
  n: number;
  /** The run's length as typed (CommonMark's rule of three). */
  orig: number;
  open: boolean;
  close: boolean;
}

type Token = MdInline | Delimiter;

const PUNCTUATION = /[\p{P}\p{S}]/u;
const SPACE = /\s/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u;
const ESCAPABLE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const BARE_URL = /^(?:https?:\/\/|www\.)[^\s<]+/i;
const AUTOLINK = /^<((?:https?|mailto|tel):[^\s<>]*)>/i;

const isSpace = (c: string | undefined) => c === undefined || SPACE.test(c);
const isPunct = (c: string | undefined) => c !== undefined && PUNCTUATION.test(c);

/** Whether a delimiter run between `before` and `after` can open or close emphasis (CommonMark's flanking rules). */
function flanking(ch: string, before: string | undefined, after: string | undefined): { open: boolean; close: boolean } {
  // Next to Chinese, Japanese or Korean text there are no spaces to tell by: only white space keeps a run from flanking.
  const cjk = (before !== undefined && CJK.test(before)) || (after !== undefined && CJK.test(after));
  const left = !isSpace(after) && (cjk || !isPunct(after) || isSpace(before) || isPunct(before));
  const right = !isSpace(before) && (cjk || !isPunct(before) || isSpace(after) || isPunct(after));
  if (ch === '_') return { open: left && (!right || isPunct(before)), close: right && (!left || isPunct(after)) };
  return { open: left, close: right };
}

/** A bare URL without the punctuation that ends the sentence around it, nor a closing parenthesis it did not open. */
function trimUrl(url: string): string {
  let end = url.length;
  for (;;) {
    const c = url[end - 1];
    const kept = url.slice(0, end);
    if (c !== undefined && /[?!.,:;*_~'"]/.test(c)) end--;
    else if (c === ')' && kept.split(')').length > kept.split('(').length) end--;
    else return kept;
  }
}

/** A `[label](destination "title")` at `open`: the label's text, the destination and where it ends. */
function linkAt(text: string, open: number): { label: string; href: string; end: number } | null {
  let level = 0;
  let close = -1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '`') {
      const run = /^`+/.exec(text.slice(i))![0];
      const end = text.indexOf(run, i + run.length);
      if (end > 0) i = end + run.length - 1;
      continue;
    }
    if (c === '[') level++;
    else if (c === ']' && --level === 0) {
      close = i;
      break;
    }
  }
  if (close < 0 || text[close + 1] !== '(') return null;
  let at = close + 2;
  while (text[at] === ' ' || text[at] === '\t' || text[at] === '\n') at++;
  let href = '';
  if (text[at] === '<') {
    const end = text.indexOf('>', at);
    if (end < 0 || /[\n<]/.test(text.slice(at + 1, end))) return null;
    href = text.slice(at + 1, end);
    at = end + 1;
  } else {
    let parens = 0;
    const from = at;
    for (; at < text.length; at++) {
      const c = text[at]!;
      if (c === '\\' && ESCAPABLE.test(text[at + 1] ?? '')) {
        at++;
        continue;
      }
      if (SPACE.test(c) || c < ' ') break;
      if (c === '(') parens++;
      else if (c === ')') {
        if (parens === 0) break;
        parens--;
      }
    }
    if (parens !== 0) return null;
    href = text.slice(from, at).replace(/\\([!-/:-@[-`{-~])/g, '$1');
  }
  while (text[at] === ' ' || text[at] === '\t' || text[at] === '\n') at++;
  const title = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\))/.exec(text.slice(at));
  if (title && at > 0 && SPACE.test(text[at - 1]!)) {
    at += title[0].length;
    while (text[at] === ' ' || text[at] === '\t' || text[at] === '\n') at++;
  }
  if (text[at] !== ')') return null;
  return { label: text.slice(open + 1, close), href, end: at + 1 };
}

function parseInline(text: string, depth: number, context: Context, inLink = false): MdInline[] {
  if (depth > COMMENT_MARKDOWN_LIMITS.depth) throw new TooCostly();
  const tokens: Token[] = [];
  let run = '';
  let delimiters = 0;
  const flush = () => {
    if (run) tokens.push({ t: 'text', text: run });
    run = '';
  };
  let at = 0;
  while (at < text.length) {
    const ch = text[at]!;
    const before = at > 0 ? text[at - 1] : undefined;
    if (ch === '\\' && ESCAPABLE.test(text[at + 1] ?? '')) {
      run += text[at + 1];
      at += 2;
      continue;
    }
    if (ch === '`') {
      const ticks = /^`+/.exec(text.slice(at))![0];
      let close = -1;
      for (let i = text.indexOf(ticks, at + ticks.length); i >= 0; i = text.indexOf(ticks, i + 1)) {
        const length = /^`+/.exec(text.slice(i))![0].length;
        if (length === ticks.length && text[i - 1] !== '`') {
          close = i;
          break;
        }
        i += length - 1;
      }
      if (close < 0) {
        run += ticks;
        at += ticks.length;
        continue;
      }
      let code = text.slice(at + ticks.length, close).replace(/\n/g, ' ');
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') code = code.slice(1, -1);
      flush();
      tokens.push({ t: 'code', text: code });
      at = close + ticks.length;
      continue;
    }
    if (ch === '<') {
      const auto = AUTOLINK.exec(text.slice(at));
      const href = auto && !inLink ? safeHref(auto[1]!) : null;
      if (auto && href) {
        flush();
        tokens.push({ t: 'link', href, c: [{ t: 'text', text: auto[1]! }] });
        at += auto[0].length;
        continue;
      }
      run += ch;
      at++;
      continue;
    }
    if (ch === '!' && text[at + 1] === '[') {
      // A picture stays as typed: comments show no images.
      const picture = linkAt(text, at + 1);
      if (picture) {
        run += text.slice(at, picture.end);
        at = picture.end;
        continue;
      }
    }
    if (ch === '[' && !inLink) {
      const link = linkAt(text, at);
      if (link) {
        const href = safeHref(link.href);
        const label = href ? parseInline(link.label, depth + 1, context, true) : [];
        flush();
        // A link to anywhere else (javascript:, data:, a relative path) stays as typed.
        tokens.push(href ? { t: 'link', href, c: label.length ? label : [{ t: 'text', text: link.href }] } : { t: 'text', text: text.slice(at, link.end) });
        at = link.end;
        continue;
      }
    }
    if ((ch === 'h' || ch === 'H' || ch === 'w' || ch === 'W') && !inLink && (before === undefined || !/[\p{L}\p{N}_/@.:-]/u.test(before))) {
      const bare = BARE_URL.exec(text.slice(at));
      const url = bare ? trimUrl(bare[0]) : '';
      const href = url && !/^www\.$/i.test(url) && !/^https?:\/\/$/i.test(url) ? safeHref(url) : null;
      if (href) {
        flush();
        tokens.push({ t: 'link', href, c: [{ t: 'text', text: url }] });
        at += url.length;
        continue;
      }
    }
    if (ch === '@' && context.mentions && mayStartMention(before)) {
      const mention = context.mentions.exec(text.slice(at));
      if (mention) {
        flush();
        tokens.push({ t: 'mention', text: mention[0] });
        at += mention[0].length;
        continue;
      }
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      const length = /^(\*+|_+|~+)/.exec(text.slice(at))![0].length;
      const f = flanking(ch, before, text[at + length]);
      if ((f.open || f.close) && (ch !== '~' || length === 2) && delimiters < COMMENT_MARKDOWN_LIMITS.delimiters) {
        flush();
        tokens.push({ t: 'delim', ch, n: length, orig: length, ...f });
        delimiters++;
      } else run += text.slice(at, at + length);
      at += length;
      continue;
    }
    run += ch;
    at++;
  }
  flush();
  return merge(emphasis(tokens), depth);
}

const isDelimiter = (token: Token): token is Delimiter => token.t === 'delim';
const asInline = (token: Token): MdInline => (isDelimiter(token) ? { t: 'text', text: token.ch.repeat(token.n) } : token);

/** Pairs delimiter runs into em, strong and del, CommonMark's way (the rule of three included). */
function emphasis(input: Token[]): MdInline[] {
  const tokens = [...input];
  let at = 0;
  while (at < tokens.length) {
    const closer = tokens[at]!;
    if (!isDelimiter(closer) || !closer.close || closer.n === 0) {
      at++;
      continue;
    }
    let opener = -1;
    for (let i = at - 1; i >= 0; i--) {
      const token = tokens[i]!;
      if (!isDelimiter(token) || token.ch !== closer.ch || !token.open || token.n === 0) continue;
      if (closer.ch === '~') {
        if (token.n === 2 && closer.n === 2) opener = i;
        if (opener >= 0) break;
        continue;
      }
      const odd = (token.close || closer.open) && (token.orig + closer.orig) % 3 === 0 && (token.orig % 3 !== 0 || closer.orig % 3 !== 0);
      if (!odd) {
        opener = i;
        break;
      }
    }
    if (opener < 0) {
      at++;
      continue;
    }
    const open = tokens[opener] as Delimiter;
    const used = closer.ch === '~' ? 2 : open.n >= 2 && closer.n >= 2 ? 2 : 1;
    const node: MdInline = { t: closer.ch === '~' ? 'del' : used === 2 ? 'strong' : 'em', c: tokens.slice(opener + 1, at).map(asInline) };
    open.n -= used;
    closer.n -= used;
    const head = open.n > 0 ? opener + 1 : opener;
    const tail = closer.n > 0 ? at : at + 1;
    tokens.splice(head, tail - head, node, ...(closer.n > 0 ? [closer] : []));
    at = head + 1;
  }
  return tokens.map(asInline);
}

/** Adjacent text runs joined, empty ones dropped; deeper than the limit is too costly. */
function merge(nodes: MdInline[], depth: number): MdInline[] {
  const out: MdInline[] = [];
  for (const node of nodes) {
    if (node.t === 'em' || node.t === 'strong' || node.t === 'del' || node.t === 'link') {
      if (depth > COMMENT_MARKDOWN_LIMITS.depth) throw new TooCostly();
      out.push({ ...node, c: merge(node.c, depth + 1) });
      continue;
    }
    if (node.t === 'text') {
      if (!node.text) continue;
      const last = out[out.length - 1];
      if (last?.t === 'text') {
        out[out.length - 1] = { t: 'text', text: last.text + node.text };
        continue;
      }
    }
    out.push(node);
  }
  return out;
}

/** The text a reader sees, without the marks (for a label or a check). */
export function plainText(nodes: readonly MdInline[]): string {
  return nodes.map(node => (node.t === 'text' || node.t === 'mention' || node.t === 'code' ? node.text : plainText(node.c))).join('');
}
