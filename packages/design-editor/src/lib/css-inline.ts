/**
 * Folding a stylesheet into one self-contained block for the single-file HTML
 * export: `url(…)` references to project files and uploads become `data:`
 * URLs, and `@import`ed stylesheets are written in place, inside the
 * `@layer`, `@supports` and `@media` blocks their import asked for. Only real
 * references count: an address inside a comment or a string is left alone.
 */

import { escapeTemplateBraces, scanCss } from './css-scan.ts';

/** What a stylesheet's references can point to. */
export interface CssSources {
  /** Project files by path: text, or bytes. */
  files: ReadonlyMap<string, Uint8Array | string>;
  /** Project files that aren't text, as `data:` URLs by path. */
  dataUrls: ReadonlyMap<string, string>;
  /** Uploads, as `data:` URLs by their `/_blob/…` reference. */
  uploads: ReadonlyMap<string, string>;
  /** A text file as a `data:` URL (for a `url()` that points at one). */
  textUrl(path: string, text: string): string;
}

/** How deep imports are followed; an import below that stays as it is. */
export const IMPORT_DEPTH = 10;

/** The warning for an import that names something other than a stylesheet. */
export const notCssWarning = (url: string): string => `stylesheet import not embedded (${url}): it is not a CSS file`;

/** The warning for an import inside an embedded stylesheet that can't move to the top with the conditions around it. */
export const unhoistableWarning = (url: string): string =>
  `stylesheet import left out (${url}): it is inside an embedded stylesheet whose layer or media conditions one @import can't carry — import it from the page's own stylesheet instead`;

/** The warning for an import whose stylesheet is cut off. */
export const unclosedWarning = (url: string): string =>
  `stylesheet import not embedded (${url}): the file ends inside an unclosed string, comment or url( — close it and export again`;

const dirOf = (path: string): string => path.slice(0, path.lastIndexOf('/') + 1);

