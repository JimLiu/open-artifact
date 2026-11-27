/** The languages a code block can be made in from the slash menu. */

export interface CodeLanguage {
  /** What the code block's `language` attr is set to. */
  key: string;
  label: string;
  aliases: readonly string[];
  /** Words that find it in the slash menu only. */
  slashOnly?: readonly string[];
  /** Named in the bar when a block has it, but offered in no list: the slash menu inserts it on its own. */
  unlisted?: boolean;
}

export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  { key: 'csv', label: 'CSV', aliases: [] },
  { key: 'latex', label: 'LaTeX', aliases: ['tex', 'katex'], slashOnly: ['math', 'formula', 'equation'] },
  { key: 'markdown', label: 'Markdown', aliases: ['md'] },
  { key: 'mermaid', label: 'Mermaid', aliases: ['mmd'], slashOnly: ['diagram', 'flowchart', 'graph'] },
  { key: 'plain', label: 'Plain Text', aliases: ['text', 'txt', 'plaintext', 'none'] },
  { key: 'bash', label: 'Bash', aliases: ['sh', 'shell', 'zsh'] },
  { key: 'css', label: 'CSS', aliases: [] },
  { key: 'html', label: 'HTML', aliases: [] },
  { key: 'javascript', label: 'JavaScript', aliases: ['js', 'jsx'] },
  { key: 'json', label: 'JSON', aliases: [] },
  { key: 'lean', label: 'Lean', aliases: ['lean4'] },
  { key: 'python', label: 'Python', aliases: ['py'] },
  { key: 'sql', label: 'SQL', aliases: [] },
  { key: 'typescript', label: 'TypeScript', aliases: ['ts', 'tsx'] },
  { key: 'xml', label: 'XML', aliases: [] },
  { key: 'yaml', label: 'YAML', aliases: ['yml'] },
  { key: 'toc', label: 'Table of contents', aliases: [], unlisted: true },
];

/** The languages a query of two letters or more names (by key, label, alias or slash word). */
export function languagesFor(query: string): CodeLanguage[] {
  const wanted = query.toLowerCase();
  if (wanted.length < 2) return [];
  return CODE_LANGUAGES.filter(
    language =>
      !language.unlisted &&
      (language.key.startsWith(wanted) ||
      language.label.toLowerCase().startsWith(wanted) ||
      language.aliases.some(alias => alias.startsWith(wanted)) ||
      (language.slashOnly ?? []).some(word => word.startsWith(wanted))),
  );
}
