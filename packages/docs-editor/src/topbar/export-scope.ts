/**
 * Which tabs an export takes. A doc of one tab exports it; in a doc of several, a dialog asks for the open tab or all
 * of them, and closing it exports nothing.
 */
import type { DocExportFormat, DocPaper } from '@open-artifact/runtime/doc-api';
import { getDocs } from '../app/store.ts';
import { getTopBar, setTopBar } from './store.ts';

/** The open tab, or every tab. */
export type ExportScope = 'tab' | 'doc';

let answer: ((scope: ExportScope | null) => void) | null = null;

export const hasSeveralTabs = (): boolean => (getDocs().project?.files.length ?? 0) > 1;

/** Whether the dialog is asking already (or an export is running), so another export waits. */
export const scopeBusy = (): boolean => answer !== null || getTopBar().exporting !== null;

/** Asks which tabs to export; resolves `null` when the person closes the dialog, at once when it is asking already. */
export function askExportScope(format: DocExportFormat, paper?: DocPaper): Promise<ExportScope | null> {
  if (answer) return Promise.resolve(null);
  return new Promise(resolve => {
    answer = scope => {
      answer = null;
      setTopBar({ askingScope: null });
      resolve(scope);
    };
    setTopBar({ askingScope: { format, ...(paper ? { paper } : {}) } });
  });
}

/** The dialog's answer: the open tab, all tabs, or `null` (closed). */
export function answerExportScope(scope: ExportScope | null): void {
  answer?.(scope);
}
