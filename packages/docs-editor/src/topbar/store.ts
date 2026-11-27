/** The top bar's own state: whether the doc's name is being edited, which export is on its way, and what is asked. */
import type { DocExportFormat, DocPaper } from '@open-artifact/runtime/doc-api';
import { create } from 'zustand';

/** An export waiting for the person to say which tabs it takes. */
export interface ScopeQuestion {
  format: DocExportFormat;
  paper?: DocPaper;
}

export interface TopBarState {
  renaming: boolean;
  /** The export being made, so its menu item reads "Exporting…" and another press waits. */
  exporting: string | null;
  /** The export the scope dialog asks about. */
  askingScope: ScopeQuestion | null;
}

export const useTopBar = create<TopBarState>(() => ({ renaming: false, exporting: null, askingScope: null }));

export const setTopBar = useTopBar.setState;
export const getTopBar = useTopBar.getState;
