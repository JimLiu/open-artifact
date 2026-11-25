/**
 * The release notes: CHANGELOG.md read into releases, for the page's "What's new" and its changelog. A host's server
 * reads its copy (the DSH plugin's: plugins/dsh/src/server/changelog.ts) and answers with them; the page draws them
 * (src/changelog.tsx). No Node or DOM code here.
 *
 * CHANGELOG.md is written by hand to one form (AGENTS.md, Releasing):
 *
 *   ## [0.9.0] - 2026-11-18
 *
 *   One-line summary.
 *
 *   ### Added
 *
 *   - An item, which may go on
 *     over indented lines.
 *
 *   [0.9.0]: https://github.com/…/compare/v0.2.2...v0.9.0
 */
import { isNewer } from './routes.ts';

/** One release's entry. Items keep their Markdown (`**bold**`, `` `code` ``, links), which the page draws. */
export interface ReleaseNotes {
  version: string;
  /** `YYYY-MM-DD`, or empty. */
  date: string;
  /** The paragraphs before the first `###`. */
  summary: string[];
  /** `Added`, `Changed`, `Fixed`, `Removed`, …, in the entry's order. */
  sections: { title: string; items: string[] }[];
}

/** What the changelog route answers. */
export interface ChangelogAnswer {
  /** The version installed. */
  version: string;
  /** The releases up to it, newest first. */
  releases: ReleaseNotes[];
  /** With `?upcoming=1`: the releases after it, up to the registry's latest, newest first; empty when none is known. */
  upcoming: ReleaseNotes[];
}

const RELEASE = /^## \[([^\]]+)\](?:\s*-\s*(\S+))?/;
const LINK_REFERENCE = /^\[[^\]]+\]:\s/;

/** Every release in a CHANGELOG.md, in its order (newest first). */
export function parseChangelog(text: string): ReleaseNotes[] {
  const releases: ReleaseNotes[] = [];
  let release: ReleaseNotes | null = null;
  let section: ReleaseNotes['sections'][number] | null = null;
  /** What the next indented line continues: an item, a summary paragraph, or nothing after a blank line. */
  let open: 'item' | 'summary' | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const head = RELEASE.exec(line);
    if (head) {
      release = { version: head[1]!.replace(/^v/, ''), date: head[2] ?? '', summary: [], sections: [] };
      releases.push(release);
      section = null;
      open = null;
      continue;
    }
    if (release === null) continue;
    if (line.startsWith('## ') || LINK_REFERENCE.test(line)) {
      release = null;
      continue;
    }
    if (line.startsWith('### ')) {
      section = { title: line.slice(4).trim(), items: [] };
      release.sections.push(section);
      open = null;
      continue;
    }
    const text = line.trim();
    if (text === '') {
      if (open === 'summary') open = null;
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(text);
    if (item && section !== null) {
      section.items.push(item[1]!);
      open = 'item';
    } else if (open === 'item' && section !== null && section.items.length > 0) {
      section.items[section.items.length - 1] += ` ${text}`;
    } else if (section === null) {
      if (open === 'summary') release.summary[release.summary.length - 1] += ` ${text}`;
      else release.summary.push(text);
      open = 'summary';
    }
  }
  return releases.filter((r) => r.summary.length > 0 || r.sections.some((s) => s.items.length > 0));
}

/** The releases after `after` (all of them when it is empty) up to and including `upTo`, newest first. */
export function releasesBetween(releases: readonly ReleaseNotes[], after: string, upTo: string): ReleaseNotes[] {
  return releases
    .filter((r) => !isNewer(r.version, upTo) && (after === '' || isNewer(r.version, after)))
    .sort((a, b) => (isNewer(a.version, b.version) ? -1 : isNewer(b.version, a.version) ? 1 : 0));
}

/** A piece of an item's Markdown: plain text, `code`, **bold** or a link. */
export type Inline = { kind: 'text' | 'code' | 'strong'; text: string } | { kind: 'link'; text: string; href: string };

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Splits an item's Markdown into the pieces the page draws. Links are kept only when they go to http(s). */
export function inlinePieces(text: string): Inline[] {
  const pieces: Inline[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > at) pieces.push({ kind: 'text', text: text.slice(at, match.index) });
    if (match[1] !== undefined) pieces.push({ kind: 'code', text: match[1] });
    else if (match[2] !== undefined) pieces.push({ kind: 'strong', text: match[2] });
    else if (/^https?:\/\//i.test(match[4]!)) pieces.push({ kind: 'link', text: match[3]!, href: match[4]! });
    else pieces.push({ kind: 'text', text: match[3]! });
    at = match.index + match[0].length;
  }
  if (at < text.length) pieces.push({ kind: 'text', text: text.slice(at) });
  return pieces;
}
