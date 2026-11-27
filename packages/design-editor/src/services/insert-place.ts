import { elementPath, resolveElement, type InsertPosition } from '@open-artifact/dc';
import { climbInsert, insertMoves, MARK, type ParsedMarks } from '../lib/insert-climb.ts';
import type { Address } from '../lib/ops.ts';
import { useDocument } from '../state/document.ts';
import { templateOf } from './agent.ts';

/** An insert's place in an artboard. */
export interface InsertAt {
  target: Address | null;
  position: InsertPosition;
}

/** Reads a marked template with the browser's HTML parser. */
export function browserMarks(marked: string): ParsedMarks {
  const template = document.createElement('template');
  template.innerHTML = marked;
  const parents = new Map<string, string | null>();
  const repeated = new Set<string>();
  const walk = (node: ParentNode, parent: string | null): void => {
    for (const child of Array.from(node.children)) {
      const label = child.getAttribute(MARK);
      if (label !== null) {
        if (parents.has(label)) repeated.add(label);
        else parents.set(label, parent);
      }
      walk(child instanceof HTMLTemplateElement ? child.content : child, label ?? parent);
    }
  };
  walk(template.content, null);
  return { parents, repeated };
}

/**
 * Where an insert of `html` lands once moved out of places the HTML parser
 * would move it from (a block inside a paragraph, a link inside a link).
 */
export function settledInsert(board: string, where: InsertAt, html: string): InsertAt {
  const source = useDocument.getState().boards[board]?.source;
  if (!source || typeof document === 'undefined') return where;
  const model = templateOf(source);
  const target = where.target ? resolveElement(model, where.target.tid, where.target.path) : null;
  if (where.target && !target) return where;
  const spot = climbInsert(model, { target, position: where.position }, html, (at) => insertMoves(model, at, html, browserMarks));
  if (spot.target === target && spot.position === where.position) return where;
  return {
    target: spot.target ? { tid: model.tidOf.get(spot.target)!, path: elementPath(model, spot.target) } : null,
    position: spot.position,
  };
}
