/**
 * Edit operations on one artboard.
 *
 * Every hand edit the editor makes to an artboard is recorded as an
 * operation that names its targets by address (tid + child path), not by
 * object. The same operation can then be applied again to a newer source:
 * when the agent (or another tab) changes an artboard while this tab has
 * unsaved edits, the editor takes their version and replays its own pending
 * operations on top. An operation whose targets no longer resolve (tid and
 * path disagree) is dropped instead of landing on the wrong element.
 */

import { lookSplices, type ThemeLook } from './theme-look.ts';
import {
  applySplices,
  duplicateElements,
  elementChildren,
  escapeText,
  importTextOutcome,
  importTextTargets,
  looseTextRuns,
  elementPath,
  formatAttribute,
  hasBlockContent,
  insertHtml,
  isTextEditable,
  quoteScriptString,
  replaceScriptBody,
  sanitizeTextHtml,
  scriptLiterals,
  moveElements,
  parseDcDocument,
  parseTemplate,
  removeElements,
  replaceProps,
  replaceTemplate,
  resolveElement,
  setAttribute,
  setInnerHtml,
  setStyle,
  setText,
  unwrapElement,
  wrapElements,
  type HtmlElement,
  type InsertPosition,
  type PropsSpec,
  type Splice,
  type StylePatch,
  type TemplateModel,
} from '@open-artifact/dc';
import { knownWords } from './text-edit.ts';
import { lockSplices, withoutLocks } from './locks.ts';
import { pageFillSplices, type PageFillEdit } from './page-fill.ts';

/** Where an element sits in a template: both must agree for it to resolve. */
export interface Address {
  tid: number;
  path: number[];
}

/** One recorded edit. */
export type BoardOp =
  | { kind: 'style'; targets: Address[]; patch: StylePatch }
  /** A different style patch per element, as one edit (nudging, pasting properties). */
  | { kind: 'look'; look: ThemeLook }
  | { kind: 'styles'; edits: { target: Address; patch: StylePatch }[] }
  | { kind: 'attr'; target: Address; name: string; value: string | null }
  | { kind: 'text'; target: Address; text: string }
  /**
   * The element's content replaced by edited rich text (sanitized here); a
   * `<p>` that now holds a list or paragraphs becomes a `<div>`.
   */
  | { kind: 'richText'; target: Address; html: string; link?: number }
  /**
   * Wraps each run of loose words in an element that mixes words with other
   * layout in a `<span>`, so each can be edited;
   * `inline` keeps inline formatting with the words (false when the element
   * lays its children out as items).
   */
  | { kind: 'wrapText'; target: Address; inline: boolean }
  /**
   * Words of a component instance retyped where the component draws them:
   * `key` is where they are written (`__text` or `@attribute`), `words` what
   * they were.
   */
  | { kind: 'importText'; target: Address; key: string; words: string; text: string }
  /**
   * A string literal of the logic script retyped: `[start, end)` of the
   * script body held `value` when the edit started.
   */
  | { kind: 'scriptText'; start: number; end: number; quote: string; value: string; text: string }
  /** Wraps the element's whole content in `<a href>` (the element itself stays). */
  | { kind: 'linkText'; target: Address; href: string }
  | { kind: 'remove'; targets: Address[] }
  /** Copies land unlocked. */
  | { kind: 'duplicate'; targets: Address[] }
  /** Locks the elements (`data-locked="true"`) or unlocks them (removing the attribute, see `lib/locks.ts`). */
  | { kind: 'lock'; targets: Address[]; locked: boolean }
  /** Inserts HTML (without locks); `helmet` is appended to the template's `<helmet>` (styles carried from another artboard). */
  /** `keepLocks` for markup moved here, not copied: copies never carry a lock. */
  | { kind: 'insert'; target: Address | null; position: InsertPosition; html: string; helmet?: string; keepLocks?: boolean }
  | { kind: 'move'; targets: Address[]; target: Address; position: InsertPosition }
  | { kind: 'wrap'; targets: Address[]; open: string; close: string }
  | { kind: 'unwrap'; target: Address }
  /** Replaces elements with new HTML; `helmet` is appended to the template's `<helmet>` (detaching instances). */
  | { kind: 'replace'; edits: { target: Address; html: string }[]; helmet?: string }
  /** New tweak defaults written back into `data-props`. */
  | { kind: 'props'; values: Record<string, unknown> }
  /** The page background (`background`, `background-color`) in the helmet's `body` rule (see `lib/page-fill.ts`). */
  /** `rootCovers`: the root element covers the page, which shows its background (see page-fill.ts). */
  | { kind: 'pageFill'; edits: PageFillEdit[]; rootCovers?: boolean }
  /** The whole source replaced (restoring unsaved work): undoable, and replayed over remote changes as a whole. */
  | { kind: 'source'; text: string };

