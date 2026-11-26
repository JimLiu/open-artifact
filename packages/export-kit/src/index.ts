/**
 * @open-artifact/export-kit: the capture and export code the Slides, Design,
 * Whiteboard and Data editors share in the browser.
 *
 * - capture.ts: DOM to pictures (inlined copies drawn through
 *   `<foreignObject>`, or dom-to-svg) and capture size limits;
 * - page-image.ts: a rendered document's viewport as a picture, and an
 *   element as standalone HTML with its computed styles inlined;
 * - measure.ts and text-layer.ts: the PDF text layer (words and links
 *   measured on a rendered page, words grouped into lines);
 * - document-measure.ts, pagination.ts and pdf-text.ts: a long document
 *   measured, cut into paper pages, and its text and links placed on each;
 * - pictures.ts: `data:` URLs, canvas encoding, decoding and shrinking pictures;
 * - outline.ts: CSS outlines, which dom-to-svg leaves out, drawn into its SVG;
 * - canvas-area.ts: how large a canvas captures draw on, lowered once the browser would not make one;
 * - fonts.ts: reading font stylesheets for inlined `@font-face` rules;
 * - font-embed.ts: the web fonts a rendered document uses, inlined for pictures of it;
 * - font-subset.ts: a TrueType font cut down to the ideographs and Hangul a document uses.
 *
 * It never imports an editor or a document model; each editor passes its
 * own limits and policies. The pure modules (text-layer.ts, pagination.ts,
 * pdf-text.ts, fonts.ts, font-subset.ts, canvas-area.ts, and outline.ts's
 * geometry) load in `node --test`.
 */

export * from './canvas-area.ts';
export * from './capture.ts';
export * from './document-measure.ts';
export * from './font-embed.ts';
export * from './font-subset.ts';
export * from './fonts.ts';
export * from './measure.ts';
export * from './outline.ts';
export * from './page-image.ts';
export * from './pagination.ts';
export * from './pdf-text.ts';
export * from './pictures.ts';
export * from './text-layer.ts';
