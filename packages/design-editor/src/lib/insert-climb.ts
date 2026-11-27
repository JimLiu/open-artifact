import { getAttribute, insertHtml, parseTemplate, type HtmlElement, type InsertPosition, type TemplateModel } from '@open-artifact/dc';

/** Where an insert goes: relative to an element, or (`null`) at the end of the template. */
export interface InsertSpot {
  target: HtmlElement | null;
  position: InsertPosition;
}

/**
 * Moves an insert outward until the HTML parser would leave it where it is
 * written. `moves` says whether inserting `html` at a spot would be moved
 * by the parser. Into X becomes after X; before or after X becomes before
 * or after X's parent. When the climb reaches the top level or a parent
 * that can't be edited, the first spot stands. Inserted links never go
 * inside a link: the insert starts after the outermost one.
 */
export function climbInsert(model: TemplateModel, spot: InsertSpot, html: string, moves: (spot: InsertSpot) => boolean): InsertSpot {
  let at = spot;
  if (/<a[\s>/]/i.test(html)) {
    const link = outermostLink(at);
    if (link) {
      if (!canHoldAfter(link)) return spot;
      at = { target: link, position: 'after' };
    }
  }
  for (let step = 0; step < model.elements.length + 1; step++) {
    if (!moves(at)) return at;
    const next = outward(at);
    if (!next) return spot;
    at = next;
  }
  return spot;
}

function into(position: InsertPosition): boolean {
  return position === 'first-child' || position === 'last-child';
}

/** The spot one level further out, or null when there is none to edit. */
function outward(spot: InsertSpot): InsertSpot | null {
  const { target, position } = spot;
  if (!target) return null;
  if (into(position)) return canHoldAfter(target) ? { target, position: 'after' } : null;
  const parent = target.parent;
  if (!parent || !canHoldAfter(parent)) return null;
  return { target: parent, position };
}

/** True when something can go next to `element`: its parent exists and can be edited. */
function canHoldAfter(element: HtmlElement): boolean {
  const parent = element.parent;
  return !!parent && !getAttribute(parent, 'data-uneditable');
}

function outermostLink(spot: InsertSpot): HtmlElement | null {
  let node = spot.target && (into(spot.position) ? spot.target : spot.target.parent);
  let link: HtmlElement | null = null;
  while (node) {
    if (node.tag === 'a') link = node;
    node = node.parent;
  }
  return link;
}

/** The template text after inserting `html` at `spot`, and where the insert sits in it. */
export function insertedText(model: TemplateModel, spot: InsertSpot, html: string): { text: string; start: number; end: number } {
  const splices = [...insertHtml(model, spot.target, spot.position, html)].sort((a, b) => b.start - a.start);
  let text = model.text;
  for (const splice of splices) text = text.slice(0, splice.start) + splice.text + text.slice(splice.end);
  // insertHtml makes one splice; it may carry whitespace or an empty element's text around the insert.
  const splice = splices[splices.length - 1];
  return { text, start: splice?.start ?? text.length, end: splice ? splice.start + splice.text.length : text.length };
}

/** The attribute that labels each element of a marked template. */
export const MARK = 'data-insert-mark';

/**
 * The template text with every element labelled in a {@link MARK}
 * attribute (by default its index in `model.elements`), so the elements
 * can be found again after the browser parses it.
 */
export function markedText(model: TemplateModel, labelOf: (index: number) => string = String): string {
  const points = model.elements.map((element, index) => ({ at: markPoint(model, element), label: labelOf(index) }));
  let text = model.text;
  for (const { at, label } of points.sort((a, b) => b.at - a.at)) {
    text = `${text.slice(0, at)} ${MARK}="${label}"${text.slice(at)}`;
  }
  return text;
}

function markPoint(model: TemplateModel, element: HtmlElement): number {
  let at = element.openEnd - 1;
  if (element.selfClosing && model.text[at - 1] === '/') at--;
  return at;
}

/** What the browser made of a marked template. */
export interface ParsedMarks {
  /** For each label found, the label of its nearest labelled ancestor (null at the top). */
  parents: Map<string, string | null>;
  /** Labels the parser put down more than once (it copies some formatting elements). */
  repeated: Set<string>;
}

/**
 * True when the browser's parser (`parse`) would not keep `html` where
 * `spot` puts it: an element already there changes parent, an inserted
 * element is dropped or copied, an inserted top element is not a child of
 * the spot's parent, or an inserted inner element leaves its own parent.
 * Elements the parser already moves before the insert don't count.
 */
export function insertMoves(model: TemplateModel, spot: InsertSpot, html: string, parse: (marked: string) => ParsedMarks): boolean {
  const before = parse(markedText(model));
  const { text, start, end } = insertedText(model, spot, html);
  const after = parseTemplate(text);
  const labels: string[] = [];
  let kept = 0, added = 0;
  for (const element of after.elements) labels.push(element.start >= start && element.start < end ? `n${added++}` : String(kept++));
  const seen = parse(markedText(after, (index) => labels[index]!));
  if (seen.repeated.size > before.repeated.size) return true;
  for (let i = 0; i < kept; i++) {
    const label = String(i);
    if (seen.parents.get(label) !== before.parents.get(label)) return true;
  }
  const labelOf = new Map(after.elements.map((element, index) => [element, labels[index]!]));
  const old = spot.target ? String(model.tidOf.get(spot.target)) : null;
  const holder = !old ? null : spot.position === 'first-child' || spot.position === 'last-child' ? old : (seen.parents.get(old) ?? null);
  for (const [index, element] of after.elements.entries()) {
    const label = labels[index]!;
    if (!label.startsWith('n')) continue;
    if (!seen.parents.has(label) || seen.repeated.has(label)) return true;
    const parent = element.parent ? labelOf.get(element.parent)! : null;
    const expected = parent?.startsWith('n') ? parent : holder;
    if (seen.parents.get(label) !== expected) return true;
  }
  return false;
}
