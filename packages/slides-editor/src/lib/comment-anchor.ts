/**
 * The JSON a slide comment is anchored with, read and described without the
 * stores: what the thread list shows and what the agent is handed.
 */

import { contextId, nodeAt, nodeLabel, resolveContextId, runsText, samePath, truncate, type ListItem, type NodePath, type Slide, type SlideNode } from '@open-artifact/slides-core';
import type { JsonRecord } from '@open-artifact/runtime';

/** Where a thread sits. */
export interface SlideAnchor {
  slide?: string;
  el?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** The list item the comment was dropped on, from 0 (a text box counts across its lists). */
  item?: number;
  /** The table cell the comment was dropped on: `[row, column]`, from 0. */
  cell?: [number, number];
}

/** The part of an element a comment lands on. */
export type AnchorPart = { item: number } | { cell: [number, number] };

const LABEL_TEXT = 40;
const LOCATION_TEXT = 200;

const isIndex = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** Reads a stored anchor; anything unreadable is the whole deck, and a malformed item or cell is left out. */
export function readAnchor(text: string): SlideAnchor {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {};
  }
  if (!value || typeof value !== 'object') return {};
  const anchor = value as SlideAnchor;
  const badItem = 'item' in anchor && !isIndex(anchor.item);
  const badCell = 'cell' in anchor && !(Array.isArray(anchor.cell) && anchor.cell.length === 2 && anchor.cell.every(isIndex));
  if (!badItem && !badCell) return anchor;
  const kept: SlideAnchor = { ...anchor };
  if (badItem) delete kept.item;
  if (badCell) delete kept.cell;
  return kept;
}

/**
 * The part a rendered element marks: its `data-open-artifact-item` (`"2"`) or
 * `data-open-artifact-cell` (`"1:3"`) attribute; undefined when neither reads.
 */
export function partFromMarks(item: string | null, cell: string | null): AnchorPart | undefined {
  if (item !== null && /^\d{1,4}$/.test(item)) return { item: Number(item) };
  const match = cell === null ? null : /^(\d{1,4}):(\d{1,4})$/.exec(cell);
  return match ? { cell: [Number(match[1]), Number(match[2])] } : undefined;
}

/** A list or text box's items, in reading order; undefined for other elements. */
export function listItemsOf(node: SlideNode): readonly ListItem[] | undefined {
  if (node.kind === 'list') return node.items;
  if (node.kind === 'textbox') return node.blocks.flatMap((block) => (block.kind === 'list' ? block.items : []));
  return undefined;
}

const plain = (text: string): string => text.replace(/\s+/g, ' ').trim();

interface PartInfo {
  /** `List item 2`, `Row 1, column 3`. */
  name: string;
  text: string;
  location: JsonRecord;
}

/** What an anchor's item or cell names on `node`, or null when it no longer exists there. */
function partOf(node: SlideNode, anchor: SlideAnchor): PartInfo | null {
  if (anchor.item !== undefined) {
    const item = listItemsOf(node)?.[anchor.item];
    if (!item) return null;
    return { name: `List item ${anchor.item + 1}`, text: plain(runsText(item.runs)), location: { listItem: anchor.item + 1 } };
  }
  if (anchor.cell !== undefined && node.kind === 'table') {
    const [row, col] = anchor.cell;
    const cell = node.rows[row]?.cells[col];
    if (!cell) return null;
    return { name: `Row ${row + 1}, column ${col + 1}`, text: plain(runsText(cell.runs)), location: { cell: { row: row + 1, column: col + 1 } } };
  }
  return null;
}

/** The element an anchor names on its slide, if it still resolves. */
export function anchoredPath(slide: Slide, anchor: SlideAnchor): NodePath | null {
  if (!anchor.el) return null;
  return resolveContextId(slide, anchor.el)?.path ?? null;
}

/**
 * A short label of an anchor: `Slide 3 › Text "Q3 revenue"`, or with its item
 * or cell `Slide 3 › List item 2 › Ship the beta`. `number` is the slide's place
 * in the deck from 1, or 0 when the slide is gone.
 */
export function describeAnchor(anchor: SlideAnchor, slide: Slide | undefined, number: number): string {
  if (!anchor.slide) return 'Whole deck';
  const head = number > 0 ? `Slide ${number}` : 'Deleted slide';
  if (!slide) return head;
  const path = anchoredPath(slide, anchor);
  const node = path ? nodeAt(slide, path) : undefined;
  if (node) {
    const part = partOf(node, anchor);
    if (part) return part.text ? `${head} › ${part.name} › ${truncate(part.text, LABEL_TEXT)}` : `${head} › ${part.name}`;
    return `${head} › ${nodeLabel(node, LABEL_TEXT)}`;
  }
  if (anchor.w !== undefined) return `${head} › Area`;
  return head;
}

/** Location details the agent reads alongside the label (`slideIndex` from 1, or 0 when the slide is gone). */
export function anchorLocation(anchor: SlideAnchor, slide: Slide | undefined, slideIndex: number): JsonRecord {
  const location: JsonRecord = {};
  if (anchor.slide) {
    location.slideId = anchor.slide;
    location.slideIndex = slideIndex;
  }
  if (anchor.el) location.element = anchor.el;
  if (anchor.x !== undefined && anchor.y !== undefined) location.point = { x: anchor.x, y: anchor.y };
  if (anchor.w !== undefined && anchor.h !== undefined) location.size = { w: anchor.w, h: anchor.h };
  const path = slide ? anchoredPath(slide, anchor) : null;
  const node = slide && path ? nodeAt(slide, path) : undefined;
  const part = node ? partOf(node, anchor) : null;
  if (part) Object.assign(location, part.location, part.text ? { text: truncate(part.text, LOCATION_TEXT) } : {});
  return location;
}

/**
 * The anchor of an element, with an optional point, area, and the item or cell
 * the point lands on. The item or cell is kept only when the element has a
 * name of its own that leads back to it and the part exists there.
 */
export function makeAnchor(slide: Slide, path: NodePath | null, point?: { x: number; y: number }, area?: { w: number; h: number }, part?: AnchorPart): SlideAnchor {
  const anchor: SlideAnchor = { slide: slide.id };
  const el = path ? contextId(slide, path) : null;
  if (el) anchor.el = el;
  if (point) {
    anchor.x = Math.round(point.x);
    anchor.y = Math.round(point.y);
  }
  if (area) {
    anchor.w = Math.round(area.w);
    anchor.h = Math.round(area.h);
  }
  if (part && el && path) {
    const named = resolveContextId(slide, el);
    const node = nodeAt(slide, path);
    const exact = named !== null && !named.cell && samePath(named.path, path);
    const candidate: SlideAnchor = 'item' in part ? { item: part.item } : { cell: [part.cell[0], part.cell[1]] };
    if (exact && node && partOf(node, candidate)) Object.assign(anchor, candidate);
  }
  return anchor;
}