/** The outcome of applying an operation. */
export interface OpResult {
  source: string;
  /** Elements the operation created or moved (to select next), outermost only. */
  created: Address[];
}

/** The address of an element of a model. */
export function addressOf(model: TemplateModel, element: HtmlElement): Address {
  return { tid: model.tidOf.get(element) ?? -1, path: elementPath(model, element) };
}

/** Same element, by address. */
export function sameAddress(a: Address, b: Address): boolean {
  return a.tid === b.tid && a.path.length === b.path.length && a.path.every((n, i) => n === b.path[i]);
}

/**
 * Ranges the splices insert, in the coordinates of the resulting text.
 * `applySplices` applies right to left, so a splice's new start is its old
 * start plus the growth of every splice before it.
 */
function insertedRanges(splices: readonly Splice[]): { start: number; end: number }[] {
  const sorted = [...splices].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: { start: number; end: number }[] = [];
  let shift = 0;
  for (const splice of sorted) {
    const start = splice.start + shift;
    if (splice.text.length) out.push({ start, end: start + splice.text.length });
    shift += splice.text.length - (splice.end - splice.start);
  }
  return out;
}

/** Outermost elements of `model` that start inside any range. */
function elementsStartingIn(model: TemplateModel, ranges: readonly { start: number; end: number }[]): Address[] {
  const inside = (element: HtmlElement): boolean => ranges.some((range) => element.start >= range.start && element.start < range.end);
  const out: Address[] = [];
  for (const element of model.elements) {
    if (!inside(element)) continue;
    let parent = element.parent;
    while (parent && !inside(parent)) parent = parent.parent;
    if (!parent) out.push(addressOf(model, element));
  }
  return out;
}

/** Resolves every address; `null` when any is stale. */
function resolveAll(model: TemplateModel, targets: readonly Address[]): HtmlElement[] | null {
  const out: HtmlElement[] = [];
  for (const target of targets) {
    const element = resolveElement(model, target.tid, target.path);
    if (!element) return null;
    out.push(element);
  }
  return out;
}

/** True for the helmet or anything inside it. */
function inHelmet(element: HtmlElement | undefined): boolean {
  for (let node: HtmlElement | null | undefined = element; node; node = node.parent) if (node.tag === 'helmet') return true;
  return false;
}

/** Appends markup to the template's `<helmet>`, creating one at the top when there is none. */
function helmetSplice(model: TemplateModel, markup: string): Splice {
  const helmet = elementChildren(model.nodes).find((el) => el.tag === 'helmet');
  if (helmet && helmet.closeStart >= 0) return { start: helmet.closeStart, end: helmet.closeStart, text: `${markup.trim()}\n` };
  const lead = model.text.match(/^\s*/)?.[0].length ?? 0;
  return { start: lead, end: lead, text: `<helmet>\n${markup.trim()}\n</helmet>\n` };
}

/**
 * Applies an operation to an artboard source. Returns `null` when a target
 * does not resolve or the edit cannot be expressed (e.g. text with holes).
 */
