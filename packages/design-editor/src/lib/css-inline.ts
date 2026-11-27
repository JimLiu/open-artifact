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

/** The blocks an import's condition opens, outermost first (`layer`, then `supports`, then media). */
function conditionBlocks(condition: string): string[] {
  let rest = condition.trim();
  const blocks: string[] = [];
  const layer = /^layer(?:\(\s*([^)]*?)\s*\))?(?=\s|$|supports\(|\()/i.exec(rest);
  if (layer) {
    blocks.push(layer[1] ? `@layer ${layer[1]}` : '@layer');
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
      blocks.push(`@supports (${rest.slice('supports('.length, end).trim()})`);
      rest = rest.slice(end + 1).trim();
    }
  }
  if (rest) blocks.push(`@media ${rest}`);
  return blocks;
}

/** A stylesheet without the `@charset` it may open with (it means nothing inside another one). */
const withoutCharset = (css: string): string => css.replace(/^﻿?@charset\s+"[^"]*"\s*;\s*/i, '');

interface Walk {
  sources: CssSources;
  warnings: Set<string>;
  /** Stylesheets being written, to stop an import loop. */
  open: readonly string[];
}

function inline(css: string, from: string, walk: Walk): string {
  const scan = scanCss(css);
  let out = '';
  for (const piece of scan.pieces) {
    const text = css.slice(piece.start, piece.end);
    if (piece.kind === 'url') {
      const found = piece.target === null ? null : find(piece.target, from, walk.sources);
      const url = found ? urlOf(found, walk.sources) : '';
      out += url && piece.target !== null ? `url(${piece.quote}${url}${safeFragment(splitAddress(piece.target).tail)}${piece.quote})` : text;
    } else if (piece.kind === 'import') {
      out += importRule(piece.target, piece.condition, text, from, walk);
    } else out += text;
  }
  return out;
}

function importRule(target: string | null, condition: string, text: string, from: string, walk: Walk): string {
  if (target === null || walk.open.length > IMPORT_DEPTH) return text;
  const found = find(target, from, walk.sources);
  if (!found) return text;
  const key = found.kind === 'upload' ? splitAddress(target).file : found.path;
  if (walk.open.includes(key)) return text;
  const css = stylesheetText(found);
  if (css === null) {
    walk.warnings.add(notCssWarning(target));
    return text;
  }
  if (scanCss(css).unclosed) {
    walk.warnings.add(unclosedWarning(target));
    return text;
  }
  const body = escapeTemplateBraces(inline(withoutCharset(css), found.kind === 'upload' ? from : found.path, { ...walk, open: [...walk.open, key] }));
  const blocks = conditionBlocks(condition);
  return `/**/${blocks.map((block) => `${block} {\n`).join('')}${body}${blocks.map(() => '\n}').join('')}/**/`;
}

/**
 * The stylesheet at project path `from` (or written in the page at that
 * path), with its references embedded. Warnings for imports that could not
 * be embedded are added to `warnings`.
 */
export function inlineCss(css: string, from: string, sources: CssSources, warnings: Set<string>): string {
  return inline(css, from, { sources, warnings, open: [from] });
}
