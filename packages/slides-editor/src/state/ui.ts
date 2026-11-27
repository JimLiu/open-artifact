/**
 * Transient UI state: which dialog or popover is open. Kept apart from the
 * view store so opening a dialog never re-renders the stage.
 */

import { create } from 'zustand';

/** The dialogs of the editor. */
export type DialogId = 'newSlide' | 'videoLink' | 'shortcuts' | 'table';

interface UiState {
  dialog: DialogId | null;
  /** Counts link requests (⌘K while typing); the format bar's link button opens on a change it sees while shown. */
  linkRequests: number;
  open(dialog: DialogId): void;
  close(): void;
  requestLink(): void;
}

/** The UI store. */
export const useUi = create<UiState>()((set) => ({
  dialog: null,
  linkRequests: 0,
  open(dialog) {
    set({ dialog });
  },
  close() {
    set({ dialog: null });
  },
  requestLink() {
    set((state) => ({ linkRequests: state.linkRequests + 1 }));
  },
}));