export function applyOp(source: string, op: BoardOp): OpResult | null {
  if (op.kind === 'source') return { source: op.text, created: [] };
  const doc = parseDcDocument(source);

  if (op.kind === 'props') {
    if (!doc.script || !doc.props) return null;
    const next: PropsSpec = { ...doc.props };
    for (const [key, value] of Object.entries(op.values)) {
      const entry = next[key];
      if (!entry || key === '$preview' || !('editor' in entry)) continue;
      next[key] = { ...entry, default: value };
    }
    return { source: replaceProps(doc, next), created: [] };
  }

  if (op.kind === 'scriptText') {
    if (!doc.script) return null;
    const body = doc.script.body.text;
    const literals = scriptLiterals(body);
    // Where it was, or — after other edits moved it — the one literal still holding that value.
    const same = literals.filter((literal) => literal.value === op.value);
    const literal = literals.find((each) => each.start === op.start && each.end === op.end && each.value === op.value) ?? (same.length === 1 ? same[0] : undefined);
    if (!literal) return null;
    const next = body.slice(0, literal.start) + quoteScriptString(op.text, literal.quote) + body.slice(literal.end);
    return next === body ? null : { source: replaceScriptBody(doc, next), created: [] };
  }

  if (!doc.template) return null;
  const model = parseTemplate(doc.template.text);
  let splices: Splice[];
  try {
    switch (op.kind) {
      case 'look':
        splices = lookSplices(model, op.look);
        break;
      case 'style': {
        const elements = resolveAll(model, op.targets);
        if (!elements) return null;
        splices = elements.flatMap((element) => setStyle(model, element, op.patch));
        break;
      }
      case 'styles': {
        const elements = resolveAll(model, op.edits.map((entry) => entry.target));
        if (!elements) return null;
        splices = elements.flatMap((element, index) => setStyle(model, element, op.edits[index]!.patch));
        break;
      }
      case 'attr': {
        const element = resolveElement(model, op.target.tid, op.target.path);
        if (!element) return null;
        splices = setAttribute(model, element, op.name, op.value);
        break;
      }
      case 'text': {
        const element = resolveElement(model, op.target.tid, op.target.path);
        if (!element) return null;
        splices = setText(element, op.text);
        break;
      }
      case 'richText': {
        const element = resolveElement(model, op.target.tid, op.target.path);
        if (!element || !isTextEditable(element)) return null;
        const html = sanitizeTextHtml(op.html);
        splices = [{ start: element.openEnd, end: element.closeStart, text: html }];
        if (element.tag === 'p' && hasBlockContent(html)) {
          const name = element.start + 1;
          splices.push({ start: name, end: name + element.rawTag.length, text: 'div' });
          const close = element.closeStart + 2;
          splices.push({ start: close, end: close + element.rawTag.length, text: 'div' });
        }
        break;
      }
      case 'wrapText': {
        const element = resolveElement(model, op.target.tid, op.target.path);
        if (!element) return null;
        const runs = looseTextRuns(element, model.text, op.inline);
        if (!runs.length) return null;
        splices = runs.flatMap((run) => [
          { start: run.start, end: run.start, text: '<span>' },
          { start: run.end, end: run.end, text: '</span>' },
        ]);
        break;
      }
      case 'importText': {
        const element = resolveElement(model, op.target.tid, op.target.path);
        if (!element || element.tag !== 'x-import') return null;
        // Checked again against the instance as it is now.
        const outcome = importTextOutcome(op, op.text, importTextTargets(element, knownWords(source)));
        if (outcome.kind !== 'commit') return null;
        splices = outcome.key === '__text' ? setInnerHtml(element, escapeText(outcome.text)) : setAttribute(model, element, outcome.key.slice(1), outcome.text);
        break;
      }
      case 'linkText': {
        const element = resolveElement(model, op.target.tid, op.target.path);
        if (!element || element.closeStart <= element.openEnd || element.tag === 'a') return null;
        splices = [
          { start: element.openEnd, end: element.openEnd, text: `<a ${formatAttribute('href', op.href)}>` },
          { start: element.closeStart, end: element.closeStart, text: '</a>' },
        ];
        break;
      }
      case 'remove': {
        const elements = resolveAll(model, op.targets);
        if (!elements) return null;
        splices = removeElements(model, elements);
        break;
      }
      case 'duplicate': {
        const elements = resolveAll(model, op.targets);
        if (!elements) return null;
        splices = duplicateElements(model, elements).map((splice) => ({ ...splice, text: withoutLocks(splice.text) }));
        break;
      }
      case 'lock': {
        const elements = resolveAll(model, op.targets);
        if (!elements) return null;
        splices = lockSplices(model, elements, op.locked);
        break;
      }
      case 'insert': {
        const target = op.target ? resolveElement(model, op.target.tid, op.target.path) : null;
        if (op.target && !target) return null;
        splices = insertHtml(model, target, op.position, op.keepLocks ? op.html : withoutLocks(op.html));
        if (op.helmet) splices.push(helmetSplice(model, op.helmet));
        break;
      }
      case 'move': {
        const elements = resolveAll(model, op.targets);
        const target = resolveElement(model, op.target.tid, op.target.path);
        if (!elements || !target) return null;
        splices = moveElements(model, elements, target, op.position);
        break;
      }
      case 'wrap': {
        const elements = resolveAll(model, op.targets);
        if (!elements || elements.length === 0) return null;
        splices = wrapElements(model, elements, op.open, op.close);
        break;
      }
      case 'unwrap': {
        const element = resolveElement(model, op.target.tid, op.target.path);
        if (!element) return null;
        splices = unwrapElement(model, element);
        break;
      }
      case 'pageFill': {
        const fill = pageFillSplices(model, op.edits, { rootCovers: op.rootCovers });
        if (!fill) return null;
        splices = fill;
        break;
      }
      case 'replace': {
        const elements = resolveAll(model, op.edits.map((entry) => entry.target));
        if (!elements || !elements.length) return null;
        splices = elements.map((element, index) => ({ start: element.start, end: element.end, text: op.edits[index]!.html }));
        if (op.helmet) splices.push(helmetSplice(model, op.helmet));
        break;
      }
    }
  } catch {
    // EditError: the edit is not expressible on this element.
    return null;
  }

  const template = applySplices(model.text, splices);
  const after = parseTemplate(template);
  let created =
    op.kind === 'style' || op.kind === 'styles' || op.kind === 'attr' || op.kind === 'lock' || op.kind === 'text' || op.kind === 'importText' || op.kind === 'pageFill'
      ? []
      : elementsStartingIn(after, insertedRanges(splices)).filter((address) => !inHelmet(after.elements[address.tid]));
  if (op.kind === 'richText') {
    // The link just set is what to select next; otherwise nothing new.
    const edited = resolveElement(model, op.target.tid, op.target.path);
    const element = edited ? after.elements.find((each) => each.start === edited.start) : undefined;
    const links: HtmlElement[] = [];
    const walk = (node: HtmlElement): void => {
      for (const child of elementChildren(node.children)) {
        if (child.tag === 'a') links.push(child);
        walk(child);
      }
    };
    if (element && op.link != null) walk(element);
    const link = op.link != null ? links[op.link] : undefined;
    created = link ? [addressOf(after, link)] : [];
  }
  return { source: replaceTemplate(doc, template), created };
}

/** Replays operations on a newer source; reports how many were dropped. */
export function replayOps(source: string, ops: readonly BoardOp[]): { source: string; kept: BoardOp[]; dropped: number } {
  let current = source;
  const kept: BoardOp[] = [];
  for (const op of ops) {
    const result = applyOp(current, op);
    if (!result) continue;
    current = result.source;
    kept.push(op);
  }
  return { source: current, kept, dropped: ops.length - kept.length };
}
