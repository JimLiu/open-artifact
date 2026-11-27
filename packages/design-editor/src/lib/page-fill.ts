/**
 * An artboard's page background: the `background` and `background-color`
 * of the `body` rule in the stylesheets of its `<helmet>` (the `html` rule's
 * when `body` sets none). Read for Copy properties and the artboard's
 * Background row, and written by Paste properties and that row.
 *
 * Writing keeps the stylesheet as it is around the two declarations: the
 * last plain `body` rule takes them (values changed in place, new ones at
 * its end, the color after the image so the shorthand can't hide it), the
 * same declarations leave earlier `body` rules, and an `html` background
 * goes when `body` had none (the two would stack). Without a `body` rule
 * one is added to the last stylesheet, or a new `<helmet><style>`. A
 * stylesheet with nested rules is not edited.
 */

import { elementChildren, parseStyle, type HtmlElement, type Splice, type StyleDeclaration, type TemplateModel } from '@open-artifact/dc';

/** The two declarations a page background is written with. */
export type PageFillProp = 'background' | 'background-color';

/** One declaration to write: a value sets it, `null` removes it. */
export interface PageFillEdit {
  prop: PageFillProp;
  value: string | null;
}

/** A page background as read: its image layers (`background`) and its color. */
export interface PageFill {
  image?: string;
  color?: string;
}

/** The color a page shows when nothing sets one. */
export const DEFAULT_PAGE_COLOR = '#ffffff';

/** A block of a stylesheet: its prelude (selector or at-rule) and its body, as offsets into the CSS. */
export interface CssBlock {
  prelude: string;
  /** Offset of the first character after `{`. */
  bodyStart: number;
  /** Offset of the closing `}`. */
  bodyEnd: number;
  /** An at-rule (`@media`, `@font-face`…). */
  at: boolean;
  /** A style rule holding another rule. */
  nested: boolean;
}

/**
 * The top-level blocks of a stylesheet, skipping comments and strings; null
 * when the braces don't balance.
 */
export function cssBlocks(css: string): CssBlock[] | null {
  const blocks: CssBlock[] = [];
  let depth = 0;
  let preludeStart = 0;
  let open = -1;
  let nested = false;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]!;
    if (css.startsWith('/*', i)) {
      // A comment: skip to its close (an unclosed one ends the sheet unread).
      const close = css.indexOf('*/', i + 2);
      if (close === -1) return null;
      i = close + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch) j += css[j] === '\\' ? 2 : 1;
      i = j;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) {
        open = i;
        nested = false;
      } else nested = true;
      depth++;
    } else if (ch === '}') {
      if (depth === 0) return null;
      depth--;
      if (depth === 0) {
        const prelude = stripComments(css.slice(preludeStart, open)).trim();
        const at = prelude.startsWith('@');
        blocks.push({ prelude, bodyStart: open + 1, bodyEnd: i, at, nested: !at && nested });
        preludeStart = i + 1;
      }
    } else if (ch === ';' && depth === 0) preludeStart = i + 1;
  }
  return depth === 0 ? blocks : null;
}

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '');

/** The selectors of a rule's prelude. */
const selectorsOf = (prelude: string): string[] => prelude.split(',').map((part) => part.trim().replace(/\s+/g, ' ').toLowerCase());

/** The declarations of a rule body. */
const declarationsOf = (body: string): StyleDeclaration[] => parseStyle(stripComments(body));

const LAYERED = /url\(|gradient\(/i;

/** A stylesheet of the helmet: the element and its CSS. */
interface Sheet {
  element: HtmlElement;
  css: string;
  blocks: CssBlock[];
}

/** The template's `<helmet>`, if any. */
function helmetOf(model: TemplateModel): HtmlElement | undefined {
  return elementChildren(model.nodes).find((element) => element.tag === 'helmet');
}

/** The helmet's stylesheets, or null when one can't be read (unbalanced). */
function sheetsOf(model: TemplateModel): Sheet[] | null {
  const helmet = helmetOf(model);
  if (!helmet) return [];
  const sheets: Sheet[] = [];
  const walk = (element: HtmlElement): void => {
    for (const child of elementChildren(element.children)) {
      if (child.tag === 'style' && child.closeStart >= 0) {
        const css = model.text.slice(child.openEnd, child.closeStart);
        const blocks = cssBlocks(css);
        if (!blocks) throw new Error('unbalanced');
        sheets.push({ element: child, css, blocks });
      } else walk(child);
    }
  };
  try {
    walk(helmet);
  } catch {
    return null;
  }
  return sheets;
}

/** Folds declarations into a page fill, in cascade order. */
function fold(fill: PageFill, declarations: readonly StyleDeclaration[]): PageFill {
  const out = { ...fill };
  for (const { property, value } of declarations) {
    const v = value.trim();
    if (property === 'background') {
      if (LAYERED.test(v)) {
        out.image = v;
        delete out.color;
      } else {
        delete out.image;
        if (v && v !== 'none') out.color = v;
        else delete out.color;
      }
    } else if (property === 'background-color') {
      if (v) out.color = v;
    } else if (property === 'background-image') {
      if (v && v !== 'none') out.image = v;
      else delete out.image;
    }
  }
  return out;
}

/** A color that paints nothing. */
const clearColor = (color: string): boolean => /^(transparent|none)$/i.test(color) || /rgba\([^)]*,\s*0\)$/i.test(color) || /\/\s*0\)$/.test(color);

