/**
 * Saving trouble made visible: a banner over the text, and no more editing once the page can't save or an owner locked
 * the doc. An undo or redo that couldn't be saved asks whether to restore the document to what the page shows; a reload
 * before that is done says, on the next load, to check that nothing is missing.
 */
import { fillSlot } from '../app/slots.ts';
import { useDocs } from '../app/store.ts';
import { useEditor } from '../editor/format.ts';
import { watchLeftUnsaved } from './reload-notice.ts';
import { listenForLostUndo } from './rescue.ts';
import { RescueDialog } from './RescueDialog.tsx';
import { SaveBanner } from './SaveBanner.tsx';

fillSlot('float', 'save-banner', SaveBanner, 5);
fillSlot('overlay', 'short-undo-rescue', RescueDialog, 0);
listenForLostUndo();
watchLeftUnsaved();

// The editor reads `editable` only when its props change: tell it when the open tab stops (or starts again), or the
// doc is locked or unlocked.
useDocs.subscribe((state, before) => {
  const now = state.activeTab ? state.saving[state.activeTab] === 'stopped' : false;
  const was = before.activeTab ? before.saving[before.activeTab] === 'stopped' : false;
  if (now !== was || state.writable !== before.writable) useEditor.getState().view?.setProps({});
});
