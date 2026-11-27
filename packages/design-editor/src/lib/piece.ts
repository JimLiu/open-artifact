/**
 * Pieces: an element dragged out of an artboard onto the canvas becomes a
 * small artboard file of its own, drawn without a frame.
 */

import { escapeText, SUPPORT_SCRIPT_TAG, type StylePatch } from '@open-artifact/dc';
import type { Rect } from '@open-artifact/design-core';
import { pixels } from './layout-write-back.ts';

/** A piece's title: its element's tag, capitalised (`Div`, `Img`). */
export function pieceTitle(tag: string): string {
  return tag ? tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase() : 'Piece';
}

/** How far an element's outline reaches past its border box (0 without one). */
export function outlineReach(computed: Record<string, string | undefined>): number {
  if (!computed['outline-style'] || computed['outline-style'] === 'none') return 0;
  const width = parseFloat(computed['outline-width'] ?? '0') || 0;
  const offset = parseFloat(computed['outline-offset'] ?? '0') || 0;
  return Math.max(0, width + offset);
}

/** The piece's box on the canvas: the element's box (world coordinates) with its outline around it. */
export function pieceBox(box: Rect, reach: number): Rect {
  return { x: box.x - reach, y: box.y - reach, w: box.w + reach * 2, h: box.h + reach * 2 };
}

/**
 * The styles that let an element stand alone as a piece the size it was:
 * out of any positioning, without margins, at its width (and its height,
 * when its container set that).
 */
export function piecePatch(box: { width: number; height: number }, position: string | undefined, inline: Record<string, string>): StylePatch {
  const patch: Record<string, string | null> = {};
  for (const property of Object.keys(inline)) if (property.startsWith('margin')) patch[property] = null;
  const positioned = position === 'absolute' || position === 'fixed';
  if (positioned || position === 'relative' || position === 'sticky') Object.assign(patch, { position: null, left: null, top: null, right: null, bottom: null, inset: null });
  Object.assign(patch, { 'box-sizing': 'border-box', width: pixels(box.width), margin: '0px' });
  if (positioned) patch.height = pixels(box.height);
  return patch;
}

/** The source of a piece file holding `html`, `reach` pixels in from its edges for the outline. */
export function pieceSource({ title, width, height, html, helmet, reach }: { title: string; width: number; height: number; html: string; helmet?: string; reach: number }): string {
  const props = JSON.stringify({ $preview: { width, height } });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeText(title)}</title>
${SUPPORT_SCRIPT_TAG}
</head>
<body>
<x-dc>
<helmet><style>body { margin: 0;${reach ? ` padding: ${pixels(reach)};` : ''} }</style>${helmet ? `\n${helmet}` : ''}</helmet>
${html}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='${props}'>
class Component extends DCLogic {}
</script>
</body>
</html>
`;
}