const hasFill = (fill: PageFill): boolean => fill.image !== undefined || fill.color !== undefined;

/**
 * The page background a template sets: from rules naming `body` (in a
 * selector list too), else from those naming `html`. Empty when neither
 * does; null when a stylesheet can't be read.
 */
export function readPageFill(model: TemplateModel): PageFill | null {
  const sheets = sheetsOf(model);
  if (!sheets) return null;
  const read = (selector: string): PageFill => {
    let fill: PageFill = {};
    for (const sheet of sheets) {
      for (const block of sheet.blocks) {
        if (block.at || !selectorsOf(block.prelude).includes(selector)) continue;
        fill = fold(fill, declarationsOf(sheet.css.slice(block.bodyStart, block.bodyEnd)));
      }
    }
    return fill;
  };
  const body = read('body');
  return hasFill(body) ? body : read('html');
}

/** A rule body with these declarations, laid out as the body was (one line or one per line). */
function formatBody(original: string, declarations: readonly StyleDeclaration[]): string {
  const text = (d: StyleDeclaration) => `${d.property}: ${d.value}${d.important ? ' !important' : ''};`;
  if (!declarations.length) return original.includes('\n') ? `\n${/\n([ \t]*)$/.exec(original)?.[1] ?? ''}` : ' ';
  if (!original.includes('\n')) return ` ${declarations.map(text).join(' ')} `;
  const indent = /\n([ \t]*)\S/.exec(original)?.[1] ?? '  ';
  const closing = /\n([ \t]*)$/.exec(original)?.[1] ?? '';
  return `${declarations.map((d) => `\n${indent}${text(d)}`).join('')}\n${closing}`;
}

const PROPS: readonly PageFillProp[] = ['background', 'background-color'];

/**
 * The edit that writes a page background, as splices of the template; null
 * when it can't be written (a stylesheet with nested rules, or unbalanced).
 * No splices when there is nothing to change.
 */
