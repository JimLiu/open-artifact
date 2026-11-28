/**
 * State styles: `style-hover`, `style-focus`, `style-focus-visible` and
 * `style-active` hold CSS declarations an element takes while it is in
 * that state. The renderer turns each into a rule for that element alone;
 * the declarations are parsed and written again (never pasted as text), so
 * a value can't close the rule or the stylesheet, and anything that loads
 * from outside the design is left out.
 */

import { parseStyle, type StyleDeclaration } from './style.ts';

/** The states a `style-<state>` attribute can name. */
export const STATE_STYLES = ['hover', 'focus', 'focus-visible', 'active'] as const;
export type StateStyle = (typeof STATE_STYLES)[number];

/** The state a `style-<state>` attribute names, or null for any other attribute. */
export function stateOfAttribute(name: string): StateStyle | null {
  const match = /^style-(.+)$/i.exec(name);
  const state = match?.[1]!.toLowerCase();
  return state && (STATE_STYLES as readonly string[]).includes(state) ? (state as StateStyle) : null;
}

const PROPERTY = /^(--[\w-]+|-?[a-z][a-z0-9-]*)$/i;

/** Why one declaration can't be in a state style, or null when it can. */
export function stateDeclarationProblem(declaration: StyleDeclaration): string | null {
  if (!PROPERTY.test(declaration.property)) return `"${declaration.property.slice(0, 40)}" is not a CSS property`;
  const value = declaration.value;
  if (!value.trim()) return `${declaration.property} has no value`;
  if (/[{}<>]/.test(value) || /\\/.test(value)) return `${declaration.property}: the value may not contain { } < > or \\`;
  // A comment left open would swallow the rest of the rule and the stylesheet after it.
  if (value.includes('/*')) return `${declaration.property}: the value may not contain /*`;
  if (/expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:|@import/i.test(value)) return `${declaration.property}: the value runs code`;
  for (const match of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    const url = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url) || /^(javascript|vbscript|data:text)/i.test(url)) return `${declaration.property}: url(…) may only name a file of this design or an upload`;
  }
  return null;
}

/** The declarations of a state style, each with a problem when it has one. */
export function readStateStyle(text: string): { declarations: StyleDeclaration[]; problems: string[] } {
  const declarations: StyleDeclaration[] = [];
  const problems: string[] = [];
  if (/[{}<>]/.test(text.replace(/\{\{[\s\S]*?\}\}/g, ''))) problems.push('a state style holds declarations only (no { } < >)');
  for (const declaration of parseStyle(text)) {
    const problem = stateDeclarationProblem(declaration);
    if (problem) problems.push(problem);
    else declarations.push(declaration);
  }
  return { declarations, problems };
}

/** The body of a state rule: the declarations that may be there, each `!important` so it wins over the inline style. */
export function stateRuleBody(text: string): string {
  if (/[{}<>]/.test(text)) return '';
  return readStateStyle(text)
    .declarations.map((declaration) => `${declaration.property}: ${declaration.value} !important`)
    .join('; ');
}

/** A short, stable name for a set of rules. */
export function stateStyleKey(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
}

/** Attribute that ties an element to its state rules. */
export const STATE_STYLE_ATTRIBUTE = 'data-dc-state';

/** The stylesheet of an element's state styles (state → declarations), for the selector `[data-dc-state="key"]`, or null when none is left. */
export function stateStyleSheet(styles: Partial<Record<StateStyle, string>>): { key: string; css: string } | null {
  const bodies = STATE_STYLES.flatMap((state) => {
    const body = styles[state] === undefined ? '' : stateRuleBody(styles[state]!);
    return body ? [[state, body] as const] : [];
  });
  if (!bodies.length) return null;
  const key = stateStyleKey(bodies.map(([state, body]) => `${state}{${body}}`).join(''));
  const css = bodies.map(([state, body]) => `[${STATE_STYLE_ATTRIBUTE}="${key}"]:${state} { ${body} }`).join('\n');
  return { key, css };
}
