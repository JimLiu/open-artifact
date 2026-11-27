/**
 * What a Sheet's page asks the agent for, by what the person pressed: the page's own words for its buttons, and the
 * request a file chosen with "Import from Excel" becomes (a connected table's refresh is in connected-tables.ts).
 */

import type { AgentRequest } from '@open-artifact/runtime/capabilities';

/** The page's words for what was pressed, as a request's `context.pressed` carries them. */
export const PAGE_REQUEST_PRESSED = {
  fix: 'Ask agent to fix',
  insertChart: 'Insert chart',
  conditionalFormatting: 'Conditional formatting',
  importFromExcel: 'Import from Excel',
  refresh: 'Refresh',
} as const;

export type PageRequestPressed = (typeof PAGE_REQUEST_PRESSED)[keyof typeof PAGE_REQUEST_PRESSED];

/** The request the agent gets for a file kept in the Sheet's `imports/` folder (`file` is its path from the folder). */
export function importRequest(file: string): AgentRequest {
  return {
    text: `Import this Excel file into the Sheet, as new sheets: ${file}`,
    title: PAGE_REQUEST_PRESSED.importFromExcel,
    context: { pressed: PAGE_REQUEST_PRESSED.importFromExcel, file },
  };
}
