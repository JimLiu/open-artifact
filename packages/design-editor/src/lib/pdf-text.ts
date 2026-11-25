/**
 * The PDF's invisible text layer and links: placed on a page by
 * `@open-artifact/export-kit`, plus the outline entry of an artboard's pages.
 */

export { pageLinks, pageRuns, type PdfLinkBox, type PdfRun } from '@open-artifact/export-kit';

/** The outline entry of a page: the artboard's title on its first page only. */
export function pageBookmark(title: string, index: number): string | undefined {
  return index === 0 ? title : undefined;
}
