/**
 * What in-place text editing needs to know about an element before it
 * starts: when its words come
 * from holes, the template markup to edit, the text props that may supply
 * them, and the logic script's string literals.
 */

import {
  hasTextHoles,
  importTextTargets,
  parseDcDocument,
  scriptLiterals,
  squashSpaces,
  type HtmlElement,
  type ImportTextTarget,
  type TextEditOptions,
} from '@open-artifact/dc';

/**
 * Options for `editText` on `element` of the board `source` (whose template
 * text is `templateText`); `overrides` are the viewer's tweak values.
 */
export function textEditOptions(
  source: string,
  templateText: string,
  element: HtmlElement,
  overrides: Record<string, unknown> | undefined,
  caret: TextEditOptions['caret'] = 'all',
): TextEditOptions {
  if (!hasTextHoles(element)) return { caret };
  const doc = parseDcDocument(source);
  const props: Record<string, string> = {};
  for (const [key, spec] of Object.entries(doc.props ?? {})) {
    if (key === '$preview' || !spec || typeof spec !== 'object' || !('editor' in spec) || spec.editor !== 'text') continue;
    const value = overrides && Object.hasOwn(overrides, key) ? overrides[key] : spec.default;
    if (typeof value === 'string') props[key] = value;
  }
  return {
    caret,
    seed: templateText.slice(element.openEnd, element.closeStart),
    props,
    literals: doc.script ? scriptLiterals(doc.script.body.text) : [],
  };
}

/**
 * Words a hole of board `source` could be supplying: the logic script's
 * strings and the text props' values (`overrides` are the viewer's tweak
 * values). An instance fed by holes does not claim these as its own.
 */
export function knownWords(source: string, overrides?: Record<string, unknown>): Set<string> {
  const doc = parseDcDocument(source);
  const known = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === 'string' && value.trim() !== '') known.add(squashSpaces(value));
  };
  if (doc.script) for (const literal of scriptLiterals(doc.script.body.text)) add(literal.value);
  for (const [key, spec] of Object.entries(doc.props ?? {})) {
    if (key === '$preview' || !spec || typeof spec !== 'object') continue;
    if ('default' in spec) add(spec.default);
    if ('options' in spec && Array.isArray(spec.options)) for (const option of spec.options) add(typeof option === 'object' && option ? (option as { value?: unknown }).value : option);
  }
  for (const value of Object.values(overrides ?? {})) add(value);
  return known;
}

/** The words of component instance `element` that can be retyped on the canvas. */
export function importTargets(source: string, element: HtmlElement, overrides?: Record<string, unknown>): ImportTextTarget[] {
  return importTextTargets(element, knownWords(source, overrides));
}

/** Attributes of an instance that are never words it shows. */
const NOT_SHOWN = /^(component(-from-global-scope)?|from|class|style|style-.*|id|slot|key|ref|href|src|srcset|srcdoc|hint-size|data-.*|on.*)$/i;
/** A hole holding a quoted string, a number or a boolean. */
const LITERAL = /^\s*\{\{\s*(?:(-?\d+(?:\.\d+)?|true|false)|(['"])([^{}]*)\2)\s*\}\}\s*$/;

/** Where the words of a component instance that can't be retyped come from. */
export type InstanceWords = { kind: 'prop'; component: string; prop: string } | { kind: 'template'; component: string };

/** The name a component goes by: its path without the design system's namespace (`Acme.Button` → `Button`). */
export function componentName(path: string): string {
  const parts = path.split('.').filter(Boolean);
  return (parts.length > 1 ? parts.slice(1) : parts).join('.') || path;
}

/**
 * Where `words` (drawn inside instance `element`) come from: a prop
 * written on the instance (an attribute, or the content between its tags,
 * `children`), or the component itself. Null when that can't be told (the
 * instance passes values from code, or there are no words).
 */
export function instanceWordsSource(element: HtmlElement, words: string | null): InstanceWords | null {
  if (element.tag !== 'x-import' || !words) return null;
  const path = element.attrs.find((attr) => attr.name === 'component-from-global-scope' || attr.name === 'component')?.value ?? '';
  if (!path || path.includes('{{')) return null;
  const component = componentName(path);
  const shown = squashSpaces(words);
  let fromCode = false;
  for (const attr of element.attrs) {
    if (NOT_SHOWN.test(attr.name)) continue;
    const text = attr.value ?? '';
    const literal = LITERAL.exec(text);
    const value = literal ? (literal[1] ?? literal[3] ?? '') : text;
    if (!literal && value.includes('{{')) {
      fromCode = true;
      continue;
    }
    // The same words only: a short value (`size="s"`) would be found in almost anything.
    if (squashSpaces(value) === shown) return { kind: 'prop', component, prop: attr.name };
  }
  const between = element.children.map((child) => (child.type === 'text' ? child.value : '')).join(' ');
  if (between.includes('{{')) fromCode = true;
  const inner = squashSpaces(between.replace(/\{\{[\s\S]*?\}\}/g, ' '));
  // The content may be drawn in pieces (around markup): a piece of three or more letters, on word edges, is still the content's.
  const piece = shown.length >= 3 && new RegExp(`(^|\\s)${shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(inner);
  if (inner && (inner === shown || piece)) return { kind: 'prop', component, prop: 'children' };
  return fromCode ? null : { kind: 'template', component };
}

/** What the canvas says when instance words can't be retyped. */
export function instanceWordsMessage(source: InstanceWords): string {
  return source.kind === 'prop'
    ? `This text is set per instance — edit it under ${source.component} props.`
    : `This text sits directly in the ${source.component} component and can’t be edited on the canvas — ask the agent in chat to change it.`;
}