/** An address with a scheme (`https:`, `data:`…), protocol-relative, or only a fragment: never a project file. */
const isElsewhere = (target: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('#');

/** A project path for `target` as read from the folder `dir`, or `null` when it climbs out of the project. */
function projectPath(dir: string, target: string): string | null {
  let path = target;
  try {
    path = decodeURIComponent(target);
  } catch {
    // Keep it as written.
  }
  const out: string[] = [];
  for (const part of (path.startsWith('/') ? path.slice(1) : dir + path).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

/** An address split into the file part and what follows it (`?query`, `#fragment`). */
function splitAddress(target: string): { file: string; tail: string } {
  const at = target.search(/[?#]/);
  return at < 0 ? { file: target, tail: '' } : { file: target.slice(0, at), tail: target.slice(at) };
}

/** A fragment kept after a `data:` URL, with what would break the `url()` escaped. */
const safeFragment = (tail: string): string => {
  const hash = tail.indexOf('#');
  if (hash < 0) return '';
  return tail.slice(hash).replace(/["'()\\\s]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
};

type Found =
  | { kind: 'upload'; url: string }
  | { kind: 'file'; path: string; data: Uint8Array | string }
  | null;

function find(target: string, from: string, sources: CssSources): Found {
  if (!target || isElsewhere(target)) return null;
  const { file } = splitAddress(target);
  if (file.startsWith('/_blob/')) {
    const url = sources.uploads.get(file);
    return url ? { kind: 'upload', url } : null;
  }
  const path = projectPath(dirOf(from), file);
  if (path === null) return null;
  const data = sources.files.get(path);
  return data === undefined ? null : { kind: 'file', path, data };
}

/** A `data:` URL for what an address found. */
function urlOf(found: NonNullable<Found>, sources: CssSources): string {
  if (found.kind === 'upload') return found.url;
  return sources.dataUrls.get(found.path) ?? (typeof found.data === 'string' ? sources.textUrl(found.path, found.data) : '');
}

/** A stylesheet's text, when what an import found is one. */
function stylesheetText(found: NonNullable<Found>): string | null {
  if (found.kind === 'upload') {
    const comma = found.url.indexOf(',');
    const header = found.url.slice(0, comma);
    if (comma < 0 || !/^data:text\/css(?:;|$)/i.test(header)) return null;
    const body = found.url.slice(comma + 1);
    if (!/;base64$/i.test(header)) return decodeURIComponent(body);
    const binary = atob(body);
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  }
  if (!/\.css$/i.test(found.path)) return null;
  return typeof found.data === 'string' ? found.data : new TextDecoder().decode(found.data);
}

/** What an import's condition asks for: a layer (`''` for an anonymous one), a supports test and media queries. */
interface Condition {
  layer: string | null;
  supports: string | null;
  media: string | null;
}

function readCondition(condition: string): Condition {
  let rest = condition.trim();
  const read: Condition = { layer: null, supports: null, media: null };
  const layer = /^layer(?:\(\s*([^)]*?)\s*\))?(?=\s|$|supports\(|\()/i.exec(rest);
  if (layer) {
    read.layer = layer[1] ?? '';
    rest = rest.slice(layer[0].length).trim();
  }
  if (/^supports\(/i.test(rest)) {
    let depth = 0;
    let end = -1;
    for (let i = 'supports'.length; i < rest.length; i++) {
      if (rest[i] === '(') depth++;
      else if (rest[i] === ')' && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end > 0) {
      read.supports = rest.slice('supports('.length, end).trim();
      rest = rest.slice(end + 1).trim();
    }
  }
  if (rest) read.media = rest;
  return read;
}

/** The blocks an import's condition opens, outermost first (`layer`, then `supports`, then media). */
function conditionBlocks(condition: Condition): string[] {
  const blocks: string[] = [];
  if (condition.layer !== null) blocks.push(condition.layer ? `@layer ${condition.layer}` : '@layer');
  if (condition.supports !== null) blocks.push(`@supports (${condition.supports})`);
  if (condition.media !== null) blocks.push(`@media ${condition.media}`);
  return blocks;
}

/**
 * The conditions of stylesheets written inside one another (outermost first)
 * said as one import's condition, or `null` when one `@import` can't say them:
 * an anonymous layer around or inside another layer has no name to join, and
 * two media query lists have no general "and" in import syntax.
 */
function joinConditions(conditions: readonly Condition[]): string | null {
  const layers = conditions.flatMap((item) => (item.layer === null ? [] : [item.layer]));
  const tests = conditions.flatMap((item) => (item.supports === null ? [] : [item.supports]));
  const media = conditions.flatMap((item) => (item.media === null ? [] : [item.media]));
  if ((layers.length > 1 && layers.includes('')) || media.length > 1) return null;
  const parts: string[] = [];
  if (layers.length) parts.push(layers[0] === '' ? 'layer' : `layer(${layers.join('.')})`);
  if (tests.length) parts.push(tests.length === 1 ? `supports(${tests[0]})` : `supports(${tests.map((test) => `(${test})`).join(' and ')})`);
  parts.push(...media);
  return parts.join(' ');
}

/** The address of an `@import` rule as written, between `@import` and its condition. */
function importAddress(text: string, condition: string): string {
  const rest = text.slice('@import'.length);
  const at = condition ? rest.lastIndexOf(condition) : -1;
  return (at < 0 ? rest.replace(/;\s*$/, '') : rest.slice(0, at)).trim();
}

/** A stylesheet without the `@charset` it may open with (it means nothing inside another one). */
const withoutCharset = (css: string): string => css.replace(/^﻿?@charset\s+"[^"]*"\s*;\s*/i, '');

interface Walk {
  sources: CssSources;
  warnings: Set<string>;
  /** Stylesheets being written, to stop an import loop. */
  open: readonly string[];
  /** The conditions of the imports whose stylesheets are being written, outermost first. */
  conditions: readonly Condition[];
  /** Imports that stay imports but came after a stylesheet written in place, for the top of the outermost one. */
  hoisted: string[];
}

/**
 * Only the top of a stylesheet may hold `@import` rules: a browser drops one
 * after any other rule. So once an imported stylesheet is written in place,
 * the imports that stay (a web font from another site, a file not in the
 * project) can't stay where they were. They move up to just before the first
 * stylesheet written in place, which is where the outermost stylesheet's own
 * imports start, so anything it has above them (`@charset`, `@layer` names)
 * still comes first.
 */
function inline(css: string, from: string, walk: Walk): string {
  const scan = scanCss(css);
  const top = walk.conditions.length === 0;
  /** Where the first stylesheet written in place starts in `out`. */
  let firstBody = -1;
  let out = '';
  for (const piece of scan.pieces) {
    const text = css.slice(piece.start, piece.end);
    if (piece.kind === 'url') {
      const found = piece.target === null ? null : find(piece.target, from, walk.sources);
      const url = found ? urlOf(found, walk.sources) : '';
      out += url && piece.target !== null ? `url(${piece.quote}${url}${safeFragment(splitAddress(piece.target).tail)}${piece.quote})` : text;
    } else if (piece.kind === 'import') {
      const body = importBody(piece.target, piece.condition, from, walk);
      if (body !== null) {
        if (firstBody < 0) firstBody = out.length;
        out += body;
      } else if (top && firstBody < 0) out += text;
      else hoist(piece.target, piece.condition, text, walk);
    } else out += text;
  }
  if (!top || !walk.hoisted.length) return out;
  return `${out.slice(0, firstBody)}${walk.hoisted.map((rule) => `${rule}\n`).join('')}${out.slice(firstBody)}`;
}

/** An import that stays, queued for the top with the conditions of the stylesheets around it; left out with a warning when one `@import` can't carry them. */
function hoist(target: string | null, condition: string, text: string, walk: Walk): void {
  if (!walk.conditions.length) {
    walk.hoisted.push(text.trimEnd().endsWith(';') ? text.trimEnd() : `${text.trimEnd()};`);
    return;
  }
  const joined = joinConditions([...walk.conditions, readCondition(condition)]);
  if (joined === null) {
    walk.warnings.add(unhoistableWarning(target ?? importAddress(text, condition)));
    return;
  }
  walk.hoisted.push(escapeTemplateBraces(`@import ${importAddress(text, condition)}${joined ? ` ${joined}` : ''};`));
}

/** The imported stylesheet written in place inside its condition's blocks, or `null` when the import stays an import. */
function importBody(target: string | null, condition: string, from: string, walk: Walk): string | null {
  if (target === null || walk.open.length > IMPORT_DEPTH) return null;
  const found = find(target, from, walk.sources);
  if (!found) return null;
  const key = found.kind === 'upload' ? splitAddress(target).file : found.path;
  if (walk.open.includes(key)) return null;
  const css = stylesheetText(found);
  if (css === null) {
    walk.warnings.add(notCssWarning(target));
    return null;
  }
  if (scanCss(css).unclosed) {
    walk.warnings.add(unclosedWarning(target));
    return null;
  }
  const read = readCondition(condition);
  const body = escapeTemplateBraces(
    inline(withoutCharset(css), found.kind === 'upload' ? from : found.path, { ...walk, open: [...walk.open, key], conditions: [...walk.conditions, read] }),
  );
  const blocks = conditionBlocks(read);
  return `/**/${blocks.map((block) => `${block} {\n`).join('')}${body}${blocks.map(() => '\n}').join('')}/**/`;
}

/**
 * The stylesheet at project path `from` (or written in the page at that
 * path), with its references embedded. Warnings for imports that could not
 * be embedded are added to `warnings`.
 */
export function inlineCss(css: string, from: string, sources: CssSources, warnings: Set<string>): string {
  return inline(css, from, { sources, warnings, open: [from], conditions: [], hoisted: [] });
}