export function pageFillSplices(model: TemplateModel, edits: readonly PageFillEdit[]): Splice[] | null {
  const sheets = sheetsOf(model);
  if (!sheets) return null;
  if (sheets.some((sheet) => sheet.blocks.some((block) => block.nested))) return null;
  const values = new Map<PageFillProp, string | null>();
  for (const edit of edits) if (PROPS.includes(edit.prop)) values.set(edit.prop, edit.value?.trim() || null);
  if (!values.size) return [];
  const touched = (property: string) => values.has(property as PageFillProp);
  const splices: Splice[] = [];

  const rules = sheets.flatMap((sheet) => sheet.blocks.filter((block) => !block.at).map((block) => ({ sheet, block, selectors: selectorsOf(block.prelude) })));
  const bodyRules = rules.filter((rule) => rule.selectors.length === 1 && rule.selectors[0] === 'body');
  const bodyHadFill = rules.some((rule) => rule.selectors.includes('body') && declarationsOf(rule.sheet.css.slice(rule.block.bodyStart, rule.block.bodyEnd)).some((d) => /^background(-color|-image)?$/.test(d.property)));
  const writes = [...values].filter(([, value]) => value !== null) as [PageFillProp, string][];

  const rewrite = (sheet: Sheet, block: CssBlock, next: StyleDeclaration[]): void => {
    const body = sheet.css.slice(block.bodyStart, block.bodyEnd);
    const before = declarationsOf(body);
    if (before.length === next.length && before.every((d, i) => d.property === next[i]!.property && d.value === next[i]!.value && d.important === next[i]!.important)) return;
    splices.push({ start: sheet.element.openEnd + block.bodyStart, end: sheet.element.openEnd + block.bodyEnd, text: formatBody(body, next) });
  };

  if (bodyRules.length) {
    const last = bodyRules[bodyRules.length - 1]!;
    for (const rule of bodyRules.slice(0, -1)) {
      const declarations = declarationsOf(rule.sheet.css.slice(rule.block.bodyStart, rule.block.bodyEnd));
      rewrite(rule.sheet, rule.block, declarations.filter((d) => !touched(d.property)));
    }
    const declarations = declarationsOf(last.sheet.css.slice(last.block.bodyStart, last.block.bodyEnd));
    const next: StyleDeclaration[] = [];
    for (const declaration of declarations) {
      if (!touched(declaration.property)) next.push(declaration);
      else {
        const value = values.get(declaration.property as PageFillProp);
        // Written once, where it first was.
        if (value && !next.some((d) => d.property === declaration.property)) next.push({ ...declaration, value });
      }
    }
    for (const [prop, value] of writes) if (!next.some((d) => d.property === prop)) next.push({ property: prop, value, important: false });
    // The color after the shorthand, which would otherwise reset it.
    const image = next.findIndex((d) => d.property === 'background');
    const color = next.findIndex((d) => d.property === 'background-color');
    if (image >= 0 && color >= 0 && color < image) next.push(...next.splice(color, 1));
    rewrite(last.sheet, last.block, next);
  } else if (writes.length) {
    const ordered = PROPS.flatMap((prop) => (values.get(prop) ? [`${prop}: ${values.get(prop)};`] : []));
    const rule = `body { ${ordered.join(' ')} }`;
    const sheet = sheets[sheets.length - 1];
    if (sheet) {
      const at = sheet.element.closeStart;
      const lead = sheet.css.endsWith('\n') ? '' : '\n';
      splices.push({ start: at, end: at, text: `${lead}${rule}\n` });
    } else {
      const helmet = helmetOf(model);
      if (helmet && helmet.closeStart >= 0) splices.push({ start: helmet.closeStart, end: helmet.closeStart, text: `<style>${rule}</style>\n` });
      else {
        const lead = model.text.match(/^\s*/)?.[0].length ?? 0;
        splices.push({ start: lead, end: lead, text: `<helmet>\n<style>${rule}</style>\n</helmet>\n` });
      }
    }
  }

  // An html background under a body that had none would show through as a second layer.
  if (!bodyHadFill && writes.length) {
    for (const rule of rules) {
      if (rule.selectors.length !== 1 || rule.selectors[0] !== 'html') continue;
      const declarations = declarationsOf(rule.sheet.css.slice(rule.block.bodyStart, rule.block.bodyEnd));
      rewrite(rule.sheet, rule.block, declarations.filter((d) => !/^background(-color|-image)?$/.test(d.property)));
    }
  }
  return splices;
}

/**
 * Whether a background value may be written into the page: no script
 * addresses, no ways out of the declaration, no remote images.
 */
export function safePageFillValue(value: string): boolean {
  return !/[{};<>]|javascript:|vbscript:|expression\s*\(|-moz-binding|url\(\s*['"]?\s*https?:|@import/i.test(value);
}

/**
 * The page background a copied fill sets: its image layers and its visible
 * color. Either may be missing; null when a value isn't safe to write.
 */
export function pageFillFromCopy(fill: Record<string, string>): PageFill | null {
  const shorthand = fill.background?.trim();
  const image = fill['background-image']?.trim() && fill['background-image'] !== 'none' ? fill['background-image']!.trim() : shorthand && LAYERED.test(shorthand) ? shorthand : undefined;
  const color = fill['background-color']?.trim() || (shorthand && !LAYERED.test(shorthand) && shorthand !== 'none' ? shorthand : undefined);
  const out: PageFill = {};
  if (image) out.image = image;
  if (color && !clearColor(color)) out.color = color;
  if (Object.values(out).some((value) => !safePageFillValue(value))) return null;
  return out;
}

/** The edits that make a page show `fill` (a missing part is removed). */
export function pageFillEdits(fill: PageFill): PageFillEdit[] {
  return [
    { prop: 'background', value: fill.image ?? null },
    { prop: 'background-color', value: fill.color ?? null },
  ];
}

/** A page background as the declarations Copy properties keeps (white when nothing sets one). */
export function pageFillDeclarations(fill: PageFill): Record<string, string> {
  const out: Record<string, string> = {};
  if (fill.image) out['background-image'] = fill.image;
  out['background-color'] = fill.color ?? (fill.image ? '' : DEFAULT_PAGE_COLOR);
  if (!out['background-color']) delete out['background-color'];
  return out;
}

/** The one root element of a frameless artboard's template (helmet, styles and scripts aside). */
export function rootElementOf(model: TemplateModel): HtmlElement | null {
  const roots = elementChildren(model.nodes).filter((element) => !['helmet', 'style', 'script', 'link', 'meta'].includes(element.tag));
  return roots.length === 1 ? roots[0]! : null;
}
