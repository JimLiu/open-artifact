/** The languages a code block offers, how they read in the bar, and which grammar highlights each. */
import { CODE_LANGUAGES, type CodeLanguage } from '../insert/languages.ts';

export type { CodeLanguage };
export { CODE_LANGUAGES };

/** Languages drawn live above their source: a table, a formula, a preview, a diagram. */
export type LiveKind = 'csv' | 'latex' | 'markdown' | 'mermaid';

const LIVE: ReadonlySet<string> = new Set<LiveKind>(['csv', 'latex', 'markdown', 'mermaid']);

/** The grammar each language highlights with; missing means none (plain text, or no grammar for it). */
const GRAMMARS: Readonly<Record<string, string>> = {
  bash: 'bash',
  css: 'css',
  html: 'xml',
  javascript: 'javascript',
  json: 'json',
  latex: 'latex',
  markdown: 'markdown',
  python: 'python',
  sql: 'sql',
  typescript: 'typescript',
  xml: 'xml',
  yaml: 'yaml',
};

/** The grammars auto-detection picks between. */
export const AUTO_GRAMMARS: readonly string[] = ['bash', 'css', 'xml', 'javascript', 'json', 'python', 'sql', 'typescript', 'yaml'];

/** The language a stored name means: by key or alias, ignoring case. */
export function findLanguage(name: string | null | undefined): CodeLanguage | null {
  if (!name) return null;
  const wanted = name.trim().toLowerCase();
  return CODE_LANGUAGES.find(language => language.key === wanted || language.aliases.includes(wanted)) ?? null;
}

export function liveKind(name: string | null | undefined): LiveKind | null {
  const key = findLanguage(name)?.key;
  return key && LIVE.has(key) ? (key as LiveKind) : null;
}

/** The grammar for a stored language: null for none, `auto` when the block names no language. */
export function grammarFor(name: string | null | undefined): string | 'auto' | null {
  if (!name) return 'auto';
  const key = findLanguage(name)?.key;
  return key ? (GRAMMARS[key] ?? null) : null;
}

/** A grammar's name as the bar shows it (`xml` reads as XML, `javascript` as JavaScript). */
export function grammarLabel(grammar: string): string {
  const language = CODE_LANGUAGES.find(item => item.key === grammar || GRAMMARS[item.key] === grammar);
  return language?.label ?? grammar;
}

/** What the language button reads: the language's name, or `auto` with what was detected. */
export function languageLabel(name: string | null | undefined, detected?: string | null): string {
  if (!name) return detected ? `auto (${grammarLabel(detected)})` : 'auto';
  return findLanguage(name)?.label ?? name;
}

/** The languages the picker lists for `query` (by key, name or alias); an empty query lists them all. */
export function filterLanguages(query: string): CodeLanguage[] {
  const wanted = query.trim().toLowerCase();
  const listed = CODE_LANGUAGES.filter(language => !language.unlisted);
  if (!wanted) return listed;
  return listed.filter(
    language => language.key.includes(wanted) || language.label.toLowerCase().includes(wanted) || language.aliases.some(alias => alias.includes(wanted)),
  );
}
