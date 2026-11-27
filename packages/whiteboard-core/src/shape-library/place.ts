/**
 * Placing a library shape: an unframed picture holding the shape's drawing,
 * with an empty text under it that shows the shape's name until someone
 * types a label. The two form one new group, so they move together.
 *
 * The picture is an ordinary `image` element: it keeps working (and arrows
 * stay attached to it) whatever happens to the library later.
 */

import { svgToBase64DataUrl } from '../image-source.ts';
import { createElementId, MAX_PLACEHOLDER_CHARS, type ImageElement, type TextElement } from '../schema.ts';
import type { LibraryShape } from './library.ts';

/** Longest edge of a placed shape. */
export const PLACED_SHAPE_SIZE = 80;
/** Width the name label wraps at. */
export const PLACED_LABEL_WIDTH = 140;
/** Gap between the picture and its label. */
export const PLACED_LABEL_GAP = 6;

/** The elements of a placed shape. */
export interface PlacedShape {
  image: ImageElement;
  label: TextElement;
  /** The new group both belong to. */
  group: string;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The size a shape is placed at: its longest edge {@link PLACED_SHAPE_SIZE}, its aspect ratio kept. */
export function placedShapeSize(shape: Pick<LibraryShape, 'w' | 'h'>): { w: number; h: number } {
  const longest = Math.max(shape.w, shape.h);
  const scale = longest > 0 && Number.isFinite(longest) ? PLACED_SHAPE_SIZE / longest : 1;
  return { w: Math.max(1, round(shape.w * scale)), h: Math.max(1, round(shape.h * scale)) };
}

/**
 * A shape placed with its picture centered on `center`: the picture (style
 * `plain`, no frame) and, centered under it, an empty text whose
 * placeholder is the shape's name, both in one new group.
 */
export function placeLibraryShape(shape: Pick<LibraryShape, 'name' | 'w' | 'h' | 'svg'>, center: { x: number; y: number }, newId: () => string = createElementId): PlacedShape {
  const size = placedShapeSize(shape);
  const group = newId();
  const image: ImageElement = {
    type: 'image',
    id: newId(),
    x: round(center.x - size.w / 2),
    y: round(center.y - size.h / 2),
    w: size.w,
    h: size.h,
    style: 'plain',
    src: svgToBase64DataUrl(shape.svg),
    groups: [group],
  };
  const name = Array.from(shape.name.replace(/\s+/g, ' ').trim()).slice(0, MAX_PLACEHOLDER_CHARS).join('');
  const label: TextElement = {
    type: 'text',
    id: newId(),
    x: round(center.x - PLACED_LABEL_WIDTH / 2),
    y: round(image.y + size.h + PLACED_LABEL_GAP),
    text: '',
    size: 'small',
    color: 'ink',
    wrap: PLACED_LABEL_WIDTH,
    textAlign: 'center',
    ...(name !== '' ? { placeholder: name } : {}),
    groups: [group],
  };
  return { image, label, group };
}
